# Debugging

Most debugging time is spent finding the request, not fixing the bug. This
system is built so that finding it takes one grep.

## The request id

Every request gets an id, generated on arrival or taken from an inbound
`x-request-id`. It appears in three places:

1. every log line for that request (pino child logger),
2. the `x-request-id` response header,
3. the `request_id` column of any `audit_logs` row the request wrote.

So a user saying "it failed" plus a screenshot of the error panel (which shows
the id) gets you to the exact log lines and the exact audit entries:

```bash
docker compose logs api | grep 019a5f3c-2b41-7e6a-9c2f-1d0e8b7a4c55
```

```sql
SELECT action, resource_type, resource_id, succeeded, created_at
FROM audit_logs
WHERE request_id = '019a5f3c-2b41-7e6a-9c2f-1d0e8b7a4c55';
```

If you take nothing else from this page: ask for the request id first.

## Reading the logs

Pino, JSON, one line per event. `apps/api/src/lib/logger.ts` configures it.
Pretty-printed in development; raw JSON in production, because a log shipper
parses it and a human pipes it through `jq`.

```bash
# Errors only, readable
docker compose logs -f api | jq -c 'select(.level >= 50) | {t:.time, msg, err:.err.message, req:.requestId}'

# Everything one user did
docker compose logs api | jq -c 'select(.userId == "usr_...")'

# Slow requests
docker compose logs api | jq -c 'select(.responseTime > 500) | {url:.req.url, ms:.responseTime}'
```

**Redaction is on.** `authorization`, `cookie`, `set-cookie`, `password`,
`token` and friends are replaced before serialization. If you are debugging auth
and want the token, decode it from the client side — do not remove the
redaction, because the removal will get committed.

## The audit log

`audit_logs` is the second timeline, and it is the one that survives log
rotation. Every mutating service writes one row: who (`actor_user_id`), what
(`action`, in `resource.verb` form — `invoice.issued`, `auth.refresh_replay_detected`),
which resource, from which IP, under which request id, whether it `succeeded`,
and `before`/`after` snapshots of the changed fields.

```sql
-- What happened to this invoice, in order
SELECT created_at, action, actor_user_id, succeeded, before, after
FROM audit_logs
WHERE organization_id = $1 AND resource_type = 'invoice' AND resource_id = $2
ORDER BY created_at;
```

This answers the most common support question — "who changed this?" — without
anyone guessing. It is also visible in the UI at `/audit` for roles holding
`audit:read`.

## Errors as they reach the client

```json
{
  "error": {
    "code": "precondition_failed",
    "message": "Invoice has already been issued",
    "requestId": "019a5f3c-2b41-7e6a-9c2f-1d0e8b7a4c55"
  }
}
```

The `code` is from the closed set in `packages/shared/src/errors.ts` and is
stable across releases; branch on it, not on the message. `details` carries
field-level issues on a 422.

A 500 never carries internal detail — the message is generic and the cause is
logged with the same request id. When someone reports a 500, you have the id;
the stack is in the logs.

## Reproducing

**In a test, first.** The harness builds the entire system in-process with a
pinned clock, so a bug involving dates, ordering or money is usually reproducible
in a dozen lines. A bug that has a failing test is nearly fixed; a bug you are
reproducing by clicking is not.

```ts
const ctx = await createTestContext();
ctx.setNow(new Date('2026-03-15T00:00:00Z'));
// ...drive the exact sequence through ctx.app.inject()
```

**Against the demo.** `npm run demo` gives you a fully seeded organization with
five roles in one command. Reproducing a permissions report usually means
signing in as the role that reported it.

## Debugging the API process

```bash
node --inspect apps/api/dist/index.js       # then chrome://inspect
LOG_LEVEL=debug npm run dev:api             # far more detail
NODE_OPTIONS=--enable-source-maps           # already set in the image
```

Source maps are on in the container, so a production stack trace points at the
TypeScript line, not the compiled one.

For a single test:

```bash
npx vitest run apps/api/src/modules/finance/finance.test.ts -t 'another currency'
```

## Debugging the database

```bash
docker compose exec db psql -U erp -d erp
```

```sql
-- Is the query using the index you think it is?
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM invoices
WHERE organization_id = 'org_...' AND deleted_at IS NULL
ORDER BY created_at DESC, id DESC
LIMIT 25;

-- What is blocking what?
SELECT pid, state, wait_event_type, wait_event, left(query, 80)
FROM pg_stat_activity WHERE state <> 'idle';

-- Which queries hurt? (needs pg_stat_statements)
SELECT calls, round(mean_exec_time::numeric, 2) AS ms, left(query, 100)
FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
```

A composite index on `(organization_id, created_at DESC, id DESC)` is what makes
the keyset pagination a range scan rather than a sort. If `EXPLAIN` shows a
sort, the index is missing or the predicate does not match its leading columns.

## Debugging the web app

The web app is server components by default, so a lot of "React" bugs are
actually server-side fetch bugs. `console.log` in a server component prints in
the terminal running `next dev`, not in the browser.

The BFF layer means the browser never sees the API token. `document.cookie` is
empty by design — an empty result there is not a bug. To see what the browser
actually sent, look at the Network tab's request headers, where the `Cookie`
header will show `amg_at`/`amg_rt` marked `HttpOnly`.

A 401 loop usually means the refresh token was rotated by another tab. The
client replays once through `lib/api.ts` and then redirects to sign-in.

## A worked example

**Report.** "The receivables report puts an invoice in the wrong bucket."

1. **Get specifics.** Which invoice, which bucket, what did they expect? Invoice
   dated 2026-02-10, shown as `31-60`, expected `61-90`.
2. **Pin the clock.** The report's "today" was 2026-03-15.
3. **Do the arithmetic before touching code.** 2026-02-10 to 2026-03-15 is 33
   days. 33 falls in `31-60`.
4. **Conclusion: the code is right and the report is wrong.** The person had
   counted to the end of March.

That is a real sequence from this codebase, and the reason it is here: my first
instinct was to change the boundary condition, and a test asserting `61-90` was
written before the arithmetic was checked. The implementation was correct; the
test was wrong. It now asserts `31-60` and has neighbours at exactly 30 and 31
days.

**When a report and the code disagree, compute the expected value by hand
first.** Changing code to match a wrong expectation is the most expensive kind
of fix, because it ships, and because the test then defends the bug.

## Common failures and what they mean

| Symptom | Usual cause |
| --- | --- |
| `ERR_MODULE_NOT_FOUND` on a relative import | Missing `.js` extension on the specifier |
| 401 on every request right after a deploy | `JWT_SECRET` changed; all tokens invalid by design |
| Everyone's password suddenly wrong | `PASSWORD_PEPPER` changed — hashes cannot verify |
| 403 where you expected 404 | Intentional: permission is checked before existence, so a probe cannot enumerate ids |
| 404 for a row you can see in `psql` | Wrong organization, or `deleted_at` is set — `scope()` hides both |
| 415 on an upload that "is a PDF" | The bytes disagree with the declared type; sniffing wins |
| Test passes alone, fails in the suite | State leaking between tests — check `truncate()` covers it |
| `next build` fails, `tsc` passes | The web app is type-checked by Next, not the root project references |
