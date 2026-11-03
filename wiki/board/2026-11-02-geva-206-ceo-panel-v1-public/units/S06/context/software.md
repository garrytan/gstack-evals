# Available components

The finance team has an internally maintained subscription library in src/billing.ts. It holds the subscription ledger, generates annual invoices, renews subscriptions and calculates cancellation credits. The same code runs the existing assistance memberships and can bill separate software offers using a product code. Its behavior meets the new business's approved billing requirements without changes. The current event-rendering service is also available for gallery output.

The code belongs to Lanternelm and has no third-party license charge. The platform team will support its use by any new software product. It is a library, not a customer-facing application: software customer accounts, product workflows, publishing permissions and a staff console still need to be built. Customers cannot use the library directly. It works with the same hosted payment provider selected for the new business.

The engineering estimate for the gallery and account work is eight weeks, including connection to this library. A clean new implementation of the billing functions takes sixteen weeks, followed by the same eight weeks of product work. The team has no requirement for a new language or a different payment provider. The current library has passed its invoice, renewal and credit tests and handles all 160 memberships today. Its product-code support is also tested.
