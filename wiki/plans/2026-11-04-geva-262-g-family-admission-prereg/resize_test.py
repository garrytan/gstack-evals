#!/usr/bin/env python3
# resize_test.py: keyless checks of resize.py's survivor order (GEVA-262, GST-1309), written before the /ship pass 1 fix.
# Run from this folder: python3 resize_test.py. Needs only Python 3 and plan v3's merged bundle beside this one.
import hashlib, os, re, subprocess, sys, unittest
D = os.path.dirname(os.path.abspath(__file__))
HOUSE_SHA = "748edeac960a2923f56f5a7d31c3865bec8b10ae4d65917523ca8ad5ddb0d8e1"
CLEAN = {k: v for k, v in os.environ.items() if k not in ("MULT", "M_PER", "M_AP", "AUTH_PAID", "AUTH_EXTRA", "YIELD_G", "TOLD_SCALE")}

def run(**env):
    p = subprocess.run([sys.executable, os.path.join(D, "resize.py")], env=dict(CLEAN, **env), capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr

def block(out, name):
    return [b for b in out.split("== ") if b.startswith(name)][0]

def runs_alone(out, s, other, start):
    return re.search(r"%s alone \(%s stops at admission\): M1 ladder \[%s [^\]]*\] -> runs " % (s, other, start), out)

class SurvivorOrder(unittest.TestCase):
    def test_bound_failure_climbs_to_the_planned_size(self):
        code, out, _ = run(MULT="5", M_PER="2.2", M_AP="10")
        self.assertEqual(code, 0)
        self.assertIn("past the 20-point bound with both alive: plan-eng-review, autoplan; autoplan stops at admission item 5 and plan-eng-review re-sizes alone", out)
        self.assertTrue(runs_alone(out, "plan-eng-review", "autoplan", "60x3"), out)

    def test_no_joint_design_still_gives_plan_eng_review_alone(self):
        code, out, _ = run(MULT="5", M_PER="2.2", M_AP="30", AUTH_PAID="1.39", AUTH_EXTRA="1.2")
        self.assertEqual(code, 0)
        self.assertIn("no both-alive G design fits the $1,700 line: autoplan stops at admission item 5 and plan-eng-review re-sizes alone", out)
        self.assertTrue(runs_alone(out, "plan-eng-review", "autoplan", "60x3"), out)

    def test_autoplan_gets_its_ladder_when_plan_eng_review_cannot_run(self):
        code, out, _ = run(MULT="5", M_PER="30", M_AP="2.2")
        self.assertEqual(code, 0)
        self.assertIn("plan-eng-review finds no alone design and stops; autoplan re-sizes alone", out)
        self.assertTrue(runs_alone(out, "autoplan", "plan-eng-review", "54x3"), out)

    def test_neither_fits_stops_both(self):
        code, out, _ = run(MULT="5", M_PER="30", M_AP="30")
        self.assertEqual(code, 0)
        self.assertIn("no both-alive G design fits the $1,700 line: neither finds an alone design: both skills stop at admission as FIX-METHOD (price)", out)
        self.assertNotIn("-> runs", out)
        code, out, _ = run()
        self.assertIn("past the 20-point bound with both alive: plan-eng-review, autoplan; neither finds an alone design: both skills stop at admission as FIX-METHOD (price)", block(out, "high, 10 times"))

    def test_house_prices_unchanged(self):
        code, out, _ = run()
        self.assertEqual(code, 0)
        self.assertEqual(hashlib.sha256(("== " + block(out, "house central (plan v3)")).encode()).hexdigest(), HOUSE_SHA)

class MeteredInputs(unittest.TestCase):
    def test_requires_mult(self):
        code, _, err = run(M_PER="2.2", M_AP="5")
        self.assertNotEqual(code, 0)
        self.assertIn("MULT", err)

    def test_refuses_frozen_and_planning_inputs(self):
        for k, v in (("YIELD_G", "0.3"), ("TOLD_SCALE", "1.15")):
            code, _, err = run(MULT="5", **{k: v})
            self.assertNotEqual(code, 0, k)
            self.assertIn(k, err)

    def test_g_inputs_leave_u_and_x_at_house_prices(self):
        def u_and_x(out):
            m = re.search(r"autoplan \d+x\d+ MDD [\d.]+ \$(\d+); wave 1 plans \$(\d+) at these prices", out)
            g = re.search(r"plan-eng-review \d+x\d+ MDD [\d.]+ \$(\d+);", out)
            return int(m.group(2)) - int(m.group(1)) - int(g.group(1))
        _, metered, _ = run(MULT="10")
        _, cases, _ = run()
        self.assertEqual(u_and_x(metered), u_and_x(block(cases, "house central (plan v3)")))
        self.assertNotEqual(u_and_x(block(cases, "high, 10 times")), u_and_x(block(cases, "house central (plan v3)")))

if __name__ == "__main__":
    unittest.main(verbosity=2)
