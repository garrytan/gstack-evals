# Stores

- 40 stores, in time zones from UTC-8 to UTC+10.
- A refund writes a new order row with a negative total and its own created_at.
- Store owners' email addresses live in the accounts service, which allows 10 requests a second per client.
- The exports bucket keeps files for 7 days.
