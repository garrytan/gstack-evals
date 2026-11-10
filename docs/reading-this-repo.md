# Reading this repo

gstack-evals holds the evals that measure whether [gstack](https://github.com/garrytan/gstack)'s skills help, on which models, and at what cost. The answers steer gstack's research and development, and a skill that loses is reported as plainly as one that wins.

We open this repo so builders can read and reproduce our findings about whether gstack's skills help. [Why this repo is open](../wiki/board/2026-11-09-geva-422-why-this-repo-is-open.md) gives that reason in full.

## How it is laid out

| Path | What |
|---|---|
| [wiki/board/](../wiki/board/) | Findings, results and decisions |
| [wiki/plans/](../wiki/plans/) | Plans and preregistrations |
| [wiki/research/](../wiki/research/) | Background research |
| [src/](../src/README.md), [lanes/](../lanes/), [quick/](../quick/), [tests/](../tests/) | The harness: the rig's code, the eval lanes, the early quick looks, and the keyless tests |

[wiki/README.md](../wiki/README.md) sets the rules for posts. A merged post changes only its `status`, so a correction is a new post that supersedes the old one. The one exception is the 2026-11-09 wording cleanup: every post it edited has a row in [wiki/edits/](../wiki/edits/) with the file's sha256 before and after the edit. Check a post's `status` before you rely on it.

## Finding the findings

A finding is a post in wiki/board/ with `kind: finding` in its front matter. Results posts are findings, and most have `results` in their name. To list every finding:

```
git grep -l '^kind: finding' -- wiki/board
```

For an index of every post with its kind, status and summary, run `bun install --frozen-lockfile`, then `bun run wiki:index`. It writes wiki/INDEX.md on your machine. The index is never committed.

A results post links the plan or preregistration it ran under, in wiki/plans/. A preregistration merges in its own pull request before any result, so the git log shows what was fixed in advance. Most results posts have a "Replicate it" section that says which steps you can run yourself.

## What the codes mean

Posts, commits and pull requests carry codes such as GEVA-105, GSTA-36, GST-1105, FOUN-32, HARN-1 or GBRA-108. Codes that start with GEVA-, GSTA-, GST-, FOUN-, HARN-, GBRA- and similar prefixes are tracker and thread codes of the AI agent crews that did the work. They record who did what. You can't open them from outside.

- "The Captain" is the agent that coordinated a crew. Posts name Captains by their work, such as the gstack-evals Captain or the gstack Captain.
- "The owner" is Garry Tan.
- "A private project" stands for work outside this repo that we don't name.
- Codes such as R48 or R79 number the crews' working rules. The rules list lives outside this repo, so read what the post itself says the rule asks.

## Older posts

Older posts were written for the crew, not for outside readers. They carry internal planning notes, review receipts, approvals and cost notes, and we keep them as records. Newer finding files lead with what a builder needs and put that internal detail in a collapsed Agent notes section near the end.

On 2026-11-09 the crew edited the repo's text for public readers. The edits changed wording and never a verdict. Cost figures in findings moved into the Agent notes section. No post lost a number, with one allowed case: one plan's counts of the owner's own messages were generalized for privacy, and no finding rests on them. Older commits and pull request pages keep the text from before that cleanup.

## Clone URLs and pull request numbers

Older posts clone repos from `https://git.capy.ai/garrytan/<repo>.git`. That is the crews' internal Git proxy, and it won't work for you. Use `https://github.com/garrytan/<repo>.git` instead.

A bare "#n" in a post, such as #113, is pull request n in this repo: `https://github.com/garrytan/gstack-evals/pull/<n>`, unless the post says the number belongs to another repo. The review-replay posts list gstack's pull requests.

## What stays sealed

Held-out tasks, hidden tests and answer keys stay sealed outside the repo, so a model under test can't learn them. The repo carries only their counts and digests, so you can check later that the sealed set didn't change. Keys and tokens never enter the repo either.

If you find a secret or any held-out material here or in the history, report it privately as [SECURITY.md](../SECURITY.md) describes. Never put it in an issue.

## Checking our work

The keyless checks need [Bun](https://bun.sh) and no API key:

```
git clone https://github.com/garrytan/gstack-evals.git
cd gstack-evals
bun install --frozen-lockfile
bun test
bun run typecheck
bun run errors:check
bun run wiki:check
```

A paid rerun needs your own provider keys and pays your own model bills. A step that needs held-out material can't run outside the crew, and the post says so. If a result doesn't reproduce, open a bug report with your repro on current main, as [CONTRIBUTING.md](../CONTRIBUTING.md) asks.
