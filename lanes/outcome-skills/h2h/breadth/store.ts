// Copyright (c) 2026 Garry Tan. MIT License.
// The B image store (plan section 6): every built image is pushed by digest before its oracle run, sessions and scoring
// run only from that digest, and an image is never rebuilt. Two stores share one small interface: a registry the eval
// controls (refs are <registry>/<repo>@sha256:<manifest digest>), and a directory of docker save archives named by image
// id with each archive's sha256 recorded beside it, for carrying images between hosts. assertStored is the refusal every
// session, oracle and scoring run calls first.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { h2hFail } from "../prereg.ts";
import { dockerOn, type BuilderHost } from "./build.ts";

export interface StoredImage { ref: string; digest: string }
export interface ImageStore {
  kind: "registry" | "archive";
  location: string;
  /** Stores a local image and returns its digest ref. */
  push(localRef: string): StoredImage;
  /** Whether the store holds the image this digest ref names. */
  has(ref: string): boolean;
  /** Makes the stored image present on the host and returns the local reference docker run takes. */
  pull(ref: string): string;
}

export const DIGEST_REF = /^(.+)@(sha256:[0-9a-f]{64})$/;

/** A registry store at url (host[:port]/repository). */
export function registryStore(url: string, host: BuilderHost = {}): ImageStore {
  const name = url.replace(/\/+$/, "");
  return {
    kind: "registry", location: name,
    push(localRef) {
      const tag = name + ":h2h-" + createHash("sha256").update(localRef + Date.now()).digest("hex").slice(0, 12);
      const t = dockerOn(host, ["tag", localRef, tag], { timeoutMs: 60_000 });
      if (t.status !== 0) h2hFail("E_H2H_B_STORE", "tagging " + localRef + " failed: " + t.stderr.slice(-200));
      const p = dockerOn(host, ["push", tag], { timeoutMs: 3_600_000 });
      const digest = (p.stdout.match(/digest: (sha256:[0-9a-f]{64})/) ?? [])[1];
      dockerOn(host, ["rmi", tag], { timeoutMs: 60_000 });
      if (p.status !== 0 || !digest) h2hFail("E_H2H_B_STORE", "pushing " + localRef + " to " + name + " failed: " + (p.stderr || p.stdout).slice(-300));
      return { ref: name + "@" + digest, digest: digest! };
    },
    has(ref) {
      const m = ref.match(DIGEST_REF);
      if (!m || m[1] !== name) return false;
      return dockerOn(host, ["manifest", "inspect", "--insecure", ref], { timeoutMs: 120_000 }).status === 0;
    },
    pull(ref) {
      if (!this.has(ref)) h2hFail("E_H2H_B_STORE", ref + " is not in the registry store " + name);
      const have = dockerOn(host, ["image", "inspect", "--format", "{{.Id}}", ref], { timeoutMs: 30_000 });
      if (have.status === 0) return ref;
      const p = dockerOn(host, ["pull", "-q", ref], { timeoutMs: 3_600_000 });
      if (p.status !== 0) h2hFail("E_H2H_B_STORE", "pulling " + ref + " failed: " + p.stderr.slice(-300));
      return ref;
    },
  };
}

const fileSha = (path: string): Promise<string> => new Promise((resolve, reject) => {
  const h = createHash("sha256");
  createReadStream(path).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
});
const fileShaSync = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** An archive store in dir: <image id hex>.tar (docker save) and <image id hex>.json ({ image_id, tar_sha256 }). Refs are
 *  archive:<dir>@<image id>. */
export function archiveStore(dir: string, host: BuilderHost = {}): ImageStore {
  const prefix = "archive:" + dir;
  const paths = (digest: string) => ({ tar: join(dir, digest.slice(7) + ".tar"), meta: join(dir, digest.slice(7) + ".json") });
  return {
    kind: "archive", location: dir,
    push(localRef) {
      mkdirSync(dir, { recursive: true });
      const id = dockerOn(host, ["image", "inspect", "--format", "{{.Id}}", localRef], { timeoutMs: 60_000 }).stdout.trim();
      if (!/^sha256:[0-9a-f]{64}$/.test(id)) h2hFail("E_H2H_B_STORE", localRef + " is not a local image");
      const p = paths(id);
      const s = dockerOn(host, ["save", "-o", p.tar, id], { timeoutMs: 3_600_000 });
      if (s.status !== 0) h2hFail("E_H2H_B_STORE", "docker save " + localRef + " failed: " + s.stderr.slice(-200));
      writeFileSync(p.meta, JSON.stringify({ image_id: id, tar_sha256: fileShaSync(p.tar) }) + "\n");
      return { ref: prefix + "@" + id, digest: id };
    },
    has(ref) {
      const m = ref.match(DIGEST_REF);
      if (!m || m[1] !== prefix) return false;
      const p = paths(m[2]!);
      if (!existsSync(p.tar) || !existsSync(p.meta)) return false;
      const meta = JSON.parse(readFileSync(p.meta, "utf8"));
      return meta.image_id === m[2] && meta.tar_sha256 === fileShaSync(p.tar);
    },
    pull(ref) {
      if (!this.has(ref)) h2hFail("E_H2H_B_STORE", ref + " is not in the archive store " + dir + ", or its archive no longer matches its recorded sha256");
      const id = ref.match(DIGEST_REF)![2]!;
      if (dockerOn(host, ["image", "inspect", id], { timeoutMs: 30_000 }).status !== 0) {
        const l = dockerOn(host, ["load", "-i", paths(id).tar], { timeoutMs: 3_600_000 });
        if (l.status !== 0) h2hFail("E_H2H_B_STORE", "docker load of " + ref + " failed: " + l.stderr.slice(-200));
      }
      const got = dockerOn(host, ["image", "inspect", "--format", "{{.Id}}", id], { timeoutMs: 30_000 }).stdout.trim();
      if (got !== id) h2hFail("E_H2H_B_STORE", ref + " loaded as " + (got || "nothing") + ", not its recorded image id");
      return id;
    },
  };
}
export { fileSha };

/** The refusal sessions, the oracle and scoring call before any run: the ref is a digest ref, it is the digest the unit
 *  list records when one is given, and the store holds it. */
export function assertStored(store: ImageStore, ref: string, recorded?: string): void {
  if (!DIGEST_REF.test(ref)) h2hFail("E_H2H_B_STORE", JSON.stringify(ref) + " is not a digest ref; sessions and scoring run only from a stored digest");
  if (recorded !== undefined && recorded !== ref) h2hFail("E_H2H_B_STORE", ref + " is not the digest the unit list records (" + recorded + ")");
  if (!store.has(ref)) h2hFail("E_H2H_B_STORE", ref + " is not in the image store " + store.location);
}

/** The store a --store argument names: a directory path (archive) or a registry URL. */
export const storeFrom = (spec: string, host: BuilderHost = {}): ImageStore => (spec.startsWith("/") || spec.startsWith(".") ? archiveStore(spec, host) : registryStore(spec, host));
