# Install manifests: gstack before (82db89a) and after (699a41c), lite loadout

Made on 2026-11-03 by GEVA-254 with install-pin.sh and manifest.py (both attached). Each pin was cloned into a clean HOME at ~/.claude/skills/gstack and installed with its own ./setup --host claude --loadout lite, non-interactive, with GSTACK_SKIP_PLAYWRIGHT=1 and GSTACK_SKIP_FONTS=1. Paths are normalized: <HOME> is the clean HOME and <RENDER> is setup's render folder (<HOME>/.gstack/render/claude). The lock is gstack-modules render --host claude --loadout lite run at each pin.

| Field | before | after |
|---|---|---|
| sha | 82db89ab3ea3c64185538b8af33da2ffd1a18b57 | 699a41cb6808e01240d02e82247693f9170d401a |
| version | 1.93.22.0 | 1.94.39.0 |
| setup exit | 0 | 0 |
| config keys written | claude_loadout: lite | claude_loadout: lite |
| ~/.claude/skills entries | 65 | 65 |
| lite spec | lite | lite |
| lite spec_sha256 | c5df50f999eb649abc0cd48c40907fe29c5ba71e4534a5cc63ae6e3d26234f1d | c5df50f999eb649abc0cd48c40907fe29c5ba71e4534a5cc63ae6e3d26234f1d |
| lite files | 204 | 204 |
| setup render vs lock, bytes | 204 of 204 | 204 of 204 |
| lite tree digest, normalized (setup render) | 35dbf7b3ce88149e45e91f5d1932c790e608d583837b69e85784564a24ab8321 | ed09c8c81574c6446a9579d255bd919470e4792bfc3ced4df42fd3fdc66dc8a7 |
| lite tree digest, normalized (gstack-modules render) | 35dbf7b3ce88149e45e91f5d1932c790e608d583837b69e85784564a24ab8321 | ed09c8c81574c6446a9579d255bd919470e4792bfc3ced4df42fd3fdc66dc8a7 |
| /investigate SKILL.md bytes | 18002 | 15646 |
| /investigate SKILL.md sha256, normalized | c303d9febdc326b90d2fd4512f5aa2516618a209cf6da0db8973ed2e07dd20e9 | 02b0e1e7491330d1d08b4fd92b2c76f0181655c3a176874fbda5bd35bc5de7f9 |
| /investigate first 200 characters, sha256 | 07bd7af57db2433d97f3d9a4646bf9e3314f69d08c37a35dcec8cd5987e916a0 | 5bd9a0c6e900276b4d8a08727bee300c3ce85ba1a08ae47361729d7056c83f61 |
| /investigate DEBUG REPORT template, six labels | yes | yes |
| /investigate frontmatter contract | no | yes |
| /review SKILL.md bytes | 54648 | 52903 |
| /review first 200 characters, sha256 | ca6cc85469431af1dd243524b9ecad6a57b519ecdd28c1f8b5797ddb05ce00d1 | f53ffd2bfa020bce2ffaa340fffec0981fa42d78ff446814ddb18425103cfb0c |
| route threshold | none | 0.66 |

Excluded by lite at both pins: preamble:brain-health, preamble:completeness, preamble:confusion, preamble:context-health, preamble:context-recovery, preamble:question-tuning, preamble:repo-mode, preamble:search-before-building, preamble:voice, preamble:writing-style.

## Hooks in ~/.claude/settings.json

**before**

- Stop, source gstack-timeline-stop, timeout 5s: <HOME>/.claude/skills/gstack/hosts/claude/hooks/timeline-stop-hook

**after**

- Stop, source gstack-timeline-stop, timeout 5s: <HOME>/.claude/skills/gstack/hosts/claude/hooks/timeline-stop-hook
- Stop, source gstack-skill-contract, timeout 10s: <HOME>/.claude/skills/gstack/hosts/claude/hooks/skill-contract-stop-hook
- UserPromptSubmit, source gstack-skill-route, timeout 5s: <HOME>/.claude/skills/gstack/hosts/claude/hooks/skill-route-hook

Each hook command is a bash shim that runs bun from PATH and exits 0 on any failure (fail-open). Non-interactive setup installs no plan-tune hooks at either pin.

## Diff, before to after

- Rendered lite files that differ (normalized): 26, in agents-digest, autoplan, bin, captain, codex, eval-plan, gstack, investigate, qa, retro, review, setup-browser-cookies, ship, verify, write-skill.
- Hooks added: Stop (gstack-skill-contract, 10s); UserPromptSubmit (gstack-skill-route, 5s).
- Hooks removed: none. Skills added: none. Skills removed: none.
- The /investigate body shrinks from 18002 to 15646 bytes, keeps the DEBUG REPORT template and gains a frontmatter contract: the debug-report labels and a check after the last edit.
