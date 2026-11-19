# Stage 2 replay, held items

band.json sha256 ae18c66808c99b6690b83527dc8801376ca1e84b92799a56a1f1fe4bdb0e0472; items sha256 5eb0ec46708907a3b50d224ca662e99f5197d5c7f0d5ac5100c0d7ad365316ea

## route

kappa 0.188, under 0.6: NO READ; 355 kept, 45 dropped (labelers disagreed); 179 dev, 176 held
band 0.47 to 0.72: dev balanced accuracy 0.849 at escalation 0.240, particle-1 alone 0.887; no band came within 1 point, so the best one stands

| backend | balanced accuracy | precision | recall | false rate | ECE | Brier | escalation | median ms | cost per 1,000 | tokens |
|---|---|---|---|---|---|---|---|---|---|---|
| Jev alone | 0.457 | n/a | n/a | n/a | 0.387 | 0.384 | 0.000 | 83.000 | $0.045 | 193851 |
| Jev cascade | 0.710 | n/a | n/a | n/a | 0.385 | 0.382 | 0.239 | 94.500 | $0.164 | 247428 |
| particle-1 alone | 0.753 | n/a | n/a | n/a | 0.307 | 0.267 | 0.000 | 3480.500 | $0.482 | 239521 |
| gstack deterministic | 0.376 | n/a | n/a | n/a | 0.256 | 0.256 | 0.000 | 28.000 | $0.000 | 0 |

balanced accuracy, Jev cascade minus gstack deterministic: 0.333, 95% [-0.375, 0.376] clustered by task
balanced accuracy, particle-1 alone minus gstack deterministic: 0.376, 95% [-0.284, 0.419] clustered by task
balanced accuracy, Jev alone minus gstack deterministic: 0.080, 95% [-0.381, 0.359] clustered by task
balanced accuracy, Jev cascade minus particle-1 alone: -0.043, 95% [-0.114, -0.011] clustered by task

## done

labels from the hidden tests; 480 kept, 0 dropped (labelers disagreed); 228 dev, 252 held
band none: dev balanced accuracy 0.539 at escalation 0.000, particle-1 alone 0.536

| backend | balanced accuracy | precision | recall | false rate | ECE | Brier | escalation | median ms | cost per 1,000 | tokens |
|---|---|---|---|---|---|---|---|---|---|---|
| Jev alone | 0.510 | 0.397 | 0.242 | 0.223 | 0.296 | 0.345 | 0.000 | 55.000 | $0.024 | 144526 |
| Jev cascade | 0.510 | 0.397 | 0.242 | 0.223 | 0.296 | 0.345 | 0.000 | 55.000 | $0.024 | 144526 |
| particle-1 alone | 0.456 | 0.318 | 0.295 | 0.382 | 0.450 | 0.450 | 0.000 | 1355.500 | $0.216 | 167880 |
| gstack deterministic | 0.424 | 0.315 | 0.484 | 0.637 | 0.591 | 0.591 | 0.000 | 0.000 | $0.000 | 0 |

balanced accuracy, Jev cascade minus gstack deterministic: 0.086, 95% [-0.017, 0.186] clustered by task
balanced accuracy, particle-1 alone minus gstack deterministic: 0.033, 95% [-0.055, 0.115] clustered by task
balanced accuracy, Jev alone minus gstack deterministic: 0.086, 95% [-0.017, 0.186] clustered by task
balanced accuracy, Jev cascade minus particle-1 alone: 0.053, 95% [0.010, 0.095] clustered by task
admission: NOT BEATEN

## risky

kappa 0.778; 558 kept, 42 dropped (labelers disagreed); 282 dev, 276 held
band none: dev balanced accuracy 0.919 at escalation 0.000, particle-1 alone 0.922

| backend | balanced accuracy | precision | recall | false rate | ECE | Brier | escalation | median ms | cost per 1,000 | tokens |
|---|---|---|---|---|---|---|---|---|---|---|
| Jev alone | 0.960 | 0.655 | 1.000 | 0.079 | 0.107 | 0.049 | 0.000 | 54.000 | $0.011 | 75038 |
| Jev cascade | 0.960 | 0.655 | 1.000 | 0.079 | 0.107 | 0.049 | 0.000 | 54.000 | $0.011 | 75038 |
| particle-1 alone | 0.940 | 0.554 | 1.000 | 0.121 | 0.108 | 0.081 | 0.000 | 1022.500 | $0.141 | 86490 |
| gstack deterministic | 0.639 | 1.000 | 0.278 | 0.000 | 0.094 | 0.094 | 0.000 | 82.500 | $0.000 | 0 |

balanced accuracy, Jev cascade minus gstack deterministic: 0.322, 95% [0.243, 0.395] clustered by task
balanced accuracy, particle-1 alone minus gstack deterministic: 0.301, 95% [0.217, 0.376] clustered by task
balanced accuracy, Jev alone minus gstack deterministic: 0.322, 95% [0.243, 0.395] clustered by task
balanced accuracy, Jev cascade minus particle-1 alone: 0.021, 95% [0.002, 0.040] clustered by task
admission: ADMITTED

