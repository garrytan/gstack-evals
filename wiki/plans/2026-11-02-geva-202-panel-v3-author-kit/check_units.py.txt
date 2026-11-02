#!/usr/bin/env python3
"""Panel v3 author kit checker (kit v3).

Checks every unit under a panel folder for layout, sizes, scope, the clean-room
path list, the echo terms and the key schema. It prints unit ids, check codes,
paths, item ids, terms from the kit's own list and counts, never file text.

  python3 check_units.py <panel_dir> --wave calibration
  python3 check_units.py <panel_dir> --wave admission --kept E-CD,E-Q --floor E-OM
  python3 check_units.py <panel_dir> --wave confirmatory --kept E-CD,E-Q --floor none
  python3 check_units.py --self-test

The admission and confirmatory waves require --kept and --floor (none when no
kept kind is KEEP-FLOOR), so the E0 recipe can't be skipped by leaving them out.

Exit 0 when the last line reads "problems 0", 1 when it counts problems, 2 on a
usage error.
"""
import json
import os
import re
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

STRATA = ("ceo", "eng", "dx", "design")
MODES = ("greenfield", "added", "fix")
WAVES = ("calibration", "admission", "confirmatory")
KINDS = {
    "C-Q": ("ceo", ("H2", "QT")),
    "C-U2": ("ceo", ("H2", "QT")),
    "C-OM": ("ceo", ("OM", "H2")),
    "E-CD": ("eng", ("CD", "H2")),
    "E-OM": ("eng", ("OM", "QT")),
    "E-Q": ("eng", ("QT", "H2")),
    "X-OM": ("dx", ("OM", "H2")),
    "X-CD": ("dx", ("CD", "QT")),
    "X-Q": ("dx", ("QT", "H2")),
    "G-OM": ("design", ("OM", "QT")),
    "G-A11Y": ("design", ("H2", "QT")),
    "G-X": ("design", ("H2", "QT")),
}
NEEDS_EXISTING = {"C-U2", "E-CD", "E-OM", "X-OM", "X-CD", "G-X"}
NEEDS_DECISION = {"C-Q", "C-U2"}
ANCHORS = ("A-X", "A-F", "A-T")
LEVER_FIELD = {"H2": "intermediate", "QT": "computation", "OM": "absent_step", "CD": "code_fact"}
SEVERITIES = ("Critical", "High")
MINOR_SEVERITIES = ("Medium", "Low")

PLAN_BYTES = (7000, 11000)
CONTEXT_BYTES = (20000, 45000)
CONTEXT_FILES = (10, 20)
CONTEXT_DIR_MIN_FILES = 6
SRC_MAX_FILES = 12
SRC_FILE_MAX_BYTES = 5000
SECTIONS = (6, 12)
MINORS = (2, 4)

CONTEXT_EXT = {".md", ".csv", ".json", ".yaml", ".yml", ".txt"}
SRC_EXT = {".py", ".ts", ".js", ".go", ".rb", ".java", ".kt", ".rs", ".sql", ".sh",
           ".json", ".yaml", ".yml", ".toml", ".md", ".tsx", ".jsx", ".css", ".scss",
           ".html", ".vue", ".svelte", ".swift", ".dart", ".cs", ".php", ".txt"}
UI_EXT = ("tsx", "jsx", "vue", "svelte", "css", "scss", "html", "swift", "storyboard", "xib", "dart")
UI_NAME = re.compile(r"[A-Za-z0-9_./-]+\.(?:" + "|".join(UI_EXT) + r")\b", re.I)

# The clean-room path list (plan section 4, I1): a unit tree that holds any of
# these fails at authoring, before any trial image sees it.
CLEAN_ROOM_NAMES = {".claude", ".capy", ".gstack", ".local", "agents.md", "claude.md", "gemini.md", "skill.md"}
CLEAN_ROOM_PATH_WORDS = ("gstack", ".claude/skills", ".capy/drive", ".local/share/gstack")

UNIT_ID = re.compile(r"^[0-9a-f]{8}$")
HEADING = re.compile(r"^(#{1,6})[ \t]+(.*?)[ \t#]*$")


class Report:
    def __init__(self):
        self.lines = []
        self.count = 0

    def problem(self, unit, code, detail):
        self.count += 1
        self.lines.append("PROBLEM %s %s: %s" % (unit, code, detail))


def load_echo_terms(path):
    anywhere, headings = [], []
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            scope, _, phrase = line.partition(":")
            phrase = " ".join(phrase.strip().lower().split())
            if not phrase or scope not in ("any", "heading"):
                raise SystemExit("E_USAGE echo-terms.txt: bad line: %s" % scope)
            (anywhere if scope == "any" else headings).append(phrase)
    return anywhere, headings


def term_regex(phrase):
    body = r"\s+".join(re.escape(w) for w in phrase.split(" "))
    left = r"(?<![A-Za-z0-9])" if phrase[0].isalnum() else ""
    right = r"(?![A-Za-z0-9])" if phrase[-1].isalnum() else ""
    return re.compile(left + body + right, re.I)


def walk(unit_dir):
    out = []
    for root, dirs, files in os.walk(unit_dir, followlinks=False):
        for name in sorted(dirs) + sorted(files):
            full = os.path.join(root, name)
            out.append((os.path.relpath(full, unit_dir).replace(os.sep, "/"), full))
    return sorted(out)


def plan_headings(text):
    return [m.group(2).strip() for m in (HEADING.match(l) for l in text.splitlines())
            if m and m.group(1) == "##"]


def check_tree(unit, unit_dir, rep):
    files = {}
    for rel, full in walk(unit_dir):
        parts = rel.split("/")
        low = rel.lower()
        if os.path.islink(full):
            rep.problem(unit, "clean-room", "symlink %s" % rel)
            continue
        hit = [p for p in parts if p.lower() in CLEAN_ROOM_NAMES]
        hit += [w for w in CLEAN_ROOM_PATH_WORDS if w in low]
        if hit:
            rep.problem(unit, "clean-room", "path %s matches %s" % (rel, hit[0]))
        if any(p.startswith(".") for p in parts):
            rep.problem(unit, "layout", "hidden path %s" % rel)
        if os.path.isdir(full):
            if len(parts) == 1 and parts[0] not in ("context", "src"):
                rep.problem(unit, "layout", "unexpected folder %s" % rel)
            if parts[0] == "context" and len(parts) > 1:
                rep.problem(unit, "layout", "context/ holds a subfolder %s" % rel)
            continue
        if len(parts) == 1 and parts[0] not in ("plan.md", "key.json"):
            rep.problem(unit, "layout", "unexpected top-level file %s" % rel)
        ext = os.path.splitext(rel)[1].lower()
        if parts[0] == "context" and ext not in CONTEXT_EXT:
            rep.problem(unit, "layout", "context file type %s" % rel)
        if parts[0] == "src" and ext not in SRC_EXT:
            rep.problem(unit, "layout", "src file type %s" % rel)
        try:
            with open(full, encoding="utf-8") as f:
                files[rel] = f.read()
        except UnicodeDecodeError:
            rep.problem(unit, "layout", "not UTF-8 text %s" % rel)
    for need in ("plan.md", "key.json"):
        if need not in files:
            rep.problem(unit, "layout", "missing %s" % need)
    if not os.path.isdir(os.path.join(unit_dir, "context")):
        rep.problem(unit, "layout", "missing context/")
    return files


def check_sizes(unit, files, rep):
    plan = files.get("plan.md", "")
    n = len(plan.encode("utf-8"))
    if not PLAN_BYTES[0] <= n <= PLAN_BYTES[1]:
        rep.problem(unit, "plan-size", "plan.md is %d bytes, want %d to %d" % ((n,) + PLAN_BYTES))
    heads = plan_headings(plan)
    if not SECTIONS[0] <= len(heads) <= SECTIONS[1]:
        rep.problem(unit, "plan-sections", "%d ## sections, want %d to %d" % ((len(heads),) + SECTIONS))
    if len(set(heads)) != len(heads):
        rep.problem(unit, "plan-sections", "two ## headings share one text")
    ctx = [r for r in files if r.startswith("context/")]
    src = [r for r in files if r.startswith("src/")]
    total = sum(len(files[r].encode("utf-8")) for r in ctx + src)
    if not CONTEXT_BYTES[0] <= total <= CONTEXT_BYTES[1]:
        rep.problem(unit, "context-size", "context/ and src/ hold %d bytes, want %d to %d" % ((total,) + CONTEXT_BYTES))
    if not CONTEXT_FILES[0] <= len(ctx) + len(src) <= CONTEXT_FILES[1]:
        rep.problem(unit, "context-files", "context/ and src/ hold %d files, want %d to %d" % ((len(ctx) + len(src),) + CONTEXT_FILES))
    if len(ctx) < CONTEXT_DIR_MIN_FILES:
        rep.problem(unit, "context-files", "context/ holds %d files, want at least %d" % (len(ctx), CONTEXT_DIR_MIN_FILES))
    if len(src) > SRC_MAX_FILES:
        rep.problem(unit, "src-files", "src/ holds %d files, want at most %d" % (len(src), SRC_MAX_FILES))
    for r in src:
        b = len(files[r].encode("utf-8"))
        if b > SRC_FILE_MAX_BYTES:
            rep.problem(unit, "src-size", "%s is %d bytes, want at most %d" % (r, b, SRC_FILE_MAX_BYTES))
    return heads, src


def check_echo(unit, files, anywhere, headings, rep):
    any_re = [(t, term_regex(t)) for t in anywhere]
    head_re = [(t, term_regex(t)) for t in headings]
    for rel in sorted(files):
        for t, rx in any_re:
            if rx.search(rel):
                rep.problem(unit, "echo-path", "%s matches any: %s" % (rel, t))
        if rel == "key.json":
            continue
        is_md = rel.endswith(".md")
        for i, line in enumerate(files[rel].splitlines(), 1):
            for t, rx in any_re:
                if rx.search(line):
                    rep.problem(unit, "echo", "%s line %d matches any: %s" % (rel, i, t))
            if is_md and HEADING.match(line):
                for t, rx in head_re:
                    if rx.search(line):
                        rep.problem(unit, "echo-heading", "%s line %d matches heading: %s" % (rel, i, t))


def check_scope(unit, stratum, files, src, rep):
    plan = files.get("plan.md", "")
    ui_named = bool(UI_NAME.search(plan))
    if stratum in ("ceo", "eng", "dx"):
        if ui_named:
            rep.problem(unit, "ui-scope", "a %s plan names a UI file" % stratum)
        for r in src:
            if r.lower().endswith(tuple("." + e for e in UI_EXT)):
                rep.problem(unit, "ui-scope", "a %s unit holds UI file %s" % (stratum, r))
    if stratum == "design" and not ui_named:
        rep.problem(unit, "ui-scope", "a design plan names no UI file")
    if stratum in ("eng", "dx") and not src:
        rep.problem(unit, "layout", "an %s unit has no src/" % stratum)


def need_str(obj, field, unit, where, rep):
    v = obj.get(field)
    if not isinstance(v, str) or not v.strip():
        rep.problem(unit, "key-field", "%s needs %s" % (where, field))
        return False
    return True


def check_places(unit, where, places, files, heads, rep, allow_heading):
    for p in places:
        if not isinstance(p, str):
            rep.problem(unit, "key-field", "%s has a non-text place" % where)
        elif p in files and p != "key.json":
            continue
        elif allow_heading and p in heads:
            continue
        else:
            rep.problem(unit, "key-place", "%s names a heading or path not in the unit" % where)


def check_evidence(unit, where, ev, files, rep):
    paths = []
    if not isinstance(ev, list) or not ev:
        rep.problem(unit, "key-field", "%s needs evidence" % where)
        return paths
    for e in ev:
        if not isinstance(e, dict) or not isinstance(e.get("path"), str) or not isinstance(e.get("what"), str) or not e["what"].strip():
            rep.problem(unit, "key-field", "%s has an evidence entry without path and what" % where)
            continue
        if e["path"] not in files or e["path"] == "key.json":
            rep.problem(unit, "key-place", "%s evidence path not in the unit" % where)
        paths.append(e["path"])
    return paths


def check_item(unit, stratum, mode, item, files, heads, rep):
    where = "item %s" % item.get("id", "?")
    kind = item.get("item_kind")
    role = item.get("role")
    if role == "anchor":
        if kind not in ANCHORS:
            rep.problem(unit, "key-kind", "%s anchor kind must be one of %s" % (where, ",".join(ANCHORS)))
        want_levers = ()
    elif role == "candidate":
        if kind not in KINDS:
            rep.problem(unit, "key-kind", "%s has an unknown item_kind" % where)
            return kind
        if KINDS[kind][0] != stratum:
            rep.problem(unit, "key-kind", "%s kind %s belongs to stratum %s" % (where, kind, KINDS[kind][0]))
        want_levers = KINDS[kind][1]
        if kind in NEEDS_EXISTING and mode == "greenfield":
            rep.problem(unit, "key-mode", "%s kind %s needs an existing product, not greenfield" % (where, kind))
    else:
        rep.problem(unit, "key-field", "%s role must be candidate or anchor" % where)
        return kind
    levers = item.get("levers")
    if not isinstance(levers, list) or sorted(levers) != sorted(want_levers):
        rep.problem(unit, "key-levers", "%s levers must be [%s]" % (where, ", ".join(want_levers)))
    for f in ("cause", "fix"):
        need_str(item, f, unit, where, rep)
    if item.get("deserved_severity") not in SEVERITIES:
        rep.problem(unit, "key-field", "%s deserved_severity must be Critical or High" % where)
    if item.get("plan_section") not in heads:
        rep.problem(unit, "key-place", "%s plan_section is not a ## heading in plan.md" % where)
    if "other_places" in item:
        check_places(unit, where, item["other_places"] if isinstance(item["other_places"], list) else [None], files, heads, rep, True)
    paths = check_evidence(unit, where, item.get("evidence"), files, rep)
    distinct = set(paths)
    for lv in want_levers:
        need_str(item, LEVER_FIELD[lv], unit, where, rep)
    if ("H2" in want_levers or "QT" in want_levers) and len(distinct) < 3:
        rep.problem(unit, "key-evidence", "%s needs evidence from 3 or more distinct files, has %d" % (where, len(distinct)))
    if "CD" in want_levers and not any(p.startswith("src/") for p in distinct):
        rep.problem(unit, "key-evidence", "%s needs evidence under src/" % where)
    if "OM" in want_levers and not any(p.startswith(("context/", "src/")) for p in distinct):
        rep.problem(unit, "key-evidence", "%s needs evidence under context/ or src/" % where)
    if kind in NEEDS_DECISION:
        need_str(item, "decision", unit, where, rep)
        need_str(item, "should_become", unit, where, rep)
    if role == "anchor" and not any(p.startswith(("context/", "src/")) for p in distinct) and kind != "A-X":
        rep.problem(unit, "key-evidence", "%s needs evidence under context/ or src/" % where)
    return kind


def check_minors(unit, key, heads, rep):
    minors = key.get("minors")
    if not isinstance(minors, list) or not MINORS[0] <= len(minors) <= MINORS[1]:
        rep.problem(unit, "key-minors", "want %d to %d minors" % MINORS)
        return
    for i, m in enumerate(minors, 1):
        if not isinstance(m, dict):
            rep.problem(unit, "key-minors", "minor %d is not an object" % i)
            continue
        if m.get("plan_section") not in heads:
            rep.problem(unit, "key-minors", "minor %d plan_section is not a ## heading" % i)
        if not isinstance(m.get("issue"), str) or not m["issue"].strip():
            rep.problem(unit, "key-minors", "minor %d needs issue" % i)
        if m.get("deserved_severity") not in MINOR_SEVERITIES:
            rep.problem(unit, "key-minors", "minor %d deserved_severity must be Medium or Low" % i)


def check_key(unit, files, heads, wave, kept, floor, rep):
    try:
        answer = json.loads(files.get("key.json", ""))
    except ValueError:
        rep.problem(unit, "key-json", "key.json does not parse")
        return None
    if not isinstance(answer, dict):
        rep.problem(unit, "key-json", "key.json is not an object")
        return None
    if answer.get("unit") != unit:
        rep.problem(unit, "key-field", "unit field differs from the folder name")
    if answer.get("wave") != wave:
        rep.problem(unit, "key-field", "wave field is not %s" % wave)
    stratum, mode, kind = answer.get("stratum"), answer.get("mode"), answer.get("kind")
    if stratum not in STRATA:
        rep.problem(unit, "key-field", "stratum must be one of %s" % ",".join(STRATA))
    if mode not in MODES:
        rep.problem(unit, "key-field", "mode must be one of %s" % ",".join(MODES))
    allowed = {"calibration": ("calibration",), "admission": ("panel",), "confirmatory": ("panel", "decoy")}[wave]
    if kind not in allowed:
        rep.problem(unit, "key-field", "kind must be %s in the %s wave" % (" or ".join(allowed), wave))
        return answer
    check_minors(unit, answer, heads, rep)
    if kind == "decoy":
        bait = answer.get("bait")
        if "items" in answer and answer["items"]:
            rep.problem(unit, "key-decoy", "a decoy keys no items")
        if not isinstance(bait, dict):
            rep.problem(unit, "key-decoy", "a decoy needs bait")
            return answer
        if bait.get("resembles") not in KINDS or KINDS[bait["resembles"]][0] != stratum:
            rep.problem(unit, "key-decoy", "bait resembles must be a kind of this stratum")
        elif kept is not None and bait["resembles"] not in kept:
            rep.problem(unit, "key-decoy", "bait resembles a kind E0 did not keep")
        if not isinstance(bait.get("omission"), bool):
            rep.problem(unit, "key-decoy", "bait needs omission true or false")
        for f in ("choice", "why_not_a_flaw"):
            need_str(bait, f, unit, "bait", rep)
        if bait.get("plan_section") not in heads:
            rep.problem(unit, "key-place", "bait plan_section is not a ## heading in plan.md")
        jpaths = check_evidence(unit, "bait justification", bait.get("justification"), files, rep)
        if not any(p.startswith(("context/", "src/")) for p in jpaths):
            rep.problem(unit, "key-evidence", "bait justification needs a context/ or src/ path")
        return answer
    items = answer.get("items")
    if not isinstance(items, list):
        rep.problem(unit, "key-field", "items must be a list")
        return answer
    ids = [it.get("id") if isinstance(it, dict) else None for it in items]
    if ids != ["%s-%d" % (unit, i) for i in range(1, len(items) + 1)]:
        rep.problem(unit, "key-field", "item ids must run %s-1, %s-2 and on, in order" % (unit, unit))
    kinds = [check_item(unit, stratum, mode, it, files, heads, rep) if isinstance(it, dict) else None for it in items]
    sections = [it.get("plan_section") for it in items if isinstance(it, dict)]
    if len(set(sections)) != len(sections):
        rep.problem(unit, "key-sections", "two keyed items share a plan_section")
    roles = [it.get("role") for it in items if isinstance(it, dict)]
    if kind == "calibration":
        want = sorted(k for k, v in KINDS.items() if v[0] == stratum)
        cands = sorted(k for k, r in zip(kinds, roles) if r == "candidate")
        if len(items) != 4 or roles.count("anchor") != 1 or cands != want:
            rep.problem(unit, "key-recipe", "a calibration unit keys one item of each of its stratum's three kinds and one anchor")
        anchor_kind = [k for k, r in zip(kinds, roles) if r == "anchor"]
        if anchor_kind and answer.get("anchor_shape") not in (None, anchor_kind[0]):
            rep.problem(unit, "key-recipe", "anchor_shape differs from the anchor's item_kind")
    else:
        if len(items) != 3 or roles.count("candidate") != 3:
            rep.problem(unit, "key-recipe", "a panel unit keys three candidate items")
        if kept is not None:
            if any(k not in kept for k in kinds):
                rep.problem(unit, "key-recipe", "an item's kind is not on the kept list")
            if len(kept) >= 2 and len(set(kinds)) < 2:
                rep.problem(unit, "key-recipe", "items must span at least two kept kinds")
            if sum(1 for k in kinds if k in floor) > 1:
                rep.problem(unit, "key-recipe", "at most one item of a floor kind")
    return answer


def check_unit(unit_dir, wave, kept, floor, anywhere, headings, rep):
    unit = os.path.basename(os.path.normpath(unit_dir))
    if not UNIT_ID.match(unit):
        rep.problem(unit, "layout", "unit id must be 8 lowercase hex characters")
    files = check_tree(unit, unit_dir, rep)
    heads, src = check_sizes(unit, files, rep)
    check_echo(unit, files, anywhere, headings, rep)
    key = check_key(unit, files, heads, wave, kept, floor, rep)
    if isinstance(key, dict) and key.get("stratum") in STRATA:
        check_scope(unit, key["stratum"], files, src, rep)


def recipe_problem(kept, floor):
    if kept is None:
        return None
    unknown = [k for k in kept + floor if k not in KINDS]
    if unknown:
        return "unknown kind %s" % unknown[0]
    if any(k not in kept for k in floor):
        return "a floor kind must also be on the kept list"
    strata = {KINDS[k][0] for k in kept}
    if len(strata) != 1:
        return "--kept must name kinds of one stratum"
    if not kept:
        return "no kept kind: the stratum is not built"
    if all(k in floor for k in kept):
        return "every kept kind is KEEP-FLOOR, so no unit can carry three items with at most one floor item"
    return None


def run(panel, wave, kept, floor, echo_path, out=print):
    anywhere, headings = load_echo_terms(echo_path)
    rep = Report()
    why = recipe_problem(kept, floor)
    if why:
        rep.problem("-", "recipe-unmeetable", why)
    units = sorted(d for d in os.listdir(panel) if os.path.isdir(os.path.join(panel, d)))
    if not units:
        rep.problem("-", "layout", "no unit folders under the panel folder")
    for u in units:
        before = rep.count
        check_unit(os.path.join(panel, u), wave, kept, floor, anywhere, headings, rep)
        rep.lines.append("unit %s problems %d" % (u, rep.count - before))
    for line in rep.lines:
        out(line)
    out("units %d" % len(units))
    out("problems %d" % rep.count)
    return rep


FILLER = ("The team met on Tuesday and agreed the numbers below are the current baseline. "
          "Owners are listed beside each row, and the table is refreshed every Monday morning. ")


def _synthetic_unit(root, unit, stratum="eng"):
    d = os.path.join(root, unit)
    os.makedirs(os.path.join(d, "context"))
    os.makedirs(os.path.join(d, "src"))
    for i in range(8):
        with open(os.path.join(d, "context", "doc%d.md" % i), "w") as f:
            f.write("# Working note %d\n\n" % i + FILLER * 15)
    for i in range(4):
        with open(os.path.join(d, "src", "mod%d.py" % i), "w") as f:
            f.write("def handler_%d(event):\n    return event\n" % i + "# filler line\n" * 60)
    names = ["Goals", "Background", "Approach", "Data changes", "Rollout", "Staffing", "Timeline"]
    with open(os.path.join(d, "plan.md"), "w") as f:
        f.write("# Plan\n\n" + "".join("## %s\n\n%s\n\n" % (n, FILLER * 8) for n in names))
    ev3 = [{"path": "context/doc1.md", "what": "a number"}, {"path": "context/doc2.md", "what": "a number"},
           {"path": "src/mod1.py", "what": "the behavior"}]

    def item(n, kind, section, levers, extra):
        it = {"id": "%s-%d" % (unit, n), "item_kind": kind, "role": "candidate" if kind in KINDS else "anchor",
              "levers": list(levers), "plan_section": section, "cause": "c", "evidence": ev3,
              "deserved_severity": "High", "fix": "f"}
        it.update(extra)
        return it
    key = {"unit": unit, "wave": "calibration", "stratum": stratum, "kind": "calibration", "mode": "added",
           "anchor_shape": "A-F",
           "items": [item(1, "E-CD", "Approach", ("CD", "H2"), {"code_fact": "x", "intermediate": "y"}),
                     item(2, "E-OM", "Data changes", ("OM", "QT"), {"absent_step": "x", "computation": "y"}),
                     item(3, "E-Q", "Rollout", ("QT", "H2"), {"computation": "x", "intermediate": "y"}),
                     item(4, "A-F", "Goals", (), {})],
           "minors": [{"plan_section": "Staffing", "issue": "i", "deserved_severity": "Medium"},
                      {"plan_section": "Timeline", "issue": "i", "deserved_severity": "Low"}]}
    with open(os.path.join(d, "key.json"), "w") as f:
        json.dump(key, f)
    return d


def self_test():
    echo = os.path.join(HERE, "echo-terms.txt")
    cases = []

    def case(name, mutate, code):
        cases.append((name, mutate, code))

    def edit(path, fn):
        with open(path) as f:
            t = f.read()
        with open(path, "w") as f:
            f.write(fn(t))

    def edit_key(d, fn):
        p = os.path.join(d, "key.json")
        with open(p) as f:
            k = json.load(f)
        fn(k)
        with open(p, "w") as f:
            json.dump(k, f)

    case("clean unit passes", lambda d: None, None)
    case("echo term in a context file", lambda d: edit(os.path.join(d, "context/doc3.md"), lambda t: t + "\nSee the failure modes registry.\n"), "echo")
    case("heading echo in plan", lambda d: edit(os.path.join(d, "plan.md"), lambda t: t.replace("## Staffing", "## Test plan")), "echo-heading")
    case("clean-room folder", lambda d: os.makedirs(os.path.join(d, "src", ".claude", "skills")), "clean-room")
    case("AGENTS.md in the tree", lambda d: open(os.path.join(d, "context", "AGENTS.md"), "w").write("x"), "clean-room")
    case("plan too small", lambda d: edit(os.path.join(d, "plan.md"), lambda t: t[:3000]), "plan-size")
    case("missing lever field", lambda d: edit_key(d, lambda k: k["items"][0].pop("code_fact")), "key-field")
    case("wrong levers", lambda d: edit_key(d, lambda k: k["items"][1].update(levers=["OM"])), "key-levers")
    case("UI file named in an eng plan", lambda d: edit(os.path.join(d, "plan.md"), lambda t: t + "\nWe touch web/Checkout.tsx.\n"), "ui-scope")
    case("two items share a section", lambda d: edit_key(d, lambda k: k["items"][3].update(plan_section="Rollout")), "key-sections")
    case("greenfield with an existing-product kind", lambda d: edit_key(d, lambda k: k.update(mode="greenfield")), "key-mode")
    case("QT item with two files", lambda d: edit_key(d, lambda k: k["items"][2].update(evidence=k["items"][2]["evidence"][:2])), "key-evidence")
    case("calibration unit missing a kind", lambda d: edit_key(d, lambda k: k["items"].pop(2)), "key-recipe")
    case("symlink", lambda d: os.symlink("/etc/hostname", os.path.join(d, "context", "link.md")), "clean-room")
    case("gstack in a path", lambda d: open(os.path.join(d, "src", "gstack_helper.py"), "w").write("x = 1\n"), "clean-room")
    failed = 0
    for name, mutate, code in cases:
        root = tempfile.mkdtemp(prefix="check-units-")
        try:
            d = _synthetic_unit(root, "0a1b2c3d")
            if mutate:
                mutate(d)
            lines = []
            rep = run(root, "calibration", None, [], echo, out=lines.append)
            codes = {l.split()[2].rstrip(":") for l in lines if l.startswith("PROBLEM")}
            ok = (rep.count == 0) if code is None else (code in codes)
            if not ok:
                failed += 1
                print("self-test FAIL %s: got %s" % (name, sorted(codes) or "no problems"))
        finally:
            shutil.rmtree(root)
    usage = [(["x", "--wave", "admission"], 2), (["x", "--wave", "confirmatory", "--kept", "E-CD"], 2),
             (["x", "--wave", "calibration", "--floor", "none"], 2)]
    root = tempfile.mkdtemp(prefix="check-units-")
    try:
        for argv, want in usage:
            argv = [root] + argv[1:]
            if main(argv) != want:
                failed += 1
                print("self-test FAIL usage %s" % " ".join(argv[1:]))
    finally:
        shutil.rmtree(root)
    for kept, floor, bad in ((["E-CD", "E-OM"], ["E-CD", "E-OM"], True), (["E-CD"], ["E-CD"], True),
                             (["E-CD", "E-OM"], ["E-OM"], False), (["E-CD"], [], False)):
        if (recipe_problem(kept, floor) is not None) != bad:
            failed += 1
            print("self-test FAIL recipe %s floor %s" % (kept, floor))
    print("self-test %s, %d cases" % ("ok" if failed == 0 else "failed", len(cases) + len(usage) + 4))
    return 0 if failed == 0 else 1


def main(argv):
    if argv[:1] == ["--self-test"]:
        return self_test()
    args, wave, kept, floor = [], None, None, None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--wave", "--kept", "--floor") and i + 1 < len(argv):
            v = argv[i + 1]
            if a == "--wave":
                wave = v
            elif a == "--kept":
                kept = [k for k in v.split(",") if k]
            else:
                floor = [] if v == "none" else [k for k in v.split(",") if k]
            i += 2
            continue
        args.append(a)
        i += 1
    if len(args) != 1 or wave not in WAVES or not os.path.isdir(args[0]):
        print("E_USAGE: python3 check_units.py <panel_dir> --wave calibration|admission|confirmatory [--kept K,K --floor K|none]")
        return 2
    if wave == "calibration" and (kept is not None or floor is not None):
        print("E_USAGE: --kept and --floor apply to admission and confirmatory waves")
        return 2
    if wave != "calibration" and (not kept or floor is None):
        print("E_USAGE: the %s wave needs --kept with E0's kept kinds and --floor with its KEEP-FLOOR kinds or none" % wave)
        return 2
    rep = run(args[0], wave, kept, floor or [], os.path.join(HERE, "echo-terms.txt"))
    return 0 if rep.count == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
