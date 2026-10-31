## Review: 2 issues (1 critical, 1 informational)

I ran the parser tests first:

```bash
bun test src/parse.test.ts
```

Draft list before the second read:

```json
[]
```

Final findings:

```json
[{"file":"src/parse.ts","line":17,"severity":"CRITICAL","claim":"An empty header line now throws instead of returning no fields.","evidence":"split(':')[1].trim() runs on undefined when the line has no colon."},{"file":"README.md","line":null,"severity":"INFORMATIONAL","claim":"The usage example still shows the old flag name.","evidence":"README.md names --fields, the code reads --columns."}]
```
