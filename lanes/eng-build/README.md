# Eng-review build read

The lane for the eng-review build read (prereg 2026-11-11-geva-522-eng-review-build-read-prereg): Opus 5.5 builds each change from a plan that each arm reviewed, and the real later fix's tests grade the build, with no judge.

- types.ts: the shared types every module codes against.
- frozen.ts: every frozen number, with the comparison size as one parameter.
- errors.ts: the lane's refusal, a reason code from src/errors/codes.ts and a message.
