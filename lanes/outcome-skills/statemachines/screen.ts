// Copyright (c) 2026 Garry Tan. MIT License.
// Section 3's keyless eligibility screen, in this order: the image resolves by digest; at least one fail-to-pass and one
// pass-to-pass test; the fix changes 1 to 6 non-test source files; the issue text is not a feature request by the frozen
// keyword screen (langs.ts FEAT, supply-count.py's pattern, over the first 800 code points). Each drop names its rule.
import type { Candidate } from "./source.ts";

export interface ScreenDrop { id: string; code: "E_SM_INELIGIBLE"; rule: string; value: string | number | null }

export function screenOne(c: Candidate): ScreenDrop | null {
  const drop = (rule: string, value: string | number | null): ScreenDrop => ({ id: c.id, code: "E_SM_INELIGIBLE", rule, value });
  if (!c.image_digest) return drop("image_digest", c.image_error ?? null);
  if (c.f2p < 1) return drop("fail_to_pass", c.f2p);
  if (c.p2p < 1) return drop("pass_to_pass", c.p2p);
  if (c.fix_source_files < 1 || c.fix_source_files > 6) return drop("fix_source_files_1_to_6", c.fix_source_files);
  if (c.feature_screen) return drop("feature_request_screen", null);
  return null;
}

export function screen(cands: Candidate[]): { schema: "sm-screen.v1"; eligible: { id: string; repo: string; month: string; lang: string }[]; drops: ScreenDrop[]; by_rule: Record<string, number> } {
  const eligible: { id: string; repo: string; month: string; lang: string }[] = [];
  const drops: ScreenDrop[] = [];
  for (const c of cands) {
    const d = screenOne(c);
    if (d) drops.push(d);
    else eligible.push({ id: c.id, repo: c.repo, month: c.month, lang: c.lang });
  }
  const by_rule: Record<string, number> = {};
  for (const d of drops) by_rule[d.rule] = (by_rule[d.rule] ?? 0) + 1;
  return { schema: "sm-screen.v1", eligible, drops, by_rule };
}
