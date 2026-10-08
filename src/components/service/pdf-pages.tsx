/**
 * A PDF's pages drawn in the page with pdf.js, one canvas per page, as wide as the box allows.
 * Used by the invoice preview instead of an <iframe> on a blob URL: that hands the PDF to
 * Chrome's own viewer, which Chrome blocks inside a sandboxed frame such as the Lovable preview
 * (owner, Oct 8: "this page is blocked by chrome"). pdf.js is loaded lazily in the browser only,
 * through the takeoff underlay's loader.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { closePdf, openPdf } from "@/components/takeoff/underlay";
import { errText } from "@/components/service/invoice-utils";

export function PdfPages({ blob, title }: { blob: Blob; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | { error: string }>("loading");

  useEffect(() => {
    let cancelled = false;
    let opened: Awaited<ReturnType<typeof openPdf>> | null = null;
    setState("loading");
    void (async () => {
      const doc = await openPdf(await blob.arrayBuffer());
      opened = doc;
      const box = host.current;
      if (cancelled || !box) return;
      box.replaceChildren();
      const width = Math.max(320, Math.min(box.clientWidth - 24, 900));
      const dpr = window.devicePixelRatio || 1;
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        // Paper stays white in dark mode too.
        canvas.className = "mx-auto mb-3 block max-w-full bg-white shadow dark:bg-white";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `${title}, page ${n} of ${doc.numPages}`);
        await page.render({ canvas, viewport }).promise;
        if (cancelled) return;
        box.appendChild(canvas);
      }
      setState("ready");
    })().catch((e: unknown) => {
      if (!cancelled) setState({ error: errText(e) });
    });
    return () => {
      cancelled = true;
      if (opened) closePdf(opened);
    };
  }, [blob, title]);

  return (
    <div className="h-full overflow-auto p-3">
      {state === "loading" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Drawing the PDF…
        </p>
      )}
      {typeof state === "object" && (
        <p className="text-sm text-destructive">
          Could not show the PDF here ({state.error}). Download it, or open it in a new tab.
        </p>
      )}
      <div ref={host} />
    </div>
  );
}
