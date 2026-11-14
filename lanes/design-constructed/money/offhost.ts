// Copyright (c) 2026 Garry Tan. MIT License.
// The off-host write-ahead target (R2-4, money open item 8): an append-only file on a second small VM, reached over SSH
// with a key the WAL host pins to one forced command. Each append is one line, written under an exclusive lock and
// fsynced (and its directory fsynced when the file is new) before the WAL host answers "ACK <sha256 of the line>"; the
// append resolves only on that answer with the right digest. Snapshots are written to a temporary file, fsynced,
// renamed and the directory fsynced. The controller host's key can append and read, never delete or rewrite a line.
// A call that fails, answers wrong or passes its time limit throws, so WriteAhead marks the log broken and the
// controller stops for the Captain (ledger-service.ts).
import { createHash } from "node:crypto";
import { sshArgs, runProcess, type ProcessResult, type SshOptions } from "../stage3/ubicloud-real.ts";
import type { OffHostTarget } from "./types.ts";

export const WALCTL_PATH = "/opt/dc-wal/walctl.py";
export const WAL_DIR = "/var/lib/dc-wal";
/** BT: how long an append or snapshot may take before the target counts as lagging. */
export const WAL_TIMEOUT_MS = 30_000;

/** The WAL host's one program. Its first argument is the directory; the operation comes from argv or, under the forced command, SSH_ORIGINAL_COMMAND. */
export const WALCTL_PY = [
  "import fcntl, hashlib, os, re, sys",
  "NAME = re.compile(r'^snap-\\d{10}$')",
  "def fsync_dir(d):",
  "    fd = os.open(d, os.O_RDONLY)",
  "    try:",
  "        os.fsync(fd)",
  "    finally:",
  "        os.close(fd)",
  "def write_all(fd, data):",
  "    while data:",
  "        n = os.write(fd, data)",
  "        data = data[n:]",
  "def main():",
  "    d = sys.argv[1]",
  "    args = sys.argv[2:] or os.environ.get('SSH_ORIGINAL_COMMAND', '').split()",
  "    if not args:",
  "        sys.exit(2)",
  "    op = args[0]",
  "    snaps = os.path.join(d, 'snapshots')",
  "    records = os.path.join(d, 'records')",
  "    wal = os.path.join(d, 'wal.ndjson')",
  "    if op == 'init' and len(args) == 1:",
  "        os.makedirs(snaps, mode=0o700, exist_ok=True)",
  "        os.makedirs(records, mode=0o700, exist_ok=True)",
  "        fsync_dir(d)",
  "        print('OK')",
  "    elif op == 'append' and len(args) == 1:",
  "        data = sys.stdin.buffer.read()",
  "        if not data.endswith(b'\\n') or data.count(b'\\n') != 1:",
  "            sys.exit(2)",
  "        new = not os.path.exists(wal)",
  "        fd = os.open(wal, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)",
  "        try:",
  "            fcntl.flock(fd, fcntl.LOCK_EX)",
  "            write_all(fd, data)",
  "            os.fsync(fd)",
  "        finally:",
  "            os.close(fd)",
  "        if new:",
  "            fsync_dir(d)",
  "        print('ACK ' + hashlib.sha256(data).hexdigest())",
  "    elif op == 'lines' and len(args) == 1:",
  "        if os.path.exists(wal):",
  "            with open(wal, 'rb') as f:",
  "                fcntl.flock(f.fileno(), fcntl.LOCK_SH)",
  "                sys.stdout.buffer.write(f.read())",
  "    elif op in ('put', 'put-record') and len(args) == 2 and NAME.match(args[1]):",
  "        data = sys.stdin.buffer.read()",
  "        p = os.path.join(snaps if op == 'put' else records, args[1])",
  "        fd = os.open(p + '.tmp', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)",
  "        try:",
  "            write_all(fd, data)",
  "            os.fsync(fd)",
  "        finally:",
  "            os.close(fd)",
  "        os.rename(p + '.tmp', p)",
  "        fsync_dir(os.path.dirname(p))",
  "        print('ACK ' + hashlib.sha256(data).hexdigest())",
  "    elif op in ('get', 'get-record') and len(args) == 2 and NAME.match(args[1]):",
  "        p = os.path.join(snaps if op == 'get' else records, args[1])",
  "        if not os.path.exists(p):",
  "            sys.exit(3)",
  "        with open(p, 'rb') as f:",
  "            sys.stdout.buffer.write(f.read())",
  "    elif op == 'latest' and len(args) == 1:",
  "        names = sorted(n for n in os.listdir(snaps) if NAME.match(n))",
  "        print(names[-1] if names else '')",
  "    else:",
  "        sys.exit(2)",
  "main()",
  "",
].join("\n");

/** Runs one walctl operation and returns its result; the transport owns the time limit. */
export type WalTransport = (args: string[], input?: Uint8Array) => Promise<ProcessResult>;

/** walctl over SSH: the WAL host's forced command for this key reads the operation from the command line. */
export const sshWalTransport = (o: SshOptions, host: string, timeoutMs = WAL_TIMEOUT_MS): WalTransport => (args, input) => runProcess([...sshArgs(o, host), args.join(" ")], { input, timeoutMs });

/** walctl run locally on a directory: the local SSH stand-in for tests and the dry run. */
export const localWalTransport = (script: string, dir: string, timeoutMs = WAL_TIMEOUT_MS): WalTransport => (args, input) => runProcess(["python3", script, dir, ...args], { input, timeoutMs });

/** The authorized_keys line that pins the controller host's key to walctl on the WAL directory. */
export const walAuthorizedKey = (publicKey: string, o: { script?: string; dir?: string } = {}) => {
  const key = publicKey.trim();
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+( \S+)?$/.test(key)) throw new Error("the controller host's WAL key is not one ed25519 public key line");
  return 'command="python3 ' + (o.script ?? WALCTL_PATH) + " " + (o.dir ?? WAL_DIR) + '",restrict ' + key;
};

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const enc = new TextEncoder();
const dec = new TextDecoder();

/** The off-host target on a walctl transport. */
export class RemoteTarget implements OffHostTarget {
  constructor(private readonly run: WalTransport) {}

  private async call(what: string, args: string[], input?: Uint8Array): Promise<ProcessResult> {
    let r: ProcessResult;
    try {
      r = await this.run(args, input);
    } catch (e) {
      throw new Error("the off-host target did not answer " + what + ": " + (e as Error).message);
    }
    if (r.timedOut) throw new Error("the off-host target did not answer " + what + " within its time limit");
    return r;
  }

  private async acked(what: string, args: string[], data: Uint8Array): Promise<void> {
    const r = await this.call(what, args, data);
    const answer = dec.decode(r.stdout).trim();
    if (r.exit !== 0 || answer !== "ACK " + sha(data)) throw new Error("the off-host target did not acknowledge " + what + " (exit " + r.exit + ")");
  }

  append(line: string): Promise<void> {
    if (line.includes("\n")) throw new Error("a write-ahead line holds a newline");
    return this.acked("an append", ["append"], enc.encode(line + "\n"));
  }

  async lines(): Promise<string[]> {
    const r = await this.call("a read of its lines", ["lines"]);
    if (r.exit !== 0) throw new Error("the off-host target could not read its lines (exit " + r.exit + ")");
    return dec.decode(r.stdout).split("\n").filter(Boolean);
  }

  putSnapshot(name: string, bytes: Uint8Array): Promise<void> {
    return this.acked("snapshot " + name, ["put", name], bytes);
  }

  async getSnapshot(name: string): Promise<Uint8Array | null> {
    const r = await this.call("a read of snapshot " + name, ["get", name]);
    if (r.exit === 3) return null;
    if (r.exit !== 0) throw new Error("the off-host target could not read snapshot " + name + " (exit " + r.exit + ")");
    return r.stdout;
  }

  /** The approval record's files as a tar, kept beside the snapshot of the same name. */
  putRecord(name: string, tar: Uint8Array): Promise<void> {
    return this.acked("record " + name, ["put-record", name], tar);
  }

  async getRecord(name: string): Promise<Uint8Array | null> {
    const r = await this.call("a read of record " + name, ["get-record", name]);
    if (r.exit === 3) return null;
    if (r.exit !== 0) throw new Error("the off-host target could not read record " + name + " (exit " + r.exit + ")");
    return r.stdout;
  }

  async latestSnapshot(): Promise<string | null> {
    const r = await this.call("a list of its snapshots", ["latest"]);
    if (r.exit !== 0) throw new Error("the off-host target could not list its snapshots (exit " + r.exit + ")");
    return dec.decode(r.stdout).trim() || null;
  }
}
