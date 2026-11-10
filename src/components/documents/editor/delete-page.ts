/**
 * Deleting a page, the one way: the Pages list menu and the bin under each page (owner, Nov 10:
 * "add a little trash can icon to the right of save as snippet that lets you delete the page").
 * Nothing is asked first; the toast offers Undo, and Ctrl+Z takes it back too.
 */
import type { Dispatch } from "react";
import { toast } from "sonner";

import { type DocPage, removePage, restorePage } from "@/lib/documents/model";

import type { EditorAction } from "./editor-state";

export function deletePageWithUndo(
  dispatch: Dispatch<EditorAction>,
  pages: readonly DocPage[],
  page: DocPage,
) {
  const i = pages.findIndex((p) => p.id === page.id);
  if (i < 0) return;
  const wasOnly = pages.length === 1;
  dispatch({ type: "setPages", op: (p) => removePage(p, page.id) });
  toast(`Page ${i + 1} deleted`, {
    action: {
      label: "Undo",
      onClick: () => dispatch({ type: "setPages", op: (p) => restorePage(p, i, page, wasOnly) }),
    },
  });
}
