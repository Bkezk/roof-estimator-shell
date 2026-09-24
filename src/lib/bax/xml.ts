/**
 * A small XML reader for the legacy `EstimateData` document: elements, attributes, text and the
 * five predefined entities plus numeric character references. The files carry no declaration,
 * comments, CDATA, namespaces or processing instructions (checked on the owner's four samples),
 * but those constructs are skipped defensively anyway. Dependency-free so the same code runs in
 * the browser (the import dialog) and in Vitest (node).
 */

export interface XNode {
  tag: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeEntities(s: string): string {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body] ?? m;
  });
}

export function parseXml(src: string): XNode {
  const root: XNode = { tag: "", attrs: {}, children: [], text: "" };
  const stack: XNode[] = [root];
  let i = 0;
  const n = src.length;
  const top = () => stack[stack.length - 1]!;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      top().text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) top().text += decodeEntities(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      top().text += src.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith("<?", lt) || src.startsWith("<!", lt)) {
      const end = src.indexOf(">", lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (src.startsWith("</", lt)) {
      const end = src.indexOf(">", lt);
      if (end < 0) throw new Error("Unterminated closing tag.");
      const name = src.slice(lt + 2, end).trim();
      if (stack.length < 2 || top().tag !== name)
        throw new Error(`Mismatched closing tag </${name}>.`);
      stack.pop();
      i = end + 1;
      continue;
    }
    // Opening or self-closing tag.
    let j = lt + 1;
    while (j < n && !/[\s/>]/.test(src[j]!)) j++;
    const tag = src.slice(lt + 1, j);
    if (!tag) throw new Error("Empty tag name.");
    const node: XNode = { tag, attrs: {}, children: [], text: "" };
    let selfClosing = false;
    for (;;) {
      while (j < n && /\s/.test(src[j]!)) j++;
      if (j >= n) throw new Error(`Unterminated tag <${tag}>.`);
      if (src[j] === ">") {
        j++;
        break;
      }
      if (src[j] === "/") {
        selfClosing = true;
        j++;
        continue;
      }
      let k = j;
      while (k < n && !/[\s=/>]/.test(src[k]!)) k++;
      const attr = src.slice(j, k);
      j = k;
      while (j < n && /\s/.test(src[j]!)) j++;
      if (src[j] !== "=") {
        node.attrs[attr] = "";
        continue;
      }
      j++;
      while (j < n && /\s/.test(src[j]!)) j++;
      const q = src[j];
      if (q !== '"' && q !== "'") throw new Error(`Unquoted attribute ${attr} on <${tag}>.`);
      const close = src.indexOf(q, j + 1);
      if (close < 0) throw new Error(`Unterminated attribute ${attr} on <${tag}>.`);
      node.attrs[attr] = decodeEntities(src.slice(j + 1, close));
      j = close + 1;
    }
    top().children.push(node);
    if (!selfClosing) stack.push(node);
    i = j;
  }
  if (stack.length !== 1) throw new Error(`Unclosed element <${top().tag}>.`);
  const doc = root.children[0];
  if (!doc) throw new Error("Empty document.");
  return doc;
}

/** First child element with this tag (or undefined). */
export function child(node: XNode | undefined, tag: string): XNode | undefined {
  return node?.children.find((c) => c.tag === tag);
}

/** Every child element with this tag. */
export function children(node: XNode | undefined, tag: string): XNode[] {
  return node ? node.children.filter((c) => c.tag === tag) : [];
}

/** Trimmed text of the first child element with this tag ("" when absent). */
export function text(node: XNode | undefined, tag: string): string {
  return (child(node, tag)?.text ?? "").trim();
}

/** Numeric text of a child element; `fallback` when absent or not a number. */
export function num(node: XNode | undefined, tag: string, fallback = 0): number {
  const v = Number(text(node, tag).replace(/,/g, ""));
  return Number.isFinite(v) ? v : fallback;
}

/** Numeric attribute; `fallback` when absent or not a number (legacy "-∞" reads as fallback). */
export function attrNum(node: XNode | undefined, name: string, fallback = 0): number {
  const raw = node?.attrs[name];
  if (raw === undefined) return fallback;
  const v = Number(raw.replace(/,/g, ""));
  return Number.isFinite(v) ? v : fallback;
}

/** Legacy boolean text/attribute ("True"/"False"/"1"/"0"). */
export function bool(v: string | undefined): boolean {
  const t = (v ?? "").trim().toLowerCase();
  return t === "true" || t === "1";
}
