/**
 * What every module on the canvas needs from the editor page: the document's kind and mode, the
 * resolved variables the chips print, the ticket's photos, the options, the reducer dispatch, and
 * the TipTap editor that last had focus (the Variables tab inserts a chip there). One context so
 * the module renderers stay plain.
 */
import { createContext, type Dispatch, useContext } from "react";
import type { Editor } from "@tiptap/react";

import type { DocKind, DocModule, DocOptions } from "@/lib/documents/model";

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
}

export const EditorEnvContext = createContext<EditorEnv | null>(null);

export function useEditorEnv(): EditorEnv {
  const env = useContext(EditorEnvContext);
  if (!env) throw new Error("useEditorEnv must be used inside the Documents editor");
  return env;
}

/** The chip inside a TipTap node view may render before the context is wired; it reads softly. */
export const useEditorEnvOptional = () => useContext(EditorEnvContext);
