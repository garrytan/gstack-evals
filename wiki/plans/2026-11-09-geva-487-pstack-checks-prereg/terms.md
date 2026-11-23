# Outside terms read at freeze (2026-11-09)

Read on 2026-11-09 from the public pages below, searched for clauses on benchmarking, evaluating or comparing the service and on publishing results. Short quotes only.

| Source | Page | What it says that bears on this eval |
|---|---|---|
| OpenAI, for GPT-6.1 Sol | https://openai.com/policies/services-agreement/ | Use restriction (e): customers may not "use Output to develop artificial intelligence models that compete with OpenAI's products and services". No clause on benchmarking or publishing results in the text read. Only the first 10,000 characters could be read keylessly; the page refused a plain fetch. |
| OpenRouter, the route for particle-1 | https://openrouter.ai/terms (last updated 2026-08-31) | No clause on benchmarking or publishing results. The licence it takes to user content is "solely in connection with operating and providing the Service". |
| Particle, which makes particle-1 | https://particle.ai/legal/terms | No clause on benchmarking or publishing results. |
| Anthropic, for Opus 5.5 | https://www.anthropic.com/legal/commercial-terms | D.4 use restrictions: no access "to build a competing product or service, including to train competing AI models". No clause on benchmarking or publishing results. |
| Claude Code, driving every model | https://code.claude.com/docs/en/legal-and-compliance (modified 2026-10-30) | Running Claude Code in other infrastructure needs the Commercial Terms and "The Claude Code binary must not be modified"; this eval runs the pinned binary as published. No clause on benchmarking, on publishing results, or against pointing it at other models through a proxy. |

None of these bars this eval, which trains nothing and publishes rates and task ids. Before the first Sol call the run reads OpenAI's Services Agreement and Service Terms in full; a clause that bars this use stops the Sol part before it spends and comes to the Captain.
