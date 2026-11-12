// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review build read's refusal: a reason code from src/errors/codes.ts and a message. Every error line on
// stderr starts with its code.
import type { ReasonCode } from "../../src/errors/codes.ts";

export class EbError extends Error {
  constructor(
    readonly code: ReasonCode,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (code: ReasonCode, message: string): never => {
  throw new EbError(code, message);
};

/** A cross-module function the scaffold declares before its builder fills it in. */
export const notBuilt = (what: string): never => fail("E_EB_NOT_BUILT", what + " is not built yet");
