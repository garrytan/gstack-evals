import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { loadReaderMap, type ReaderMap } from "../../src/trial/review/readers.ts";

// Opt-in: the R2 build's reader map against gstack's own tree at the map's commit. It needs a gstack checkout at that
// commit, so it runs only when asked, outside the Docker tier (stage m1b), which reads any skipped case as RED:
//   GSTACK_EVALS_GSTACK_SOURCE=<gstack checkout at 77fe28c39796> bun test tests/arms/reader-map-source.test.ts
const SOURCE = process.env.GSTACK_EVALS_GSTACK_SOURCE;
const map = (loadReaderMap(join(REPO_ROOT, "src", "trial", "review", "reader-maps", "gstack-77fe28c39796.json")) as { map: ReaderMap }).map;

describe.skipIf(!SOURCE)("the reader map against gstack at its commit (opt-in)", () => {
  // Value: protects=the map matches gstack's /review at its commit: every checklist exists there, and the adversarial marker is in Step 4.8's Claude subagent prompt; fails_when=a checklist was renamed or the marker reworded at the pinned commit; why_new=R2 build (GEVA-122), moved out of the Docker tier (GEVA-129); seam=the map against a gstack checkout at its commit (GSTACK_EVALS_GSTACK_SOURCE)
  test("the map's checklists and marker are in gstack at its commit", () => {
    const src = SOURCE!;
    const head = Bun.spawnSync(["git", "-C", src, "rev-parse", "HEAD"]).stdout.toString().trim();
    expect(head).toBe(map.gstack.sha);
    for (const path of Object.keys(map.checklists)) expect(existsSync(join(src, path))).toBe(true);
    const army = readFileSync(join(src, "review", "sections", "review-army.md"), "utf8");
    for (const path of Object.keys(map.checklists)) expect(army).toContain(path);
    for (const marker of map.adversarial) expect(readFileSync(join(src, "review", "sections", "adversarial.md"), "utf8")).toContain(marker);
  });
});
