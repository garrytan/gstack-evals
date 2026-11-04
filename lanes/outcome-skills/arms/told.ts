// The told install at gstack 699a41cb (G prereg section 2; O1): told-install.sh clones the pin into a clean HOME and runs
// its own ./setup --host claude --loadout lite, exactly as #193's install-pin.sh does. TOLD_PIN is #193's after-pin lite
// manifest (204 render files, their tree digest, the lite spec and the hooks) plus the sha256 of every pin file the G
// detectors and autoplan's configuration check were built from, and the file and sha256 of each hook the install adds.
// checkToldHome checks an installed home against it, for the HOME the session sees; toldRuntimePreflight checks that the
// session finds bun, which the pin's hooks and bin scripts run on, in the arm's image.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { dockerRun } from "./clean-room.ts";

export const TOLD_INSTALL_SH = join(import.meta.dir, "told-install.sh");

export const TOLD_PIN = {
  repo: "garrytan/gstack",
  sha: "699a41cb6808e01240d02e82247693f9170d401a",
  version: "1.94.39.0",
  loadout: "lite",
  install: "./setup --host claude --loadout lite",
  lite_files: 204,
  lite_tree_digest: "ed09c8c81574c6446a9579d255bd919470e4792bfc3ced4df42fd3fdc66dc8a7",
  lite_spec_sha256: "c5df50f999eb649abc0cd48c40907fe29c5ba71e4534a5cc63ae6e3d26234f1d",
  hooks: ["Stop gstack-timeline-stop 5", "Stop gstack-skill-contract 10", "UserPromptSubmit gstack-skill-route 5"],
  hook_files: {
    "gstack-timeline-stop": { file: "timeline-stop-hook", sha256: "b80d833ea66b1786f5c729b3e40c34982c484c64a064331087655111a5c52b59" },
    "gstack-skill-contract": { file: "skill-contract-stop-hook", sha256: "0ba38cdb7b2cd102fadd7e7e34e611da66a275e0efc8c043e43dd00d05b9367c" },
    "gstack-skill-route": { file: "skill-route-hook", sha256: "27e255325a97ca830e3947a100c93446501548bb46abc2ca247efac0c3223673" },
  },
  sources: {
    "plan-eng-review/SKILL.md": "58d96f6f3e296ccc2942e2e1a5732810b18f9f8bcd6ed9338115c99c91a88524",
    "plan-eng-review/sections/review-sections.md": "202df94f20273ae6fb1cd4e6f65953a4dd50880d04fd5010a05d2557359f11dc",
    "autoplan/SKILL.md": "a1f4036492f6b27c1f9b96b256408207bfc97e804bebb478a2f04a5d538a46ca",
    "autoplan/sections/phase-close.md": "7f1b6da860a302c2867972f622833f06f0bf65882bc50b8a96f9170667b7df7a",
    "bin/gstack-autoplan-snapshot.ts": "0f838123ea54f5e59ee0b046086af49e623624be6f2a419d0efb530e9d292ef5",
    "bin/gstack-skill-start": "3f22128cb6bd893e045741ddc04a1991ba328a1a2e904cc12e4c3385c85d608c",
    "bin/gstack-session-kind": "408a168892c0f088accfc580c08b294724edd826db31436d655e76dacec8ce90",
    "lib/autoplan-lean.ts": "52f957af41013d4770c5e6ed7f46c76f7dcac2555b53d5d5dbc6850d98df8637",
    "lib/autoplan-scope.ts": "2cc71f101c1af4b0df956bf1c9223264adb50550b5c3f1e21d9e1d382ccee36e",
  },
} as const;

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const fail = (why: string): never => {
  throw new Error("E_OUTCOME_TOLD_INSTALL " + why);
};

/** #193's lite digest: each render file with the render folder, then the home, replaced by <RENDER> and <HOME>, sorted by path; the lock is skipped. */
export function liteTreeDigest(at: string): { files: number; digest: string } {
  const home = resolve(at);
  const render = join(home, ".gstack", "render", "claude");
  const rows: [string, string][] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const st = statSync(p, { throwIfNoEntry: false });
      if (!st) fail(p + " is a broken link in the lite render");
      if (st!.isDirectory()) {
        if (!e.isSymbolicLink()) walk(p);
        continue;
      }
      const rel = relative(render, p);
      if (rel === "loadout.lock.json") continue;
      rows.push([rel, sha(Buffer.from(readFileSync(p).toString("latin1").replaceAll(render, "<RENDER>").replaceAll(home, "<HOME>"), "latin1"))]);
    }
  };
  walk(render);
  rows.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { files: rows.length, digest: sha(rows.map(([r, h]) => r + "\t" + h + "\n").join("")) };
}

/** Checks a home installed by told-install.sh against TOLD_PIN, for a session that sees it as sessionHome (its HOME, by
 * default the install home): each hook command is its source's pin file under sessionHome, each hook file has the pin's
 * sha256, and git status shows no change in the checkout. */
export function checkToldHome(home: string, sessionHome = home) {
  const skills = join(home, ".claude", "skills", "gstack");
  if (!existsSync(join(skills, "VERSION"))) fail(home + " has no gstack checkout at .claude/skills/gstack");
  const head = spawnSync("git", ["-C", skills, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim();
  const version = readFileSync(join(skills, "VERSION"), "utf8").trim();
  if (head !== TOLD_PIN.sha || version !== TOLD_PIN.version) fail(skills + " is at " + head + " (" + version + "), not the pin " + TOLD_PIN.sha + " (" + TOLD_PIN.version + ")");
  for (const [f, want] of Object.entries(TOLD_PIN.sources)) {
    const got = existsSync(join(skills, f)) ? sha(readFileSync(join(skills, f))) : "missing";
    if (got !== want) fail(skills + "/" + f + " is " + got + ", not the pin's " + want);
  }
  const config = existsSync(join(home, ".gstack", "config.yaml")) ? readFileSync(join(home, ".gstack", "config.yaml"), "utf8") : "";
  if (!/^claude_loadout:[ \t]*lite[ \t]*$/m.test(config)) fail(home + "/.gstack/config.yaml does not set claude_loadout: lite");
  const tree = existsSync(join(home, ".gstack", "render", "claude")) ? liteTreeDigest(home) : { files: 0, digest: "none" };
  if (tree.files !== TOLD_PIN.lite_files || tree.digest !== TOLD_PIN.lite_tree_digest) fail(home + "'s lite render has " + tree.files + " files with digest " + tree.digest + ", not " + TOLD_PIN.lite_files + " with " + TOLD_PIN.lite_tree_digest);
  const settingsPath = join(home, ".claude", "settings.json");
  const settings = (() => {
    try {
      return JSON.parse(readFileSync(settingsPath, "utf8")) as { hooks?: Record<string, { _gstack_source?: string; hooks: { command: string; timeout?: number }[] }[]> };
    } catch (e) {
      return fail(settingsPath + " is not readable JSON: " + (e as Error).message);
    }
  })();
  const hookDir = join(sessionHome, ".claude", "skills", "gstack", "hosts", "claude", "hooks");
  const hooks: string[] = [];
  for (const [event, groups] of Object.entries(settings.hooks ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const g of groups) for (const h of g.hooks) {
      const pin = g._gstack_source && Object.hasOwn(TOLD_PIN.hook_files, g._gstack_source) ? TOLD_PIN.hook_files[g._gstack_source as keyof typeof TOLD_PIN.hook_files] : null;
      const want = pin ? join(hookDir, pin.file) : "a hook the pin installs";
      if (h.command !== want) fail("the " + event + " hook " + h.command + " is not " + want + ", the pin's " + (g._gstack_source ?? "unnamed") + " hook at the session's HOME " + sessionHome);
      hooks.push(event + " " + g._gstack_source + " " + h.timeout);
    }
  }
  if (hooks.join("\n") !== TOLD_PIN.hooks.join("\n")) fail(settingsPath + " has the hooks " + JSON.stringify(hooks) + ", not the pin's " + JSON.stringify(TOLD_PIN.hooks));
  for (const { file, sha256 } of Object.values(TOLD_PIN.hook_files)) {
    const p = join(skills, "hosts", "claude", "hooks", file);
    const got = existsSync(p) ? sha(readFileSync(p)) : "missing";
    if (got !== sha256) fail(p + " has sha256 " + got + ", not the pin's " + sha256);
  }
  const status = spawnSync("git", ["--no-optional-locks", "-C", skills, "status", "--porcelain"], { encoding: "utf8" });
  if (status.status !== 0 || status.stdout.trim()) fail(skills + " is not the clean pin checkout: git status --porcelain " + (status.status !== 0 ? "exited " + status.status : "shows " + JSON.stringify(status.stdout.trim().slice(0, 300))));
  const review_sections = join(home, ".gstack", "render", "claude", "plan-eng-review", "sections", "review-sections.md");
  if (!existsSync(review_sections)) fail(review_sections + " is missing");
  return { ok: true as const, sha: head, version, loadout: "lite" as const, files: tree.files, digest: tree.digest, hooks, review_sections };
}

/** Runs command -v bun in the told arm's image, as the session's user, with the session's PATH and HOME (from sessionEnv)
 * and its mounts, so the pin's hooks and bin scripts, which run on bun, can start. Returns bun's path. */
export function toldRuntimePreflight(o: { docker: string; image: string; user?: string; env: Record<string, string>; mounts: readonly string[]; timeoutMs?: number }): string {
  if (!o.env.PATH) fail("the told session's environment sets no PATH, so bun cannot be found");
  const r = dockerRun({ ...o, env: { PATH: o.env.PATH!, ...(o.env.HOME ? { HOME: o.env.HOME } : {}) } }, ["command -v bun || exit 1"]);
  const bun = r.status === 0 ? r.stdout.trim() : "";
  if (bun) return bun;
  if (r.status === 0 || r.status === 1) fail("bun is not on the told session's PATH (" + o.env.PATH + ") in image " + o.image + ", so the pin's hooks and bin scripts cannot run");
  return fail("the told runtime check in image " + o.image + " did not finish (" + (r.error ? r.error.message : "exit " + (r.status ?? r.signal)) + ")" + (r.stderr?.trim() ? ": " + r.stderr.trim().slice(-300) : ""));
}
