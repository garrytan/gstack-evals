// Copyright (c) 2026 Garry Tan. MIT License.
// Vendored unchanged from harness-evals (https://github.com/garrytan/harness-evals) runner/proxy/sanitize.ts at 70cb3d019.

/** Leak tripwire: markers (hidden facts, answer keys, task ids) that must never appear in a request body. */
export function findLeaks(text: string, markers: readonly string[]): string[] {
  const out: string[] = [];
  for (const m of markers) if (m && text.includes(m) && !out.includes(m)) out.push(m);
  return out;
}
