#!/usr/bin/env python3
"""Fetch the Harbor Hub registry pins that harbor @ f3a5a92 resolves for terminal-bench@2.0 and swebench-verified@1.0.

harbor's default registry client calls the Hub's public get_dataset RPC. This script reads the Hub URL and the public
publishable key from the harbor clone's own source (never printed or stored) and writes raw/hub/<name>@<version>.json.
"""
import json, os, re, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARBOR = Path(os.environ.get("HARBOR_DIR", Path.home() / ".capy/work/ref/harbor"))


def main():
    cfg = (HARBOR / "src/harbor/registry/client/harbor/config.py").read_text()
    url = re.search(r'"HARBOR_SUPABASE_URL",\s*"([^"]+)"', cfg).group(1)
    key = re.search(r'"HARBOR_SUPABASE_PUBLISHABLE_KEY",\s*"([^"]+)"', cfg).group(1)
    out = HERE / "raw/hub"
    out.mkdir(parents=True, exist_ok=True)
    for name, ver in [("terminal-bench", "2.0"), ("swebench-verified", "1.0")]:
        req = urllib.request.Request(f"{url}/rest/v1/rpc/get_dataset", data=json.dumps({"p_name": name, "p_version": ver}).encode(),
                                     headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        d = json.load(urllib.request.urlopen(req, timeout=60))
        (out / f"{name}@{ver}.json").write_text(json.dumps(d, indent=1))
        pins = sorted({(t["git_url"], t["git_commit_id"]) for t in d["tasks"]})
        print(name, ver, len(d["tasks"]), "tasks", pins)


if __name__ == "__main__":
    main()
