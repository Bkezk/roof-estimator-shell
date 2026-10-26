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
    { ...newModule("fullPhoto"), heightIn: 3.4 } as DocPage["modules"][number],
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
      kind: "ticket",
      name: "Service letter",
      description: "A letter about a service ticket with two photos.",
      options: { ...DEFAULT_OPTIONS },
      pages: [ticketLetter],
    },
  ];
}
