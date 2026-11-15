# Hosting the standalone LogisticsNerd application

This deployment keeps the existing six-page Vite interface, deterministic rules,
Node provider adapters and private FastAPI business/purchasing/fulfillment API.
It is separate from the OperationsNerd application and its databases.

The current deployment enables a **public shared fictional demo without login**.
The gateway also retains an optional protected owner mode when HOST_PUBLIC_DEMO is false.
That protected mode uses one configured owner password, separate from Supabase Auth. Creating an employee
record does not create an account. There is no public signup or multiuser role
administration. Use a separate deployment for another business.

## Process and network layout

`npm run build:production` builds the six Vite HTML entrypoints into `dist/` and
bundles the production Node entrypoint/shared TypeScript rules into
`dist-server/server.mjs`. Vite is a build dependency, not the production server.
Local `npm run dev` and `npm run preview` retain their loopback behavior.

`npm start` supervises two processes:

- The Node gateway listens on `0.0.0.0:$PORT` (default 8080), serves built pages,
  authenticates the owner and runs the existing provider middleware.
- Uvicorn listens only on `127.0.0.1:8001`. The gateway forwards authenticated
  business/purchasing/fulfillment requests with a private service token. Client
  Authorization/cookies are not forwarded to that API.

Stopping either process stops its companion. The container uses `tini` for child
reaping and runs application processes as the unprivileged `node` user. A small root-owned entrypoint opens only `/app/backups` with no symlink following, sets that mount to UID 1000/mode 0700, then permanently drops groups/GID/UID before executing the application. It never recursively changes data or runs application code as root. PostgreSQL and Redis are separate
private services with durable storage. Only the gateway is a public application
endpoint. Use this application's own self-hosted Supabase stack; do not point it
at OperationsNerd's private databases.

See [self-hosted Supabase deployment](self-hosted-supabase.md) for the
database/service overlay and Render deployment. Provisioning and account credits
are separate from building this image; this code does not create paid resources.

## Required private environment

Configure these through hosting secrets or a private, ignored environment file:

| Variable | Meaning |
| --- | --- |
| `APP_ORIGIN` | Exact public HTTPS origin, e.g. `https://your-app.example`; no path, query or trailing content. HTTP is accepted only for loopback verification. |
| `HOST_OWNER_PASSWORD` | Random owner password of at least 24 characters. Store it in a password manager. |
| `HOST_SESSION_SECRET` | Independent random signing secret of at least 32 characters. |
| `LOGISTICS_API_TOKEN` | Independent random token of at least 32 characters; gateway to private Python API only. |
| `LOGISTICS_DATABASE_URL` | Direct connection URI for this business's private app database inside its Supabase PostgreSQL service. |
| `LOGISTICS_BUSINESS_KEY` | Stable business identity checked against the database on each API connection. |
| `LOGISTICS_ACTOR_REF` | Stable server-controlled owner actor reference provisioned below. |
| `REDIS_URL` | Private Redis TCP URL; use `rediss://` when crossing a network that requires TLS. |

Optional variables:

- `PORT` defaults to 8080. `APP_ROOT` defaults to the working directory and is
  `/app` in Docker. `WORKFLOW_DEMO_PYTHON` points to the production Python runtime.
- `HOST_ENABLE_AI=false` and `HOST_ENABLE_CARRIERS=false` are the defaults, even
  if provider credentials happen to be present. Enable deliberately only after
  authorizing the provider's usage and cost. Disabled keys are not supplied to
  the provider adapters. Direct estimate/carrier POSTs are rejected.
- `HOST_ENABLE_DEMO=true` is the default. The fictional workflow demo uses one
  in-memory Python fixture shared by this owner's sessions. It is separate from
  the persistent business records and resets after process restart. Set false
  to disable it. Its AI actions remain disabled unless AI is enabled explicitly.
- Enabled AI uses existing server-only Baseten model keys/order and Redis.
  Enabled carrier comparison uses the existing provider keys and enable flags.
  No provider credential belongs in a `VITE_` variable or in browser storage.

Keep `APP_ORIGIN` aligned with the final hosting URL. The gateway rejects other
Host/Origin values and does not trust client-provided forwarding headers. TLS may
terminate at the hosting ingress; configured HTTPS still yields Secure cookies
and correct origin checking. Health endpoints are exempt from public Host checks
so private container health probes can reach them.

## Initialize explicitly before the first healthy deployment

Create a fresh dedicated application database and constrained role using the
self-hosted Supabase setup. Do not use an existing real database as a test fixture.
The current business-record feature creates typed tables at runtime, so its role
needs creation privileges inside its own `logistics` schema. It needs no access
to Supabase Auth/Storage schemas. Do not expose `logistics` through the Data API.

Using the image and the same private environment/network as the app:

```sh
python -m logistics_persistence.migrate --backup-dir /app/backups
python -m logistics_persistence.hosting bootstrap-owner
python -m logistics_persistence.hosting ready
```

Migration makes a private export first, checks immutable migration history and
sets/verifies business identity. Mount `/app/backups` on private durable storage
writable by container UID 1000, or use a deliberate one-off backup destination.
The image includes PostgreSQL17 client tools; `PG_MAJOR` is a build argument for
a compatible newer server. Bootstrap creates only an owner actor binding with
purchasing approval permission. It does not create sample suppliers, orders or
stock, and refuses to silently escalate an existing unprivileged actor.

`HOST_BOOTSTRAP=1` permits the first start to initialize a database only when its `logistics` schema does not exist, then provision its owner. On subsequent starts it verifies identity, exact history and owner without modifying them. An existing incomplete or outdated schema is refused and requires the explicit backed-up migration/bootstrap commands above. The Render overlay opts into this fresh-only path. Without the flag, startup never initializes a database. In particular, do not use
`seed --demo` as production onboarding. After bootstrap, the owner logs in and
uses the normal Business setup & records page.

## Login, sessions and request safety

Unauthenticated pages redirect to `/auth/login`; APIs return401. A valid owner
password creates an opaque, signed, server-held session lasting at most 8 hours.
Cookies are HttpOnly, SameSite=Strict, path-scoped and Secure on HTTPS. Sessions
are bounded and live in gateway memory: restarting or replacing the single app
instance logs the owner out. Use one app instance; replicas do not share sessions.

The gateway injects its own synchronous session helper before the Vite modules.
It attaches a per-session CSRF token only to same-origin operational writes.
Writes also require the exact configured Origin. Logout revokes the server-held
session. Password guessing is bounded per direct socket address and globally;
untrusted `X-Forwarded-For` cannot bypass it. Optional provider/demo POSTs are
limited to 10 per minute per owner session. Existing provider concurrency/cache
limits remain in force. These are safeguards, not a substitute for provider
spending limits or credit verification.

The browser never receives the database URL, service token, session signing key
or provider keys. Provider configuration/error responses remain sanitized.
The owner login is separate from the server-to-server API token: possession of
the latter does not authenticate a public gateway request.

## Health, build and verification

`GET /healthz` checks the gateway process. `GET /readyz` calls the authenticated
private Python readiness endpoint, which opens the actual database, verifies its
business identity, exact deployed migration checksums and provisioned owner.
It returns only `{ready:true|false}` publicly and makes no external provider call.

```sh
npm run test:hosting
npm test
npm run build:production
.venv/bin/python scripts/test-postgres.py -p test_hosting.py
docker build -t logisticsnerd-hosted:local .
```

Run database tests only against their disposable local harness. Deployment smoke
checks should include anonymous rejection, real login, a CRM write through the
injected CSRF helper, logout, denied cross-origin/CSRF writes, all six pages,
disabled AI/carrier actions, readiness failure and persistence after app restart.

The existing app backup covers `public` and `logistics`, not the entire Supabase
Auth/Storage stack. Keep full-stack recovery backups and secret rotation plans
with the self-hosted deployment. Roll back an app image separately from data;
do not overwrite immutable applied migration files or restore over a live database.

## Public standalone demo (current deployment choice)

The standalone deployment sets `HOST_PUBLIC_DEMO=true`. Visitors open the app without a login and share fictional business records. A temporary browser session supplies CSRF protection; it is not a user account. Service/database tokens remain server-only. Paid AI and carrier providers must remain disabled in this mode. The combined OperationsNerd app retains its existing account login and separate business databases. An account may own several businesses; a database is not a login.
