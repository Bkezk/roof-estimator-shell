/**
 * The takeoff underlay: a plan-set PDF (rendered with pdf.js) or an aerial image. pdf.js is
 * loaded lazily and only in the browser — this app server-renders routes, and pdf.js must
 * never be evaluated on the server.
 */
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

/**
 * pdf.js v6's modern build calls very new built-ins without guards (Map#getOrInsertComputed,
 * Uint8Array#toHex, Math.sumPrecise, Promise.withResolvers). A browser missing any of them gets
 * the package's legacy build instead (same API, polyfilled).
 */
function modernBuildSupported(): boolean {
  const has = (o: object, k: string) => typeof (o as Record<string, unknown>)[k] === "function";
  return (
    has(Map.prototype, "getOrInsertComputed") &&
    has(Uint8Array.prototype, "toHex") &&
    has(Math, "sumPrecise") &&
    has(Promise, "withResolvers")
  );
}

/** Import pdf.js (once) and point it at its worker. Browser only. */
export function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, worker] = modernBuildSupported()
        ? await Promise.all([
            import("pdfjs-dist"),
            import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
          ])
        : await Promise.all([
            import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<PdfJs>,
            import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
          ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })().catch((e: unknown) => {
      pdfjsPromise = null;
      throw e;
    });
  }
  return pdfjsPromise;
}

/** Open a PDF from its bytes. The caller destroys it when done. */
export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
}

/** Release a PDF opened with `openPdf` (pdf.js v6 destroys through its loading task). */
export function closePdf(doc: PDFDocumentProxy): void {
  void doc.loadingTask.destroy().catch(() => {});
}

/** Page count of a PDF file (the New takeoff dialog). */
export async function pdfPageCount(file: Blob): Promise<number> {
  const doc = await openPdf(await file.arrayBuffer());
  try {
    return doc.numPages;
  } finally {
    closePdf(doc);
  }
}

export type UnderlaySource =
  { kind: "pdf"; doc: PDFDocumentProxy } | { kind: "image"; image: ImageBitmap };

/** Most pixels a rendered page canvas may hold (keeps big sheets at high zoom in memory). */
const MAX_CANVAS_PIXELS = 24_000_000;

export interface RenderedPage {
  /** Displayed size at zoom 1 (after the page's rotation). */
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
}

export interface RenderHandle {
  promise: Promise<RenderedPage>;
  cancel: () => void;
}

/**
 * Render one page of the underlay, rotated `rotation` quarter turns clockwise, into a fresh
 * offscreen canvas at `scale` device pixels per zoom-1 pixel (clamped to a pixel budget).
 */
export function renderUnderlayPage(
  source: UnderlaySource,
  pageIndex: number,
  rotation: number,
  scale: number,
): RenderHandle {
  let task: RenderTask | null = null;
  let cancelled = false;
  const promise = (async (): Promise<RenderedPage> => {
    const canvas = document.createElement("canvas");
    if (source.kind === "pdf") {
      const page = await source.doc.getPage(pageIndex + 1);
      if (cancelled) throw new Error("cancelled");
      const rot = (((page.rotate + rotation * 90) % 360) + 360) % 360;
      const base = page.getViewport({ scale: 1, rotation: rot });
      const s = clampScale(scale, base.width, base.height);
      const vp = page.getViewport({ scale: s, rotation: rot });
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      task = page.render({ canvas, viewport: vp });
      await task.promise;
      return { width: base.width, height: base.height, canvas };
    }
    const img = source.image;
    const odd = rotation % 2 === 1;
    const width = odd ? img.height : img.width;
    const height = odd ? img.width : img.height;
    const s = clampScale(scale, width, height);
    canvas.width = Math.max(1, Math.floor(width * s));
    canvas.height = Math.max(1, Math.floor(height * s));
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.translate(width / 2, height / 2);
      ctx.rotate((rotation * Math.PI) / 2);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
    }
    return { width, height, canvas };
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      task?.cancel();
    },
  };
}

function clampScale(scale: number, width: number, height: number): number {
  const max = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height));
  return Math.max(0.1, Math.min(scale, max));
}
