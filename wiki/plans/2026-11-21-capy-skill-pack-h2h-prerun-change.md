---
id: 2026-11-21-geva-568-skill-pack-h2h-prerun-change
kind: plan
title: "Skill-pack head-to-head extension: harness fixes made before any paid session"
summary: "Six runner fixes made before any paid call. Each makes the code follow a rule the preregistration froze; no number, cap, unit list or decision rule moves."
author: GEVA-568
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-21
status: open
links:
  - 2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg
  - lanes/outcome-skills/h2h/ext
---

# Skill-pack head-to-head extension: harness fixes made before any paid session

This note records changes to lanes/outcome-skills/h2h/ext made on 2026-11-21, after the preregistration (2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg) merged and before any paid call, smoke session or analysis. The preregistration's final review left the first three as named notes for this follow-up. Each fix makes the code do what the preregistration already says. None changes a number, cap, unit list, arm or decision rule, and each has a test that failed before the fix and one that shows the ordinary case still passes.

## Fixes

1. **A cap stop ends the part incomplete** (section 14). The analysis counted a cap-stopped session as an ordinary gap, so a part with one cap stop could still read a verdict. Now one cap stop anywhere in a part's stage makes every cell of that part incomplete: no row state, no sentence reading, no section 10 row, and Part S's look reads stop: cap. Cross-part rows also read nothing from a cap-stopped Part L.
2. **Codex stops at the 300-response ceiling inside an exec** (section 3). Codex has no turn cap of its own, and responses were counted only after an exec ended, so one exec could pass 300 and end completed. The loop now reads the session's rollout every 5 seconds during an exec and kills Codex in the container once the session reaches max_turns, ending the turn as turn_ceiling. A session can pass the ceiling only by what Codex answers between two reads. The responses of a killed exec are counted.
3. **Stage 0 never leaves a container running.** A stage 0 launch that failed after docker run left its container, with the copied home and the runtime volume, running. The run now removes its own container on any failure.
4. **Commands run in a non-login shell.** Codex 0.170.0 runs each command through a login shell by default, so an image whose /etc/profile resets PATH drops the runtime bin dir, and gstack's skill start then fails its install check (found by the B2 test-first eval). Every Codex exec now passes `-c allow_login_shell=false`. A keyless test plants a profile that resets PATH and shows the command still finds bun and the session's PATH. Stage 0 now also records, per run on the real image, whether the command's PATH kept the runtime bin dir and where bun resolved.
5. **The run order does not depend on file order** (sections 11 and 13). The seeded run order, and so Part S's half for its one look, shuffled the units in the order a units file listed them. The shuffle now starts from the frozen draw order (kind, then draw position, then id), with the same order_seed.
6. **A Part L home must hold the pinned gstack** (section 2). The home check matched a home to its install record but did not check that the record installed gstack at the plan's pin. A home whose record names another gstack commit now refuses before its session.

## Left as notes

The other review notes stay notes: the generation-record lookup's total time on Part P, the cap-left figure the runner does not pass to a session (it labels a cap stop's end reason, not its outcome), the wall-limit kill sparing child processes, bug-entry exposure skipping the sentence check, and two unrelated keys left in Harbor's environment that never reach the model.
