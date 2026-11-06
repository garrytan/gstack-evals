// Copyright (c) 2026 Garry Tan. MIT License.
// Custody for a run (prereg section 16): the plaintext root on tmpfs, the leftover check at start, sealed records.
import { notBuilt } from "./errors.ts";

export function plaintextRoot(dir: string, o: { devPlaintext: boolean; held: boolean; unsealCmd?: string | null; mounts?: string }): string {
  return notBuilt("plaintextRoot");
}
export function leftover(dir: string, log: (text: string) => void): boolean {
  return notBuilt("leftover");
}
export function seal(cmd: string | null, text: string, path: string): void {
  return notBuilt("seal");
}
export function unseal(cmd: string | null, path: string): string {
  return notBuilt("unseal");
}
export interface Vault {
  root: string;
  durable: string;
  put(name: string, text: string): void;
  all(): Map<string, string>;
}
export function openVault(o: { root: string; durable: string; sealCmd: string | null; unsealCmd: string | null }): Vault {
  return notBuilt("openVault");
}
