import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { nolossCli } from "../../lanes/review-noloss/cli.ts";

export const dirs: string[] = [];
export const tmp = (name = "noloss-") => {
  const d = mkdtempSync(join(tmpdir(), name));
  dirs.push(d);
  return d;
};
export const cleanup = () => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
export const run = async (argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await nolossCli(argv, { out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};
export const writeArm = (dir: string, files: Map<string, Buffer>) => {
  for (const [name, bytes] of files) {
    if (name === "ingest.json") continue;
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), bytes);
  }
  return dir;
};
/** Rewrites a transcribed judgments.tsv row by row; set(row, outcome) keeps the severity columns consistent. */
export const editJudgments = (files: Map<string, Buffer>, f: (cells: string[], set: (o: string) => void) => void) => {
  const [head, ...rows] = files.get("judgments.tsv")!.toString("utf8").replace(/\n+$/, "").split("\n");
  const out = rows.map((r) => {
    const c = r.split("\t");
    f(c, (o) => {
      c[2] = o;
      c[4] = c[5] = o === "F" ? "CRITICAL" : o === "D" ? "INFORMATIONAL" : "";
    });
    return c.join("\t");
  });
  const m = new Map(files);
  m.set("judgments.tsv", Buffer.from([head, ...out].join("\n") + "\n"));
  return m;
};
export const editArm = (files: Map<string, Buffer>, f: (a: Record<string, unknown>) => void) => {
  const m = new Map(files);
  const a = JSON.parse(m.get("arm.json")!.toString("utf8"));
  f(a);
  m.set("arm.json", Buffer.from(JSON.stringify(a, null, 2)));
  return m;
};
