# Part C fixtures

Real Codex 0.170.0 sessions (the pinned npm tarball's linux-x64 binary) with gstack at the pin (a0534ce6, `./setup --host codex`), each run once against the keyless stub (lanes/codex-hooks/c/stub.ts) with no model call. Each folder is laid out as a review-units session's `host/` dir: `codex-sessions/` (the rollouts), `gstack-hooks/` (gstack's hook logs), `gstack-contracts/` (the contract hook's records) and a short `init.json` naming the root thread.

| Folder | Arm | What happened |
|---|---|---|
| block | c-on | A report with one finding in a json block, no adversarial pass and no review report; the contract blocked once, then two findings |
| nojson | c-on | Prose with no json block; the contract blocked, then one finding in a json block |
| met | c-on | spawn_agent in the collaboration namespace with gstack's marker, then the report; met with no block, and the sub-agent's rollout |
| falseblock | c-on | The same spawn_agent in an unknown namespace (multi_agent_v2), which Codex refused, then the report; gstack blocked anyway |
| codemode | c-on | A code-mode exec cell reading the review SKILL.md in pre-run change 1's three flagged shapes, then the report; blocked for the missing pass |
| override | c-on | spawn_agent with a model and effort override (gpt-6.2-sol at high); met, and the sub-agent's rollout on gpt-6.2-sol |
| failopen | c-on | The state root's skill-contracts path made a file, so the contract hook failed open |
| off | c-off | skill_contracts off: no contract log |
| none | c-none | No gstack and no hooks |

Every string longer than 1,500 characters (Codex's instructions and tool list, gstack's injected skill text) is cut to its first 200 characters and a line naming its length and sha256. Paths are the capture machine's scratch paths under /tmp/gse-c.
