| Comparison | Model | Measure | Scorer (186 groups) | Ours, 186 | Ours, 185 | Ours, 184 | Ours, 186, second seed | Verdict changes? |
|---|---|---|---|---|---|---|---|---|
| Router against plain | Opus 5.5 | Success, points | -2.2 to +4.3 | -2.2 to +4.2 | -2.1 to +4.2 | -2.2 to +4.3 | -2.2 to +4.2 | No: spans 0 under every mapping |
| Router against plain | Opus 5.5 | Bill, change against control | +19.8% to +40.4% | +19.9% to +40.4% | +20.1% to +40.4% | +20.0% to +40.8% | +19.9% to +40.4% | No: the bill's lower end stays near +20%, far from the 0 line, so NO SAVING holds |
| Router against plain | Opus 5.5 | Time ratio | 1.629 to 2.053 | 1.630 to 2.053 | 1.631 to 2.060 | 1.630 to 2.059 | 1.626 to 2.058 | No verdict reads it |
| Router against plain | GPT-6.1 Sol | Success, points | -1.1 to +3.3 | -1.0 to +3.3 | -1.0 to +3.2 | -1.1 to +3.3 | -1.1 to +3.3 | No: spans 0 under every mapping |
| Router against plain | GPT-6.1 Sol | Bill, change against control | +9.2% to +28.9% | +9.3% to +28.6% | +8.9% to +28.8% | +9.1% to +28.9% | +9.4% to +28.8% | No: the bill's lower end stays near +9%, far from the 0 line, so NO SAVING holds |
| Router against plain | GPT-6.1 Sol | Time ratio | 1.887 to 2.203 | 1.887 to 2.202 | 1.881 to 2.204 | 1.888 to 2.203 | 1.887 to 2.204 | No verdict reads it |
| Router against particle-1 alone | Opus 5.5 | Success, points | -2.5 to +3.3 | -2.6 to +3.3 | -2.5 to +3.2 | -2.6 to +3.3 | -2.6 to +3.2 | No: lower end far above -7.5, upper end above 0 under every mapping |
| Router against particle-1 alone | Opus 5.5 | Bill ratio | 0.885 to 1.046 | 0.888 to 1.047 | 0.887 to 1.046 | 0.887 to 1.047 | 0.889 to 1.045 | No: upper end stays above 0.90, so the router is not "cheaper" |
| Router against particle-1 alone | Opus 5.5 | Time ratio | 0.829 to 0.981 | 0.828 to 0.982 | 0.829 to 0.980 | 0.829 to 0.979 | 0.827 to 0.979 | No: upper end stays above 0.90, so the router is not "faster" |
| Router against particle-1 alone | GPT-6.1 Sol | Success, points | -4.6 to +0.4 | -4.6 to +0.4 | -4.6 to +0.3 | -4.6 to +0.4 | -4.6 to +0.4 | No, but the closest call: upper end +0.34 to +0.36 in all 66 runs (3 mappings x 22 seeds), never below 0; prints +0.3 under 185 on the first seed |
| Router against particle-1 alone | GPT-6.1 Sol | Bill ratio | 0.919 to 1.066 | 0.920 to 1.062 | 0.917 to 1.064 | 0.919 to 1.062 | 0.919 to 1.064 | No: upper end stays above 0.90, so the router is not "cheaper" |
| Router against particle-1 alone | GPT-6.1 Sol | Time ratio | 0.861 to 0.997 | 0.860 to 0.996 | 0.860 to 0.996 | 0.860 to 0.995 | 0.861 to 0.996 | No: upper end stays above 0.90, so the router is not "faster" |
| particle-1 alone against plain | Opus 5.5 | Success, points | -1.7 to +3.2 | -1.7 to +3.2 | -1.7 to +3.2 | -1.7 to +3.2 | -1.7 to +3.2 | No verdict (context line) |
| particle-1 alone against plain | Opus 5.5 | Bill, change against control | +23.1% to +46.0% | +23.1% to +46.1% | +23.5% to +46.3% | +23.6% to +46.2% | +23.5% to +46.2% | No verdict (context line) |
| particle-1 alone against plain | Opus 5.5 | Time ratio | 1.762 to 2.308 | 1.767 to 2.310 | 1.769 to 2.309 | 1.767 to 2.305 | 1.773 to 2.307 | No verdict (context line) |
| particle-1 alone against plain | GPT-6.1 Sol | Success, points | +0.7 to +5.8 | +0.7 to +5.9 | +0.8 to +5.8 | +0.8 to +5.8 | +0.7 to +5.9 | No verdict (context line) |
| particle-1 alone against plain | GPT-6.1 Sol | Bill, change against control | +9.0% to +31.2% | +8.8% to +31.1% | +8.7% to +31.4% | +8.9% to +31.2% | +8.7% to +31.4% | No verdict (context line) |
| particle-1 alone against plain | GPT-6.1 Sol | Time ratio | 2.050 to 2.360 | 2.050 to 2.359 | 2.051 to 2.361 | 2.051 to 2.357 | 2.052 to 2.362 | No verdict (context line) |

{"('desk', 'succ')": 0.0926, "('desk', 'ratio')": 0.004, "('desk', 'time')": 0.0074, "('pn', 'succ')": 0.0824, "('pn', 'ratio')": 0.0045, "('pn', 'time')": 0.0113}
