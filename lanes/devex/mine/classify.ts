// Copyright (c) 2026 Garry Tan. MIT License.
// The frozen developer-facing and UI classifier for both evals (devex prereg section 4; design prereg frame-rules.md
// part A). Its prompt is written once here for both evals, before any classifier call. It reads only the title, the
// earliest pre-merge description, the closing issues and the changed-file list. Opus 5.5 and GPT-6.1 Sol label each
// unit independently and Gemini 4 Argon settles a split, every call through the shared metered client on a ledger
// item (lanes/aftermath/meter.ts). The mechanical prefilter (frame.ts) runs first and is recorded beside the label.
import { createHash } from "node:crypto";
import type { Meter, ModelKey } from "../../aftermath/meter.ts";
import { panel } from "../../aftermath/panel.ts";

export const PROMPT = [
  "Below is a merged pull request from an open-source project: its title, its description and the issues it closes as they read before the merge, and the list of files it changed. Label the change by what it changes for the people who use the project.",
  "",
  "- developer_facing: true when it adds or changes something a developer uses directly: a command, subcommand or flag (CLI); an HTTP, RPC or GraphQL endpoint or webhook (API); a library's public function, method, class, type or hook (SDK); a config key, option, setting or environment variable (CONFIG). Give the one primary class that fits best. Set breaking true when existing users must change something (a removed or renamed surface, a changed default, changed output).",
  "- ui: true when it adds or changes what an end user sees or does in a graphical interface: a web app (WEB), a mobile app (MOBILE) or a desktop app (DESKTOP). Give the one primary class that fits best.",
  "- Both can be true. Neither is true for a fix, refactor, performance change, internal change, test, docs or build change with no new or changed surface.",
  "",
  "Output one fenced json block holding {\"developer_facing\": true | false, \"dev_class\": \"CLI\" | \"API\" | \"SDK\" | \"CONFIG\" | null, \"breaking\": true | false, \"ui\": true | false, \"ui_class\": \"WEB\" | \"MOBILE\" | \"DESKTOP\" | null} and nothing else.",
].join("\n");
export const PROMPT_SHA256 = createHash("sha256").update(PROMPT).digest("hex");
export const CLASSIFIERS = ["opus", "sol"] as const satisfies readonly [ModelKey, ModelKey];
export const THIRD: ModelKey = "gemini";

export interface Label {
  developer_facing: boolean;
  dev_class: "CLI" | "API" | "SDK" | "CONFIG" | null;
  breaking: boolean;
  ui: boolean;
  ui_class: "WEB" | "MOBILE" | "DESKTOP" | null;
}

export interface ClassifyInput {
  title: string;
  /** The earliest pre-merge description. */
  body: string;
  closing: Array<{ title: string; body: string }>;
  files: string[];
}

const fence = (name: string, text: string) => "\n\n<" + name + ">\n" + text + "\n</" + name + ">";
/** The classifier's whole input: the prompt and the four allowed parts, each cut to a fixed size. */
export function material(u: ClassifyInput): string {
  return PROMPT + fence("title", u.title) + fence("description", u.body.slice(0, 8000)) + u.closing.slice(0, 5).map((c, i) => fence("closing-issue-" + (i + 1), c.title + "\n\n" + c.body.slice(0, 4000))).join("") + fence("changed-files", u.files.slice(0, 300).join("\n"));
}

const DEV = new Set(["CLI", "API", "SDK", "CONFIG"]), UI = new Set(["WEB", "MOBILE", "DESKTOP"]);
/** The label from a reply's json block, or null when it doesn't fit the schema. */
export function parseLabel(text: string | null): Label | null {
  if (!text) return null;
  const m = /\x60\x60\x60(?:json)?\s*([\s\S]*?)\x60\x60\x60/.exec(text);
  let j: any;
  try {
    j = JSON.parse((m ? m[1]! : text).trim());
  } catch {
    return null;
  }
  if (typeof j?.developer_facing !== "boolean" || typeof j.ui !== "boolean" || typeof j.breaking !== "boolean") return null;
  const dev = j.developer_facing ? (DEV.has(j.dev_class) ? j.dev_class : null) : null;
  const ui = j.ui ? (UI.has(j.ui_class) ? j.ui_class : null) : null;
  if ((j.developer_facing && !dev) || (j.ui && !ui)) return null;
  return { developer_facing: j.developer_facing, dev_class: dev, breaking: j.developer_facing && j.breaking, ui: j.ui, ui_class: ui };
}

export const sameLabel = (a: Label, b: Label) => JSON.stringify(a) === JSON.stringify(b);

/** One unit through the panel: Opus and Sol, Argon on a split; every call on the meter, subject "classify". */
export async function classify(m: Meter, unit: string, input: ClassifyInput): Promise<{ opus: Label | null; sol: Label | null; gemini: Label | null; label: Label | null }> {
  const prompt = material(input);
  const ask = async (model: ModelKey): Promise<Label | null> => {
    try {
      const r = await m.call({ model, prompt, maxTokens: 2000, effort: "medium", label: unit + " classify-" + model, subject: "classify" });
      return parseLabel(r.text);
    } catch (e) {
      if ((e as { code?: string }).code === "E_DX_PROVIDER_DRIFT") return null;
      throw e;
    }
  };
  const r = await panel(ask, CLASSIFIERS, THIRD, sameLabel);
  return { opus: r.a, sol: r.b, gemini: r.third, label: r.decided };
}
