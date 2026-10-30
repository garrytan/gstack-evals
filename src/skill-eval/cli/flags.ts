// The skill-eval flag table: every flag of the call, in one machine-readable place (U7, brief item 9). The parser below
// reads it, --help prints it, and U21 generates schema/interface.json from it with src/errors/codes.ts and U6's verdict
// schema. A row names the flag, its value kind, its default (or the rule that computes one), the variable that can set
// it, and the unit whose code acts on it. A flag whose owner has not built its behavior yet parses but is refused.
//
// Interface v0.5 (v0.4 where v0.5 is silent), "Call". Two flags are U7's additions: --item names the run's ledger line
// item (the interface left that flag open), and --example runs the keyless fake-host examples.

export type FlagKind = "switch" | "string" | "path" | "int" | "number" | "usd" | "list" | "enum" | "optional-enum";

export interface FlagSpec {
  name: string;
  aliases?: readonly string[];
  kind: FlagKind;
  /** The values an enum or optional-enum takes. */
  values?: readonly string[];
  /** A variable that sets the flag when it is not given. */
  env?: string;
  /** The default the flag takes when neither it nor its variable is given; null when there is none. */
  default: string | number | boolean | null;
  /** How a computed default is chosen, printed under effective defaults. */
  default_rule?: string;
  summary: string;
  /** The unit whose code acts on the flag. */
  owner: string;
  /** false: the flag parses, but the owner has not built its behavior, so a call that uses it is refused. */
  built: boolean;
}

export const SKILL_EVAL_FLAGS: readonly FlagSpec[] = [
  { name: "--arms", kind: "list", default: null, summary: "Arms as name=<dir>, name=<repo>@<sha>, name=<loadout.json>, none, placebo or bare; before and after are required.", owner: "U7", built: true },
  { name: "--tasks", kind: "path", default: null, summary: "The contract tasks file (a bare JSON array), usually test/fixtures/skill-evals/<skill>/tasks.json.", owner: "U5", built: true },
  { name: "--host", kind: "enum", values: ["claude", "codex"], default: null, summary: "The host CLI that runs every session: claude for every task, codex for non-interactive tasks.", owner: "U10", built: true },
  { name: "--model", kind: "list", default: null, summary: "Models under test, comma-separated; one verdict per model.", owner: "U7", built: true },
  { name: "--trials", aliases: ["--runs"], kind: "int", default: 3, summary: "Trials per task in each arm.", owner: "U7", built: true },
  { name: "--spend-cap", kind: "usd", default: null, summary: "The run's spend limit in dollars, required on any call that can spend; at most the approved cap on record.", owner: "U4", built: true },
  { name: "--out", kind: "path", default: null, default_rule: "~/.capy/work/gstack-evals/runs/<run id> on Capy, else $XDG_STATE_HOME/gstack-evals/runs/<run id> (~/.local/state when unset); never the OS temp dir or the tasks repo", summary: "The run directory: verdict.json, error.json, progress.json and runs/.", owner: "U7", built: true },
  { name: "--dry-run", kind: "switch", default: false, summary: "Print the matrix, the worst case in parts, parallelism and an ETA; spend nothing.", owner: "U7", built: true },
  { name: "--calibrate", kind: "switch", default: false, summary: "Run only the calibration checks.", owner: "U10", built: true },
  { name: "--tasks-only", kind: "list", default: null, summary: "Run only these task ids.", owner: "U7", built: true },
  { name: "--base", kind: "string", default: null, default_rule: "inferred from a rendered gstack skill folder (<root>/<skill>/SKILL.md beside <root>/bin/gstack-skill-start)", summary: "gstack@<sha>: overlay the arms on this gstack tree; needs --skill.", owner: "U7", built: true },
  { name: "--skill", kind: "string", default: null, default_rule: "inferred with --base from a rendered gstack skill folder", summary: "The target skill's name inside the base.", owner: "U7", built: true },
  { name: "--ext", kind: "path", default: null, default_rule: "tasks.ext.json beside the tasks file, when it exists", summary: "The tasks.ext.json sidecar.", owner: "U5", built: true },
  { name: "--policy", kind: "path", default: "policy/models.json", default_rule: "policy/models.json in the gstack-evals package", summary: "The model policy file; the verdict records its sha256.", owner: "U7", built: true },
  { name: "--smoke", kind: "switch", default: false, summary: "A smoke run: allows the policy's smoke-only models (Fable in the default policy).", owner: "U7", built: true },
  { name: "--no-noise-floor", kind: "switch", default: false, summary: "Drop before2, the second copy of before that is on by default.", owner: "U7", built: true },
  { name: "--ledger", kind: "path", env: "GSTACK_EVALS_LEDGER", default: null, default_rule: "~/.capy/work/gstack-evals/ledger.sqlite on Capy, else $XDG_STATE_HOME/gstack-evals/ledger.sqlite", summary: "The machine-local SQLite ledger; refused on a network or FUSE mount.", owner: "U4", built: true },
  { name: "--ledger-record", kind: "path", env: "GSTACK_EVALS_LEDGER_RECORD", default: null, default_rule: "$XDG_STATE_HOME/gstack-evals/record/; on Capy, point it at your Captain drive", summary: "The approval record: approvals, line items, leases and settlements.", owner: "U4", built: true },
  { name: "--item", kind: "string", env: "GSTACK_EVALS_ITEM", default: null, summary: "The ledger line item this run spends from; never implied.", owner: "U7", built: true },
  { name: "--isolation", kind: "enum", values: ["docker", "process"], default: "docker", summary: "Trial isolation; process must be explicit and is recorded in the verdict.", owner: "U9", built: true },
  { name: "--parallel", kind: "int", default: null, default_rule: "min(4, the machine's available parallelism)", summary: "Sessions run at once.", owner: "U9", built: true },
  { name: "--timeout", kind: "int", default: 600, summary: "Seconds per session; a sidecar timeout_s overrides it per task.", owner: "U9", built: true },
  { name: "--judge-model", kind: "string", default: null, default_rule: "the policy's judge default for the subjects' provider (gpt-6.1-sol for Anthropic subjects, claude-opus-5-5 for OpenAI subjects)", summary: "The cross-family judge for tasks with a judge rubric, allowed as a judge by the policy.", owner: "U10", built: true },
  { name: "--margin", kind: "number", default: null, summary: "Non-inferiority margin in percentage points; needed for noninferior: true.", owner: "U6", built: true },
  { name: "--resume", kind: "path", default: null, summary: "Continue a stopped run from its out directory.", owner: "U10", built: true },
  { name: "--repair", kind: "string", default: null, summary: "Rerun the cells a named repair affects, under a new verdict id.", owner: "U10", built: true },
  { name: "--mirror", kind: "path", default: null, summary: "Copy the verdict and receipts, without transcripts, machine paths or meter ids.", owner: "U10", built: true },
  { name: "--arms-file", kind: "path", default: null, summary: "The full arm manifest (schema/arms.schema.json) with an install command per host.", owner: "U9", built: false },
  { name: "--json", kind: "switch", default: false, summary: "Print JSON; every failure writes <out>/error.json.", owner: "U7", built: true },
  { name: "--example", kind: "optional-enum", values: ["miss", "safety", "unopened", "not-measurable", "cap-stop"], default: null, summary: "Run a keyless example on the fake host and write a real verdict.json; --example alone passes.", owner: "U7", built: true },
  { name: "--help", aliases: ["-h"], kind: "switch", default: false, summary: "Print this help.", owner: "U7", built: true },
];

export type FlagValue = string | number | boolean | string[];

export interface ParsedFlags {
  /** Values by canonical flag name, from the command line or the flag's variable. */
  values: Map<string, FlagValue>;
  /** Where each value came from: "flag", or the variable's name. */
  from: Map<string, string>;
}

const byName = (table: readonly FlagSpec[], name: string) => table.find((f) => f.name === name || f.aliases?.includes(name));

function convert(spec: FlagSpec, raw: string): { value: FlagValue } | { error: string } {
  const bad = (what: string) => ({ error: spec.name + " takes " + what + ", not " + JSON.stringify(raw) });
  switch (spec.kind) {
    case "int":
      return /^[1-9][0-9]*$/.test(raw) ? { value: Number(raw) } : bad("a positive whole number");
    case "number":
      return /^[0-9]+(\.[0-9]+)?$/.test(raw) && Number(raw) > 0 ? { value: Number(raw) } : bad("a positive number");
    case "usd":
      return /^[0-9]+(\.[0-9]{1,6})?$/.test(raw) && Number(raw) > 0 ? { value: raw } : bad("a positive dollar amount such as 12.50");
    case "list": {
      const items = raw.split(",").map((s) => s.trim());
      return items.every(Boolean) ? { value: items } : bad("a comma-separated list with no empty entries");
    }
    case "enum":
    case "optional-enum":
      return spec.values!.includes(raw) ? { value: raw } : bad("one of " + spec.values!.join(", "));
    default:
      return { value: raw };
  }
}

/**
 * Parses --flag value, --flag=value and bare switches against a flag table. An optional-enum takes a value only after
 * "=". A flag given twice, an unknown flag, a missing value or a bad value is refused with the first problem. Flags
 * with a variable take its value when they are not given.
 */
export function parseFlags(argv: readonly string[], table: readonly FlagSpec[], env: Record<string, string | undefined> = process.env): ParsedFlags | string {
  const values = new Map<string, FlagValue>();
  const from = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    const spec = byName(table, name);
    if (!spec) return (arg.startsWith("-") ? "unknown flag " : "unexpected argument ") + JSON.stringify(arg) + "; --help lists the flags";
    if (values.has(spec.name)) return spec.name + " given twice";
    let raw: string | undefined;
    if (spec.kind === "switch") {
      if (eq > 0) return spec.name + " takes no value";
      values.set(spec.name, true);
      from.set(spec.name, "flag");
      continue;
    }
    if (spec.kind === "optional-enum") raw = eq > 0 ? arg.slice(eq + 1) : "";
    else raw = eq > 0 ? arg.slice(eq + 1) : argv[++i];
    if (raw === undefined || (raw === "" && spec.kind !== "optional-enum")) return spec.name + " needs a value";
    const converted = raw === "" ? { value: true } : convert(spec, raw);
    if ("error" in converted) return converted.error;
    values.set(spec.name, converted.value);
    from.set(spec.name, "flag");
  }
  for (const spec of table) {
    if (values.has(spec.name) || !spec.env || !env[spec.env]) continue;
    const converted = convert(spec, env[spec.env]!);
    if ("error" in converted) return spec.env + ": " + converted.error;
    values.set(spec.name, converted.value);
    from.set(spec.name, spec.env);
  }
  return { values, from };
}

/** The flags a parsed call used whose behavior is not built yet, each with its owner. */
export const unbuiltFlags = (parsed: ParsedFlags, table: readonly FlagSpec[] = SKILL_EVAL_FLAGS): FlagSpec[] => table.filter((f) => !f.built && parsed.values.has(f.name));

export function flagHelp(table: readonly FlagSpec[]): string {
  const label = (f: FlagSpec) => [f.name, ...(f.aliases ?? [])].join(", ") + (f.kind === "switch" ? "" : f.kind === "optional-enum" ? "[=" + f.values!.join("|") + "]" : " <" + (f.kind === "enum" ? f.values!.join("|") : f.kind) + ">");
  const width = Math.max(...table.map((f) => label(f).length));
  return table
    .map((f) => {
      const extras = [f.env ? "env " + f.env : "", f.default !== null && f.default !== false ? "default " + String(f.default) : f.default_rule ? "default: " + f.default_rule : "", f.built ? "" : "not built yet: " + f.owner].filter(Boolean);
      return "  " + label(f).padEnd(width) + "  " + f.summary + (extras.length ? " (" + extras.join("; ") + ")" : "");
    })
    .join("\n");
}
