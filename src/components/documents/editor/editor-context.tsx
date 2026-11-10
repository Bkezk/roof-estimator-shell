/**
 * What every module on the canvas needs from the editor page: the document's kind and mode, the
 * resolved variables the chips print, the ticket's photos, the options, the reducer dispatch, and
 * the TipTap editor that last had focus (the Variables tab inserts a chip there), and the saved
 * snippets (a snippet row dragged onto a sheet is looked up by its id). One context so the module
 * renderers stay plain.
 */
import { createContext, type Dispatch, useContext } from "react";
import type { Editor } from "@tiptap/react";

import type { SheetInfo } from "@/lib/documents/editor-helpers";
import type { DocKind, DocModule, DocOptions, DocPage } from "@/lib/documents/model";
import type { ImageSize, Measure } from "@/lib/documents/pdf-layout";

import type { DocumentPhoto } from "../document-types";
import type { EditorAction } from "./editor-state";

export interface EditorEnv {
  kind: DocKind;
  /** A document of a record, or a template edited with sample variables. */
  mode: "document" | "template";
  variables: Record<string, string>;
  photos: DocumentPhoto[];
  options: DocOptions;
  documentId?: string | undefined;
  templateId?: string | undefined;
  /** The record's property and a signed link to its cover photo (phase 2), when it has them. */
  siteId?: string | null | undefined;
  siteCoverUrl?: string | null | undefined;
  dispatch: Dispatch<EditorAction>;
  /** The TipTap editor that last had focus (null when it blurred away for good). */
  setActiveEditor: (editor: Editor | null) => void;
  /** "Save as snippet…" on a module's toolbar: the page asks for a name and saves (document_modules). */
  onSaveModule: (module: DocModule) => void;
  /** "Save page as snippet" under a page (and on its menu): the page asks for a name and saves. */
  onSavePage?: ((page: DocPage) => void) | undefined;
  /** The canvas reports each page's sheets as laid out (the Pages list shows every one). */
  onSheets?: ((pageId: string, sheets: SheetInfo[]) => void) | undefined;
  /** The saved snippets the Modules tab lists; a row dragged onto a sheet drops a fresh copy. */
  snippets: ReadonlyArray<{ id: string; name: string; module: DocModule }>;
  /**
   * The PDF's text metrics once loaded (screen-measure.ts), so the sheets follow the PDF's own
   * pagination (Nov 6); null until then.
   */
  measure: Measure | null;
  /** The natural size every picture on the canvas reported as it loaded (null: it could not load), by the layout's key. */
  imageSizes: Readonly<Record<string, ImageSize | null>>;
  reportImageSize: (key: string, size: ImageSize | null) => void;
}

export const EditorEnvContext = createContext<EditorEnv | null>(null);

export function useEditorEnv(): EditorEnv {
  const env = useContext(EditorEnvContext);
  if (!env) throw new Error("useEditorEnv must be used inside the Documents editor");
  return env;
}

/** The chip inside a TipTap node view may render before the context is wired; it reads softly. */
export const useEditorEnvOptional = () => useContext(EditorEnvContext);
