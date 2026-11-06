/**
 * The Documents editor's state (routes/documents.tsx): the title, the pages, the checkbox
 * options and which page is selected, with the saved copy they are compared against for the
 * Save button. Pure — a reducer over the model's page operations — so every rule is tested in
 * editor-state.test.ts. The route owns the server calls and feeds the results back as actions.
 */
import { applyOptionsToPages, type DocOptions, type DocPage, newPage } from "@/lib/documents/model";
import { splitRepairListModule } from "@/lib/documents/server-pure";
import type { InspectionSnapshot } from "@/lib/documents/variables";

/** What a save writes (and what "dirty" compares). */
export interface EditorDoc {
  title: string;
  pages: DocPage[];
  options: DocOptions;
}

/** The template a document's pages came from ("From template: X"; documents.template_id). */
export interface EditorTemplate {
  id: string;
  name: string;
}

export interface EditorState extends EditorDoc {
  /** The copy as last loaded or saved; null until the first load. */
  saved: EditorDoc | null;
  /**
   * The template the pages came from, shown as "From template: X" and saved as template_id.
   * Follows "Start over from template…" (Oct 28: it used to keep the original's name while the
   * pages were another template's). Null for a blank document and in the template editor.
   */
  template: EditorTemplate | null;
  /** Differs from `saved` (the Save button is enabled). */
  dirty: boolean;
  /** The page the Modules tab's "+" adds to (the last clicked; the first by default). */
  selectedPageId: string | null;
  /**
   * Undo (Nov 6: deleting a module or a page was instant and final): the pages and options as
   * they were before each change, newest last, and what Redo puts back. A load clears both.
   * Typing in one text box is one step however many keystrokes it took (TipTap keeps its own
   * undo inside the box); every other change is a step of its own. Capped at HISTORY_MAX.
   */
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** The module whose text the newest step is, so the next keystroke in it joins that step. */
  lastText: string | null;
}

/** One undo step: the pages and the options before a change. */
export interface HistoryEntry {
  pages: DocPage[];
  options: DocOptions;
}

export const HISTORY_MAX = 100;

export type EditorAction =
  /** The server's copy arrived (first load, reload after a refused save, a restored revision). */
  | { type: "load"; doc: EditorDoc; template?: EditorTemplate | null }
  /** "Start over from template…": the pages replaced, and the template they now come from. */
  | { type: "startOver"; pages: DocPage[]; template: EditorTemplate }
  | { type: "setTitle"; title: string }
  /**
   * A page or module operation from model.ts, applied to the current pages. `text` names the
   * module whose rich text a keystroke changed: one undo step per box, not per keystroke.
   */
  | { type: "setPages"; op: (pages: readonly DocPage[]) => DocPage[]; text?: string | undefined }
  /** The options checkboxes: flipping prices is applied to the pricing tables at once; the rest are view switches. */
  | { type: "setOptions"; patch: Partial<DocOptions> }
  /**
   * "Split into items" on a Repair List (owner, Oct 28): the module is replaced in place by one
   * Checklist item per item it lists, from the document's current inspection snapshot.
   */
  | { type: "splitRepairList"; moduleId: string; inspection: InspectionSnapshot }
  | { type: "selectPage"; pageId: string }
  /** A save went through: the current copy becomes the saved one. */
  | { type: "markSaved" }
  | { type: "undo" }
  | { type: "redo" };

export const EMPTY_EDITOR: EditorState = {
  title: "",
  pages: [],
  options: {
    prices: "total",
    photos: true,
    marks: true,
    footer: true,
    pageBreakIn: 8.8,
    itemPerPage: false,
  },
  saved: null,
  template: null,
  dirty: false,
  selectedPageId: null,
  past: [],
  future: [],
  lastText: null,
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

/**
 * The state with the current pages and options pushed as an undo step (Redo is emptied: a new
 * change after an undo forks the history). A text keystroke in the module the newest step
 * already belongs to pushes nothing — the step covers the whole typing in that box.
 */
function pushHistory(state: EditorState, text: string | null = null): EditorState {
  if (text !== null && state.lastText === text && state.past.length) return state;
  const entry: HistoryEntry = { pages: state.pages, options: state.options };
  const past = [...state.past, entry].slice(-HISTORY_MAX);
  return { ...state, past, future: [], lastText: text };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "load": {
      const pages = action.doc.pages.length ? action.doc.pages : [newPage()];
      const doc = { title: action.doc.title, pages, options: action.doc.options };
      return finish({
        ...doc,
        saved: doc,
        template: action.template ?? null,
        selectedPageId: fixSelection(pages, state.selectedPageId),
        past: [],
        future: [],
        lastText: null,
      });
    }
    case "startOver":
      return applyStartOver(pushHistory(state), action.pages, action.template);
    case "setTitle":
      return finish({ ...state, title: action.title });
    case "setPages": {
      const pages = action.op(state.pages);
      if (pages === state.pages) return state;
      const base = pushHistory(state, action.text ?? null);
      return finish({ ...base, pages, selectedPageId: fixSelection(pages, state.selectedPageId) });
    }
    case "setOptions": {
      const options = { ...state.options, ...action.patch };
      // Only the price mode lives in the modules. Photos, Marks, Footer and the page break are
      // read where the pages are drawn (Oct 28: Marks off used to delete an upload's marks).
      const flipped = options.prices !== state.options.prices;
      const pages = flipped ? applyOptionsToPages(state.pages, options) : state.pages;
      return finish({ ...pushHistory(state), options, pages });
    }
    case "splitRepairList": {
      const pages = splitRepairListModule(state.pages, action.moduleId, action.inspection);
      return finish({ ...pushHistory(state), pages });
    }
    case "selectPage":
      return { ...state, selectedPageId: fixSelection(state.pages, action.pageId) };
    case "markSaved":
      return finish({ ...state, saved: docOf(state) });
    case "undo": {
      const entry = state.past[state.past.length - 1];
      if (!entry) return state;
      const now: HistoryEntry = { pages: state.pages, options: state.options };
      return finish({
        ...state,
        pages: entry.pages,
        options: entry.options,
        past: state.past.slice(0, -1),
        future: [...state.future, now],
        lastText: null,
        selectedPageId: fixSelection(entry.pages, state.selectedPageId),
      });
    }
    case "redo": {
      const entry = state.future[state.future.length - 1];
      if (!entry) return state;
      const now: HistoryEntry = { pages: state.pages, options: state.options };
      return finish({
        ...state,
        pages: entry.pages,
        options: entry.options,
        past: [...state.past, now].slice(-HISTORY_MAX),
        future: state.future.slice(0, -1),
        lastText: null,
        selectedPageId: fixSelection(entry.pages, state.selectedPageId),
      });
    }
  }
}

/**
 * "Start over from template…" applied: the pages are the picked template's (instantiated by the
 * caller) and the document now comes FROM that template — its name in "From template: X", its
 * id in the next save's template_id. The selection is fixed to the new pages.
 */
export function applyStartOver(
  state: EditorState,
  pages: DocPage[],
  template: EditorTemplate,
): EditorState {
  return finish({
    ...state,
    pages,
    template,
    selectedPageId: fixSelection(pages, state.selectedPageId),
  });
}

/**
 * The saveDocument input (expectVersion is the version the tab opened; the server refuses a stale
 * one). templateId is the template the pages come from now (null: blank), so the saved row follows
 * a "Start over".
 */
export function buildSavePayload(
  state: EditorDoc & Pick<EditorState, "template">,
  id: string,
  expectVersion: number,
): {
  id: string;
  title: string;
  pages: DocPage[];
  options: DocOptions;
  expectVersion: number;
  templateId: string | null;
} {
  return {
    id,
    title: state.title.trim() || "Untitled document",
    pages: state.pages,
    options: state.options,
    expectVersion,
    templateId: state.template?.id ?? null,
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
