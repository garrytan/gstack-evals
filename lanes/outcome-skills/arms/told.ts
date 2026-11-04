// The told install at gstack 699a41cb (G prereg section 2; O1): told-install.sh clones the pin into a clean HOME and runs
// its own ./setup --host claude --loadout lite, exactly as #193's install-pin.sh does. TOLD_PIN is #193's after-pin lite
// manifest (204 render files, their tree digest, the lite spec and the hooks) plus the sha256 of every pin file the G
// detectors and autoplan's configuration check were built from. checkToldHome checks an installed home against it.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

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
      if (statSync(p, { throwIfNoEntry: false })?.isDirectory()) {
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

/** Checks a home installed by told-install.sh against TOLD_PIN. */
export function checkToldHome(home: string) {
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
  if (!/^claude_loadout:\s*lite\s*$/m.test(config)) fail(home + "/.gstack/config.yaml does not set claude_loadout: lite");
  const tree = existsSync(join(home, ".gstack", "render", "claude")) ? liteTreeDigest(home) : { files: 0, digest: "none" };
  if (tree.files !== TOLD_PIN.lite_files || tree.digest !== TOLD_PIN.lite_tree_digest) fail(home + "'s lite render has " + tree.files + " files with digest " + tree.digest + ", not " + TOLD_PIN.lite_files + " with " + TOLD_PIN.lite_tree_digest);
  const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")) as { hooks?: Record<string, { _gstack_source?: string; hooks: { command: string; timeout?: number }[] }[]> };
  const hooks: string[] = [];
  for (const [event, groups] of Object.entries(settings.hooks ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const g of groups) for (const h of g.hooks) {
      if (!h.command.startsWith(join(skills, "hosts", "claude", "hooks") + "/")) fail("the " + event + " hook " + h.command + " is not the pin's own");
      hooks.push(event + " " + g._gstack_source + " " + h.timeout);
    }
  }
  if (hooks.join("\n") !== TOLD_PIN.hooks.join("\n")) fail(home + "/.claude/settings.json has the hooks " + JSON.stringify(hooks) + ", not the pin's " + JSON.stringify(TOLD_PIN.hooks));
  const review_sections = join(home, ".gstack", "render", "claude", "plan-eng-review", "sections", "review-sections.md");
  if (!existsSync(review_sections)) fail(review_sections + " is missing");
  return { ok: true as const, sha: head, version, loadout: "lite" as const, files: tree.files, digest: tree.digest, hooks, review_sections };
}
