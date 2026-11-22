// Copyright (c) 2026 Garry Tan. MIT License.
// The one key filter every lane uses for Harbor's own process env (src/trial/env.ts keylessEnv, dropKeyEnv) and the env -u
// list on every shell harbor run line. Harbor at its pin (f3a5a92) hands its process env to docker compose for file
// interpolation only, and our agents forward named variables into the container, so this filter keeps keys out of the
// harness process that holds the session's container.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { harborEnv } from "../../lanes/decision-routing/host/controller.ts";
import { dropKeyEnv, isKeyEnv, keylessEnv, KNOWN_KEY_ENV } from "../../src/trial/env.ts";

const REPO = join(import.meta.dir, "../..");
/** The key names configured on this project's machines (Capy project env, 2026-11-22). */
const PROJECT_KEYS = ["AGENTRUN_API_KEY", "AGENTRUN_BASE_URL", "ANTHROPIC_API_KEY", "EXA_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "UBICLOUD_API_KEY"];
const planted = () => Object.fromEntries([...KNOWN_KEY_ENV, ...PROJECT_KEYS].map((k) => [k, "planted-not-a-key-" + k.toLowerCase()]));
const tracked = (...globs: string[]) => spawnSync("git", ["ls-files", "-z", "--", ...globs], { cwd: REPO, encoding: "utf8" }).stdout.split("\0").filter(Boolean);

describe("the shared key filter", () => {
  // Value: protects=no known key name reaches Harbor's process from any lane; fails_when=a project key such as EXA_API_KEY, AGENTRUN_API_KEY or AGENTRUN_BASE_URL, or a new vendor's *_API_KEY, passes the filter; why_new=the pf, h2h, statemachines and eng-build filters named providers and let EXA and AgentRun keys through; seam=isKeyEnv, keylessEnv, dropKeyEnv; no_claim=what Harbor does with the env
  test("drops every known and project key name and anything shaped like a secret, and keeps the rest", () => {
    for (const k of [...KNOWN_KEY_ENV, ...PROJECT_KEYS, "NEWVENDOR_API_KEY", "GH_TOKEN", "GITHUB_TOKEN", "SOME_SECRET", "DB_PASSWORD", "AGENTRUN_REGION"]) expect(isKeyEnv(k)).toBe(true);
    const keep = { PATH: "/usr/bin:/bin", HOME: "/home/u", DOCKER_HOST: "unix:///var/run/docker.sock", PYTHONPATH: "/a", UBI_OWNER: "GEVA-1", HARBOR_TELEMETRY: "0" };
    expect(keylessEnv({ ...planted(), ...keep, UNSET: undefined })).toEqual(keep);
    const env: Record<string, string | undefined> = { ...planted(), ...keep };
    dropKeyEnv(env);
    expect(env).toEqual(keep);
  });

  test("the decision-routing controller's Harbor env holds none of them", () => {
    const env = harborEnv({ PATH: "/bin", ...planted() }, { socket: "/s.sock", token: "tok", base: "http://127.0.0.1:9" }, "/agent");
    expect(Object.keys(env).filter((k) => KNOWN_KEY_ENV.includes(k) || PROJECT_KEYS.includes(k))).toEqual([]);
  });
});

describe("every lane uses it", () => {
  /** TypeScript that starts Harbor, or names its binary: each must take its env from the shared filter. */
  const LAUNCH = /\?\? "harbor"|"harbor", "run"|\.harbor, "run"/;
  /** Files that name Harbor's binary only to print its version, with no env. */
  const VERSION_ONLY = ["lanes/eng-planted/stages/commands.ts"];

  // Value: protects=a lane that starts Harbor builds its env with keylessEnv or dropKeyEnv, never a filter of its own; fails_when=a new or edited launcher spawns Harbor with its own deny-list or the caller's whole env; why_new=fourteen copies of one provider regex drifted from the key list; seam=the import of src/trial/env.ts in each launcher; no_claim=the env a launcher passes is the filtered one, which the per-lane tests check
  test("each TypeScript Harbor launcher imports the shared filter and defines no key list of its own", () => {
    const launchers = tracked("lanes/*.ts", "quick/*.ts", "src/*.ts").filter((f) => !VERSION_ONLY.includes(f) && LAUNCH.test(readFileSync(join(REPO, f), "utf8")));
    expect(launchers.length).toBeGreaterThanOrEqual(10);
    for (const f of launchers) {
      const src = readFileSync(join(REPO, f), "utf8");
      expect({ f, shared: /import \{[^}]*\b(keylessEnv|dropKeyEnv)\b[^}]*\} from "[./]+\/src\/trial\/env\.ts"/.test(src) }).toEqual({ f, shared: true });
      expect({ f, own: /const (KEYS|PROVIDER_KEYS|SECRET_ENV) = /.test(src) }).toEqual({ f, own: false });
    }
  });

  // Value: protects=every shell harbor run line unsets every known key name before Harbor starts; fails_when=a script runs harbor with the caller's env, or its env -u list misses a name in KNOWN_KEY_ENV; why_new=vm-run.sh and route-check.sh unset three or four providers only; seam=the env -u flags on each logical harbor run line; no_claim=the scripts run, which their own tests check
  test("each shell harbor run line runs under env -u for every known key name", () => {
    const lines = tracked("*.sh").flatMap((f) => readFileSync(join(REPO, f), "utf8").replace(/\\\n/g, " ").split("\n").filter((l) => /\bharbor run\b/.test(l) && !/pkill|^\s*#/.test(l)).map((l) => ({ f, l })));
    expect(lines.length).toBeGreaterThanOrEqual(9);
    for (const { f, l } of lines) {
      const before = l.slice(0, l.indexOf("harbor run"));
      expect({ f, missing: KNOWN_KEY_ENV.filter((k) => !new RegExp("\\benv\\b[^|;&]*-u " + k + "\\b").test(before)) }).toEqual({ f, missing: [] });
    }
  });
});
