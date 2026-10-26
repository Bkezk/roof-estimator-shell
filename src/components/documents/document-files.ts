/**
 * Browser-side file helpers for the Documents actions: the server's base64 PDF shown in a new
 * tab, and the email boxes' address parsing. Kept apart from the components so fast refresh
 * stays whole.
 */

/** The server's base64 PDF as a Blob. */
export function pdfBlobFromBase64(base64: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}

/** Show a PDF in a new tab (a blocked pop-up falls back to a download). */
export function openPdfBase64(base64: string, fileName: string) {
  const blob = pdfBlobFromBase64(base64);
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}

/** Emails typed into a free box, split on commas, semicolons or spaces. */
export const splitEmails = (s: string) =>
  s
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (s: string) => EMAIL.test(s);
