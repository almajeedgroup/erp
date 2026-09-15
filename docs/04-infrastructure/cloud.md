# Cloud computing

The concepts, the service models, and where each fits for a system like this.
Vendor-neutral, with names in all three major clouds.

## The service models

```
On premise    IaaS          PaaS          Serverless      SaaS
────────────  ────────────  ────────────  ────────────    ────────────
You: all      You: OS up    You: app      You: code       You: config
                            + data        + data
```

Each step trades control for operational burden. The mistake is treating it as a
ladder to climb rather than a menu to choose from per component.

For this system:

| Component | Model | Why |
| --- | --- | --- |
| Database | Managed (PaaS) | Backups, failover and patching are solved problems not worth re-solving |
| API, web | Managed containers | Needs a long-lived process and a connection pool |
| Object storage | Managed | Nobody should run their own |
| Secrets | Managed | Rotation and audit for free |
| Job runner | Managed scheduler | When the retention job exists |

## The equivalents

| Concept | AWS | GCP | Azure |
| --- | --- | --- | --- |
| Virtual machine | EC2 | Compute Engine | Virtual Machines |
| Managed containers | ECS / Fargate | Cloud Run | Container Apps |
| Kubernetes | EKS | GKE | AKS |
| Functions | Lambda | Cloud Functions | Functions |
| Managed Postgres | RDS / Aurora | Cloud SQL | Database for PostgreSQL |
| Object storage | S3 | Cloud Storage | Blob Storage |
| Secrets | Secrets Manager | Secret Manager | Key Vault |
| Load balancer | ALB | Cloud Load Balancing | Application Gateway |
| CDN | CloudFront | Cloud CDN | Front Door |
| Logs | CloudWatch | Cloud Logging | Monitor |
| Identity | IAM | IAM | Entra ID |
| Scheduler | EventBridge Scheduler | Cloud Scheduler | Logic Apps |

Learning one transfers almost completely. The concepts are identical; the
console layouts and the IAM syntax are not.

## Serverless, and why this system is not

Serverless — Lambda, Cloud Functions — runs your code on demand, scales to zero,
and bills per invocation. It is genuinely excellent for some workloads and a
poor fit for this one.

**Why not for the API:**

| Problem | Detail |
| --- | --- |
| Connection pooling | Each concurrent invocation is a separate execution context wanting its own database connection. 100 concurrent requests can mean 100 connections, against a `max_connections` of 100. Needs a proxy (RDS Proxy, PgBouncer), which is another component |
| Cold starts | A Node function with a large dependency tree takes 1–3 seconds to start cold. Occasionally acceptable for a background job; not for an interactive dashboard |
| Execution limits | 15 minutes on Lambda. Fine here, but it is a ceiling to remember |
| Cost at steady load | Serverless is cheaper when idle and more expensive under sustained traffic. A business tool has predictable weekday load — the worst case for the pricing model |
| Local development | Harder to run the whole system on a laptop |

**Where serverless genuinely fits here:**

- The retention and cleanup job, when it exists — runs daily, scales to zero
- Webhook receivers for payment or accounting integrations
- Scheduled report generation
- Image or document post-processing

The pattern is: long-lived process for interactive request handling; functions
for scheduled and event-driven work.

## Compute sizing

Start small. This system is not compute-hungry.

| Component | Start with | Scale when |
| --- | --- | --- |
| API | 0.5 vCPU, 1 GB, 2 replicas | p95 latency rises, or CPU stays above 70% |
| Web | 0.5 vCPU, 1 GB, 2 replicas | Same |
| Database | 2 vCPU, 8 GB | Connections saturate, or slow queries appear |

Two replicas rather than one is about availability, not throughput: one replica
means every deploy and every host failure is an outage.

The database is almost always the first bottleneck, and the first fix is almost
always an index rather than a bigger instance.

## Managed Postgres

The one service worth paying for without hesitation. What you get:

- Automated backups with point-in-time recovery
- Automatic failover to a standby
- Patching without you scheduling it
- Metrics and slow-query logs
- Read replicas on request

What to configure:

| Setting | Value |
| --- | --- |
| Backup retention | 30 days minimum |
| Multi-AZ | Yes in production. A single AZ is a single point of failure |
| Public accessibility | **No.** Private endpoint only |
| Encryption | At rest, always |
| `max_connections` | Sized against replica count × pool size, with headroom |
| Performance insights | On. It is how you find the slow query |

Aurora versus standard RDS: Aurora has better failover and storage-level
replication; standard Postgres is cheaper and has fewer surprises. For this
scale, standard is fine.

## Object storage

Documents belong here, not on a container filesystem which is ephemeral.

| Requirement | Setting |
| --- | --- |
| Public access | Blocked at the account level, so a future misconfiguration cannot override it |
| Encryption | Server-side, on |
| Versioning | On, so an accidental overwrite is recoverable |
| Lifecycle | Transition to infrequent-access after 90 days; the retention policy governs deletion |
| Access | The application's role only |

The storage driver interface exists
([`apps/api/src/lib/storage.ts`](../../apps/api/src/lib/storage.ts)) with the
local filesystem implemented. The S3 driver throws at boot with a clear message
rather than pretending — see [storage](storage.md).

## Networking

Covered in [cloud security](../03-security/cloud-security.md). The short version:
the database and the applications on private subnets, only the load balancer
public, security groups referencing each other rather than CIDR ranges, and
restricted egress.

## Cost

Rough monthly, for a small production deployment:

| Item | Cost |
| --- | --- |
| Managed Postgres (2 vCPU, 8 GB, multi-AZ) | £150–250 |
| Containers (4 × 0.5 vCPU) | £60–100 |
| Load balancer | £20–30 |
| Object storage + transfer | £5–20 |
| Logs and metrics | £20–50 |
| Secrets, DNS, certificates | £5–10 |
| **Total** | **£260–460** |

Plus AI usage if `AI_PROVIDER=anthropic`, which is the only line that scales with
usage rather than with size.

Where costs surprise people: data transfer between availability zones, log
ingestion volume (a debug-level log in production is expensive), and anything
left running in a forgotten staging environment.

## Multi-region

Not needed. Worth saying why, because it is a common reflex.

Multi-region buys latency for globally distributed users, and availability
through regional failure. This product serves businesses in one region; the
latency benefit is nil. And the cost is significant: either accept eventual
consistency between regions — which is unacceptable for financial records — or
accept cross-region write latency, which is worse than the single-region
failure mode it is protecting against.

Single region, multi-AZ, with a tested restore procedure. That is the right shape
for this system, and probably for most systems that reach for multi-region.
