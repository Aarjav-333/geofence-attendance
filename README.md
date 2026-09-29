# Geofence Attendance

A focused, production-oriented web app for **QR-based, location-verified workplace attendance**.
Employees scan a QR code displayed at the workplace, which opens the attendance page. They share their
GPS location, and the **server** verifies they are within **100 m** of the workplace. Only then does the
check-in form appear. Administrators review every check-in, with its distance and geofence status,
on a protected dashboard.

---

## Features

**Attendance page** (`/attendance`, opened by the workplace QR code; `/` redirects here)
- No account or login required. The page is mobile-first and responsive, with dark mode.
- **The form is not shown on page load.** The flow is:
  1. The employee taps **Detect My Location**. The browser asks for location permission, and the page reads
     latitude, longitude and accuracy once through the Geolocation API.
  2. The raw fix is sent to `POST /api/attendance/verify`. The **server** computes the distance to the workplace.
  3. **Inside 100 m:** the page shows "Location verified ✓" with the distance, then the check-in form. The server
     also returns a signed verification that is valid for 10 minutes.
     **Outside 100 m:** the page shows "Location verification failed", the distance and the requirement. No form is
     shown and Check In is impossible.
  4. The employee enters **Employee Name, Designation, Institution, Email ID and Mobile Number**, then taps **Check In**.
  5. `POST /api/attendance/check-in` recomputes the geofence and stores the check-in, and the page shows
     "Check-In Successful ✓" with the time.
- Clear messages, each with a retry option, for: permission denied, location unavailable, GPS timeout, unsupported
  browser, insecure (HTTP) context, invalid coordinates, poor accuracy (worse than ±150 m), stale readings,
  expired verification, network or server failure, and rate limiting.

**Server-side verification**
- The server computes the distance with Haversine and decides the status itself, both at verification and again at
  check-in. The check-in request contains **no coordinates, distance or status**. The coordinates come only from
  the server-signed verification, and they are re-checked against the *current* workplace configuration.
  Any status or distance sent by the client is ignored.
- Each verification can be used for **one** check-in (`verification_id` is `UNIQUE`). Verifications expire after 10 minutes.
- Every field is validated with Zod: lengths, character sets, email format, and mobile number format (stored as E.164,
  e.g. `+919876543210`). Latitude and longitude ranges, accuracy and fix age are validated too.
- Database `CHECK` constraints make it impossible to store a status that contradicts the stored distance, or a
  check-in that is incomplete or outside the geofence.

**Workplace QR code** (`/admin/qr`, authenticated)
- Shows a printable poster with a QR code that encodes only the public attendance URL
  (for example `https://geofence-attendance-eta.vercel.app/attendance`), with no location or personal data.
- **Download PNG** (~1200 px), **Download SVG**, **Print** (the print layout shows only the poster) and **Copy link**.
- The QR code is a convenience, **not** a security control. Opening the URL directly still requires passing the
  server-side location check.

**Admin dashboard** (`/admin`, authenticated)
- Totals: all check-ins, within 100 m, outside 100 m (earlier records only), today.
- A map (Leaflet + OpenStreetMap) shows the workplace geofence and green/red markers for each record.
- Columns: Employee Name, Designation, Institution, Email, Mobile Number, Distance, Location Status, Check-In Time.
- Search by name, email, mobile, designation or institution. Filter by institution and status. Sort newest or oldest first.
  Results are paginated.
- A **Details** panel per row shows exact coordinates (with a Google Maps link), accuracy, GPS-fix time, the target and
  radius used, the device and the record reference.
- **CSV export** of the current filtered view, with protection against spreadsheet formula injection.
- Records from the earlier registration form (department and ID) are kept and marked as earlier registrations.

---

## Architecture

```
Workplace QR code ──► /attendance  (Server Component; knows only the radius)
                          │
Browser (React client component)
  │  navigator.geolocation.getCurrentPosition()  ← explicit user action + permission prompt
  ▼
POST /api/attendance/verify   (Route Handler)
  │  rate limit → Zod (lat/lon/accuracy/timestamp) → fix-age + accuracy checks
  │  evaluateGeofence() with TARGET_* from env   ← authoritative
  │  WITHIN_RANGE → HMAC-signed verification {coords, accuracy, jti, exp}   (nothing stored)
  ▼
Check-in form (rendered only after WITHIN_RANGE)
  ▼
POST /api/attendance/check-in
  │  Zod (name, designation, institution, email, mobile) → verify signature + expiry
  │  evaluateGeofence() AGAIN from the signed coordinates  ← authoritative
  │  WITHIN_RANGE → INSERT (verification_id UNIQUE)          OUTSIDE → 403
  ▼
PostgreSQL  submissions table (CHECK constraints + indexes)
  ▲
/admin, /admin/qr (Server Components)  ← proxy.ts redirect + requireAdmin() in page/route/action
```

**Why this stack**
| Choice | Reason |
|---|---|
| **Next.js 16 (App Router) + TypeScript** | One deployable unit for the UI, API and admin pages. Server Components query the DB directly for the dashboard, so no extra API layer is needed. |
| **PostgreSQL** (`postgres` driver, plain SQL) | Real constraints, enum types and indexes. Plain parameterised SQL keeps it small, with no ORM or codegen. Runs locally in Docker and in production on Neon, Supabase, RDS or any other Postgres host. |
| **Env-based admin accounts** (scrypt + HMAC-signed cookie) | A few administrators, all with the same `admin` role. This avoids a third-party auth provider and a users table while staying secure. |
| **Tailwind CSS v4** | Fast, consistent, responsive styling with light and dark themes. |
| **Zod** | One schema shared by the browser and the server. |
| **Vitest** | Fast unit tests for the geofence, validation and auth logic. |

### Project structure

```
geofence-attendance/
├── app/
│   ├── page.tsx                  # Redirects / → /attendance
│   ├── attendance/page.tsx       # Attendance page opened by the QR code
│   ├── layout.tsx, globals.css
│   ├── admin/
│   │   ├── page.tsx              # Dashboard (protected)
│   │   ├── qr/page.tsx           # Printable workplace QR code (protected)
│   │   ├── actions.ts            # login / logout server actions
│   │   └── login/                # Sign-in page + form
│   └── api/
│       ├── attendance/verify/route.ts    # POST: server geofence check → signed verification
│       ├── attendance/check-in/route.ts  # POST: validate, re-check geofence, store
│       └── admin/export/route.ts         # GET: CSV export (protected)
├── components/
│   ├── attendance/attendance-flow.tsx    # Location → verification → form → check-in UI
│   └── admin/                    # Filters, table, map, QR actions
├── lib/
│   ├── geo.ts                    # Haversine, geofence evaluation (pure)
│   ├── validation.ts             # Zod schemas: location fix, employee details, mobile normalization
│   ├── attendance-service.ts     # verifyLocation() / checkIn() (framework-free, unit-tested)
│   ├── signed-token.ts           # HMAC-signed tokens (admin sessions + location verifications)
│   ├── config.ts                 # Env-driven configuration (server-only)
│   ├── db.ts, db-options.ts      # PostgreSQL queries + connection options
│   ├── qr.ts, qr-path.ts         # QR encoding (server) + SVG path rendering
│   ├── session.ts, password.ts, auth.ts   # Admin authentication
│   ├── rate-limit.ts, request.ts, http.ts, admin-filters.ts
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

1. **Obtain position.** When the employee taps *Detect My Location*, the browser calls
   `navigator.geolocation.getCurrentPosition()` with `{ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }`.
   The browser shows its permission prompt. On success it returns `latitude`, `longitude`, `accuracy`
   (a 68%-confidence radius in meters) and a `timestamp`. The API only works in a **secure context**
   (HTTPS or `localhost`).
2. **Reject unusable fixes.** The server refuses fixes older than 2 minutes, and fixes whose accuracy is
   worse than `MAX_ACCURACY_METERS` (default ±150 m). At that uncertainty, a 100 m geofence can't be judged.
3. **Verify on the server.** `/api/attendance/verify` receives only raw coordinates, accuracy and fix time.
   It computes the distance to `TARGET_LATITUDE` / `TARGET_LONGITUDE` and applies the rule below.
   The browser never receives the workplace coordinates and never computes the status itself.
   `/api/attendance/check-in` applies the same rule again to the signed coordinates before storing anything.

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
| `TARGET_LATITUDE` | ✔ | Latitude of the authorized workplace (decimal degrees) |
| `TARGET_LONGITUDE` | ✔ | Longitude of the authorized workplace |
| `GEOFENCE_RADIUS_METERS` | – (100) | Allowed radius in meters |
| `LOW_ACCURACY_THRESHOLD_METERS` | – (50) | Fixes less accurate than this are accepted but flagged |
| `MAX_ACCURACY_METERS` | – (150) | Fixes less accurate than this are rejected as insufficient |
| `APP_URL` | – (auto) | Base URL encoded in the QR code. Defaults to the Vercel production domain, then to the current host |
| `DISPLAY_TIMEZONE` | – (Asia/Kolkata) | Timezone for admin timestamps and the "Today" count |
| `DATABASE_URL` | ✔ | PostgreSQL connection string. Add `?prepare=false` if your pooler needs it |
| `DATABASE_SSL` | – (auto) | `disable` \| `require` \| `verify-full`. By default local hosts use no TLS and remote hosts use `verify-full` |
| `ADMIN_USERNAME` | ✔ | Admin login name |
| `ADMIN_PASSWORD_HASH` | ✔ | scrypt hash (see below). Never store the plain password |
| `ADDITIONAL_ADMINS` | – | More admins with identical privileges: `username=<scrypt hash>`, separated by `;` (e.g. the `master` account) |
| `SESSION_SECRET` | ✔ | ≥32 random characters. Signs admin sessions and location verifications (with separate derived keys) |

Workplace configuration used for this deployment: the **Principal's office, College of Engineering Trivandrum**.
It is OpenStreetMap node [3695678553](https://www.openstreetmap.org/node/3695678553) (`name=Principal`,
`office=educational_institution`); the coordinates were confirmed with Nominatim and the OSM API:

```env
TARGET_LATITUDE=8.5458387
TARGET_LONGITUDE=76.9062601
GEOFENCE_RADIUS_METERS=100
```

To move the geofence, change these values and restart or redeploy. No code changes are needed, and the QR code
stays the same. Each record stores the target and radius that were in effect, so historical records stay auditable.
A verification issued before a move is re-checked against the new location at check-in.

### 3. Database
```bash
docker compose up -d        # PostgreSQL 17 on localhost:5433
npm run db:migrate          # applies database/schema.sql (idempotent)
```

Schema (`database/schema.sql`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `name` | text | employee name, 2–100 chars |
| `designation`, `institution` | text | check-ins; length `CHECK`s |
| `email` | text | check-ins; stored lower-case |
| `mobile` | text | check-ins; E.164 (`^\+[1-9][0-9]{7,14}$`) |
| `department`, `member_id` | text | earlier registrations only (nullable) |
| `verification_id` | uuid `UNIQUE` | the server-issued location verification used (one check-in each) |
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
| `created_at` | timestamptz | check-in time |

Constraints:
- `status_matches_distance` enforces `(status = WITHIN_RANGE) ⇔ (distance_m ≤ radius_m)`.
- `record_kind_complete` requires each row to be either an earlier registration (department + ID), or a complete
  check-in (all five employee fields plus a verification ID) that is `WITHIN_RANGE`.

Indexes: `created_at DESC`, `(geofence_status, created_at DESC)`, `institution`, `email`, `department`, `member_id`.
A second table, `used_verifications` (`verification_id` PK, `expires_at`), records every location verification that
has been used, until it expires. It sits outside `submissions`, so **Clear All Data** (which empties `submissions` only)
can't make a used verification valid again. Expired rows are pruned automatically.

A third table, `admin_audit_log` (`at`, `actor`, `action`, `details`), permanently records destructive admin actions.
**Clear All Data** empties `submissions` with a plain `DELETE`, in the same transaction as its audit entry (actor +
number of records), so both happen or neither does. It deliberately avoids `TRUNCATE`, which needs a table-exclusive
lock that would queue behind any open read and block every check-in in the meantime. A `DELETE` only takes row locks,
so check-ins and the dashboard keep working while it runs. The dashboard shows who last cleared the data, and when.

The migration is additive and idempotent. Existing rows are untouched, and `npm run db:migrate` upgrades an existing
database in place.

#### Test data (optional)
```bash
npm run db:seed                  # 40 check-ins + 8 older-style registrations
npm run db:seed -- --reset       # replace previously seeded data (identical data every time)
npm run db:seed -- --count=100   # a different number of check-ins
npm run db:seed -- --remove      # remove seed data only
```
The data is realistic but clearly fake:
- names at local institutions, `@example.com` emails and `+91 90000 xxxxx` mobile numbers
- check-ins spread over the last week, some near the 100 m edge and some flagged low-accuracy
- older-style department/ID records, half of them outside the geofence

Distances are computed with the app's own geofence code for the configured `TARGET_*`. Seed rows are tagged
(`user_agent = seed-script`), so `--reset` and `--remove` never touch real records. The script **refuses to run
against a non-local database**, so test data can't reach production.

### 4. Create the admin account
```bash
npm run hash-password -- "a-long-unique-password"
# → ADMIN_PASSWORD_HASH=scrypt:16384:8:1:...   paste into .env.local

node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# → paste as SESSION_SECRET
```
Set `ADMIN_USERNAME` too. Changing the password means generating a new hash. Rotating `SESSION_SECRET`
signs out every session.

**Additional administrators** (for example the `master` account) are listed in `ADDITIONAL_ADMINS`:

```bash
npm run hash-password -- "<a long random password>"
# → set ADDITIONAL_ADMINS=master=scrypt:16384:8:1:...   (several: user1=<hash>;user2=<hash>)
```

- Every account gets the same `admin` role, so each has exactly the same access: the dashboard, records, search,
  filters, the map, CSV export and the QR code page. They all sign in on the same `/admin/login` page.
- Sessions record the username and role. On every request, the server checks the role and checks that the
  username is still a configured admin. Removing an account from the environment therefore revokes its sessions
  at once.
- In production, store `ADDITIONAL_ADMINS` as a Vercel **Sensitive** variable. Store only hashes, never passwords,
  and never commit them.
- To change an account's password, generate a new hash and update the variable. There is no self-service
  "change password" screen, because accounts live in configuration rather than a database.

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
npm run test:db        # optional: database integration tests (see below)
npm run typecheck
npm run lint
```

The test suite covers:
- **Case 1:** at the target → `WITHIN_RANGE`
- **Case 2:** ~50 m → `WITHIN_RANGE`
- **Case 3:** ~100 m (boundary, four bearings) and 99.9 m → `WITHIN_RANGE`
- **Case 4:** 100.02 m, 101 m, 287.4 m → `OUTSIDE_RANGE`
- **Case 5:** invalid latitude/longitude (out of range, NaN, ∞, strings, missing) → validation error
- Attendance flow:
  - Inside 100 m → verification issued (form available). Outside → none issued (form blocked).
  - Distances are measured from the Principal's office: the first target (~180 m away) is outside, the previous one (34.72 m) inside.
  - Poor accuracy, stale fixes and invalid coordinates are rejected.
- Check-in:
  - Stored with the server-computed distance.
  - Refused without a verification, or with a tampered, foreign or expired one.
  - Forged status, distance or coordinates are ignored.
  - Re-checked against a moved geofence.
  - A verification can be used only once.
  - Invalid name, designation, institution, email or mobile is rejected.
- Mobile number normalization (Indian and international), QR SVG path
- Password hashing, session-token tampering/expiry, rate limiter, DB connection options

**Database integration tests** (`npm run test:db`) run against a real, disposable PostgreSQL database. Set
`TEST_DATABASE_URL` in `.env.local`, for example `postgres://geofence:geofence@localhost:5433/geofence_test` with the
Docker database. The test creates the database if needed and rebuilds its schema, so it refuses anything but a local
host with a database name ending in `_test`. The tests cover:
- storing a check-in and single-use verifications
- replay protection surviving Clear All Data
- Clear All Data's exact count, audit entry and all-or-nothing behaviour
- a regression test that Clear All Data never waits on concurrent readers (which is what `TRUNCATE` would do)

They use their own config (`vitest.db.config.mts`). `npm test` never runs them and needs no database. Without
`TEST_DATABASE_URL`, `npm run test:db` skips them.

---

## Deployment (Vercel + Neon Postgres)

**Live:** https://geofence-attendance-eta.vercel.app (admin: `/admin`)

Current setup:
- Vercel project `geofence-attendance` (Hobby plan). `vercel.json` pins functions to `sin1` (Singapore).
- Neon Postgres (free plan) in `ap-southeast-1` (Singapore), provisioned through the Vercel Marketplace and
  connected to the **Production and Preview environments only**. Development has no database variables, so
  `vercel env pull` / `vercel dev` can never point local work at the live database. Local development uses
  Docker Postgres from `.env.local`.
- The app connects to Neon over TLS **with certificate verification** (`verify-full`, see `lib/db-options.ts`).
- `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` are Vercel *Sensitive* variables. Only Production and Preview
  can hold them. A default (Development) pull leaves them out, and a Production/Preview pull gives an empty
  value, so keep your local copies in `.env.local` (see "Create the admin account").
- Deploys are made from the CLI (`vercel deploy --prod`). The GitHub repo is intentionally **not** connected
  for automatic deploys. With `npm run autopush` pushing every minute, a connected repo would start a production
  deploy per push (up to about 1,400 a day, against the Hobby plan's 100-a-day limit) and put unreviewed work in progress live.

To set it up from scratch (CLI, without connecting the Git repo):

1. Install the CLI and link the project: `npm i -g vercel`, `vercel login`, then `vercel link --yes`.
   Don't use **Import** at vercel.com/new; that connects the repo for automatic deploys (see above).
2. Provision Neon for Production and Preview only:
   `vercel integration add neon -m region=sin1 --plan free_v3 --no-env-pull -e production -e preview`.
   This adds `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and related variables.
3. Add the app variables (`TARGET_*`, `GEOFENCE_RADIUS_METERS`, `ADMIN_USERNAME`, `DISPLAY_TIMEZONE`, …)
   with `vercel env add <NAME> production`. Add `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` with `--sensitive`.
4. Run the migration against the production database. The connection string is read from a file and never
   put in your shell or its history. The same commands work in bash, PowerShell and cmd:
   ```bash
   vercel env pull .env.vercel-production --environment=production --yes
   npm run db:migrate -- --env-file=.env.vercel-production   # uses DATABASE_URL_UNPOOLED
   ```
   Then delete `.env.vercel-production` (`rm` / `del`). It is git-ignored, and Next.js never loads a file with that name.
   Don't pull production values into `.env.local` or `.env.production.local`, or local runs will write to production.
5. Deploy with `vercel deploy --prod`. Vercel serves over HTTPS automatically, which geolocation requires.

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
- **The server is authoritative; the QR code is not a security control.** Distance and status are computed on the
  server, both when the location is verified and again at check-in. The check-in request can't carry coordinates,
  distance or status. Coordinates come only from an HMAC-signed, 10-minute, single-use verification, whose signing
  key is separate from the admin-session key. Knowing the attendance URL is not enough: without an in-range
  verification, no form is shown and the API refuses the check-in. DB constraints back this up.
- **Validation.** Zod schemas: length limits, allowed character sets, email format, mobile numbers (E.164),
  lat ∈ [-90, 90], lon ∈ [-180, 180], finite numbers, accuracy ≤ ±150 m, GPS-fix age ≤ 2 min.
  Bodies are capped at 4–8 KB and must be JSON. All SQL is parameterised.
- **Admin protection.**
  - `proxy.ts` redirects unauthenticated requests, and every admin page, action and route re-checks the session (defense in depth).
  - Passwords are hashed with scrypt, and credentials are compared in constant time. Every admin account (primary
    and `ADDITIONAL_ADMINS`) has the `admin` role. That role and the account's continued existence are
    verified server-side on every admin page, action and API route.
  - Sessions are HMAC-SHA256-signed with an 8 h expiry, in an `HttpOnly` + `SameSite=Strict` cookie that is `Secure` in production.
  - Login is rate limited (5 attempts / 15 min per IP), and the dashboard is `noindex`.
- **Database connections to remote hosts use TLS with full certificate and hostname verification.**
- **Secrets** live only in environment variables. `.env*` is git-ignored except `.env.example`, which holds
  no secrets. The workplace coordinates stay on the server. The attendance page receives only the radius.
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
  The static QR code is deliberately not treated as proof of presence, since a photo of it works anywhere.
- **GPS accuracy varies.** Indoors or on desktop (Wi-Fi/IP positioning), accuracy can be tens to hundreds of meters.
  Fixes worse than ±150 m are rejected (with advice to enable precise location or move near a window), and fixes worse
  than ±50 m are accepted but flagged *low accuracy*. On iPhone, *Precise Location* must be on for Safari.
- **Rate limiting is in-memory**, so it applies per server instance. The limits are deliberately generous, because an office's
  staff often share one public IP. For strict global limits use a shared store such as Upstash Redis.
- **Repeat check-ins are allowed.** The same person can check in more than once (for example, on several days, or
  twice by mistake). Each check-in needs its own fresh in-range verification. Search by email or mobile in the
  dashboard, or add a unique constraint per person per day if you need exactly one record.
- **Admin accounts are configuration, not data.** Adding, removing or re-keying an admin means editing
  `ADMIN_*` / `ADDITIONAL_ADMINS` and redeploying. There is one role (`admin`). Finer-grained roles or
  self-service password changes would need a users table or an auth provider.
- **The map uses public OpenStreetMap tiles.** Fine for low admin traffic. Use a tile provider for heavy usage.
