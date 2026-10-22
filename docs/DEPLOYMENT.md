# Local containers and a reviewed Lightsail deployment

This is a **single-user deployment scaffold**, not a deployed or production-accepted service. Nothing here provisions AWS resources automatically. No real credentials, transcripts, certificates, or Terraform state belong in Git. A draft PR does not authorize `terraform apply`, DNS changes, server setup, or paid provider tests.

For the repeatable immutable-release, UUID storage and encrypted scheduled-backup workflow, use [OPERATIONS.md](OPERATIONS.md). Its operations commands supersede the manual release/backup examples below; the architecture and acceptance boundaries still apply.

## Boundaries

- `make dev` remains a loopback-only native development path, with `backend/.env`.
- `compose.yaml` runs the built web client at `http://127.0.0.1:4317` and the API at `http://127.0.0.1:4318`. Do not run it alongside `make dev`; report port conflicts instead of killing other applications. PostgreSQL has no published host port.
- `compose.production.yaml` is a **standalone file**, not a local override. Never combine it with `compose.yaml`, because Compose merges published ports.
- Production publishes only Caddy's HTTP redirect/ACME port 80 and HTTPS port 443. Static assets and `/api/*` share one HTTPS origin. Caddy preserves `Host` and `Authorization`; the API ignores forwarded headers, requires its exact configured Host, checks browser Origin, and authenticates API routes.
- Production authentication is one HTTP Basic account over HTTPS with a separate, random password of at least 32 characters. It is a bootstrap single-owner boundary, not multi-user account management, per-device revocation, MFA, or brute-force protection. The web client uses browser authentication; do not embed credentials in frontend bundles, URLs, localStorage, or native source. The iOS scaffold has a transient, memory-only Basic-auth health check; durable credential storage would require a future Keychain-backed implementation. Native requests without an Origin header are allowed only with the exact Host and valid credentials. Device acceptance remains pending.
- One API process owns session handles and history reservations. Do not add Uvicorn workers, scale the service, or route requests to multiple replicas. End active calls before restarts; no zero-downtime session handover is provided.
- The primary database is PostgreSQL 17 on the pgvector image. The dedicated `voxa` role is not a superuser. Initialization enables the vector extension, but this does **not** implement embedding generation or semantic retrieval.
- `OPENAI_API_KEY` stays on the backend. The browser still exchanges live audio directly with the provider; hosting the archive does not make voice offline.

## 1. Run locally with Docker Compose

Prerequisites: Docker Engine/Desktop with Compose v2 and available loopback ports 4317/4318. From the repository root:

```sh
cp .env.example .env
chmod 600 .env
```

Generate independent values for `POSTGRES_PASSWORD` and `VOXA_DB_PASSWORD` using `python -c "import secrets; print(secrets.token_hex(32))"` and put them in `.env`. Keep these passwords hexadecimal: the application password is interpolated into `DATABASE_URL`, so URL-reserved characters require an adapted, correctly escaped URL. The fresh-database initializer rejects a nonhexadecimal application password or fewer than 32 characters. The two database passwords serve different roles: administrator and least-privileged app. Do not reuse the authentication or provider credential.

`OPENAI_API_KEY` may be empty for local health/storage checks. Real voice and summaries require a valid server key and incur provider usage. Root `.env` is for Compose only; copying it does not modify `backend/.env`.

```sh
docker compose config --quiet
docker compose up --build -d --wait
docker compose ps
curl --fail http://127.0.0.1:4318/healthz
curl --fail http://127.0.0.1:4317/api/health
```

Visit `http://127.0.0.1:4317`. Local database and Caddy state use named volumes. `docker compose down` preserves them; **do not add `--volumes` / `-v`** unless deliberately discarding the entire local archive. The CI workflow uses `--volumes` only for its synthetic, disposable database.

`make database` starts the PostgreSQL container only. Inspect it through `docker compose exec postgres psql -U postgres -d voxa`; the default file intentionally does not expose it to native host code. For the opt-in native development loop, `make database-dev` combines `compose.yaml` with `compose.dev.yaml` and publishes PostgreSQL at **127.0.0.1:54329 only**. Set the corresponding `DATABASE_URL` in `backend/.env`, then use `make dev`; follow the [README](../README.md) commands. Never combine `compose.dev.yaml` with production or bind its database port publicly.

Database initialization scripts run only on a fresh data directory. Editing `.env` does not rotate an existing database role's password. Coordinate an actual SQL password rotation and backend restart separately, after backing up; do not delete a volume to reset a credential.

The backend applies its versioned application schema before serving. An unreachable database must fail startup rather than silently create SQLite. The existing native SQLite archive is not automatically uploaded or migrated; use the explicit database migration procedure in [DATABASE.md](DATABASE.md), when applicable.

## 2. Review infrastructure without provisioning

`infrastructure/lightsail/` declares one IPv4 Lightsail instance, an existing SSH key name, a static IPv4 address, an attached persistent disk, instance automatic snapshots, and firewall rules. There are no generated credentials, provisioners, remote-exec, cloud-init scripts, package installs, or application deployment.

Required decisions before proceeding:

1. AWS account, region/availability zone, current Linux blueprint and bundle. Review the actual instance, disk, snapshot, static-IP and traffic costs in that account. There is deliberately no default bundle. Allow enough RAM for the API, database and Node image build; an undersized instance can exhaust memory while building.
2. An existing **Lightsail** SSH key pair in that region and exactly one administrator public IPv4 `/32`. The variable rejects broad ranges and IPv6 SSH rules. This scaffold does not create, import, or store any SSH private key.
3. A domain you control, an A record pointing to the static IP, an ACME contact email, and a reviewed backup/retention destination. IPv6 is disabled; do not add an AAAA record for this scaffold.
4. An already-authorized AWS CLI profile or workload identity. Do not put AWS credentials or application secrets in `.tfvars`, Terraform arguments, outputs, or user data.

Read-only availability inspection, using that authorized identity:

```sh
aws lightsail get-regions --include-availability-zones
aws lightsail get-blueprints
aws lightsail get-bundles
```

Copy `terraform.tfvars.example` to ignored `terraform.tfvars` and replace every placeholder. Then, on a machine with Terraform installed:

```sh
terraform -chdir=infrastructure/lightsail fmt -check
terraform -chdir=infrastructure/lightsail init -backend=false
terraform -chdir=infrastructure/lightsail validate
```

The committed `.terraform.lock.hcl` selects the reviewed provider version and signed checksums; it contains no credentials. Review lock changes when upgrading. Choose a protected state backend before real provisioning. Local state, saved plans, and `.tfvars` are private operational artifacts, not PR attachments. A `plan` against the intended account is the next human review gate. **Do not apply until cost, identity, security rules and the plan are explicitly approved.** No apply is part of this scaffold.

`prevent_destroy` guards the instance, static IP and data disk while their resource blocks remain in configuration. It is not a backup, does not protect deletion through AWS directly, and does not make configuration removal safe. Replacement, teardown or disk resize requires a separate reviewed migration plan.

## 3. Prepare storage before starting production

After separately authorized provisioning, verify the Lightsail firewall has only TCP 22 from the chosen `/32` and TCP 80/443 publicly. Verify this before installing the app or copying secrets. Lightsail's initial instance defaults and the Terraform firewall resource are not an atomic operation; a failed apply may leave default rules behind. No API 4318 or database 5432 should be exposed. Docker-published ports can bypass host UFW rules, so the absence of those Compose ports is intentional.

Install Docker/Compose using [Docker's official Ubuntu repository instructions](https://docs.docker.com/engine/install/ubuntu/), not an unattended convenience-script pipe. Review OS patches and SSH access separately. Docker group membership grants broad host control.

The extra disk is **not formatted or mounted by Terraform**. Inspect `lsblk -f` and the AWS attachment before any filesystem operation. The requested `/dev/xvdf` can appear under a different name on the guest. Never format a device based only on that requested name.

Have an operator initialize only a confirmed new, empty disk, mount it at `/srv/voxa`, and persist the mount by its filesystem UUID. A restored disk must be mounted without formatting. Configure boot to require this mount, not silently fall back to an empty root-disk directory. Then create private directories:

```sh
mountpoint /srv/voxa
sudo install -d -m 700 /srv/voxa/postgres /srv/voxa/caddy-data /srv/voxa/caddy-config /srv/voxa/backups
```

PostgreSQL's official entrypoint sets the database directory's owner. Caddy's container writes only its dedicated state directories. The backend runs as unprivileged UID 10001 with a read-only root filesystem and no persistent credential or archive files.

Docker's restart policy can restart containers before a separate disk is mounted. On this dedicated host, add a reviewed systemd Docker service drop-in:

```ini
[Unit]
RequiresMountsFor=/srv/voxa
```

Reload systemd and verify the mount dependency and a controlled reboot before storing real data. This changes host service behavior and is an operator step, not an automatically executed script. `infrastructure/bin/production-compose.sh` additionally refuses commands when `/srv/voxa` is not a mountpoint or expected directories are missing. Use it for routine production operations; the wrapper does not replace the boot dependency.

The instance's automated snapshot covers the system disk, **not a replacement for data-disk snapshots**. Enable and verify separate automatic snapshots for the attached data disk, with reviewed costs and retention, through AWS's supported console/CLI flow. The Terraform disk resource does not configure these. Follow [AWS's automatic-snapshot documentation](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-configuring-automatic-snapshots.html). Keep independent logical database backups as well.

## 4. Configure and validate production

Copy only reviewed source to the host. Keep `.env` outside image build contexts via `.dockerignore` and mode 600 on disk. The backend receives credentials at container runtime; Docker administrators can still inspect them. Do not print `docker compose config` without `--quiet`, full container environments, or provider requests into logs/support messages.

Set all root `.env` values, including:

- `VOXA_PUBLIC_ORIGIN=https://your-reviewed-hostname`, with no trailing slash and the usual HTTPS port 443. The sample `example.com` address is not usable.
- `ACME_EMAIL`, `VOXA_AUTH_USERNAME` (1–64 letters, digits, `.`, `_` or `-`), and a random, independent `VOXA_AUTH_PASSWORD` (32–256 nonspace printable ASCII characters, at least 12 distinct characters). The generated 64-character hex password is suitable; don't use repeated-character fixtures in production.
- Both independent database passwords and the real `OPENAI_API_KEY`.

Before live use, review vulnerability scans and pin the reviewed base images to immutable digests. Tagged Python/Node images follow a supported major line; the uv, Caddy and pgvector tags are versioned but tags are still mutable. Dependency lockfiles are used during builds.

```sh
docker compose --env-file .env -f compose.production.yaml config --quiet
sh infrastructure/bin/production-compose.sh build
# Syntax/provisioning check only; does not start the public web listener.
sh infrastructure/bin/production-compose.sh run --rm --no-deps web \
  caddy validate --config /etc/caddy/Caddyfile
```

Starting the production stack, obtaining certificates and opening it to the network is a **separately approved deployment step**, not evidence supplied by this PR. After that approval, use the wrapper with `up -d --wait` and inspect `ps`. Caddy obtains/renews certificates using the configured domain and durable `/data`; never bypass certificate warnings or use a self-signed fallback for public use.

Required acceptance before treating the service as usable:

- HTTP redirects to the correct HTTPS domain; HTTPS has a valid certificate.
- Unauthenticated `/api/health` and archive routes return 401. Correct credentials work. Wrong credentials fail. The static app shell itself is public and contains no archive data or secret.
- Cross-origin browser API requests and a wrong `Host` are rejected; no wildcard CORS is introduced. The minimal backend `/healthz` is unauthenticated but not exposed by Caddy.
- Only 80/443 and the restricted SSH path are externally reachable. Caddy's internal port 2015, the API, and PostgreSQL are not exposed.
- PostgreSQL reports extension `vector`, application schema creation succeeds under the nonsuperuser role, and a synthetic archive survives a container restart.
- A backup is restored and verified in a separate database before any real archive migration.
- Foreground web/iPhone microphone permission, WebRTC audio, authentication, interruptions, final transcript saving, Bluetooth behavior and recovery after a dropped connection are tested separately. A passing HTTP health probe establishes none of these.

Rotate the shared Basic password and restart the API if a device loses access; the scaffold has no per-device sessions/logout. Browser authentication caching behavior needs device testing. Do not expose this single-account bootstrap as a multi-tenant service.

## 5. Backup and restore

The 30-day transcript retention policy still applies to the live archive. Backup copies can retain deleted/expired text longer, so define their separate retention and deletion policy. Dumps and disk snapshots are private user data. Never commit, publicly link, or upload them to an unapproved destination.

After an authorized production setup, run:

```sh
sh infrastructure/bin/backup-postgres.sh
```

This makes a consistent PostgreSQL custom-format logical dump with mode 600 under `/srv/voxa/backups`. It preserves original object owners (`voxa` for application tables, `postgres` for the extension); it does not contain PostgreSQL role passwords or provider credentials. It does contain private archive content. Encryption and an independently recoverable off-host copy are **required operational steps not automated here**. A file on the same data disk alone is not disaster recovery.

Back up Caddy's `/srv/voxa/caddy-data` and the protected application configuration separately using an encrypted, approved process. Caddy data contains certificate private keys. Do not place secret values in backup logs or passphrases in shell arguments. Choose a backup schedule, failure alerts, recovery point objective and periodic restore tests before deployment; no scheduler or storage account is created by this scaffold.

Test a dump on an isolated PostgreSQL 17/pgvector instance with the same `postgres` and nonsuperuser `voxa` roles. The following example creates a **new test database only**, not an in-place restore:

```sh
sh infrastructure/bin/production-compose.sh exec -T postgres \
  createdb -U postgres voxa_restorecheck
sh infrastructure/bin/production-compose.sh exec -T postgres \
  pg_restore -U postgres --exit-on-error -d voxa_restorecheck < /path/to/reviewed-backup.dump
sh infrastructure/bin/production-compose.sh exec -T postgres \
  psql -U postgres -d voxa_restorecheck -v ON_ERROR_STOP=1 \
  -c "SELECT extversion FROM pg_extension WHERE extname = 'vector';"
```

The installed image includes `voxa-db status` (no uv invocation is needed in the runtime image). For an ordinary live schema/extension status check, use `sh infrastructure/bin/production-compose.sh exec -T backend voxa-db status`. A restored test database needs an explicitly configured test `DATABASE_URL` instead; do not print a credential-bearing URL in shell history or logs. Status reports metadata and connectivity only, not archive completeness.

For a recovery drill, prefer executing equivalent commands on the isolated instance rather than the live server. Do not use `--clean`, `dropdb`, or overwrite a live database. The restore must preserve owners; do not add `--no-owner` unless also implementing and verifying an explicit ownership transfer. Inspect application schema/revision, row counts, representative synthetic conversation/category/summary relationships and read access as `voxa`. Keep the source backup unchanged. Delete the disposable test database only after an explicit decision.

A real cutover needs a maintenance window: end calls, stop writers, take a final backup, restore into a new database, validate, switch the runtime URL, then restart one API process. Keep the previous database untouched for rollback. A rollback to older application code is not automatically schema-compatible. Do not copy a running PostgreSQL data directory as a logical backup; do not upgrade its major version by merely changing the image tag.

## Verification status

The infrastructure CI workflow is designed to validate Compose configuration and Caddy syntax, build both images, smoke-test an isolated local stack, check production startup/auth/Origin enforcement against that PostgreSQL instance, and run Terraform format/init/validate. It uses synthetic credentials/no provider key and no AWS credentials or apply. Its existence is not evidence that it has run.

Local checks on October 20, 2026 used temporary official tools verified against their published checksums: Compose 5.6.0, Caddy 2.11.7 and Terraform 1.16.6. Passed: all three Compose configurations (local, opt-in native development, standalone production), both Caddy validations, YAML parsing, shell syntax, rendered production network-safety assertions, mount-wrapper refusal without the disk, Terraform formatting, and credential-free provider initialization. Initialization produced the signed AWS provider 6.69.1 lockfile.

Local `terraform validate` was blocked by the workspace's Unix-socket restriction, but the initial GitHub Actions run subsequently **passed full Terraform validation and both image builds**. That run then found Caddy's inherited executable file capability incompatible with the local container's empty capability bounding set. The web image now removes and verifies removal of that file capability at build time. Compose still drops all capabilities locally, grants only `NET_BIND_SERVICE` in production, and retains `no-new-privileges` and the read-only filesystem.

The corrected container startup and production ASGI/PostgreSQL smoke check await a fresh CI result. There is no Docker daemon in this workspace; DNS/TLS, host mount/reboot, backup restoration and live voice also remain unperformed. No Terraform plan/apply or paid deployment was performed. Record actual CI/manual results in [PLANS.md](PLANS.md) before changing that status.

### References

- [Terraform AWS Lightsail instance](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lightsail_instance), [firewall](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lightsail_instance_public_ports), [disk attachment](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lightsail_disk_attachment).
- [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [uv Docker integration](https://docs.astral.sh/uv/guides/integration/docker/), [pgvector image and extension](https://github.com/pgvector/pgvector#docker).
