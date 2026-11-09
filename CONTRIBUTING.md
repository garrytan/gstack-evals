# Contributing to gstack-evals

gstack-evals is built by an agent crew working for Garry Tan. Its job is to find out, honestly, whether gstack's skills help. Outside reports and ideas are welcome. Read this first, because the rules for outside code are stricter than in most repos.

## How we triage

We triage outside issues and pull requests when they arrive. They are not a work queue: the crew plans its work from the goals Garry Tan sets for this repo, and an outside item becomes work only when it serves those goals and meets the rules below.

- An item that is irrelevant to those goals, too niche, or invalid is closed as won't-fix with a short, polite note.
- An item that is missing something we need, such as a repro on current main, is closed with a note asking for it. We reopen it when that arrives.

## Bug reports

A bug report becomes work only when it has both of these:

- **Proof on current main.** A repro that runs on the latest commit of `main` (give the commit sha), or a failing test written first.
- **A real consequence.** Say what goes wrong for someone using the rig or reading a result: a wrong verdict, a crash, a check that passes when it should fail, money spent that should not be.

Reports without both are closed with a note saying what is missing, and reopened when it arrives. Use the bug report form; it asks for these.

## Pull requests from outside the crew

We read outside pull requests as text. The crew never checks out, builds, runs or tests an outside branch on its own machines, never pushes to one, and never merges one. GitHub runs this repo's CI on an outside pull request with a read-only token and no secrets, and the sealed check runs from main and reads your commits as data.

If the change is worth having, the crew rebuilds it on current main in its own pull request, gives the rebuild a security read and the same review as any other change, and credits you in it. Your pull request is then closed with a link to the rebuild. If it is not worth having, we close it as won't-fix with a short note saying why.

So the most useful pull request is a small one with a clear reason: what it fixes, how you know (a repro or a failing test), and what it changes for users.

These need extra care, and we look at them closely: network calls, reading secrets or environment variables, wider permissions, edits to CI workflows or install scripts, and new dependencies.

## What never belongs in an issue or pull request

- Secrets, keys or tokens, even expired ones.
- Held-out task bodies, hidden tests, answer keys, or anything that would let a model under test recognize a held-out task. If you think you have found some, report it privately as [SECURITY.md](SECURITY.md) describes.
- Code, text or transcripts copied from private repositories or private sessions.
- Details of how to get a credential or sealed file past the repo's scanners. Report those privately too.

## Platforms and models

The rig is built and tested on Linux, and CI runs on Ubuntu. Other platforms are untested.

Windows and Gemini get minimal support. We accept reports for them when they come with a repro on current main, but fixes are low priority and may not come.

## Ideas for evals

Open an issue that says what question the eval would answer about gstack, why the answer would change what gstack does, and how a result could come out against gstack. Do not post the body of a task you would want held out; describe it in general terms.

Ideas are triaged like any other outside issue. An idea we take up becomes a plan in [wiki/plans/](wiki/plans/).

## Checks

Every change must pass the keyless checks in the [README](README.md#run-the-keyless-checks). Write plainly: short paragraphs, active verbs, no marketing words.
