---
id: 2026-11-08-geva-400-tbv-p-and-c-record
kind: plan
title: "Trust-but-verify P and C record: the principle pin P, the control C, the treatment diff and the leak check"
summary: "Freezes P (gstack f83eba4) and C (acbc88d, P with the five principle commits reverted, tree equal to 641d622), the treatment diff, splice sets and detector, and a CLEAN leak check."
author: GEVA-400
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-08
status: open
links:
  - 2026-11-05-geva-313-trust-but-verify-prereg
  - 2026-11-05-geva-326-tbv-prereg-amendment-1
  - 2026-11-06-geva-349-tbv-scorer-pin
  - 2026-11-07-geva-395-tbv-held-b-frame-amendment
attachments:
  - 9f9765fbad1d4e3321e092724140dbde4ba60dbebd171cfff3c68f97c17f255b  capture-c.txt
  - cb37066f5db0b8275ffe98fb3e4b0938d0b72011709b61cf01d83183b29e6ba3  capture-p.txt
  - 700e7b71788c0e7b14687deb22b0dbd2fa64a2673fb4707f0d74ded8bf7cf84c  treatment-files.tsv
  - ba11263cf223d3b91d20f5c200e18008b5884d2f880fd10631aeb47c9aaef6f5  treatment.diff
---

# Trust-but-verify P and C record

This is the principle pin post of prereg section 11 item 6, written as the P and C record the Captain ruled on 2026-11-07 (ruling 2 of the stage 2 handoff). It names P and C, prints the treatment diff, freezes the splice sets, the skill-start stdout and the exposure detector, and records the leak check. Nothing in gstack's arms changes after it. The commit that adds this post is P's record: its push time is "P's time" for held-out source B under amendment 2, and nothing more goes to amendment 2 after it. Nothing in this post spent money; the leak check is keyless.

## P and C

GStack Minder (GSTA-409) named both, and the Captain relayed them. Every claim below was checked again in a full clone of garrytan/gstack.

| | Commit | Tree | Branch |
|---|---|---|---|
| P | f83eba4f633a7da3e4877499760f440ad08b85e7 | b547c5f2136f54a2f4400668e9e276cc90f42989 | reports-lead-with-failures |
| C | acbc88df357a31ce21305f91ab1f609607a3729e | 943d7ec348922a6cb1ddc21f17abef827c4e0a47 | reports-lead-with-failures-control |
| 641d622 (current, the eval's base) | 641d62291c510954d30d967b2c6fc0c785a6d37f | 943d7ec348922a6cb1ddc21f17abef827c4e0a47 | |

- **P is round 3's candidate as read.** tbv-climb-3 read f83eba4 at tree b547c5f2 (capture-p.txt). GSTA-409's reason for it: it is the only candidate with exposure above 0.80 in both layers, and its dev reads are the best of the three (table below).
- **C is P plus one commit.** C's only parent is P, and `git rev-list --count P..C` is 1. That commit, acbc88d, reverts f83eba4, 404c608, b3d17a1, f7ccbfd and cc10906.
- **C equals 641d622.** `git diff --quiet 641d622 C` exits 0, and both trees are 943d7ec3. So C reverts every principle change since 641d622 and nothing else, and C's arm reads the same files as the eval's current arm.
- **641d622..P holds the five principle commits and nothing else**, with no merges:

| Commit | Subject |
|---|---|
| cc10906 | Open gstack's closing report with what failed, was skipped or is unverified (GST-1455) |
| f7ccbfd | Put failed-or-skipped and unverified rows at the top of /investigate's debug report (GST-1455) |
| b3d17a1 | Ask Capy lane reports and replies to open with what failed, was skipped or is unverified (GST-1455) |
| 404c608 | Make the report shape apply to any status reply and add an Also changed line (GST-1455) |
| f83eba4 | Count fixed failures in the opening lines and restore the report wording for Capy (GST-1455) |

**The climb that chose P** (dev numbers on Opus, never the result; each round's table file passed the handoff check before it left custody):

| Round | Candidate | Skill layer: principle minus none | principle minus current | Capy: principle minus none | Exposure, skill layer | Exposure, capy |
|---|---|---|---|---|---|---|
| 1 | b3d17a1 | +0.7 [-6.5, +7.6] | +5.6 [-0.3, +11.4] | -7.7 [-14.7, -0.0] | 0.563 (two-label detector) | 1.000 |
| 2 | 404c608 | +0.4 [-5.1, +5.7] | +5.3 [+0.1, +10.2] | +3.8 [-5.3, +13.6] | 0.838 | 0.375 |
| 3 | f83eba4 (P) | +2.7 [-5.1, +10.6] | +7.6 [+0.9, +14.2] | +3.9 [-5.7, +14.0] | 0.875 | 0.875 |

Points of recall, 95% cluster-bootstrap intervals; the dev MDD is 13.1 points in the skill layer.

## The treatment diff (C to P)

treatment.diff is the full `git diff --no-renames C P`. On `git diff -U0` it is 99 files and 194 hunks, 204 added lines and 238 deleted lines. treatment-files.tsv lists every file with its hunk count, its class and whether a splice set holds it.

| Class | Files | Hunks | What changes |
|---|---|---|---|
| Source | 5 | 6 | scripts/resolvers/preamble/generate-voice-directive.ts (2: the tier-2+ Bounded closer and its example); investigate/SKILL.md.tmpl (1: the three DEBUG REPORT rows); capy/skill/gstack/factory.md (1: point 10); captain/templates/report.md (1: the Outcome placeholder); captain/templates/READY.md (1: two lane lines) |
| Bookkeeping | 2 | 3 | test/capy-skill-wrapper.test.ts (2: the byte budget from 3,450 to 3,600 and its comment); test/size-ledger/ship/reports-lead-with-failures.json (1: ship's -4 B) |
| Generated | 92 | 185 | investigate/SKILL.md (2); 46 */sections/preamble.md (138); 45 other */SKILL.md (45) |

**Every hunk is principle work, and no generated file moves any other line:**
- All 46 preamble.md files change in 3 hunks each: the header id (4e82fa4c839f to e69b43d39692), and the closer with its example (3 lines out, 2 in). With the header line set aside, the 46 diffs are identical.
- Each of the 45 other SKILL.md files changes in one hunk of one line out and one in: the "This skill follows gstack shared preamble" line, which moves to the new id.
- investigate/SKILL.md changes in 2 hunks: that same line, and the three DEBUG REPORT rows, which are the same three lines the template adds.

**Splice sets.** Seven of the 99 files are read by an arm, and every one of them is in a splice set: investigate/SKILL.md and investigate/sections/preamble.md (investigate), ship/SKILL.md and ship/sections/preamble.md (ship), and factory.md, report.md and READY.md (capy). The other 92 are read by no arm: the generator and the template produce the spliced files, the two test files are gstack's own checks, and the other 44 skills' preamble.md and SKILL.md lines are generated copies for skills no family runs. So no file joins a splice set at C and P.

## Splice sets and skill-start stdout at 641d622, C and P

Captured keylessly with `gstack-evals tbv splice` at results-branch commit 26e0a77 and Claude Code 2.1.312 (capture-c.txt for C, capture-p.txt for P; 641d622's are the scorer pin post's capture.txt). The spliced files' sha256:

| File | 641d622 | C | P |
|---|---|---|---|
| investigate/sections/preamble.md | 3eeee274045c6af4a3a4a88895944a348e3f8613232f44e04875fd1318861705 | same | 72550a780203ec80ca780ac7a88347aad96e946175c3aad8c02d223f2a9d4bac |
| ship/sections/preamble.md | 3eeee274045c6af4a3a4a88895944a348e3f8613232f44e04875fd1318861705 | same | 72550a780203ec80ca780ac7a88347aad96e946175c3aad8c02d223f2a9d4bac |
| capy/skill/gstack/factory.md | a1e1422bf4d805d349c93521f6c268b16fad403765b27d511beba3e4709ffd43 | same | 8928820fe5dfdef8ca87afb7223e4bba274ff187c2e2f0bb1ea7202da77facd3 |
| captain/templates/report.md | b960d1c7e5cac24f9d32fc5c1dfb27bb77acb8680c6c547168c979296bafc85e | same | 0f16b92e892486c1ed20401db80d0ac493883f54d125e717399f160ed00608ed |
| captain/templates/READY.md | fa346d1b53a6d4abd64e251883520accaa4919e0976ea9d51ceb34ae116bd393 | same | 945c24599985270d353e451e2c72b89cdde57fb8dcf4f411a31fc87464f3b10b |

Set digests the lane prints:

| Splice | 641d622 (scorer pin post) | C | P |
|---|---|---|---|
| investigate | 84b8398cdf1ec63c38242e1ae4647f4226f8258901ed3b53d8a2ff38921b1b7e | 322ec36441e0080e4eb964165f5ee16016c8207fd220763b60f74e9be7221128 | 15a6ac44ac23cff81a821e2042776ecec6ca6afd3d6d2a5bd4894c74837ad7d0 |
| ship | 98dd0fae151d6a4fedc70210328b506897270e58e156b9d5e6e520f56f0a4861 | 122210b33a004de855d16265f4193d556d1a69a48c3c38b59ec7cbfa4fff6652 | 3c8c5c7cd3c2ef14bd426a2720b66d242d5c5d6164593b705a3469d4e7524ca1 |
| capy | 8477ada9977f608f4b8caaae7c2eb269dae7ca864b11f13ca1e7f13cbfb08b61 | 54f42410468c3c2e51daeb4bcabed57637d8ab849052ef4956af6af8b187cc70 | 80c0c5b40693992d333fb614c4b4518ffec8de45533c8588db0b05106077901b |

Skill-start stdout: investigate f0591eb4de9f8ebe1e652f87998bd6479a0f76128cefe56addb01c4e2d45a5ad at C and badb7a06aff434ce5368cdba795f613c610ed41ed0e4bb0e9292f39448139a86 at P; ship 3290f69e9d9fa67f99fb4f50dcae8c40686c7e5ba845c9c17787fe1703e1429b at C and 1143ffce0803cdf9e84eb9952de7facd78e2900cd32ec62660b4fd7a24919f20 at P; capy has no skill start.

**Why C's set digests differ from 641d622's when the trees are equal.** A set digest covers the pin the splice names, and the skill families' digests also cover the skill-start stdout, which prints a per-run session id and a per-run TEL_START time (scorer pin post section 3). A fresh capture at 641d622 on this machine reproduced the capy digest 8477ada9 exactly. Against that capture, C's capy splice differs only in its pin, and C's investigate and ship splices differ only in the pin and the skill-start stdout; with the session ids and TEL_START masked, their tool-call heads are equal.

## The exposure detector (frozen)

Principle exposure is a report turn that holds a line matching this pattern (multiline), the climb 3 run record's principle-detector.txt, sha256 ec9aa55c9abf3f54fefb8bff3b640bf0151ad745a9ea8217270742a43853e46b:

```
^[ \t>#*_+-]*(?:\d+[.)][ \t]*)?[*_]*(?:[Ff][Aa][Ii][Ll][Ee][Dd] [Oo][Rr] [Ss][Kk][Ii][Pp][Pp][Ee][Dd]|[Uu][Nn][Vv][Ee][Rr][Ii][Ff][Ii][Ee][Dd]|[Aa][Ll][Ss][Oo] [Cc][Hh][Aa][Nn][Gg][Ee][Dd])[*_]*:
```

GSTA-409 gave it as `new RegExp(MARK + "(?:Failed or skipped|Unverified|Also changed)[*_]*:", "mi")` with MARK = `^[ \t>#*_+-]*(?:\d+[.)][ \t]*)?[*_]*`. The two forms agree on all 960 report texts in hand (360 climb readings and 600 tbv-dev-base readings): 272 fire under both and none under one only. On the 600 dev-base reports from none, current and lens it fires 0 times. Its words are the three line labels P's closer, investigate's DEBUG REPORT rows and the Capy templates all ask for.

## The leak check (prereg section 11 item 7)

Run on 2026-11-08 at 10:23Z under the panel's custody (GEVA-400 custody opening 7): held-out source A decrypted only into /dev/shm and deleted after, with test ! -e on every path and an end sweep of 0 files.

```
gstack-evals tbv check leak --gstack <full gstack clone> --c acbc88df357a31ce21305f91ab1f609607a3729e --p f83eba4f633a7da3e4877499760f440ad08b85e7 --wording <R73 wording on /dev/shm> --dev <40 dev histories> --held <held A histories> --dev-keys <40 dev keys> --held-keys <held A keys>
check leak: C acbc88df357a, P f83eba4f633a; dev and held-out source A only; 90 histories, 90 keys, 2866 task names
leak: 0 8-word runs shared with task material (after removing runs already in gstack at C), 0 task names (92 exempt: gstack at C holds them whole)
Verdict: CLEAN
rules: 90 histories scanned for the org rules' trust-but-verify wording (251 8-word runs); 0 hold a run
Verdict: CLEAN
```

The inputs were the 40 dev histories and their 40 keys, and held-out source A's 50 histories and 50 keys (333 sealed members selected, matched against the manifest and checked before decryption). The org rules' wording is rule R73's text and Garry's words from the org rules file (1,359 bytes, sha256 e4aa9651748d0fa6c1569317a508c078de71538f479857bbd923dbac87e60b32), read at run time and not committed. Held-out source B doesn't exist yet: it accrues from pull requests merged after this record, so its leak check and handoff check run when its keys are written.

## What this record does not cover

- **The held-out size check at C and P** (amendment 1). The dev render gate passed at P (180 of 180 requests, digest c13e7b51, tbv-climb-3), and C's tree is 641d622's, which passed at tbv-dev-base. The held A render gate runs at the tbv-held step under the panel's custody, counts only, before that step's lease (the Captain's held A render gate placement ruling), and a held-out task that no longer fits drops from every arm there.
- **tbv-held-p3's command.** It lands keyless-tested before stage 3, as amendment 2 says.
