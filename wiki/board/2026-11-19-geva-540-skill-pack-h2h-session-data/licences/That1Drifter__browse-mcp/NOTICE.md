# Third-Party Notices

browse-mcp is distributed under the MIT License (see [LICENSE](LICENSE)). It
incorporates or is inspired by the following third-party software. Each
component retains its original license.

## Design inspiration

### gstack / browse skill
- Source: https://github.com/garrytan/gstack
- License: MIT
- Copyright (c) Garry Tan

The `@eN` / `@cN` accessibility-tree ref system, snapshot-diff, annotated
screenshots with ref-label overlays, handoff/resume pattern for CAPTCHA/MFA
flows, live CSS modify-with-undo, responsive-batch screenshots, and
ads/cookies/sticky cleanup heuristics were all modeled on gstack's `browse`
skill. No gstack code is copied directly — browse-mcp is an independent
reimplementation in TypeScript targeting the MCP protocol rather than a
shell CLI.

### Microsoft playwright-mcp
- Source: https://github.com/microsoft/playwright-mcp
- License: Apache License 2.0
- Copyright (c) Microsoft Corporation

Tool naming conventions (`browser_navigate`, `browser_click`, etc.) and the
general shape of the MCP tool surface were referenced from playwright-mcp.
No code is copied.

## Bundled dependencies

### axe-core
- Source: https://github.com/dequelabs/axe-core
- License: Mozilla Public License 2.0 (MPL-2.0)
- Copyright (c) Deque Systems, Inc.

`axe.min.js` is loaded at audit time from the installed `axe-core` npm
package and evaluated in the target page to perform WCAG checks. The file
is not modified. Per MPL-2.0 §3.3, a copy of the MPL-2.0 license text is
available in the installed `axe-core` package or at
https://www.mozilla.org/en-US/MPL/2.0/.

### Playwright (playwright / playwright-core)
- Source: https://github.com/microsoft/playwright
- License: Apache License 2.0
- Copyright (c) Microsoft Corporation

Used as the underlying browser automation library.

### @modelcontextprotocol/sdk
- Source: https://github.com/modelcontextprotocol/typescript-sdk
- License: MIT
- Copyright (c) Anthropic, PBC

Used to implement the MCP server protocol.

### sharp
- Source: https://github.com/lovell/sharp
- License: Apache License 2.0
- Copyright (c) Lovell Fuller and contributors

Used to composite SVG overlays onto PNG screenshots for the annotated
screenshot feature.

## License compatibility

| Component                      | License    | Redistribution |
|--------------------------------|------------|----------------|
| browse-mcp                     | MIT        | —              |
| gstack (design inspiration)    | MIT        | No code copied |
| playwright-mcp (naming ref)    | Apache-2.0 | No code copied |
| axe-core (bundled via npm)     | MPL-2.0    | Unmodified     |
| Playwright                     | Apache-2.0 | Unmodified dep |
| @modelcontextprotocol/sdk      | MIT        | Unmodified dep |
| sharp                          | Apache-2.0 | Unmodified dep |

MPL-2.0 is file-scoped copyleft — only affects modifications to axe-core
itself, which this project does not make. MIT is compatible with all of
the above.
