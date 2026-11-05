// Copyright (c) 2026 Garry Tan. MIT License.
// The request builder (prereg section 3: four inputs only) and the structural validator.
import { notBuilt } from "./errors.ts";
import type { BuildInput, BuiltRequest, Model, Validation } from "./types.ts";

export const MAX_TOKENS = 4000;
export function buildRequest(input: BuildInput): BuiltRequest {
  return notBuilt("buildRequest");
}
export function validateRequest(body: Record<string, unknown>, model: Model): Validation {
  return notBuilt("validateRequest");
}
