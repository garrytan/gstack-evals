# Current scheduler

The current service schedules every LoopCrate collection, including the forty intended member shops. Its public operations are reserve, reschedule, cancel, and manifest. Reserve accepts shop, district, date, and crate count and returns a collection identifier and receipt record. It uses the same route capacities and calendar that the membership will use. It has no dependency on how a collection is billed.

The small source extract in src/ shows the production dispatch interface. The live service persists the records in the existing booking database. Operations has offered access to the service to the membership team. The estimated work to connect membership billing and show available dates is six engineer-days. Current load is 240 collections a day against tested capacity of 2,000, and no separate service is required by customers, contracts, or data ownership rules.
