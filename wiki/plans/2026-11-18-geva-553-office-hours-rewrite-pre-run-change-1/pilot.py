# Authoring pilot sizing for the office-hours rewrite eval (pre-run change, run checklist item 4).
# Plain Python 3, no packages. Inputs are the frozen plan's planning figures (cost.py) and its authoring cap.
import math

DRAW_USD = 129.19 / 124
PASS = 96 / 124
PAIRS, UNPAIRED = 34, 42
CAP, ALLOWANCE = 251, 3.50
Z = 1.6448536269514722  # two-sided 90% Wilson, so each bound is one-sided 95%

def line(draw_usd, first_pass):
    room = (CAP - ALLOWANCE) / draw_usd - (PAIRS + UNPAIRED) / first_pass
    return PAIRS / room if room > 0 else None


fixed_draws = PAIRS / PASS + UNPAIRED / PASS
max_twin_draws = (CAP - ALLOWANCE) / DRAW_USD - fixed_draws
THRESHOLD = line(DRAW_USD, PASS)


def cost(y):
    return (fixed_draws + PAIRS / y) * DRAW_USD


def wilson(k, n):
    p = k / n
    d = 1 + Z * Z / n
    c = (p + Z * Z / (2 * n)) / d
    h = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d
    return c - h, c + h


def pmf(k, n, p):
    return math.comb(n, k) * p ** k * (1 - p) ** (n - k)


def read(k, n):
    lo, hi = wilson(k, n)
    if lo >= THRESHOLD:
        return "go"
    if hi < THRESHOLD:
        return "stop"
    return "open"


print(f"draws outside second twins: {fixed_draws:.1f}; second-twin draws the cap admits: {max_twin_draws:.1f}")
print(f"yield threshold: {THRESHOLD:.3f} (cost at the threshold {cost(THRESHOLD):.2f}, cap less one allowance {CAP - ALLOWANCE:.2f})")
print(f"authoring cost at yields 0.30, 0.44, 0.50: {cost(0.30):.2f}, {cost(0.44):.2f}, {cost(0.50):.2f}")
print(f"line at a measured 1.04 a draw and a first-pass rate of 0.30: {line(1.04, 0.30)} (None: the cap is used up before any second twin, so authoring stops)")
print()
print("A. One read after n second-twin draws: share of runs reading go (lower bound at or above the threshold) and stop (upper bound below it)")
YIELDS = [0.10, 0.15, 0.20, 0.24, 0.30, 0.35, 0.44, 0.50]
print("n    " + "  ".join(f"y={y:.2f} go/stop" for y in YIELDS))
for n in [4, 8, 12, 16, 24, 32, 48]:
    cells = []
    for y in YIELDS:
        go = sum(pmf(k, n, y) for k in range(n + 1) if read(k, n) == "go")
        st = sum(pmf(k, n, y) for k in range(n + 1) if read(k, n) == "stop")
        cells.append(f"{go:5.3f}/{st:5.3f}  ")
    print(f"{n:<4d} " + "  ".join(cells))
print()
print("Wilson bounds at n = 4: 0/4 upper", f"{wilson(0, 4)[1]:.3f};", "4/4 lower", f"{wilson(4, 4)[0]:.3f}")
print()
N1, N2 = 16, 32
print(f"B. Frozen two-step pilot: read after {N1} second-twin draws; if open, draw to {N2} and read once more; still open goes to the Captain. The line is held at its planning value {THRESHOLD:.3f}")
print("yield  go     stop   Captain(open)  mean second-twin draws in the pilot")
for y in YIELDS:
    go = st = op = 0.0
    draws = 0.0
    for k1 in range(N1 + 1):
        p1 = pmf(k1, N1, y)
        r1 = read(k1, N1)
        if r1 == "go":
            go += p1; draws += p1 * N1
        elif r1 == "stop":
            st += p1; draws += p1 * N1
        else:
            for k2 in range(N2 - N1 + 1):
                p2 = p1 * pmf(k2, N2 - N1, y)
                r2 = read(k1 + k2, N2)
                draws += p2 * N2
                if r2 == "go":
                    go += p2
                elif r2 == "stop":
                    st += p2
                else:
                    op += p2
    print(f"{y:.2f}   {go:.3f}  {st:.3f}  {op:.3f}          {draws:.1f}")
