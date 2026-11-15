# Hosted demo status — 2026-11-15

URL: https://logisticsnerd-demo.onrender.com
Render service: srv-dbt2ulei0phs73ehscs0
Verified live deployment: dep-dbt2vnl6e07s73b9jkcg
Runtime source commit: 7be2d8f

Hosting: Render Free web service. Database and private backup storage: separate Neon Free project for this app. No paid instance, Supabase cloud stack, workspace upgrade or external AI/carrier provider was enabled. Free usage quotas and cold starts apply. This is a demonstration deployment, not a security or production sign-off.

Authentication: public shared fictional business data with no login; internal API/database credentials remain server-only.

Validation: 90 PostgreSQL tests, 300 UI/server tests and 8 gateway tests including no-login mode.
Both final container images built and ran without root, using a valid application HOME for TLS. Direct Neon connections verify the certificate using the Linux CA bundle. Each app uploaded and retrieved a real PostgreSQL archive from its own private object bucket. Integration additionally verified an isolated restore without changing the live demo.

Public HTTPS verification: a real Chromium browser logged into the combined app with the earlier credentials and opened all six standalone pages without login; no JavaScript exceptions were observed. The hosted integrated toy-shop flow passed mappings, core records, explicit purchase approval, two partial receipts, two shipments, delivery tracking, dispatch replay and denial of another account's access.

External chat/AI and carrier calls remain disabled. The standalone fixture workflow is in memory and separate from its persistent business records. Local Supabase Docker files remain available as a separate development fallback. Category constraints, actual carrier/label services and local-model privacy acceptance retain their previously documented limits.

Auto-deploy is off. A later source push does not automatically replace these live instances. A manual redeploy preserves Neon data and private archives, while local files and in-memory sessions reset. Backup storage is in the same Neon project, not an independent disaster recovery provider.

Render services were created through the connected API and currently use the platform default TCP health check. The standalone /readyz endpoint was separately verified over public HTTPS. The reproducible Blueprint specifies an HTTP health path for future Blueprint-based provisioning.
