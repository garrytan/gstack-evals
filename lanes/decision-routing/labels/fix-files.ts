// Copyright (c) 2026 Garry Tan. MIT License.
// The real-fix file set: every path a task's solution patch touches (both sides of a rename, new files included).
// Relevance labels read it: a hit whose file the real fix edits must be kept.

export function fixFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split("\n")) {
    const git = /^diff --git a\/(\S+) b\/(\S+)\s*$/.exec(line);
    if (git) { files.add(git[1]!); files.add(git[2]!); continue; }
    const side = /^(?:--- a\/|\+\+\+ b\/|rename from |rename to )(\S+)/.exec(line);
    if (side) files.add(side[1]!);
  }
  return [...files].sort();
}
