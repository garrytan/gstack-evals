// Copyright (c) 2026 Garry Tan. MIT License.
// Disk directories for the tbv tests. Custody tells disk from tmpfs by the mount table, and some CI runner images mount
// /tmp as tmpfs, so a directory under the OS temp dir is not on disk everywhere. These go under the home directory
// instead, which is on disk on the CI runner images, and stay outside the checkout. disk.test.ts checks the mount.
import { mkdtempSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A fresh directory under the home directory; the caller removes it. */
export const mkdtempDisk = (prefix: string) => mkdtempSync(join(homedir(), ".gstack-evals-test-" + prefix));
