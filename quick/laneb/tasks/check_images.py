#!/usr/bin/env python3
"""Check that each pinned task image has a linux/amd64 variant, via Docker Hub's tag API (not a pull).

Writes raw/image_platforms.json: {image: {"amd64": bool|None, "digest": str, "platforms": [...], "last_pushed": str}}.
"""
import json, tomllib, os, urllib.request, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
TB2 = Path(os.environ.get("TB2_DIR", Path.home() / ".capy/work/ref/terminal-bench-2"))


def tag_info(image):
    repo, tag = image.rsplit(":", 1)
    if "/" not in repo:
        repo = "library/" + repo
    url = f"https://hub.docker.com/v2/repositories/{repo}/tags/{tag}"
    for attempt in range(3):
        try:
            d = json.load(urllib.request.urlopen(url, timeout=30))
            plats = sorted({f"{i.get('os')}/{i.get('architecture')}" for i in d.get("images", [])})
            return {"amd64": "linux/amd64" in plats, "digest": d.get("digest"), "platforms": plats,
                    "last_pushed": d.get("tag_last_pushed")}
        except Exception as e:
            err = str(e)
            time.sleep(2)
    return {"amd64": None, "error": err}


def main():
    pin = json.loads((HERE / "raw/hub/terminal-bench@2.0.json").read_text())
    out = {}
    for t in pin["tasks"]:
        image = tomllib.loads((TB2 / t["path"] / "task.toml").read_text())["environment"]["docker_image"]
        out[image] = tag_info(image)
    (HERE / "raw/image_platforms.json").write_text(json.dumps(out, indent=1, sort_keys=True))
    bad = {k: v for k, v in out.items() if not v.get("amd64")}
    print(len(out), "images;", len(bad), "without linux/amd64 or unreadable:", bad)


if __name__ == "__main__":
    main()
