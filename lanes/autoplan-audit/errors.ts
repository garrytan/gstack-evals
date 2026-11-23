// Copyright (c) 2026 Garry Tan. MIT License.
// The autoplan record audit's refusal (prereg 2026-11-09-geva-419, section 13.3): a reason code from
// src/errors/codes.ts and a message that never carries record text. cli.ts prints it with the code on every line.
import type { ReasonCode } from "../../src/errors/codes.ts";

export class ArError extends Error {
  constructor(
    readonly code: ReasonCode,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (code: ReasonCode, message: string): never => {
  throw new ArError(code, message);
};

/** The codes that stop the whole run (section 13.3); the others stop one part or are counted. */
export const RUN_STOPS: ReadonlySet<ReasonCode> = new Set(["E_AR_FRAME_DRIFT", "E_AR_PACKET_LEAK", "E_AR_CUSTODY"]);
