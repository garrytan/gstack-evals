// The versioned error record (interface v0.4, "Error records"): what --json writes as <out>/error.json for any failure,
// including one before verdict.json exists, and the stderr lines that mirror it. The fix, side effects, retry safety and
// resumability come from the code's entry in src/errors/codes.ts, so a record never disagrees with docs/errors.md.
//
// Secret values are scrubbed from the message and the cause, never dropped: the value of every environment variable whose
// name marks a credential, and anything shaped like a provider key or a bearer token, becomes [scrubbed]. Context carries
// variable names only.
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CODES, docAnchor, type ReasonCode } from "../../errors/codes.ts";
import type { ErrorContext, ErrorRecord } from "../../types.ts";

export const ERROR_FILE = "error.json";

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PAT$|AUTH/i;

/** Shapes of provider keys and tokens; a record must match none of them. */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
];

export function scrubSecrets(text: string, env: Record<string, string | undefined> = process.env): string {
  let out = text;
  for (const [name, value] of Object.entries(env)) if (value && value.length >= 8 && SECRET_NAME.test(name)) out = out.split(value).join("[scrubbed " + name + "]");
  for (const pattern of SECRET_PATTERNS) out = out.replace(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"), "[scrubbed]");
  return out;
}

export interface ErrorInput {
  code: ReasonCode;
  /** What was being done, such as "verdict" or "trial". */
  operation: string;
  message: string;
  role?: string | null;
  model?: string | null;
  /** The underlying error or value. */
  cause?: unknown;
  context: ErrorContext;
  correlation_id?: string | null;
  trace?: string | null;
  /** Retries the caller allows; defaults to 1 when a retry is safe and 0 when it is not. */
  retry_max?: number;
}

function causeOf(cause: unknown, env: Record<string, string | undefined>): ErrorRecord["cause"] {
  if (cause === undefined || cause === null) return null;
  const error = cause instanceof Error ? cause : null;
  const message = error ? error.message : String(cause);
  const own = (error as { code?: unknown } | null)?.code;
  const code = typeof own === "string" ? own : (/^([A-Z][A-Z0-9_]{2,})\b/.exec(message)?.[1] ?? error?.name ?? "Error");
  return { code, message: scrubSecrets(message, env) };
}

export function errorRecord(input: ErrorInput, env: Record<string, string | undefined> = process.env): ErrorRecord {
  const info = CODES[input.code];
  if (info.exit === null) throw new Error(input.code + " is a warning, not an error");
  return {
    schema_version: 1,
    code: input.code,
    operation: input.operation,
    role: input.role ?? null,
    model: input.model ?? null,
    message: scrubSecrets(input.message, env),
    cause: causeOf(input.cause, env),
    context: input.context,
    fix: info.fix,
    doc: docAnchor(input.code),
    side_effects: info.side_effects,
    retry: { safe: info.retry_safe, max: input.retry_max ?? (info.retry_safe ? 1 : 0) },
    resumable: info.resumable,
    correlation_id: input.correlation_id ?? (input.code === "E_INTERNAL" ? randomUUID() : null),
    trace: input.trace ?? null,
  };
}

/** The record's stderr mirror: message, cause, context, fix and docs lines, every line starting with the code. */
export function errorLines(record: ErrorRecord): string[] {
  const parts = [
    record.message,
    ...(record.cause ? ["cause: " + record.cause.code + ": " + record.cause.message] : []),
    "context: " + JSON.stringify(record.context),
    "fix: " + record.fix,
    "docs: " + record.doc,
    ...(record.correlation_id ? ["correlation: " + record.correlation_id + (record.trace ? " trace: " + record.trace : "")] : []),
  ];
  return parts.flatMap((p) => p.split(/\r\n|\r|\n/)).map((line) => record.code + " " + line);
}

/** Writes a JSON file through a temporary file and a rename, so a reader never sees half of it. */
export function writeAtomic(path: string, value: unknown): void {
  const tmp = path + ".tmp-" + process.pid;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, path);
}

/** Writes <out>/error.json and returns its path; with no out, or one that cannot be written, prints the record to stdout and returns null. */
export function writeErrorRecord(out: string | null, record: ErrorRecord, print: (text: string) => void = console.log): string | null {
  if (out !== null) {
    try {
      mkdirSync(out, { recursive: true });
      const path = join(out, ERROR_FILE);
      writeAtomic(path, record);
      return path;
    } catch {
      // Falls through to stdout, as the interface asks when --out is unwritable.
    }
  }
  print(JSON.stringify(record));
  return null;
}
