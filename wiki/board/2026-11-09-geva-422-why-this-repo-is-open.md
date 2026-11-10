---
id: 2026-11-09-geva-422-why-this-repo-is-open
kind: decision
title: "Why this repo is open: so builders can read and reproduce our findings about whether gstack's skills help"
summary: "gstack-evals opens so builders can read and reproduce our findings on whether gstack's skills help. Held-out material and keys stay private. Says how to reproduce a finding."
author: GEVA-422
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-09
status: done
links:
  - docs/reading-this-repo.md
  - SECURITY.md
  - CONTRIBUTING.md
  - 2026-11-08-geva-404-findings-standard-takeaways-first
---

# Why this repo is open

We open gstack-evals so builders can read and reproduce our findings about whether gstack's skills help.

## Where this comes from

On 2026-11-08 the owner amended org rule R79 on openness. Private stays the default. A repo, dataset or tool opens only with a clear reason tied to the crews' goals, such as helping people who build agents or letting others reproduce a finding we publish, and that reason is stated when it opens. On 2026-11-09 the owner asked for this repo to be cleaned up for public readers and opened in place. This post states the reason, as the rule asks. The rule's full text is in the org drive at software-factory/rules.md, and this post paraphrases it.

The owner's statements in this section are paraphrases, not his exact words, because this repo does not quote the owner.

## The reason

This repo exists to find out whether gstack's skills help, on which models, and at what cost. Its findings are useful to anyone who builds with coding agents: which skills help, on which models, and which ones a frontier model no longer needs. A finding is worth more when a reader can check it. So the plans, the harness, the scorers and the results are open, and a reader can see what we fixed in advance, what ran and how we scored it.

Openness doesn't change how we report. A skill that loses to no skill, or to a placebo, is reported as plainly as one that wins.

## What is open

- The harness: the rig's code in src/, the eval lanes in lanes/, the early quick looks in quick/, and the keyless tests in tests/.
- The wiki: plans and preregistrations in wiki/plans/, findings, results and decisions in wiki/board/, and background research in wiki/research/.
- The records that results posts attach: scorer outputs, run records and the scripts that ran.
- The git history and the pull requests, including text from before the 2026-11-09 cleanup.

[docs/reading-this-repo.md](../../docs/reading-this-repo.md) explains the layout, the codes in posts, and the older clone URLs.

## What stays private

- Held-out task bodies, hidden tests and answer keys. They stay sealed outside the repo, because a model under test that sees a held-out task can learn it, and its result would stop meaning anything. The repo carries only their counts and digests, so a reader can check that the sealed set didn't change. An item that leaks is retired and recorded by its digest.
- Keys, tokens and other secrets. None enter the repo, its history, an issue or a pull request.
- Code, text and transcripts from private repos and sessions. Tasks drawn from private work are rebuilt as new code or new scenarios, never copied in.
- The crews' working drives and threads. They are the inbox, and the wiki is the record. A code such as GEVA-422 names one of those threads, which outside readers can't open.

Security problems, and any secret or held-out material found here, go privately through GitHub's private vulnerability reporting, as [SECURITY.md](../../SECURITY.md) describes, never through a public issue.

## How a reader reproduces a finding

1. Clone `https://github.com/garrytan/gstack-evals.git` and run the keyless checks: `bun install --frozen-lockfile`, `bun test`, `bun run typecheck`, `bun run errors:check` and `bun run wiki:check`. None needs a key.
2. Open the finding in wiki/board/ and the plan or preregistration it links in wiki/plans/. For a preregistered run, the git log shows that the preregistration merged before the result.
3. Follow the finding's "Replicate it" section, which says which steps run from a clone and which need more. A paid rerun needs your own provider keys and pays your own model bills. A step that needs held-out material can't run outside the crew, and the section says so. The committed digests still let you check that the sealed set we scored is the one we froze.
4. If a result doesn't reproduce, open a bug report with your repro on current main, as [CONTRIBUTING.md](../../CONTRIBUTING.md) asks.

## Changelog

- 2026-11-09: first version.
