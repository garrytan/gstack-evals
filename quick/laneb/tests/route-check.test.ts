// Run D's route check (GEVA-139, section 8): per model, the smoke session under arm none must get a tool result back, and
// the listing session under arm gstack must quote /investigate's description from the skill listing before any tool call
// touches a skill. Keyless: runner/route-verdict.ts on synthetic transcripts, and route-check.sh with stub harbor and docker
// commands on PATH, the real proxy and ledger service, fake keys, and no request reaching any upstream.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESCRIPTION, quotesListing, toolResults } from "../runner/route-verdict.ts";
import { Ledger } from "../runner/ledger.ts";

const here = import.meta.dir;
const said = (text: string) => ({ type: "AssistantMessage", content: [{ text }], usage: { input_tokens: 10, output_tokens: 5 } });
const call = (id: string, name: string, input: object) => ({ type: "AssistantMessage", content: [{ id, name, input }], usage: { input_tokens: 10, output_tokens: 5 } });
const result = (id: string, content = "ok") => ({ type: "UserMessage", content: [{ tool_use_id: id, content }] });

describe("route verdict", () => {
  test("the description is the shipped one, (gstack) tag included", () => {
    expect(DESCRIPTION).toBe("Systematic debugging with root cause investigation. (gstack)");
  });
  test("smoke: counts tool calls whose result came back", () => {
    expect(toolResults([call("a", "Bash", { command: "cat calc.py" }), result("a"), call("b", "Edit", {}), result("b")])).toBe(2);
    expect(toolResults([said("done"), call("a", "Bash", { command: "ls" })])).toBe(0);
  });
  test("listing: the reply quotes the description, whitespace and case aside", () => {
    expect(quotesListing([said("The listing says:\n> systematic debugging with  root cause investigation. (gstack)")])).toBe(true);
    expect(quotesListing([call("a", "Bash", { command: "pwd" }), result("a"), said("Systematic debugging with root cause investigation. (gstack)")])).toBe(true);
  });
  test("listing: a paraphrase, a quote without the tag, or no quote fails", () => {
    expect(quotesListing([said("It helps debug things by finding the root cause.")])).toBe(false);
    expect(quotesListing([said("Systematic debugging with root cause investigation.")])).toBe(false);
    expect(quotesListing([])).toBe(false);
  });
  test("listing: a quote after a tool call that touched a skill does not count", () => {
    expect(quotesListing([call("a", "Read", { file_path: "/root/.claude/skills/investigate/SKILL.md" }), result("a"), said(DESCRIPTION)])).toBe(false);
    expect(quotesListing([call("a", "Skill", { skill: "investigate" }), result("a"), said(DESCRIPTION)])).toBe(false);
    expect(quotesListing([call("a", "Bash", { command: "grep -r description /root/.claude" }), result("a"), said(DESCRIPTION)])).toBe(false);
  });
});

// Stub harbor: writes one trial whose transcript depends on the arm, or exits 1 for STUB_FAIL's model and session kind.
const HARBOR = `#!/usr/bin/env bash
out= job= arm= model= task= tar= sha= sp= turns=
while [ $# -gt 0 ]; do
  case $1 in
    -o) out=$2; shift;; --job-name) job=$2; shift;; -p) task=$2; shift;;
    --ak) case $2 in arm=*) arm=\${2#arm=};; upstream_model=*) model=\${2#upstream_model=};; arm_tar=*) tar=\${2#arm_tar=};; arm_sha256=*) sha=\${2#arm_sha256=};; system_prompt=*) sp=\${2#system_prompt=};; sdk_max_turns=*) turns=\${2#sdk_max_turns=};; esac; shift;;
  esac
  shift
done
echo "$model $arm job=\${job%-*} tar=$tar sha=$sha sp=$sp turns=$turns instruction=$(head -c 60 "$task/instruction.md")" >> "$STUB_LOG"
[ "$model $arm" = "\${STUB_FAIL:-}" ] && exit 1
d=$out/$job/trial__1/agent
mkdir -p "$d"
if [ "$arm" = gstack ]; then
  text='The listing gives: Systematic debugging with root cause investigation. (gstack)'
  [ "$model" = "\${STUB_NOQUOTE:-}" ] && text='No skill by that name is listed.'
  printf '{"type":"AssistantMessage","content":[{"text":"%s"}],"usage":{"input_tokens":9,"output_tokens":9}}\\n' "$text" > "$d/sdk-messages.jsonl"
else
  printf '%s\\n' '{"type":"AssistantMessage","content":[{"id":"t1","name":"Bash","input":{"command":"cat calc.py"}}],"usage":{"input_tokens":9,"output_tokens":9}}' '{"type":"UserMessage","content":[{"tool_use_id":"t1","content":"def add(a, b)"}]}' > "$d/sdk-messages.jsonl"
fi
[ "$model $arm" = "\${STUB_FAIL_LATE:-}" ] && exit 1
exit 0
`;
const DOCKER = "#!/usr/bin/env bash\necho 127.0.0.1\n";

function routeCheck(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "route-check-"));
  mkdirSync(join(dir, "bin"));
  for (const [name, body] of [["harbor", HARBOR], ["docker", DOCKER]]) { writeFileSync(join(dir, "bin", name), body!); chmodSync(join(dir, "bin", name), 0o755); }
  const ledger = join(dir, "route.jsonl");
  new Ledger(ledger, "route-test").approve(5, { note: "route check test, no spend" });
  writeFileSync(join(dir, "gstack.tar"), "");
  const p = Bun.spawnSync(["bash", join(here, "../runner/route-check.sh")], {
    env: { PATH: join(dir, "bin") + ":" + process.env.PATH, HOME: dir, ANTHROPIC_API_KEY: "fake-not-a-key", OPENROUTER_API_KEY: "fake-not-a-key", PREREG: "test",
      ITEM: "route-test", LEDGER: ledger, OUT: join(dir, "out"), MODELS: "particle-1 gpt-6.1-sol", SYSTEM_PROMPT: "claude-code-preset", MAX_TURNS: "60",
      GSTACK_TAR: join(dir, "gstack.tar"), STUB_LOG: join(dir, "calls.txt"), ...env },
  });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString(), calls: readFileSync(join(dir, "calls.txt"), "utf8"), dir };
}

describe("route-check.sh", () => {
  test("both sessions per model under the preset at 60 turns; the listing session runs arm gstack on the preregistered tar and asks for the quote", () => {
    const r = routeCheck({});
    expect(r.code).toBe(0);
    const sha = JSON.parse(readFileSync(join(here, "../arms/manifests/gstack.json"), "utf8")).tar.sha256;
    expect(r.calls).toContain(`particle-1 none job=route-particle-1 tar=${r.dir}/out/arms/none.tar sha= sp=claude-code-preset turns=60 instruction=calc.add`);
    expect(r.calls).toContain(`gpt-6.1-sol gstack job=listing-gpt-6.1-sol tar=${r.dir}/gstack.tar sha=${sha} sp=claude-code-preset turns=60 instruction=${readFileSync(join(here, "../runner/route-listing.md"), "utf8").slice(0, 60)}`);
    expect(r.out).toMatch(/^route-check particle-1: smoke tool results 1 PASS; listing quoted the \/investigate description PASS$/m);
    expect(r.out).toContain("route check: passed for particle-1 gpt-6.1-sol");
  }, 60_000);
  test("a harbor failure exits non-zero and names the model", () => {
    const r = routeCheck({ STUB_FAIL: "particle-1 none" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("route check: harbor failed for particle-1 (smoke)");
    expect(r.out).toMatch(/^route-check particle-1: smoke no trial FAIL; listing quoted the \/investigate description PASS$/m);
    expect(r.out).toContain("route check: FAILED for particle-1");
  }, 60_000);
  test("a harbor failure after the session wrote a passing transcript still fails the model", () => {
    const r = routeCheck({ STUB_FAIL_LATE: "gpt-6.1-sol gstack" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("route check: harbor failed for gpt-6.1-sol (listing)");
    expect(r.out).toMatch(/^route-check gpt-6\.1-sol: smoke tool results 1 PASS; listing quoted the \/investigate description PASS$/m);
    expect(r.out).toContain("route check: FAILED for gpt-6.1-sol");
  }, 60_000);
  test("a listing reply without the quote fails the model's exposure check and exits non-zero", () => {
    const r = routeCheck({ STUB_NOQUOTE: "gpt-6.1-sol" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/^route-check gpt-6\.1-sol: smoke tool results 1 PASS; listing did not quote the \/investigate description FAIL$/m);
    expect(r.out).toContain("route check: FAILED for gpt-6.1-sol");
  }, 60_000);
});
