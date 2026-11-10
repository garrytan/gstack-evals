---
id: 2026-11-04-geva-286-u4-session-driver
kind: plan
title: "G admission harness: the U4 session driver (GST-1381), real_agent on U4 slots and a keyless dry run"
summary: "One O6-admitted U4 lease per G admission stage and one metered slot per session; real_agent runs G sessions only on such a slot. A keyless dry run closes #212's L7 and Z1 notes."
author: GEVA-286
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-04
status: open
links:
  - 2026-11-04-geva-262-g-family-admission-prereg
  - 2026-11-04-geva-282-g-o5-pin
  - garrytan/gstack-evals#212
  - GST-1381
  - GST-1374
  - GST-1401
---

# G admission harness: the U4 session driver (GST-1381) and its keyless dry run

GEVA-286 for the gstack-evals Captain (GSTA-2). Issue GST-1381, beside GST-1374 (bug fixes, no plan). Code PR from main, gate class (money and the merge checks).

## ELI5

G's admission check pays for about 80 Claude Code sessions. The prereg says every paid G stage must spend through a U4 ledger lease that O6's envelope admitted, and never through Lane B's older session ledger. Today the session agent (real_agent.py) still opens its sessions on Lane B's ledger, so no paid G stage may start.

This work builds the missing piece: a small service, the session driver, that opens each admission stage's U4 lease through O6 before the stage's first session, gives every session its own metered slot on that lease capped at the session's dollar limit, and always settles the lease when the stage ends, whether it finished, failed, hit its cap or crashed. real_agent learns to ask the driver for its slot and refuses to run a G session anywhere else.

A free rehearsal, the dry run, then drives the whole path with fake models: the real agent code, a stub Claude Code and a stub provider. It also closes three notes left on #212: it prices the metered stages from the stub provider's own record instead of the proxy's meter, it counts more kinds of leftover containers and volumes, and it runs that leftover count even when the run fails.

Nothing here spends money or calls a model.

## Before → after

- **Before:** real_agent.py opens each session at Lane B's /sessions route, a JSONL ledger O6 can't see. Prereg section 10 item 4 forbids that for every paid G stage, and #212 left it open as start condition 2. #212's dry run also priced the metered stages with the proxy's own meter, counted only gstack-evals-* containers and ran its leftover check only on a passing run.
- **After:** one driver process per admission batch opens one U4 lease per metered stage through O6 (admit and reserve in one step), binds each session to its own metering-proxy slot at the arm's session limit, refuses a session the lease can't cover, and settles every lease on every exit path, including after a crash. real_agent runs G sessions only on a U4 slot. A keyless dry run drives it end to end through the real pinned Agent SDK and Harbor, with seeded faults shown failing first.

## Why it matters

A paid stage that spends outside the envelope can pass the program's $10,000 or a skill's $2,000 without anyone seeing it until the money is gone. A lease left open holds envelope room until someone reconciles it by hand. This driver is the last code start condition before G admission spends.

## What caused this work

- GEVA-282's R65 gate on the O5 post (d2) found that nothing ties admission sessions to a U4 lease, and the Captain made it start condition 2 (GST-1381).
- #212's pass 2 left three accepted notes (L7 and Z1) that must close before any G admission spend.
- GST-1374's three fail-closed refusals ride the same PR as bug fixes, outside this plan.

## Big decisions

1. **d1. Lease per stage, slot per session (rec A; the Captain chose A, C1 at the gate).** A: each metered admission stage (none, told plan-eng-review, told autoplan) gets one U4 lease at its prereg cap, which O6 admits and reserves before the stage's first session; each session is one metering-proxy slot on that lease with the arm's session limit as its allowance. B: one lease per session at the session limit. B reserves one session at a time, so a stage is never reserved whole before it starts, which prereg section 9 requires ("Cap, reserved by O6 before the stage starts") and docs/budget-ledger.md assumes ("each lease on a program's item is the stage's reservation"). B also needs a fresh rig admission record per lease on a required item (26 per arm) and serializes each arm. B would change a frozen rule, so it needs the Captain first. What would flip it: the Captain amending section 9 to per-session reservations.
2. **d2. real_agent asks the driver for its slot (rec A).** A: the driver serves the same /sessions open and close shape real_agent already speaks, on loopback, backed by U4; the open answer carries the lease, the meter and the slot's base URL, and the bearer lives only in memory and the agent's env. B: the driver binds slots itself and passes them to Harbor as agent arguments, which writes the bearer into Harbor's job config and logs, which the proxy contract forbids.
3. **d3. Crash recovery on relaunch (rec A).** A: a relaunched driver settles a lease its own run left open on this machine: it reconciles that lease's proxy journal (a call with no recorded outcome keeps its full reservation, and is never resent), settles the lease, and only then opens a fresh lease on what the item has left. It refuses a lease another machine holds, and reconcile refuses while the old proxy still holds its journal lock. B: leave the stale lease to the owner's `ledger reconcile` after it expires, which holds up to a stage's whole cap in the envelope until then.
4. **d4. The dry run lives in the repo as code, with no wiki post (rec A).** A: lanes/outcome-skills/driver/dryrun.ts with seeded-fault tests under tests/, its printed lines recorded in the PR body. Prereg section 10 item 4 is a rule checked at run time, so it needs this code merged, not a post, and #212's note already says the G admission post states L7's and Z1's exact scope. B: a wiki post carrying the script as a .sh.txt attachment, as O5 did, which adds a post review and pins nothing a later run reads.
5. **d5. G's three-turn script is a separate start condition (rec A; the Captain chose A and filed it as GST-1401).** Found while planning: real_agent sends only the real-outcome lane's build and ship turns. Nothing sends the registry's G turns t1 to t3, or records each message's phase and parent_tool_use_id, which the exposure detectors need (registry.json's comment). A: name it as a new open start condition for the Captain to assign; the dry run drives real_agent with stand-in arms that carry the registry's G arm names and limits. B: build it here, which is a scored-path change (exposure reads it) inside a money-class PR.

## Implementation plan

### 1. Scope and what stays

The driver is new code in lanes/outcome-skills/driver/. It reuses, unchanged: the U4 ledger (src/runner/ledger: openLease, which calls O6's admitLease; settleLease; ledgerStatus; envelopeStatus), the metering proxy (src/runner/proxy/metering-proxy.ts: MeteringProxy, reconcileJournal, problem) and the arm registry (lanes/outcome-skills/arms/registry.ts). Two small additions outside the new folder: LocalLedger gains two public reads, `held(lease_id)` (today private) and `meters(lease_id)` (held micro-dollars and settled token usage per meter id), so the driver reads committed spend from the ledger itself; and src/cli.ts gains one row, `outcome`, for lanes/outcome-skills/cli.ts. No frozen number, rule, price row or prereg file changes. quick/laneb/ and resize.py are not touched.

### 2. The driver (lanes/outcome-skills/driver/stage.ts)

`serveStages(o)` runs one admission batch on the program's envelope host. Inputs: the approval record and local ledger paths, the run id, the envelope host's machine id (`--envelope-host`, from the program's approvals entry), stages `{ item, arm }` (for G: the none, told plan-eng-review and told autoplan items), the planned sessions and gap reruns per stage (default 24 and 2, prereg section 9), the trial-network host for the proxies (a loopback or private IP), a control-plane port, a run directory, the lease TTL (default 72 hours, at most the ledger's 7 days), the proxy retry budget (default 3 attempts in 300 s, the skill-eval host run's), and, for tests only, `fetch` and `requireAdmission`.

1. **Host.** It refuses to start (exit 2, E_USAGE) unless this machine's id equals `--envelope-host`: the driver writes envelope entries, which have one winner only on the envelope host's local disk.
2. **Recover.** Every lease in the local ledger that names this run and this machine and is still open or closing is recovered first, whatever stages are listed: reconcileJournal on `<run dir>/<lease id>.journal.ndjson` (it takes the journal's lock, so it refuses while the old proxy lives; a missing journal prints JOURNAL_MISSING and the settle charges every unanswered call at its full reservation), then settleLease, then STAGE_RECOVERED. Each lease is recovered in its own try, so one failure does not skip the others; any failure exits 2 with E_LEASE_UNSETTLED before a new lease opens.
3. **Preflight, then open.** Before writing any lease, it checks every stage: the item has a cap, is bound to no other run and has no open lease; on an item initialized with an admission mode, the next slot's admission record (requireAdmission on the prospective lease file, as openLease would run it); and envelope room for the sum of every stage's amount, per skill and for the program (envelopeStatus). A predictable refusal therefore exits 2 with its code (E_RIG_UNPROVEN naming the slot and the `gstack-evals rig admit` command, ENVELOPE_SKILL_STOP, ENVELOPE_PROGRAM_STOP, E_ITEM_BOUND, E_LEASE_UNSETTLED or CAP_STOP) and burns no slot. Then, for each stage in order, `openLease(record, local, { item, run_id, ttl_ms, warn })` with no amount, so the lease takes everything the item has left; openLease admits it against O6's envelope and writes it in one atomic step. If a lease is still refused (a rival admission between preflight and open), every lease this call opened is settled at once at $0 and the driver exits 2. RIG_UNPROVEN on a warn item is printed, as the ledger CLI prints it.
4. **Proxies.** One MeteringProxy per stage lease, with its own journal (`<run dir>/<lease id>.journal.ndjson`), management socket and random management token, listening on the trial-network host.
5. **Control plane.** HTTP on 127.0.0.1 only (any other bind is refused). Every refusal is the proxy's problem body, code first, with the values that decided it (arm, cap, room, expiry, counts) and the recovery to take; `GET /status` answers JSON (each stage's lease, room, live and finished sessions, state).
   - `POST /sessions` with `{ trial, model, cap_usd, meta: { arm, task, trial_n, rerun? }, open_key, ledger: "u4" }`. Refused 400 E_USAGE: an arm not in the batch, a model other than the registry's pinned claude-opus-5-5, a cap_usd other than the registry's session_cap_usd for that arm, a missing task or trial_n. Refused 422 E_USAGE: a second open of the same (arm, task, trial_n) without `meta.rerun` naming a repair, a third open of it, a stage past its planned sessions plus reruns, or past its reruns. The same `open_key` returns the same answer while the session is open (real_agent's own open retries never bind a second slot); after close it is 400 E_USAGE carrying the closed answer; with a different body it is 400 E_USAGE. Room, computed in the same synchronous step as the bind with no await between: the lease's reserved amount, less the ledger's `held` for the lease, less, for each live slot on it, its allowance less its own held spend (never below 0), must cover this session's allowance. If not: 409 CAP_STOP (do not retry; the stage ends incomplete), and the cap-stop scope below applies. If the lease expires before now plus the arm's wall_limit_sec plus 120 s: 503 E_LEASE_CLOSED (retry after a driver relaunch reopens the stage), and the stage drains: it refuses every later open the same way and settles when its last live slot closes. Otherwise it binds a slot with `models: ["anthropic:claude-opus-5-5"]` and the registry's allowance, and answers `{ id, token, base_url: "http://<host>:<port>/<slot>/anthropic", ledger: "u4", item, lease_id, meter_id, allowance_micros }`. The bearer is held only in memory.
   - Each slot has a deadline at bind: the arm's wall_limit_sec plus 120 s. At it the driver unbinds, finalizes and closes the slot with reason `deadline`, so a slot whose real_agent died or whose open was cancelled stops counting and its bearer dies.
   - `POST /sessions/<id>/close` with `{ reason }`: unbind (the bearer is revoked at once), finalize the meter (up to the proxy's 30-second default for calls in flight), and answer the fields real_agent and Lane B's teardown read: `spent_micros` (spent plus unknown calls at their full reservation), `usage` in Anthropic's token names from the ledger's settled reservations for that meter, `requests`, `ok_responses` (2xx answers), `refused`, `unknown`, `undrained`, `unsettled`, `lease_id`, `meter_id`. A second close returns the first answer. Each open, close and refusal appends one line to `<run dir>/sessions.jsonl` (never a bearer), the per-session record admission's item 5 reads beside the ledger.
   - `POST /stop`, SIGTERM and SIGINT start the stop below.
6. **Stop and settle, on every exit path.** Stop is idempotent and runs on a normal stop, an exception anywhere in the driver, a signal, and for one stage when a cap-stopped or draining stage's last live slot closes. Per stage, in its own try: refuse new opens, close every live slot (reason `stage_stop`), stop the proxy, reconcileJournal on its journal, then settleLease into the record. Last it reads ledgerStatus for every stage item and exits 0 only if none has an open lease; otherwise it prints E_LEASE_UNSETTLED with each lease id and exits 2. It prints one STAGE_SETTLED line per stage: item, lease, spent, unknown, sessions, how it ended (completed, cap_stop, lease_expired, failed) and the cap-stop scope.

**Failure-scoring rules, settled here (the Captain's D1 and E1).**
- A 409 CAP_STOP at open is a stage cap stop: the session never starts, makes no model call and is not retried. A cap stop on the none stage ends both skills incomplete and stops every stage, since none is both skills' control. A cap stop on a told stage ends that skill incomplete and stops only its stage; none keeps serving while the other told stage runs, and stops once no told stage is left.
- Lease expiry is not a cap stop: the stage drains with 503 E_LEASE_CLOSED, sessions it could not run count as gaps (rig), and a driver relaunch reopens a lease on what the item has left for the same run (docs/budget-ledger.md, "the run settles its lease and resumes on a new lease for the same run"). At the 72-hour default TTL against prereg section 9's 40 host hours it should not fire.
- A session that hits its own allowance is an arm stop under the lane's taxonomy (prereg section 5); the driver only records the E_ALLOWANCE refusals in the meter. Any other session failure closes its slot like any other, and its spend stays on the lease.
- A driver crash fails every live session; those sessions are gaps whose named repair is "driver relaunch", rerun under the batch's rerun rule (at most 2 an arm, prereg section 9). The driver never decides a gap; the batch controller does, from sessions.jsonl and the trial records.

### 3. real_agent.py

- New options: `ledger: Literal["laneb", "u4"]` (default `"laneb"`, so the real-outcome lane's own runs keep Lane B), and `task_label`, `trial_n` and `rerun` for the U4 open's meta. With `"u4"`, run() refuses a missing task_label or trial_n before the sandbox opens; the open body carries `ledger: "u4"` and `meta: { arm, task, trial_n, rerun? }`. The answer must carry `ledger == "u4"`, a `lease_id`, a `meter_id` and a `base_url` with the same scheme, host and port as the configured base URL (the one egress allows). Anything else is closed at once on the control plane and raised as E_REAL_SANDBOX_SETUP before any model call. The session's ANTHROPIC_BASE_URL is the answer's `base_url`, the slot's path on the proxy. A 409 stays real_agent's cap stop (never retried); a 503 is retried as its open loop already retries 5xx, then fails as infrastructure.
- An arms file in the outcome-skills registry's shape (it has `families`) with `ledger` not `"u4"` is refused at the start of run(), before the sandbox opens: G arms spend only through a U4 lease (prereg section 10 item 4).
- The close goes to the driver through Lane B's unchanged teardown (`/sessions/<id>/close`), whose fields the driver answers.

### 4. CLI

`gstack-evals outcome serve --run <id> --envelope-host <machine id> --stage <item>=<arm> [--stage ...] --host <ip> --dir <run dir> [--planned 24] [--reruns 2] [--control-port <n>] [--ttl-hours 72] [--ledger <path>] [--ledger-record <dir>]` prints `control=http://127.0.0.1:<port>` and one `stage=<item> lease=<id> proxy=<host>:<port>` line per stage once every lease is open, then serves until stopped. It takes no upstream override and no admission override: provider keys come from its environment as the proxy reads them, admission is the ledger's own rigAdmission(), and only the dry run injects a stub `fetch` and a stub admission check, in process.

### 5. The keyless dry run (lanes/outcome-skills/driver/dryrun.ts)

It runs at a given commit, exported with git archive outside any work tree, with every key variable unset, Docker for Z1 only, and no VM. Processes: a stub upstream that answers Anthropic Messages calls and logs every request it received and every answer it sent, with that answer's usage (its own record); the driver in a child process, with `fetch` pointed at the stub and a stub admission check that admits a slot only when the dry run wrote a marker for it; the real-outcome sandbox sidecar; and real_agent on the real pinned claude-agent-sdk 0.2.174 and Harbor f3a5a92, with the stub Claude Code (tests/real-outcome/fixtures/stub_claude.py gains a mode that sends N Messages calls through ANTHROPIC_BASE_URL with ANTHROPIC_API_KEY, or calls until refused) and the stand-in docker. Stand-in arms carry the registry's G arm names and limits with the lane's build and ship turns (the Captain's F1: G's three-turn script is GST-1401, not built here).

Stub usage: every answer has distinct usage with input, output, cache_read and cache_creation all non-zero, scaled from the request's own size so it never exceeds what the proxy reserved; most answers stream as SSE (message_start, then message_delta with usage), one in five is plain JSON.

On a temporary record with a stub gstack-approvals, it records the envelope ($10,000, $2,000 a skill, the six wave-1 skills) and all five prereg section 9 items at their caps (T-G $60, none $229, told plan-eng-review $572, told autoplan $1,287, VM $24; the three metered ones with `--admission required`), leases T-G and VM directly as O5 did, then checks, one line each, exiting at the first miss:

- **U1** the driver opens the three stage leases through O6 at their caps; with all five open the envelope holds $728.50 for plan-eng-review and $1,443.50 for autoplan.
- **U2** a second batch whose stages the envelope can't hold together (a $50 plan-eng-review stage and a $600 autoplan stage) is refused at preflight with ENVELOPE_SKILL_STOP and writes no lease on either item; a batch whose next slot has no admission record is refused with E_RIG_UNPROVEN and writes none.
- **U3** one real_agent session per arm through its slot: the answer is U4, real_agent's ANTHROPIC_BASE_URL is the slot URL, the stub's streamed and JSON calls are answered, close returns the meter, and real-summary.json and sessions.jsonl record it.
- **U4** a session per arm that calls until refused is refused with E_ALLOWANCE before its limit ($8, $20, $45): overshoot 0%, at most 10% (prereg section 9).
- **U5** on two small items of their own (none $10, told plan-eng-review $30), a none session that leaves less than $8 of room makes the next none open answer 409 CAP_STOP; real_agent raises its cap stop, makes no model call and is not retried; the told stage's next open is refused too (scope: both skills incomplete), and STAGE_SETTLED records it.
- **U6** real_agent with `ledger "u4"` against a Lane B-shaped control plane refuses before any model call and closes that session; real_agent with registry-shaped arms and `ledger "laneb"` refuses before the sandbox opens.
- **U7** on an item of its own with admission markers for slots 1 and 2: a driver killed with SIGKILL while the stub holds a call open, then relaunched with the same run: recovery reconciles the journal (that call is unknown at its full reservation), settles the old lease and opens slot 2 on what is left.
- **L7** (closes #212's first note) for every proxy item, call by call: the multiset of (usage, micro-dollars) of the ledger's settled reservations equals the multiset of the stub's own answers, each priced in the dry run itself from the frozen anthropic:claude-opus-5-5 row's per-token rates (Anthropic's input_tokens excludes cache tokens; rounded up per call), never from the proxy's meter. Each reservation the ledger holds as unknown must match a request the stub received and did not answer, and is counted at its reservation only; each lease's close equals the priced settled calls plus those reservations.
- **R1 to R4** GST-1374's refusals: meteredEnv refuses a missing M_PER, M_AP or AUTH_PAID and a set AGENT_USER; admitG refuses a told arm with no scored trial.
- **Z1** (closes #212's second and third notes) runs in the dry run's top-level finally, after every child process is reaped, on a passing run and on a failing one: no container named gstack-evals-*, gstack-mutation-prepare-* or gstack-mutation-run-*, no volume named gstack-mutation-*, and no open lease on the temporary record. The dry run starts one real busybox container (gstack-evals-dryrun-*) and one volume (gstack-mutation-dryrun-*) and removes them in its teardown, so Z1 checks a real teardown on the passing path too. A failed run prints its FAIL line, then Z1's line, then DRYRUN: fail.

Every new check has a seed (`--seed <name>`) that makes it fail: U1 a skill ceiling below the stages; U2 a batch the envelope can hold; U3 a driver answer without the slot URL; U4 a stub that reports more output tokens than max_tokens; U5 an item with room; U6 the Lane B-shaped answer with the guard bypassed; U7 a relaunch under another run id; L7 an extra reservation on a proxy lease that no stub answer accounts for, a stub record missing one answer, two calls' usage swapped, and cache_creation priced at the input rate; Z1 one leaked container per prefix, one leaked volume, one open lease, and an earlier failing check (Z1 must still print). The seeded tests are written first (tests/outcome-skills/driver-dryrun.test.ts) and fail before each check exists. The PR body records the seeded failures, then the real run ending DRYRUN: ok.

### 6. Tests (keyless, in CI where they need nothing)

- tests/outcome-skills/driver.test.ts, pure TS with a stub fetch: host check, recovery, preflight with no slot burned, all-or-nothing open, exact room with concurrent slots, CAP_STOP and its scope, expiry drain with 503, slot deadline, registry-checked allowance, task and trial uniqueness and the rerun cap, open_key rules, close fields, settle on stop, on an exception and on a signal, loopback-only control plane, problem bodies, no bearer in sessions.jsonl or the journal.
- tests/real-outcome/agent_test.py gains u4-mode cases (refusal of a non-U4 answer, base URL from the answer, missing task or trial, registry arms refused on laneb); its existing 12 cases stay as they are.
- The dry run's seeded tests above (Docker-gated for Z1, SDK-gated for real_agent, as agent.test.ts skips without the venv).

### 7. Outside terms

Any outside terms, licences or rights? The dry run uses claude-agent-sdk 0.2.174, whose Python code is MIT, and Harbor at f3a5a92 (Apache-2.0), as the existing agent tests do. The Claude Code CLI the SDK bundles is under Anthropic's own terms; the dry run never runs it (it runs the stub CLI) and redistributes nothing. Docker and busybox run locally; no model, provider or dataset is used. No new dependency enters package.json.

### 8. Stated limits

- The loopback control plane takes no credential: any process on the envelope host could open a slot. Any such process can already read the record and journals and run the ledger CLI, and a token would have to sit in Harbor's job config, so none is added (the Captain declined the Low).
- G's three-turn script, its phase and parent_tool_use_id records, and Harbor's trial retries pinned to 0 belong to the G rig, open start condition GST-1401.

### 9. Not in scope

GST-1401, T-G and its images, the envelope host itself, any paid call, approvals rows, quick/laneb/, resize.py, and every frozen number or rule.

### 10. Risks

- Harbor and the pinned SDK drift from what the dry run drives: the dry run runs the same pins docs/adapters.md names.
- A driver host that sleeps strands the three leases (up to $2,088 at section 9's caps): CREW's long-running-driver rule applies (run it detached on the awake envelope host named in the run's approvals entry), and recovery is the fallback.

## Review record

/autoplan --kind feature (R65 lean), run autoplan-20261105005356 on gstack 1.95.5.0: one Opus 5.5 reviewer at high effort read this plan against main and answered the outside-terms question. It raised 17 findings: 1 High, 10 Medium, 5 Low and 1 Informational, and found no path that spends outside an O6-admitted lease or past a lease's or a slot's limit. The gate (gate_rev 1) carried the High (L7's sums); the Captain (GSTA-2) took the recommendation on A1 through F1, asked for the Medium and Low fixes to be applied as well, and declined the Low on the loopback token, which stays as a stated limit. The Captain also agreed that one lease per stage, as section 9 sets it, is correct, and filed F1's start condition as GST-1401. This revision applies d1a (L7 call by call, distinct streamed usage, unknown calls matched, new seeds), D1 (expiry drains, not a cap stop), E1 (the cap-stop scope), F1 (GST-1401) and the Medium and Low fixes, without re-review, as the lean kind does.


## As built

The code follows the plan above, with these changes found while building it. None changes a frozen number or rule.

- **Each lease names its holder, and a run binds to one run directory.** The first dry run failed U1: the driver's recovery settled the T-G and VM leases, which the dry run had opened by hand on the same run id. Each lease the driver opens now names its holder in O6's record: the run directory's canonical path and a nonce minted for that launch. A run binds to the directory of its first lease that names a holder. A launch for that run from any other directory is refused with E_USAGE, with no override: the driver refuses it before it recovers anything, and O6 refuses such a lease when it is admitted, in the same step as the envelope check. Recovery settles only the run's open leases that this directory holds on this machine, and a stage item holding a lease of the run that names no holder is refused. So the bound directory's sessions.jsonl holds the run's 24 planned and 2 rerun trial counts. A first version wrote ownership lines to `<run dir>/leases.jsonl` around each open. Four review rounds showed that a run directory can't prove ownership that way without a hand repair that also forges it, so the Captain replaced it with this binding on 2026-11-05.
- **A cap stop is a ledger fact, and the run directory must account for the ledger.** Pass 2 of /ship found that emptying the bound directory's sessions.jsonl, or restoring a copy from before a cap stop, let a relaunch reopen a cap-stopped stage. The Captain ruled on 2026-11-05 that the ledger is the only trust root and nothing in the run directory counts as proof. The cap stop is written to O6's record when it fires: the driver writes a stop record in the lease's slot, fsynced, before it answers the 409 (a none stop writes one on every stage's item), and nothing rewrites or removes it. A settle from the machine's local ledger copies the stop's scope into the lease's close, and openLease and O6's admission refuse any new lease on that item with CAP_STOP. The first version of this fix wrote the stop only into the close at settle; its scoped fix-check showed that a driver killed during the drain, or a failed settle, still let a restored sessions.jsonl reopen the stage, and the Captain ruled for the stop record on 2026-11-05. Each launch appends its nonce to sessions.jsonl before its first lease, and each session's open line names its meter. A launch is refused with E_USAGE, before it recovers or opens anything, when the bound directory's sessions.jsonl names no launch for a lease the ledger holds for the run there, or no open for a session meter this machine's ledger holds for such a lease. So an emptied file, or a copy restored from any earlier point, can't serve the run.
- **Limits of the binding.** It binds by path. The account check reads session meters from the ledger of the machine that relaunches, so on another machine it checks launches only; the ledger's cap-stop refusal holds there too. O6's check is atomic within one program's entry slots, where it runs beside the envelope check; G's stages share one program, and a run whose leases span two programs is checked across them only by a read before the open.
- **A failed proxy start unwinds every lease the batch opened**, including the one whose proxy failed, at $0 (a unit test found the first version skipped it).
- **The control plane stops gracefully.** A forced stop reset the `POST /stop` answer; the driver now finishes in-flight requests before it exits.
- **Smaller seams:** envelope.ts exports its `split` so the preflight sums each skill's share exactly as O6 does; `deadline_grace_ms` (120 s by default) lets a unit test reach a slot deadline; every refusal, not only CAP_STOP, appends one line to `sessions.jsonl`.
- **The dry run adds U1b** (the batch driver's own stop settles its three stages, exit 0) and runs R4 as GST-1374's own two `admitG` tests.
- **Reason codes:** JOURNAL_MISSING, STAGE_RECOVERED and STAGE_SETTLED are new warning codes (owner U4).
