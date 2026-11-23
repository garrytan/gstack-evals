---
id: 2026-11-21-geva-569-b2-test-first-change-2
kind: plan
title: "Pre-run change 2 to B2: Codex runs shell commands without a login shell, so the task image's PATH holds, and Sol is re-piloted"
summary: "In the pilot every Codex gstack start refused because a login shell dropped Bun from PATH. Every Codex arm now sets allow_login_shell=false. Sol is re-piloted inside b2-pilot's $65 cap."
author: GEVA-569
model: anthropic/claude-opus-5-5
date: 2026-11-21
status: done
links:
  - wiki/plans/2026-11-21-capy-b2-test-first-prereg/README.md
  - wiki/plans/2026-11-21-geva-569-b2-test-first-change-1.md
---

# Pre-run change 2 to B2: Codex runs shell commands without a login shell, so the task image's PATH holds, and Sol is re-piloted

## In short

- In the pilot, every gstack skill start on Codex refused. That covered prove-it in all 3 cx-prove-it sessions and verify in the 2 cx-gstack sessions that loaded it. The start's INSTALL row read "bun not found on PATH", so gstack told the model to stop the skill.
- The cause is our harness. The Sol task image puts Bun 1.4.4 in /opt/laneb/bin and adds that folder to PATH only through the Dockerfile's ENV line. Codex 0.170.0 runs exec_command in a login shell by default, and the image's /etc/profile then resets PATH. In the built tox-dev__tox-3810 Sol image, `bash -c` finds /opt/laneb/bin/bun and `bash -lc` finds no Bun. The login PATH also drops the task setup's /opt/miniconda3 testbed prefix and Java.
- Claude Code's shell keeps the container's PATH, so no Claude Code session in the pilot showed the INSTALL failure.
- Every Codex arm now passes `-c allow_login_shell=false` to Codex. That is a Codex 0.170.0 config key, and it keeps shell commands on the PATH the task setup sets. The change is the same in all four Codex arms. It changes no arm tar, gstack build, task image, prompt, model, effort, task or rule.
- Sol is re-piloted on its own, inside b2-pilot's $65 cap. The re-pilot's readout goes to the Captain before any counted Sol part.

## What the pilot's Codex sessions did after the refusal

prove-it's steps were in context in all 3 cx-prove-it sessions, and each acted on them. Two followed the procedure (failing test, fix, passing run). The tox-dev__tox-3810 session wrote the failing test first but ran no passing run after the fix. What did not run is gstack's own start bookkeeping. No outcome was read to make this change: the cause comes from the start's printed INSTALL row and the shell's PATH.

## The re-pilot

- `B2_PILOT_MODELS=sol` prepares b2-pilot's Sol part alone: the three pilot tasks, the four Codex arms, 12 sessions.
- L1 binds one run to a ledger, so the re-pilot runs on a fresh b2-pilot ledger with its approval row at $65. Its launch guard reads that ledger with the first pilot run's settled $13.62 added (`B2_PILOT_CARRY`, the first run's ledger), so it refuses a launch whose projection would take the two runs together past $65. The fresh ledger itself enforces $65 on the re-pilot's own sessions; at Sol's pilot cost of $0.17 a session, the two runs together come to about $16.
- The first pilot's Sol sessions are kept in the record and are not read again. The re-pilot's readout is the same as section 12's for Sol, plus two checks: every gstack start prints no INSTALL failure, and Bun is on the shell's PATH.
