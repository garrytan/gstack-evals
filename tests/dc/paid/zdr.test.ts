// Copyright (c) 2026 Garry Tan. MIT License.
// The Zero Data Retention check's CLI half. paid/dryrun-cases.ts's ZDR case sends bodies shaped like Claude Code's
// through the proxies; here the bundled Claude Code CLI, at the trial image's pinned version, runs a two-turn Sol session
// through the claude-code driver and the real Sol session proxy against the scripted upstream, which answers the first
// main-agent turn with one Read call. Every Messages body the CLI sends goes to OpenRouter with no stored state, and the
// second main-agent turn resends the whole history. Skipped where the bundled CLI is not installed.
import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudePin } from "../../../lanes/eng-build/session-image.ts";
import { admitted } from "../../../lanes/design-constructed/money/dryrun-fixture.ts";
import { DIRECT_MODELS } from "../../../lanes/design-constructed/money/price.ts";
import { SERVED, stateKeys, withPaid } from "../../../lanes/design-constructed/paid/dryrun-cases.ts";
import { REPO_ROOT } from "../../../lanes/design-constructed/wire/fakes.ts";
import { claudeCodeDriver } from "../../../src/adapters/claude-code/driver.ts";
import { storedContext } from "../../../src/runner/pricing/prices.ts";
import type { AgentSession } from "../../../src/trial/sandbox.ts";
import { CLAUDE_CLI, HAS_CLAUDE_CLI } from "../../adapters/harness.ts";

const work = mkdtempSync(join(tmpdir(), "dc-zdr-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
/** A turn's messages compared as content: string content as one text block, cache breakpoints dropped (the CLI moves both between turns). */
const asContent = (ms: Array<{ role: string; content: unknown }>) => JSON.parse(JSON.stringify(ms.map((m) => ({ role: m.role, content: typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content })), (k, x) => (k === "cache_control" ? undefined : x)));

describe("Zero Data Retention, the CLI half", () => {
  test.skipIf(!HAS_CLAUDE_CLI)(
    "a two-turn Sol session on the pinned Claude Code CLI sends OpenRouter's Messages route no stored state, and its second turn resends the whole history",
    async () => {
      // Value: protects=the Zero Data Retention check on the session path: Sol sessions never chain on server-side state, so an org that refuses previous_response_id still serves them; fails_when=the CLI or the session proxy adds previous_response_id, a conversation or an item reference, or the second turn sends less than the whole history; why_new=the Captain's ZDR check; seam=claudeCodeDriver, the bundled CLI, SessionProxies' Sol slot; no_claim=OpenRouter's own retention or the CLI inside the trial image (the same version, from the SDK's bundled package)
      const plan = join(work, "plan.md");
      writeFileSync(plan, "# plan\n");
      const home = join(work, "home");
      mkdirSync(home);
      const why = await withPaid(
        {
          script: (_url, body) => {
            const main = Array.isArray(body?.tools) && body.tools.length > 0;
            const answered = JSON.stringify(body?.messages ?? []).includes('"tool_result"');
            return { kind: "ok", provider: SERVED[String(body?.model)] ?? "OpenAI", stream: body?.stream === true, ...(main && !answered ? { tool: { name: "Read", input: { file_path: plan } } } : { text: main ? "Reviewed." : "A title" }) };
          },
        },
        async ({ r, up, sessions }) => {
          const item = "dc-stage1-sol" as const;
          await r.c.openItem(item);
          const sub = admitted(await r.c.admitRound(item, { run: "zdr cli", model: "sol", arms: ["none"] }), "the round");
          const b = await sessions.bind(item, { sub, session: sub.sessions[0]!.id, attempt: 1, arm: "none" });
          const proxy = await sessions.open(item);
          const out = join(work, "driver");
          const driver = claudeCodeDriver({ model: DIRECT_MODELS.sol.id, provider: "openrouter", proxy: { baseUrl: proxy.baseUrl, slot: b.slot, token: b.token }, skill: null, out, maxTurns: 4, disable1mContext: true });
          const session: AgentSession = {
            exec: () => ({ exitCode: 0, timedOut: false, stdout: "", stderr: "" }),
            spawn: (argv, extra = {}) => spawn(argv[0] === "claude" ? CLAUDE_CLI : argv[0]!, argv.slice(1), { cwd: work, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, ...driver.env, ...extra }, stdio: ["pipe", "pipe", "pipe"] }),
            stop() {},
          };
          await driver.run(session, { id: "zdr", prompt: "Read " + plan + " and review it." } as never, 90_000);
          await sessions.end(b);
          expect(JSON.parse(readFileSync(join(out, "init.json"), "utf8")).claude_code_version).toBe(claudePin(REPO_ROOT).version);
          const sent = up.sent.filter((s) => s.body !== null);
          expect(sent.length).toBeGreaterThan(0);
          expect([...new Set(sent.map((s) => s.url.split("?")[0]))]).toEqual(["https://openrouter.ai/api/v1/messages"]);
          for (const s of sent) {
            expect(stateKeys(s.body)).toEqual([]);
            expect(storedContext(s.body)).toBe(false);
          }
          const turns = sent.filter((s) => Array.isArray(s.body.tools) && s.body.tools.length > 0);
          expect(turns).toHaveLength(2);
          const [one, two] = turns.map((s) => s.body.messages as Array<{ role: string; content: unknown }>);
          expect(asContent(two!.slice(0, one!.length))).toEqual(asContent(one!));
          const added = two!.slice(one!.length);
          expect(added.some((m) => m.role === "assistant" && JSON.stringify(m.content).includes('"tool_use"'))).toBe(true);
          expect(added.some((m) => m.role === "user" && JSON.stringify(m.content).includes('"tool_result"'))).toBe(true);
          return null;
        },
      );
      expect(why).toBeNull();
    },
    120_000,
  );
});
