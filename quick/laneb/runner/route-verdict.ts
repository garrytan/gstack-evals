// The route check's verdict for one model (Run D section 8, GEVA-139). The smoke session (arm none) passes when at least one
// tool call got its result back. The listing session (arm gstack, runner/route-listing.md as the task) passes when an
// assistant text quotes /investigate's shipped description, whitespace and case aside, before any Skill call and any tool
// call whose input names a skill, investigate or a .claude path: the quote then came from the skill listing, which reaches
// the model as a system-role message.
//   bun runner/route-verdict.ts <model> <smoke job dir> <listing job dir>
// Prints one line and exits 1 when either session fails or has no trial.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SHIPPED_LINE } from "../arms/variants.ts";

export const DESCRIPTION = SHIPPED_LINE.replace(/^description: /, "");
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

export function toolResults(msgs: any[]): number {
  return msgs.filter((m) => m.type === "UserMessage" && Array.isArray(m.content)).flatMap((m) => m.content).filter((b: any) => b?.tool_use_id).length;
}

export function quotesListing(msgs: any[], description = DESCRIPTION): boolean {
  for (const m of msgs) {
    if (m.type !== "AssistantMessage" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b && typeof b === "object" && "name" in b) {
        if (b.name === "Skill" || /skill|investigate|\.claude/i.test(JSON.stringify(b.input ?? {}))) return false;
      } else if (typeof b?.text === "string" && norm(b.text).includes(norm(description))) return true;
    }
  }
  return false;
}

function transcript(job: string): any[] | null {
  if (!existsSync(job)) return null;
  const trial = readdirSync(job).map((t) => join(job, t, "agent", "sdk-messages.jsonl")).find(existsSync);
  if (!trial) return null;
  return readFileSync(trial, "utf8").split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

if (import.meta.main) {
  const [model, smokeJob, listingJob] = Bun.argv.slice(2);
  if (!listingJob) {
    console.error("E_USAGE usage: route-verdict.ts <model> <smoke job dir> <listing job dir>");
    process.exit(2);
  }
  const smoke = transcript(smokeJob!);
  const listing = transcript(listingJob);
  const smokeOk = smoke !== null && toolResults(smoke) > 0;
  const listingOk = listing !== null && quotesListing(listing);
  const smokeText = smoke === null ? "no trial" : `tool results ${toolResults(smoke)}`;
  const listingText = listing === null ? "no trial" : listingOk ? "quoted the /investigate description" : "did not quote the /investigate description";
  console.log(`route-check ${model}: smoke ${smokeText} ${smokeOk ? "PASS" : "FAIL"}; listing ${listingText} ${listingOk ? "PASS" : "FAIL"}`);
  process.exit(smokeOk && listingOk ? 0 : 1);
}
