/**
 * The page canvas: a grey ground with one white US-Letter sheet per page (816 × 1056 px at 96
 * dpi, 0.75 in padding), a "Page N" tab above each like CenterPoint, the dotted page-break guide
 * at options.pageBreakIn inches when the footer is on, and under each sheet "Insert PDF" (the PDF
 * library dialog, with Upload PDF) and "Add Page" (inserts after that page). The sheet shrinks to
 * fit a narrow canvas. Clicking a sheet selects it (the Modules tab adds there); a module tile
 * dragged from the Modules tab drops onto a sheet.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FilePlus2, FileUp, Loader2, Trash2 } from "lucide-react";

import {
  continuedTabLabel,
  MODULE_DRAG_TYPE,
  packIntoSheets,
  pageBreakPx,
  pageDomId,
  SHEET,
  sheetContentLimit,
  sheetScale,
} from "@/lib/documents/editor-helpers";
import {
  addModule,
  addPage,
  type DocOptions,
  type DocPage,
  MODULE_TYPES,
  type ModuleType,
  newModule,
  newPdfModule,
} from "@/lib/documents/model";
import {
  deleteDocumentAsset,
  listDocumentAssets,
  uploadDocumentAsset,
} from "@/lib/documents.functions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { assetsKey, type DocumentAssetRow, errText } from "../document-types";
import { useEditorEnv } from "./editor-context";
import { ModuleView } from "./module-view";

/** The print styles the rich text boxes need (Tailwind's preflight strips them). */
const DOC_PROSE_CSS = `
.document-sheet { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; line-height: 1.35; }
.document-sheet .doc-prose p { margin: 0 0 0.35em; min-height: 1.35em; }
.document-sheet .doc-prose h1 { font-size: 20pt; font-weight: 700; margin: 0 0 0.3em; line-height: 1.2; }
.document-sheet .doc-prose h2 { font-size: 15pt; font-weight: 700; margin: 0 0 0.3em; line-height: 1.2; }
.document-sheet .doc-prose h3 { font-size: 12.5pt; font-weight: 700; margin: 0 0 0.3em; line-height: 1.2; }
.document-sheet .doc-prose ul { list-style: disc; padding-left: 1.4em; margin: 0 0 0.35em; }
.document-sheet .doc-prose ol { list-style: decimal; padding-left: 1.4em; margin: 0 0 0.35em; }
.document-sheet .doc-prose li p { margin: 0; }
.document-sheet .doc-prose u { text-decoration: underline; }
.document-sheet .doc-prose .ProseMirror-selectednode { outline: 2px solid #60a5fa; }
.document-sheet .doc-prose strong { font-weight: 700; }
`;

export function PageCanvas(props: {
  pages: DocPage[];
  options: DocOptions;
  selectedPageId: string | null;
}) {
  const env = useEditorEnv();
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pdfFor, setPdfFor] = useState<number | null>(null);
  // How many sheets each page takes on screen (its modules packed up to the page break), so
  // the sheets' running numbers match what prints.
  const [sheetCounts, setSheetCounts] = useState<Record<string, number>>({});
  const onSheetCount = useCallback((pageId: string, n: number) => {
    setSheetCounts((prev) => (prev[pageId] === n ? prev : { ...prev, [pageId]: n }));
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setScale(sheetScale(el.clientWidth)));
    ro.observe(el);
    setScale(sheetScale(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const guide = pageBreakPx(props.options);
  let running = 0;
  return (
    <div ref={hostRef} className="min-h-full bg-muted/40 px-4 py-4" data-document-canvas>
      <style>{DOC_PROSE_CSS}</style>
      <div
        className="mx-auto flex flex-col items-center gap-6"
        style={{ width: SHEET.width * scale }}
      >
        {props.pages.map((page, i) => {
          const startNumber = running + 1;
          running += Math.max(1, sheetCounts[page.id] ?? 1);
          return (
            <div key={page.id} className="w-full">
              <PageSheets
                page={page}
                index={i}
                selected={props.selectedPageId === page.id}
                guide={guide}
                scale={scale}
                startNumber={startNumber}
                onSheetCount={onSheetCount}
              />
              <div className="mt-2 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  title="Insert a PDF from the library as the last module of this page"
                  onClick={() => setPdfFor(i)}
                >
                  <FileUp className="h-4 w-4" />
                  Insert PDF
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  title="Add a blank page after this one"
                  onClick={() =>
                    env.dispatch({
                      type: "setPages",
                      op: (pages) => {
                        const next = addPage(pages, i + 1);
                        return next;
                      },
                    })
                  }
                >
                  <FilePlus2 className="h-4 w-4" />
                  Add Page
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <InsertPdfDialog
        open={pdfFor !== null}
        onOpenChange={(o) => {
          if (!o) setPdfFor(null);
        }}
        onInsert={(asset) => {
          const at = pdfFor ?? 0;
          env.dispatch({
            type: "setPages",
            op: (pages) =>
              addModule(
                pages,
                at,
                newPdfModule({ id: asset.id, name: asset.name, pageCount: asset.page_count }),
              ),
          });
          setPdfFor(null);
          toast.success("PDF inserted");
        }}
      />
    </div>
  );
}

/** The gap between modules on a sheet (the flex column's gap-3), in px. */
const MODULE_GAP_PX = 12;

/**
 * One page's sheets: its modules are measured as they render and packed up to the page break
 * (owner, Oct 26: "the page breaks should start a new page to see what it looks like rather
 * than have it continue the page"); what does not fit starts the next sheet, labelled "Page N ·
 * continued". A module is never split on screen (the PDF splits text more finely, so a long
 * letter may print on fewer pages than it shows here).
 */
function PageSheets(props: {
  page: DocPage;
  index: number;
  selected: boolean;
  guide: number | null;
  scale: number;
  startNumber: number;
  onSheetCount: (pageId: string, n: number) => void;
}) {
  const env = useEditorEnv();
  const [heights, setHeights] = useState<Record<string, number>>({});
  const observer = useRef<ResizeObserver | null>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const measureRef = useCallback((id: string) => {
    return (el: HTMLDivElement | null) => {
      const prev = elements.current.get(id);
      if (prev && prev !== el) observer.current?.unobserve(prev);
      if (!el) {
        elements.current.delete(id);
        return;
      }
      elements.current.set(id, el);
      if (typeof ResizeObserver === "undefined") return;
      if (!observer.current)
        observer.current = new ResizeObserver((entries) => {
          setHeights((cur) => {
            let next = cur;
            for (const e of entries) {
              const mid = (e.target as HTMLElement).dataset["moduleId"];
              const h = (e.target as HTMLElement).offsetHeight;
              if (mid && next[mid] !== h) next = { ...next, [mid]: h };
            }
            return next;
          });
        });
      observer.current.observe(el);
    };
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);

  const limit = sheetContentLimit(env.options);
  const groups = packIntoSheets(
    props.page.modules.map((m) => ({ id: m.id, height: heights[m.id] })),
    limit,
    MODULE_GAP_PX,
  );
  useEffect(() => {
    props.onSheetCount(props.page.id, groups.length);
  }, [groups.length, props.page.id, props.onSheetCount]);

  return (
    <>
      {groups.map((ids, part) => (
        <div key={part} className={part > 0 ? "mt-4" : undefined}>
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
              onClick={() => env.dispatch({ type: "selectPage", pageId: props.page.id })}
            >
              {continuedTabLabel(props.index, part)}
            </button>
            {part === 0 && props.page.modules.length === 0 ? (
              <span className="pb-1 text-xs text-muted-foreground">
                Empty page — add a module from the Modules tab
              </span>
            ) : null}
          </div>
          <ScaledSheet scale={props.scale}>
            <Sheet
              page={props.page}
              index={props.index}
              part={part}
              moduleIds={ids}
              measureRef={measureRef}
              printedNumber={props.startNumber + part}
              selected={props.selected}
              guide={props.guide}
            />
          </ScaledSheet>
        </div>
      ))}
    </>
  );
}

/** A scaled sheet still lays out at its full height; this wrapper takes the scaled height instead. */
function ScaledSheet(props: { scale: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>(SHEET.height);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    setHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  return (
    <div style={{ height: height * props.scale }}>
      <div
        ref={ref}
        style={{
          transform: `scale(${props.scale})`,
          transformOrigin: "top left",
          width: SHEET.width,
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

function Sheet(props: {
  page: DocPage;
  index: number;
  /** Which sheet of the page this is (0 = the first; the Pages list scrolls to it). */
  part: number;
  moduleIds: string[];
  measureRef: (id: string) => (el: HTMLDivElement | null) => void;
  printedNumber: number;
  selected: boolean;
  guide: number | null;
}) {
  const env = useEditorEnv();
  const [over, setOver] = useState(false);
  const shown = props.moduleIds
    .map((id) => props.page.modules.findIndex((m) => m.id === id))
    .filter((i) => i >= 0);
  return (
    <div
      id={props.part === 0 ? pageDomId(props.page.id) : undefined}
      // The paper: white with black ink in both themes (dark-mode.test.ts allowlist).
      className={cn(
        "document-sheet relative bg-white text-black shadow-md ring-1 ring-black/10",
        props.selected && "ring-2 ring-primary",
        over && "ring-2 ring-primary ring-offset-2",
      )}
      style={{ width: SHEET.width, minHeight: SHEET.height, padding: SHEET.pad }}
      onMouseDown={() => {
        if (!props.selected) env.dispatch({ type: "selectPage", pageId: props.page.id });
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(MODULE_DRAG_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!over) setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const type = e.dataTransfer.getData(MODULE_DRAG_TYPE);
        setOver(false);
        if (!type || !(MODULE_TYPES as readonly string[]).includes(type) || type === "pdf") return;
        e.preventDefault();
        env.dispatch({
          type: "setPages",
          op: (pages) => addModule(pages, props.index, newModule(type as ModuleType)),
        });
        env.dispatch({ type: "selectPage", pageId: props.page.id });
      }}
    >
      {props.guide !== null ? (
        <div
          className="pointer-events-none absolute left-0 right-0 border-t-2 border-dotted border-sky-400"
          style={{ top: props.guide }}
          title="Page break"
        >
          <span className="absolute right-2 -top-4 text-[10px] text-sky-500">page break</span>
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        {shown.map((i) => {
          const m = props.page.modules[i]!;
          return (
            <div key={m.id} ref={props.measureRef(m.id)} data-module-id={m.id}>
              <ModuleView module={m} index={i} count={props.page.modules.length} />
            </div>
          );
        })}
        {props.page.modules.length === 0 ? (
          <div className="rounded-sm border-2 border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-400">
            Drop a module here, or use + on the Modules tab.
          </div>
        ) : null}
      </div>
      {env.options.footer ? (
        <div className="pointer-events-none absolute bottom-6 left-0 right-0 flex justify-between px-[72px] text-[9pt] text-neutral-500">
          <span>{env.variables["account.name"] ?? ""}</span>
          <span>Page {props.printedNumber}</span>
        </div>
      ) : null}
    </div>
  );
}

/** The PDF library: pick one to insert, or upload another. */
export function InsertPdfDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (asset: DocumentAssetRow) => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listDocumentAssets);
  const uploadFn = useServerFn(uploadDocumentAsset);
  const deleteFn = useServerFn(deleteDocumentAsset);
  const fileRef = useRef<HTMLInputElement>(null);
  const assets = useQuery({
    queryKey: assetsKey,
    queryFn: () => listFn(),
    enabled: props.open,
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error("Could not read the file"));
        r.onload = () => {
          const s = String(r.result ?? "");
          resolve(s.slice(s.indexOf(",") + 1));
        };
        r.readAsDataURL(file);
      });
      return uploadFn({ data: { name: file.name.replace(/\.pdf$/i, ""), base64 } });
    },
    onSuccess: async (row) => {
      await qc.invalidateQueries({ queryKey: assetsKey });
      toast.success("PDF added to the library");
      props.onInsert(row);
    },
    onError: (e) => toast.error(`Could not upload the PDF: ${errText(e)}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: assetsKey }),
    onError: (e) => toast.error(`Could not delete the PDF: ${errText(e)}`),
  });
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insert PDF</DialogTitle>
          <DialogDescription>
            A PDF from the library prints as its own pages after this page's modules.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {assets.isLoading ? (
            <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the library…
            </div>
          ) : assets.isError ? (
            <div className="p-2 text-sm text-destructive">
              Could not load the library: {errText(assets.error)}
            </div>
          ) : (assets.data ?? []).length === 0 ? (
            <div className="p-2 text-sm text-muted-foreground">
              The library is empty. Upload a PDF to insert it.
            </div>
          ) : (
            (assets.data ?? []).map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm hover:bg-accent/50"
              >
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 text-left"
                  title="Insert this PDF"
                  onClick={() => props.onInsert(a)}
                >
                  <FileUp className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{a.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.page_count} {a.page_count === 1 ? "page" : "pages"} ·{" "}
                    {Math.max(1, Math.round(a.size_bytes / 1024))} KB
                  </span>
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                  title="Delete from the library (documents that already use it keep it)"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(a.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload.mutate(f);
            }}
          />
          <Button
            type="button"
            variant="outline"
            title="Add a PDF to the library and insert it"
            disabled={upload.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {upload.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4" />
            )}
            Upload PDF
          </Button>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
