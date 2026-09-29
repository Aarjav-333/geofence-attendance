-- Geofence Attendance — PostgreSQL schema (PostgreSQL 13+)
-- Idempotent: safe to run repeatedly (`npm run db:migrate`).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'geofence_status') THEN
    CREATE TYPE geofence_status AS ENUM ('WITHIN_RANGE', 'OUTSIDE_RANGE');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS submissions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Person
  name                  text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  department            text NOT NULL CHECK (char_length(department) BETWEEN 1 AND 100),
  member_id             text NOT NULL CHECK (char_length(member_id) BETWEEN 1 AND 50),

  -- Reported position
  latitude              double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude             double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m            double precision NOT NULL CHECK (accuracy_m >= 0),
  position_captured_at  timestamptz,

  -- Server-computed geofence result
  distance_m            double precision NOT NULL CHECK (distance_m >= 0),
  geofence_status       geofence_status NOT NULL,
  low_accuracy          boolean NOT NULL DEFAULT false,

  -- Snapshot of the geofence config used (the target may change later)
  target_latitude       double precision NOT NULL,
  target_longitude      double precision NOT NULL,
  radius_m              double precision NOT NULL CHECK (radius_m > 0),

  -- Audit metadata
  client_distance_m     double precision,        -- what the browser claimed (never trusted)
  user_agent            text CHECK (char_length(user_agent) <= 500),
  ip_hash               text,                    -- salted SHA-256, raw IP is never stored
  created_at            timestamptz NOT NULL DEFAULT now(),

  -- The status can never disagree with the stored distance
  CONSTRAINT status_matches_distance CHECK (
    (geofence_status = 'WITHIN_RANGE') = (distance_m <= radius_m)
  )
);

CREATE INDEX IF NOT EXISTS submissions_created_at_idx      ON submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_status_created_idx  ON submissions (geofence_status, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_department_idx      ON submissions (department);
CREATE INDEX IF NOT EXISTS submissions_member_id_idx       ON submissions (member_id);

-- ── v2: QR-based workplace check-in ─────────────────────────────────────────
-- Check-ins record designation / institution / email / mobile instead of
-- department / member_id. Earlier records keep their original fields.

ALTER TABLE submissions ALTER COLUMN department DROP NOT NULL;
ALTER TABLE submissions ALTER COLUMN member_id  DROP NOT NULL;

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS designation     text CHECK (char_length(designation) BETWEEN 2 AND 100);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS institution     text CHECK (char_length(institution) BETWEEN 2 AND 150);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS email           text CHECK (char_length(email) BETWEEN 3 AND 254 AND email LIKE '%_@_%');
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS mobile          text CHECK (mobile ~ '^\+[1-9][0-9]{7,14}$');
-- One server-issued location verification = one check-in (prevents token replay)
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS verification_id uuid UNIQUE;

DO $$
BEGIN
  -- Every row is either a legacy registration or a complete, in-range check-in
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_kind_complete') THEN
    ALTER TABLE submissions ADD CONSTRAINT record_kind_complete CHECK (
      (verification_id IS NULL AND department IS NOT NULL AND member_id IS NOT NULL)
      OR
      (verification_id IS NOT NULL AND designation IS NOT NULL AND institution IS NOT NULL
        AND email IS NOT NULL AND mobile IS NOT NULL AND geofence_status = 'WITHIN_RANGE')
    );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS submissions_institution_idx ON submissions (institution);
CREATE INDEX IF NOT EXISTS submissions_email_idx       ON submissions (email);

-- ── v3: replay protection independent of attendance data ───────────────────
-- Every location verification that has been used for a check-in, kept until it
-- expires. Lives outside `submissions` so "Clear All Data" can't make a used
-- verification valid again. Expired rows are pruned on insert.
CREATE TABLE IF NOT EXISTS used_verifications (
  verification_id uuid PRIMARY KEY,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS used_verifications_expires_idx ON used_verifications (expires_at);

-- Backfill from check-ins stored before this table existed (verifications live 10 minutes)
INSERT INTO used_verifications (verification_id, expires_at, used_at)
SELECT verification_id, created_at + interval '10 minutes', created_at
FROM submissions
WHERE verification_id IS NOT NULL AND created_at > now() - interval '10 minutes'
ON CONFLICT (verification_id) DO NOTHING;

-- ── v4: admin audit log ─────────────────────────────────────────────────────
-- Permanent record of destructive admin actions (e.g. "Clear All Data").
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor      text NOT NULL CHECK (char_length(actor) BETWEEN 1 AND 64),
  action     text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 64),
  details    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS admin_audit_log_action_at_idx ON admin_audit_log (action, at DESC);
