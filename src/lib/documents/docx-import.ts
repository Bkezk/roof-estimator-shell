/**
 * Word import (owner, Nov 10: "allow the import of word documents not just PDFs") — pure, no
 * library: a .docx is a zip of XML. `readDocx` opens it and turns the body into blocks the
 * editor understands — runs of paragraphs as rich text (headings, bold / italic / underline,
 * centred or right-aligned, bullet and numbered lists, line breaks), each picture, each table —
 * and `docxModules` (below) makes them a page's modules. What Word can do and the editor cannot
 * (text boxes, columns, headers and footers, fonts, colours, tab stops) is left out and named
 * in `skipped`, so the import says what to check.
 *
 * Placeholders of Word form fields ("Click here to enter text.") are dropped: the label stays
 * and the value is typed, or a variable is put there.
 */
import type { DocModule, RichNode, TextAlign } from "./model";

// ── zip ───────────────────────────────────────────────────────────────────────────────────

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined")
    throw new Error("This browser cannot open Word files; update it, or use another browser");
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** What a .docx may unpack to in all (a zip can claim far more than its size). */
export const DOCX_MAX_UNPACKED = 60 * 1024 * 1024;
/** The largest .docx read. */
export const DOCX_MAX_BYTES = 25 * 1024 * 1024;

/** The files of a zip, by path (only the ones `want` accepts are unpacked). */
export async function unzip(
  bytes: Uint8Array,
  want: (path: string) => boolean = () => true,
): Promise<Map<string, Uint8Array>> {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--)
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("That file is not a Word document (.docx)");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out = new Map<string, Uint8Array>();
  let total = 0;
  const text = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) break;
    const method = u16(bytes, p + 10);
    const packed = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const path = text.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith("/") || !want(path)) continue;
    total += size;
    if (total > DOCX_MAX_UNPACKED) throw new Error("That Word document is too large to import");
    if (u32(bytes, local) !== 0x04034b50) continue;
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const body = bytes.subarray(start, start + packed);
    if (method === 0) out.set(path, body.slice());
    else if (method === 8) out.set(path, await inflateRaw(body));
  }
  return out;
}

// ── xml ───────────────────────────────────────────────────────────────────────────────────

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text directly inside (for a text node: `name` is "#text"). */
  text: string;
}
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });

/** A small XML reader: elements, attributes and text (no DTD, comments and `<?…?>` skipped). */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const re =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([^\s>/]+)([^>]*?)(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(re)) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined)
      top.children.push({ name: "#text", attrs: {}, children: [], text: m[1] });
    else if (m[6] !== undefined) {
      top.children.push({ name: "#text", attrs: {}, children: [], text: decode(m[6]) });
    } else if (m[3]) {
      if (m[2] === "/") {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
        attrs[a[1]!] = decode(a[2] ?? a[3] ?? "");
      const node: XmlNode = { name: m[3], attrs, children: [], text: "" };
      top.children.push(node);
      if (m[5] !== "/") stack.push(node);
    }
  }
  return root;
}
const kid = (n: XmlNode | undefined, name: string) => n?.children.find((c) => c.name === name);
const kids = (n: XmlNode | undefined, name: string) =>
  n?.children.filter((c) => c.name === name) ?? [];
function find(n: XmlNode, name: string): XmlNode | undefined {
  for (const c of n.children) {
    if (c.name === name) return c;
    const d = find(c, name);
    if (d) return d;
  }
  return undefined;
}
const on = (n: XmlNode | undefined) =>
  !!n && n.attrs["w:val"] !== "0" && n.attrs["w:val"] !== "false" && n.attrs["w:val"] !== "none";

// ── the document ──────────────────────────────────────────────────────────────────────────

export interface DocxImage {
  /** The file's name inside the document ("image1.png"). */
  name: string;
  bytes: Uint8Array;
  /** Pixel size, read from the file. */
  width: number;
  height: number;
  /** The size Word shows it at, in inches (0 when the document does not say). */
  widthIn: number;
  heightIn: number;
}
export type DocxBlock =
  | { kind: "text"; nodes: RichNode[] }
  | { kind: "image"; image: DocxImage }
  | { kind: "table"; rows: string[][] };
export interface DocxRead {
  blocks: DocxBlock[];
  /** What was left out, in plain words (shown after the import). */
  skipped: string[];
}

/** Pixel size of a PNG or JPEG; null for anything else (the editor takes JPEG, PNG, WebP). */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const be = (o: number) =>
      ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
    return { width: be(16), height: be(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = b[o + 1]!;
      const len = (b[o + 2]! << 8) | b[o + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { height: (b[o + 5]! << 8) | b[o + 6]!, width: (b[o + 7]! << 8) | b[o + 8]! };
      o += 2 + len;
    }
  }
  return null;
}

const EMU_PER_IN = 914400;
/** A tab becomes a visible gap (the editor has no tab stops). */
const TAB = "\u00a0\u00a0\u00a0 ";

interface Ctx {
  rels: Map<string, string>;
  files: Map<string, Uint8Array>;
  /** numId → true when the list is numbered (else bullets). */
  numbered: Map<string, boolean>;
  skipped: Set<string>;
}
type Inline =
  | { kind: "text"; text: string; bold: boolean; italic: boolean; underline: boolean; size: number }
  | { kind: "break" }
  | { kind: "image"; image: DocxImage };

function runInlines(r: XmlNode, ctx: Ctx, out: Inline[]): void {
  const pr = kid(r, "w:rPr");
  const style = {
    bold: on(kid(pr, "w:b")),
    italic: on(kid(pr, "w:i")),
    underline: on(kid(pr, "w:u")),
    size: Number(kid(pr, "w:sz")?.attrs["w:val"] ?? 0) || 0,
  };
  for (const c of r.children) {
    if (c.name === "w:t")
      out.push({ kind: "text", text: c.children.map((t) => t.text).join(""), ...style });
    else if (c.name === "w:tab") out.push({ kind: "text", text: TAB, ...style });
    else if (c.name === "w:br" || c.name === "w:cr") {
      if (c.attrs["w:type"] !== "page") out.push({ kind: "break" });
    } else if (c.name === "w:drawing" || c.name === "w:pict") {
      const blip = find(c, "a:blip");
      const id = blip?.attrs["r:embed"] ?? find(c, "v:imagedata")?.attrs["r:id"];
      const target = id ? ctx.rels.get(id) : undefined;
      const path = target ? `word/${target.replace(/^\/?(word\/)?/, "")}` : "";
      const bytes = path ? ctx.files.get(path) : undefined;
      const size = bytes ? imageSize(bytes) : null;
      if (!bytes || !size) {
        ctx.skipped.add(
          "a picture in a format the editor does not take (only JPEG and PNG come across)",
        );
        continue;
      }
      const ext = find(c, "wp:extent");
      out.push({
        kind: "image",
        image: {
          name: path.split("/").pop() ?? "picture",
          bytes,
          ...size,
          widthIn: Number(ext?.attrs["cx"] ?? 0) / EMU_PER_IN || 0,
          heightIn: Number(ext?.attrs["cy"] ?? 0) / EMU_PER_IN || 0,
        },
      });
    } else if (c.name === "mc:AlternateContent") {
      ctx.skipped.add("a text box or shape (retype its words in a Body module)");
    }
  }
}
/** The inline content of a paragraph (through hyperlinks, form fields and tracked insertions). */
function inlinesOf(n: XmlNode, ctx: Ctx, out: Inline[] = []): Inline[] {
  for (const c of n.children) {
    if (c.name === "w:r") runInlines(c, ctx, out);
    else if (c.name === "w:hyperlink" || c.name === "w:ins" || c.name === "w:smartTag")
      inlinesOf(c, ctx, out);
    else if (c.name === "w:sdt") {
      // A form field showing its placeholder ("Click here to enter text.") carries no content.
      if (kid(kid(c, "w:sdtPr"), "w:showingPlcHdr")) continue;
      const content = kid(c, "w:sdtContent");
      if (content) inlinesOf(content, ctx, out);
    }
  }
  return out;
}
const textNodes = (inl: Inline[]): RichNode[] => {
  const nodes: RichNode[] = [];
  for (const i of inl) {
    if (i.kind === "break") nodes.push({ type: "hardBreak" });
    if (i.kind !== "text" || !i.text) continue;
    const marks = [
      ...(i.bold ? [{ type: "bold" }] : []),
      ...(i.italic ? [{ type: "italic" }] : []),
      ...(i.underline ? [{ type: "underline" }] : []),
    ];
    const last = nodes[nodes.length - 1];
    if (last?.type === "text" && JSON.stringify(last.marks ?? []) === JSON.stringify(marks))
      last.text = (last.text ?? "") + i.text;
    else nodes.push({ type: "text", text: i.text, ...(marks.length ? { marks } : {}) });
  }
  // Trailing gaps (tabs before a dropped placeholder) and breaks print as nothing: drop them.
  for (;;) {
    const last = nodes[nodes.length - 1];
    if (!last) break;
    if (last.type === "hardBreak") nodes.pop();
    else if (last.type === "text") {
      last.text = (last.text ?? "").replace(/[\s\u00a0]+$/, "");
      if (last.text) break;
      nodes.pop();
    } else break;
  }
  return nodes;
};

type Para = { node: RichNode; list: "bullet" | "ordered" | null };
function paragraph(p: XmlNode, ctx: Ctx, images: DocxImage[]): Para {
  const pr = kid(p, "w:pPr");
  const inl = inlinesOf(p, ctx);
  for (const i of inl) if (i.kind === "image") images.push(i.image);
  const content = textNodes(inl);
  const plain = content.map((n) => n.text ?? "").join("");
  const styleId = (kid(pr, "w:pStyle")?.attrs["w:val"] ?? "").toLowerCase();
  const jc = kid(pr, "w:jc")?.attrs["w:val"];
  const align: TextAlign | null =
    jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : null;
  const size = Math.max(0, ...inl.map((i) => (i.kind === "text" && i.text.trim() ? i.size : 0)));
  const short = plain.length > 0 && plain.length <= 90;
  let level: 1 | 2 | 3 | 0 = 0;
  if (/^(title|heading1)$/.test(styleId)) level = 1;
  else if (styleId === "heading2" || styleId === "subtitle") level = 2;
  else if (/^heading[3-9]$/.test(styleId)) level = 3;
  // Large type with no heading style: a centred line reads as a title. A large bold LABEL at
  // the margin ("Customer:") stays a paragraph, so its value can be typed on the same line.
  else if (short && size >= 36 && align === "center")
    level = 1; // 18 pt and up
  else if (short && size >= 28 && align === "center") level = 2; // 14 pt and up
  const numId = kid(kid(pr, "w:numPr"), "w:numId")?.attrs["w:val"];
  const list =
    numId && numId !== "0" && !level ? (ctx.numbered.get(numId) ? "ordered" : "bullet") : null;
  const attrs = { ...(level ? { level } : {}), ...(align ? { textAlign: align } : {}) };
  const node: RichNode = {
    type: level ? "heading" : "paragraph",
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(content.length ? { content } : {}),
  };
  return { node, list };
}
const cellText = (tc: XmlNode, ctx: Ctx): string =>
  kids(tc, "w:p")
    .map((p) =>
      inlinesOf(p, ctx)
        .map((i) => (i.kind === "text" ? i.text : i.kind === "break" ? "\n" : ""))
        .join("")
        .replace(/[\s\u00a0]+$/, ""),
    )
    .join("\n")
    .trim();

/** Read a .docx into blocks, in document order. */
export async function readDocx(bytes: Uint8Array): Promise<DocxRead> {
  if (bytes.length > DOCX_MAX_BYTES) throw new Error("That Word document is over 25 MB");
  // The older binary .doc starts D0 CF 11 E0.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)
    throw new Error(
      "That is an older .doc file. Open it in Word, use Save As and pick Word Document (.docx), then import that",
    );
  const files = await unzip(
    bytes,
    (p) =>
      p === "word/document.xml" ||
      p === "word/numbering.xml" ||
      p.startsWith("word/_rels/") ||
      p.startsWith("word/media/"),
  );
  const docXml = files.get("word/document.xml");
  if (!docXml) throw new Error("That file is not a Word document (.docx)");
  const dec = new TextDecoder();
  const rels = new Map<string, string>();
  const relXml = files.get("word/_rels/document.xml.rels");
  if (relXml)
    for (const r of kids(kid(parseXml(dec.decode(relXml)), "Relationships"), "Relationship"))
      if (r.attrs["Id"] && r.attrs["Target"]) rels.set(r.attrs["Id"], r.attrs["Target"]);
  const numbered = new Map<string, boolean>();
  const numXml = files.get("word/numbering.xml");
  if (numXml) {
    const root = kid(parseXml(dec.decode(numXml)), "w:numbering");
    const fmt = new Map<string, string>();
    for (const a of kids(root, "w:abstractNum"))
      fmt.set(
        a.attrs["w:abstractNumId"] ?? "",
        kid(kid(a, "w:lvl"), "w:numFmt")?.attrs["w:val"] ?? "bullet",
      );
    for (const n of kids(root, "w:num")) {
      const f = fmt.get(kid(n, "w:abstractNumId")?.attrs["w:val"] ?? "") ?? "bullet";
      numbered.set(n.attrs["w:numId"] ?? "", f !== "bullet" && f !== "none");
    }
  }
  const ctx: Ctx = { rels, files, numbered, skipped: new Set() };
  const body = kid(kid(parseXml(dec.decode(docXml)), "w:document"), "w:body");
  if (!body) throw new Error("That Word document has no body to import");

  const blocks: DocxBlock[] = [];
  let run: RichNode[] = [];
  let listKind: "bullet" | "ordered" | null = null;
  let listItems: RichNode[] = [];
  const endList = () => {
    if (!listItems.length) return;
    run.push({ type: listKind === "ordered" ? "orderedList" : "bulletList", content: listItems });
    listItems = [];
    listKind = null;
  };
  const endRun = () => {
    endList();
    // Blank lines at the two ends of a run add nothing.
    while (run.length && run[0]!.type === "paragraph" && !run[0]!.content) run.shift();
    while (run.length && run[run.length - 1]!.type === "paragraph" && !run[run.length - 1]!.content)
      run.pop();
    if (run.length) blocks.push({ kind: "text", nodes: run });
    run = [];
  };
  const walk = (parent: XmlNode) => {
    for (const el of parent.children) {
      if (el.name === "w:p") {
        const images: DocxImage[] = [];
        const para = paragraph(el, ctx, images);
        if (images.length) {
          endRun();
          for (const image of images) blocks.push({ kind: "image", image });
        }
        if (images.length && !para.node.content) continue;
        if (para.list) {
          if (listKind && listKind !== para.list) endList();
          listKind = para.list;
          listItems.push({ type: "listItem", content: [para.node] });
        } else {
          endList();
          run.push(para.node);
        }
      } else if (el.name === "w:tbl") {
        endRun();
        const rows = kids(el, "w:tr").map((tr) => kids(tr, "w:tc").map((tc) => cellText(tc, ctx)));
        const width = Math.max(0, ...rows.map((r) => r.length));
        if (width)
          blocks.push({
            kind: "table",
            rows: rows.map((r) => [...r, ...Array<string>(width - r.length).fill("")]),
          });
      } else if (el.name === "w:sdt") {
        // A whole-paragraph form field still showing its placeholder: a blank line to type on.
        if (kid(kid(el, "w:sdtPr"), "w:showingPlcHdr")) {
          endList();
          run.push({ type: "paragraph" });
          continue;
        }
        const content = kid(el, "w:sdtContent");
        if (content) walk(content);
      }
    }
  };
  walk(body);
  endRun();
  if (find(body, "w:headerReference") || find(body, "w:footerReference"))
    ctx.skipped.add("the header and footer (use the document's own letterhead and footer)");
  if (Number(find(body, "w:cols")?.attrs["w:num"] ?? 1) > 1)
    ctx.skipped.add("newspaper columns (the text comes across in one column)");
  return { blocks, skipped: [...ctx.skipped] };
}

/** Said after an import: where it landed and what to check. */
export function wordImportToast(fileName: string, pageNumber: number, skipped: readonly string[]) {
  const left = skipped.length ? ` Left out: ${skipped.join("; ")}.` : "";
  return `“${fileName}” imported as page ${pageNumber}. Check it against the original: fonts, colours and exact spacing do not come across.${left}`;
}

/** A picture's printed height on the page: Word's own, at most `maxIn`; 0 = its own shape. */
export function importedImageHeightIn(image: Pick<DocxImage, "heightIn">, maxIn = 7): number {
  if (!(image.heightIn > 0)) return 0;
  return Math.round(Math.min(maxIn, image.heightIn) * 100) / 100;
}

/**
 * The blocks as a page's modules. `imageRef(i)` is the stored picture for the i-th image block
 * (null when it could not be stored: that picture is left out). `newId` makes each module's id.
 */
export function docxModules(
  blocks: readonly DocxBlock[],
  imageRef: (index: number) => { path: string; width: number; height: number } | null,
  newId: () => string,
): DocModule[] {
  const out: DocModule[] = [];
  let img = 0;
  for (const b of blocks) {
    if (b.kind === "text")
      out.push({ id: newId(), type: "body", text: { type: "doc", content: b.nodes } });
    else if (b.kind === "table")
      out.push({
        id: newId(),
        type: "table",
        columns: b.rows[0]!.map(() => ({ title: "", align: "left" as const })),
        rows: b.rows,
      });
    else {
      const ref = imageRef(img++);
      if (!ref) continue;
      out.push({
        id: newId(),
        type: "fullPhoto",
        image: { kind: "upload", ...ref, name: b.image.name },
        caption: "",
        heightIn: importedImageHeightIn(b.image),
      });
    }
  }
  return out;
}
