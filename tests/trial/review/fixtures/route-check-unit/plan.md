# Plan: nightly export of order totals

## Goal

Send each store owner a CSV of the day's order totals by 06:00 their local time.

## Steps

1. At 02:00 UTC a cron job reads every order whose created_at falls in the last 24 hours.
2. It sums the order totals per store and writes one CSV per store to the exports bucket.
3. It emails each store owner a link to their CSV, looking up the address in the accounts service.

## Rollout

Turn the job on for every store on the first night.

## Risks

None known.
