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
      { role: "static", command: go("pfcheck/static", "TestPFStatic"), want: "catch" },
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

/** gitoxide (Rust). The bug: a three-way text merge with the Myers diff reports a conflict for two changes that do not
 *  overlap; the fix post-processes the diff before collecting its hunks (gix-merge/src/blob/builtin_driver/text/utils.rs).
 *  Every Rust test file under gix-merge/tests/ is its own test target, so each check is one file that carries its own copy
 *  of the probe. Entries spell cargo test as cargo t where a token must name nothing: "test" is a word of every Rust test. */
function gitoxide(c: FixtureCtx): UnitFixture {
  const FIX = "gix-merge/src/blob/builtin_driver/text/utils.rs";
  const probe = [
    "use gix_merge::blob::{builtin_driver, builtin_driver::text::Conflict, Resolution};", "",
    "/// Merges two changes that do not overlap (ours drops the first line, theirs the third) with the Myers diff, and",
    "/// reports whether the merge completed without a conflict.",
    "fn myers_clean() -> bool {",
    '    let base = b"one\\n\\ntwo\\nthree\\n\\n";',
    '    let ours = b"\\n\\ntwo\\nthree\\n";',
    '    let theirs = b"one\\n\\nthree\\n\\n";',
    "    let labels = builtin_driver::text::Labels { ancestor: None, current: None, other: None };",
    "    let options = builtin_driver::text::Options {",
    "        diff_algorithm: imara_diff::Algorithm::Myers,",
    "        conflict: Conflict::Keep { style: builtin_driver::text::ConflictStyle::Merge, marker_size: 7.try_into().unwrap() },",
    "    };",
    "    let mut out = Vec::new();",
    "    let mut input = imara_diff::InternedInput::default();",
    "    builtin_driver::text(&mut out, &mut input, labels, ours, base, theirs, options) == Resolution::Complete",
    "}", "",
  ].join("\n");
  const rsTest = (name: string, body: string[], head = "") => (head ? head + "\n" : "") + "#[test]\nfn " + name + "() {\n" + body.map((l) => "    " + l).join("\n") + "\n}\n";
  const withProbe = (name: string, body: string[]) => rsTest(name, body, probe);
  const files: Record<string, string> = {
    "gix-merge/tests/pfcheck_fail.rs": rsTest("pfcheck_fail", ['panic!("this check always fails");']),
    "gix-merge/tests/pfcheck_pass.rs": rsTest("pfcheck_pass", ['println!("this check always passes");']),
    "gix-merge/tests/pfcheck_golden.rs": withProbe("pfcheck_golden", ['assert!(!myers_clean(), "the merge completed; the recorded output has a conflict");']),
    "gix-merge/tests/pfcheck_own.rs": rsTest("pfcheck_own", ['assert!(gix_merge::pf_helper(), "the helper says no");']),
    "gix-merge/tests/pfcheck_random.rs": rsTest("pfcheck_random", ["use std::hash::{BuildHasher, Hasher};", "let mut h = std::collections::hash_map::RandomState::new().build_hasher();", "h.write_u8(0);", 'assert!(h.finish() % 4 == 0, "unlucky draw");']),
    "gix-merge/tests/pfcheck_hang.rs": withProbe("pfcheck_hang", ["if !myers_clean() {", "    loop {", "        std::thread::sleep(std::time::Duration::from_secs(3600));", "    }", "}"]),
    "gix-merge/tests/pfcheck_replay.rs": withProbe("pfcheck_replay", ['assert!(myers_clean(), "two changes that do not overlap gave a conflict");']),
    "gix-merge/tests/pfcheck_static.rs": rsTest("pfcheck_static", ['let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/blob/builtin_driver/text/utils.rs")).unwrap();', 'assert!(src.contains("postprocess_lines"), "utils.rs does not post-process the diff");']),
    "checks/hash.sh": '[ "$(sha256sum ' + FIX + ' | cut -c1-64)" != "' + c.baseSha(FIX) + '" ]\n',
    "checks/changed.sh": 'g() { git -c safe.directory="*" "$@"; }; ! g diff --quiet "$(g rev-list --max-parents=0 HEAD)" -- ' + FIX + "\n",
    "checks/sync.sh": '[ "$(sha256sum ' + FIX + ' | cut -c1-64)" = "' + c.baseSha(FIX) + '" ] || { echo "verify-merge is out of sync with the code: resync"; exit 1; }; cargo test -p gix-merge --test pfcheck_replay\n',
    "checks/built.sh": 'find "${CARGO_TARGET_DIR:-target}/debug/deps" -name "libgix_merge-*.rlib" -newer ' + FIX + ' | grep -q . || { echo "gix-merge is not built"; exit 1; }; cargo test -p gix-merge --test pfcheck_replay\n',
    ...verifyFiles("generated-do-not-edit/verify-merge", "verify-merge"),
  };
  const ct = (name: string) => "cargo test -p gix-merge --test " + name;
  return {
    files,
    after: "printf '\\n/// The agent edit a check imports.\\npub fn pf_helper() -> bool {\\n    true\\n}\\n' >> gix-merge/src/lib.rs && " + applyTestPatch(c.testPatch),
    manifest: [
      { role: "regress", command: "cargo test -p gix-merge --test merge false_conflict", want: "catch" },
      { role: "fail", command: ct("pfcheck_fail"), want: "no_catch" },
      { role: "pass", command: ct("pfcheck_pass"), want: "no_catch" },
      { role: "golden", command: ct("pfcheck_golden"), want: "no_catch" },
      { role: "hash", command: "bash checks/hash.sh", want: "no_catch" },
      { role: "changed", command: "bash checks/changed.sh", want: "no_catch" },
      { role: "own", command: ct("pfcheck_own"), want: "no_catch" },
      { role: "outside", command: "bash /tmp/pf-outside/builtin_driver.rs", want: "no_catch" },
      { role: "random", command: ct("pfcheck_random"), want: "no_catch" },
      { role: "hang", command: ct("pfcheck_hang"), want: "catch" },
      { role: "built", command: "bash checks/built.sh", want: "catch" },
      { role: "inline", command: 'python3 -c "print(1)" gix-merge/tests/merge/blob/builtin_driver.rs', want: "inline" },
      { role: "nothing", command: "ls -la", want: "names_nothing" },
      { role: "static", command: ct("pfcheck_static"), want: "catch" },
      { role: "sync", command: "bash checks/sync.sh", want: "no_catch" },
      { role: "late", command: "cargo t -p gix-merge --test pfcheck_late", want: "names_nothing" },
      { role: "tlc", command: tlc("generated-do-not-edit/verify-merge"), want: "no_catch" },
    ],
    late: { path: "gix-merge/tests/pfcheck_late.rs", text: rsTest("pfcheck_late", []) },
    verify: Object.keys(verifyFiles("generated-do-not-edit/verify-merge", "verify-merge")).sort(),
    compile: {
      files: {
        "gix-merge/tests/pfcheck_pkg.rs": withProbe("pfcheck_pkg", ['assert!(myers_clean(), "two changes that do not overlap gave a conflict");']),
        "gix-merge/tests/pfcheck_broken.rs": rsTest("pfcheck_broken", ["let _ = OldName;"]),
      },
      command: "cargo test -p gix-merge pfcheck_pkg", broken: "gix-merge/tests/pfcheck_broken.rs", own: "gix-merge/tests/pfcheck_pkg.rs",
    },
    cap: { files: { "gix-merge/tests/pfcheck_fail.rs": files["gix-merge/tests/pfcheck_fail.rs"]! }, command: ct("pfcheck_fail") },
    na: {
      api: "the fix adds no name to the repository's API: its one new call, postprocess_lines, is a method of the gix-imara-diff crate that the parent already has, so a test that calls it builds and runs on the parent and no parent failure names it",
    },
  };
}

/** agentscope (Java). The bug: GenerateOptions.parallelToolCalls never reaches an Anthropic request, because Anthropic takes it
 *  only as disable_parallel_tool_use inside the tool_choice object and AnthropicToolsHelper never sets that field; the fix
 *  sets it from the option (AnthropicToolsHelper.java). Every test of the anthropic module compiles together, so each check
 *  is one file that carries its own copy of the probe, and the check that needs the agent's product edit finds it by
 *  reflection. */
function agentscope(c: FixtureCtx): UnitFixture {
  const MOD = "agentscope-extensions/agentscope-extensions-model/agentscope-extensions-model-anthropic";
  const FIX = MOD + "/src/main/java/io/agentscope/extensions/model/anthropic/formatter/AnthropicToolsHelper.java";
  const OWN_TEST = MOD + "/src/test/java/io/agentscope/extensions/model/anthropic/formatter/AnthropicToolsHelperTest.java";
  const DIR = MOD + "/src/test/java/io/agentscope/extensions/model/anthropic/pfcheck/";
  const probe = [
    "    /** Applies one tool with parallel tool calls turned off and reports whether the request turns off parallel tool use. */",
    "    static boolean parallelOff() {",
    "        MessageCreateParams.Builder builder =",
    "                MessageCreateParams.builder()",
    '                        .model("pf-model")',
    "                        .maxTokens(16)",
    '                        .addMessage(MessageParam.builder().role(MessageParam.Role.USER).content("hi").build());',
    '        ToolSchema tool = ToolSchema.builder().name("lookup").description("Lookup").parameters(Map.of("type", "object")).build();',
    "        GenerateOptions options = GenerateOptions.builder().toolChoice(new ToolChoice.Auto()).parallelToolCalls(false).build();",
    "        AnthropicToolsHelper.applyTools(builder, List.of(tool), options);",
    "        MessageCreateParams params = builder.build();",
    "        return params.toolChoice().isPresent()",
    "                && params.toolChoice().get().isAuto()",
    "                && params.toolChoice().get().asAuto().disableParallelToolUse().orElse(false);",
    "    }",
  ];
  const PROBE_IMPORTS = ["com.anthropic.models.messages.MessageCreateParams", "com.anthropic.models.messages.MessageParam", "io.agentscope.core.model.GenerateOptions", "io.agentscope.core.model.ToolChoice", "io.agentscope.core.model.ToolSchema", "io.agentscope.extensions.model.anthropic.formatter.AnthropicToolsHelper", "java.util.List", "java.util.Map"];
  const jTest = (name: string, imports: string[], body: string[], withProbe = false) => {
    const all = [...new Set([...(withProbe ? PROBE_IMPORTS : []), ...imports])];
    const statics = all.filter((i) => i.startsWith("static ")).sort(), plain = all.filter((i) => !i.startsWith("static ")).sort();
    return ["package io.agentscope.extensions.model.anthropic.pfcheck;", "", ...statics.map((i) => "import " + i + ";"), ...(statics.length ? [""] : []), ...plain.map((i) => "import " + i + ";"), "import org.junit.jupiter.api.Test;", "",
      "class " + name + " {", ...(withProbe ? [...probe, ""] : []), "    @Test", "    void check() throws Exception {", ...body.map((l) => "        " + l), "    }", "}", ""].join("\n");
  };
  const MVN = "mvn -o -q -pl " + MOD + " test -Dspotless.check.skip=true -Dtest=";
  const assertTrue = "static org.junit.jupiter.api.Assertions.assertTrue";
  const files: Record<string, string> = {
    [DIR + "PFFailTest.java"]: jTest("PFFailTest", ["static org.junit.jupiter.api.Assertions.fail"], ['fail("this check always fails");']),
    [DIR + "PFPassTest.java"]: jTest("PFPassTest", [assertTrue], ['assertTrue(true, "this check always passes");']),
    [DIR + "PFGoldenTest.java"]: jTest("PFGoldenTest", ["static org.junit.jupiter.api.Assertions.assertFalse"], ['assertFalse(parallelOff(), "parallel tool use is off; the recorded request leaves it on");'], true),
    [DIR + "PFOwnTest.java"]: jTest("PFOwnTest", [assertTrue, "io.agentscope.extensions.model.anthropic.formatter.AnthropicToolsHelper"], ['assertTrue((Boolean) AnthropicToolsHelper.class.getMethod("pfHelper").invoke(null), "the helper says no");']),
    [DIR + "PFRandomTest.java"]: jTest("PFRandomTest", [assertTrue, "java.util.Random"], ['assertTrue(new Random().nextInt(4) == 0, "unlucky draw");']),
    [DIR + "PFHangTest.java"]: jTest("PFHangTest", [], ["if (!parallelOff()) {", "    Thread.sleep(Long.MAX_VALUE);", "}"], true),
    [DIR + "PFReplayTest.java"]: jTest("PFReplayTest", [assertTrue], ['assertTrue(parallelOff(), "parallel tool calls set to false left parallel tool use on");'], true),
    [DIR + "PFStaticTest.java"]: jTest("PFStaticTest", [assertTrue, "java.nio.charset.StandardCharsets", "java.nio.file.Files", "java.nio.file.Path"], [
      'Path src = Path.of(System.getProperty("user.dir"), "src/main/java/io/agentscope/extensions/model/anthropic/formatter/AnthropicToolsHelper.java");',
      'assertTrue(Files.readString(src, StandardCharsets.UTF_8).contains("disableParallelToolUse"), "the helper never sets disable_parallel_tool_use");',
    ]),
    "checks/hash.sh": '[ "$(sha256sum ' + FIX + ' | cut -c1-64)" != "' + c.baseSha(FIX) + '" ]\n',
    "checks/changed.sh": 'g() { git -c safe.directory="*" "$@"; }; ! g diff --quiet "$(g rev-list --max-parents=0 HEAD)" -- ' + FIX + "\n",
    "checks/sync.sh": '[ "$(sha256sum ' + FIX + ' | cut -c1-64)" = "' + c.baseSha(FIX) + '" ] || { echo "verify-tools is out of sync with the code: resync"; exit 1; }; ' + MVN + "PFReplayTest\n",
    "checks/built.sh": '[ -n "$(find ' + MOD + "/target/classes/io/agentscope/extensions/model/anthropic/formatter/AnthropicToolsHelper.class -newer " + FIX + ' 2>/dev/null)" ] || { echo "the helper is not built"; exit 1; }; ' + MVN + "PFReplayTest\n",
    ...verifyFiles("openspec/verify-tools", "verify-tools"),
  };
  return {
    files,
    after: "perl -0pi -e 's/\\}\\s*\\z/\\n    \\/** The agent edit a check finds. *\\/\\n    public static boolean pfHelper() {\\n        return true;\\n    }\\n}\\n/' " + FIX + " && " + applyTestPatch(c.testPatch),
    manifest: [
      { role: "regress", command: MVN + "AnthropicToolsHelperTest", want: "catch" },
      { role: "fail", command: MVN + "PFFailTest", want: "no_catch" },
      { role: "pass", command: MVN + "PFPassTest", want: "no_catch" },
      { role: "golden", command: MVN + "PFGoldenTest", want: "no_catch" },
      { role: "hash", command: "bash checks/hash.sh", want: "no_catch" },
      { role: "changed", command: "bash checks/changed.sh", want: "no_catch" },
      { role: "own", command: MVN + "PFOwnTest", want: "no_catch" },
      { role: "outside", command: "bash /tmp/pf-outside/AnthropicToolsHelperTest.java", want: "no_catch" },
      { role: "random", command: MVN + "PFRandomTest", want: "no_catch" },
      { role: "hang", command: MVN + "PFHangTest", want: "catch" },
      { role: "built", command: "bash checks/built.sh", want: "catch" },
      { role: "inline", command: 'python3 -c "print(1)" ' + OWN_TEST, want: "inline" },
      { role: "nothing", command: "ls -la", want: "names_nothing" },
      { role: "static", command: MVN + "PFStaticTest", want: "catch" },
      { role: "sync", command: "bash checks/sync.sh", want: "no_catch" },
      { role: "late", command: "mvn -o -q -pl " + MOD + " integration-test -Dtest=PFLateTest", want: "names_nothing" },
      { role: "tlc", command: tlc("openspec/verify-tools"), want: "no_catch" },
    ],
    late: { path: DIR + "PFLateTest.java", text: jTest("PFLateTest", [], []) },
    verify: Object.keys(verifyFiles("openspec/verify-tools", "verify-tools")).sort(),
    compile: {
      files: {
        [DIR + "PFPkgTest.java"]: jTest("PFPkgTest", [assertTrue], ['assertTrue(parallelOff(), "parallel tool calls set to false left parallel tool use on");'], true),
        [DIR + "PFBrokenTest.java"]: jTest("PFBrokenTest", [], ["Object x = OldName;"]),
      },
      command: MVN + "PFPkgTest", broken: DIR + "PFBrokenTest.java", own: DIR + "PFPkgTest.java",
    },
    cap: { files: { [DIR + "PFFailTest.java"]: files[DIR + "PFFailTest.java"]! }, command: MVN + "PFFailTest" },
    na: {
      api: "the fix adds no public name: GenerateOptions.getParallelToolCalls and the Anthropic builders' disableParallelToolUse are on the parent already, and its one new method is a private overload of applyToolChoice, so the unit's own test compiles on the parent and fails there with no API guess to classify",
    },
  };
}

export const FIXTURES: Record<string, (c: FixtureCtx) => UnitFixture> = { "0xERR0R__blocky-2016": blocky, "GitoxideLabs__gitoxide-2476": gitoxide, "agentscope-ai__agentscope-java-2257": agentscope };
