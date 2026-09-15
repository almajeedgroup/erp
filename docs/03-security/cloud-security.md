# Cloud security

Running this system on a cloud platform. The concepts are the same on AWS, GCP
and Azure; the names differ.

## The shared responsibility line

The provider secures the cloud. You secure what you put in it. Where the line
falls depends on the service:

| Service model | Provider handles | You handle |
| --- | --- | --- |
| IaaS (EC2, Compute Engine) | Hypervisor, physical, network fabric | OS patching, runtime, application, data, IAM |
| Managed database (RDS, Cloud SQL) | OS, engine patching, backups, failover | Schema, queries, access control, encryption choices |
| Containers (ECS, Cloud Run) | Host, orchestration | Image contents, runtime config, secrets, IAM |
| Serverless (Lambda, Cloud Functions) | Everything below your code | Your code, dependencies, IAM, data |

The mistake is assuming "managed" means "secured". A managed Postgres with a
public endpoint and a weak password is exactly as compromised as an unmanaged
one.

## Identity and access

**Least privilege, per workload.** The API's role needs: read its secrets,
connect to the database, read and write its storage bucket, write logs and
metrics. Nothing else. Not `*` on anything.

**No long-lived keys where an identity will do.** Workload identity (IAM roles
for service accounts, GCP workload identity, Azure managed identity) gives a
process short-lived credentials without a static key to leak. A static
`AWS_SECRET_ACCESS_KEY` in an environment variable is the thing that ends up in
a public repository.

**Separate accounts or projects per environment.** Production and staging in the
same account share a blast radius. A misconfigured staging role should not be
able to reach production data.

**MFA on every human account**, enforced at the organization level.

**Break-glass access** — a separately-credentialed emergency role, its use
alarmed, its credentials in a physical safe or a separate vault, and every use
reviewed afterwards.

## Network

```
Internet
   │
   ├─► CDN / WAF ─► Load balancer (TLS terminates here)
   │                      │
   │              ┌───────┴────────┐
   │              ▼                ▼
   │         Web (private)    API (private)
   │                               │
   │                          ┌────┴─────┐
   │                          ▼          ▼
   │                     Database   Object storage
   │                     (private)  (private, no public access)
   └─► Nothing else
```

The properties worth insisting on:

- **The database has no public endpoint.** Not "has a public endpoint with a
  firewall" — no public endpoint. Administrative access goes through a bastion
  or a session-manager equivalent, which is logged.
- **Object storage is private.** Public-read buckets are the single most common
  cloud data breach. Enable the account-level "block public access" setting so a
  future misconfiguration cannot override it.
- **Security groups reference each other, not CIDR ranges.** "The database
  accepts connections from the API's security group" survives an IP change;
  `10.0.1.0/24` does not.
- **Egress is restricted too.** The API needs the database, object storage and
  the model provider's API. Unrestricted egress is how exfiltration happens
  quietly.

## Secrets

Covered in [secrets management](secrets-management.md). The cloud-specific
points: use the platform's secret manager rather than environment variables in a
task definition (which are visible to anyone who can describe the task), grant
read access per workload, and enable rotation where the platform supports it.

## Logging and audit

Three distinct things, often conflated:

| Layer | What it records | Service |
| --- | --- | --- |
| Cloud audit | Who changed infrastructure | CloudTrail, Cloud Audit Logs, Activity Log |
| Application logs | What the application did | CloudWatch, Cloud Logging, Monitor |
| Application audit | Who changed business data | This product's `audit_logs` table |

All three matter, and only the third is in this repository.

Cloud audit logs should go to a separate account with a retention lock, so an
attacker who compromises the production account cannot erase the record of it.

## Data residency

Pick a region and stay in it. Cross-region replication is a data-protection
decision as much as a technical one — replicating a European customer's data to
another jurisdiction may be a compliance event.

Backups inherit this. A backup in a different region is a copy in a different
jurisdiction.

## Container security

- Non-root user. The Dockerfiles here run as `node` (uid 1000).
- Minimal base image. `node:22-bookworm-slim`, not a full distribution.
- Multi-stage build, so no dev dependencies or build tooling in the runtime
  image.
- Read-only root filesystem where the runtime allows it, with a writable mount
  for anything genuinely mutable.
- Image scanning in CI, blocking on high and critical.
- Pinned base image digests for reproducibility.
- No secrets in layers — `.dockerignore` excludes `.env` files.

## Cost as a security control

An unbounded cloud bill is a denial-of-service against your own runway.
Budget alerts, per-service quotas, and a hard ceiling on anything that scales
automatically. The AI endpoint has a tight rate limit for exactly this reason.

## What this repository does and does not provide

**Provides:** Dockerfiles that follow the practices above, a compose file for
local development, CI that builds both images, and a configuration validator
that refuses unsafe production settings.

**Does not provide:** infrastructure-as-code. There is no Terraform, no
Pulumi, no CDK, because the right shape depends on the provider and the
organization's existing conventions, and a half-finished IaC module is worse
than a clear description of what needs to exist.

What needs to exist, concretely: a VPC with public and private subnets, a
managed Postgres with automated backups and a private endpoint, a container
runtime for two services, an object storage bucket with public access blocked, a
secret manager, a load balancer with a managed certificate, and log aggregation
with the alerts listed in
[monitoring](../04-infrastructure/monitoring.md).
