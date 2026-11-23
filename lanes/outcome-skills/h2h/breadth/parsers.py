# Copyright (c) 2026 Garry Tan. MIT License.
# The breadth report parsers (plan section 6): JUnit XML (generic, Playwright's with its project, Karma's and Web Test
# Runner's with the browser string), TRX for .NET, go test -json, cargo test, and Jest and Vitest JSON. Each B unit's
# parser.py is this file with its FORMAT line, so the state machines oracle and scorer run it in their parser sandbox
# unchanged: parser(log) returns {test id: "pass" | "fail" | "skip"}. The log is the print command's output, one
# "===H2H_REPORT <path>===" line before each report file; go test -json and cargo test reports are the test command's own
# output saved to a file. Paths under the repository root /testbed/ are written relative to it. A Vitest report runs one
# project and is named vitest-<hex of the project name>.json, so its ids carry the project as "[name]::".
import json
import re
import xml.etree.ElementTree as ET

ROOT = "/testbed/"
MARK = re.compile(r"^===H2H_REPORT (.*)===$", re.M)


def rel(p):
    p = str(p or "")
    return p[len(ROOT):] if p.startswith(ROOT) else p


def chunks(log):
    parts = MARK.split(log)
    if len(parts) == 1:
        return [("", log)]
    return [(parts[i], parts[i + 1]) for i in range(1, len(parts) - 1, 2)]


def put(out, tid, status):
    if out.get(tid) == "fail":
        return
    if out.get(tid) == "pass" and status == "skip":
        return
    out[tid] = status


def junit_status(tc):
    for child in tc:
        tag = child.tag.split("}")[-1]
        if tag in ("failure", "error"):
            return "fail"
        if tag == "skipped":
            return "skip"
    return "pass"


def junit(log, variant):
    out = {}
    for _, text in chunks(log):
        text = text.strip()
        if not text:
            continue
        root = ET.fromstring(text.encode("utf-8"))

        def walk(node, suites, host):
            tag = node.tag.split("}")[-1]
            if tag == "testsuite":
                suites = suites + [node.get("name", "")]
                host = node.get("hostname", host)
            if tag == "testcase":
                parts = []
                if variant == "playwright":
                    parts.append("[" + (host or "") + "]")
                parts.append(" > ".join(rel(s) for s in suites))
                parts.append(rel(node.get("classname", "")))
                parts.append(rel(node.get("file", "")))
                parts.append(node.get("name", ""))
                put(out, "::".join(parts), junit_status(node))
                return
            for child in node:
                walk(child, suites, host)

        walk(root, [], None)
    return out


def trx(log):
    out = {}
    for _, text in chunks(log):
        text = text.strip()
        if not text:
            continue
        root = ET.fromstring(text.encode("utf-8"))
        classes = {}
        for el in root.iter():
            if el.tag.split("}")[-1] == "UnitTest":
                for m in el:
                    if m.tag.split("}")[-1] == "TestMethod":
                        classes[el.get("id")] = m.get("className", "")
        for el in root.iter():
            if el.tag.split("}")[-1] != "UnitTestResult":
                continue
            o = el.get("outcome", "")
            status = "pass" if o == "Passed" else "fail" if o in ("Failed", "Error", "Timeout", "Aborted") else "skip"
            put(out, classes.get(el.get("testId"), "") + "::" + el.get("testName", ""), status)
    return out


def go_json(log):
    out = {}
    for _, text in chunks(log):
        for line in text.splitlines():
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if not isinstance(ev, dict) or not ev.get("Test") or ev.get("Action") not in ("pass", "fail", "skip"):
                continue
            out[str(ev.get("Package", "")) + "::" + str(ev["Test"])] = ev["Action"]
    return out


CARGO_RUN = re.compile(r"^\s*(Running|Doc-tests)\s+(.*?)\s*$")
CARGO_TEST = re.compile(r"^test (.+?) \.\.\. (ok|FAILED|ignored)(?:, .*)?\s*$")


def cargo(log):
    out = {}
    target = ""
    for _, text in chunks(log):
        for line in text.splitlines():
            m = CARGO_RUN.match(line)
            if m:
                t = re.sub(r"\s*\([^()]*\)$", "", m.group(2))
                target = m.group(1) + " " + re.sub(r"-[0-9a-f]{16}\b", "-*", t)
                continue
            m = CARGO_TEST.match(line)
            if m:
                s = {"ok": "pass", "FAILED": "fail", "ignored": "skip"}[m.group(2)]
                put(out, target + "::" + m.group(1), s)
    return out


JEST = {"passed": "pass", "failed": "fail"}


VITEST_PROJECT = re.compile(r"(?:^|/)vitest-([0-9a-f]*)\.json$")


def jest_like(log, variant):
    out = {}
    for name, text in chunks(log):
        text = text.strip()
        if not text:
            continue
        start = text.find("{")
        if start < 0:
            continue
        d = json.loads(text[start:])
        prefix = ""
        m = VITEST_PROJECT.search(name.strip())
        if variant == "vitest" and m:
            prefix = "[" + bytes.fromhex(m.group(1)).decode("utf-8") + "]::"
        for f in d.get("testResults", []):
            path = rel(f.get("name") or f.get("testFilePath", ""))
            for a in f.get("assertionResults", []):
                title = " > ".join([str(x) for x in a.get("ancestorTitles", [])] + [str(a.get("title", ""))])
                put(out, prefix + path + "::" + title, JEST.get(a.get("status"), "skip"))
    return out


def parse(fmt, log):
    if fmt == "junit":
        return junit(log, "")
    if fmt == "junit-playwright":
        return junit(log, "playwright")
    if fmt == "trx":
        return trx(log)
    if fmt == "go-json":
        return go_json(log)
    if fmt == "cargo":
        return cargo(log)
    if fmt == "jest-json":
        return jest_like(log, "jest")
    if fmt == "vitest-json":
        return jest_like(log, "vitest")
    raise ValueError("E_H2H_B_REPORT no parser for format " + repr(fmt))
