# Hosted labels today

TagAster's hosted edition is used by 120 connected stores. It accepts product names, prices, barcode values, and a template identifier, then returns a printable label file. Staff like its layouts and want the same output in the local edition. The existing request adapter is shown in src/. TagAster owns the label rules and the acceptance examples, but the adapter calls a licensed remote rendering service; it contains no drawing engine.

The remote vendor will not supply an installable runtime. Its contract permits only requests to its hosted endpoint, and it has declined both a private-network version and an offline license. TagAster can continue serving connected stores under that agreement. The new edition would not reduce the bill for those customers or replace their workflow.

A survey of the cooperatives' current suppliers found no available offline renderer supporting their two installed printer models and required barcode type. A generic local barcode library and print-file library can cover those functions without sending data outside the store. Their commercial licenses fit the approved budget.
