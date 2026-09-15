# Al-Majeed ERP — documentation

Everything that explains *why* this system is the way it is. Code says what
happens; these pages say what we were trying to achieve and what we traded away
to get it.

## How to read this

**New to the codebase?** Start with [the vision](00-overview/vision.md), then
[the module map](00-overview/module-map.md), then
[getting started](06-engineering/getting-started.md). That is about forty
minutes and you will be able to make a change.

**Reviewing a design?** [System architecture](02-architecture/system-architecture.md)
and the [ADRs](02-architecture/adr/) carry the decisions and the reasoning that
led to them, including the options that were rejected.

**Assessing security?** [Threat model](03-security/threat-model.md) first, then
[the OWASP Top 10 mapping](03-security/owasp-top-10.md), which names the file
and the test behind each control.

**Running it?** [Runbook](07-operations/runbook.md),
[incident response](07-operations/incident-response.md),
[disaster recovery](07-operations/disaster-recovery.md).

## The rule these documents follow

Every claim here points at code or a test. Where a document describes a
behaviour, the file that implements it is named; where it describes a
guarantee, the test that holds it is named. A document that drifts from the
code is worse than no document, because someone will believe it — so if you
change a behaviour, the page that describes it changes in the same commit.

Where something is **not** built yet, it says so plainly and explains what
would need to be true to build it. Aspirational documentation is the most
expensive kind.

---

## Contents

### 00 · Overview
| Page | What it covers |
| --- | --- |
| [Vision](00-overview/vision.md) | What this product is for, and what it deliberately is not |
| [Module map](00-overview/module-map.md) | The eight modules and how they depend on each other |
| [Glossary](00-overview/glossary.md) | Terms that have a specific meaning here |

### 01 · Business
| Page | What it covers |
| --- | --- |
| [Business model](01-business/business-model.md) | SaaS, B2B vs B2C, and which one this is |
| [Pricing and unit economics](01-business/pricing-and-unit-economics.md) | Packaging, CAC, LTV, payback, gross margin per tenant |
| [Revenue, profit and cash flow](01-business/revenue-profit-and-cash-flow.md) | The three numbers, why they differ, and how the product computes them |
| [Sales, marketing and acquisition](01-business/sales-marketing-and-acquisition.md) | Channels, funnel, and the data the product captures to measure them |
| [Contracts and negotiation](01-business/contracts-and-negotiation.md) | Terms that show up as fields, and the ones that show up as risk |
| [Partnerships, fundraising and valuation](01-business/partnerships-fundraising-and-valuation.md) | Integration partners, what investors ask, how software companies are valued |

### 02 · Architecture
| Page | What it covers |
| --- | --- |
| [System architecture](02-architecture/system-architecture.md) | The shape of the whole thing, and the request lifecycle |
| [Data model](02-architecture/data-model.md) | The 23 tables, the money representation, the indexing strategy |
| [API design](02-architecture/api-design.md) | Versioning, pagination, errors, idempotency |
| [Multi-tenancy](02-architecture/multi-tenancy.md) | How one database serves many organizations without leaking |
| [ADRs](02-architecture/adr/) | Eight decisions, with the alternatives that lost |

### 03 · Security
| Page | What it covers |
| --- | --- |
| [Threat model](03-security/threat-model.md) | Assets, actors, attack surface, and what we accept |
| [OWASP Top 10](03-security/owasp-top-10.md) | Each category mapped to a control, a file and a test |
| [Authentication](03-security/authn.md) | Argon2id, pepper, token rotation, replay detection, lockout |
| [Authorization and RBAC](03-security/authz-rbac.md) | The permission matrix and where it is enforced |
| [Encryption](03-security/encryption.md) | In transit, at rest, and what hashing is not |
| [API security](03-security/api-security.md) | Validation, rate limiting, CORS, headers |
| [Database security](03-security/database-security.md) | Least privilege, injection, backups as an attack surface |
| [Secrets management](03-security/secrets-management.md) | Where secrets live, how they rotate, how they leak |
| [Secure coding](03-security/secure-coding.md) | The habits that prevent whole bug classes |
| [Cloud security](03-security/cloud-security.md) | IAM, network, the shared responsibility line |
| [Data privacy](03-security/data-privacy.md) | Personal data, minimisation, retention, subject requests |
| [Penetration testing basics](03-security/pentest-basics.md) | How to test this system, and what to try first |

### 04 · Infrastructure
| Page | What it covers |
| --- | --- |
| [Linux](04-infrastructure/linux.md) | The parts that actually matter for running this |
| [Docker](04-infrastructure/docker.md) | Images, layers, and why these Dockerfiles look like this |
| [CI/CD](04-infrastructure/ci-cd.md) | The pipeline, and what each gate is protecting |
| [Cloud computing](04-infrastructure/cloud.md) | AWS/GCP/Azure concepts, serverless, and where each fits |
| [PostgreSQL and Supabase](04-infrastructure/postgres-and-supabase.md) | Running Postgres well; what a managed platform gives and takes |
| [Firebase and backend-as-a-service](04-infrastructure/firebase-and-baas.md) | What BaaS is good at, and why this system is not built on it |
| [DNS and TLS](04-infrastructure/dns-and-tls.md) | Records, certificates, and the failure modes |
| [Storage](04-infrastructure/storage.md) | Object storage, the driver contract, lifecycle |
| [Monitoring](04-infrastructure/monitoring.md) | Logs, metrics, traces, and what to alert on |
| [Backups](04-infrastructure/backups.md) | Strategy, RPO/RTO, and the restore drill |

### 05 · AI
| Page | What it covers |
| --- | --- |
| [Strategy](05-ai/strategy.md) | What AI is for here, and what it must never do |
| [Python and ML fundamentals](05-ai/python-and-ml-fundamentals.md) | The concepts behind the words, and where Python fits |
| [LLM integration](05-ai/llm-integration.md) | The provider boundary, cost, latency, failure |
| [RAG](05-ai/rag.md) | Chunking, embedding, retrieval, citation |
| [Agents](05-ai/agents.md) | The loop, tools, and the constraints that make it safe |
| [Vector databases](05-ai/vector-databases.md) | What they do, and when this system will need one |
| [Prompt engineering](05-ai/prompt-engineering.md) | The system prompt, injection, and data-not-instruction |
| [Evaluation](05-ai/evaluation.md) | How to know whether it got better |
| [Fine-tuning](05-ai/fine-tuning.md) | When it helps, when it is the wrong tool |
| [Vision and speech](05-ai/vision-and-speech.md) | Receipt OCR and meeting notes, and what they would cost |
| [Inference infrastructure](05-ai/inference-infrastructure.md) | Hosted vs self-hosted, batching, caching, quantisation |

### 06 · Engineering
| Page | What it covers |
| --- | --- |
| [Getting started](06-engineering/getting-started.md) | Clone to running in one command |
| [Coding standards](06-engineering/coding-standards.md) | The conventions, and the reasons |
| [Git workflow](06-engineering/git-workflow.md) | Branches, commits, reviews, releases |
| [Testing](06-engineering/testing.md) | The strategy, the harness, what is not tested |
| [Debugging](06-engineering/debugging.md) | Request ids, the audit log, and a worked example |
| [Data structures and algorithms](06-engineering/data-structures-and-algorithms.md) | The ones this codebase actually uses, and where |
| [System design](06-engineering/system-design.md) | Scaling this system, in the order the bottlenecks arrive |

### 07 · Operations
| Page | What it covers |
| --- | --- |
| [Runbook](07-operations/runbook.md) | Deploy, migrate, roll back, common tasks |
| [Incident response](07-operations/incident-response.md) | Severity, roles, comms, the first ten minutes |
| [Disaster recovery](07-operations/disaster-recovery.md) | Scenarios, RPO/RTO, the restore procedure |
| [Service levels](07-operations/service-levels.md) | SLIs, SLOs, error budgets |

### 08 · Modules
One page per module: what it owns, its rules, its endpoints and its edges.

[Clients](08-modules/clients.md) ·
[Projects](08-modules/projects.md) ·
[Employees](08-modules/employees.md) ·
[Finance](08-modules/finance.md) ·
[Documents](08-modules/documents.md) ·
[Tasks](08-modules/tasks.md) ·
[Analytics](08-modules/analytics.md) ·
[AI agent](08-modules/ai-agent.md)
