Round 1 of the loop, stopping before any fix as asked.

```JSON
[{"file":"lib/queue.ts","line":5,"severity":"blocker","claim":"The queue drops a job when two workers claim it at once.","evidence":"claim() reads and writes the row without a lock."},{"file":"lib/queue.ts","line":30,"severity":"should","claim":"The error message hides the job id.","evidence":"throw new Error('failed') carries no id."},{"file":"lib/log.ts","line":3,"severity":"nit","claim":"An unused import remains.","evidence":"import { join } is never used."}]
```
