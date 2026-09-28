# Geofence Attendance

A focused, production-oriented web app for **location-verified registration / attendance**.
Visitors fill in a short form (name, department, employee/student ID), share their GPS location
once, and the server verifies whether they are within **100 m** of a designated point.
Administrators review every submission, with its distance and `WITHIN_RANGE` / `OUTSIDE_RANGE` status,
on a protected dashboard.

---

## Features

**Public form** (`/`)
- No account or login required. The form is mobile-first and responsive, with dark mode.
- Location is read with the browser Geolocation API **only after the user taps "Get my location"**,
  which triggers the browser's permission prompt. A notice explains why location is collected.
- The distance and status appear straight away ("✓ Within 100 meters" / "✗ Outside 100 meters"), along with the
  coordinates and reported accuracy. Poor-accuracy fixes show a warning.
- Clear messages for each failure: permission denied, GPS unavailable, timeout, unsupported
  browser, insecure (HTTP) context, invalid coordinates, expired reading, network or server failure, rate limit.
- Submit is disabled until a location has been obtained. A receipt shows the **server-verified** result.

**Server-side verification**
- The server recomputes the distance with Haversine and decides the status itself. Any status or
  distance sent by the client is ignored.
- Every field is validated with Zod (lengths, character sets, lat/lon ranges, accuracy, fix age).
- A database `CHECK` constraint makes it impossible to store a status that contradicts the stored distance.

**Admin dashboard** (`/admin`, authenticated)
- Totals: all submissions, within 100 m, outside 100 m, today.
- A map (Leaflet + OpenStreetMap) shows the geofence circle and green/red submission markers.
- Search by name, ID or department. Filter by department and status. Sort newest or oldest first. Results are paginated.
- For each row: distance, status badge, time, and a **Details** panel with exact coordinates (with a Google Maps
  link), accuracy, GPS-fix time, the target and radius used, the device, and any mismatch between the client's claimed distance and the server's.
- **CSV export** of the current filtered view, with protection against spreadsheet formula injection.

---

## Architecture

```
Browser (React client component)
  │  navigator.geolocation.getCurrentPosition()  ← explicit user action + permission prompt
  │  evaluateGeofence() → instant feedback (not trusted)
  ▼
POST /api/submissions  (Next.js Route Handler, Node.js runtime)
  │  rate limit → JSON parse (≤4 KB) → Zod validation → fix-age check
  │  evaluateGeofence() with TARGET_* from env   ← authoritative
  ▼
PostgreSQL  submissions table (CHECK constraints + indexes)
  ▲
/admin (Server Component)  ← proxy.ts redirect + requireAdmin() in page/route/action
```

**Why this stack**
| Choice | Reason |
|---|---|
| **Next.js 16 (App Router) + TypeScript** | One deployable unit for the UI, API and admin pages. Server Components query the DB directly for the dashboard, so no extra API layer is needed. |
| **PostgreSQL** (`postgres` driver, plain SQL) | Real constraints, enum types and indexes. Plain parameterised SQL keeps it small, with no ORM or codegen. Runs locally in Docker and in production on Neon, Supabase, RDS or any other Postgres host. |
| **Env-based single-admin auth** (scrypt + HMAC-signed cookie) | The requirement is one authorized administrator. This avoids a third-party auth provider and a users table while staying secure. |
| **Tailwind CSS v4** | Fast, consistent, responsive styling with light and dark themes. |
| **Zod** | One schema shared by the browser and the server. |
| **Vitest** | Fast unit tests for the geofence, validation and auth logic. |

### Project structure

```
geofence-attendance/
├── app/
│   ├── page.tsx                  # Public registration page (reads geofence config server-side)
│   ├── layout.tsx, globals.css
│   ├── admin/
│   │   ├── page.tsx              # Dashboard (protected)
│   │   ├── actions.ts            # login / logout server actions
│   │   └── login/                # Sign-in page + form
│   └── api/
│       ├── submissions/route.ts  # POST: validate, verify geofence, store
│       └── admin/export/route.ts # GET: CSV export (protected)
├── components/
│   ├── registration-form.tsx     # Form, geolocation flow, receipt
│   ├── location-status.tsx       # Location permission/result UI
│   └── admin/                    # Filters, table, map
├── lib/
│   ├── geo.ts                    # Haversine, geofence evaluation (pure, shared)
│   ├── validation.ts             # Zod submission schema (shared)
│   ├── submission-service.ts     # Server-side processing (framework-free, unit-tested)
│   ├── config.ts                 # Env-driven configuration (server-only)
│   ├── db.ts                     # PostgreSQL queries
│   ├── session.ts, password.ts, auth.ts   # Admin authentication
│   ├── rate-limit.ts, request.ts, admin-filters.ts
├── database/schema.sql           # Tables, enum, constraints, indexes
├── proxy.ts                      # Redirects unauthenticated /admin requests
├── scripts/
│   ├── migrate.ts                # npm run db:migrate
│   ├── hash-password.ts          # npm run hash-password -- "<password>"
│   └── autopush.mjs              # npm run autopush (dev auto-commit/push loop)
├── tests/                        # Vitest suites
├── types/submission.ts
├── docker-compose.yml            # Local PostgreSQL
└── .env.example
```

---

## How geofencing works

1. **Obtain position.** When the user taps *Get my location*, the browser calls
   `navigator.geolocation.getCurrentPosition()` with `{ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }`.
   The browser shows its permission prompt. On success it returns `latitude`, `longitude`, `accuracy`
   (a 68%-confidence radius in meters) and a `timestamp`. The API only works in a **secure context**
   (HTTPS or `localhost`).
2. **Preview on the client.** The same `evaluateGeofence()` function the server uses runs in the browser
   for instant feedback. This is only a preview.
3. **Verify on the server.** On submit, the API receives only raw coordinates, accuracy and fix time.
   It validates them, then computes the distance to `TARGET_LATITUDE` / `TARGET_LONGITUDE` and applies
   the rule:

   ```
   distance ≤ GEOFENCE_RADIUS_METERS  →  WITHIN_RANGE
   distance >  GEOFENCE_RADIUS_METERS  →  OUTSIDE_RANGE
   ```

   The distance is rounded to the centimeter before comparison, so the boundary is deterministic:
   exactly 100.00 m counts as within.
4. **Accuracy is recorded, not used to decide.** The status is decided by the computed distance only.
   Fixes with accuracy worse than `LOW_ACCURACY_THRESHOLD_METERS` are flagged *low accuracy* for the admin to review.

### The Haversine formula

For two points (φ = latitude, λ = longitude, in radians) on a sphere of radius R = 6 371 008.8 m (the mean Earth radius):

```
a = sin²(Δφ/2) + cos φ₁ · cos φ₂ · sin²(Δλ/2)
c = 2 · atan2(√a, √(1−a))
d = R · c
```

Haversine gives the great-circle ("as the crow flies") distance. It stays numerically stable at short
distances, which matters here, and its spherical-Earth error (≤0.3 %) is about 30 cm at 100 m. That is far smaller than
consumer GPS error (typically 3–20 m). See `lib/geo.ts`.

---

## Setup

### Prerequisites
- Node.js 20+ (tested on Node 25)
- Docker (for local PostgreSQL), or any PostgreSQL 13+ instance

### 1. Install
```bash
git clone https://github.com/Aarjav-333/geofence-attendance.git
cd geofence-attendance
npm install
```

### 2. Configure environment
```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `TARGET_LATITUDE` | ✔ | Latitude of the designated location (decimal degrees) |
| `TARGET_LONGITUDE` | ✔ | Longitude of the designated location |
| `GEOFENCE_RADIUS_METERS` | – (100) | Allowed radius in meters |
| `LOW_ACCURACY_THRESHOLD_METERS` | – (50) | Fixes less accurate than this are flagged |
| `DEPARTMENTS` | – | Comma-separated suggestions for the Department field |
| `DISPLAY_TIMEZONE` | – (Asia/Kolkata) | Timezone for admin timestamps and the "Today" count |
| `DATABASE_URL` | ✔ | PostgreSQL connection string |
| `ADMIN_USERNAME` | ✔ | Admin login name |
| `ADMIN_PASSWORD_HASH` | ✔ | scrypt hash (see below). Never store the plain password |
| `SESSION_SECRET` | ✔ | ≥32 random characters, used to sign admin sessions |

Coordinate configuration used for this deployment:

```env
TARGET_LATITUDE=8.54612616725849
TARGET_LONGITUDE=76.90465781805145
GEOFENCE_RADIUS_METERS=100
```

To move the geofence, change these values and restart or redeploy. No code changes are needed. Each
submission stores the target and radius that were in effect, so historical records stay auditable.

### 3. Database
```bash
docker compose up -d        # PostgreSQL 17 on localhost:5433
npm run db:migrate          # applies database/schema.sql (idempotent)
```

Schema (`database/schema.sql`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `name`, `department`, `member_id` | text | length `CHECK`s |
| `latitude`, `longitude` | double precision | range `CHECK`s (±90 / ±180) |
| `accuracy_m` | double precision | ≥ 0 |
| `position_captured_at` | timestamptz | when the GPS fix was taken |
| `distance_m` | double precision | **server-computed** |
| `geofence_status` | enum `WITHIN_RANGE` \| `OUTSIDE_RANGE` | **server-computed** |
| `low_accuracy` | boolean | accuracy > threshold |
| `target_latitude`, `target_longitude`, `radius_m` | | config snapshot for auditing |
| `client_distance_m` | double precision | what the browser claimed (audit only) |
| `user_agent` | text | device info |
| `ip_hash` | text | salted SHA-256. The raw IP is never stored |
| `created_at` | timestamptz | submission time |

Constraint `status_matches_distance` enforces `(status = WITHIN_RANGE) ⇔ (distance_m ≤ radius_m)`.
Indexes: `created_at DESC`, `(geofence_status, created_at DESC)`, `department`, `member_id`.

### 4. Create the admin account
```bash
npm run hash-password -- "a-long-unique-password"
# → ADMIN_PASSWORD_HASH=scrypt:16384:8:1:...   paste into .env.local

node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# → paste as SESSION_SECRET
```
Set `ADMIN_USERNAME` too. Changing the password means generating a new hash. Rotating `SESSION_SECRET`
signs out every session.

### 5. Run
```bash
npm run dev            # http://localhost:3000   (admin: /admin)
# or production mode
npm run build && npm start
```

> Geolocation needs a secure context. `http://localhost` counts as secure, but a phone opening
> `http://192.168.x.x:3000` does **not**. To test on a phone, deploy to HTTPS or use a tunnel
> (for example `npx localtunnel --port 3000` or `cloudflared tunnel --url http://localhost:3000`).

### 6. Test
```bash
npm test               # Vitest: geofence cases, server-side validation, auth
npm run typecheck
npm run lint
```

The test suite covers:
- **Case 1:** at the target → `WITHIN_RANGE`
- **Case 2:** ~50 m → `WITHIN_RANGE`
- **Case 3:** ~100 m (boundary, four bearings) and 99.9 m → `WITHIN_RANGE`
- **Case 4:** 100.02 m, 101 m, 287.4 m → `OUTSIDE_RANGE`
- **Case 5:** invalid latitude/longitude (out of range, NaN, ∞, strings, missing) → validation error
- Server rejects forged status/distance, invalid fields and stale/future GPS fixes, and normalizes text
- Password hashing, session-token tampering/expiry, rate limiter

---

## Deployment (Vercel + Neon Postgres)

**Live:** https://geofence-attendance-eta.vercel.app (admin: `/admin`)

Current setup: Vercel project `geofence-attendance` (Hobby). Neon Postgres (free plan) runs in
`ap-southeast-1` (Singapore), provisioned through the Vercel Marketplace. `vercel.json` pins functions
to `sin1` so they sit next to the database. `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` are stored as
Vercel *Sensitive* variables, so `vercel env pull` returns placeholders for them, never the real values.
Deploys are made from the CLI (`vercel deploy --prod`). The GitHub repo is intentionally **not** connected
for automatic deploys, because the one-minute auto-push loop would use up the Hobby plan's daily deployment limit.

To set it up from scratch:

1. Push the repo to GitHub (already set up, see below) and **Import** it at vercel.com/new.
2. In the Vercel project, open **Storage → Marketplace → Neon (Postgres)**. This injects `DATABASE_URL`.
3. Add the other variables (`TARGET_*`, `GEOFENCE_RADIUS_METERS`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`,
   `SESSION_SECRET`, …) under **Settings → Environment Variables**.
4. Run the migration once against the production database, using the **unpooled** URL:
   `DATABASE_URL="<DATABASE_URL_UNPOOLED>" npm run db:migrate`. Don't pull production env into
   `.env.local`, or local dev will write to production.
5. Deploy. Vercel serves over HTTPS automatically, which geolocation requires.

Any Node.js host works (Render, Fly.io, Railway, a VPS behind nginx with TLS). Run `npm run build && npm start`
with the same env vars, and put it behind HTTPS.

---

## GitHub setup and auto-push workflow

Repository: **https://github.com/Aarjav-333/geofence-attendance** (public).

It was created with the GitHub CLI:
```bash
gh auth login                          # once, interactive
gh repo create geofence-attendance --public --source . --remote origin --push
```

### Automatic commits during development
`scripts/autopush.mjs` is a small watcher that runs **every 60 seconds** while you develop:

```bash
npm run autopush                       # Ctrl+C to stop
AUTOPUSH_INTERVAL=120 npm run autopush # custom interval (seconds)
npm run autopush -- --once             # single cycle
```

Each cycle:
1. Runs `git status --porcelain`. If nothing changed, it skips, so **no empty commits** are made.
   It also retries any push that failed earlier.
2. **Refuses to commit** if a changed path looks like a secret (`.env*` other than `.env.example`,
   `*.pem`, `*.key`, `id_rsa*`, `credentials.json`), as a second line of defense after `.gitignore`.
3. Runs `git add -A` and commits with a message **derived from what changed**, e.g.
   `Update geofence logic, tests (3 files)` or `Add admin UI, API routes (5 files)`.
4. Runs `git push -u origin <current branch>`.

It is deliberately a foreground developer tool, not a git hook or CI job. Auto-pushing from CI would
push commits nobody reviewed, and a hook can't run on a timer. For milestone work, commit manually with a
descriptive message as usual.

---

## Security and privacy

- **Explicit consent.** Location is requested only from a user click, through the browser's permission prompt.
  It is read once (`getCurrentPosition`, never `watchPosition`), and the page explains why it is collected.
- **Server is authoritative.** Distance and status are computed on the server from validated coordinates.
  Client values that could influence the result are not part of the accepted schema. A DB constraint
  backs this up.
- **Validation.** Zod schema: length limits, allowed character sets, lat ∈ [-90, 90], lon ∈ [-180, 180],
  finite numbers, accuracy bounds, GPS-fix age ≤ 10 min. Bodies are capped at 4 KB and must be JSON.
  All SQL is parameterised.
- **Admin protection.**
  - `proxy.ts` redirects unauthenticated requests, and every admin page, action and route re-checks the session (defense in depth).
  - Passwords are hashed with scrypt, and credentials are compared in constant time.
  - Sessions are HMAC-SHA256-signed with an 8 h expiry, in an `HttpOnly` + `SameSite=Strict` cookie that is `Secure` in production.
  - Login is rate limited (5 attempts / 15 min per IP), and the dashboard is `noindex`.
- **Secrets** live only in environment variables. `.env*` is git-ignored except `.env.example`, which holds
  no secrets. The geofence config is read server-side and passed to the page as props.
- **Headers:** `Permissions-Policy: geolocation=(self)`, `X-Frame-Options: DENY`, `nosniff`, HSTS,
  a strict referrer policy, and no `X-Powered-By`.
- **Data minimisation.** Only the listed fields are stored. IP addresses are stored as a salted hash
  (for abuse correlation), never raw. The admin CSV export neutralises spreadsheet formula injection.
- **HTTPS is required in production.** Browsers block geolocation on insecure origins.

---

## Known limitations

- **Location can be spoofed on a device the user controls.** Browser geolocation is self-reported: a user with
  developer tools, a mock-location app or a rooted phone can report fake coordinates. The server check stops
  *tampering with the result*, but no web app can prove where a device physically is. For high-stakes use,
  combine this with on-site measures (a QR code that rotates per session, venue Wi-Fi/IP allow-listing, or supervision).
- **GPS accuracy varies.** Indoors or on desktop (Wi-Fi/IP positioning), accuracy can be tens to hundreds of meters.
  Such fixes are flagged *low accuracy* but still classified by distance.
- **Rate limiting is in-memory**, so it applies per server instance. For strict global limits use a shared
  store such as Upstash Redis.
- **Duplicate submissions are allowed.** The same ID can submit more than once (for example, on several days). Filter by ID
  in the dashboard, or add a unique constraint per day if you need one record per person per day.
- **Single admin account.** Multiple admins or roles would need a users table or an auth provider.
- **The map uses public OpenStreetMap tiles.** Fine for low admin traffic. Use a tile provider for heavy usage.
