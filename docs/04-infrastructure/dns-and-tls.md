# DNS and TLS

How a request finds this system, and how it stays private on the way.

## DNS

Turning a name into an address. The parts that matter operationally.

### Record types

| Type | Purpose | Example |
| --- | --- | --- |
| `A` | Name → IPv4 | `erp.almajeed.example → 203.0.113.10` |
| `AAAA` | Name → IPv6 | |
| `CNAME` | Name → another name | `www → erp.almajeed.example` |
| `MX` | Mail routing | Needed for the email features not yet built |
| `TXT` | Arbitrary text | Domain verification, SPF, DKIM, DMARC |
| `CAA` | Which authorities may issue certificates for this domain | **Underused and worth setting** |
| `NS` | Which nameservers are authoritative | |

A `CNAME` cannot coexist with other records at the same name, which is why the
apex (`almajeed.example`) cannot be a `CNAME`. Providers work around this with
`ALIAS` or `ANAME` records that resolve server-side.

### TTL

How long a resolver may cache an answer.

| Value | Use |
| --- | --- |
| 300 s | Before a planned change — lets you move quickly |
| 3600 s | Normal operation |
| 86400 s | Records that never change |

**Lower the TTL 24 hours before a migration, not on the day.** The old TTL still
governs cached answers, so a change made an hour before a cutover is cached for
the old duration.

### A typical layout

```
almajeed.example            A      → load balancer
www.almajeed.example        CNAME  → almajeed.example
erp.almajeed.example        A      → load balancer (the web app)
api.almajeed.example        A      → load balancer (the API)
almajeed.example            CAA    0 issue "letsencrypt.org"
almajeed.example            TXT    "v=spf1 include:_spf.provider.com -all"
```

The `CAA` record is worth a sentence: it tells certificate authorities that only
the named one may issue for this domain. Without it, any of the hundreds of
trusted authorities can — and a mis-issued certificate is a working
man-in-the-middle.

### Failure modes worth recognising

| Symptom | Likely cause |
| --- | --- |
| Works for you, not for others | DNS propagation, or a stale local cache |
| Works on one network, not another | A resolver caching an old answer, or split-horizon DNS |
| Intermittent failures | One nameserver of several is misconfigured |
| Everything breaks at once | Domain expired, or nameservers changed |

Domain expiry is embarrassing, total and entirely preventable. Auto-renew, with
the billing contact monitored by more than one person.

## TLS

Encrypting the connection, and proving the server is who it claims to be.

### The handshake, briefly

1. Client sends supported versions and cipher suites, plus the hostname (SNI)
2. Server picks a suite and sends its certificate chain
3. Client verifies the chain against its trust store, and checks the hostname
   and validity dates
4. Key exchange (ECDHE) establishes a shared secret with forward secrecy
5. Everything after is symmetrically encrypted

**Forward secrecy** is the property worth understanding: because the session key
is ephemeral, recording today's traffic and stealing the server key next year
does not decrypt it.

### Configuration

| Setting | Value |
| --- | --- |
| Minimum version | TLS 1.2. TLS 1.3 preferred, and it is faster |
| Cipher suites | Forward-secret only (ECDHE) |
| Certificate | RSA 2048 or ECDSA P-256 |
| HSTS | `max-age=31536000; includeSubDomains; preload` in production |
| OCSP stapling | On, so clients need not contact the CA |

TLS 1.0 and 1.1 are deprecated. So are RC4, 3DES and anything without forward
secrecy.

### Certificates

**Let's Encrypt via ACME**, automated. 90-day certificates renewed at 60 days.

Short lifetimes are a feature: they force automation, and automation is what
prevents the classic outage where a certificate expires because the person who
renewed it manually has left.

| Type | When |
| --- | --- |
| Single domain | One hostname |
| Wildcard (`*.almajeed.example`) | Many subdomains. Requires DNS-01 validation |
| Multi-domain (SAN) | A few specific hostnames |

Extended validation certificates are not worth paying for. Browsers stopped
showing the distinctive indicator years ago, and no user has ever checked.

### Where TLS terminates

```
Browser ──TLS──► Load balancer ──?──► Application
```

Terminating at the load balancer is normal and simplifies certificate
management. The question is the second hop.

Inside a VPC on a private subnet, plaintext is usually accepted. Between
availability zones, or anywhere the network is shared, it should be encrypted —
"internal network" is not a security boundary, and a misconfigured peering or a
compromised neighbour is not hypothetical.

The API-to-database hop is the one people forget, and the one this system
enforces: the configuration refuses to start in production with
`DATABASE_SSL=false`.

### HSTS

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

Tells the browser to use HTTPS for this domain for a year, even if a link says
`http://`. It prevents the downgrade attack where an attacker intercepts the
initial plaintext request.

Two cautions. `includeSubDomains` applies to every subdomain, so a subdomain
that genuinely needs plaintext breaks. And `preload` submits the domain to a
list baked into browsers, which is **effectively irreversible** — removal takes
months to propagate.

The application sends HSTS in production only. Sending it in development pins
`localhost` to HTTPS in the browser and produces a confusing afternoon.

### Verifying it

```bash
openssl s_client -connect erp.almajeed.example:443 -servername erp.almajeed.example
echo | openssl s_client -connect host:443 2>/dev/null | openssl x509 -noout -dates
testssl.sh https://erp.almajeed.example      # the thorough option
```

Or SSL Labs, which grades the whole configuration and explains each deduction.
Aim for A or A+; anything less usually means an old protocol version or a weak
cipher suite is still enabled.

### Failure modes

| Error | Cause |
| --- | --- |
| `NET::ERR_CERT_DATE_INVALID` | Expired. Automation failed and nobody noticed |
| `NET::ERR_CERT_COMMON_NAME_INVALID` | Certificate does not cover this hostname |
| `NET::ERR_CERT_AUTHORITY_INVALID` | Self-signed, or a missing intermediate |
| Works in a browser, fails in curl | Missing intermediate certificate. Browsers fetch it; other clients do not |

That last one is worth internalising: the chain must be served complete. A
browser will paper over an incomplete chain by fetching the intermediate itself,
so the problem only appears when a server-to-server client fails.

## Monitoring

Both DNS and TLS fail silently until they fail totally:

- Certificate expiry, alerting at 21 days
- Domain expiry, alerting at 60 days
- DNS resolution from multiple external locations
- Certificate transparency logs, so a mis-issued certificate for your domain is
  noticed
