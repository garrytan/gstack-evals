// Copyright (c) 2026 Garry Tan. MIT License.
// Section 10's rename-only stock diff, checked in JavaScript and TypeScript, where the stock build check runs only node
// --check, so a rename that changes what the code does would pass it. TypeScript's own binder (the pinned typescript
// package's API over its bundled compiler) reads the file before and after the rename. The rename stands only when every
// renamed name is a local variable, every reference to each one is renamed, and the names group by binding the same way on
// both sides, with no use whose meaning depends on the name's text. The API is async and stockDiffs is not, so stockDiffs
// runs the check in a child process (checkRename).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Node, SourceFile } from "typescript/unstable/ast";
import { smFail } from "./unit.ts";

export interface Rename { path: string; before: string; after: string; name: string; renamed: string }

/** checkRenameHere in a child process: null when the rename keeps every binding, else why not. A check that does not run
 *  refuses (E_SM_PACKET), so a broken check never reads as a file with no safe rename. */
export function checkRename(x: Rename): string | null {
  const r = spawnSync(process.execPath, [import.meta.path], { input: JSON.stringify(x), encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  const line = r.status === 0 ? r.stdout.trim().split("\n").at(-1) : undefined;
  if (!line) return smFail("E_SM_PACKET", "the JavaScript and TypeScript rename check did not run on " + x.path + ": " + (r.error?.message ?? "exit " + r.status + " " + r.stderr.trim().slice(-300)));
  return (JSON.parse(line) as { why: string | null }).why;
}

/** The check. Each side is its own one-file project (no lib, no imports resolved), and every whole-word occurrence of the
 *  name on each side must be an identifier that resolves to a local variable whose references in the file are all
 *  occurrences, so a property name, a shorthand property or a parameter property (each also a property), a regular
 *  expression or JSX text is refused. Refused besides: a destructured property (the rename would read another property),
 *  a function or class that takes its name from the variable (its .name would change), and a file with a with statement
 *  or a direct eval. */
export async function checkRenameHere(x: Rename): Promise<string | null> {
  const { API, SymbolFlags } = await import("typescript/unstable/async");
  const { getTokenAtPosition, SyntaxKind } = await import("typescript/unstable/ast");
  const variable = SymbolFlags.FunctionScopedVariable | SymbolFlags.BlockScopedVariable;
  const naming = new Set([SyntaxKind.EqualsToken, SyntaxKind.BarBarEqualsToken, SyntaxKind.AmpersandAmpersandEqualsToken, SyntaxKind.QuestionQuestionEqualsToken]);
  const wrappers = new Set([SyntaxKind.ParenthesizedExpression, SyntaxKind.AsExpression, SyntaxKind.SatisfiesExpression, SyntaxKind.NonNullExpression, SyntaxKind.TypeAssertionExpression]);
  type Any = Node & Record<string, any>;
  const anonymous = (e: Any | undefined): boolean => {
    while (e && wrappers.has(e.kind)) e = e.expression;
    return !!e && (e.kind === SyntaxKind.ArrowFunction || ((e.kind === SyntaxKind.FunctionExpression || e.kind === SyntaxKind.ClassExpression) && !e.name));
  };
  const why = (id: Any): string | null => {
    const p = id.parent as Any;
    if (p.kind === SyntaxKind.BindingElement && !p.propertyName && p.parent.kind === SyntaxKind.ObjectBindingPattern) return "it names a destructured property";
    if (([SyntaxKind.VariableDeclaration, SyntaxKind.Parameter, SyntaxKind.BindingElement].includes(p.kind) && p.name === id && anonymous(p.initializer)) || (p.kind === SyntaxKind.BinaryExpression && p.left === id && naming.has(p.operatorToken.kind) && anonymous(p.right))) return "a function or class takes its name from it";
    return null;
  };
  const callee = (e: Any): Any => (wrappers.has(e.kind) ? callee(e.expression) : e);
  const dynamic = (sf: SourceFile) => {
    let found = false;
    const walk = (n: Any): void => {
      if (n.kind === SyntaxKind.WithStatement || (n.kind === SyntaxKind.CallExpression && callee(n.expression).kind === SyntaxKind.Identifier && callee(n.expression).text === "eval")) found = true;
      else n.forEachChild(walk);
    };
    walk(sf as Any);
    return found;
  };
  const d = mkdtempSync(join(tmpdir(), "sm-rename-"));
  const file = basename(x.path);
  const sides = [["before", x.before, x.name], ["after", x.after, x.renamed]] as const;
  for (const [side, text] of sides) {
    mkdirSync(join(d, side));
    writeFileSync(join(d, side, file), text);
    writeFileSync(join(d, side, "tsconfig.json"), JSON.stringify({ compilerOptions: { allowJs: true, noLib: true, noResolve: true, types: [], target: "esnext", module: "esnext", jsx: "preserve", noEmit: true }, files: [file] }));
  }
  const api = new API({ cwd: d });
  try {
    const snap = await api.updateSnapshot({ openProjects: sides.map(([side]) => join(d, side, "tsconfig.json")) });
    const groups: string[] = [];
    for (const [side, text, name] of sides) {
      const project = snap.getProject(join(d, side, "tsconfig.json"))!;
      const f = join(d, side, file);
      const syntax = await project.program.getSyntacticDiagnostics(f);
      if (syntax.length) return "the file " + side + " the rename does not parse: " + syntax[0]!.text;
      const sf = (await project.program.getSourceFile(f))!;
      if (dynamic(sf)) return "the file uses a with statement or a direct eval";
      const at = [...text.matchAll(new RegExp("(?<![\\w$])" + name.replace(/\$/g, "\\$") + "(?![\\w$])", "g"))].map((m) => m.index!);
      const syms = await project.checker.getSymbolAtPosition(f, at);
      const byId = new Map<number, number[]>();
      for (const [i, pos] of at.entries()) {
        const id = getTokenAtPosition(sf, pos) as Any, s = syms[i];
        const line = side + " the rename, line " + (text.slice(0, pos).split("\n").length);
        if (id.kind !== SyntaxKind.Identifier || id.text !== name || id.end !== pos + name.length) return line + ": " + name + " is not an identifier there";
        if (!s || !(s.flags & variable) || s.flags & ~variable) return line + ": " + name + " is not a local variable there";
        const bad = why(id);
        if (bad) return line + ": " + bad;
        if (!byId.has(s.id)) {
          byId.set(s.id, []);
          for (const h of await project.checker.getReferencesToSymbolInFile(f, s)) {
            const r = (await h.resolve(project)) as Any | undefined;
            if (!r || !at.includes(r.end - name.length)) return line + ": a reference to " + name + " is not renamed";
          }
        }
        byId.get(s.id)!.push(i);
      }
      groups.push(JSON.stringify([...byId.values()]));
    }
    return groups[0] === groups[1] ? null : "the renamed names bind differently after the rename";
  } finally {
    await api.close();
    rmSync(d, { recursive: true, force: true });
  }
}

if (import.meta.main) console.log(JSON.stringify({ why: await checkRenameHere(JSON.parse(readFileSync(0, "utf8")) as Rename) }));
