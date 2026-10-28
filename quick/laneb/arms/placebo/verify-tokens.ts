// Re-checks every placebo body against its gstack original with Anthropic's
// token counting endpoint (free, rate limited) for claude-opus-5-5.
//
//   bun arms/placebo/verify-tokens.ts --gstack <gstack skills dir> --placebo <placebo skills dir>
//
// Skips with exit 0 when ANTHROPIC_API_KEY is not set. Exits 1 when a body is
// outside +-5%. The key is read from the environment and never printed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { skillFolders } from "./generate.ts";
import { splitSkill } from "./placebo.ts";

const MODEL = "claude-opus-5-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages/count_tokens";

async function countTokens(key: string, text: string): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: text }] }),
    });
    if (res.ok) return ((await res.json()) as { input_tokens: number }).input_tokens;
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await Bun.sleep(1000 * Number(res.headers.get("retry-after") ?? 2 ** attempt));
      continue;
    }
    throw new Error("count_tokens returned HTTP " + res.status);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const gstackDir = flag("--gstack");
  const placeboDir = flag("--placebo");
  if (!gstackDir || !placeboDir) {
    console.error("usage: verify-tokens.ts --gstack <gstack skills dir> --placebo <placebo skills dir>");
    process.exit(2);
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.log("skip: ANTHROPIC_API_KEY is not set; no count_tokens calls made");
    process.exit(0);
  }
  const overhead = (await countTokens(key, "x")) - 1;
  const body = (dir: string, folder: string) => splitSkill(readFileSync(join(dir, folder, "SKILL.md"), "utf8")).body;
  const rows: string[] = ["skill\toriginal_tokens\tplacebo_tokens\tratio"];
  let worst = 0;
  for (const folder of skillFolders(gstackDir)) {
    const original = (await countTokens(key, body(gstackDir, folder))) - overhead;
    const placebo = (await countTokens(key, body(placeboDir, folder))) - overhead;
    const ratio = placebo / original;
    worst = Math.max(worst, Math.abs(ratio - 1));
    rows.push([folder, original, placebo, ratio.toFixed(4)].join("\t"));
  }
  console.log(rows.join("\n"));
  console.log("model " + MODEL + " max_abs_deviation " + worst.toFixed(4));
  if (worst > 0.05) process.exit(1);
}
