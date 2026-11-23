// Copyright (c) 2026 Garry Tan. MIT License.
// The paid step for the B1 browser-only label (plan section 6) under the h2h-labels ledger item: the state machines sender
// (statemachines/send.ts sendItem) with label.ts's packets and reader. So it keeps that sender's rules: one lease, every
// call alone through the metering proxy with its byte worst case as its allowance, a cap stop never retried, an allowance
// stop that halts until --lift-halt, an uncharged call resent once and then a gap, and a call once sent never sent again.
// Each unit in --units gets two calls, GPT-6 Astra then Opus 5.5 (packets.ts LABELLERS), on judge.ts's routes, and the
// user message is labelPacket(dir).text unchanged. readAnswer reads every answer, so a reply whose first word is neither
// yes nor no is unclear: a recorded answer that counts as not yes, never malformed and never asked again. The prereg
// freezes no per-call token bound for labels, so no call halts on its usage, and each request carries the metering
// proxy's default output cap (DEFAULT_MAX_OUTPUT_TOKENS), which its worst case is priced at. Once the send ends, finished
// or stopped, each unit with both answers gets its LabelRow in unit.json (recordLabel), and agreement over those units is
// printed and written to <out>/agreement.json.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isReasonCode } from "../../../../src/errors/codes.ts";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../../../../src/runner/proxy/metering-proxy.ts";
import { LABELLERS } from "../../statemachines/packets.ts";
import { sendItem, type ItemSendOptions, type Job, type Reader, type SendPacket, type SendResult } from "../../statemachines/send.ts";
import { readUnit } from "../../statemachines/unit.ts";
import { ITEMS } from "../items.ts";
import { H2hError, h2hFail } from "../prereg.ts";
import { H2H_SKILL } from "../sessions/driver.ts";
import { writeJson } from "./frame.ts";
import { agreement, labelPacket, labelUnit, readAnswer, recordLabel, type LabelRow } from "./label.ts";

export const LABEL_ITEM = ITEMS["h2h-labels"]!.item;
const READERS = Object.keys(LABELLERS) as Reader[];

export interface LabelSendOptions extends Omit<ItemSendOptions, "item"> {
  /** A file listing B1 unit dirs, one per line. Blank lines are skipped; a relative path is read from the file's own dir. */
  units: string;
  /** Takes the agreement line; console.log by default. */
  print?: (line: string) => void;
}

interface Unit {
  dir: string;
  id: string;
  packet: { text: string; sha256: string };
}

function readUnits(file: string): Unit[] {
  if (!existsSync(file)) h2hFail("E_H2H_LABEL_INPUT", "--units " + file + " does not exist; nothing was opened");
  const dirs = readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => resolve(dirname(file), l));
  if (!dirs.length) h2hFail("E_H2H_LABEL_INPUT", "--units " + file + " lists no unit dir; nothing was opened");
  const units: Unit[] = [];
  for (const dir of dirs) {
    const u = readUnit(dir);
    if ((u.source as string) !== "h2h-b1") h2hFail("E_H2H_LABEL_INPUT", dir + " is a " + u.source + " unit, not a B1 unit (h2h-b1); only B1 units get the browser-only label; nothing was opened");
    if (!/^[A-Za-z0-9][\w.-]*$/.test(u.id)) h2hFail("E_H2H_LABEL_INPUT", dir + " has unit id " + JSON.stringify(u.id) + ", which can't name its raw reply files; nothing was opened");
    if (units.some((x) => x.id === u.id)) h2hFail("E_H2H_LABEL_INPUT", "--units lists unit " + u.id + " twice (" + dir + "); each unit is labelled once; nothing was opened");
    units.push({ dir, id: u.id, packet: labelPacket(dir) });
  }
  return units;
}

/** Sends every label call the out dir has not recorded, on one lease of h2h-labels, then records each unit both readers
 *  answered and the agreement over those units. */
export async function sendLabels(o: LabelSendOptions): Promise<SendResult> {
  const print = o.print ?? ((line: string) => console.log(line));
  let units: Unit[] | undefined;
  const load = () => {
    units = readUnits(resolve(o.units));
    const read: SendPacket["read"] = (answer) => ({ ok: true, answer: readAnswer(answer) });
    return {
      packets: new Map(units.map((u): [string, SendPacket] => [u.id, { prompt: u.packet.text, sha256: u.packet.sha256, read }])),
      order: units.flatMap((u) => READERS.map((reader): Job => ({ packet: u.id, reader }))),
    };
  };
  const after = async (replies: string) => {
    if (!units) return;
    const out = dirname(replies);
    const packet = new Map(units.map((u) => [u.id, u.packet.sha256]));
    const sent = new Map<string, string>();
    const raw = new Map<string, string>();
    for (const row of existsSync(replies) ? readFileSync(replies, "utf8").split("\n") : []) {
      let v: Record<string, any> | null = null;
      try {
        v = JSON.parse(row);
      } catch {}
      if (!v || typeof v !== "object") continue;
      if (v.item !== LABEL_ITEM || v.run_id !== o.run_id) return;
      if (v.event === "send") sent.set(v.meter_id, v.packet_sha256);
      if (v.event === "reply" && v.outcome === "answered" && sent.get(v.meter_id) === packet.get(v.packet)) raw.set(v.packet + " " + v.reader, readFileSync(join(out, v.raw), "utf8"));
    }
    const rows: LabelRow[] = [];
    for (const u of units) {
      const texts = READERS.map((r) => raw.get(u.id + " " + r));
      if (texts.some((t) => t === undefined)) continue;
      const row = await labelUnit(u.id, u.packet, READERS.map((r, i) => ({ model: LABELLERS[r].split("/")[1]!, ask: async () => texts[i]! })));
      if (JSON.stringify(readUnit(u.dir).labels?.browser_only) !== JSON.stringify(row)) recordLabel(u.dir, row);
      rows.push(row);
    }
    const a = agreement(rows);
    writeJson(join(out, "agreement.json"), a);
    print(JSON.stringify(a));
  };
  try {
    return await sendItem({ command: "h2h label-send", program: null, skills: [H2H_SKILL], source: "every h2h item charges skill " + H2H_SKILL, output_tokens: DEFAULT_MAX_OUTPUT_TOKENS, bound: null, packet_code: "E_H2H_LABEL_INPUT", load, after }, { ...o, item: LABEL_ITEM });
  } catch (e) {
    const m = /^([A-Z][A-Z0-9_]*) ([\s\S]*)$/.exec((e as Error).message);
    if (!(e instanceof H2hError) && m && isReasonCode(m[1]!)) throw new H2hError(m[1]!, m[2]!);
    throw e;
  }
}
