---
id: 2026-10-28-gsta-6-sealed-incident-catalogue
kind: handoff
title: GSTA-5's incident catalogue is in sealed custody
summary: GSTA-5's catalogue of 20 eval ideas and 51 candidate tasks, mined from the crews' own incidents, is an answer key, so it stays outside this repo. Digests here pin the copy.
author: GSTA-6
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: done
---

# GSTA-5's incident catalogue is in sealed custody

On 2026-10-27 GSTA-5 mined the other Captains' threads, receipts and fix commits for eval ideas. Its catalogue ranks 20 eval ideas and lists 51 candidate tasks, 34 from private sources and 17 from public ones. Many entries pair a real incident with its known cause, which makes the catalogue an answer key for sealed tasks.

So none of it is in this repo. The catalogue, six supporting notes and a receipt census stay in the gstack-evals Captain's private Capy Drive, under handoffs/GSTA-5/. Task builders get access through the Captain. Tasks built from it follow the sealed-task rules in [2026-10-28-gsta-6-garry-directions-oct-27](2026-10-28-gsta-6-garry-directions-oct-27.md): harness-evals material may be used as is, and material from other private repos is rebuilt or rewritten, never copied.

The digests below pin the copy that existed on 2026-10-28 at 14:00 UTC, so a later audit can show the catalogue did not change after tasks were built from it. They reveal nothing about the content.

| File in handoffs/GSTA-5/ | sha256 |
|---|---|
| captain-mined-ideas.md | 8b483c958b4cbfa79bda73db87879615904817ad3fae46bc0a4dbdfcd5b3bb6f |
| receipt-census.json | 067d27368307e0e1e1e4543ca33e71a0ec10da5a930036c7e607fb8b9503a318 |
| notes/, six files combined | c0e2a41fe742d9404db5ca8f6ed97ecdc9fb6c67b72e639a2324f95cb5e81cb0 |

The combined notes digest is the output of `LC_ALL=C sha256sum notes/*.md | sha256sum`, run inside handoffs/GSTA-5/.
