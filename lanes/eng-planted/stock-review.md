Review notes on the plan

- Add unit tests for every function the plan touches, including edge cases and error paths.
- Validate inputs at every public entry point and reject bad values.
- Handle errors visibly: never swallow an exception or return a silent default.
- Keep functions small and their names and signatures consistent with the surrounding code.
- Check boundary values: empty inputs, zero, one, the maximum, and missing or null values.
- Make sure the tests run in CI and fail when the behavior they cover breaks.
- Review the architecture: keep the change inside the modules the plan names, with no new coupling.
- Consider performance: avoid repeated work inside loops and unbounded memory use.
