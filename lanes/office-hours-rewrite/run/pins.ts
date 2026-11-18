// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's arms (prereg sections 2 and 4 step 2; pre-run change 1, item 1; pre-run change 2,
// section 1). It generalises the founder lane's single office-hours stack arm to two gstack pins plus none:
// - armSpecs: none is a bare arm (no gstack install, no skills folder, no drive); current and new are gstack stack arms at
//   their pin's sha, which the rig installs from a full clone under the state directory's sources/, as the founder
//   lane's e2e does.
// - pinProblems: a gstack tree holds the pin's VERSION (its trimmed text and its sha256, pre-run change 4) and every
//   file whose sha256 frozen.PINS[arm].files freezes. The
//   rig open checks the host-side tree of each skill arm, and each session's container checks its own copy
//   (containerPinCommand), so any mismatch refuses the launch or halts it (E_OHR_PIN_MISMATCH).
// - nullPinProblem: a manifest that holds a session on an arm whose pin is null refuses (E_OHR_NEW_PIN_UNSET). Both pins
//   are set by pre-run change 2; the rule stays for any pins table a caller passes.
// - armEnvProblems: frozen.ARM_ENV is set and every frozen.ARM_ENV_UNSET name is absent, on the agent env the driver
//   builds and on the names a container's env holds.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { stackKind } from "../../../src/arms/stacks.ts";
import { parseStackRef } from "../../../src/skill-eval/cli/arms.ts";
import type { ArmSpec } from "../../../src/types.ts";
import { ARM_ENV, ARM_ENV_UNSET, GSTACK_REPO, PINS, type Pin } from "../frozen.ts";
import type { ArmId, ManifestEntry, SkillArm } from "../types.ts";

export type Pins = Readonly<Record<SkillArm, Pin | null>>;
export const SKILL_ARMS: readonly SkillArm[] = ["current", "new"];
export const isSkillArm = (a: ArmId): a is SkillArm => a !== "none";

const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

/** The arm a manifest schedules on a null pin, as one refusal line, or null. */
export function nullPinProblem(entries: readonly Pick<ManifestEntry, "arm">[], pins: Pins = PINS): string | null {
  const arm = SKILL_ARMS.find((a) => pins[a] === null && entries.some((e) => e.arm === a));
  return arm ? "E_OHR_NEW_PIN_UNSET the manifest holds " + entries.filter((e) => e.arm === arm).length + " session(s) on the " + arm + " arm, whose pin is null until a pre-run change pins it" : null;
}

/** The rig's arm specs for the arms a launch runs; none is always there, bare. */
export function armSpecs(arms: readonly ArmId[], pins: Pins = PINS): ArmSpec[] {
  const specs: ArmSpec[] = [{ name: "none", kind: "bare" }];
  for (const a of arms) {
    if (!isSkillArm(a)) continue;
    const pin = pins[a];
    if (!pin) throw new Error(nullPinProblem([{ arm: a }], pins)!);
    const stack = parseStackRef(GSTACK_REPO + "@" + pin.sha);
    if (typeof stack === "string") throw new Error("E_INTERNAL " + stack);
    specs.push({ name: a, kind: "stack", stack, install: { ...stackKind(stack)?.install } });
  }
  return specs;
}

/** Why a gstack tree at dir is not the pin, one line per mismatch. */
export function pinProblems(dir: string | null, pin: Pin): string[] {
  if (!dir || !existsSync(dir)) return ["no gstack tree at " + dir];
  const p: string[] = [];
  const bytes = existsSync(join(dir, "VERSION")) ? readFileSync(join(dir, "VERSION")) : null;
  const version = bytes ? bytes.toString("utf8").trim() : null;
  if (version !== pin.version) p.push("VERSION reads " + version + ", and the pin is " + pin.version);
  else if (sha256(bytes!) !== pin.version_sha256) p.push("VERSION hashes to " + sha256(bytes!) + ", and the pin freezes " + pin.version_sha256);
  for (const [f, want] of Object.entries(pin.files)) {
    const got = existsSync(join(dir, f)) ? sha256(readFileSync(join(dir, f))) : null;
    if (got !== want) p.push(f + (got ? " hashes to " + got : " is missing") + ", and the pin freezes " + want);
  }
  return p;
}

/** The shell step a container runs to report its own tree: VERSION, then sha256sum of VERSION and every pinned file. */
export const containerPinCommand = (root: string, pin: Pin): string =>
  "cd " + JSON.stringify(root) + " && printf 'VERSION %s\\n' \"$(cat VERSION 2>/dev/null)\" && for f in VERSION " + Object.keys(pin.files).map((f) => JSON.stringify(f)).join(" ") + "; do if [ -f \"$f\" ]; then sha256sum \"$f\"; else echo \"missing $f\"; fi; done";

/** Mismatches in what containerPinCommand printed. */
export function containerPinProblems(printed: string, pin: Pin): string[] {
  const lines = printed.split("\n").map((l) => l.trim()).filter(Boolean);
  const version = lines.find((l) => l.startsWith("VERSION "))?.slice(8).trim() ?? null;
  const hashes = new Map(lines.flatMap((l) => { const m = /^([0-9a-f]{64})\s+(.+)$/.exec(l); return m ? [[m[2]!, m[1]!] as const] : []; }));
  const p: string[] = [];
  if (version !== pin.version) p.push("VERSION reads " + version + " in the container, and the pin is " + pin.version);
  else if (hashes.get("VERSION") !== pin.version_sha256) p.push("VERSION in the container " + (hashes.has("VERSION") ? "hashes to " + hashes.get("VERSION") : "is missing") + ", and the pin freezes " + pin.version_sha256);
  for (const [f, want] of Object.entries(pin.files)) if (hashes.get(f) !== want) p.push(f + " in the container " + (hashes.has(f) ? "hashes to " + hashes.get(f) : "is missing"));
  return p;
}

/** The gstack root inside an agent's HOME, from the install's gstack-skill-start path. */
export const containerRoot = (home: string, gstack: string): string => posix.join(home, posix.dirname(posix.dirname(gstack)));

/** Why an arm environment departs from section 4 step 2: an ARM_ENV value not set, or an ARM_ENV_UNSET name present. */
export function armEnvProblems(env: Readonly<Record<string, string | undefined>> | readonly string[]): string[] {
  const names = Array.isArray(env) ? new Set(env as readonly string[]) : new Set(Object.keys(env).filter((k) => (env as Record<string, string | undefined>)[k] !== undefined));
  const values = Array.isArray(env) ? null : (env as Record<string, string | undefined>);
  const p: string[] = [];
  for (const [k, v] of Object.entries(ARM_ENV)) if (values ? values[k] !== v : false) p.push(k + " is not " + v);
  for (const k of ARM_ENV_UNSET) if (names.has(k)) p.push(k + " is set");
  return p;
}
