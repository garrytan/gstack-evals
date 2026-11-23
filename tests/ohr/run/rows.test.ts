// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=each session row's served model and CLI version (the second attempt's pre-run change 2): Claude Code's reply models and version from its transcript, Sol's reply models from the tap and Codex's version from its rollout, and the rowProblems line when either is not the pin
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_CODE_VERSION, CODEX, MODEL_KEYS } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { assistantModels, cliVersion, servedModel } from "../../../lanes/office-hours-rewrite/pinned.ts";
import { tapModels } from "../../../lanes/office-hours-rewrite/run/codex-rig.ts";
import { entryId } from "../../../lanes/office-hours-rewrite/run/manifest.ts";
import { rowProblems, sessionRow, unrunRow, type RowLine } from "../../../lanes/office-hours-rewrite/run/rows.ts";
import { closingLoop, type AttemptRead } from "../../../lanes/office-hours-rewrite/run/session.ts";
import { parseBlock } from "../../../lanes/office-hours-rewrite/score/block.ts";
import type { ManifestEntry, SessionRow } from "../../../lanes/office-hours-rewrite/types.ts";

const REPO = join(import.meta.dir, "..", "..", "..");
const ENTRY: ManifestEntry = { stage: 1, brief: "b1", model: "opus", arm: "none" };
const tx = (...m: object[]) => m.map((x) => JSON.stringify(x)).join("\n") + "\n";
const init = (o: object) => ({ type: "system", subtype: "init", ...o });
const said = (model?: string) => ({ type: "assistant", message: { ...(model === undefined ? {} : { model }), content: [] } });

describe("served model and CLI version", () => {
  test("Claude Code's version pin is docker/host-cli.json's", () => {
    expect(JSON.parse(readFileSync(join(REPO, "docker/host-cli.json"), "utf8")).claude).toBe(CLAUDE_CODE_VERSION);
  });

  test("a Claude Code transcript names its reply models, each once with <synthetic> skipped, and its version", () => {
    const t = tx(init({ model: "claude-opus-5-5", claude_code_version: "2.1.314" }), said("claude-opus-5-5"), said("<synthetic>"), init({ model: "claude-opus-5-5", claude_code_version: "2.1.314" }), said("claude-opus-5-5-20261101"), said("claude-opus-5-5"), said());
    expect(assistantModels(t)).toEqual(["claude-opus-5-5", "claude-opus-5-5-20261101", "(no model)"]);
    expect(servedModel(assistantModels(t))).toBe("claude-opus-5-5, claude-opus-5-5-20261101, (no model)");
    expect(cliVersion(t)).toBe("2.1.314");
    expect(servedModel([])).toBeNull();
    expect(servedModel(null)).toBeNull();
    expect(cliVersion(tx(said("claude-opus-5-5")))).toBeNull();
  });

  test("a Sol transcript's version is Codex's own, and its served models are the tap's for the session's slot", () => {
    expect(cliVersion(tx(init({ model: "gpt-6.1-sol", cli_version: "0.170.0", host: "codex" }), said("gpt-6.1-sol")))).toBe("0.170.0");
    const log = join(mkdtempSync(join(tmpdir(), "ohr-rows-")), "models.ndjson");
    expect(tapModels(log, "a")).toBeNull();
    const l = (slot: string, status: number, models: (string | null)[]) => JSON.stringify({ slot, status, responses: models.map((model, i) => ({ id: "r" + i, model })) });
    writeFileSync(log, [l("a", 200, ["gpt-6.1-sol"]), l("a", 502, [null]), l("b", 200, ["gpt-9"]), l("a", 200, ["gpt-6.1-sol-2026-11-01", null]), l("a", 200, [])].join("\n") + "\n");
    expect(tapModels(log, "a")).toEqual(["gpt-6.1-sol", "gpt-6.1-sol-2026-11-01", "(no model)"]);
  });

  test("a row carries its scored attempt's served model and CLI version, and an unrun row has neither", () => {
    const a = (served_model: string | null, cli_version: string | null): AttemptRead => ({ termination: { kind: "completed" }, loop: closingLoop({ parse: parseBlock, founder: async () => { throw new Error("no founder turn"); } }).state, gstack_reads: [], contained: [], pin: [], overflow: false, safety: null, session_kind: null, off_pin: [], served_model, cli_version, micros: 0, sim_micros: 0 });
    const row = sessionRow({ entry: ENTRY, end: { state: "missing", code: "UPSTREAM" }, attempts: [a("claude-sonnet-5-5", "2.1.300"), a("claude-opus-5-5", "2.1.314")], transcript: null, state_root: null });
    expect([row.served_model, row.cli_version]).toEqual(["claude-opus-5-5", "2.1.314"]);
    expect([unrunRow(ENTRY).served_model, unrunRow(ENTRY).cli_version]).toEqual([null, null]);
  });

  const line = (o: Partial<SessionRow>): RowLine => {
    const row: SessionRow = { ...unrunRow(ENTRY), code: "UPSTREAM", attempts: 1, replies: 3, served_model: MODEL_KEYS.opus, cli_version: CLAUDE_CODE_VERSION, ...o };
    return { id: entryId(row), launch: "stage1", row, why: "", attempts: [{ attempt: 1, outcome: "missing", code: row.code, why: "", usd: 0, sim_usd: 0, contained: [], failed_turn: null }] };
  };
  const served = (o: Partial<SessionRow>) => rowProblems(line(o)).filter((p) => /served model|CLI version/.test(p));

  test("rowProblems passes a row whose served model and CLI version are its pins", () => {
    expect(served({})).toEqual([]);
    expect(served({ served_model: "claude-opus-5-5, claude-opus-5-5-20261101" })).toEqual([]);
    expect(served({ model: "particle", served_model: MODEL_KEYS.particle })).toEqual([]);
    expect(served({ model: "sol", served_model: CODEX.model, cli_version: CODEX.version })).toEqual([]);
    expect(served({ served_model: null, cli_version: null, replies: 0 })).toEqual([]);
  });

  test("rowProblems flags a served model or CLI version that is not the pin, and a row with replies that names neither", () => {
    expect(served({ served_model: "claude-opus-5-5, claude-sonnet-5-5" })).toEqual(["served model claude-opus-5-5, claude-sonnet-5-5 is not the pinned claude-opus-5-5"]);
    expect(served({ model: "sol", served_model: "gpt-6.2-sol", cli_version: CODEX.version })).toEqual(["served model gpt-6.2-sol is not the pinned gpt-6.1-sol"]);
    expect(served({ cli_version: "2.1.300" })).toEqual(["CLI version 2.1.300 is not the pinned 2.1.314"]);
    expect(served({ model: "sol", served_model: CODEX.model, cli_version: CLAUDE_CODE_VERSION })).toEqual(["CLI version 2.1.314 is not the pinned 0.170.0"]);
    expect(served({ served_model: null, cli_version: null })).toEqual(["3 replies and no served model", "3 replies and no CLI version"]);
    expect(served({ served_model: undefined, cli_version: undefined })).toEqual(["3 replies and no served model", "3 replies and no CLI version"]);
  });

  test("rowProblems leaves an off-pin served model to the drift halt's own code", () => {
    expect(served({ served_model: "claude-sonnet-5-5", code: "E_OHR_MODEL_DRIFT" })).toEqual([]);
    expect(served({ served_model: "claude-sonnet-5-5", code: "E_OHR_MODEL_DRIFT", cli_version: "2.1.300" })).toEqual(["CLI version 2.1.300 is not the pinned 2.1.314"]);
  });
});
