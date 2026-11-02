import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prepare, snapshot } from "../../lanes/review-noloss/ingest.ts";
import { scanText } from "../../lanes/review-noloss/scan.ts";
import { loadSuite, REPO_ROOT } from "../../lanes/review-noloss/suite.ts";

// Value: protects=GST-837: an arm.json whose arm_provenance names the stack source by its machine path is refused by noloss ingest (E_NOLOSS_ARM, machine path), and the source kind review-units now writes (local-git) passes while repo, sha and git tree still name the commit; fails_when=install provenance carries a path again, or the ingest scan stops catching it; why_new=GST-837, every real gstack arm of stacks round 1 was refused; seam=prepare's publication scan on arm.json
describe("GST-837: stack provenance with no machine path", () => {
  const stack = { repo: "garrytan/gstack", sha: "53522b1bbc60b3dc820842371f80ebc9db7911ec", git_tree: "bb5bd716a9a9c7c7dbc34a081308adcf367d9261", tree_sha256: "cceac6c3d91f3e2b78daa0540d1caa2383216281c11da1685553ab9e9f90d146" };
  const provenance = (source: string) => ({ kind: "stack", stack: { ...stack, source }, install: { command: "./setup --host claude --no-browser -q", runner: "docker sha256:" + "0".repeat(64), tree_sha256: "1".repeat(64) } });
  const withProvenance = (p: unknown) => {
    const files = snapshot(join(REPO_ROOT, "lanes/review-noloss/example/arm-example"));
    files.set("arm.json", Buffer.from(JSON.stringify({ ...JSON.parse(files.get("arm.json")!.toString("utf8")), arm_provenance: p }, null, 2) + "\n"));
    return files;
  };
  test("ingest refuses a source path and passes local-git, which still names repo@sha and the git tree", () => {
    const { suite, sha256 } = loadSuite("gsta167-14pr");
    expect(() => prepare(withProvenance(provenance("/home/" + "runner/.local/state/gstack-evals/sources/gstack")), suite, sha256, [])).toThrow(/machine-path/);
    const now = provenance("local-git");
    expect(() => prepare(withProvenance(now), suite, sha256, [])).not.toThrow();
    expect(now.stack).toMatchObject({ repo: "garrytan/gstack", sha: stack.sha, git_tree: stack.git_tree });
  });
  const REAL = process.env.GSE_REAL_ARM_JSON ?? "";
  test.skipIf(!REAL || !existsSync(REAL))("a real stacks round 1 gstack arm.json breaks the scan only at its source, and passes with local-git", () => {
    const hits = (text: string) => text.split("\n").flatMap((l, i) => scanText(l).map((h) => h + " " + l.trim().split(":")[0]));
    const arm = JSON.parse(readFileSync(REAL, "utf8"));
    expect(hits(JSON.stringify(arm, null, 2))).toEqual(['machine-path "source"']);
    arm.arm_provenance.stack.source = "local-git";
    expect(hits(JSON.stringify(arm, null, 2))).toEqual([]);
  });
});
