/**
 * The Documents editor's state (routes/documents.tsx): the title, the pages, the checkbox
 * options and which page is selected, with the saved copy they are compared against for the
 * Save button. Pure — a reducer over the model's page operations — so every rule is tested in
 * editor-state.test.ts. The route owns the server calls and feeds the results back as actions.
 */
import { applyOptionsToPages, type DocOptions, type DocPage, newPage } from "@/lib/documents/model";

/** What a save writes (and what "dirty" compares). */
export interface EditorDoc {
  title: string;
  pages: DocPage[];
  options: DocOptions;
}

export interface EditorState extends EditorDoc {
  /** The copy as last loaded or saved; null until the first load. */
  saved: EditorDoc | null;
  /** Differs from `saved` (the Save button is enabled). */
  dirty: boolean;
  /** The page the Modules tab's "+" adds to (the last clicked; the first by default). */
  selectedPageId: string | null;
}

export type EditorAction =
  /** The server's copy arrived (first load, reload after a refused save, a restored revision). */
  | { type: "load"; doc: EditorDoc }
  | { type: "setTitle"; title: string }
  /** A page or module operation from model.ts, applied to the current pages. */
  | { type: "setPages"; op: (pages: readonly DocPage[]) => DocPage[] }
  /** The options checkboxes: flipping prices / marks is applied to the pages at once. */
  | { type: "setOptions"; patch: Partial<DocOptions> }
  | { type: "selectPage"; pageId: string }
  /** A save went through: the current copy becomes the saved one. */
  | { type: "markSaved" };

export const EMPTY_EDITOR: EditorState = {
  title: "",
  pages: [],
  options: {
    prices: "total",
    photos: true,
    marks: true,
    footer: true,
    pageBreakIn: 8.8,
  },
  saved: null,
  dirty: false,
  selectedPageId: null,
};

/** Deep equality of what a save writes (ids included: a moved module is a change). */
export function isDirty(saved: EditorDoc | null, current: EditorDoc): boolean {
  if (!saved) return false;
  return (
    saved.title !== current.title ||
    JSON.stringify(saved.options) !== JSON.stringify(current.options) ||
    JSON.stringify(saved.pages) !== JSON.stringify(current.pages)
  );
}

const docOf = (s: EditorDoc): EditorDoc => ({
  title: s.title,
  pages: s.pages,
  options: s.options,
});

/** The selected page, or the first when the selected one is gone. */
function fixSelection(pages: readonly DocPage[], selected: string | null): string | null {
  if (selected && pages.some((p) => p.id === selected)) return selected;
  return pages[0]?.id ?? null;
}

function finish(next: Omit<EditorState, "dirty">): EditorState {
  return { ...next, dirty: isDirty(next.saved, docOf(next)) };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "load": {
      const pages = action.doc.pages.length ? action.doc.pages : [newPage()];
      const doc = { title: action.doc.title, pages, options: action.doc.options };
      return finish({
        ...doc,
        saved: doc,
        selectedPageId: fixSelection(pages, state.selectedPageId),
      });
    }
    case "setTitle":
      return finish({ ...state, title: action.title });
    case "setPages": {
      const pages = action.op(state.pages);
      return finish({ ...state, pages, selectedPageId: fixSelection(pages, state.selectedPageId) });
    }
    case "setOptions": {
      const options = { ...state.options, ...action.patch };
      const flipped =
        options.prices !== state.options.prices || options.marks !== state.options.marks;
      const pages = flipped ? applyOptionsToPages(state.pages, options) : state.pages;
      return finish({ ...state, options, pages });
    }
    case "selectPage":
      return { ...state, selectedPageId: fixSelection(state.pages, action.pageId) };
    case "markSaved":
      return finish({ ...state, saved: docOf(state) });
  }
}

/** The saveDocument input (expectVersion is the version the tab opened; the server refuses a stale one). */
export function buildSavePayload(
  state: EditorDoc,
  id: string,
  expectVersion: number,
): { id: string; title: string; pages: DocPage[]; options: DocOptions; expectVersion: number } {
  return {
    id,
    title: state.title.trim() || "Untitled document",
    pages: state.pages,
    options: state.options,
    expectVersion,
  };
}

/** The saveDocumentTemplate input for the template editor (name is the title box). */
export function buildTemplatePayload(
  state: EditorDoc,
  meta: { id?: string | undefined; kind: "bid" | "ticket"; description: string },
): {
  id?: string;
  kind: "bid" | "ticket";
  name: string;
  description: string;
  pages: DocPage[];
  options: DocOptions;
} {
  return {
    ...(meta.id ? { id: meta.id } : {}),
    kind: meta.kind,
    name: state.title.trim() || "Untitled template",
    description: meta.description.trim(),
    pages: state.pages,
    options: state.options,
  };
}

/** The index of the selected page (the Modules tab adds there); 0 when nothing is selected. */
export function selectedPageIndex(state: Pick<EditorState, "pages" | "selectedPageId">): number {
  const i = state.pages.findIndex((p) => p.id === state.selectedPageId);
  return i < 0 ? 0 : i;
}
