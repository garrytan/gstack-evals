# Outcome-skills session driver

## Operator rule: a driver failure ends the item

If the driver fails with E_INTERNAL or E_LEASE_UNSETTLED, each line item it was serving ends incomplete, and the driver is not launched again for that item unless GSTA-2 reads the ledger and rules otherwise. The driver writes a cap stop to O6's record before it answers the 409 that reports it. If that record can't be written when the stop fires, the driver answers 500 E_INTERNAL instead, no stop record lands, and a relaunch would reopen the item on what its cap has left. GST-1413 owns turning this rule into code before G's first paid run.
