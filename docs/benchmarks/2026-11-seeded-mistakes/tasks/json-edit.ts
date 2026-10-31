// Shape-agnostic JSON edits for the mutants of config-key-typo, missing-translation and timeout-units. mutants.sh runs it
// in a copy of the graded tree:
//   bun --no-env-file --config=<suite bunfig.toml> --tsconfig-override=<suite tsconfig.json> json-edit.ts <file> <edit> <args>
// An entry is an object named by its key (`"team": {...}`) or by a string field (`{ "name": "team", ... }`), found at any
// depth, so an edit lands wherever the tree keeps the entry. A message key such as profile.save matches a flat key, a
// nested path or a mix of the two, at any depth.
//   reformat                          the same JSON, indented by four spaces
//   rename <entry> <key> <to>         renames <key> wherever it is under each <entry>
//   set <entry> <word> <json>         sets every value under each <entry> whose key holds <word>, in any case
//   clone <entry> <name> [key=json]   puts a copy of the first <entry> beside it as <name>, with <entry> replaced by <name>
//                                     in its strings and each key set wherever it is in the copy
//   drop <message> <reference file>   deletes <message>
//   add <like> <message> <text>       adds <message> beside <like>, flat or nested the way <like> is
// An edit that finds nothing to change exits 3 and leaves the file as it was, so a mutant that did nothing never counts
// as applied. The one exception is a mistake already in place: rename when <to> is there and <key> is not, and drop when
// <message> is missing here but present in the reference file. Those exit 0 without writing.
import { readFileSync, writeFileSync } from "node:fs";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

const [file = "", edit = "", ...args] = process.argv.slice(2);
const isObj = (value: Json | undefined): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const children = (node: Json): Json[] => (isObj(node) ? Object.values(node) : Array.isArray(node) ? node : []);
const read = (path: string): Json => JSON.parse(readFileSync(path, "utf8"));
const doc = read(file);

function stop(why: string): never {
  console.error("E_TASKS_INVALID: json-edit: " + file + ": " + why);
  process.exit(3);
}

function objects(node: Json, out: Obj[] = []): Obj[] {
  if (isObj(node)) out.push(node);
  for (const child of children(node)) objects(child, out);
  return out;
}

function entries(node: Json, name: string, out: [Obj, Obj | Json[]][] = []): [Obj, Obj | Json[]][] {
  if (Array.isArray(node)) {
    for (const item of node) if (isObj(item) && Object.values(item).includes(name)) out.push([item, node]);
  } else if (isObj(node) && isObj(node[name])) out.push([node[name] as Obj, node]);
  for (const child of children(node)) entries(child, name, out);
  return out;
}

function places(node: Json, message: string): [Obj, string[]][] {
  const match = (holder: Obj, parts: string[]): string[][] => {
    const found: string[][] = [];
    for (let i = 1; i <= parts.length; i++) {
      const key = parts.slice(0, i).join(".");
      if (!Object.hasOwn(holder, key)) continue;
      if (i === parts.length) found.push([key]);
      else if (isObj(holder[key])) for (const rest of match(holder[key] as Obj, parts.slice(i))) found.push([key, ...rest]);
    }
    return found;
  };
  return objects(node).flatMap((holder) => match(holder, message.split(".")).map((path): [Obj, string[]] => [holder, path]));
}

function apply(): boolean {
  if (edit === "reformat") return true;
  if (edit === "rename") {
    const [name = "", from = "", to = ""] = args;
    const holders = entries(doc, name).flatMap(([entry]) => objects(entry));
    const hits = holders.filter((holder) => Object.hasOwn(holder, from));
    for (const holder of hits) {
      const pairs = Object.entries(holder);
      for (const [key] of pairs) delete holder[key];
      for (const [key, value] of pairs) holder[key === from ? to : key] = value;
    }
    if (hits.length) return true;
    if (holders.some((holder) => Object.hasOwn(holder, to))) return false;
    stop("no " + from + " under " + name);
  }
  if (edit === "set") {
    const [name = "", word = "", value = ""] = args;
    const holders = entries(doc, name).flatMap(([entry]) => objects(entry));
    const hits = holders.flatMap((holder) => Object.keys(holder).filter((key) => key.toLowerCase().includes(word.toLowerCase())).map((key): [Obj, string] => [holder, key]));
    for (const [holder, key] of hits) holder[key] = JSON.parse(value);
    if (hits.length) return true;
    stop("no key holding " + word + " under " + name);
  }
  if (edit === "clone") {
    const [name = "", copyName = "", ...sets] = args;
    const [entry, beside] = entries(doc, name)[0] ?? stop("no entry " + name);
    const copy: Obj = JSON.parse(JSON.stringify(entry, (_, value) => (typeof value === "string" ? value.replaceAll(name, copyName) : value)));
    for (const set of sets) {
      const key = set.slice(0, set.indexOf("="));
      const holders = objects(copy).filter((holder) => Object.hasOwn(holder, key));
      if (!holders.length) stop("no " + key + " under " + name);
      for (const holder of holders) holder[key] = JSON.parse(set.slice(set.indexOf("=") + 1));
    }
    if (Array.isArray(beside)) beside.push(copy);
    else beside[copyName] = copy;
    return true;
  }
  if (edit === "drop") {
    const [message = "", reference = ""] = args;
    const hits = places(doc, message);
    for (const [holder, path] of hits) delete path.slice(0, -1).reduce((at, key) => at[key] as Obj, holder)[path.at(-1)!];
    if (hits.length) return true;
    if (places(read(reference), message).length) return false;
    stop("no " + message + " here or in " + reference);
  }
  if (edit === "add") {
    const [like = "", message = "", text = ""] = args;
    const [holder, path] = places(doc, like)[0] ?? stop("no " + like);
    const parts = message.split(".");
    if (parts.length !== like.split(".").length) stop(message + " and " + like + " differ in shape");
    let at = holder;
    path.forEach((key, i) => {
      const part = parts.splice(0, key.split(".").length).join(".");
      if (i === path.length - 1) return void (at[part] = text);
      at[part] ??= {};
      if (!isObj(at[part])) stop(part + " is not an object");
      at = at[part] as Obj;
    });
    return true;
  }
  console.error("E_TASKS_INVALID: json-edit: no edit " + JSON.stringify(edit));
  process.exit(2);
}

if (apply()) writeFileSync(file, JSON.stringify(doc, null, edit === "reformat" ? 4 : 2) + "\n");
