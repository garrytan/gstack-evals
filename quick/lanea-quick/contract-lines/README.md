# Office-hours diet: contract lines

The write-up is the wiki post [2026-10-28-gsta-13-office-hours-diet-contract-lines](../../../wiki/research/2026-10-28-gsta-13-office-hours-diet-contract-lines.md): which contract lines of gstack's /office-hours skill the v1.91.289.0 diet kept, moved, rewrote or removed, and which eval tasks cover them.

This folder holds its tool and data:

- `extract.ts` extracts and classifies the lines:

  ```
  bun quick/lanea-quick/contract-lines/extract.ts --gstack ~/.capy/work/gstack \
    --before cd4fc4be73d86a5b14be9a91026d3e4b16cd8520 \
    --after a14c28aca7839cd0182fa130bff9874714672c24 \
    --skill office-hours --out quick/lanea-quick/contract-lines/lines.json
  ```

- `lines.json` (sha256 `8b99d6ac2e7ed588b6252d90c88443029c91ce9c0a2269331ca49ef7f023baee`): every before contract line with its class, location and match.
- `coverage.json` (sha256 `943f1675314cb0ee4dc8af5b1766a6186801b0943e8d74c0b1ea51ef49a769cc`): the covering tasks for every moved, rewritten or removed line. Its references to `quick/lanea-quick/PREREG.md` name the preregistration draft as the map read it, sha256 `26b1ac95ba3ce6d5f006fecb16abc5f29d04b2f20ba7087ac09a3015290afcc8`.
