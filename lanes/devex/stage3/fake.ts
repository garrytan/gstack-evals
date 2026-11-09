// Copyright (c) 2026 Garry Tan. MIT License.
// The fake VM backend stage 3's tests and dry-run lines drive (prereg 2026-11-09-geva-417, section 12 "Sandbox (I1)").
// It runs nothing: exec answers from a handler, files live in memory, and the network log is whatever the handler
// records. It keeps every call so a test can see that the preamble ran first and that every VM was destroyed.
import type { Connection, ExecOptions, ExecResult, StatEntry, Vm, VmBackend, VmSpec } from "./sandbox.ts";

export interface FakeVm extends Vm {
  files: Map<string, Uint8Array>;
  net: Connection[];
  calls: Array<{ command: string; o: ExecOptions }>;
}

export type FakeHandler = (vm: FakeVm, command: string, o: ExecOptions) => Partial<ExecResult> | undefined;

export const res = (exit = 0, stdout = "", o: Partial<ExecResult> = {}): ExecResult => ({ exit, stdout, stderr: "", elapsed_ms: 5, stdin_closed: true, ...o });

export class FakeBackend implements VmBackend {
  readonly vms: FakeVm[] = [];
  readonly destroyed = new Set<string>();
  constructor(private readonly handler: FakeHandler = () => undefined) {}
  async create(spec: VmSpec): Promise<Vm> {
    const vm: FakeVm = { id: "fake-" + (this.vms.length + 1), spec, files: new Map(), net: [], calls: [] };
    this.vms.push(vm);
    return vm;
  }
  async exec(vm: Vm, command: string, o: ExecOptions = {}): Promise<ExecResult> {
    const v = vm as FakeVm;
    v.calls.push({ command, o });
    return { ...res(), stdin_closed: !!o.stdinClosed, ...(this.handler(v, command, o) ?? {}) };
  }
  async write(vm: Vm, path: string, data: Uint8Array | string) {
    (vm as FakeVm).files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
  }
  async read(vm: Vm, path: string) {
    const f = (vm as FakeVm).files.get(path);
    if (!f) throw new Error("E_DX_INFRA_MISSING no file " + path + " on " + vm.id);
    return f;
  }
  async networkLog(vm: Vm) {
    return [...(vm as FakeVm).net];
  }
  async fileList(vm: Vm, root: string): Promise<StatEntry[]> {
    return [...(vm as FakeVm).files.entries()].filter(([p]) => p.startsWith(root)).map(([p, d]) => ({ path: p.slice(root.length + 1), size: d.length, mode: 0o644, mtime: "2026-11-09T00:00:00" }));
  }
  async destroy(vm: Vm) {
    this.destroyed.add(vm.id);
  }
}

export const fakeSpec = (o: Partial<VmSpec> = {}): VmSpec => ({ owner: "GEVA-0", ttl_minutes: 180, session_minutes: 120, run_user: "run", proxy: { host: "10.0.0.2", port: 8080 }, mirror: { host: "10.0.0.3", port: 443 }, mounts: [], env: {}, ...o });
