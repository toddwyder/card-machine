# Julia server runbook

Linear holds cards and requirements. GitHub holds code, pull requests, and CI. Mastra Factory is retired; do not use it as a server route.

## Authority

Todd's latest card decision controls server changes. Ask Todd only for an indispensable account action, spending beyond the card cap, or a household product decision.

Do not restore `julia-agent`, the old learning helper, the retired build service, the former root control deployment, or the old machine kept at tag `old-machine-final`. Do not repeat the completed one-time vault bootstrap.

## Agent commands

Run commands that need Julia credentials through this wrapper from the repository root:

```sh
node scripts/julia-agents.mjs -- <command> [args...]
```

The wrapper reads `/home/ubuntu/.config/julia-agents/service-account-token`, clears inherited 1Password authentication overrides, and invokes `op run --env-file=scripts/julia-agents.env`. It then runs the command through `scripts/linear-token.mjs`, which trades the "Julia controller" app's client pair for a Linear access token at the start of every run and passes it as `LINEAR_API_KEY` in the form `Bearer <token>`, so no long-lived Linear key sits on the machine. Never print credentials, OAuth links or codes, pairing material, or raw credential-bearing subprocess output.

## Starting a card in Studio

Studio's agent list includes **Lead**, the existing Flow build Agent. Its instructions are the complete repository poteto-mode skill, loaded when Studio creates the Agent. Open Lead's chat and type the task and its stop point. For a build that stops at the pull request, include "Stop when the pull request is open and up to date. Shipping runs separately."

Lead reads its model from `~/.config/julia/lead-model`, independently of the coder's pstack role. Run `node scripts/install-lead-model.mjs` once to create the initial setting. It preserves an existing file. The setting holds one paid model id (`<provider>/<model>`) and uses Mastra Code's ChatGPT login. The Lead reads the file at each model call, so an edit reaches the next call with Studio left running. A missing setting prevents Lead from starting and names the installer command. See [the Lead build record](jul-339/build.md) for the dated model choice and acceptance checks.

Mastra prices a run from its own copy of models.dev. `julia-studio.service` turns the daily refresh on
with a drop-in (`~/.config/systemd/user/julia-studio.service.d/pricing.conf` sets
`MASTRA_AUTO_REFRESH_PRICING=true`); without it Mastra reads only the price table installed with the
program. The run record and the model picker read the same refreshed copy, so a price corrected at
models.dev reaches both at once.

The `card-path` workflow begins in Mastra Studio's run form. No script starts a card.

```sh
cd /home/ubuntu/julia-builder
node scripts/julia-agents.mjs -- npx mastra dev
```

Run it from the repository root: the CLI looks for `src/mastra/index.ts` there. The server answers on
`:4111` by default. `FLOW_DIR` is where the run's state (`state.db`) and trace (`trace.duckdb`) are
written, and it defaults to `.artifacts/flow/studio` under the repository; set it to an absolute path
to keep runs apart. The repository the machine itself runs from is `FLOW_REPO`, default the working
directory. The target project checkout a card builds in is `FLOW_PROJECT_REPO`, and its GitHub
`owner/name` slug is `FLOW_PROJECT_GITHUB_REPO`; both are required at start-up and must be set.

In Studio, pick the `card-path` workflow and press run. The form asks for `card` and `kind`
(`product` or `machine`) and nothing else; the workflow copies both into saved state and opens
`<FLOW_DIR>/<card>/` for that card's artifacts, verdict queues and stop report.
Because the saved state starts empty, a run started here needs no preparation.
Each card slice starts under a built-in $4 spending limit (`COST_LIMIT_DOLLARS` in `machine/flow/agents.mjs`, overridable with `FLOW_CARD_LIMIT_DOLLARS`). Studio enforces no token cap and does not read `FLOW_DOLLAR_CAP` or `FLOW_TOKEN_CAP` from the environment.

A card that waits for Todd is answered from the command line, which reads the card out of the run's
saved snapshot:

```sh
node machine/flow/run.mjs status --dir .artifacts/flow/studio --run-id <run id>
node machine/flow/run.mjs resume --dir .artifacts/flow/studio --run-id <run id> --answer yes
node machine/flow/run.mjs cost --dir .artifacts/flow/studio
```

`docs/agents/machine-programs.md` names every program that starts a card or carries a stage, and
`node scripts/machine-programs.mjs --check` fails a pull request that changes one without updating
the list. Run `node scripts/machine-programs.mjs --write` and commit the list with the change.

`npm run check:studio` boots its own Studio server on a spare port, reads the run form back from
`/api/workflows`, and fails unless it asks for `card` and `kind` alone. It needs the project folder to
itself, so stop any Studio server already running here first; it is not a CI check because it fetches
the CLI and takes about a minute.

## The dashboard service

There is no dashboard service anymore. `julia-dashboard.service`, its update, watchdog and sweep
timers, and its environment file are gone: the dashboard folder under `/home/ubuntu/julia-dashboard`
is kept together with JUL-410, which owns the address it used to answer on, and the Run view Todd
opens is served by `card-machine-run-view.service` (see below). Nothing in the nightly cleanup
removes the folder; the card that moves its address does.

## Merging a dashboard pull request

Merging is the whole step: `gh pr merge <number> --squash --delete-branch`. Nothing on the server
needs a hand afterwards.

The unit follows `origin/main`, and the updater moves the deploy checkout onto `origin/main`
itself before it installs, builds and restarts. That includes a squash merge, where the new
`main` commit is not a descendant of the branch tip the checkout was serving: the updater detaches
onto the ref instead of comparing ancestry, so there is no fast-forward to arrange and no ref to
put back. A branch ref given to the installer is used for one sync run and is never written to
`/etc/julia-dashboard.env`.

Within five minutes the update timer runs; `cat /var/lib/julia-dashboard/state/build.json` then
names the merge commit and `/api/health` reports `ok`. The update service writes `code: idle` when
it is free to update, and `code: active-run` with the run it waited for when a build is in flight,
in which case the next timer run does the work.

## Scratch and daily maintenance

Throwaway copies use `~/.local/state/julia-scratch` by default. Studio run state stays
in `.artifacts/flow` so a run waiting for Todd can resume after any number of days. The user tmpfiles configuration `~/.config/user-tmpfiles.d/julia-scratch.conf`
cleans entries untouched for three days. The disk check also sweeps `/tmp`, removing entries untouched for
24 hours except `/tmp/mc` and `systemd-private-*` folders, which belong to Mastra Code and to a live
service respectively. The stock `systemd-tmpfiles-clean.timer` runs daily.
User lingering is enabled, so user timers continue without a login. Inspect them with
`systemctl --user list-timers --all` and inspect cleanup with
`journalctl --user -u systemd-tmpfiles-clean.service`. `julia-disk-check.timer` also runs daily. Its unit file lives in `~/.config/systemd/user`.
The disk check alerts Todd on JUL-276 only when the machine fails to recover alone (below 10 GB free disk, below 1024 MB available memory, or leftovers remain after cleanup) through the Julia controller account.
Inspect its result with `journalctl --user -u julia-disk-check.service`.

The check wakes Studio before it judges anything: if the Studio address refuses, it starts `card-machine-studio.service` and waits up to 30 seconds for an answer. Studio runs under `mastra dev`, which restarts on every change under the repository, so a check that ran while a card was being written would otherwise see a silent server. While Studio stays silent the check deletes nothing at all: every item is kept with the reason `Studio unreachable`, and the run reports FAIL so the silence is visible. Cleanup decisions need Studio's answer because that answer is what says which cards are running, waiting or resumable.

Disk reclaim waits for a quiet server too: it runs only when Studio answers and no card is running, because a card's build is what fills the image list, the package caches and `/tmp`. It reports the wait as a problem and frees nothing rather than guess.

Each state file under `.artifacts/flow/studio` is kept, as are the checkouts and services the machine is built from. Files a live process holds open are kept too. A fixed list would go stale, so `scripts/server-in-use.mjs` asks: a user or system unit is in use when it is named in `IN_USE_SPEC`, a process is in use when it belongs to one of those units, to a terminal a person is using, or to a running card, and a folder is in use when a named current use points at it. An enabled unit whose `ExecStart` or `WorkingDirectory` points into the old setup is a leftover, unless its name is in `IN_USE_SPEC` — the unit that owns that address has to move it, not the nightly cleanup. The Studio folder itself is never pruned: `trace.duckdb` is what the Run view reads, so it stays even when no card is running.

### The Run view service

`card-machine-run-view.service` serves the Run view Todd opens at `https://ovh.tail91f394.ts.net/control`, from `dashboard/` on port 4314 with `FLOW_DIR` set to the Studio folder. It is a user unit, enabled, and restarts itself every five seconds if it stops. `scripts/server/card-machine-run-view.service` holds the copy to install, and `tailscale serve` maps the path to `http://127.0.0.1:4314/control` (the address needs the `/control` suffix, because the app serves its own base path).


### `/tmp/mc` belongs to Mastra Code and is never deleted

Mastra Code keeps its cross-process signal sockets under `/tmp/mc`, one of them the lease socket
that says which process owns a thread, and it keeps the socket of a run that is still going
(`@mastra/code-sdk/dist/utils/signals-pubsub.js:5`). The stock `/tmp` rule removes anything there
older than 30 days and the boot pass clears the directory, so on 13 November a cleanup that deleted
`/tmp/mc` aborted every run in progress: the lease lookup failed, and the memory step reported it as
`Processor "observational-memory" stopped the run: Agent execution was aborted`, which is not what
it looked like. `/etc/tmpfiles.d/mastracode.conf` excludes the folder from every cleanup rule; the
repository holds that file as `scripts/server/mastracode-tmpfiles.conf` and installing it is the one
step needed on a new server:

```sh
sudo install -D -m 0644 scripts/server/mastracode-tmpfiles.conf /etc/tmpfiles.d/mastracode.conf
```

`systemd-tmpfiles --cat-config | grep tmp/mc` shows the exclusion is in force. No cleanup script of
ours may remove `/tmp/mc` either: an idle folder is safe, a running session's folder is not, and
telling them apart means finding its sockets in use.

## Mastra Code's trace store

Mastra Code opens its trace store once, at startup, and DuckDB lets one process write a file. The
stock install keeps one store, `~/.local/share/mastracode/observability.duckdb`, and a session that
starts while another holds it gets no tracing at all, silently, for its whole life
(`@mastra/code-sdk/dist/index.js:323`), so its tokens and cost are never recorded and the card priced
from it reads unknown. Run one traced session at a time; a session started while another is open is
the one that loses its rows. `MASTRA_APP_DATA_DIR` moves the store with the rest of the data.

Trace size is held by Mastra's storage retention (`retention.observability`), which `machine/flow/mastra.mjs` prunes at the end of every card.

That retention does not hold Mastra Code's own store. Its stock install prunes rows on every session open (14 days, at most 50 000 rows a table), and DuckDB keeps the pages those rows used, so the file only grows: on 26 November it held 13.2 GB after eleven days, about 1.2 GB a day, and it was the measurement behind JUL-417's disk growth. Two facts follow. `scripts/disk-reclaim.mjs` deletes the store only when no process holds it open and it is over `MASTRACODE_TRACE_MAX_MB`, because deleting a file a session holds frees nothing until that session exits. And `observability.localTracing` in `~/.local/share/mastracode/settings.json` switches the store off entirely; it is `false` on this server, so a session started from now on records no local traces. The card-path trace in `.artifacts/flow/studio/trace.duckdb` is a different file and is untouched by either.

Reading a trace file by hand needs a DuckDB client from somewhere that has one installed, because the
repo root does not. The dashboard's dependencies carry one, and so does the installed program:

```sh
node -e "const {createRequire}=require('node:module');const r=createRequire('/home/ubuntu/julia-dashboard/dashboard/package.json');const {DuckDBInstance}=r('@duckdb/node-api');..."
```

Four facts that cost failed runs on 30 October: `connection.runAndReadAll(sql).getRowsJS()` returns rows as arrays, not objects (`getRowObjectsJson` does not exist on the reader); values come back as `BigInt`, so `Number()` them before arithmetic; `duckdb_tables().estimated_size` is a row count, not bytes, so measure payloads with `sum(length(cast(column as varchar)))`; and `octet_length` is not implemented for `VARCHAR` here, so cast first. A connection holds a file's lock until it is closed, so close the connection and then the instance.

## GitHub boundaries

Use ordinary signed-in GitHub access for authorized cards. Keep authentication material inside its trusted process. Evidence and notes belong on the card branch and pull request.

## The runner's own GitHub identity

The runner is a GitHub App named **Julia Runner**, slug `julia-runner`, id `5561742`, installed on `julia-next` only. Its credentials came from GitHub's manifest flow on 1 November 2026 and sit in `/home/ubuntu/.config/julia-runner` at 0600 in a 0700 directory.

- `app.json` holds the app id, client id and client secret.
- `private-key.pem` holds the App's private key.
- `installation.json` holds installation `177375308`.
- `setup-status.json` holds the four steps of the setup run.

GitHub granted it checks write, statuses write, pull requests write, contents write and metadata read. Anything it opens is authored `julia-runner[bot]`: pull request 399 was the first, on `runner/identity-proof`.

To act as the runner, sign an RS256 JWT with `private-key.pem` (issuer is the app id, expiry within ten minutes), trade it for an installation token at `POST /app/installations/177375308/access_tokens`, and call the API with that token. A personal token cannot do this: `POST /check-runs` answers 403 for one.

The page that created the App was a one-off script, never a service. It ran on 1 November 2026, wrote these four files and stopped; nothing on the server starts it, and its code lived only in the closed pull request 398.

## Update notifications

`scripts/update-report.mjs` posts Julia update alerts to the ntfy topic named in `/home/ubuntu/.config/julia-runner/ntfy.json`. On ntfy.sh the topic name works as a password: anyone who knows it can read the alerts and post to it. It stays in that file and is never written in the repository.

Join the topic on a new device by reading the name from that file on the server, then:

- Desktop Chrome: open `https://ntfy.sh/<topic>` and allow notifications when the browser prompts you.
- Android: install the ntfy app and subscribe to `<topic>` on `ntfy.sh`.

To verify delivery after subscribing, post a test message from the server:

```sh
curl -H "Title: Julia update test" -d "Test notification from Julia." "$(jq -r '.server + "/" + .topic' /home/ubuntu/.config/julia-runner/ntfy.json)"
```
