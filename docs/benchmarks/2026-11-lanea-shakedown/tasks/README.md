# Lane A shakedown tasks

Byte-for-byte copies of gstack's contract task files for /learn and office-hours, with the locks this repo built for them. The Lane A shakedown preregistration (wiki/plans/2026-10-30-gsta-42-lanea-shakedown-prereg.md) runs on these files.

- Source: [garrytan/gstack](https://github.com/garrytan/gstack) at b61744517cc35b3109f06a54d64857be27f60c4e (v1.91.334.0).
- Upstream paths: `test/fixtures/skill-evals/learn/{tasks.json,seed.sh}` and `test/fixtures/skill-evals/office-hours/{tasks.json,tasks.ext.json,seed.sh}`.
- Licence: MIT, Copyright (c) 2026 Garry Tan.
- Unmodified: these are vendored copies, each identical to `git show b61744517cc35b3109f06a54d64857be27f60c4e:<upstream path>`. Do not edit them.
- Headers: a header would change the bytes the lock and gstack's contract test check, so the files carry none. The gstack row in NOTICE.md stands in for the upstream copyright line, as it does for tests/contract/fixtures/gstack/.
- Modes, as upstream: learn/seed.sh is 755; every other file is 644.

```
3428622aa410a41e215dbe505e8f389493befd78b0f8575483c2abb894fb1c22  learn/seed.sh
2c2b88193ecfe681e3620d12da40b97be7d89b0790c43f1c19f26f4e36e4bc54  learn/tasks.json
10b85c8f7fbcdd4ca8f1974ef78f8104b770daac9007144d019aea0bead4538c  office-hours/seed.sh
20d3a53727befd809824e2ce28a9af1114e6cdde3f0f2e5346d2142f4fb2f125  office-hours/tasks.ext.json
472af4f02f08a658a5572f3ed993fe8aa600d1610642db2a48fba91e691ed656  office-hours/tasks.json
```

## Locks

`tasks.lock.json` in each folder is this repo's own file, not a copy. `gstack-evals skill-eval --lock` built it against the before folder named in the preregistration, under policy a00180abac95, and the claims below were then added and locked again:

- learn: B:SKILL:0106 (no-code-change), B:SKILL:0132 (empty, show), B:SKILL:0158 and B:SKILL:0173 (prune-stale), B:SKILL:0253 (stats).
- office-hours: B:SKILL:0695 (alternatives, approach-approval-gate).

```
d567ce8745017cbcf1f81b1c6a732be557a47856ff3ad16f586308e8e6f2a24d  learn/tasks.lock.json
070c69f90b457d9026825509be509fa99c8ca6c1090d0b5b8090e926f659739d  office-hours/tasks.lock.json
```
