// Copyright (c) 2026 Garry Tan. MIT License.
// The design plan review lane's refusal: a reason code from src/errors/codes.ts and a message. Every error line on
// stderr starts with its code.
import type { ReasonCode } from "../../src/errors/codes.ts";

export class DcError extends Error {
  constructor(
    readonly code: ReasonCode,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (code: ReasonCode, message: string): never => {
  throw new DcError(code, message);
};
