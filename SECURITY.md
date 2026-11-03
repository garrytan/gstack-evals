# Security policy

## Reporting a problem

Please report security problems privately, not in public issues, pull requests or discussions.

**Preferred:** use GitHub private vulnerability reporting:
<https://github.com/garrytan/gstack-evals/security/advisories/new>

**If that link does not work:** open an issue with the "Request a private security contact" form. Put no technical details, file names or proof of concept in it. A maintainer will reply with a private channel.

Include what you can: the commit, the file or workflow, steps to reproduce and the impact you saw.

## What counts

Reports about this repository are in scope, including its git history and its GitHub Actions:

- A secret, key or token anywhere in the repo, its history, a pull request, an issue or an Actions log.
- A held-out task body, hidden test, answer key or any detail that would let a model under test recognize a held-out task. We retire any held-out item that was exposed and record it by digest.
- A workflow that lets a pull request read secrets, write to the repository, or mark its own check green.
- A way past the sealed-output or secrets checks (`gstack-pregate sealed` and the sealed workflow).
- A rig sandbox escape, or a way for an arm to reach the network, the budget ledger or another arm's files when it should not.
- The metering proxy leaking a provider key or charging the wrong line item.

Problems in gstack itself go to [gstack's security policy](https://github.com/garrytan/gstack/security/policy). Problems in the tools the rig drives (Claude Code, Codex, model providers, Docker) go to those projects.

## What happens next

We confirm the report, fix it on `main`, and credit you unless you ask us not to. A leaked secret is removed where we can remove it and reported to its owner. A leaked held-out item is retired and recorded as burned by its digest.

Fixes land on `main` only; there are no release branches.
