# ADR-0007 · Tokens in httpOnly cookies behind a BFF

**Status:** Accepted · **Date:** 2026-02

## Context

The web app needs an authenticated session. The two common patterns:

1. The browser holds the access token (usually `localStorage`) and attaches it
   to `fetch` calls it makes directly to the API.
2. The browser holds an opaque session cookie; a server the app controls holds
   the token and calls the API on its behalf.

The data behind this session is payroll, invoices and contracts.

## Decision

Pattern 2. The Next.js application is a backend-for-frontend.

Access and refresh tokens live in `httpOnly`, `sameSite=lax`, `secure` cookies.
The browser cannot read them. Every call to the API is made by a server
component, a server action or a route handler that attaches the bearer header
itself.

Even document downloads go through a route handler
([`apps/web/src/app/api/documents/[documentId]/download/route.ts`](../../../apps/web/src/app/api/documents/%5BdocumentId%5D/download/route.ts)),
because a plain `<a href>` to the API cannot carry a token the browser is not
allowed to read.

## Consequences

**Good, and the whole point.** An XSS cannot steal the session. A token in
`localStorage` is readable by any script that runs on the page; one
cross-site-scripting bug and the attacker has a portable credential they can
replay from their own machine, for as long as it lives. An `httpOnly` cookie is
not readable, so the same bug gets them actions-while-the-user-is-there — still
bad, but bounded and detectable.

Verified in a real browser, not assumed: `document.cookie` returns an empty
string while the session works.

**Good.** The API's CORS policy stays narrow. The only browser origin that ever
calls it is the one we control.

**Good.** The API base URL is never exposed to the browser, so the API can live
on a private network with no public ingress at all.

**Good.** Refresh is invisible to the user. A 401 triggers one refresh and one
replay, server-side; the page just renders.

**Bad.** Every data fetch is a server round trip. There is no client-side cache
and no optimistic update. For a dense, data-heavy internal tool this is the
right trade — the data must be current and the interactions are mostly
navigation — but it would be the wrong one for a highly interactive editor.

**Bad.** `sameSite=lax` mitigates CSRF for cross-site requests but is not a
complete answer for same-site ones. Next.js server actions carry their own
origin checks, which covers the mutating paths; a dedicated CSRF token would be
the belt to that braces if the app grows non-action mutations.

**Bad.** More moving parts than a static SPA. The web tier is a server that has
to be deployed, scaled and monitored, not a bundle on a CDN.

**Bad.** An access-token cookie is scoped to the web app's origin, so a native
mobile client would need a different flow. The API is unchanged — it takes a
bearer token — so that is a client decision, not an architectural one.

## Alternatives considered

**Token in `localStorage`, browser calls the API directly.** Simplest, and the
most common. Rejected on the XSS argument above: for this data, "one XSS equals
a stolen portable session" is not an acceptable failure mode.

**Token in memory only, refreshed on load.** Better than `localStorage` — a
reload clears it — but still readable by script while the page is open, and it
needs a refresh token somewhere persistent anyway, which puts you back at the
same question.

**A server-side session store (opaque session id, Redis).** Strong revocation
and no token in the browser at all. Rejected because it adds a datastore to
operate, and the property it buys over this design — instant revocation — is
already provided by re-reading the membership on every API request.

**Next.js middleware for auth instead of per-page checks.** Middleware runs on
every request including static assets, and Next's own guidance is to treat it as
an optimisation rather than the authorisation boundary. The check lives in the
layout and, more importantly, in the API — which enforces it regardless of what
the web tier believes.
