I compared this branch with main and read every changed file.

The retry helper stops one attempt early.

```json
[{"file":"src/retry.ts","line":42,"severity":"high","claim":"The loop stops before the last attempt, so the third failure is never reported.","evidence":"for (let i = 1; i < attempts; i++) never reaches i === attempts."}]
```
