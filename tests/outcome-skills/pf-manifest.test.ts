// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { inlineProgram, namedBy, readManifest, type TFacts } from "../../lanes/outcome-skills/pfchecks/manifest.ts";

const facts: TFacts = { changed: ["tests/replay_test.go", "spec/Conn.tla", "verify.sh"], test_files: ["tests/replay_test.go", "pkg/old_test.go"], test_words: new Set(["TestReplayReset", "replay"]) };
test("the inline-program rule", () => {
  for (const c of ["python -c 'print(1)'", "bash -ec 'go test'", "node --eval x", "perl -ne 'print'", "cat <<EOF", "diff <(a) b", "x >(y)", "/usr/bin/env sh -c 'x'", "go vet && python3 -c 1"]) expect(inlineProgram(c)).toBe(true);
  for (const c of ["go test ./tests -run TestReplayReset", "python -m pytest -c pytest.ini", "bash verify.sh -c", "node tests/a.js -e"]) expect(inlineProgram(c)).toBe(false);
});
test("names something in T", () => {
  expect(namedBy("go test ./tests -run TestReplayReset", facts)).toContain("TestReplayReset");
  expect(namedBy("bash verify.sh", facts)).toEqual(["verify.sh"]);
  expect(namedBy("go test ./pkg -run old_test", facts)).toEqual(["old_test"]);
  expect(namedBy("make check", facts)).toEqual([]);
});
test("groups, cap, skips and the no-manifest cases", () => {
  const entries = [{ command: "java -jar tla2tools.jar spec/Conn.tla" }, { command: "" }, { name: "n", command: 7 }, { command: "python -c 1" }, { command: "make all" }, ...Array.from({ length: 26 }, (_, i) => ({ command: "go test -run TestReplayReset" + " #" + i }))];
  const m = readManifest(JSON.stringify(entries), facts);
  expect(m.listed).toBe(31);
  expect(m.skipped).toEqual([1, 2]);
  expect(m.inline).toEqual([3]);
  expect(m.names_nothing).toEqual([4]);
  expect(m.run.length).toBe(25);
  expect(m.run[0]!.index).toBe(5);
  expect(m.beyond_cap).toEqual([30, 0]);
  expect(readManifest(null, facts).none).toBe("absent");
  expect(readManifest("{", facts).none).toBe("not_json");
  expect(readManifest("{}", facts).none).toBe("not_array");
  expect(readManifest("[1]", facts).none).toBe("not_objects");
  expect(readManifest(null, facts, { wrapupLimit: true }).none).toBe("wrapup_limit");
  expect(readManifest("[]", facts)).toMatchObject({ none: null, listed: 0, run: [] });
});
