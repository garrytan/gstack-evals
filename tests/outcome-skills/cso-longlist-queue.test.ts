// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-589: the counted-run script's queue (kit/main3.sh.txt in the results post) waits while running sessions hold the
// room a session's allowance needs, and stops only when nothing runs and the room is under the next allowance, for its
// own cap and for the $170 combined check. Each case runs the script's guard, claim and lane functions against a stub
// session runner (opus costs $9, particle-1 $1) and a stub combined check that counts $28.11 already committed.
// The stub writes each session.json whole and under the queue lock. The real runner does neither, so the script can read
// a file mid-write (finished spend reads as $0) or miss a session that ends between its spend and allowance reads; the
// results post says so, and the ledger's cap on the run's lease is the hard stop.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../../wiki/board/2026-11-25-geva-589-cso-longlist-results/kit/main3.sh.txt");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const sim = String.raw`set -uo pipefail
T=$1; S=$T/s; mkdir -p $S/units $S/running $S/sessions; G=$T/g; mkdir -p $G/lanes/outcome-skills/cso
cat > $G/lanes/outcome-skills/cso/combined-cap.ts <<'EOF'
const a = process.argv.slice(2); const v = (k: string) => Number(a[a.indexOf(k) + 1]);
const tot = 28.11 + v("--spent") + v("--reserve") + v("--next");
console.log("combined " + tot.toFixed(2) + " of " + v("--cap")); process.exit(tot > v("--cap") ? 10 : 0);
EOF
GE=$T/ge; cat > $GE <<'EOF'
#!/usr/bin/env bash
m=$6; u=$(jq -r ".[0]" $8); c=1; [ $m = opus ] && c=9; sleep 0.$((RANDOM % 4 + 1)); mkdir -p $CSO_OUT/rerun/$u/$m; echo "{\"cost_usd\": $c}" > $CSO_OUT/rerun/$u/$m/s.tmp; ( flock 9; mv $CSO_OUT/rerun/$u/$m/s.tmp $CSO_OUT/rerun/$u/$m/session.json ) 9> $CSO_OUT/../queue.lock
EOF
chmod +x $GE; export CSO_OUT=$S/sessions
sg() { bash -c "$3"; }
alive() { true; }
step() { echo "== $1"; }
sleep() { command sleep 0.1; }
for i in $(seq 12); do [ $((i % 2)) = 1 ] && echo "u$i opus cso" || echo "u$i particle cso"; done > $S/order.txt
echo 0 > $S/next
CAP=$SIMCAP; TOTAL=$SIMTOTAL; JUDGE_LEFT=18.28; GUARD_N=20; GUARD_USD=2.20
eval "$(sed -n '/^guard() {/,/^}/p;/^claim() {/,/^}/p;/^lane() {/,/^}/p' $2)"
for i in 1 2 3 4; do lane $i > $S/lane-$i.log 2>&1 & done; wait
echo "sessions=$(find $S/sessions -name session.json | wc -l) capstop=$([ -e $S/capstop ] && echo yes || echo no) spent=$(find $S/sessions -name session.json -print0 | xargs -0 -r jq -s '[.[].cost_usd] | add // 0')"
echo "waited=$(cat $S/lane-*.log | grep -c ' waits: ')"
cat $S/lane-*.log | grep -h 'cap stop\|stops before' || true
`;

function run(cap: number, total: number): string {
  const dir = mkdtempSync(join(tmpdir(), "cso-queue-"));
  dirs.push(dir);
  const f = join(dir, "sim.sh");
  writeFileSync(f, sim);
  const r = Bun.spawnSync(["bash", f, dir, script], { env: { ...process.env, SIMCAP: String(cap), SIMTOTAL: String(total) } });
  expect(r.exitCode).toBe(0);
  return r.stdout.toString();
}

test("with room for every session, all 12 run and nothing stops", () => {
  const out = run(125, 170);
  expect(out).toContain("sessions=12 capstop=no spent=60");
});

test("a session that does not fit beside running allowances waits, and the run stops only with nothing running", () => {
  const out = run(60, 170);
  expect(out).toContain("sessions=10 capstop=yes spent=50");
  expect(out).not.toContain("waited=0");
  expect(out).toContain("room $10.00 in $60 is under the next allowance $16 with nothing running: cap stop before session 11");
});

test("a smaller cap stops earlier, at the same rule", () => {
  const out = run(45, 170);
  expect(out).toContain("sessions=6 capstop=yes spent=30");
  expect(out).toContain("cap stop before session 7");
});

test("the combined total stops the run the same way when it binds before the run's own cap", () => {
  const out = run(125, 110);
  expect(out).toContain("sessions=10 capstop=yes spent=50");
  expect(out).toContain("combined $110 check stops before session 11 with nothing running");
});
