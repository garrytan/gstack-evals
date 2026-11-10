// Copyright (c) 2026 Garry Tan. MIT License.
// The section 15 fixtures that depend on the unit, written for each real dry-run unit's language and code (dryrun-units.ts
// runs them). A fixture is what a stub agent leaves behind: the files its task turn writes, the CHECKS.json its wrap-up
// turn writes, and the outcome each entry must get. The unit's own fail-to-pass test arrives by applying the unit's
// test.patch in the task turn, so no upstream test text is copied here. A fixture that cannot apply to a unit names why.
import { TLC_CFG, TLC_SPEC } from "./tools.ts";

export type Want = "catch" | "no_catch" | "inline" | "names_nothing";
/** The fixtures section 15 lists that a real unit can drive, by the name each line prints. */
export type Role = "regress" | "fail" | "pass" | "golden" | "hash" | "changed" | "own" | "outside" | "random" | "hang" | "built" | "inline" | "nothing" | "static" | "api" | "sync" | "late" | "tlc";
export interface UnitFixture {
  /** Files the task turn of P writes into the repository root, then the shell it runs there (test.patch is applied by it). */
  files: Record<string, string>;
  after: string;
  /** P's CHECKS.json in listed order, with the outcome each entry must get. */
  manifest: Array<{ role: Role; command: string; want: Want }>;
  /** The test file P's wrap-up turn adds beside CHECKS.json (discarded). */
  late: { path: string; text: string };
  /** The verify skill and its model, under a directory the repository ignores. */
  verify: string[];
  /** Session C: a second agent test that breaks compilation on the fix tree, beside the test its entry runs. */
  compile: { files: Record<string, string>; command: string; broken: string; own: string };
  /** Session N: one entry, listed 26 times (beyond the cap and unreached by the ceiling). */
  cap: { files: Record<string, string>; command: string };
  /** Fixtures that cannot apply to this unit, and why. */
  na: Partial<Record<Role, string>>;
}
/** What a fixture reads from the unit: its test.patch and the sha256 of a base file. */
export interface FixtureCtx { testPatch: string; baseSha: (path: string) => string }

const b64 = (s: string) => Buffer.from(s).toString("base64");
const tlc = (dir: string) => '"$JAVA" -XX:+UseSerialGC -cp "$TLA2TOOLS" tlc2.TLC -workers 1 -metadir /tmp/pf-tlc -config ' + dir + "/Flag.cfg " + dir + "/Flag.tla";
const verifyFiles = (dir: string, name: string): Record<string, string> => ({
  [dir + "/SKILL.md"]: "---\nname: " + name + "\ndescription: rerun the model of the fix\n---\nRun TLC on Flag.tla.\n",
  [dir + "/Flag.tla"]: TLC_SPEC,
  [dir + "/Flag.cfg"]: TLC_CFG,
});
const applyTestPatch = (patch: string) => "echo " + b64(patch) + " | base64 -d | git apply --whitespace=nowarn";

/** blocky (Go). The bug: a client group may name a list no denylist or allowlist defines, and loading the config says
 *  nothing; the fix adds Blocking.validate, which config loading runs and which warns. The unit's own test (test.patch, an
 *  edit to config/blocking_test.go) stops package config's tests from compiling on base, so every other check lives in
 *  its own package and reaches the bug through the exported config.LoadConfig and the global logger. */
function blocky(c: FixtureCtx): UnitFixture {
  const M = "github.com/0xERR0R/blocky";
  const probe = [
    "package probe", "", "import (", '\t"os"', '\t"path/filepath"', '\t"strings"', "", '\t"' + M + '/config"', '\t"' + M + '/log"', '\t"github.com/sirupsen/logrus"', ")", "",
    "type hook struct{ msgs []string }", "",
    "func (h *hook) Levels() []logrus.Level { return logrus.AllLevels }", "",
    "func (h *hook) Fire(e *logrus.Entry) error {", "\th.msgs = append(h.msgs, e.Message)", "\treturn nil", "}", "",
    "// Warned loads a config whose client group names a list that no denylist or allowlist defines, and reports whether",
    "// loading it logged a message naming that list.",
    "func Warned(dir string) (bool, error) {",
    '\tpath := filepath.Join(dir, "blocky.yml")',
    '\tyml := "blocking:\\n  denylists:\\n    base:\\n      - /lists/base.txt\\n  clientGroupsBlock:\\n    default:\\n      - base\\n      - nonexisting\\n"',
    "\tif err := os.WriteFile(path, []byte(yml), 0o600); err != nil {", "\t\treturn false, err", "\t}",
    "\th := &hook{}", "\tlog.Log().AddHook(h)",
    "\tif _, err := config.LoadConfig(path, true); err != nil {", "\t\treturn false, err", "\t}",
    "\tfor _, m := range h.msgs {", '\t\tif strings.Contains(m, "nonexisting") {', "\t\t\treturn true, nil", "\t\t}", "\t}",
    "\treturn false, nil", "}", "",
  ].join("\n");
  const goTest = (pkg: string, name: string, imports: string[], body: string[]) => ["package " + pkg, "", "import (", ...imports.map((i) => (i ? '\t"' + i + '"' : "")), ")", "", "func " + name + "(t *testing.T) {", ...body.map((l) => "\t" + l), "}", ""].join("\n");
  const warned = ["warned, err := probe.Warned(t.TempDir())", "if err != nil {", "\tt.Fatal(err)", "}"];
  const P = M + "/pfcheck/probe";
  const files: Record<string, string> = {
    "pfcheck/probe/probe.go": probe,
    "pfcheck/fail/fail_test.go": goTest("fail", "TestPFFail", ["testing"], ['t.Fatal("this check always fails")']),
    "pfcheck/pass/pass_test.go": goTest("pass", "TestPFPass", ["testing"], ['t.Log("this check always passes")']),
    "pfcheck/golden/golden_test.go": goTest("golden", "TestPFGolden", ["testing", "", P], [...warned, "if warned {", '\tt.Fatal("loading warned; the recorded output has no warning")', "}"]),
    "pfcheck/own/own_test.go": goTest("own", "TestPFOwn", ["testing", "", M + "/config"], ["if !config.PFHelper() {", '\tt.Fatal("the helper says no")', "}"]),
    "pfcheck/random/random_test.go": goTest("random", "TestPFRandom", ["math/rand", "testing"], ["if rand.Intn(4) != 0 {", '\tt.Fatal("unlucky draw")', "}"]),
    "pfcheck/hang/hang_test.go": goTest("hang", "TestPFHang", ["testing", "time", "", P], [...warned, "if !warned {", "\ttime.Sleep(time.Hour)", "}"]),
    "pfcheck/replay/replay_test.go": goTest("replay", "TestPFReplay", ["testing", "", P], [...warned, "if !warned {", '\tt.Fatal("no warning for a client group naming an undefined list")', "}"]),
    "pfcheck/static/static_test.go": goTest("static", "TestPFStatic", ["os", "strings", "testing"], ['src, err := os.ReadFile("../../config/blocking.go")', "if err != nil {", "\tt.Fatal(err)", "}", 'if !strings.Contains(string(src), "references undefined allowlist or denylist") {', '\tt.Fatal("blocking.go has no message for an undefined list")', "}"]),
    "checks/hash.sh": '[ "$(sha256sum config/blocking.go | cut -c1-64)" != "' + c.baseSha("config/blocking.go") + '" ]\n',
    "checks/changed.sh": 'g() { git -c safe.directory="*" "$@"; }; ! g diff --quiet "$(g rev-list --max-parents=0 HEAD)" -- config/blocking.go\n',
    "checks/sync.sh": '[ "$(sha256sum config/blocking.go | cut -c1-64)" = "' + c.baseSha("config/blocking.go") + '" ] || { echo "verify-blocking is out of sync with the code: resync"; exit 1; }; go test -count=1 ./pfcheck/replay/ -run TestPFReplay\n',
    "checks/built.sh": '[ "$(go list -f "{{.Stale}}" ./config)" = false ] || { echo "package config is not built"; exit 1; }; go test -count=1 ./pfcheck/replay/ -run TestPFReplay\n',
    ...verifyFiles("site/verify-blocking", "verify-blocking"),
  };
  const go = (dir: string, name: string) => "go test -count=1 ./" + dir + "/ -run " + name;
  return {
    files,
    after: "printf '\\n// PFHelper is the agent edit a check imports.\\nfunc PFHelper() bool { return true }\\n' >> config/blocking.go && " + applyTestPatch(c.testPatch),
    manifest: [
      { role: "regress", command: "go test -count=1 ./config/ -ginkgo.focus=validate", want: "catch" },
      { role: "fail", command: go("pfcheck/fail", "TestPFFail"), want: "no_catch" },
      { role: "pass", command: go("pfcheck/pass", "TestPFPass"), want: "no_catch" },
      { role: "golden", command: go("pfcheck/golden", "TestPFGolden"), want: "no_catch" },
      { role: "hash", command: "bash checks/hash.sh", want: "no_catch" },
      { role: "changed", command: "bash checks/changed.sh", want: "no_catch" },
      { role: "own", command: go("pfcheck/own", "TestPFOwn"), want: "no_catch" },
      { role: "outside", command: "bash /tmp/pf-outside/blocking_test.go", want: "no_catch" },
      { role: "random", command: go("pfcheck/random", "TestPFRandom"), want: "no_catch" },
      { role: "hang", command: go("pfcheck/hang", "TestPFHang"), want: "catch" },
      { role: "built", command: "bash checks/built.sh", want: "catch" },
      { role: "inline", command: 'python3 -c "print(1)" config/blocking_test.go', want: "inline" },
      { role: "nothing", command: "ls -la", want: "names_nothing" },
      { role: "static", command: "go test -count=1 ./pfcheck/static/static_test.go", want: "catch" },
      { role: "sync", command: "bash checks/sync.sh", want: "no_catch" },
      { role: "late", command: "go test -count=1 ./late/", want: "names_nothing" },
      { role: "tlc", command: tlc("site/verify-blocking"), want: "no_catch" },
    ],
    late: { path: "late/late_test.go", text: goTest("late", "TestPFLate", ["testing"], []) },
    verify: Object.keys(verifyFiles("site/verify-blocking", "verify-blocking")).sort(),
    compile: {
      files: {
        "pfcheck/probe/probe.go": probe,
        "pfcheck/pkg/pkg_test.go": goTest("pkg", "TestPFPkg", ["testing", "", P], [...warned, "if !warned {", '\tt.Fatal("no warning for a client group naming an undefined list")', "}"]),
        "pfcheck/pkg/broken_test.go": goTest("pkg", "TestPFBroken", ["testing"], ["_ = OldName"]),
      },
      command: go("pfcheck/pkg", "TestPFPkg"), broken: "pfcheck/pkg/broken_test.go", own: "pfcheck/pkg/pkg_test.go",
    },
    cap: { files: { "pfcheck/fail/fail_test.go": files["pfcheck/fail/fail_test.go"]! }, command: go("pfcheck/fail", "TestPFFail") },
    na: {
      api: "the fix adds no identifier a test could guess that is absent from the base source: its one new method, Blocking.validate, shares its word with Config.validate and TLSVersion.validate, and the detector reads words, so the unit's own test is red on the parent with no API guess to classify",
    },
  };
}

export const FIXTURES: Record<string, (c: FixtureCtx) => UnitFixture> = { "0xERR0R__blocky-2016": blocky };
