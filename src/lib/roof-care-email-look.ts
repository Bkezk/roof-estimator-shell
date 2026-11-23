/**
 * The look of a Roof Care email to a customer (owner, Nov 23, on the first agreement that reached
 * his inbox: "id rather it be more visual like the handout i gave you for reference").
 *
 * The handout's parts, as the sign-up and the public pages already wear them (components/
 * roof-care/flyer-look.tsx), rebuilt for a mail program:
 *
 *  - the company's name at the top, with what it does and where;
 *  - the lime-green band with the heavy, condensed headline in capitals;
 *  - numbered headings: the number on a green square, the title in heavy blue capitals over a rule;
 *  - the plan as a card: its name, one bold line of what it is, the price in the heavy face with
 *    "per year" under it, then the facts of this customer's plan;
 *  - lists with small green squares;
 *  - the deep blue band at the foot with white print.
 *
 * A mail program is not a browser: it drops style sheets, web fonts and often pictures. So every
 * style is written on its own element, the layout is tables, the faces are ones a computer or a
 * phone already has, and there is no picture at all: the email reads the same with pictures
 * switched off, and a picture-heavy email is more likely to be put in the spam folder.
 *
 * Pure: it turns blocks into HTML and knows no price and no customer. The plain-text copy of the
 * same email is made beside it (roof-care-email.ts) and is not changed by any of this.
 */

/** The handout's colours (styles.css: --jbk-green, --jbk-blue, --flyer-*). */
export const EMAIL_GREEN = "#7eaf28";
export const EMAIL_BLUE = "#014b96";
const INK = "#15171b";
const RULE = "#23262c";
const SOFT = "#566070";
const TINT = "#eaf2fb";
const PAPER = "#ffffff";
const DESK = "#eef1f5";

/** The headline face, and the ones a device has when it lacks it. */
const HEAD =
  "font-family:'Barlow Condensed','Arial Narrow','Roboto Condensed','Helvetica Neue',Arial,sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:0.01em;";
const BODY = "font-family:Arial,Helvetica,sans-serif;";

/** Under the company's name, as on the handout's masthead. */
export const EMAIL_MAST_LINE = "Commercial & Industrial Roofing";
export const EMAIL_MAST_PLACE = "Kentucky | Tennessee";

export const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The plan, or the receipt, as a card. Every word and number is handed in. */
export interface EmailCard {
  /** "Roof Watch", in the heavy blue face. */
  name: string;
  /** One bold line under the name; left out when empty. */
  pitch?: string;
  /** "$4,321", in the heavy face. */
  big: string;
  /** "per year", under it. */
  under: string;
  /** The facts under the rule: a label and its value, or a line by itself (label ""). */
  rows: readonly { label: string; value: string }[];
}

export type EmailBlock =
  | { kind: "p"; text: string; role?: "note" | "foot" }
  | { kind: "h"; text: string }
  | { kind: "link"; text: string; url: string }
  | { kind: "ul" | "ol"; items: string[]; card?: EmailCard };

export interface EmailHead {
  /** The company's name, at the top. */
  company: string;
  /** The headline in the green band, and the line under it. */
  title: string;
  lead?: string;
}

const squares = (items: readonly string[]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 14px">` +
  items
    .map(
      (t) =>
        `<tr><td width="16" valign="top" style="width:16px;padding:7px 0 0"><div style="width:7px;height:7px;background:${EMAIL_GREEN};font-size:0;line-height:0">&nbsp;</div></td>` +
        `<td valign="top" style="${BODY}font-size:15px;line-height:1.45;color:${INK};padding:0 0 6px">${escHtml(t)}</td></tr>`,
    )
    .join("") +
  `</table>`;

const card = (c: EmailCard) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 16px;background:${TINT};border:2px solid ${EMAIL_BLUE}"><tr><td style="padding:18px 20px">` +
  `<div style="${HEAD}font-size:34px;line-height:1;color:${EMAIL_BLUE}">${escHtml(c.name)}</div>` +
  (c.pitch
    ? `<div style="${BODY}font-size:15px;line-height:1.35;font-weight:bold;color:${INK};padding:6px 0 0">${escHtml(c.pitch)}</div>`
    : "") +
  `<div style="border-top:2px solid ${RULE};margin:12px 0 10px;font-size:0;line-height:0">&nbsp;</div>` +
  `<div style="${HEAD}font-size:42px;line-height:1;color:${INK}">${escHtml(c.big)}</div>` +
  `<div style="${BODY}font-size:14px;line-height:1.3;color:${SOFT};padding:2px 0 0">${escHtml(c.under)}</div>` +
  `<div style="border-top:2px solid ${RULE};margin:12px 0 10px;font-size:0;line-height:0">&nbsp;</div>` +
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%">` +
  c.rows
    .map((r) =>
      r.label
        ? `<tr><td valign="top" style="${BODY}font-size:12px;line-height:1.4;font-weight:bold;text-transform:uppercase;letter-spacing:0.06em;color:${EMAIL_BLUE};padding:4px 12px 4px 0;white-space:nowrap">${escHtml(r.label)}</td>` +
          `<td valign="top" style="${BODY}font-size:15px;line-height:1.4;color:${INK};padding:3px 0">${escHtml(r.value)}</td></tr>`
        : `<tr><td colspan="2" style="${BODY}font-size:14px;line-height:1.4;color:${SOFT};padding:6px 0 0">${escHtml(r.value)}</td></tr>`,
    )
    .join("") +
  `</table></td></tr></table>`;

const stepHead = (n: number, text: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:22px 0 12px;border-bottom:2px solid ${RULE}"><tr>` +
  `<td width="32" align="center" valign="middle" style="width:32px;height:32px;background:${EMAIL_GREEN};${HEAD}font-size:21px;line-height:32px;color:${INK}">${n}</td>` +
  `<td valign="middle" style="${HEAD}font-size:24px;line-height:1.05;color:${EMAIL_BLUE};padding:4px 0 6px 10px">${escHtml(text)}</td>` +
  `</tr></table>`;

const lines = (s: string) => escHtml(s).replace(/\n/g, "<br>");

/** The whole email, as a mail program shows it. */
export function flyerEmailHtml(head: EmailHead, blocks: readonly EmailBlock[]): string {
  let step = 0;
  const body = blocks
    .filter((b) => !(b.kind === "p" && b.role === "foot"))
    .map((b) => {
      if (b.kind === "p")
        return b.role === "note"
          ? `<p style="${BODY}font-size:13px;line-height:1.45;color:${SOFT};margin:0 0 12px">${lines(b.text)}</p>`
          : `<p style="${BODY}font-size:15px;line-height:1.5;color:${INK};margin:0 0 12px">${lines(b.text)}</p>`;
      if (b.kind === "h") return stepHead(++step, b.text);
      if (b.kind === "link")
        return (
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 10px"><tr><td style="background:${EMAIL_BLUE}">` +
          `<a href="${escHtml(b.url)}" style="display:inline-block;padding:14px 26px;${HEAD}font-size:22px;line-height:1;color:#ffffff;text-decoration:none">${escHtml(b.text)}</a></td></tr></table>` +
          `<p style="${BODY}font-size:13px;line-height:1.45;color:${SOFT};margin:0 0 12px">Or open this address: ${escHtml(b.url)}</p>`
        );
      if (b.kind === "ul") return b.card ? card(b.card) : squares(b.items);
      return (
        `<ol style="${BODY}font-size:13px;line-height:1.5;color:${INK};margin:0 0 14px;padding:12px 14px 8px 34px;background:#f5f6f8;border:1px solid #d5dae2">` +
        b.items.map((t) => `<li style="margin-bottom:4px">${escHtml(t)}</li>`).join("") +
        `</ol>`
      );
    })
    .join("");
  const foot = blocks
    .filter(
      (b): b is { kind: "p"; text: string; role: "foot" } => b.kind === "p" && b.role === "foot",
    )
    .map(
      (b, i) =>
        `<p style="${BODY}font-size:${i === 0 ? 15 : 14}px;line-height:1.5;color:#ffffff;margin:0 0 ${i === 0 ? 10 : 0}px${i === 0 ? ";font-weight:bold" : ""}">${lines(b.text)}</p>`,
    )
    .join("");
  return (
    `<div style="margin:0;padding:0;background:${DESK}">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background:${DESK}"><tr><td align="center" style="padding:16px 8px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="width:100%;max-width:640px;background:${PAPER};border:1px solid #d5dae2;text-align:left">` +
    // The masthead: the company's name, and what it does and where.
    `<tr><td style="padding:16px 28px 14px;background:${PAPER}"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr>` +
    `<td valign="middle" style="${HEAD}font-size:26px;line-height:1;color:${EMAIL_BLUE}">${escHtml(head.company)}</td>` +
    `<td valign="middle" align="right" style="${BODY}font-size:11px;line-height:1.4;font-weight:bold;text-transform:uppercase;letter-spacing:0.12em;color:${EMAIL_BLUE}">${escHtml(EMAIL_MAST_LINE)}<br><span style="font-size:13px;letter-spacing:0;text-transform:none;color:${INK}">${escHtml(EMAIL_MAST_PLACE)}</span></td>` +
    `</tr></table></td></tr>` +
    // The green band with the headline.
    `<tr><td style="padding:22px 28px;background:${EMAIL_GREEN}">` +
    `<div style="${HEAD}font-size:44px;line-height:0.98;color:${INK}">${escHtml(head.title)}</div>` +
    (head.lead
      ? `<div style="${BODY}font-size:16px;line-height:1.4;font-weight:bold;color:${INK};padding:8px 0 0">${escHtml(head.lead)}</div>`
      : "") +
    `</td></tr>` +
    `<tr><td style="padding:22px 28px 8px;background:${PAPER}">${body}</td></tr>` +
    (foot ? `<tr><td style="padding:20px 28px;background:${EMAIL_BLUE}">${foot}</td></tr>` : "") +
    `</table></td></tr></table></div>`
  );
}
