/**
 * Order list exports: the rows as a sheet (Excel) and as a printable page (Print → Save as PDF).
 * Pure row-building here; the browser bits (download, print window) are thin wrappers.
 */
import { describeOrderQty, orderListTotal, type OrderLine } from "@/lib/order-list";

export interface OrderListHeader {
  bidName: string;
  client?: string | undefined;
  jobSite?: string | undefined;
  printedAt?: Date | undefined;
}

/**
 * What the Excel button says when the Excel part could not be fetched (Nov 10: it is fetched
 * when Export is pressed, not with the estimator — the speed pass, finding 9).
 */
export const EXCEL_LOAD_FAILED =
  "Could not get the Excel part of the page. Check the connection and press Excel again";

export const ORDER_COLUMNS = [
  "Group",
  "Product",
  "Needed",
  "Unit",
  "Price each",
  "Material total",
  "From stock",
  "On hand",
  "To buy",
];

const num = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 100) / 100);

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** A catalog price for the page: "$1,234.56", or "—" where the catalog has none. */
export const orderMoney = (n: number | undefined): string =>
  n === undefined ? "—" : USD.format(n);

/** One row per line: numbers stay numbers so the sheet can sum them. */
export function orderListRows(lines: readonly OrderLine[]): Array<Array<string | number>> {
  return lines.map((l) => [
    l.group,
    l.name,
    num(l.needed),
    l.unit,
    l.unitPrice ?? "",
    l.total ?? "",
    l.pulled > 0 ? num(l.pulled) : "",
    l.onHand !== undefined ? num(l.onHand) : l.stockUnit ? `shelf in ${l.stockUnit}` : "",
    num(l.toBuy),
  ]);
}

/** Every product with something left to buy, for the summary line and the print page. */
export const toBuyCount = (lines: readonly OrderLine[]) => lines.filter((l) => l.toBuy > 0).length;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A self-contained printable page (the browser's Print dialog saves it as a PDF). */
export function orderListHtml(lines: readonly OrderLine[], h: OrderListHeader): string {
  const when = (h.printedAt ?? new Date()).toLocaleString();
  const totals = orderListTotal(lines);
  const groups = ["Membrane", "Underlayment", "Fasteners", "Adhesives", "Accessories"] as const;
  const body = groups
    .filter((g) => lines.some((l) => l.group === g))
    .map(
      (g) =>
        `<tr class="g"><td colspan="7">${esc(g)}</td></tr>` +
        lines
          .filter((l) => l.group === g)
          .map(
            (l) =>
              `<tr class="${l.toBuy > 0 ? "" : "done"}"><td>${esc(l.name)}</td>` +
              `<td class="n">${esc(describeOrderQty(l, l.needed))}${
                l.pieces !== undefined ? ` <small>(${l.pieces.toLocaleString()} pcs)</small>` : ""
              }</td>` +
              `<td class="n">${esc(orderMoney(l.unitPrice))}${
                l.unitPrice !== undefined ? ` <small>/ ${esc(l.unit)}</small>` : ""
              }</td>` +
              `<td class="n">${esc(orderMoney(l.total))}</td>` +
              `<td class="n">${l.pulled > 0 ? esc(describeOrderQty(l, l.pulled)) : "—"}</td>` +
              `<td class="n">${
                l.onHand !== undefined
                  ? esc(describeOrderQty(l, l.onHand))
                  : l.stockUnit
                    ? `<small>shelf in ${esc(l.stockUnit)}</small>`
                    : "—"
              }</td>` +
              `<td class="n b">${esc(describeOrderQty(l, l.toBuy))}</td></tr>`,
          )
          .join(""),
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Order list — ${esc(h.bidName)}</title>
<style>
body{font:12px/1.35 system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:24px}
h1{font-size:18px;margin:0 0 2px}
.meta{color:#555;margin:0 0 14px}
table{border-collapse:collapse;width:100%}
th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#555}
td.n,th.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
td.b{font-weight:600}
tr.g td{background:#f2f2f2;font-weight:600;padding-top:8px}
tr.done td{color:#777}
tr.t td{border-top:2px solid #bbb;border-bottom:0;padding-top:8px;font-weight:600}
small{color:#777}
.foot{margin-top:14px;color:#555;font-size:11px}
@media print{body{margin:12mm}}
</style></head><body>
<h1>Order list — ${esc(h.bidName)}</h1>
<p class="meta">${[h.client, h.jobSite]
    .filter((x): x is string => !!x)
    .map(esc)
    .join(" · ")}${h.client || h.jobSite ? " · " : ""}printed ${esc(when)}</p>
<table><thead><tr><th>Product</th><th class="n">Needed</th><th class="n">Price each</th><th class="n">Material total</th><th class="n">From stock</th><th class="n">On hand</th><th class="n">To buy</th></tr></thead>
<tbody>${body}</tbody>
<tfoot><tr class="t"><td colspan="3">Material total (price each × needed)</td><td class="n b">${esc(orderMoney(totals.total))}</td><td colspan="3">${
    totals.unpriced > 0
      ? `<small>${totals.unpriced} product${totals.unpriced === 1 ? " has" : "s have"} no catalog price and ${totals.unpriced === 1 ? "is" : "are"} not in the total</small>`
      : ""
  }</td></tr></tfoot></table>
<p class="foot">${toBuyCount(lines)} of ${lines.length} products still to buy. Quantities are what the bid bills, less what Inventory pulled for this job; the bid's price is unaffected by stock. Price each is the catalog price the bid prices from; Material total is for the whole job, before anything taken from inventory.</p>
</body></html>`;
}
