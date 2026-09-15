# Monitoring

Knowing what the system is doing, and being told when it stops.

## The three signals

| Signal | Answers | Cost | This system |
| --- | --- | --- | --- |
| **Logs** | What happened, in detail | High volume | Structured JSON via pino |
| **Metrics** | How much, how fast, over time | Cheap, aggregated | Not implemented |
| **Traces** | Where the time went, across services | Moderate | Not implemented |

Plus a fourth that this system takes unusually seriously:

| **Audit** | Who changed what business data | Low | `audit_logs`, complete |

Logs and the audit trail are built. Metrics and traces are the honest gap, and
this page describes what they should be rather than pretending they exist.

## Logging

### Structure

JSON, one object per line, to stdout. The platform collects stdout — writing to
a file in a container produces a log nobody reads that eventually fills a disk.

```json
{
  "level": "info",
  "time": "2026-06-15T12:00:00.000Z",
  "service": "almajeed-erp-api",
  "env": "production",
  "requestId": "req_3f1a8b2c...",
  "method": "POST",
  "url": "/api/v1/invoices",
  "statusCode": 201,
  "responseTime": 43.2
}
```

### Redaction at the sink

```ts
redact: {
  paths: ['req.headers.authorization', 'req.headers.cookie', 'password',
          'passwordHash', 'token', 'accessToken', 'refreshToken',
          'nationalId', 'bankAccount', /* ... */],
  censor: '[redacted]',
}
```

Configured at the logger, not at call sites. That is what makes it hold: it
applies even to an incautious `log.info({ req })` written by someone who did not
know the rule.

### Levels

| Level | Use |
| --- | --- |
| `fatal` | The process is about to die |
| `error` | Something failed that should not have. A human should look |
| `warn` | Degraded, or a permission denial |
| `info` | Normal operations — requests, state changes |
| `debug` | Development only |
| `trace` | Verbose diagnosis |

Production runs at `info`. `debug` in production is expensive in ingestion cost
and sometimes in privacy, because debug lines tend to include payloads.

### The request id

The thread that ties everything together. Generated or accepted per request,
echoed in `x-request-id`, present in every log line, stored on every audit row,
and returned in every error body.

A user quotes it from an error message; an operator finds the exact log line and
the exact audit row. That is the entire debugging story for most incidents, and
it costs almost nothing.

## What to alert on

The discipline that matters: **alert on symptoms users feel, not on causes.**
High CPU is not an incident; slow responses are. Paging someone for a cause that
is not currently affecting anyone is how alert fatigue starts, and alert fatigue
is how a real page gets ignored.

### Page someone

| Condition | Threshold | Why |
| --- | --- | --- |
| Error rate | 5xx > 1% of requests over 5 minutes | Users are seeing failures |
| Latency | p95 > 2 s over 5 minutes | The product feels broken |
| Availability | Health check failing from two locations | It is down |
| Database connections | > 90% of maximum | About to reject connections |
| Disk | > 85% on the database volume | Writes fail hard and confusingly when it fills |
| Certificate expiry | < 21 days | Automation has failed silently |

### Notify, do not page

| Condition | Threshold |
| --- | --- |
| Elevated 4xx | > 10% over 15 minutes — usually a client bug or an attack |
| Slow queries | Any over 5 s |
| Authentication failures | > 100 from one IP in 10 minutes |
| AI spend | Daily total over budget |
| Failed logins on one account | > 20 in an hour |
| Backup job | Any failure |

### Never alert

Anything that is normal, self-healing, or not actionable at 3am. A single
container restart. A brief CPU spike. One slow request.

## Metrics worth having

Not implemented. What to add, via `prom-client` and a `/metrics` endpoint:

**RED, per endpoint** — Rate, Errors, Duration:

```
http_requests_total{method, route, status}
http_request_duration_seconds{method, route}   histogram
```

**USE, per resource** — Utilisation, Saturation, Errors:

```
db_pool_connections{state="active"|"idle"|"waiting"}
db_query_duration_seconds
process_resident_memory_bytes
nodejs_eventloop_lag_seconds
```

**Business metrics**, which are the ones that catch the subtle failures:

```
invoices_issued_total
payments_recorded_total
ai_tokens_total{direction="input"|"output"}
ai_requests_total{outcome}
documents_uploaded_total
active_organizations
```

Event loop lag is the Node-specific one people miss. A blocked event loop makes
every request slow simultaneously, and CPU may look fine.

The business metrics matter because a bug that stops invoices being issued
produces no errors and no latency change — just a number that goes to zero. That
is exactly the failure that goes unnoticed for a week.

## Tracing

Not implemented. With three services and one database, distributed tracing buys
less than it would in a microservice architecture — the request id already
correlates across the two application tiers.

Where it would pay: attributing latency inside a single request. "This endpoint
is slow" is useful; "this endpoint is slow because of three sequential queries
that could be one" is actionable.

OpenTelemetry with auto-instrumentation for Fastify and pg would give that for
modest effort, and is the natural next step after metrics.

## Dashboards

Three, for three different questions.

**Service health** — is it working right now? Request rate, error rate, p50/p95/
p99 latency, database connections, memory, event loop lag.

**Business** — is it being used? Organizations active today, invoices issued,
payments recorded, documents uploaded, AI requests and spend.

**Security** — is anything unusual? Failed logins, permission denials, refresh
replays, upload rejections, requests from new countries.

## The audit log as observability

Worth stating: `audit_logs` is not a debugging tool, it is an evidence tool. The
difference matters.

Logs answer "why did this request fail?" and are sampled, truncated and expired
aggressively. The audit log answers "who changed this invoice, when, from
where?" and is complete, retained for years, and append-only by permission.

Conflating them means either an audit trail that gets rotated away, or a log
bill that reflects seven-year retention. Both are worse than keeping them
separate.

## Health endpoints

```
GET /health   →  200 {"status":"ok"}        liveness
GET /ready    →  200 {"status":"ready"}     readiness — checks the database
```

**Liveness deliberately does not touch the database.** A liveness probe that
fails on a database blip restarts otherwise-healthy containers, turning a brief
database outage into a much longer application outage.

Readiness does check, because an instance that cannot query is not ready to
serve. Neither is rate limited — a rate-limited health check turns a traffic
spike into an outage.

## Cost

Log ingestion is usually the largest observability bill, and it is driven by
volume rather than value. Controls that work: `info` in production, sampling
successful requests at high volume, keeping payloads out of log lines, and a
short retention on application logs with a longer one on the audit trail — which
lives in Postgres and costs nothing extra.
