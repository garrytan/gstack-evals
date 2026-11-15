// Value: protects=the simulator's start rule 7 edges: every seam this area exports passes through the real code.
import { expect, test } from "bun:test";
import { seams } from "../../../lanes/office-hours-founder/sim/seams.ts";

for (const s of seams) test(s.name, async () => expect(await s.run()).toMatchObject({ ok: true }));
