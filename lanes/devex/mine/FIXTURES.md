# Miner fixtures

- excluded-digests.txt: the seed and the 38 units the free count read in full (14 from the supply count, the 14 that
  frame-rules.md part C lists, then 24 from the devex eval's screen pilot), each sha256(seed + newline + owner/repo#number).
  Excluded from both evals' draws. sha256 a3b6ec2501ffa857fe1b75dfe9d55b21d63ed1d169d2b864dee9eaa72db301fd; its first 15
  lines are byte-identical to frame-rules.md part C.
- screen-rule.md: the screen pilot's rule, verbatim (supply notes section 14.2, source file sha256
  9c880946111e7e890f10ef387ec4a8ef7c01c3cd6eb331a91d4579de857098c8), which section 4 of the devex prereg freezes for the
  funnel's free screen.
