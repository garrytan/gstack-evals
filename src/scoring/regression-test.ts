// Copyright (c) 2026 Garry Tan. MIT License.
// B2's co-primary reader (2026-11-21-capy-b2-test-first-prereg section 6.2): the test files a session's final diff leaves.
// A file counts when the diff adds it, modifies it or renames something to it, and B1's test-path rule
// (lanes/delivery-route/detect.ts TEST_PATH) calls its path a test. The rule reads paths only, so a reproduction script named
// test_*.py counts; root_only says every such file sits at the repository root, for the report's count of those sessions.
import { TEST_PATH } from "../../lanes/delivery-route/detect.ts";

/** A path as git prints it: quotes and octal escapes undone, the a/ or b/ prefix taken off. */
function unquote(p: string): string {
  const s = p.trim();
  if (!s.startsWith('"')) return s.replace(/^[ab]\//, "");
  const bytes: number[] = [];
  const body = s.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== "\\") { bytes.push(...new TextEncoder().encode(ch)); continue; }
    const oct = /^[0-7]{3}/.exec(body.slice(i + 1));
    if (oct) { bytes.push(parseInt(oct[0], 8)); i += 3; continue; }
    const esc = body[++i] ?? "";
    bytes.push(...new TextEncoder().encode(({ n: "\n", t: "\t", '"': '"', "\\": "\\" } as Record<string, string>)[esc] ?? esc));
  }
  return new TextDecoder().decode(new Uint8Array(bytes)).replace(/^[ab]\//, "");
}

/** The files a diff leaves in place: each git file block's new path (its +++ line, its rename to line, or its header's b/
 *  path for a binary or mode-only block), none for a deleted file; for a plain unified diff with no git header, each +++
 *  path that is not /dev/null. */
function leftFiles(patch: string): string[] {
  const lines = patch.split("\n"), out: string[] = [];
  if (!lines.some((l) => l.startsWith("diff --git "))) return lines.filter((l) => l.startsWith("+++ ")).map((l) => l.slice(4)).filter((p) => p.trim() !== "/dev/null").map(unquote);
  let block: string[] | null = null;
  const close = () => {
    if (!block) return;
    const header = block[0]!, plus = block.find((l) => l.startsWith("+++ "))?.slice(4), to = block.find((l) => l.startsWith("rename to "))?.slice(10);
    if (!block.some((l) => l.startsWith("deleted file mode")) && plus?.trim() !== "/dev/null") {
      const b = plus ?? (to !== undefined ? "b/" + to : (/ ("b\/.*")$/.exec(header)?.[1] ?? / (b\/.*)$/.exec(header)?.[1]));
      if (b !== undefined) out.push(unquote(b));
    }
    block = null;
  };
  for (const l of lines) {
    if (l.startsWith("diff --git ")) { close(); block = [l]; }
    else block?.push(l);
  }
  close();
  return out;
}

/** The test files the diff adds, modifies or renames to, in diff order, and whether every one sits at the repository root
 *  (false when there are none). */
export function testFilesInDiff(patch: string): { files: string[]; root_only: boolean } {
  const files = [...new Set(leftFiles(patch).filter((f) => TEST_PATH.test(f)))];
  return { files, root_only: files.length > 0 && files.every((f) => !f.includes("/")) };
}
