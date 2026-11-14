// Copyright (c) 2026 Garry Tan. MIT License.
// Invented fixtures for the author area's tests, dry run and the keyless half of the gate check: a small base app
// (Tallyhall, an invoicing console that doesn't exist), one unit on it that obeys every authoring rule, its 2x
// version, and a second base app for twins. Every name, number and date here is made up for this build.
import type { ItemClass } from "../types.ts";
import type { BaseAppView } from "./seams.ts";

const lines = (...ls: string[]): string => ls.join("\n") + "\n";

export const APP_FILES: Record<string, string> = {
  "README.md": lines(
    "# Tallyhall",
    "",
    "Tallyhall is a self-hosted invoicing console for small finance teams. It keeps customers, invoices and incoming",
    "payments in one Postgres database and shows them in a React front end.",
    "",
    "## Running it",
    "",
    "Install the packages, copy .env.example to .env, run the seed script and start the dev server. The app serves the",
    "dashboard at /, invoices at /invoices, customers at /customers and settings at /settings.",
    "",
    "## Layout",
    "",
    "Pages live in src/pages, shared components in src/components and design tokens in src/theme/tokens.css.",
  ),
  "package.json": lines('{', '  "name": "tallyhall",', '  "private": true,', '  "dependencies": { "react": "19.0.0", "react-dom": "19.0.0" }', '}'),
  "docs/ARCHITECTURE.md": lines("# Architecture", "", "The API lives in server/ and the front end in src/."),
  "src/theme/tokens.css": lines(":root {", ...Array.from({ length: 22 }, (_, i) => "  --space-" + i + ": " + i * 2 + "px;"), "}"),
  "src/components/DataTable.tsx": lines(
    "import { useState } from 'react';",
    "",
    "export interface Column<T> {",
    "  key: keyof T;",
    "  label: string;",
    "  sortable?: boolean;",
    "}",
    "",
    "/** The table every list screen uses, with a sortable header row. */",
    "export function DataTable<T>(props: { columns: Column<T>[]; rows: T[] }) {",
    "  const [sort, setSort] = useState<keyof T | null>(null);",
    "  return <table>{props.columns.map((c) => <th key={String(c.key)} onClick={() => c.sortable && setSort(c.key)}>{c.label}</th>)}</table>;",
    "}",
  ),
  "src/components/StatusPill.tsx": lines("export function StatusPill(props: { tone: 'ok' | 'warn' | 'bad' }) {", "  return <span className={'pill pill-' + props.tone} />;", "}"),
  "src/pages/Invoices.tsx": lines("import { DataTable } from '../components/DataTable';", "export default function Invoices() {", "  return <DataTable columns={[]} rows={[]} />;", "}"),
  "src/pages/Customers.tsx": lines("export default function Customers() {", "  return <main>Customers</main>;", "}"),
  "src/pages/Settings.tsx": lines("export default function Settings() {", "  return <form>Settings</form>;", "}"),
  "src/pages/Dashboard.tsx": lines("export default function Dashboard() {", "  return <main>Dashboard</main>;", "}"),
  "src/api/payments.ts": lines("export async function listPayments() {", "  return fetch('/api/payments').then((r) => r.json());", "}"),
};

/** A base app view over a map of invented files. */
export function appView(label: string, files: Record<string, string>, designFiles: string[], routeFiles: string[]): BaseAppView {
  return { label, readme: files["README.md"] ?? "", tree: Object.keys(files).sort(), read: (p) => (Object.hasOwn(files, p) ? files[p]! : null), designFiles, routeFiles };
}

export const FIXTURE_APP: BaseAppView = appView("fixture/tallyhall@0000000", APP_FILES, ["src/theme/tokens.css"], ["src/pages/Invoices.tsx", "src/pages/Customers.tsx", "src/pages/Settings.tsx", "src/pages/Dashboard.tsx"]);

/** The second base app, for twins: the same shape with other names. */
export const FIXTURE_APP_2: BaseAppView = appView(
  "fixture/stockroom@1111111",
  Object.fromEntries(Object.entries(APP_FILES).map(([p, t]) => [p, t.replaceAll("Tallyhall", "Stockroom").replaceAll("invoic", "shipment")])),
  ["src/theme/tokens.css"],
  ["src/pages/Invoices.tsx", "src/pages/Customers.tsx", "src/pages/Settings.tsx", "src/pages/Dashboard.tsx"],
);

export const PLAN = lines(
  "# Payments list",
  "",
  "Date: 2026-10-20",
  "",
  "## Goal",
  "",
  "We will add a payments list at the route /payments so that finance clerks can see every incoming payment in one",
  "place. Today a payment shows up only inside the invoice it settles, so clerks open invoices one at a time when they",
  "reconcile the bank feed at the end of each day. The new page should cut that work to a few minutes.",
  "",
  "## Users",
  "",
  "The page is for finance clerks at the businesses that run Tallyhall, and for owners who check incoming cash at the end",
  "of the week. Clerks will use it every working day; owners will open it a few times a month.",
  "",
  "## Data",
  "",
  "The page will read the existing GET /api/payments endpoint through the payments module in src/api/payments.ts. Each",
  "row will show the payment date, payer, invoice number, amount, method, bank reference, status and the clerk who",
  "matched it. We will not add a new endpoint for this release.",
  "",
  "## Screens and flows",
  "",
  "1. A clerk opens Payments from the main navigation, next to Invoices and Customers.",
  "2. The page shows a table of payments, newest first, with a search box above it.",
  "3. Selecting a row opens the linked invoice in the invoice drawer we already ship.",
  "4. A clerk can mark an unmatched payment as matched by choosing an invoice from a short picker.",
  "5. After a match, the row updates in place and the clerk stays on the same page of results.",
  "",
  "## Decisions we have made",
  "",
  "- We will keep all eight columns visible, because clerks compare amounts and references side by side.",
  "- We will split the table into pages of 100 rows, with page links under the table, rather than an endless scroll.",
  "- The search box will match payer, invoice number and bank reference, and it will ignore case.",
  "",
  "## Scope",
  "",
  "In scope: the list, search, paging, the row link to the invoice drawer and manual matching of one payment at a time.",
  "",
  "Out of scope: refunds, exports, bulk matching, editing a payment, and any change to the bank feed import job.",
  "",
  "## Open questions",
  "",
  "- Should owners see the clerk column, or is it only useful to clerks?",
  "- Do we need a date range filter in the first release, or is search enough for now?",
  "- Should matched payments drop out of the default view after 90 days?",
  "",
  "## Rollout",
  "",
  "We will ship behind the feature switch in src/config/features.ts. We will turn it on for our own books first, watch",
  "the error log for a week, and then turn it on for every workspace two weeks later. Support will get a short note",
  "before the switch flips so they can answer questions on the first day.",
);

/** The six evidence files. Each is a plain record: observations, numbers and paraphrased quotes, no advice. */
export const EVIDENCE: { path: string; text: string }[] = [
  {
    path: "docs/support/2026-09-payments-tickets.md",
    text: lines(
      "# Support summary: payments, September 2026",
      "",
      "Written 2026-09-30 from the 64 tickets tagged payments between 2026-09-01 and 2026-09-30.",
      "",
      "- 27 tickets asked where a payment had gone after the bank feed import. In 19 of them the payment had failed at the bank and sat unmatched.",
      "- Clerks described scrolling through invoice after invoice to find the failed ones. One wrote that a failed payment was the only thing they needed to see each morning.",
      "- 9 tickets came from clerks who thought the page had frozen while invoices loaded, and refreshed it several times.",
      "- 6 tickets asked for a dark theme. All six came from the same workspace.",
      "- 5 tickets came from a county customer's team about a screen reader not reading invoice status.",
      "- The rest were about bank feed timing, duplicate references and one billing error on our side.",
      "",
      "Median time to resolve a payments ticket was 2.4 days, against 1.1 days for all tickets.",
      "Agents said most of that time went to finding the payment in question before they could answer.",
      "Two agents noted that clerks often sent screenshots of the invoice list with a failed payment circled by hand.",
    ),
  },
  {
    path: "docs/research/2026-09-clerk-interviews.md",
    text: lines(
      "# Clerk interviews, September 2026",
      "",
      "Eight interviews, 2026-09-08 to 2026-09-19, with clerks at five workspaces. Paraphrased notes, no names.",
      "",
      "- Six of eight clerks start the day by looking for failed payments. They said settled payments are noise at that moment.",
      "- Three clerks at branch offices do this on shared 10-inch tablets held upright, at 800 by 1280 pixels. They said wide tables run off the side of the screen and they pinch to read the reference column.",
      "- Two clerks at the county customer use a screen reader all day. Both said the reader gives no status for a payment row, because the status is a coloured dot.",
      "- One owner asked for a weekly chart of payments on the same page. The same owner said they read cash on the dashboard every Friday.",
      "- Four clerks said they compare the amount with the bank reference before they match a payment.",
      "- Clerks said they wait for the list to appear and are not sure whether it is still working.",
      "",
      "Every clerk reconciles at least once a day. Most do it before 10 in the morning.",
      "Clerks keep a paper list of payments they could not match and come back to it after lunch.",
      "Nobody we spoke to used the existing invoice search to look for payments, because it does not search references.",
    ),
  },
  {
    path: "docs/analytics/2026-08-payments-usage.md",
    text: lines(
      "# Analytics summary: payments, August 2026",
      "",
      "Read on 2026-08-31 from product analytics for all workspaces.",
      "",
      "- 3,000 is the payment count of the largest workspace. The median workspace holds 410 payments.",
      "- Failed payments are 2 percent of all payments, about 60 in the largest workspace.",
      "- 14 percent of sessions on invoices pages came from tablets, nearly all in portrait.",
      "- 1 percent of users have ever switched the dark theme setting on, and half of them switched it off again within a week.",
      "- The invoices page takes a median of 6 seconds to show rows for the largest workspace.",
      "- Sessions that hit the invoices page for longer than 8 seconds without rows end with a reload 41 percent of the time.",
      "- Clerks open the invoice drawer 22 times a day on average.",
      "",
      "Owners open the dashboard most on Fridays. Clerks open the invoices page most between 8 and 10 in the morning.",
      "Tablet sessions last a median of 11 minutes, against 19 minutes for desktop sessions.",
      "The settings page is opened by fewer than 3 percent of users in a month.",
    ),
  },
  {
    path: "docs/api/payments-endpoint.md",
    text: lines(
      "# API notes: GET /api/payments",
      "",
      "Notes from 2026-08-12, kept by the backend team.",
      "",
      "- The endpoint returns every payment in the workspace in one response. It has no paging parameters.",
      "- For the largest workspace the response takes between 6 and 11 seconds, with 11 the worst case we measured under load at month end.",
      "- Each payment carries status as one of settled, pending or failed, plus a free-text bank reference.",
      "- The response is sorted by payment date, newest first. The server can't sort by status today.",
      "- The endpoint is read by the bank feed reconciler and by the invoice drawer.",
      "- Responses are not cached. Each page view makes a fresh request.",
      "",
      "Adding paging is on the backend list for next quarter, with no date set.",
      "The response size for the largest workspace is about 1.9 megabytes before compression.",
      "Timeouts at the proxy are set to 30 seconds, so the request has not failed in practice.",
    ),
  },
  {
    path: "docs/customers/county-requirement.md",
    text: lines(
      "# Customer requirement: county finance office",
      "",
      "Received 2026-07-21 as part of the county's renewal terms.",
      "",
      "- The county's finance office has 14 users. Two of them use a screen reader for all their work.",
      "- The renewal requires that every screen the office uses can be worked with a screen reader and a keyboard.",
      "- The county lists status fields as a known problem: in their test, the reader announced nothing for a coloured status mark.",
      "- The county asked for a written answer on any new screen they will use, before it ships to them.",
      "- The county's clerks reconcile payments every morning and will use any payments screen we ship.",
      "",
      "The renewal is worth about 9 percent of this year's revenue. It runs for three years from January.",
      "The county also asked about data residency, which is answered in a separate note.",
      "Their IT team tests each release on a fixed set of desktop machines before clerks get it.",
    ),
  },
  {
    path: "docs/design/2026-06-table-notes.md",
    text: lines(
      "# Design notes: tables, June 2026",
      "",
      "Notes from the design review on 2026-06-17.",
      "",
      "- The invoices screen moved to the shared DataTable component in src/components/DataTable.tsx in this release.",
      "- DataTable has a sortable header row; a click on a sortable column header sorts by that column.",
      "- Customers still uses an older hand-built table, which has no sorting and a different row height.",
      "- Clerks asked for the same look on every list after the invoices change shipped.",
      "- Status is shown with StatusPill in src/components/StatusPill.tsx, which renders a coloured dot and no text.",
      "",
      "Release notes for 2026.6 listed the DataTable move and the new row height.",
      "We measured no change in invoice page errors after the move.",
      "The customers table is scheduled to move to DataTable once the customers page is reworked.",
    ),
  },
  {
    path: "docs/releases/2026-05-release-notes.md",
    text: lines(
      "# Release notes: 2026.5",
      "",
      "Shipped 2026-05-28.",
      "",
      "- The invoice drawer now opens from any invoice number, not only from the invoices table.",
      "- The bank feed import runs every 30 minutes instead of every hour, and it records the bank reference on each payment.",
      "- Failed payments are marked failed by the import when the bank returns a reject code. Before this release they stayed pending.",
      "- Workspace owners can turn features on and off from the feature switch list kept in src/config/features.ts.",
      "- The dashboard shows cash received this week and last week as two numbers, with no chart.",
      "- We fixed a bug where the customers page sorted names by their first letter only.",
      "",
      "Known issues at release: the invoices page can take several seconds to show rows on the largest workspaces, and",
      "the status dot on invoices has no text. Both were logged for a later release.",
      "",
      "Support received 12 tickets in the week after this release, none of them about the import change.",
      "The release went to every workspace on the same day, with no staged rollout.",
    ),
  },
];

/** The key, in the author's order (not id order). Pointers name the evidence lines that support each item. */
export const ITEMS: { class: ItemClass; statement: string; detail: string; evidence: { file: string; line: number }[] }[] = [
  {
    class: "Y",
    statement: "The payments table in src/pages/Payments.tsx needs sortable columns, and the invoices screen already uses the shared DataTable in src/components/DataTable.tsx.",
    detail: "reuse DataTable and its sortable header row",
    evidence: [{ file: "docs/design/2026-06-table-notes.md", line: 5 }, { file: "src/components/DataTable.tsx", line: 10 }],
  },
  {
    class: "S",
    statement: "The payments table in src/pages/Payments.tsx waits 6 to 11 seconds for one unpaged response, and clerks reload a page that shows no rows.",
    detail: "rows pending for up to 11 seconds at month end",
    evidence: [{ file: "docs/api/payments-endpoint.md", line: 6 }, { file: "docs/analytics/2026-08-payments-usage.md", line: 10 }],
  },
  {
    class: "H",
    statement: "Clerks open the payments list in src/pages/Payments.tsx to find failed payments, which are 2 percent of rows among settled ones.",
    detail: "failed payments shown before settled ones",
    evidence: [{ file: "docs/research/2026-09-clerk-interviews.md", line: 5 }, { file: "docs/analytics/2026-08-payments-usage.md", line: 6 }],
  },
  {
    class: "R",
    statement: "Branch clerks use the payments list in src/pages/Payments.tsx on 10-inch tablets held upright, where the eight-column table runs off screen.",
    detail: "portrait tablet at 800 by 1280 pixels",
    evidence: [{ file: "docs/research/2026-09-clerk-interviews.md", line: 6 }, { file: "docs/analytics/2026-08-payments-usage.md", line: 7 }],
  },
  {
    class: "A",
    statement: "Screen-reader users at the county office hear nothing for a payment's status in src/pages/Payments.tsx, because StatusPill shows only a coloured dot.",
    detail: "status read out as words, not only colour",
    evidence: [{ file: "docs/customers/county-requirement.md", line: 7 }, { file: "docs/design/2026-06-table-notes.md", line: 9 }],
  },
];

export const WRONG_WAY = [
  "Six tickets asked for a dark theme, though analytics shows 1 percent of users ever switch it on.",
  "One owner asked for a weekly payments chart on this page, though owners read cash on the dashboard.",
];

export const CONTEXT = lines(
  "# Tallyhall",
  "",
  "Tallyhall is a self-hosted invoicing console for small finance teams. Clerks use it to issue invoices and match",
  "incoming payments; owners check cash on the dashboard at /. Pages live in src/pages (Invoices, Customers, Settings and",
  "Dashboard), shared components in src/components and design tokens in src/theme/tokens.css.",
  "",
  "The plan adds a payments list at /payments. Payments today appear only inside the invoice they settle, through the",
  "invoice drawer, and are read from GET /api/payments through src/api/payments.ts.",
  "",
  "Product docs live under docs/: support summaries in docs/support, interview notes in docs/research, analytics in",
  "docs/analytics, API notes in docs/api, customer requirements in docs/customers and design notes in docs/design.",
);

/** The author's reply for the fixture unit, as one JSON object in the author prompt's format. */
export const authorReply = (o: { items?: typeof ITEMS; plan?: string; evidence?: typeof EVIDENCE; mentioned?: string[] } = {}): string =>
  "Here is the case.\n\n" + JSON.stringify({ plan: o.plan ?? PLAN, evidence: o.evidence ?? EVIDENCE, key: { items: o.items ?? ITEMS, mentioned: o.mentioned ?? [], wrong_way: WRONG_WAY } });

/**
 * The 2x evidence: each item's support split across two files, and a decoy (CSV export) raised three times in the
 * support summary and shown not to matter in the API notes. Built from the base files by replacing the lines that
 * stated a condition whole.
 */
export const EVIDENCE_2X: { path: string; text: string }[] = EVIDENCE.map((e) => {
  let t = e.text;
  if (e.path.includes("support")) t = t.replace("- The rest were about", "- 4 tickets asked to export the payments list to CSV. Three more asked about CSV export in replies to other tickets. One clerk asked for CSV export twice.\n- The rest were about");
  if (e.path.includes("api")) t = t.replace("Adding paging", "Exports run from the reports page, which already writes CSV for any date range.\nAdding paging");
  return { path: e.path, text: t };
});

export const DECOY = "Clerks ask several times for a CSV export of the payments list, though the reports page already exports payments.";

/** The 2x key: the same statements and details, pointers into two evidence files each. */
export const ITEMS_2X = ITEMS.map((i) => ({ ...i, evidence: i.class === "Y" ? [...i.evidence, { file: "docs/releases/2026-05-release-notes.md", line: 10 }] : i.evidence }));

export const transformReply = (o: { items?: typeof ITEMS; evidence?: typeof EVIDENCE } = {}): string =>
  JSON.stringify({ evidence: o.evidence ?? EVIDENCE_2X, key: { items: o.items ?? ITEMS_2X, wrong_way: WRONG_WAY, decoy: DECOY } });

/** The class of a fixture statement, for scripted labellers. */
export function classOf(statement: string): ItemClass | null {
  const marks: [ItemClass, string][] = [["Y", "shared DataTable"], ["S", "unpaged"], ["H", "find failed payments"], ["R", "tablets held upright"], ["A", "Screen-reader users"]];
  return marks.find(([, m]) => statement.includes(m))?.[0] ?? null;
}
