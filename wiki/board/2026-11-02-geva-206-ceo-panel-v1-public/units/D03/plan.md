# TagAster local label edition

## Release purpose
TagAster produces shelf-edge price labels for small retail chains. We will add a local edition for six food cooperatives whose store computers cannot send prices or product records outside their own network. The goal is to replace nightly manual relabeling at these buyers while preserving the current hosted edition for other customers.

The six cooperatives have signed paid pilot orders at $140 per store per month, conditional on local operation and accurate labels. Their combined fourteen stores provide a useful first market without requiring a general enterprise edition. We will accept no further stores until the first month meets the time-saving and accuracy targets.

## Local rendering service
We will build a new label-rendering service that takes the current label request fields and produces the same label sizes, barcodes, and price layout as the hosted renderer. The local service will run on the store's existing back-office computer and will not send product records to TagAster. It will use a locally licensed font and barcode library. The stored label rules and approved test examples remain shared with the hosted edition.

The work includes local layout, barcode placement, print-file creation, a local job log, and a store-controlled update package. We will not clone the hosted job queue, account system, or printer fleet dashboard. Each store can export a diagnostic bundle after removing product and price content. Support will never require a live upload of its catalog.

## Store workflow
The manager exports changed prices from the existing stock system into a watched local folder. The service validates the file, renders labels, and sends a batch to the connected printer. A staff member checks the first sheet and confirms the batch. Rejected rows remain visible in the job log so the manager can correct and resubmit them. A failed batch does not alter the store's price database.

We will support the two printer models already used by the fourteen stores. New printer families, centralized remote administration, electronic shelf displays, and network policy changes are outside this release. The current hosted product and its customer contracts are unchanged.

## Delivery and acceptance
Four weeks of implementation cover the renderer and local job records. Two further weeks cover installation packages and printer trials. Store technicians have booked installation windows in week 7. We will start at two stores, retain their current manual procedure for a week, then add the other twelve after successful comparison.

Acceptance requires identical prices and barcodes on the approved test set, no product-data traffic leaving the store, and a reduction of nightly label preparation from 75 minutes to below 25. Each store signs off using its own network monitor and a timed staff session. Renewals depend on the same results after thirty days, not installation counts.

## Cost and support
Two engineers have eight weeks assigned and a $44,000 release budget. The buyer technicians handle computer provisioning and printer access. Our support lead has six spare hours weekly against an estimated four hours during rollout. Local subscription receipts cover licensing and expected ongoing support at the signed store count. Stores can cancel after the pilot; TagAster keeps the hosted service and does not retire any existing renderer.
