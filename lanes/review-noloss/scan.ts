// Copyright (c) 2026 Garry Tan. MIT License.
// The publication scan for the review no-loss category: key shapes and sealed markers (the wiki checker's rules) plus
// machine paths. A hit names its rule and where it is, never the matched text, so a refusal cannot echo a secret.
import { SEALED_MARKER, SECRET_RULES } from "../../scripts/wiki.ts";

const MACHINE_PATH = /(?:^|[\s"'(\x60=:,\[])(?:~\/|\/home\/|\/Users\/|\/root\/|\/tmp\/|\/workspace\/|\/var\/folders\/|[A-Za-z]:\\\\(?:Users|Documents and Settings)\\\\)/;

export const SCAN_RULES: Array<[string, RegExp]> = [...SECRET_RULES, ["sealed-marker", SEALED_MARKER], ["machine-path", MACHINE_PATH]];

/** The names of the rules a text breaks, in rule order, each once. */
export function scanText(text: string): string[] {
  return SCAN_RULES.filter(([, re]) => re.test(text)).map(([name]) => name);
}

/** True when a path is absolute or names a home or scratch folder, so it would publish a machine path. */
export const machinePath = (path: string): boolean => /^(?:\/|~|[A-Za-z]:[\\/])/.test(path) || MACHINE_PATH.test(" " + path);
