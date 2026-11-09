// Copyright (c) 2026 Garry Tan. MIT License.
// The label container recipe (prereg section 6.2). Labels run after the session, never in the agent's container.
// Done: the task's hidden tests on the snapshot, through the separate verifier image that quick/laneb/runner/materialize.ts
// builds (pristine task image plus test.sh behind APPLY_BLOCK, which applies /logs/artifacts/model.patch). Test pass: the
// pristine image plus the snapshot diff, then the same test command without its pipe; the label is its exit code.
// Docker sits behind DockerRunner so the recipe is testable without docker.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { baseImage } from "../../../quick/laneb/runner/materialize.ts";
import { firstPipe } from "./shell.ts";

export interface DockerRunner { run(args: string[], opts?: { timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string }> }

export const dockerCli: DockerRunner = {
  async run(args, opts) {
    const p = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
    const timer = opts?.timeoutMs ? setTimeout(() => p.kill(), opts.timeoutMs) : null;
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (timer) clearTimeout(timer);
    return { code, stdout, stderr };
  },
};

export const APPLY_FAILED = 197;
const LABEL_TIMEOUT_MS = 1_800_000;

/** The command before its first top-level pipe. */
export function stripPipe(command: string): string {
  const i = firstPipe(command);
  return (i < 0 ? command : command.slice(0, i)).trimEnd();
}

/** docker build arguments for the separate verifier image of a materialized task directory. */
export function verifierBuild(taskDir: string, tag: string): string[] {
  return ["build", "-t", tag, "-f", join(taskDir, "tests", "Dockerfile"), join(taskDir, "tests")];
}

/** The pristine task image: the FROM line of the materialized task's environment Dockerfile. */
export function pristineImage(taskDir: string): string {
  return baseImage(readFileSync(join(taskDir, "environment", "Dockerfile"), "utf8"));
}

export async function doneLabel(docker: DockerRunner, o: { verifierImage: string; snapshot: string }): Promise<{ done: boolean | null; missing: string | null }> {
  const r = await docker.run(["run", "--rm", "-v", o.snapshot + ":/logs/artifacts/model.patch:ro", o.verifierImage, "bash", "-c", "/tests/test.sh; echo DR_REWARD $(cat /logs/verifier/reward.txt 2>/dev/null)"], { timeoutMs: LABEL_TIMEOUT_MS });
  const m = [...r.stdout.matchAll(/^DR_REWARD ([0-9.]+)\s*$/gm)].at(-1);
  if (!m) return { done: null, missing: "DR_LABEL_MISSING: the verifier printed no reward (exit " + r.code + ")" };
  return { done: Number(m[1]) >= 1, missing: null };
}

export async function testPassLabel(docker: DockerRunner, o: { image: string; snapshot: string; command: string }): Promise<{ passed: boolean | null; exit_code: number; missing: string | null }> {
  const script = "cd /testbed && if [ -s /dr/snapshot.diff ]; then git apply --index --whitespace=nowarn /dr/snapshot.diff || exit " + APPLY_FAILED + "; fi; " + stripPipe(o.command);
  const r = await docker.run(["run", "--rm", "--network", "none", "-v", o.snapshot + ":/dr/snapshot.diff:ro", o.image, "bash", "-c", script], { timeoutMs: LABEL_TIMEOUT_MS });
  if (r.code === APPLY_FAILED) return { passed: null, exit_code: r.code, missing: "DR_LABEL_MISSING: the snapshot did not apply to the pristine image" };
  return { passed: r.code === 0, exit_code: r.code, missing: null };
}
