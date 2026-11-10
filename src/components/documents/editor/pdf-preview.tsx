/**
 * An inserted PDF, drawn in the editor (owner, Nov 10: "when you import a pdf it is not shown" —
 * the module used to be a grey bar with the file's name). Each page is rendered with pdf.js (the
 * loader the Takeoff page uses, browser only) at the sheet's width; the first
 * PDF_PREVIEW_MAX_PAGES are drawn and the rest counted. Nothing here is saved or printed: the
 * server still splices the PDF's own pages into the export.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { closePdf, openPdf } from "@/components/takeoff/underlay";
import { pdfPreviewPages } from "@/lib/documents/editor-helpers";
import { documentAssetUrl } from "@/lib/documents.functions";

export function PdfPreview(props: { assetId: string; pageCount: number }) {
  const urlFn = useServerFn(documentAssetUrl);
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [drawn, setDrawn] = useState(0);
  const { more } = pdfPreviewPages(props.pageCount);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let live = true;
    let doc: Awaited<ReturnType<typeof openPdf>> | null = null;
    setState("loading");
    setDrawn(0);
    host.replaceChildren();
    void (async () => {
      const { url } = await urlFn({ data: { id: props.assetId } });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`the file could not be read (${res.status})`);
      doc = await openPdf(await res.arrayBuffer());
      if (!live) return;
      const { shown } = pdfPreviewPages(doc.numPages);
      const cssWidth = Math.max(240, host.clientWidth || 700);
      const sharp = Math.min(2, window.devicePixelRatio || 1);
      for (let i = 1; i <= shown; i++) {
        const page = await doc.getPage(i);
        if (!live) return;
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (cssWidth / base.width) * sharp });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.style.display = "block";
        canvas.setAttribute("data-pdf-page", String(i));
        canvas.setAttribute("aria-label", `Page ${i} of the inserted PDF`);
        await page.render({ canvas, viewport: vp }).promise;
        if (!live) return;
        const frame = document.createElement("div");
        frame.className =
          "overflow-hidden rounded border border-neutral-300 bg-white shadow-sm dark:border-neutral-300 dark:bg-white";
        frame.appendChild(canvas);
        host.appendChild(frame);
        setDrawn(i);
      }
      setState("ready");
    })().catch((e: unknown) => {
      if (!live) return;
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    });
    return () => {
      live = false;
      if (doc) closePdf(doc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one read per inserted PDF
  }, [props.assetId]);

  return (
    <div data-pdf-preview={state} contentEditable={false}>
      {state === "loading" && (
        <p className="flex items-center gap-2 px-1 py-2 text-xs text-neutral-500 dark:text-neutral-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {drawn ? `Drawing the PDF, page ${drawn + 1}…` : "Opening the PDF…"}
        </p>
      )}
      {state === "error" && (
        <p className="px-1 py-2 text-xs text-red-700">
          The PDF's pages could not be shown here ({error}). It still prints with the document.
        </p>
      )}
      <div ref={hostRef} className="space-y-2" />
      {state === "ready" && more > 0 && (
        <p className="px-1 pt-2 text-xs text-neutral-500 dark:text-neutral-500">
          and {more} more {more === 1 ? "page" : "pages"} not drawn here; all of them print.
        </p>
      )}
    </div>
  );
}
