# Free supply count for the pstack generated-checks eval (2026-11-09)

Counts only. No model calls. Read from the published Hugging Face parquet files of each dataset on 2026-11-09 with supply-count.py, attached beside this file. "Bug-like" and "state keywords" are the state machines eval's keyword screens (its supply-count.py, unchanged): bug words in the issue text and not a feature request, a fix that changes 1 to 6 files, a container, at least one fail-to-pass and one pass-to-pass test, then state words (stale, stuck, already closed, after cancel, retry, lifecycle, pending, race and similar) in the issue text or the fix. Both screens are rough. The eligibility labels come from two cross-family labellers at draw time, and the keyword count is only a supply estimate.

## The pool this eval draws from: SWE-bench-Live MultiLang

The state machines harness converts only MultiLang at this build's pin, so these are the counts that matter.

| Window start | State-keyword candidates | At 3 a repository | Repositories |
|---|---|---|---|
| 2026-07-01 | 34 | 29 | 18 |
| 2026-03-01 | 76 | 66 | 48 |
| 2025-01-01 | 107 | 95 | 70 |

- By month from 2025-01-01 (before the cap): 2025-05 1, 2025-06 5, 2025-07 12, 2025-08 13, 2026-03 10, 2026-04 19, 2026-05 3, 2026-06 10, 2026-07 34. MultiLang has no state-keyword candidates from September 2025 to February 2026.
- By language from 2025-01-01: C 19, Java 16, Rust 16, Go 13, JS 12, C++ 11, C# 11, TS 9.

## The wider count the gate saw

With SWE-bench-Live's Python set and the SWE-rebench leaderboard added, the same screens find 179 candidates at 3 a repository from 2025-01-01 (195 before the cap, 137 repositories), 74 from 2026-03-01 and 29 from 2026-07-01. The gate's supply decision used these figures. Python units are out of this eval because the harness does not convert those sources, so the MultiLang rows above are the supply.

## What this means for the plan

- About 95 keyword candidates at 3 a repository. The labels, the oracle, the told-mode screen and the neutral validation each drop some, and the 8 admission units come out of the same pool, so about 25 to 30 test units is the planning figure.
- July 2026 (after both frontier models' cutoffs) gives at most 29, so it fills first and is reported as its own stratum, beside March to June 2026 and the 2025 units.
