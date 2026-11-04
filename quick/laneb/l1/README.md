# L1 launcher

`l1.ts` runs one L1 item (prereg [2026-11-03-geva-254-l1-overhaul-prereg-2000](../../../wiki/plans/2026-11-03-geva-254-l1-overhaul-prereg-2000/README.md), sections 3, 6, 9 and 10) as a set of parts, one after another. Each part is one detached launch of `runner/launch.sh` on an awake host. The waiting agent never runs a controller. It attaches on a timer.

## The awake host

- Type: a dedicated Ubicloud `standard-2` VM made by the pinned `ubi-runner.sh` (`UBI_RUNNER`, checked against `UBI_RUNNER_SHA256` on the agent and again on the host). It is tagged with `UBI_OWNER`, the run thread's code, and has a recovery bundle in `UBI_RECOVERY_DIR`.
- TTL: (parts + 1) x 18 h + 24 h. That is every part and one relaunch at the part VM TTL (16 h) plus 2 h, and a day of slack: 60 h for pilot-opus, 78 h for tb2-opus, 114 h for f1-opus.
- Hours on a ledger item: before the host starts, `host-up` reserves its whole TTL at $0.08 an hour on the item's own ledger as `host-<n>` ($4.80, $6.24 and $9.12). A refusal is a cap stop (exit 9, stderr `CAP_STOP`) and no host starts. `host-down` and `recover` settle it at the hours it was up. If `host-up` fails after the host starts and the host can't be destroyed, the host stays current with its reserve open: `attach` prints `NEXT: host-down (cleanup of a failed host-up is pending)`, `host-up`, `launch`, `relaunch` and `recover` refuse, and `host-down` retries the destroy and settles the hours on the agent's ledger, which never moved. The list price of `standard-2` is $41.89 a month, about $0.057 an hour.
- The ledger: `host-up` moves the item's single ledger file, with its `.bound`, onto the host (`~/l1/ledger/<item>.jsonl`). While the host is up, the agent's copy is gone, a pointer (`<ledger>.host.json`) names the host, and the agent keeps an append-only mirror in `<work>/host/ledger.jsonl`. `host-down` brings the file home.
- What runs there: `host.sh` (one per part, started with `setsid -f`) runs `launch.sh` with the ledger service and the tunnel. Keys sit in `~/.l1-secrets` (mode 0600), never in argv. `host-bootstrap.sh` installs Bun 1.4.4 checked by sha256 and the tools `ubi-runner` needs. The host runs no Docker and no trial.

## Commands

Set `LEDGER` (the item's ledger file, with its approval row at the item's cap), `ARMS` (the folder with `none`, `before`, `after` and `off` tars), `UBI_RUNNER`, `UBI_RUNNER_SHA256`, `UBI_OWNER`, `UBI_RECOVERY_DIR` (on Capy, a private drive folder) and the provider and Ubicloud keys. tb2-opus also needs `TB2_PARTS` and `TB2_PARTS_SHA256` (Amendment C's split and digest).

```
bun quick/laneb/l1/l1.ts prepare <work> --item pilot-opus|f1-opus|tb2-opus
bun quick/laneb/l1/l1.ts host-up <work>
bun quick/laneb/l1/l1.ts launch <work> --part <part>
bun quick/laneb/l1/l1.ts attach <work>             # on a timer; prints NEXT
bun quick/laneb/l1/l1.ts relaunch <work> --part <part>
bun quick/laneb/l1/l1.ts recover <work>            # only after attach prints HOST_LOST
bun quick/laneb/l1/l1.ts host-down <work>
```

- `prepare` checks the frozen inputs by sha256, writes `plan.json` (run id, parts, seeded order, inputs, git head, host TTL) and one run dir per part. Each rectangle of a part is its own Harbor job (`job.json`, `job-2.json`), run one after another by `vm-run.sh`. Arms that share a tar (`tar=before`) share one copy and one manifest.
- `launch` binds the run on the item at the first launch, syncs the part and starts its controller. It refuses a part whose earlier parts have not finished, any part once the item has ended (below), and a part after a loss that has not had its relaunch.
- `attach` mirrors the ledger, copies the part VMs' recovery bundles, records a part VM and its controller's start time in `<part>.launch.json` when the VM came up after `launch` stopped waiting, pulls a finished part and classifies it (`<part>.result.json`). A host that misses 3 looks over 10 minutes or more is lost (exit 5).
- `relaunch` runs once per part, only after a loss (section 6). A lost controller is salvaged first: the batch stops, results are pulled, the leftover ledger service stops, sessions reconcile and the VM's blocks settle. The relaunch holds only the cells that never started. A cell started once the item's ledger accepted a reserve for one of its sessions. A cap stop is never relaunched. A part that ended early with no loss is infra and is not relaunched.
- `recover` confirms the host gone, stops and pulls the running part's VM through its recovery bundle, and rebuilds the rows the mirror lacks from the part VM's records (each marked `recovered`). Then `host-up` starts a new host and `relaunch` continues. When `<part>.launch.json` names no VM, `recover` uses the one recovery bundle copied since the part launched that no host and no part names. If there is none or more than one, the part VM is unknown. If the part VM is unknown or its records are lost too, the item ends incomplete (exit 4) and goes to the Captain.
- The item has ended once `recover` ended incomplete (`host/recover.json` has `complete: false`) or a part ended at a cap stop. Then `host-up`, `launch` and `relaunch` refuse (exit 3), and `attach` says the item ended incomplete and goes to the Captain. After a cap stop, `host-down` still runs.

Exit codes: 0 ok, 2 usage, 3 refused, 4 the item stops incomplete, 5 the host is lost, 9 the ledger refused the host's reserve, 1 anything else. Stderr lines start with a registered code: `E_USAGE` for a bad call or a refusal, `CAP_STOP` for the host's refused reserve, `E_INTERNAL` for anything else.

## Amendment C's dry run

The dry run kills the host, not just the controller: it stops the VM mid-part, then runs `attach` until `HOST_LOST`, `recover`, `host-up` and `relaunch`. `tests/l1-host.test.ts` drives the same path keylessly on a fake host and fake part VMs, with the real `host.sh`, `launch.sh` and ledger service.

## Not in this unit

Per-session hook evidence (route hook fired, contract record written, contract check met) needs a change to the agent's teardown and is not captured here.
