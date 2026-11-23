// Copyright (c) 2026 Garry Tan. MIT License.
// pv exposure: plan-ceo-review's and office-hours' procedure detectors (prereg 2026-11-08-geva-403 section 5) over
// recorded-session fixtures in the pinned 23f9d07 formats, each condition in both directions, and smoke rule 2's
// expansion_in_block reading. Keyless; the transcripts are synthetic.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTree } from "../../src/trial/cleanup.ts";
import { carries, ceoReviewExposure, designDocs, handoffModes, officeHoursExposure, proposalsOf, section10, section9, sessionExposure, statusOf } from "../../lanes/product-value/exposure.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "pv-exposure-"));
  roots.push(d);
  return d;
};
const tick = "\u0060\u0060\u0060";
const assistant = (content: unknown[], parent: string | null = null) => JSON.stringify({ type: "assistant", parent_tool_use_id: parent, message: { content } });
const user = (content: unknown[], parent: string | null = null) => JSON.stringify({ type: "user", parent_tool_use_id: parent, message: { content } });
const say = (t: string, parent: string | null = null) => assistant([{ type: "text", text: t }], parent);
let n = 0;
const call = (name: string, input: Record<string, unknown>, result: string, isError = false, parent: string | null = null) => {
  const id = "toolu_" + ++n;
  return [assistant([{ type: "tool_use", id, name, input }], parent), user([{ type: "tool_result", tool_use_id: id, content: result, ...(isError ? { is_error: true } : {}) }], parent)];
};
const nd = (...lines: (string | string[])[]) => lines.flat().join("\n") + "\n";
const HANDOFF = "~/.claude/skills/gstack/bin/gstack-ceo-mode-handoff";
const handoff = (mode: string, how: "plain" | "auto" | "ceo-only" = "auto") =>
  call("Bash", { command: HANDOFF + " " + mode.replace(" ", "_") + (how === "plain" ? "" : " --" + how) }, how === "auto" ? "Auto-decided review mode \u2192 " + mode + " (your preference). Change with /plan-tune. Approved decisions: none." : how === "ceo-only" ? "Auto-selected review mode \u2192 " + mode + " (CEO-only run: Step 0E's rule). Approved decisions: none." : "Mode: " + mode + "; approved decisions: none.");
const PROPOSALS = [
  "### 0F. Expansion proposals",
  "",
  "| Proposal | Effort | Impact | Decision |",
  "|---|---|---|---|",
  "| Offline sync for field teams | M | High: field users lose work today | Pending approval (unattended) |",
  "| Shared team templates | S | Medium | Accepted |",
].join("\n");
const SECTIONS = "## Section 9: Deployment & Rollout Review\nShip behind a flag.\n\n## Section 10: Long-Term Trajectory\nPhase 2 opens the platform.";
const block = (changes: string[]) => tick + "plan-changes\n" + JSON.stringify({ changes }) + "\n" + tick;

describe("plan-ceo-review: the handoff line", () => {
  test("each of the pinned script's three forms names the mode; a failed call or a line the command echoes does not", () => {
    expect(handoffModes(nd(handoff("SCOPE EXPANSION", "auto")))).toEqual(["SCOPE EXPANSION"]);
    expect(handoffModes(nd(handoff("HOLD SCOPE", "plain")))).toEqual(["HOLD SCOPE"]);
    expect(handoffModes(nd(handoff("SELECTIVE EXPANSION", "ceo-only")))).toEqual(["SELECTIVE EXPANSION"]);
    expect(handoffModes(nd(call("Bash", { command: HANDOFF + " HOLD_SCOPE" }, "Mode: HOLD SCOPE; approved decisions: none.", true)))).toEqual([]);
    const echoed = 'echo "Mode: SCOPE EXPANSION; approved decisions: none."';
    expect(handoffModes(nd(call("Bash", { command: HANDOFF + " HOLD_SCOPE; " + echoed }, "Mode: HOLD SCOPE; approved decisions: none.\nMode: SCOPE EXPANSION; approved decisions: none.")))).toEqual(["HOLD SCOPE"]);
    expect(handoffModes(nd(call("Bash", { command: echoed }, "Mode: SCOPE EXPANSION; approved decisions: none.")))).toEqual([]);
    expect(handoffModes(nd(say("Mode: SCOPE EXPANSION; approved decisions: none.")))).toEqual([]);
    expect(handoffModes(nd(handoff("HOLD SCOPE", "auto").map((l) => l.replace('"parent_tool_use_id":null', '"parent_tool_use_id":"task-1"'))))).toEqual([]);
  });
});

describe("plan-ceo-review: sections 9 and 10", () => {
  test("a section's name, or two of its named checks; one check alone is not enough", () => {
    expect(section9("Deployment and rollout")).toBe(true);
    expect(section9("Use feature flags, and write a rollback plan.")).toBe(true);
    expect(section9("Use feature flags.")).toBe(false);
    expect(section10("Long-term trajectory")).toBe(true);
    expect(section10("Phase 2 adds platform potential.")).toBe(true);
    expect(section10("Reversibility matters.")).toBe(false);
  });
});

describe("plan-ceo-review: 0F proposals", () => {
  test("a proposal needs an effort and an impact; its status is the last one stated, pending when none is", () => {
    const t = nd(say(PROPOSALS), say("- **Usage analytics dashboard**: effort L, impact: medium for admins"), say("- **Dark mode** would be nice"));
    const p = proposalsOf(t, null);
    expect(p.map((x) => [x.title, x.effort, x.status])).toEqual([["Offline sync for field teams", "M", "pending"], ["Shared team templates", "S", "accepted"], ["Usage analytics dashboard", "L", "pending"]]);
    expect(p.every((x) => x.in_block === false)).toBe(true);
    const later = nd(say(PROPOSALS), say("- **Offline sync for field teams**: effort M, impact: high. Deferred to TODOS.md."));
    expect(proposalsOf(later, null)[0]!.status).toBe("deferred");
  });

  test("statusOf and carries, both ways", () => {
    expect([statusOf("Pending approval"), statusOf("deferred"), statusOf("Rejected"), statusOf("Added to scope"), statusOf("worth doing")]).toEqual(["pending", "deferred", "skipped", "accepted", null]);
    expect(carries("Add offline sync so field teams keep working without signal", "Offline sync for field teams")).toBe(true);
    expect(carries("Add a sync status badge", "Offline sync for field teams")).toBe(false);
    expect(carries("Ship templates", "Templates")).toBe(true);
  });
});

describe("plan-ceo-review: the detector", () => {
  test("exposed: the handoff, a 0F proposal in an expansion mode, and sections 9 and 10; the block carries a pending proposal", () => {
    const t = nd(handoff("SELECTIVE EXPANSION"), say(PROPOSALS), say(SECTIONS), say("Done.\n\n" + block(["Add offline sync so field teams keep their work without signal", "Name a rollback owner"])));
    const e = ceoReviewExposure(t);
    expect([e.exposed, e.failed, e.mode, e.pending, e.expansion_in_block]).toEqual([true, null, "SELECTIVE EXPANSION", 1, true]);
    expect(e.checks).toEqual({ handoff: true, proposal: true, section_9: true, section_10: true });
    expect(e.proposals.find((p) => p.title === "Offline sync for field teams")!.in_block).toBe(true);
  });

  test("not exposed: no handoff; an expansion mode with no proposal; a section missing. HOLD SCOPE needs no proposal", () => {
    expect(ceoReviewExposure(nd(say(PROPOSALS), say(SECTIONS))).failed).toBe("handoff");
    expect(ceoReviewExposure(nd(handoff("SCOPE EXPANSION"), say(SECTIONS))).failed).toBe("proposal");
    expect(ceoReviewExposure(nd(handoff("SCOPE EXPANSION"), say(PROPOSALS), say("## Section 9: Deployment & Rollout Review"))).failed).toBe("section_10");
    const hold = ceoReviewExposure(nd(handoff("HOLD SCOPE"), say(SECTIONS), say(block(["Cut the admin console"]))));
    expect([hold.exposed, hold.checks.proposal, hold.expansion_in_block]).toEqual([true, null, false]);
    expect(ceoReviewExposure(nd(handoff("HOLD SCOPE"), say(SECTIONS))).expansion_in_block).toBeNull();
  });

  test("section text a subagent wrote does not count; text the main agent wrote to a file does", () => {
    const sub = nd(handoff("HOLD SCOPE"), say(SECTIONS, "task-1"));
    expect(ceoReviewExposure(sub).checks.section_9).toBe(false);
    const wrote = nd(handoff("HOLD SCOPE"), call("Write", { file_path: "review.md", content: SECTIONS }, "File written"));
    expect(ceoReviewExposure(wrote).checks).toMatchObject({ section_9: true, section_10: true });
    const failed = nd(handoff("HOLD SCOPE"), call("Write", { file_path: "review.md", content: SECTIONS }, "permission denied", true));
    expect(ceoReviewExposure(failed).checks.section_9).toBe(false);
  });
});

describe("office-hours: the design doc", () => {
  const BRIEF = "Small clinics lose patient reminders when the front desk changes shifts, and they want a shared queue that survives handoffs.";
  const doc = (premises: string, approaches = true) => "# Design: clinic queue\n\n## Premises\n" + premises + "\n\n" + (approaches ? "## Approaches Considered\nA shared queue; a paging bot.\n\n" : "") + "## Next steps\nBuild it.\n";
  const root = (files: Record<string, string>) => {
    const d = scratch();
    for (const [f, c] of Object.entries(files)) {
      mkdirSync(join(d, f, ".."), { recursive: true });
      writeFileSync(join(d, f), c);
    }
    return d;
  };

  test("exposed: a design doc whose Premises share three word triples with the brief and which considers approaches", () => {
    const d = root({ "projects/clinic/user-main-design-20261108-101500.md": doc("Clinics lose patient reminders when the front desk changes shifts.") });
    const e = officeHoursExposure(d, BRIEF);
    expect([e.exposed, e.failed, e.docs]).toEqual([true, null, ["projects/clinic/user-main-design-20261108-101500.md"]]);
    expect(e.overlap >= 3).toBe(true);
  });

  test("not exposed: no state root, no design doc, no Premises, no Approaches, or premises that don't echo the brief", () => {
    expect(officeHoursExposure(null, BRIEF).failed).toBe("design_doc");
    expect(officeHoursExposure(root({ "projects/clinic/notes.md": doc("x") }), BRIEF).failed).toBe("design_doc");
    expect(officeHoursExposure(root({ "projects/clinic/a-design-1.md": "# Design\n\n## Approaches Considered\nOne.\n" }), BRIEF).failed).toBe("premises");
    expect(officeHoursExposure(root({ "projects/clinic/a-design-1.md": doc("Clinics lose patient reminders when the front desk changes shifts.", false) }), BRIEF).failed).toBe("approaches");
    const weak = officeHoursExposure(root({ "projects/clinic/a-design-1.md": doc("They lose patient reminders often. The front desk is busy.") }), BRIEF);
    expect([weak.failed, weak.overlap]).toEqual(["premises_overlap", 2]);
  });

  test("design docs are non-empty regular files under projects/<slug>/; empty files and symlinks are not", () => {
    const d = root({ "projects/a/x-design-1.md": "# D\n", "projects/a/y-design-2.md": "", "projects/b/plan.md": "# P\n" });
    symlinkSync(join(d, "projects/a/x-design-1.md"), join(d, "projects/a/z-design-3.md"));
    expect(designDocs(d)).toEqual(["projects/a/x-design-1.md"]);
  });

  test("sessionExposure reads a session dir's host/transcript.ndjson or host/gstack-state", () => {
    const s = root({ "host/transcript.ndjson": nd(handoff("HOLD SCOPE"), say(SECTIONS)), "host/gstack-state/projects/clinic/u-design-1.md": doc("Clinics lose patient reminders when the front desk changes shifts.") });
    expect(sessionExposure(s, "plan-ceo-review", null)!.exposed).toBe(true);
    expect(sessionExposure(s, "office-hours", BRIEF)!.exposed).toBe(true);
    expect(sessionExposure(scratch(), "plan-ceo-review", null)).toBeNull();
    expect(sessionExposure(scratch(), "office-hours", BRIEF)!.failed).toBe("design_doc");
  });
});
