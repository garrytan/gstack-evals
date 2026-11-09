// Copyright (c) 2026 Garry Tan. MIT License.
// dr_harbor's infrastructure rerun (prereg line 206) on python3 with Harbor's modules stubbed: harbor_rerun_test.py.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

test("dr_harbor reruns a provider or transport failure once, keeps the first attempt unscored, never reruns a model-caused exit, and logs shadow data only in calibration N sessions", () => {
  const r = spawnSync("python3", [join(import.meta.dir, "harbor_rerun_test.py")], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 120_000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.status !== 0) console.log(out);
  expect(out).toContain("Ran 7 tests");
  expect(r.status).toBe(0);
}, 150_000);
