---
id: 2026-11-21-geva-562-codex-hooks-pre-run-change-3
kind: plan
title: "Pre-run change 3 to the Codex hooks eval: part R's shell commands run in a non-login shell"
summary: "Part R passes allow_login_shell=false to every arm, so a task image's /etc/profile can't drop bun and the testbed from PATH. The table counts refused login-shell requests."
author: GEVA-562
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-21
status: open
links:
  - 2026-11-19-geva-562-codex-hooks-prereg
  - 2026-11-19-geva-562-codex-hooks-pre-run-change-1
  - 2026-11-21-geva-562-codex-hooks-pre-run-change-2
  - GST-3174
---

# Pre-run change 3 to the Codex hooks eval: part R's shell commands run in a non-login shell

## In short

- Part R's Codex sessions now run the model's shell commands in a non-login shell, in all three arms. Without this, every gstack command in r-on and r-off would have refused because bun was missing, and the model in every arm would have run a different Python from the one the verifier uses.
- Under this setting Codex refuses any request for a login shell. Part R's session table counts those refusals for each session.
- Part C keeps its frozen settings. c-pilot must show that gstack's start step passes its INSTALL check in part C's image. If it fails there, the same fix goes to part C by a dated change.

This change governs where it and the preregistration or the earlier changes differ. It was written before any paid session, made no model call and spent nothing. The Captain chose it (A1) on 2026-11-21.

## 1. What was wrong

By default Codex runs the model's shell commands in a login shell (`bash -lc`). A login shell reads /etc/profile, and in a Debian-based task image that file resets PATH. B1's task setup adds the testbed's bin directory and /opt/laneb/bin, where bun sits, with Dockerfile `ENV PATH` lines, so a login shell loses both.

GEVA-569 found this in B2's pilot. Every gstack skill start in Codex 0.170.0 refused with "bun not found on PATH" (RUNTIME_BELOW_MINIMUM). In a locally built task image, `bash -c` found bun and `bash -lc` did not. Claude Code's Bash keeps the container's PATH, so B1 never ran into it.

Part R's keyless smoke missed it, because its stand-in model only read SKILL.md with `cat`. In that smoke the routing hook did deliver its line. The problem is in the model's own shell commands, not in the hook.

## 2. The change

- `lanes/codex-hooks/r/pins.ts` defines part R's Codex settings: the settings every arm already passed (`features.sleep_tool=false`) plus `allow_login_shell=false`. The prepare step passes them to r-on, r-off and r-none alike, and the run manifest records them.
- The model's shell commands now run with the container's PATH, as Claude Code's do. A call that asks for `login: true` does not run. Codex answers it with "login shell is disabled by config; omit `login` or set it to false." This matches B2's fix (`-c allow_login_shell=false` on its Codex command line), so the two lanes stay alike. Neither lane changes the image.
- Each row of part R's session table now has `login_refused`: the number of Codex's refusals in the session's tool results, counted once per refusal, so two refused calls inside one code-mode exec count as two. It counts the refusal text wherever it appears, so a model that echoes the text would be counted too. The results post sums it per arm from the table.

## 3. How it was checked

A keyless test, `tests/codex-hooks/r/login-shell.test.ts`, runs real Codex against a stand-in model. The session's HOME holds a .profile that resets PATH the way an image's /etc/profile does. bun sits at the end of PATH, as /opt/laneb/bin does in the task image, and a testbed directory sits at the front.

With part R's settings:
- the shell skips the profile;
- the shell finds bun and keeps the testbed directory on PATH;
- a login-shell request, made directly or from code mode, is refused, and the load detector counts both refusals.

With only the shared settings, the profile runs and bun is gone.

CI runs the test on the Codex that package.json pins (0.166.0). It also passed once by hand on Codex 0.170.0, checked against the eval's tarball and binary digests. The refusal text matched there, so the table's count holds on the version the eval runs.

## 4. Part C

Part C runs in the Lane A trial image, where bun sits at /usr/local/bin. Debian's default /etc/profile keeps that directory on PATH, and gstack's setup writes no shell profile. That conclusion was reasoned from the files and not run in the image, so part C keeps its frozen settings with one added pilot check:
- c-pilot must show that gstack's start step passes its INSTALL check in a c-on or c-high session;
- a refusal there that names a runtime missing from PATH brings the same setting to part C by a dated change before c-main spends.

## 5. What is still open

- r-pilot is the first run of the setting inside B1's real task images, on Sol.
- Whether Sol ever asks for a login shell. The pilot's `login_refused` counts will show it.

## Disclosures

gstack is Garry Tan's own project.
