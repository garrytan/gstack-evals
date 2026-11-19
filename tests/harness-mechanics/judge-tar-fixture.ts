// Copyright (c) 2026 Garry Tan. MIT License.
// A judge tar.gz holding only the files the launcher check reads (arms.ts judgeTarCheck), and a manifest for it: the
// replay's band and admission by default, or the placeholder band and no admission that stage3-pilot-3's tar carried (D14).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPLAY_JUDGE, REPO } from "../../lanes/harness-mechanics/pins.ts";

export const PLACEHOLDER_BAND = JSON.stringify({ lo: 0.3, hi: 0.7, source: "placeholder until the replay writes band.json" });
export const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
export function judgeTarFixture(o: { placeholder?: boolean; points?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hm-judge-fixture-")), tree = join(dir, "tree"), j = join(tree, ".hm/judge");
  mkdirSync(j, { recursive: true });
  const band = o.placeholder ? Buffer.from(PLACEHOLDER_BAND) : readFileSync(join(REPO, REPLAY_JUDGE.band.file));
  writeFileSync(join(j, "band.json"), band);
  if (!o.placeholder) writeFileSync(join(j, "admission.json"), readFileSync(join(REPO, REPLAY_JUDGE.admission.file)));
  for (const b of ["jev", "p1"]) writeFileSync(join(j, "judge-" + b + ".json"), JSON.stringify({ backend: b, band: "/root/.hm/judge/band.json", ...(o.placeholder ? {} : { admission: "/root/.hm/judge/admission.json" }) }));
  const tarGz = join(dir, "judge.tar.gz");
  spawnSync("tar", ["-czf", tarGz, "-C", tree, ".hm"]);
  const m = { tar_gz_sha256: sha(readFileSync(tarGz)), band_sha256: sha(band), ...(o.placeholder ? {} : { admission_sha256: REPLAY_JUDGE.admission.sha256, admitted_points: o.points ?? "risky" }) };
  const manifest = join(dir, "judge.json");
  writeFileSync(manifest, JSON.stringify(m));
  return { dir, tree, tarGz, manifest, m };
}
