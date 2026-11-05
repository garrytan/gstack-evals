// Copyright (c) 2026 Garry Tan. MIT License.
// Request-shape capture (prereg section 3): the pinned Claude Code against a scripted stub provider with no key, in an
// empty home; per-run fields become placeholders; forbidden content is refused.
import { notBuilt } from "./errors.ts";
import type { Arm, Model, Shape } from "./types.ts";

export interface CaptureOptions {
  arm: Arm;
  pin: string | null;
  /** The claude binary to run (Claude Code 2.1.312, or a stub CLI in tests). */
  claude: string;
  /** A gstack checkout at the pin, for gstack arms. */
  gstack: string | null;
  out: string;
}
export function captureShape(o: CaptureOptions): Promise<Shape> {
  return notBuilt("captureShape");
}
/** The shape with per-run fields filled for a model. */
export function fillShape(shape: Shape, model: Model, fields: { cwd: string; date: string }): Shape {
  return notBuilt("fillShape");
}
