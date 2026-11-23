// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals decision-routing pin: writes the pin file (build spec section 6) and pin.json.sha256.
//   pin --tuned <tuned.json> --questions <questions.json> --out <pin.json> [--particle-max-tokens 8000|16000]
//   pin --calibration --questions <questions.json> --out <pin.json>   the calibration batch's pin, before any band is tuned
import { readFileSync } from "node:fs";
import { buildPin, ruleDigests, sha256, writeCalibrationPin, writePin } from "./pin.ts";

const flag = (argv: string[], name: string): string | undefined => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const flags = (argv: string[], name: string): string[] => argv.flatMap((a, i) => (a === name && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));

export async function main(argv: string[]): Promise<number> {
  const tuned = flag(argv, "--tuned"), questions = flag(argv, "--questions"), out = flag(argv, "--out");
  if (argv.includes("--calibration") && questions && out) { console.log("wrote " + out + " sha256 " + writeCalibrationPin(out, readFileSync(questions))); return 0; }
  if (!tuned || !questions || !out) { console.error("E_USAGE pin --tuned <tuned.json> --questions <questions.json> --out <pin.json> [--particle-max-tokens 8000|16000]"); return 2; }
  const pin = buildPin(JSON.parse(readFileSync(tuned, "utf8")), { questions_sha256: sha256(readFileSync(questions)), ...ruleDigests(), particle_max_tokens: Number(flag(argv, "--particle-max-tokens") ?? 8000) });
  console.log("wrote " + out + " sha256 " + writePin(out, pin));
  return 0;
}
