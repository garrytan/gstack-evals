// Copyright (c) 2026 Garry Tan. MIT License.
// Judge-client pieces the aftermath-keyed plan-review evals share (product-value and devex, section 7 of each prereg):
// sha256-pinned prompt files, the last JSON object in a reply, the one whole-packet resend note, and a fetch tap that
// records the model string the provider reported for each request, so every label names the version that answered.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const RESEND_NOTE = "\n\n(This packet is sent a second time because the first answer missed or garbled at least one cell. Answer every cell.)";

/** Reads dir/name.md and returns it only when its sha256 matches the pin; null otherwise, for the binding to refuse. */
export function readPinned(dir: string, name: string, pin: string): string | null {
  const text = readFileSync(join(dir, name + ".md"), "utf8");
  return sha(text) === pin ? text : null;
}

/** The last JSON object in a reply, inside a code fence or bare. */
export function lastJson(text: string): any {
  const trimmed = text.trim();
  const fences = [...trimmed.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  for (const cand of [trimmed, ...fences.reverse(), trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)]) {
    try {
      const v = JSON.parse(cand);
      if (v && typeof v === "object") return v;
    } catch {}
  }
  return null;
}

/** The file a request's reported model string lands in: sha256(model id, newline, prompt).version under dir. */
export const versionFile = (dir: string, modelId: string, prompt: string): string => join(dir, sha(modelId + "\n" + prompt) + ".version");

/** Wraps fetch so each upstream reply's model string is written beside the request's prompt digest. */
export function versionTap(base: typeof fetch, dir: string): typeof fetch {
  return (async (url: any, init?: any) => {
    const res = await base(url, init);
    try {
      const req = JSON.parse(String(init?.body ?? "null"));
      const prompt = (req?.input ?? req?.messages)?.[0]?.content;
      const body = JSON.parse(await res.clone().text());
      if (typeof prompt === "string" && typeof body?.model === "string") writeFileSync(versionFile(dir, String(req.model), prompt), body.model, { mode: 0o600 });
    } catch {}
    return res;
  }) as typeof fetch;
}
