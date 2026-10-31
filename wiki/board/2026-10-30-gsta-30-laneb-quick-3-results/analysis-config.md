# Analysis config

The config passed to `analyze.ts` and `model-contrast.ts`, as JSON. Job and session paths are relative to the operator's run folder; `runs/r23f/jobs/laneb3-r23` is the laneb3-r23 job folder minus the two infrastructure trials.

```json
{
  "models": [
    "claude-sonnet-5-5",
    "particle-1",
    "deepseek-v4.1-flash-1017",
    "claude-haiku-5-5",
    "claude-opus-5-5"
  ],
  "arms": [
    "none",
    "gstack",
    "placebo"
  ],
  "reference": "claude-opus-5-5",
  "jobs": [
    "runs/r1b/pulled/jobs/laneb3-r1",
    "runs/r23f/jobs/laneb3-r23",
    "runs/r23x/pulled/jobs/laneb3-r23x"
  ],
  "sessions": [
    "runs/r1b/pulled/out/proxy-sessions.jsonl",
    "runs/r23/pulled/out/proxy-sessions.jsonl",
    "runs/r23x/pulled/out/proxy-sessions.jsonl"
  ],
  "no_reward": "zero",
  "subsets": {
    "original_20": [
      "filter-js-from-html",
      "dna-insert",
      "model-extraction-relu-logits",
      "chess-best-move",
      "torch-tensor-parallelism",
      "adaptive-rejection-sampler",
      "db-wal-recovery",
      "polyglot-rust-c",
      "break-filter-js-from-html",
      "overfull-hbox",
      "extract-elf",
      "torch-pipeline-parallelism",
      "polyglot-c-py",
      "query-optimize",
      "tune-mjcf",
      "configure-git-webserver",
      "mailman",
      "pytorch-model-cli",
      "cancel-async-tasks",
      "sanitize-git-repo"
    ],
    "added_20": [
      "largest-eigenval",
      "pypi-server",
      "feal-differential-cryptanalysis",
      "pytorch-model-recovery",
      "sparql-university",
      "custom-memory-heap-crash",
      "headless-terminal",
      "openssl-selfsigned-cert",
      "password-recovery",
      "large-scale-text-editing",
      "log-summary-date-ranges",
      "cobol-modernization",
      "code-from-image",
      "constraints-scheduling",
      "fix-code-vulnerability",
      "fix-git",
      "git-leak-recovery",
      "git-multibranch",
      "kv-store-grpc"
    ],
    "tier_a": [
      "filter-js-from-html",
      "dna-insert",
      "model-extraction-relu-logits",
      "chess-best-move",
      "torch-tensor-parallelism",
      "adaptive-rejection-sampler",
      "db-wal-recovery",
      "polyglot-rust-c",
      "break-filter-js-from-html",
      "overfull-hbox"
    ],
    "native_5": [
      "db-wal-recovery",
      "overfull-hbox",
      "sanitize-git-repo",
      "query-optimize",
      "tune-mjcf"
    ]
  },
  "model_pairs": [
    [
      "particle-1",
      "deepseek-v4.1-flash-1017"
    ],
    [
      "claude-sonnet-5-5",
      "claude-haiku-5-5"
    ]
  ],
  "reference_cell": [
    "claude-opus-5-5",
    "none"
  ]
}
```
