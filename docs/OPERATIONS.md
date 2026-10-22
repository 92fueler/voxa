# Reviewable deployment for voxa.lakechabotlabs.ai

Status: local deployment preparation only. No AWS resources, credentials, DNS records, production secrets, or personal-data migration were created. OpenAI remains the provider; Bedrock is excluded. Existing local development commands and ports are unchanged.

This runbook supersedes the manual release/backup commands in DEPLOYMENT.md. The architecture, authentication limitations, database import procedure and live acceptance gates in that document still apply. Use Docker Engine 28+ (platform-selectable image inspect/save), Compose v2 and Python 3.12+ on the Linux host (build-release.py requires Python 3.11+). Do not run host setup commands on the development Mac.

## Proposed scope and costs for approval

Use one Linux **amd64** Lightsail VM in **us-east-2**, one same-AZ 32 GB data disk, attached static IPv4, daily instance and separate data-disk snapshots, and one private Lightsail object bucket for encrypted dumps. No managed database, load balancer, NAT, CDN, multiple API processes or Kubernetes is needed for this single owner.

Planning estimate before credits: 4 GB/2 vCPU IPv4 VM $24/month + 32 GB disk $3.20 + illustrative 20 GB billed snapshot storage $1 + 100 GB object bucket $3 = **$31.20/month gross**. Snapshot storage is variable; this is not a cap. Transfer overages, taxes, domain, recovery resources and OpenAI voice/transcription/summary charges are additional. A 2 GB VM saves $12/month but needs memory measurement before choosing it. Build off-host using the workflow below. The 32 GB disk is a capacity choice, not a measured requirement.

Sources checked October 22, 2026: [Lightsail pricing](https://aws.amazon.com/lightsail/pricing/), [Lightsail Free/Paid support](https://aws.amazon.com/free/compute/lightsail/), [plan rules](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html). Free supports Lightsail; an upgrade is not a launch prerequisite. The current Free account has a finite credit/time horizon and is unsuitable for indefinite unattended hosting without an explicit continuity decision. Verify exact bundle, AZ, blueprint, quotas, backup API access and price in account 044986459337 before approving a Terraform plan. Never use an unrelated existing AWS profile.

## Release selection and packaging

PR #1 is merged at 40661827d221d664cfa745345f3aa50023d8e173. This release branch integrates the reviewed original Mac app fixes: both-speaker active captions and interruption/lifecycle handling, selected-memory source errors, sanitized provider startup diagnostics, regression tests and matching documentation. The original Mac checkout remains unchanged. See PLANS.md for integrated verification and the final local revision reported at handoff.

After the combined release is reviewed, use its precise local commit in a clean isolated checkout. Select the exact 40-character commit SHA. Review dependency/base image vulnerabilities, pull and verify a Linux amd64 pgvector digest, then build locally:

```sh
python3 infrastructure/bin/build-release.py \
  --revision REVIEWED_40_CHARACTER_COMMIT \
  --postgres-image pgvector/pgvector@sha256:REVIEWED_DIGEST \
  --output /private/new-release-directory
```

The builder refuses a dirty tree or mismatched HEAD, does not push anything, builds both application images for amd64, and writes `images.tar`, `source.tar`, `release.json`, and an operations template. The manifest records exact image IDs/digest, source-file hashes, and archive checksums. No registry is required. Review the manifest and image scan results. Keep it with the release; hashes detect corruption/drift, not a maliciously replaced manifest. Use a trusted SSH transfer and compare archive checksums on the host before extracting. Transfer/install is separately authorized.

On the host, load `images.tar`, extract `source.tar` into a new `/opt/voxa/releases/COMMIT` directory, install the corresponding `release.json` there as `.release.json` mode 0600, and link `/opt/voxa/current` only during an approved maintenance window. The operator must verify every archive checksum before extraction. Keep older release directories and their corresponding operations manifests. Put the private application `.env` in the release directory via a secure user workflow (mode 0600; no secrets in chat, arguments or Git). Do not create or use a GitHub deployment credential just to copy an archive.

Deployment accepts local immutable `sha256:IMAGE_ID` values loaded from the archive or immutable repository digests; it never builds or pulls at launch. Host files and image references must match the release manifest. Do not edit a host release to fix drift: build/review a new release. Local `validate` checks syntax, secret policy, disk and preloaded architecture; `deploy` additionally verifies source hashes.

## Account, host and storage bootstrap

Before provisioning: review Terraform plan, AWS account identity, budget and exact resource list; approve the regional SSH key and administrator /32, root MFA/operator access, and any paid-plan change separately. The scaffold creates no key. Do not create long-lived access keys as an implicit setup step. Protect Terraform state and plans; choose a reviewed state location. Resources are not provisioned by these scripts.

After approved provisioning, verify AWS firewall rules first: public TCP 80/443 and SSH only from the reviewed /32; no public API or PostgreSQL. Install Docker/Compose, Python, AWS CLI and age from reviewed official sources. Give Docker access only to trusted host administrators.

Match the attached disk in AWS to `lsblk -f` and its filesystem UUID. **No script formats a disk.** For a new blank disk, separately review the device and explicitly approve operator formatting; never format a restored disk. For an already formatted, reviewed ext4 disk:

```sh
sudo python3 infrastructure/bin/prepare-data-disk.py --uuid REVIEWED_UUID
# Review the proposed fstab entry and the attached device before an approved execution:
sudo python3 infrastructure/bin/prepare-data-disk.py --uuid REVIEWED_UUID --execute
```

The script refuses another filesystem at /srv/voxa, conflicting fstab entries, symlinked paths and a nonempty unmounted target; saves the original fstab; adds a UUID mount without `nofail`; mounts it and creates private subdirectories. It is repeatable for an unchanged matching mount/fstab. If interrupted after the fstab backup, inspect `/etc/fstab.before-voxa` and current fstab; do not remove a backup blindly to retry. It does not install software, change ownership of existing data or format anything.

Install the reviewed `infrastructure/systemd/docker-voxa-mount.conf` as `/etc/systemd/system/docker.service.d/voxa-mount.conf` on this dedicated host, then daemon-reload. Docker itself must require /srv/voxa because container restart policies bypass the application service. The application unit also verifies UUID and permissions. Verify mount dependency and perform a controlled reboot **before real data**. `/srv/voxa/postgres`, `caddy-data`, `caddy-config` and `backups` must be real mode-0700 directories, not symlinks. The database entrypoint manages its directory owner.

## Configuration, domain and authentication

Install the reviewed `infrastructure/operations.example.json` at `/etc/voxa/operations.json`, mode 0600, replacing all placeholders: actual ext4 UUID, approved private bucket, age **public** recipient, and the manifest's three immutable image references. Keep `/etc/voxa` root-owned mode 0700. Store the age private identity independently/off-host through a user-controlled process; never on the production VM merely for backup encryption. No key generator is provided or run.

Set root `.env` from `.env.example`: independent 64-character hexadecimal administrator/application database passwords, independent high-entropy Basic password, username, OpenAI key, exact origin `https://voxa.lakechabotlabs.ai`, approved ACME email and model/session settings. Use unquoted KEY=value syntax without `$`, quotes, backslash, `#` or spaces to avoid Compose interpolation ambiguity. The validator refuses duplicates, weak/reused secrets, wrong origin and unsafe file permissions; it never prints values. Docker/root administrators can inspect runtime secrets. Existing database password rotation needs an actual reviewed SQL change; editing .env alone is not rotation.

Porkbun is the registrar; **authoritative nameservers have not been verified**. Query NS/SOA and use the actual authoritative DNS provider. Only after separate DNS approval, add the `voxa` A record pointing to the attached static IPv4. Do not add AAAA for this IPv4-only scaffold. Check conflicting records/proxying and CAA policy before certificate issuance. Keep unrelated records unchanged. Caddy handles public HTTPS and renewals; back up its certificate state privately.

Single-owner Basic auth uses a long independent random password, HTTPS, exact Host/Origin and a private database. API routes are authenticated; static shell is public. It has **no authentication rate limiter, per-device sessions/revocation, MFA or reliable browser logout**. This is a documented single-owner bootstrap risk, not a multi-user launch design. Test browser auth caching on every intended device. If stronger access control is required, choose/review an identity-aware access layer before public launch rather than pretending Basic auth provides it. Do not broaden CORS or expose 4318/5432 as a workaround.

## Validate and deploy after approval

```sh
sudo python3 infrastructure/bin/voxa-ops.py storage-check
sudo python3 infrastructure/bin/voxa-ops.py validate
sudo python3 infrastructure/bin/voxa-ops.py deploy
# Only after explicit launch approval, with all calls ended:
sudo python3 infrastructure/bin/voxa-ops.py deploy --execute
```

The dry run does not start containers. Deployment checks reviewed source, exact image architecture, config, UUID mount and a shared operation lock, then uses standalone production Compose plus the immutable release overlay with `--no-build --pull never`. One API process only. It reports Compose health, not internet/voice acceptance. There is no automatic rollback or restart during an active call.

Install/review `voxa.service` if boot-time application startup is wanted. It and the Docker mount dependency must be installed only after authorized host setup. A failed startup requires inspection; do not automatically restore an old database. For app rollback, end calls, verify schema compatibility, choose the old immutable release and corresponding operations image manifest, validate, then deploy. For incompatible migrations, restore into a new isolated database and plan a maintenance cutover; never overwrite the live archive. Preserve writes made since the backup.

## Scheduled encrypted off-host backup

The proposed destination is a **private Lightsail object bucket**. Approve bucket, retention, identity/access and costs before creating it. The job checks STS account, exact bucket, `getObject=private`, disabled public overrides and no cross-account read accounts before dumping anything. It encrypts a custom-format pg_dump with age on private temporary storage, uploads ciphertext with a unique timestamp/UUID key, verifies object size, and removes the temporary plaintext/ciphertext. A failed upload fails the service. This verifies upload, not restore or content parity. No public ACL or automatic deletion is used.

A reviewed AWS identity must permit only required actions: STS identity read; Lightsail GetBuckets for privacy verification; S3 PutObject and HeadObject/GetObject permission for `voxa/postgres/*` in the chosen bucket (plus any narrowly required endpoint permissions). A Lightsail bucket access key alone may not authorize STS/GetBuckets. Verify the chosen identity supports all checks; **no identity has been configured or created**. Prefer an approved credential refresh mechanism; unattended temporary credentials need renewal. Do not reuse a different organization's profile or silently create static keys. Approve any persistent credential explicitly.

The supplied backup unit points to `/etc/voxa/backup-credentials` and `/etc/voxa/aws-config`, profile `voxa-backup`, with metadata credential fallback disabled. These files are placeholders for a later secure access decision, not files included in the repo. Keep mode 0600 and test expiry/failure. It uses a shared lock with deployments. Install `voxa-backup.service` and `.timer`, daemon-reload, review `systemd-analyze verify`, then manually run one backup and restore it before enabling the timer. Schedule: daily 04:00 UTC plus up to 15 minutes jitter; missed run on boot. Do not enable it now.

Suggested policy for approval: recovery point <=24 hours, seven daily off-host dumps and seven daily resource snapshots, test recovery monthly. Retention/deletion is **not automated** because permanent backup deletion requires explicit policy approval. At small usage the 100 GB bucket should be ample, but monitor actual storage, backup age and failures. Root-disk snapshots are enabled in Terraform; data-disk automatic snapshots need a separate API/CLI setup. [AWS snapshot configuration](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-configuring-automatic-snapshots.html).

**Launch blockers:** choose/configure an alert destination for failed/missing backups, prove credential renewal, and implement the approved retention policy. The service currently exposes failure through systemd/journal only; no external alert is configured. No raw transcript is intentionally logged. Monitor units locally without publishing secrets. Live 30-day transcript expiry does not erase historical backups; snapshot copies of application configuration also contain secrets and require private access/retention.

## Restore rehearsal and migration

Download a selected encrypted backup through an authorized identity to a private recovery host. Verify its expected key/size, set mode 0600, and supply an independently held age identity file (also mode 0600). Preload the same reviewed Linux amd64 pgvector image. On a host with the reviewed data-mount/config prerequisites:

```sh
sudo python3 infrastructure/bin/voxa-ops.py restore-check \
  --encrypted-dump /private/archive.dump.age --identity /private/age-identity
# After approving creation/removal of this disposable local recovery database:
sudo python3 infrastructure/bin/voxa-ops.py restore-check --execute \
  --encrypted-dump /private/archive.dump.age --identity /private/age-identity
```

This creates only a uniquely named network-isolated temporary Docker database, not the live DB; uses a nonlogin app owner, restores transactionally with original owners, checks vector/schema and app-role reads, and removes only its own container/temp files afterward. The recovery data and scratch /tmp are each capped at 1 GiB; larger archives require a separately reviewed recovery host/capacity change. Encryption is authenticated by age; a wrong identity/corrupt ciphertext must fail. A timeout or host crash may leave the uniquely named recovery container; inspect it privately before explicitly removing it. No broad Docker prune or live cleanup is provided.

The smoke check does not prove semantic equality. Verify expected schema revision, row counts, representative synthetic conversation/category/summary relationships and app behavior against a known pre-backup fixture before allowing real data. Test corrupt backups and lost-host recovery. Back up Caddy data and the protected configuration separately through an approved encrypted process; the logical DB dump does not contain these or role passwords.

For legacy SQLite migration follow DATABASE.md: end calls/stop writers, explicit source backup, empty target only, exact content-digest verification, source retained, no bidirectional sync. User approval is required before uploading personal conversations. Starting the normal summary worker with a real provider key can process imported jobs and incur charges. Prefer an empty synthetic archive for first deployment acceptance.

## Verification boundaries

Local checks must distinguish offline refusal tests, Linux image builds, genuine PostgreSQL restore, and live hosting. The opt-in Docker recovery test uses only synthetic data and mocks the age transport; it does not establish real encryption, S3 access, scheduling, host mounts or AWS acceptance. No keys are generated by these tests.

Before usable launch: valid DNS/TLS/redirects; 401 for unauthenticated/wrong auth and rejection of wrong Host/foreign Origin; external port check; schema/pgvector and archive survival across restart/reboot; successful encrypted off-host restore; real browser/iPhone foreground voice and transcript saving; interruption, Bluetooth, selected memory, and recovery. Native iOS voice/background audio remains outside scope. A passing HTTP probe is insufficient.
