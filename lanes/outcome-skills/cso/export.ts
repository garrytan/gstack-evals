// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 15's export, run on the VM once every command has exited and before the VM is destroyed: everything the
// Captain's drive keeps from a run dir (scored texts, judge packets and replies, score records, the ledger and every
// command log) with a sha256 manifest. Every file under --run is copied at its own path, except the unit trees under
// trees/, which the unit build rebuilds. Stage 0 and stage 2 items stay plain. Stage 1 and re-pilot items go in sealed to
// the readout key: a file already sealed is copied as it is, and a plain file on a stage 1 or re-pilot path, or holding a
// plain stage 1 or re-pilot row, is sealed on the way to <path>.sealed. scored-texts.jsonl is written from the session
// records, its stage 1 and re-pilot rows sealed. The readout key never goes in: export refuses a key under --run and any
// file holding the key's bytes, and checks every file before it writes one.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isSealedRow, isSealedText, openRow, readKey, sealBytes, sealedStage, sealRow } from "./analysis/readout.ts";
import { flags } from "./cli.ts";
import { csoFail, loadCsoPrereg } from "./prereg.ts";
import { scoredText } from "./score/text.ts";
import type { SessionRecord } from "./types.ts";

const HELP = "Usage: gstack-evals cso export --run <dir> --out <dir> [--key <path>]\nSection 15's export of a finished run dir to a new dir, with MANIFEST.sha256: every file but trees/, plus scored-texts.jsonl.\nStage 1 and re-pilot items are sealed to the readout key (--key, needed when the run holds any); the key never goes in.";
const STAGED = /^(stage1|repilot)([-._]|$)/;
const MANIFEST = "MANIFEST.sha256", TEXTS = "scored-texts.jsonl";

const parse = (t: string): unknown => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};
const stagedRow = (v: unknown) => typeof v === "object" && v !== null && sealedStage(String((v as { stage?: unknown }).stage));

/** gstack-evals cso export. */
export async function exportCmd(argv: string[]): Promise<number> {
  const f = flags(argv, ["--run", "--out", "--key"], [], HELP);
  if (!f) return 0;
  const run = resolve(f.need("--run")), out = resolve(f.need("--out"));
  if (!existsSync(run) || !lstatSync(run).isDirectory()) csoFail("E_CSO_EXPORT", "--run " + run + " is not a directory");
  if (existsSync(out)) csoFail("E_CSO_EXPORT", out + " exists; export writes a new dir");
  const under = (a: string, b: string) => a === b || a.startsWith(b + sep);
  if (under(out, run) || under(run, out)) csoFail("E_CSO_EXPORT", "--out and --run must not hold each other");
  const key = f.has("--key") ? readKey(f.need("--key")) : null;
  if (key && under(realpathSync(f.need("--key")), realpathSync(run))) csoFail("E_CSO_EXPORT", "the readout key sits under --run; it never goes into an export");
  const needles = key ? [key, Buffer.from(key.toString("hex")), Buffer.from(key.toString("hex").toUpperCase())] : [];
  const sealer = (what: string) => key ?? csoFail("E_USAGE", what + " is stage 1 or re-pilot material, sealed to the readout key in the export; pass --key");
  const p = loadCsoPrereg();
  const items: { rel: string; data: () => Buffer; sealed: boolean }[] = [];
  const texts: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const src = join(d, e), rel = relative(run, src), st = lstatSync(src);
      if (st.isDirectory()) {
        if (rel !== "trees") walk(src);
        continue;
      }
      if (!st.isFile()) continue;
      if (rel === MANIFEST || rel === TEXTS) csoFail("E_CSO_EXPORT", rel + " in --run would collide with the file export writes");
      const bytes = readFileSync(src);
      if (needles.some((n) => bytes.includes(n))) csoFail("E_CSO_EXPORT", rel + " holds the readout key; nothing was exported");
      const text = bytes.toString("utf8");
      const sealedAlready = isSealedText(text);
      const plainStaged = !sealedAlready && (rel.split(sep).some((s) => STAGED.test(s)) || stagedRow(parse(text)) || text.split("\n").some((l) => stagedRow(parse(l))));
      if (plainStaged) {
        const k = sealer(rel);
        items.push({ rel: rel + ".sealed", data: () => Buffer.from(sealBytes(readFileSync(src), k)), sealed: true });
      } else items.push({ rel, data: () => readFileSync(src), sealed: sealedAlready });
      if (e !== "session.json") continue;
      const v = parse(text.trim());
      const s = (isSealedRow(v) ? openRow<SessionRecord>(v, sealer(rel), rel) : v) as SessionRecord;
      const row = { unit: s.unit, arm: s.arm, model: s.model, stage: s.stage, session: dirname(rel), scored: scoredText(s, p) };
      const line = sealedStage(s.stage) ? sealRow(row, sealer(rel)) : JSON.stringify(row);
      if (needles.some((n) => Buffer.from(line).includes(n))) csoFail("E_CSO_EXPORT", rel + "'s scored text holds the readout key; nothing was exported");
      texts.push(line);
    }
  };
  walk(run);
  if (texts.length) items.push({ rel: TEXTS, data: () => Buffer.from(texts.join("\n") + "\n"), sealed: false });
  mkdirSync(out, { recursive: true });
  const manifest: string[] = [];
  for (const it of items.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    const data = it.data();
    mkdirSync(dirname(join(out, it.rel)), { recursive: true });
    writeFileSync(join(out, it.rel), data, { flag: "wx", mode: it.sealed ? 0o600 : 0o644 });
    manifest.push(createHash("sha256").update(data).digest("hex") + "  " + it.rel);
  }
  const m = manifest.join("\n") + "\n";
  writeFileSync(join(out, MANIFEST), m, { flag: "wx" });
  console.log("exported " + items.length + " files to " + out + "; " + MANIFEST + " sha256 " + createHash("sha256").update(m).digest("hex"));
  return 0;
}
