# headroom.py: recomputes section 7's Fable drop line per bug, one-sided, from Harness Evals' per-pass stage 1 CSV (set HARN154_CSV to its path).
import csv, collections
from math import comb
def upper_tail(k,n,p): return sum(comb(n,i)*p**i*(1-p)**(n-i) for i in range(k,n+1))
def cp_lower(k,n,a=0.05):
    if k==0: return 0.0
    lo,hi=0.0,k/n
    for _ in range(200):
        mid=(lo+hi)/2
        if upper_tail(k,n,mid)<a: lo=mid
        else: hi=mid
    return (lo+hi)/2
import hashlib, os, sys
SRC=os.environ.get("HARN154_CSV") or sys.exit("set HARN154_CSV to the stage 1 per-pass CSV")
print("source sha256", hashlib.sha256(open(SRC,"rb").read()).hexdigest())
passes=collections.defaultdict(list)
for r in csv.DictReader(open(SRC)):
    if r["stratum"]=="outside_bug" and r["arm"]=="gstack_review":
        passes[r["unit_id"]].append(int(r["named_any_severity"])/int(r["n_planted"]))
n=len(passes); assert all(len(v)==2 for v in passes.values())
k=sum(1 for v in passes.values() if sum(v)/len(v)>=0.5)
lb=cp_lower(k,n)
head=1-lb
print(f"units {n} caught {k} rate {k/n:.4f}")
print(f"one-sided 95% Clopper-Pearson lower bound {lb:.4f}; headroom, all-P set {head:.4f}")
gap=25*head
print(f"break-even cost gap per review at $25 a catch: ${gap:.2f}")
for name,c in (("Sol voice: OS $6.50 vs FS",6.50),("Astra voice: OA $11.00 vs FA",11.00)):
    print(f"{name}: Fable leaves when its cell costs {1+gap/c:.2f}x the Opus cell or more")
