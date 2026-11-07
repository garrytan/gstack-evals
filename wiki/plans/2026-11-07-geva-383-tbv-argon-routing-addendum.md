---
id: 2026-11-07-geva-383-tbv-argon-routing-addendum
kind: plan
title: "Trust-but-verify Argon routing addendum: max_price.image from the price row, error bodies in the journal, and the re-pinned build"
summary: "Argon's sends got 404 because the proxy sent max_price.image 0. The row now carries its endpoint's image price, the proxy journals error bodies, and B2 resumes on this build."
author: GEVA-383
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-07
status: open
links:
  - 2026-11-07-geva-379-tbv-mine-b-addendum
  - 2026-11-06-geva-361-tbv-split-addendum
  - 2026-11-06-geva-363-tbv-rebuild-pins-addendum
  - 2026-11-06-geva-356-tbv-pins-addendum
  - 2026-11-05-geva-313-trust-but-verify-prereg
  - garrytan/gstack-evals#255
  - garrytan/gstack-evals#261
---

# Trust-but-verify Argon routing addendum

B2 restarted on the mine-b addendum's build (13d7db19) and reached keys round 1. Its first send to the key writer, Gemini 4 Argon on OpenRouter, came back HTTP 404 with $0 spent. A relaunch under the same run id got the same 404 on its first send, again with $0 spent and both leases settled. The proxy's journal kept only the status, so the run could not say why.

The cause is the routing the proxy adds to every OpenRouter call. It sent max_price.image as 0, and every Argon endpoint lists a nonzero image price. OpenRouter's max-price filter then keeps no endpoint and answers 404. A two-call probe proved it (section 3).

This post pins the build that fixes it. It adds no rule. It changes no cap, arm, model, judge, threshold, MDD row, split count or custody rule. The probe spent $0.00007326 of its $1 cap.

## 1. The build

- **Build commit:** the squash merge of this post's PR. On main, `git log -1 --format=%H --diff-filter=A -- wiki/plans/2026-11-07-geva-383-tbv-argon-routing-addendum.md` prints it.
- **What changed from 13d7db19:** src/runner/pricing/prices.ts (the Argon row and openRouterRouting), src/runner/proxy/metering-proxy.ts (the journal), tests/proxy/metering-proxy.test.ts, docs/adapters.md and this post. Nothing under lanes/tbv changed. The one commit on main between the two (5a01538, L1 Amendment F) touched only quick/laneb and its own wiki post.
- **The build check.** The run brief's check becomes `git diff --stat 13d7db19 <build> -- lanes/tbv src bin package.json bun.lock`, which lists only src/runner/pricing/prices.ts and src/runner/proxy/metering-proxy.ts. The mine-b addendum's check, `git diff --stat 787e0e3 <build> -- lanes/tbv`, still lists only README.md and history/source-b.ts. Any other file in either list means another change reached the build, and that goes to the Captain.
- Every file under lanes/tbv is byte-identical to 13d7db19, so the pin post's captures, digests, overheads, caps output and dry run stand, and so do the split, rebuild and mine-b addenda's pins.

## 2. The change

- **max_price.image.** A price row may now carry `image`: the image price its pinned endpoint lists on OpenRouter's endpoints API. openRouterRouting sends it as max_price.image, and 0 for a row that lists none. Only the Argon row has one: 0.000002, google-vertex/global's listed image price. Its prompt and completion caps stay $2 and $10, so google-vertex/us ($2.20 and $11) and the priority endpoints still fall outside max_price.
- **Every other row sends the same bytes.** particle-1, DeepSeek V4.1 Flash and GPT-6.1 Sol list no image price and send the same routing bytes as before, key order included.
- **Money.** The reservation does not read the image price. It still bounds input at one token per byte of the outgoing body, which grows by 7 bytes on an Argon call (`"image":0.000002` in place of `"image":0`). The tbv drive's 2,048-byte allowance for what the proxy adds covers that. The tbv key writer sends text only. A call that carried inline images could be billed at the image price, and settlement already records the larger of the row's token cost and the cost OpenRouter reports.
- **Error bodies in the journal.** On any non-2xx answer, paid or free, the proxy now journals a fixed allow-list of the answer's error fields with the call, as `upstream_body` on its outcome or free line: error.code, error.type, error.metadata.failed_routing_step and error.metadata.provider_name, plus only the byte lengths of error.message and error.metadata.raw. Everything else is dropped, the message, raw and the routing funnel included, so no free-text field is journaled: a prompt quoted in a message or in raw can be escaped once, twice or as \uXXXX, or cut, and slip past the echo check. Each kept string has the proxy's keys redacted and is cut to 512 characters, and the whole stays within 4,096 bytes. A kept string that repeats 24 or more characters of any string in the request, other than the model id, is replaced by a note of its size. A body that is not a JSON object, an array included, is kept only as a note of its size. A 2xx answer journals nothing new. The journal's readers (tbv's drive, review-replay, the local ledger's release check, the review cost reader and reconcile) read named fields only, so the new field changes none of them.

## 3. The probe

Two of the four allowed calls ran on 2026-11-07, straight to OpenRouter's chat completions route with the crew's OpenRouter key, outside the proxy and the ledger. Each sent the body the proxy builds for Argon (openRouterRouting on the Argon row at 5a01538), max_tokens 1 and the public one-word prompt "Hello". Only max_price.image differed.

| Call | Time (UTC) | max_price.image | Status | Answer |
|---|---|---|---|---|
| 1 | 07:27:45 | 0, as the proxy sent it | 404 | "No endpoints found that satisfy the max price for this request", failed_routing_step "Filter by Max Price"; routing funnel 6 initial endpoints, 5 after the regional surcharge filter, 2 after the tier filter |
| 2 | 07:27:49 | 0.000002, google-vertex/global's listed price | 200 | provider Google, 32 prompt tokens and 1 completion token, finish_reason length, cost $0.00007326 |

Free reads at the same time: OpenRouter's endpoints API listed six Argon endpoints, all at status 0, each with an image price equal to its prompt price per token; google-vertex/global listed $2 and $10 with image 0.000002. The generation record for call 2 names provider Google and model google/gemini-4-argon-20261013. Its upstream inference cost, $0.000074, is 32 tokens at $2 and 1 token at $10 per million, the global endpoint's prices, not google-vertex/us's.

## 4. Tests

tests/proxy/metering-proxy.test.ts gains eighteen tests: the build's eight, then ten from the /ship review.

- Argon's routing carries max_price.image 0.000002, in openRouterRouting's bytes and in the proxy's outgoing body.
- Every OpenRouter row but Argon lists no image price and sends the routing bytes main sent at 5a01538: literal strings for particle-1, DeepSeek and Sol, the proxy's whole outgoing body on the chat route and on Sol's Messages route, and synthetic rows of every shape against main's formula.
- The journal keeps a 4xx answer's allow-listed error fields (today's 404 keeps its code, failed routing step and the message's byte length, never its text), each 5xx attempt's own fields and nothing for a 2xx answer, only the size of a body that is not a JSON object, the keys redacted, and a free route's non-2xx fields. It withholds a kept field that repeats the prompt, escaped or not, and keeps one that names the model.

At 5a01538, the Argon test and the six journal tests failed, and the byte-identity test passed, as it should. Eight mutations of the fix each failed at least one test: max_price.image back to 0, no echo check, no redaction, no byte cut, any JSON value kept, the model id not exempt, and no body journaled on the paid or the free path.

The review's ten tests each failed first. An array body, a cut through a multibyte character and an error body too deep to serialize again failed at 4671f70d. A prompt quoted inside metadata.raw failed at 4943a51e in three forms, code with a newline every few characters, CJK text escaped as \uXXXX and a raw cut off mid-string, each leaving prompt text in the journal file. A prompt quoted inside error.message failed at eb9cad15 in four forms, CJK text escaped as \uXXXX, code escaped twice, code Go escapes as \u003c and an echo the 512-character cut would split, each leaving prompt text in the journal file.

## 5. What B2 does next

B2 resumes from its sealed state on this build, as the run's handoff gives it. It runs the build check in section 1 first. Everything else in the split, rebuild and mine-b addenda and the pin posts stands. A non-2xx answer in keys now lands in the journal with its error JSON.

## 6. Not done here

- No ledger lease was opened and no held-out material was read. The probe's two calls are the only paid calls, and they sent a public one-word prompt.
- Preflight 6 checks that the endpoint is up, not that the proxy's routing can reach it. A one-token routing probe in the preflights would have caught this before keys. Adding one is a separate change for the Captain.
- The journal's echo check does not catch a quoted run shorter than 24 characters.
