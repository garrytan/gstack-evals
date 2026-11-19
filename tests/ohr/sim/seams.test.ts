// Value: protects=the sim area's frozen rules: every seam it exports passes through the real code.
import { expect, test } from "bun:test";
import { seams } from "../../../lanes/office-hours-rewrite/sim/seams.ts";

for (const s of seams) test(s.name, async () => expect(await s.run()).toMatchObject({ ok: true }));
