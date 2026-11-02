# Former reconciliation records

The existing archive stores historical donor alias decisions, analyst notes and the bank reference seen at the time. The active alias list is a separate table. Monthly reconciliations can run with the active list, so the archive is not a required input to the new queue. Staff use older notes when a donor disputes a prior allocation or an old abbreviation reappears.

There are six years of records. Keeping them read-only costs $38 per month for the entire customer base and requires no scheduled staff work. A tested export command can create a per-charity package, and a read-only viewer already exists. The old service can remain available alongside the queue without a migration dependency. There is no vendor deadline, storage limit or contract forcing its removal.

Deletion from both live storage and backups cannot be reversed. The active alias list cannot reconstruct the reasons behind older decisions or references that were later replaced. The trial used a read-only copy of the old archive for historical questions while all new approvals were recorded in the queue. New reports alone do not recreate the earlier notes.
