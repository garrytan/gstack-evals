
# price3.py: plan-v3 caps after gate 2 (F1/U1 one item per stratum, H1 route sizing, two-turn protocol per GSTA-2's GST-925 ruling)
v2 = {"none": 2.13/16, "gstack": 5.25/16, "forced": 9.17/16}
op = {k: round(v*2.5, 2) for k, v in v2.items()}; op["lens"] = op["none"]; op["auto"] = 6.00
sol = dict(op); pt = {k: round(v*0.25, 4) for k, v in op.items()}; pt["auto"] = 1.50
t2 = {"opus": 0.15, "sol": 0.15, "pt": 0.0375}; t2a = {"opus": 0.30, "sol": 0.30, "pt": 0.075}
allow = {"opus": 7.04, "sol": 3.84, "pt": 0.192, "opus_auto": 24.0, "sol_auto": 12.0, "pt_auto": 0.70}
S = 4
rows = []
def item(exp, name, n, proj, batch, a, worst=False, J=None, k=1):
    if J is not None: rows.append((exp, name, k, n, round(proj,2), "-", round(1.4*proj,2))); return
    per_n = n / k; per_p = proj / k
    c = round(per_n*a, 2) if worst else round(1.4*per_p + batch*a, 2)
    rows.append((exp, name, k, n, round(proj,2), round(batch*a,2), round(k*c,2)))
item("E0","e0-opus-none",48,48*op["none"],3,allow["opus"]); item("E0","e0-particle-none",48,48*pt["none"],3,allow["pt"]); item("E0","e0-judge",96,96*0.10,0,0,J=1)
for m,d,a,aa,tt,ta in [("opus",op,allow["opus"],allow["opus_auto"],t2["opus"],t2a["opus"])]:
    item("E1 b1",f"e1-{m}-none-<stratum>",64,64*(d["none"]+tt),3,a,k=S)
    item("E1 b1",f"e1-{m}-skill-<stratum>",64,32*(d["gstack"]+d["forced"]+2*tt),3,a,k=S)
    item("E1 b1",f"e1-auto-{m}-<stratum>",16,16*(d["auto"]+ta),2,aa,worst=True,k=S)
item("E1 b1","e1-route-sol",4,4*0.5,1,allow["sol"],worst=True); item("E1 b1","e1-route-particle",4,4*0.1,1,allow["pt"],worst=True)
item("E1 b1","e1-judge-b1",144,144*0.15,0,0,J=1)
for m,d,a,aa,tt,ta in [("sol",sol,allow["sol"],allow["sol_auto"],t2["sol"],t2a["sol"]),("particle",pt,allow["pt"],allow["pt_auto"],t2["pt"],t2a["pt"])]:
    item("E1 b2",f"e1-{m}-none-<stratum>",64,64*(d["none"]+tt),3,a,k=S)
    item("E1 b2",f"e1-{m}-skill-<stratum>",64,32*(d["gstack"]+d["forced"]+2*tt),3,a,k=S)
    item("E1 b2",f"e1-auto-{m}-<stratum>",8,8*(d["auto"]+ta),2,aa,worst=True,k=S)
item("E1 b2","e1-judge-b2",272,272*0.15,0,0,J=1)
u=52
for m,d,a,tt in [("opus",op,allow["opus"],t2["opus"]),("sol",sol,allow["sol"],t2["sol"]),("particle",pt,allow["pt"],t2["pt"])]:
    item("C/stratum",f"c-{m}",u*4,u*(d["none"]+d["lens"]+d["gstack"]+d["forced"]+4*tt),4,a)
item("C/stratum","c-judge",624,624*0.15,0,0,J=1)
for m,d,a,an,tt,ta in [("opus",op,allow["opus_auto"],allow["opus"],t2["opus"],t2a["opus"]),("sol",sol,allow["sol_auto"],allow["sol"],t2["sol"],t2a["sol"]),("particle",pt,allow["pt_auto"],allow["pt"],t2["pt"],t2a["pt"])]:
    item("C/autoplan",f"c-auto-{m}-<stratum>",64,64*(d["auto"]+ta),2,a,k=S)
    item("C/autoplan",f"c-ladder-{m}-<stratum> (placeholder k=6)",256,256*(d["none"]+tt),3,an,k=S)
item("C/autoplan","c-auto-judge",960,960*0.10,0,0,J=1)
tot={}
print("| Stage | Item | Runs | Sessions | Projected | Reserve per run | Cap |")
print("|---|---|---|---|---|---|---|")
for r in rows:
    print("| " + " | ".join(str(x) for x in r) + " |")
    t=tot.setdefault(r[0],[0,0,0]); t[0]+=r[3]; t[1]+=r[4]; t[2]+=r[6]
for k,v in tot.items(): print("TOTAL",k,v[0],round(v[1],2),round(v[2],2))
cs=tot["C/stratum"]; ca=tot["C/autoplan"]
print("E1 total", round(tot["E1 b1"][1]+tot["E1 b2"][1],2), round(tot["E1 b1"][2]+tot["E1 b2"][2],2))
print("program", round(tot["E0"][1]+tot["E1 b1"][1]+tot["E1 b2"][1]+4*cs[1]+ca[1],2), round(tot["E0"][2]+tot["E1 b1"][2]+tot["E1 b2"][2]+4*cs[2]+ca[2],2))
