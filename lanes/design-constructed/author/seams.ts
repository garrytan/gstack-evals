// Copyright (c) 2026 Garry Tan. MIT License.
// The author area's seams: every model call, block parse, spend read and base-app read reaches this area through one
// of these injected functions, so tests and the dry run make no paid call. Integration wires the real pieces (the
// metered client, the plan-changes parser, the money area's spend reading and the frame area's safe clone).
import type { AnyModel, LedgerItemId } from "../types.ts";

/** One metered model call. maxTokens is the output cap; every resend doubles it (K4). */
export interface CallRequest {
  model: AnyModel;
  effort: "high" | "medium";
  maxTokens: number;
  prompt: string;
  /** "<unit>:<step>:<model>:<attempt>", for the cache, the ledger and the scripted caller. */
  label: string;
}

export interface CallReply {
  text: string;
}

/** The metered client. A provider drift throws DcError E_DC_PROVIDER_DRIFT and the pipeline lets it through. */
export type Caller = (req: CallRequest) => Promise<CallReply>;

/** The plan-changes parser and normalizer (the score area's): the last block's normalized changes, or null for none. */
export type BlockParser = (reply: string) => string[] | null;

/** One item's spend as the money area carries it: settled, in flight and unknown, never settled alone (L1). */
export interface SpendReading {
  settledUsd: number;
  inFlightUsd: number;
  unknownUsd: number;
}

export type SpendReader = (item: LedgerItemId) => SpendReading;

/** What the author area reads of one kept base app, from the frame area's safe clone at its pin. */
export interface BaseAppView {
  /** The base-app label every contrast clusters on, for example "owner/repo@sha". */
  label: string;
  readme: string;
  /** Every tracked path, in any order. */
  tree: readonly string[];
  /** A tracked file's text, or null when the path isn't a tracked file. */
  read: (path: string) => string | null;
  /** The design-system files the file check found. */
  designFiles: readonly string[];
  /** The route files the file check found. */
  routeFiles: readonly string[];
}

/** Everything one unit's pipeline calls. today is the authoring date, used when plan.md states no date (BT). */
export interface Deps {
  call: Caller;
  parseBlock: BlockParser;
  /** The vocabulary screen's barred 5-word sequences (screen.ts loads them from the gstack pin). */
  vocabulary: ReadonlySet<string>;
  today: string;
}
