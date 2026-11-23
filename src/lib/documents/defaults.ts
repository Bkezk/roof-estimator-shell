/**
 * The templates a fresh install starts with (ensureDefaultTemplates in documents.functions.ts
 * inserts them when a kind has none). Rebuilt from CenterPoint's proposal (owner's screenshots,
 * Oct 26: letterhead, property title + "Roof Assessment - Budget", cover photo, "Submitted to"
 * block, a dated letter) with the portal's pricing table, terms and signature.
 */
import {
  type DocKind,
  type DocOptions,
  type DocPage,
  DEFAULT_OPTIONS,
  newModule,
  newPage,
  richFromText,
  richLine,
  type RichDoc,
} from "./model";

/**
 * The trade proposal's template name (Nov 16): a trade bid's New document starts on it
 * (new-document-dialog.tsx `prefer`), a roofing bid's on the Proposal as before.
 */
export const TRADE_PROPOSAL_TEMPLATE = "Trade proposal";

/** The inspection report's template name: the ticket page's one-tap button finds it by this. */
export const INSPECTION_REPORT_TEMPLATE = "Inspection report";

/**
 * The care plan report's template name (owner, Nov 23: "add a care plan report"): the ticket
 * page's second one-tap button finds it by this (documents/care-plan-report.ts).
 */
export const CARE_PLAN_REPORT_TEMPLATE = "Care plan report";

/**
 * The shipped templates a database has never had — by kind and name, deleted rows counted, so a
 * template the office removed stays removed and one added in a later phase (the Inspection
 * report, Oct 26) reaches an install that already has the others. The first of a kind with no
 * live template is marked its default (ensureDefaultTemplates inserts what this returns).
 */
export function missingDefaultTemplates(
  existing: ReadonlyArray<{ kind: string; name: string; deleted_at: string | null }>,
): Array<DefaultTemplate & { isDefault: boolean }> {
  const key = (kind: string, name: string) => `${kind}\u0000${name.trim().toLowerCase()}`;
  const have = new Set(existing.map((r) => key(r.kind, r.name)));
  const liveKinds = new Set(existing.filter((r) => !r.deleted_at).map((r) => r.kind));
  const defaulted = new Set<DocKind>();
  return defaultTemplates()
    .filter((t) => !have.has(key(t.kind, t.name)))
    .map((t) => {
      const isDefault = !liveKinds.has(t.kind) && !defaulted.has(t.kind);
      if (isDefault) defaulted.add(t.kind);
      return { ...t, isDefault };
    });
}

export interface DefaultTemplate {
  kind: DocKind;
  name: string;
  description: string;
  options: DocOptions;
  pages: DocPage[];
}

const paras = (...lines: Array<string | RichDoc["content"]>): RichDoc => ({
  type: "doc",
  content: lines.flatMap((l) => (typeof l === "string" ? richFromText(l).content! : (l ?? []))),
});

const body = (text: RichDoc) => ({ ...newModule("body"), text }) as DocPage["modules"][number];

export function defaultTemplates(): DefaultTemplate[] {
  const proposalCover = newPage([
    newModule("letterhead"),
    newModule("hr"),
    body({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, textAlign: "center" },
          content: [{ type: "variable", attrs: { key: "property.name" } }],
        },
        {
          type: "heading",
          attrs: { level: 2, textAlign: "center" },
          content: [{ type: "text", text: "Roof Proposal" }],
        },
      ],
    }),
    { ...newModule("fullPhoto"), heightIn: 2.2 } as DocPage["modules"][number],
    newModule("hr"),
    body({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, textAlign: "center" },
          content: [{ type: "text", text: "Submitted to:" }],
        },
        richLine([{ variable: "company.name" }], { align: "center", bold: true }),
        richLine(
          [{ variable: "company.contact" }, ", ", { variable: "company.contact.position" }],
          { align: "center" },
        ),
        richLine([{ variable: "property.address1" }], { align: "center" }),
        richLine([{ variable: "property.address2" }], { align: "center" }),
        richLine([{ variable: "company.phone" }], { align: "center" }),
        { type: "paragraph" },
        richLine([{ variable: "today" }], { align: "center" }),
      ],
    }),
  ]);
  const proposalLetter = newPage([
    newModule("letterhead"),
    newModule("hr"),
    body(
      paras(
        [richLine([{ variable: "today" }])],
        "",
        [richLine([{ variable: "company.name" }])],
        [richLine([{ variable: "company.contact" }])],
        [richLine([{ variable: "property.address1" }])],
        [richLine([{ variable: "property.address2" }])],
        "",
        [richLine(["Re: ", { variable: "property.name" }], { bold: true })],
        "",
        [richLine(["Dear ", { variable: "company.contact" }, ","])],
        "",
        [
          richLine([
            "Thank you for the opportunity to submit this proposal for the roof at ",
            { variable: "property.name" },
            ". JBK, Inc. proposes to furnish all labor, materials, equipment and supervision to install a ",
            { variable: "opportunity.product" },
            " roofing system over ",
            { variable: "opportunity.sections" },
            " roof section(s) totaling approximately ",
            { variable: "opportunity.sqft" },
            " square feet, as described below.",
          ]),
        ],
        "",
        [richLine(["Scope of work"], { bold: true })],
        "• Remove and dispose of existing roofing as required to reach a sound substrate.",
        "• Install the insulation and underlayment layers specified in the estimate.",
        "• Install the membrane, flashings, parapet and curb details, and accessories.",
        "• Clean up and haul away all job-related debris daily.",
        "",
        [richLine(["Warranty: ", { variable: "opportunity.warranty" }])],
      ),
    ),
    newModule("pricingTable"),
    body(
      paras(
        [richLine(["Total: ", { variable: "opportunity.price" }], { bold: true })],
        "",
        "This proposal is valid for 30 days. Price excludes permits, unforeseen deck repair and work not listed above; any additional work will be quoted before it is performed.",
        "",
        "Sincerely,",
        "",
        [richLine([{ variable: "manager.name" }])],
        [
          richLine([
            "JBK, Inc. · ",
            { variable: "manager.phone" },
            " · ",
            { variable: "manager.email" },
          ]),
        ],
      ),
    ),
    newModule("signature"),
  ]);

  // A trade bid's proposal (owner, Nov 16: "Yes we need printed proposals"): the same letter with
  // the job type and the scope the estimator typed in place of the roof, and the price as one
  // line. No roof sections, so no pricing table.
  const tradeLetter = newPage([
    newModule("letterhead"),
    newModule("hr"),
    body(
      paras(
        [richLine([{ variable: "today" }])],
        "",
        [richLine([{ variable: "company.name" }])],
        [richLine([{ variable: "company.contact" }])],
        [richLine([{ variable: "property.address1" }])],
        [richLine([{ variable: "property.address2" }])],
        "",
        [
          richLine(
            ["Re: ", { variable: "opportunity.trade" }, " at ", { variable: "property.name" }],
            { bold: true },
          ),
        ],
        "",
        [richLine(["Dear ", { variable: "company.contact" }, ","])],
        "",
        [
          richLine([
            "Thank you for the opportunity to submit this proposal. JBK, Inc. proposes to furnish all labor, materials, equipment and supervision for the work described below.",
          ]),
        ],
        "",
        [richLine(["Scope of work"], { bold: true })],
        [richLine([{ variable: "opportunity.scope" }])],
        "",
        [richLine(["Total: ", { variable: "opportunity.price" }], { bold: true })],
        "",
        "This proposal is valid for 30 days. Price excludes permits and work not listed above; any additional work will be quoted before it is performed.",
        "",
        "Sincerely,",
        "",
        [richLine([{ variable: "manager.name" }])],
        [
          richLine([
            "JBK, Inc. · ",
            { variable: "manager.phone" },
            " · ",
            { variable: "manager.email" },
          ]),
        ],
      ),
    ),
    newModule("signature"),
  ]);

  const ticketLetter = newPage([
    newModule("letterhead"),
    newModule("hr"),
    body(
      paras(
        [richLine([{ variable: "today" }])],
        "",
        [richLine([{ variable: "company.name" }])],
        [richLine([{ variable: "company.contact" }])],
        [richLine([{ variable: "property.address1" }])],
        [richLine([{ variable: "property.address2" }])],
        "",
        [
          richLine(
            ["Re: Ticket ", { variable: "ticket.number" }, " — ", { variable: "property.name" }],
            { bold: true },
          ),
        ],
        "",
        [richLine(["Dear ", { variable: "company.contact" }, ","])],
        "",
        [richLine([{ variable: "ticket.description" }])],
        "",
        "Please find the details and photos of the work below.",
      ),
    ),
    newModule("twoPhotos"),
    body(
      paras(
        "Sincerely,",
        "",
        [richLine([{ variable: "manager.name" }])],
        [
          richLine([
            "JBK, Inc. · ",
            { variable: "manager.phone" },
            " · ",
            { variable: "manager.email" },
          ]),
        ],
      ),
    ),
  ]);

  // Phase 2 (owner, Oct 26): the inspection report — CenterPoint's Property Inspected / Property
  // Grade block, the findings as a Repair List with pictures, a photo page, the recommendation.
  const inspectionCover = newPage([
    newModule("letterhead"),
    newModule("hr"),
    body({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, textAlign: "center" },
          content: [{ type: "variable", attrs: { key: "property.name" } }],
        },
        {
          type: "heading",
          attrs: { level: 2, textAlign: "center" },
          content: [{ type: "text", text: "Roof Inspection Report" }],
        },
      ],
    }),
    { ...newModule("fullPhoto"), heightIn: 2.2 } as DocPage["modules"][number],
    newModule("hr"),
    body({
      type: "doc",
      content: [
        richLine(["Property Inspected: ", { variable: "inspection.date" }]),
        richLine(["Property Grade: ", { variable: "inspection.grade" }]),
        richLine(["Inspected By: ", { variable: "inspection.technician" }]),
        richLine(["Summary: ", { variable: "inspection.summary" }]),
        { type: "paragraph" },
        richLine([{ variable: "property.address1" }]),
        richLine([{ variable: "property.address2" }]),
      ],
    }),
  ]);
  const inspectionFindings = newPage([
    body({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Findings" }],
        },
      ],
    }),
    { ...newModule("repairList"), photos: true } as DocPage["modules"][number],
  ]);
  const inspectionPhotos = newPage([
    { ...newModule("photoGrid"), columns: 3 } as DocPage["modules"][number],
    body(
      paras([richLine(["Recommendation: ", { variable: "inspection.recommend" }], { bold: true })]),
    ),
    newModule("signature"),
  ]);

  // The Care plan report (owner, Nov 23): the same cover with the customer and, on a plan's
  // inspection, which inspection of the year it was and what was cleaned; then EVERY row of the
  // checklist in its order, each with its result, note and pictures (the rows found OK too);
  // then the issues again as a short list with no pictures. No price anywhere.
  const carePlanCover = newPage([
    newModule("letterhead"),
    newModule("hr"),
    body({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, textAlign: "center" },
          content: [{ type: "variable", attrs: { key: "property.name" } }],
        },
        {
          type: "heading",
          attrs: { level: 2, textAlign: "center" },
          content: [{ type: "text", text: "Roof Care Plan Report" }],
        },
        // Blank on a ticket that is not a plan's inspection.
        richLine([{ variable: "careplan.plan" }], { align: "center" }),
        richLine([{ variable: "careplan.cleaning" }], { align: "center" }),
      ],
    }),
    { ...newModule("fullPhoto"), heightIn: 2.2 } as DocPage["modules"][number],
    newModule("hr"),
    body({
      type: "doc",
      content: [
        richLine(["Customer: ", { variable: "company.name" }]),
        richLine(["Property Inspected: ", { variable: "inspection.date" }]),
        richLine(["Inspected By: ", { variable: "inspection.technician" }]),
        richLine(["Summary: ", { variable: "inspection.summary" }]),
        // A whole line, blank when the inspection has no grade.
        richLine([{ variable: "inspection.grade.line" }]),
        { type: "paragraph" },
        richLine([{ variable: "property.address1" }]),
        richLine([{ variable: "property.address2" }]),
      ],
    }),
  ]);
  const carePlanChecklist = newPage([
    body({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Checklist" }],
        },
      ],
    }),
    // Every row: split into one Checklist item each when the report is made.
    {
      ...newModule("repairList"),
      allItems: true,
      showStatus: true,
    } as DocPage["modules"][number],
    body({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Items needing attention" }],
        },
      ],
    }),
    // The issues again, as a table with no pictures: it is never split.
    { ...newModule("repairList"), listOnly: true } as DocPage["modules"][number],
    body(
      paras([richLine(["Recommendation: ", { variable: "inspection.recommend" }], { bold: true })]),
    ),
  ]);

  return [
    {
      kind: "bid",
      name: "Proposal",
      description:
        "Cover page with the property photo and 'Submitted to', then the proposal letter, pricing and signature.",
      options: { ...DEFAULT_OPTIONS },
      pages: [proposalCover, proposalLetter],
    },
    {
      kind: "bid",
      name: "Scope letter (no prices)",
      description: "The proposal letter without the pricing table or total.",
      options: { ...DEFAULT_OPTIONS, prices: "none" },
      pages: [proposalLetter],
    },
    {
      kind: "bid",
      name: TRADE_PROPOSAL_TEMPLATE,
      description:
        "For a trade bid (painting, siding): the letter with the job type, the scope of work, the total and a signature.",
      options: { ...DEFAULT_OPTIONS },
      pages: [tradeLetter],
    },
    {
      kind: "ticket",
      name: "Service letter",
      description: "A letter about a service ticket with two photos.",
      options: { ...DEFAULT_OPTIONS },
      pages: [ticketLetter],
    },
    {
      kind: "ticket",
      name: INSPECTION_REPORT_TEMPLATE,
      description:
        "Cover page with the property photo, the inspection date and grade, then the findings with their pictures, a photo page and the recommendation.",
      options: { ...DEFAULT_OPTIONS, prices: "none" },
      pages: [inspectionCover, inspectionFindings, inspectionPhotos],
    },
    {
      kind: "ticket",
      name: CARE_PLAN_REPORT_TEMPLATE,
      description:
        "Cover page with the property photo, the customer and the inspection, then every row of the checklist with its result, note and pictures, then the items needing attention.",
      options: { ...DEFAULT_OPTIONS, prices: "none" },
      pages: [carePlanCover, carePlanChecklist],
    },
  ];
}
