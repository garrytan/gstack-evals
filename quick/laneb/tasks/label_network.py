#!/usr/bin/env python3
"""Label each Terminal-Bench 2.0 task by the network access its reference solution needs.

Reads solution/solve.sh (and instruction.md for a few manual cases) at the registry-pinned commit.
  open     : the solution fetches from hosts other than OS or language package registries
             (git clone, curl/wget of arbitrary URLs, Hugging Face hub, RCSB, YouTube, ...)
  registry : the solution only installs packages (apt, apk, pip/uv from PyPI or download.pytorch.org)
  none     : the solution needs no network
Writes internet_labels.json. The rule excludes "open" tasks.
"""
import json, os, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
TB2 = Path(os.environ.get("TB2_DIR", Path.home() / ".capy/work/ref/terminal-bench-2"))

OPEN = [r"git clone\s+(--\S+\s+)*(https?://|git@github)", r"\bwget\s+\S*https?://", r"\bcurl\s[^|\n]*https?://(?!astral\.sh|localhost|127\.0\.0\.1)", r"huggingface\.co|huggingface_hub", r"from_pretrained",
        r"get_model\(", r"load_dataset\(", r"rcsb", r"youtube", r"hf_hub_download", r"snapshot_download"]
REGISTRY = [r"apt(-get)?\s+install", r"apk add", r"pip3?\s+install", r"uv\s+(pip install|add)", r"npm\s+install", r"cargo\s+install"]
# Manual labels where the solution script alone does not show the need, with reasons.
MANUAL = {
    "extract-moves-from-video": ("open", "instruction asks to download a YouTube video"),
    "mteb-retrieve": ("open", "solution loads BAAI/bge-small-zh-v1.5 from the Hugging Face hub via mteb.get_model"),
}


def classify(name):
    if name in MANUAL:
        return MANUAL[name]
    s = (TB2 / name / "solution/solve.sh")
    text = s.read_text(errors="replace") if s.exists() else ""
    lines = [l for l in text.splitlines() if not l.strip().startswith("#")]
    body = "\n".join(lines)
    hits = [p for p in OPEN if re.search(p, body, re.I)]
    if hits:
        return "open", "solve.sh matches " + ", ".join(hits)
    hits = [p for p in REGISTRY if re.search(p, body, re.I)]
    if hits:
        return "registry", "solve.sh matches " + ", ".join(hits)
    return "none", "solve.sh fetches nothing"


def main():
    pin = json.loads((HERE / "raw/hub/terminal-bench@2.0.json").read_text())
    labels = {t["name"]: dict(zip(("class", "reason"), classify(t["path"]))) for t in pin["tasks"]}
    out = {
        "source": f"{pin['tasks'][0]['git_url']}@{pin['tasks'][0]['git_commit_id']}",
        "labels": dict(sorted(labels.items())),
        "agent_phase_needs_internet": sorted(k for k, v in labels.items() if v["class"] == "open"),
    }
    (HERE / "internet_labels.json").write_text(json.dumps(out, indent=1))
    from collections import Counter
    print(Counter(v["class"] for v in labels.values()))


if __name__ == "__main__":
    main()
