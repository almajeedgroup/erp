# Linux

The parts that actually matter for running this system. Not a tutorial —
a map of what you will reach for and why.

## Why it is under everything here

The containers run Debian (`node:22-bookworm-slim`). The database runs on Linux.
CI runs on Linux. Even development on macOS or Windows runs the containers in a
Linux VM. Understanding the model is not optional for operating this.

## Processes and signals

The single most important thing for a containerised service.

When an orchestrator deploys a new version it sends **SIGTERM** to the old
container and waits — typically 30 seconds — before **SIGKILL**. A process that
exits immediately on SIGTERM drops the requests it was mid-way through, which
users experience as random 502s during every release.

So the API handles it:

```ts
process.on('SIGTERM', () => shutdown('SIGTERM'));
// stop accepting connections → let in-flight requests finish → close the pool → exit
```

With a 15-second backstop, because a hung request should not prevent the
shutdown entirely.

**This only works if the process receives the signal.** Signals go to PID 1 in
the container. If the container runs `npm start`, npm is PID 1 and node is a
child — npm does not forward SIGTERM, and the graceful shutdown never runs. That
is why the Dockerfile says:

```dockerfile
CMD ["node", "apps/api/dist/index.js"]
```

and not `CMD ["npm", "start"]`. It is a one-word difference that decides whether
every deploy drops requests.

| Signal | Meaning | Catchable |
| --- | --- | --- |
| SIGTERM (15) | Please stop | Yes — this is the one that matters |
| SIGINT (2) | Ctrl-C | Yes |
| SIGKILL (9) | Stop now | No |
| SIGHUP (1) | Terminal closed; conventionally "reload config" | Yes |

## Users and permissions

Containers run as a non-root user. `node:22-bookworm-slim` ships a `node` user
at uid 1000, and the Dockerfiles use it:

```dockerfile
RUN mkdir -p /var/lib/erp/storage && chown -R node:node /var/lib/erp
USER node
```

Root in a container is not root on the host — user namespaces and capability
dropping see to that — but it is one misconfiguration away from being much
closer than you would like, and a Node process has no reason to have it.

Permission bits, briefly: `rwx` for owner, group and others. Uploaded files are
written `0600` — owner read/write, nobody else anything.

## The filesystem

| Path | Contents |
| --- | --- |
| `/app` | The application, in the container |
| `/var/lib/erp/storage` | Uploaded documents, when using the local driver |
| `/var/log` | Logs, on a traditional host. In a container, logs go to stdout |
| `/etc` | Configuration |
| `/proc`, `/sys` | Kernel interfaces, not real files |
| `/tmp` | Scratch, wiped on restart |

**Container filesystems are ephemeral.** Anything written inside a container
without a volume is gone when it restarts. This is why the local storage driver
needs a mounted volume in compose, and why object storage is the right answer in
production.

**Logs go to stdout.** Not to a file. The platform collects stdout, so a file
would be a log nobody reads that eventually fills the disk.

## Environment variables

How configuration reaches the process. Set by the orchestrator, read once at
boot by `loadConfig()`.

Two properties worth knowing. They are inherited by child processes, so a secret
in the environment is visible to anything the process spawns. And on many
systems they are readable from `/proc/<pid>/environ` by the same user — which is
why the recommendation for the most sensitive secrets is a mounted file rather
than an environment variable.

## Resource limits

A container gets a CPU and memory allocation. Exceeding memory does not slow the
process down; the kernel's OOM killer terminates it, abruptly and without
warning in the application's own logs.

For a Node service:

```
--max-old-space-size=<about 75% of the container limit>
```

Node's default heap limit does not know about the container's limit, so a
container with 512 MB and a Node process that thinks it has 2 GB will be killed
rather than garbage collect.

Relevant here because document uploads buffer in memory. A 25 MiB limit with
several concurrent uploads is real memory pressure.

## Networking

| Concept | Relevance |
| --- | --- |
| Ports | 4000 (API), 3000 (web), 5432 (Postgres) |
| localhost vs 0.0.0.0 | Binding to `127.0.0.1` inside a container makes it unreachable from outside. Hence `API_HOST=0.0.0.0` |
| Service names | In compose, `db` resolves to the database container. `localhost` would be the container itself — the classic first-run confusion |
| File descriptors | Each connection is one. The default 1024 limit is low for a busy server |

## Diagnosing a problem

The commands that actually get used, roughly in the order you reach for them:

```bash
docker compose ps                     # what is running, and is it healthy
docker compose logs -f api            # what is it saying
docker stats                          # CPU and memory, live
docker compose exec api sh            # get inside

# Inside a container or on a host:
ps aux                                # processes
top / htop                            # live resource use
df -h                                 # disk space — a surprisingly common cause
free -h                               # memory
netstat -tlnp / ss -tlnp              # what is listening
curl -sD - -o /dev/null localhost:4000/health
```

Two failures worth recognising immediately:

**Disk full.** Writes fail in confusing ways — Postgres refuses to write,
uploads fail, logs stop. `df -h` first, always.

**Out of file descriptors.** "EMFILE: too many open files". Usually a connection
leak rather than a genuine limit.

## Cron, and why not to use it here

Scheduled work — retention purges, token cleanup, report generation — could be
cron. It should not be, in a containerised deployment: cron inside a container
means the container is doing two jobs, and cron on the host means work that is
not versioned with the application.

The right shape is a scheduled job the orchestrator runs (ECS scheduled task,
Kubernetes CronJob, Cloud Scheduler), invoking the same image with a different
command. That is how the retention job should be built when it is built — see
[data privacy](../03-security/data-privacy.md).

## What is genuinely worth learning

If this is unfamiliar territory, the highest-value 20%:

1. Signals and process lifecycle — the deploy story above
2. File permissions and ownership — the container security story
3. `df`, `ps`, `top`, `ss` — the diagnosis story
4. Pipes and redirection — because every log investigation is `grep` and `jq`
5. Environment variables and shell startup — because configuration is
   environment variables

Everything else can be looked up when needed.
