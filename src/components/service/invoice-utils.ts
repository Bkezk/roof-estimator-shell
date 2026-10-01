/**
 * Small helpers shared by the invoice card on a ticket (invoice-block.tsx), the invoice page
 * (invoice-editor.tsx) and the Invoices list (invoices-page.tsx): the query keys, money, local
 * calendar days, status labels and turning the server's base64 PDF / CSV into something the
 * browser opens or saves.
 */
import { INVOICE_STATUSES, type InvoiceStatus } from "@/lib/invoices.functions";

/** Every invoice query of a ticket on its card (the prefix). */
export const invoiceKey = (jobId: string) => ["ticket-invoice", jobId] as const;
/** One invoice as the ticket's card shows it. */
export const oneInvoiceKey = (jobId: string, id: string) => ["ticket-invoice", jobId, id] as const;
/** A ticket's invoices (the chips). */
export const ticketInvoicesKey = (jobId: string) => ["ticket-invoices", jobId] as const;
/** One invoice on the full-width page. */
export const invoicePageKey = (id: string) => ["invoice-page", id] as const;

/** The Delete draft confirmation's text (the page and the ticket's card say the same). */
export const deleteDraftNote = (ticketNumber: number, label: string) =>
  `The draft and its lines are removed. The next invoice made for ticket #${ticketNumber} takes number ${label}.`;

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** $1,234.56 (and -$5.00). */
export const money = (n: number | string | null | undefined) => USD.format(Number(n ?? 0) || 0);
/** Cents-rounded, like the server (invoices.server.ts r2). */
export const r2 = (n: number) => Math.round(n * 100) / 100;

const pad = (n: number) => String(n).padStart(2, "0");
export const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayYmd = () => toYmd(new Date());
/** The first and last day of this month, as YYYY-MM-DD. */
export const thisMonth = () => {
  const now = new Date();
  return {
    from: toYmd(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toYmd(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
};
/** A date-only column (YYYY-MM-DD) read as a local calendar day, not UTC midnight. */
export const shortDay = (ymd: string | null | undefined) => {
  if (!ymd) return "";
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};
/** A timestamp as a local day. */
export const stampDay = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";

/** A fraction (0.075) as a percent number (7.5), without float noise. */
export const toPct = (frac: number | string) => Number((Number(frac) * 100).toFixed(4));
/** A percent number (7.5) as a fraction (0.075). */
export const fromPct = (pct: number) => Number((pct / 100).toFixed(6));

export const asInvoiceStatus = (s: string): InvoiceStatus =>
  (INVOICE_STATUSES as readonly string[]).includes(s) ? (s as InvoiceStatus) : "draft";
export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  final: "Final",
  sent: "Sent",
  paid: "Paid",
  void: "Void",
};
export const STATUS_CLASS: Record<InvoiceStatus, string> = {
  draft:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100",
  final:
    "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
  sent: "border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-100",
  paid: "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100",
  void: "border-border bg-muted text-muted-foreground line-through",
};

export const PAYMENT_METHODS = ["Check", "Card", "ACH", "Cash", "Other"] as const;

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
export const isEmail = (s: string) => EMAIL.test(s);
/** Emails typed into a free box, split on commas, semicolons or spaces. */
export const splitEmails = (s: string) =>
  s
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** The server's base64 PDF as a Blob. */
export function pdfBlob(base64: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}

/** Save a blob under a file name (the browser's download). */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Show the PDF in a tab opened during the click (`win`, so a popup blocker lets it through);
 * without one, save it instead.
 */
export function showPdf(win: Window | null, base64: string, fileName: string) {
  const blob = pdfBlob(base64);
  if (!win || win.closed) {
    downloadBlob(blob, fileName);
    return;
  }
  const url = URL.createObjectURL(blob);
  win.location.href = url;
  window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}
/** A blank tab opened synchronously in a click, showing a wait note until the PDF arrives. */
export function openPdfTab(): Window | null {
  const w = window.open("", "_blank");
  try {
    w?.document.write(
      '<p style="font:14px system-ui,sans-serif;padding:24px;color:#555">Rendering the invoice…</p>',
    );
  } catch {
    // Some browsers refuse writing into the new tab; it just stays blank until the PDF loads.
  }
  return w;
}
