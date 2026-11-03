#!/usr/bin/env python3
"""R3 amendment 4's SWE-rebench pool (plan section 4 items 1 and 2): 354 task ids with their digests and pinned images.

Reads the pinned Harbor's export of the Hub package swe-rebench/swe-rebench-leaderboard at its version hash (harbor
datasets download swe-rebench/swe-rebench-leaderboard -o <dir>) and the Hugging Face rows of nebius/SWE-rebench-leaderboard
at revision 34d5a58 ([instance_id, created YYYY-MM, repo, docker_image] per task). Keeps the tasks created 2025-10 or later
whose task.toml asks memory '8G'. For each task it records the Hub content hash, our own digest (sha256 over sorted
"<relpath>\0<sha256 of file>\n" lines for every file, digest_tasks.py's method and materialize.ts treeDigest), and the
base image with its linux/amd64 manifest digest from Docker Hub's registry API (keyless HEAD; an index is read for its
linux/amd64 entry).
  --write   build swerebench-r3a4.json; needs the pinned Harbor's Python (for the Hub metadata) and the network
  --check   recompute every digest from the export and exit 1 on any difference from swerebench-r3a4.json (the default)
"""
import argparse, hashlib, json, re, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "swerebench-r3a4.json"
DATASET = "swe-rebench/swe-rebench-leaderboard"
VERSION = "sha256:ebe7444e313a0d8db94fa541139826eaebe2b0abcd4900c6f73e750494910dca"
HF = {"repo": "nebius/SWE-rebench-leaderboard", "revision": "34d5a58864acf91613740a09ec5d205228dcfa39"}
HARBOR = "f3a5a923f6d722472c9e797af836ae4425fb215f"
WINDOW_FROM = "2025-10"
MEMORY = "8G"
ACCEPT = ", ".join([
    "application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json", "application/vnd.oci.image.manifest.v1+json",
])
INDEXES = ("application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json")


def tree_digest(d):
    files = sorted((p for p in d.rglob("*") if p.is_file()), key=lambda p: p.relative_to(d).as_posix().encode())
    outer = hashlib.sha256()
    for p in files:
        outer.update(f"{p.relative_to(d).as_posix()}\0{hashlib.sha256(p.read_bytes()).hexdigest()}\n".encode())
    return outer.hexdigest(), len(files)


def toml_value(text, section, key):
    body = re.search(rf"^\[{section}\]\s*$([\s\S]*?)(?=^\[|\Z)", text, re.M)
    m = re.search(rf"^\s*{key}\s*=\s*(.+?)\s*$", body.group(1) if body else "", re.M)
    return m.group(1).strip("'\"") if m else None


def base_image(task_dir):
    froms = [l.split()[1] for l in (task_dir / "environment/Dockerfile").read_text().splitlines() if l.split()[:1] and l.split()[0].upper() == "FROM"]
    if len(froms) != 1:
        raise SystemExit(f"{task_dir.name}: environment/Dockerfile has {len(froms)} FROM lines, not 1")
    return froms[0]


def manifest_digest(image):
    name, _, tag = image.partition(":")
    req = urllib.request.Request(f"https://auth.docker.io/token?service=registry.docker.io&scope=repository:{name}:pull")
    token = json.load(urllib.request.urlopen(req, timeout=60))["token"]
    url = f"https://registry-1.docker.io/v2/{name}/manifests/{tag or 'latest'}"
    head = urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers={"Authorization": f"Bearer {token}", "Accept": ACCEPT}), timeout=60)
    kind = head.headers["Content-Type"]
    if kind not in INDEXES:
        return head.headers["Docker-Content-Digest"], kind
    index = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept": ACCEPT}), timeout=60))
    amd = [m for m in index["manifests"] if m.get("platform", {}).get("os") == "linux" and m.get("platform", {}).get("architecture") == "amd64"]
    if len(amd) != 1:
        raise SystemExit(f"{image}: its index has {len(amd)} linux/amd64 manifests, not 1")
    return amd[0]["digest"], amd[0]["mediaType"]


def hub_refs():
    import asyncio, inspect
    from harbor.registry.client.package import PackageDatasetClient
    meta = PackageDatasetClient()._get_dataset_metadata(DATASET)
    if inspect.iscoroutine(meta):
        meta = asyncio.run(meta)
    if meta.version != VERSION:
        raise SystemExit(f"{DATASET} is at {meta.version} on the Hub, not the pinned {VERSION}")
    return {t.name: t.ref for t in meta.task_ids}


def pool(export, rows):
    picked, excluded = [], []
    for task_id, created, repo, image in sorted(rows):
        if created < WINDOW_FROM:
            continue
        d = export / task_id
        if not d.is_dir():
            raise SystemExit(f"{task_id}: not in the export {export}")
        memory = toml_value((d / "task.toml").read_text(), "environment", "memory")
        (picked if memory == MEMORY else excluded).append((task_id, created, repo, image, memory))
    return picked, excluded


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--export", default=str(Path.home() / ".capy/work/ref/swe-rebench-leaderboard"))
    ap.add_argument("--rows", default=str(Path.home() / ".capy/work/ref/swe-rebench-rows.json"))
    a = ap.parse_args()
    export = Path(a.export)
    if not a.write:
        doc = json.loads(OUT.read_text())
        bad = []
        for t in doc["tasks"]:
            got, n = tree_digest(export / t["task_id"])
            if f"sha256:{got}" != t["digest"] or n != t["digest_files"]:
                bad.append(t["task_id"])
        if bad:
            raise SystemExit(f"digests differ from swerebench-r3a4.json: {bad}")
        print(f"ok: {len(doc['tasks'])} tasks match swerebench-r3a4.json")
        return
    rows = json.loads(Path(a.rows).read_text())
    refs = hub_refs()
    exported = sorted(p.name for p in export.iterdir() if p.is_dir())
    if exported != sorted(refs) or sorted(r[0] for r in rows) != exported:
        raise SystemExit("the export, the Hub package and the Hugging Face rows do not list the same task ids")
    picked, excluded = pool(export, rows)
    tasks = []
    for task_id, created, repo, image, _ in picked:
        d = export / task_id
        got, n = tree_digest(d)
        if f"sha256:{got}" != refs[task_id]:
            raise SystemExit(f"{task_id}: export digest sha256:{got} is not the Hub content hash {refs[task_id]}")
        src = base_image(d)
        if src != image:
            raise SystemExit(f"{task_id}: environment/Dockerfile FROM {src} is not the Hugging Face row's {image}")
        digest, kind = manifest_digest(src)
        tasks.append({"task_id": task_id, "created": created, "repo": repo, "hub_ref": refs[task_id], "digest": f"sha256:{got}", "digest_files": n,
                      "image": src, "image_digest": digest, "image_media_type": kind})
        print(f"{task_id:50s} {created} {digest}", file=sys.stderr)
    doc = {
        "note": "R3 amendment 4's pool (plan section 4 item 1): the SWE-rebench leaderboard tasks created 2025-10 or later that ask 8G of memory, with digests and base images pinned by digest. Ids, counts and digests only. Built by swerebench_r3a4.py.",
        "dataset": {"name": DATASET, "version": VERSION, "harbor_commit": HARBOR, "hugging_face": HF, "licence": "CC-BY-4.0"},
        "filter": {"created_from": WINDOW_FROM, "memory": MEMORY},
        "counts": {"package": len(exported), "window": len(picked) + len(excluded), "excluded_memory": len(excluded), "pool": len(tasks)},
        "excluded": [{"task_id": t, "memory": m} for t, _, _, _, m in excluded],
        "digest_algorithm": "sha256 over sorted lines '<relpath>\\0<sha256(file)>\\n' for every file under the task directory (digest_tasks.py; Harbor's Packager.compute_content_hash; materialize.ts treeDigest)",
        "image_digest": "Docker Hub registry manifest digest for linux/amd64, read keylessly with HEAD (an index's linux/amd64 entry otherwise)",
        "tasks": tasks,
    }
    OUT.write_text(json.dumps(doc, indent=1) + "\n")
    print(f"wrote {OUT}: {len(tasks)} tasks, {len(excluded)} excluded on memory; sha256 {hashlib.sha256(OUT.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
