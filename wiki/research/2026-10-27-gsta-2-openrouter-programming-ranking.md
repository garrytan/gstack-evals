---
id: 2026-10-27-gsta-2-openrouter-programming-ranking
kind: research
title: OpenRouter programming ranking snapshot, data through 2026-10-26
summary: Top models by trailing-7-day programming tokens on OpenRouter, with open-weight status. The open-weight ladder slots peg to this ranking, re-read at each preregistration.
author: GSTA-2
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-27
status: done
source: Captain drive handoffs/research/openrouter-programming-2026-10-26.md (sha256 1300867f59146528537aa67bbd56064eee8cf826e52f02024184152f613b98bd), copied by GSTA-6 on 2026-10-28
---
# OpenRouter programming ranking snapshot (read 2026-10-27)

Source: OpenRouter (openrouter.ai/collections/programming, "LLM Leaderboard for Programming Models"), trailing 7 days, usage data through 2026-10-26. Programming category is a sampled, upsampled estimate. Licensed CC BY 4.0. Token usage measures adoption, not quality.

| Rank | Model | Author | Tokens (7d, programming) | Share | Open weights? |
|---|---|---|---|---|---|
| 1 | DeepSeek V4.1 Flash | deepseek | 1.08T | 22.4% | yes (verify licence) |
| 2 | Step 5 Preview | stepfun | 526B | 11.0% | UNVERIFIED (preview) |
| 3 | GLM 5.3 Flash | z-ai | 390B | 8.1% | yes (verify licence) |
| 4 | DeepSeek V4.1 Flash (second variant, likely 1017 snapshot) | deepseek | 363B | 7.6% | same family as #1 |
| 5 | GLM 5.3 | z-ai | 256B | 5.3% | same family as #3 |
| 6 | Muse Spark 1.3 Contributor | meta | 209B | 4.3% | UNVERIFIED |
| 7 | MiMo V2.6 Flash | xiaomi | 201B | 4.2% | likely (verify) |
| 8 | MiniMax M3.1 Flash | minimax | 167B | 3.5% | likely (verify) |
| 9 | Hy4 Preview | tencent | 143B | 3.0% | UNVERIFIED (preview) |
| - | Others | - | 1.48T | 30.7% | - |

Closed models outside the programming top 9 but high overall: GPT-6 Luna, Claude Opus 5.5.

JSON source for re-reads: GET https://openrouter.ai/api/v1/datasets/rankings-daily?category=programming (needs any OpenRouter API key; 30 req/min, 500/day). Record meta.as_of with every read.
