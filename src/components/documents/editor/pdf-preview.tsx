/**
 * An inserted PDF on the canvas: each of its pages is a sheet of its own in the page lineup
 * (owner, Nov 10: "the pdf pages should just be in the page lineup normally" — it used to be one
 * sheet holding a grey bar with the file's name, then one tall sheet with every page stacked in
 * it). Each page is drawn with pdf.js (the Takeoff page's loader, browser only) to the sheet's
 * full width, edge to edge, as it prints: the server splices the PDF's own pages into the
 * export. The first PDF_PREVIEW_MAX_PAGES are drawn and the rest counted. The first sheet's tab
 * carries the module's Move up / Move down / Delete (the module has no body to hover).
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { closePdf, openPdf } from "@/components/takeoff/underlay";
import {
  pageDomId,
  pageTabLabel,
  pdfPreviewPages,
  pdfSheetLabel,
  SHEET,
  SHEET_OF_ATTR,
} from "@/lib/documents/editor-helpers";
import { addModule, moveModule, type PdfModule, removeModule } from "@/lib/documents/model";
import { documentAssetUrl } from "@/lib/documents.functions";
import { cn } from "@/lib/utils";

import { useEditorEnv } from "./editor-context";
import { ScaledSheet } from "./scaled-sheet";

export function PdfSheets(props: {
  module: PdfModule;
  /** The page it sits on, and where on it (for Undo after a delete). */
  pageId: string;
  pageIndex: number;
  moduleIndex: number;
  /** True when this is the page's first sheet (it then carries the page's DOM id). */
  first: boolean;
  selected: boolean;
  scale: number;
}) {
  const env = useEditorEnv();
  const m = props.module;
  const urlFn = useServerFn(documentAssetUrl);
  const frames = useRef<Array<HTMLDivElement | null>>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const { shown, more } = pdfPreviewPages(m.pageCount);

  useEffect(() => {
    let live = true;
    let doc: Awaited<ReturnType<typeof openPdf>> | null = null;
    setState("loading");
    for (const f of frames.current) f?.replaceChildren();
    void (async () => {
      const { url } = await urlFn({ data: { id: m.assetId } });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`the file could not be read (${res.status})`);
      doc = await openPdf(await res.arrayBuffer());
      if (!live) return;
      const sharp = Math.min(2, window.devicePixelRatio || 1);
      for (let i = 1; i <= Math.min(shown, doc.numPages); i++) {
        const page = await doc.getPage(i);
        if (!live) return;
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (SHEET.width / base.width) * sharp });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.style.display = "block";
        canvas.setAttribute("data-pdf-page", String(i));
        canvas.setAttribute("aria-label", `Page ${i} of ${m.name}`);
        await page.render({ canvas, viewport: vp }).promise;
        if (!live) return;
        frames.current[i - 1]?.replaceChildren(canvas);
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
  }, [m.assetId, shown]);

  const select = () => {
    if (!props.selected) env.dispatch({ type: "selectPage", pageId: props.pageId });
  };
  const tool = "rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground";
  return (
    <>
      {Array.from({ length: Math.max(1, shown) }, (_, k) => (
        <div
          key={k}
          className={!props.first || k > 0 ? "mt-4" : undefined}
          data-pdf-sheet={k + 1}
          {...{ [SHEET_OF_ATTR]: props.pageId }}
          data-module-type={k === 0 ? "pdf" : undefined}
        >
          <div className="mb-1 flex items-end gap-2">
            <button
              type="button"
              className={cn(
                "rounded-t-md border border-b-0 px-3 py-1 text-xs font-medium",
                props.selected
                  ? "bg-card text-card-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
              title="Select this page (the Modules tab adds here)"
              onClick={() => env.dispatch({ type: "selectPage", pageId: props.pageId })}
            >
              {pdfSheetLabel(pageTabLabel(props.pageIndex), m.name, k + 1, m.pageCount)}
            </button>
            {k === 0 && (
              <span className="flex items-center gap-0.5 pb-0.5" role="toolbar" aria-label="PDF">
                <button
                  type="button"
                  className={tool}
                  title="Move this PDF up"
                  onClick={() =>
                    env.dispatch({ type: "setPages", op: (p) => moveModule(p, m.id, -1) })
                  }
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className={tool}
                  title="Move this PDF down"
                  onClick={() =>
                    env.dispatch({ type: "setPages", op: (p) => moveModule(p, m.id, 1) })
                  }
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className={cn(tool, "hover:text-destructive")}
                  title="Take this PDF out of the document (it stays in the library)"
                  onClick={() => {
                    env.dispatch({ type: "setPages", op: (p) => removeModule(p, m.id) });
                    const { pageIndex, moduleIndex } = props;
                    toast(`“${m.name}” taken out`, {
                      action: {
                        label: "Undo",
                        onClick: () =>
                          env.dispatch({
                            type: "setPages",
                            op: (p) => addModule(p, pageIndex, m, moduleIndex),
                          }),
                      },
                    });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </div>
          <ScaledSheet scale={props.scale}>
            <div
              id={props.first && k === 0 ? pageDomId(props.pageId) : undefined}
              // The paper: white in both themes, like every sheet (dark-mode.test.ts allowlist).
              className={cn(
                "document-sheet relative overflow-hidden bg-white text-black shadow-md ring-1 ring-black/10 dark:bg-white dark:text-black",
                props.selected && "ring-2 ring-primary",
              )}
              style={{ width: SHEET.width, minHeight: SHEET.height }}
              onMouseDown={select}
            >
              <div
                ref={(el) => {
                  frames.current[k] = el;
                }}
              />
              {state === "loading" && (
                <p className="absolute left-6 top-6 flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Opening “{m.name}”…
                </p>
              )}
              {state === "error" && k === 0 && (
                <p className="absolute left-6 right-6 top-6 text-sm text-red-700">
                  “{m.name}” could not be shown here ({error}). It still prints with the document,{" "}
                  {m.pageCount} {m.pageCount === 1 ? "page" : "pages"}.
                </p>
              )}
            </div>
          </ScaledSheet>
        </div>
      ))}
      {more > 0 && (
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-pdf-more={more}
          {...{ [SHEET_OF_ATTR]: props.pageId }}
        >
          “{m.name}” has {more} more {more === 1 ? "page" : "pages"} not drawn here. All of them
          print.
        </p>
      )}
    </>
  );
}
