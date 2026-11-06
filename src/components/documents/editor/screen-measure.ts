/**
 * The PDF's text metrics in the browser (Nov 6: the editor's sheets follow the PDF's own
 * pagination, screen-pagination.ts). pdf-lib's standard Helvetica — the very fonts the server
 * prints with — is loaded once, on demand, and `widthOfTextAtSize` is cached per text, font and
 * size. Until it has loaded the canvas packs by measured heights as before.
 */
import { useEffect, useState } from "react";

import { type FontKey, type Measure, pdfSafeText } from "@/lib/documents/pdf-layout";

let loading: Promise<Measure> | null = null;

export function loadPdfMeasure(): Promise<Measure> {
  if (!loading)
    loading = (async () => {
      const { PDFDocument, StandardFonts } = await import("pdf-lib");
      const pdf = await PDFDocument.create();
      const fonts = {
        regular: await pdf.embedFont(StandardFonts.Helvetica),
        bold: await pdf.embedFont(StandardFonts.HelveticaBold),
        italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
        boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
      } satisfies Record<FontKey, unknown>;
      const cache = new Map<string, number>();
      return (text, font, size) => {
        const k = `${font}\u0000${size}\u0000${text}`;
        let w = cache.get(k);
        if (w === undefined) {
          w = fonts[font].widthOfTextAtSize(pdfSafeText(text), size);
          if (cache.size > 50_000) cache.clear();
          cache.set(k, w);
        }
        return w;
      };
    })();
  return loading;
}

/** The measure once loaded; null before (and on the server). */
export function usePdfMeasure(): Measure | null {
  const [measure, setMeasure] = useState<Measure | null>(null);
  useEffect(() => {
    let on = true;
    loadPdfMeasure()
      .then((m) => {
        if (on) setMeasure(() => m);
      })
      .catch(() => {
        /* the canvas keeps packing by measured heights */
      });
    return () => {
      on = false;
    };
  }, []);
  return measure;
}
