# Harness mechanics D1 (pre-data amendment). prepare-run.ts appends these lines after Lane B's runtime-copy.Dockerfile
# in every arm's task image, none and plain-2 included, when L1's profile names this file (TASK_SETUP). Both testbed env
# prefixes go first on PATH (D2: on miniconda and /opt/conda images the env's python3 and pytest come before the base
# env's), and a local bare origin gets main at the base commit, so gstack-checks finds a pregate
# context. The verifier is built from the pristine image, so grading is untouched. The task-fit screen and the
# d1-checks dry-run step read this file; nothing copies it. HM_ORIGIN is unset in every build; keyless tests set it.
ENV PATH=/opt/miniconda3/envs/testbed/bin:/opt/conda/envs/testbed/bin:$PATH
RUN O="${HM_ORIGIN:-/opt/hm-origin.git}"; if git remote get-url origin >/dev/null 2>&1; then echo "D1 origin refused: the task tree has an origin remote already" >&2; exit 1; fi && git init -q --bare "$O" && git push -q "$O" HEAD:refs/heads/main && git remote add origin "$O" && git fetch -q origin && git remote set-head origin main
