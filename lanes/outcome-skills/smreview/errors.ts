// Copyright (c) 2026 Garry Tan. MIT License.
// The State Machines review specialist eval's refusal helper. Every refusal message starts with its reason code.
import type { ReasonCode } from "../../../src/errors/codes.ts";

export class SrError extends Error {
  constructor(readonly code: ReasonCode, message: string) {
    super(code + " " + message);
  }
}
export const srFail = (code: ReasonCode, message: string): never => {
  throw new SrError(code, message);
};
