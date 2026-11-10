/**
 * The Documents editor (owner, Oct 26: a CenterPoint-style document generator — "they need to be
 * able to edit it after its generated from the checkboxes"; the "Build a Bid" screenshots).
 *
 *   ?id=<document>            edit a bid's or ticket's document (its variables resolved)
 *   ?template=<id>            edit a template's pages, with sample variables
 *   ?template=new&kind=bid    a new template
 *
 * A slim header: Back, "<record> → <title>", Save (Ctrl/Cmd+S; disabled when clean) with a caret
 * (Save Template As…, Revisions…), Export PDF, Share link, Email. Below it the left panel (tabs
 * Document / Modules / Variables) and the page canvas (components/documents/editor/*). State is
 * the editor-state reducer; the server is documents.functions.ts. A save that trips over a newer
 * save by someone else is refused with a message naming them; the toast offers Reload.
 *
 * Nov 10 (the speed pass, finding 11): this was the whole of routes/documents.tsx, so the bare
 * /documents address downloaded the editor (168 KB packed) to show a card. The route file now
 * holds the address and the card only, and loads this screen when a document or a template is
 * opened (`DocumentsEditorScreen`, the default export, is what it loads).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useBlocker, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import {
  AlignLeft,
  ArrowLeft,
  BookmarkPlus,
  Building2,
  ChevronDown,
  Columns2,
  Bookmark,
  Copy,
  CornerDownRight,
  Eye,
  EyeOff,
  FileDown,
  GripVertical,
  History,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  LayoutTemplate,
  ListChecks,
  ListTodo,
  Redo2,
  Undo2,
  Link2,
  Loader2,
  Mail,
  Minus,
  MoreVertical,
  PanelLeft,
  PanelRight,
  Pencil,
  PenLine,
  Plus,
  Receipt,
  CircleDollarSign,
  RefreshCw,
  Save,
  Table as TableIcon,
  Trash2,
} from "lucide-react";

import {
  backHref,
  BLANK_VARIABLE_HINT,
  chipText,
  type DocumentSearch,
  filterVariables,
  groupVariables,
  MODULE_DRAG_TYPE,
  mostUsedVariables,
  OPTION_HINTS,
  PAGE_BREAK_HINT,
  PAGE_BREAK_MAX,
  PAGE_BREAK_MIN,
  parsePageBreak,
  savedModuleNamesOnPage,
  sheetInfoLabel,
  type SheetInfo,
  SNIPPET_DRAG_TYPE,
  TEMPLATES_ADMIN_PATH,
  totalSheetPages,
  variableRowValue,
  versionLine,
} from "@/lib/documents/editor-helpers";
import {
  addModule,
  canDeletePage,
  cloneModule,
  DEFAULT_OPTIONS,
  type DocKind,
  type DocModule,
  type DocOptions,
  type DocPage,
  duplicatePage,
  insertPageSnippet,
  MAX_PAGES,
  pageSnippetModules,
  instantiatePages,
  MODULE_LABELS,
  MODULE_TILES,
  type ModuleType,
  movePage,
  newModule,
  newPage,
} from "@/lib/documents/model";
import type { ImageSize } from "@/lib/documents/pdf-layout";
import { flaggedItemsNotShown, notOnPageNote, storedInspection } from "@/lib/documents/server-pure";
import { sampleVariables, type VariableDef, variableDefs } from "@/lib/documents/variables";
import {
  deleteSavedModule,
  getDocument,
  getDocumentTemplate,
  listDocumentRevisions,
  listDocumentTemplates,
  listSavedModules,
  REFRESH_FINDINGS_NOTE,
  refreshDocumentVariables,
  restoreDocumentRevision,
  saveDocument,
  saveDocumentTemplate,
  saveSavedModule,
} from "@/lib/documents.functions";
import { cn } from "@/lib/utils";
import { useDocumentActions } from "@/components/documents/document-actions";
import {
  type DocumentBundle,
  DOCUMENT_BUNDLE_GC_MS,
  documentKey,
  errText,
  revisionsKey,
  savedModulesKey,
  type TemplateRow,
  templateKey,
  templatesKey,
} from "@/components/documents/document-types";
import { EditorEnvContext, type EditorEnv } from "@/components/documents/editor/editor-context";
import {
  buildSavePayload,
  buildTemplatePayload,
  type EditorAction,
  editorReducer,
  type EditorState,
  EMPTY_EDITOR,
  selectedPageIndex,
} from "@/components/documents/editor/editor-state";
import { deletePageWithUndo } from "@/components/documents/editor/delete-page";
import { scrollToPage, scrollToSheet } from "@/components/documents/editor/editor-dom";
import { usePdfMeasure } from "@/components/documents/editor/screen-measure";
import { PageCanvas } from "@/components/documents/editor/page-canvas";
import { insertVariable } from "@/components/documents/editor/rich-text";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

/**
 * What the route loads once the address names a document or a template (routes/documents.tsx
 * reads the search and passes it on; the card for the bare address stays in the route file).
 */
export default function DocumentsEditorScreen(props: DocumentSearch) {
  const { id, template, kind } = props;
  if (id) return <DocumentEditorLoader id={id} />;
  if (template === "new") return <TemplateEditor template={null} kind={kind ?? "bid"} />;
  if (template) return <TemplateEditorLoader id={template} />;
  return null;
}

// ------------------------------------------------------------------------------- loaders

function Loading({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading the {what}…
    </div>
  );
}

function DocumentEditorLoader({ id }: { id: string }) {
  const getFn = useServerFn(getDocument);
  const q = useQuery({
    queryKey: documentKey(id),
    queryFn: () => getFn({ data: { id } }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // Never kept once the editor closes (Nov 10, urgent: "Not saved: you saved this document
    // from another tab" with one tab and one person). A save does not rewrite this copy, so
    // leaving the document and opening it again inside five minutes showed the copy from BEFORE
    // the last save, with its old version number, and every save from it was refused as stale.
    // Opening a document now always reads the row.
    gcTime: DOCUMENT_BUNDLE_GC_MS,
  });
  if (q.isLoading) return <Loading what="document" />;
  // Only when there is nothing to show: a later re-read that fails (after Export or Share)
  // must not take the open editor, and what is typed in it, off the screen.
  if (!q.data)
    return (
      <div className="py-10 text-sm text-destructive">
        Could not open the document: {q.isError ? errText(q.error) : "not found"}
      </div>
    );
  return <DocumentEditor bundle={q.data} reload={async () => void (await q.refetch())} />;
}

function TemplateEditorLoader({ id }: { id: string }) {
  const getFn = useServerFn(getDocumentTemplate);
  const q = useQuery({
    queryKey: templateKey(id),
    queryFn: () => getFn({ data: { id } }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  if (q.isLoading) return <Loading what="template" />;
  // As for a document: a failed re-read never takes the open editor off the screen.
  if (!q.data)
    return (
      <div className="py-10 text-sm text-destructive">
        Could not open the template: {q.isError ? errText(q.error) : "not found"}
      </div>
    );
  return <TemplateEditor template={q.data} kind={q.data.kind} />;
}

// ----------------------------------------------------------------------- the two editors

function useEditorState() {
  return useReducer(editorReducer, EMPTY_EDITOR);
}

/** Ctrl/Cmd+S saves. */
function useSaveShortcut(save: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);
}

function DocumentEditor(props: { bundle: DocumentBundle; reload: () => Promise<void> }) {
  const { bundle } = props;
  const doc = bundle.document;
  const qc = useQueryClient();
  const router = useRouter();
  const [state, dispatch] = useEditorState();
  const [version, setVersion] = useState(doc.version);
  const [variables, setVariables] = useState(doc.variables);
  const [loadKey, setLoadKey] = useState(0);

  // Load on open and after an explicit reload (never after our own save: a keystroke typed while
  // the refetch was in flight must not be thrown away).
  useEffect(() => {
    dispatch({
      type: "load",
      doc: { title: doc.title, pages: doc.pages, options: doc.options },
      // The template the pages came from (its name for "From template: X"); follows Start over.
      template: doc.template_id
        ? { id: doc.template_id, name: bundle.templateName ?? "Template" }
        : null,
    });
    setVersion(doc.version);
    setVariables(doc.variables);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, loadKey]);

  const reload = useCallback(async () => {
    await props.reload();
    setLoadKey((k) => k + 1);
  }, [props]);

  const saveFn = useServerFn(saveDocument);
  const save = useMutation({
    mutationFn: () => saveFn({ data: buildSavePayload(state, doc.id, version) }),
    onSuccess: (r) => {
      setVersion(r.version);
      dispatch({ type: "markSaved" });
      toast.success("Document saved");
      void qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e) => {
      const msg = errText(e);
      toast.error(msg, {
        duration: 15_000,
        ...(msg.startsWith("Not saved")
          ? { action: { label: "Reload", onClick: () => void reload() } }
          : {}),
      });
    },
  });
  const doSave = useCallback(() => {
    if (state.dirty && !save.isPending) save.mutate();
  }, [state.dirty, save]);
  useSaveShortcut(doSave);
  // "Save and leave" on the leave dialog: the same save, awaited; false when it was refused.
  const saveAsync = useCallback(async () => {
    try {
      const r = await saveFn({ data: buildSavePayload(state, doc.id, version) });
      setVersion(r.version);
      dispatch({ type: "markSaved" });
      void qc.invalidateQueries({ queryKey: ["documents"] });
      return true;
    } catch (e) {
      toast.error(errText(e), {
        duration: 15_000,
        action: { label: "Reload", onClick: () => void reload() },
      });
      return false;
    }
  }, [saveFn, state, doc.id, version, qc, reload, dispatch]);

  const refreshFn = useServerFn(refreshDocumentVariables);
  const refresh = useMutation({
    mutationFn: () => refreshFn({ data: { id: doc.id } }),
    onSuccess: (r) => {
      // The stored variables, reserved keys included: the Repair List reads the snapshot at once.
      setVariables(r.variables);
      const note = REFRESH_FINDINGS_NOTE[r.findings];
      // Checklist items read the snapshot live; flagged items none of them shows get one sentence.
      const missing = notOnPageNote(
        flaggedItemsNotShown(state.pages, storedInspection(r.variables)),
      );
      if (r.findings === "no-checklist" || r.findings === "not-inspection") toast.warning(note);
      else toast.success([note ?? "Data refreshed", missing].filter(Boolean).join(". "));
    },
    onError: (e) => toast.error(`Could not refresh the data: ${errText(e)}`),
  });

  // Deleted from the Save menu (owner, Nov 6): back to the ticket or bid it was started from,
  // with no "Leave without saving?" on the way.
  const leaveFreely = useRef(false);
  const actions = useDocumentActions(
    { id: doc.id, title: state.title, shared: !!doc.share_token, contacts: bundle.contacts },
    {
      onChanged: () => void qc.invalidateQueries({ queryKey: documentKey(doc.id) }),
      onDeleted: () => {
        leaveFreely.current = true;
        void router.navigate({ href: backHref(bundle.backTo) });
      },
      // Export prints what is on screen: save first when there are edits.
      beforeExport: async () => {
        if (!state.dirty) return true;
        try {
          const r = await saveFn({ data: buildSavePayload(state, doc.id, version) });
          setVersion(r.version);
          dispatch({ type: "markSaved" });
          return true;
        } catch (e) {
          toast.error(errText(e), {
            duration: 15_000,
            action: { label: "Reload", onClick: () => void reload() },
          });
          return false;
        }
      },
    },
  );

  const [revisionsOpen, setRevisionsOpen] = useState(false);

  return (
    <EditorShell
      mode="document"
      kind={doc.kind}
      state={state}
      dispatch={dispatch}
      variables={variables}
      photos={bundle.photos}
      documentId={doc.id}
      siteId={bundle.siteId}
      siteCoverUrl={bundle.siteCoverUrl}
      recordLabel={bundle.recordLabel}
      back={backHref(bundle.backTo)}
      saving={save.isPending}
      onSave={doSave}
      onSaveAsync={saveAsync}
      onRefreshVariables={() => refresh.mutate()}
      refreshing={refresh.isPending}
      onOpenRevisions={() => setRevisionsOpen(true)}
      onDelete={actions.confirmDelete}
      leaveFreelyRef={leaveFreely}
      headerExtra={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title={state.dirty ? "Save, then make the PDF" : "Make the PDF and open it"}
            disabled={actions.exportingPdf}
            onClick={actions.exportPdf}
          >
            {actions.exportingPdf ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            Export PDF
          </Button>
          {doc.share_token ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  title="This document has a live share link"
                >
                  <Link2 className="h-4 w-4" />
                  Shared
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={actions.shareLink}>Copy link</DropdownMenuItem>
                <DropdownMenuItem onClick={actions.revokeLink}>Turn off link</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              title="Make a link the customer can open, and copy it"
              onClick={actions.shareLink}
            >
              <Link2 className="h-4 w-4" />
              Share link
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Email the PDF"
            onClick={actions.openEmail}
          >
            <Mail className="h-4 w-4" />
            Email
          </Button>
          {actions.dialogs}
          <RevisionsSheet
            documentId={doc.id}
            open={revisionsOpen}
            onOpenChange={setRevisionsOpen}
            onRestored={reload}
          />
        </>
      }
      documentTab={
        <StartOverPicker
          kind={doc.kind}
          templateName={state.template?.name ?? null}
          onPick={(pages, template) => dispatch({ type: "startOver", pages, template })}
          options={state.options}
        />
      }
    />
  );
}

function TemplateEditor(props: { template: TemplateRow | null; kind: DocKind }) {
  const { template } = props;
  const qc = useQueryClient();
  const router = useRouter();
  const [state, dispatch] = useEditorState();
  const [description, setDescription] = useState(template?.description ?? "");
  const [savedDescription, setSavedDescription] = useState(template?.description ?? "");
  const variables = useMemo(() => sampleVariables(props.kind), [props.kind]);

  useEffect(() => {
    dispatch({
      type: "load",
      doc: template
        ? { title: template.name, pages: template.pages, options: template.options }
        : {
            title: "",
            pages: [newPage([newModule("letterhead"), newModule("hr"), newModule("body")])],
            options: { ...DEFAULT_OPTIONS },
          },
    });
    setDescription(template?.description ?? "");
    setSavedDescription(template?.description ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

  // Set by the first save of a new template: its move to its own address is not "leaving".
  const savedNew = useRef(false);
  useEffect(() => {
    if (template?.id) savedNew.current = false;
  }, [template?.id]);
  const dirty =
    state.dirty || description !== savedDescription || (!template && state.title.trim() !== "");
  const saveFn = useServerFn(saveDocumentTemplate);
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: buildTemplatePayload(state, { id: template?.id, kind: props.kind, description }),
      }),
    onSuccess: (row) => {
      dispatch({ type: "markSaved" });
      setSavedDescription(description);
      toast.success("Template saved");
      void qc.invalidateQueries({ queryKey: templatesKey(props.kind) });
      void qc.invalidateQueries({ queryKey: templatesKey() });
      if (!template) {
        // A new template moves to its own address once saved. Until that address has loaded
        // the editor still counts as "new with a name", so the leave question would come up
        // on the very save that made it (Nov 10: "Leave without saving?" right after Save, and
        // the template never got its id, so its pictures could not be stored).
        savedNew.current = true;
        void router.navigate({
          to: "/documents",
          search: { template: row.id, kind: props.kind },
          replace: true,
        });
      } else {
        qc.setQueryData(templateKey(template.id), row);
      }
    },
    onError: (e) => toast.error(`Could not save the template: ${errText(e)}`),
  });
  const doSave = useCallback(() => {
    if (dirty && !save.isPending) save.mutate();
  }, [dirty, save]);
  useSaveShortcut(doSave);
  const saveAsync = useCallback(async () => {
    try {
      await save.mutateAsync();
      return true;
    } catch {
      return false;
    }
  }, [save]);

  return (
    <EditorShell
      mode="template"
      kind={props.kind}
      state={state}
      dispatch={dispatch}
      variables={variables}
      photos={[]}
      templateId={template?.id}
      leaveFreelyRef={savedNew}
      recordLabel="Templates"
      back={TEMPLATES_ADMIN_PATH}
      saving={save.isPending}
      dirtyOverride={dirty}
      onSave={doSave}
      onSaveAsync={saveAsync}
      documentTab={
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="tpl-description">Description</Label>
            <Textarea
              id="tpl-description"
              rows={2}
              placeholder="What this template is for"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Kind:{" "}
            <span className="font-medium text-foreground">
              {props.kind === "bid" ? "Bid" : "Ticket"}
            </span>
            {" · "}The chips show sample values; a document fills them from its record.
          </div>
        </div>
      }
    />
  );
}

// ------------------------------------------------------------------------- the shell

/** Where Ctrl+Z belongs to the field itself: a text box (TipTap), an input or a textarea. */
function inOwnUndoField(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(".ProseMirror")) return true;
  if (target.closest("input, textarea, [contenteditable=true]")) return true;
  return false;
}

const TILE_ICONS: Record<ModuleType, React.ComponentType<{ className?: string }>> = {
  body: AlignLeft,
  twoColumns: Columns2,
  fullPhoto: ImageIcon,
  photoLeft: PanelLeft,
  photoRight: PanelRight,
  twoPhotos: Images,
  table: TableIcon,
  signature: PenLine,
  hr: Minus,
  letterhead: Building2,
  pricingTable: Receipt,
  priceLines: CircleDollarSign,
  pdf: FileDown,
  photoGrid: LayoutGrid,
  repairList: ListChecks,
  repairItem: ListTodo,
};

function EditorShell(props: {
  mode: "document" | "template";
  kind: DocKind;
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  variables: Record<string, string>;
  photos: EditorEnv["photos"];
  documentId?: string | undefined;
  templateId?: string | undefined;
  /** The record's property and its cover photo (phase 2), for the "Property photo" pick. */
  siteId?: string | null | undefined;
  siteCoverUrl?: string | null | undefined;
  recordLabel: string;
  back: string;
  saving: boolean;
  /** The template editor adds its description to the dirty rule. */
  dirtyOverride?: boolean | undefined;
  onSave: () => void;
  /** The save awaited (the leave dialog's "Save and leave"); false when it was refused. */
  onSaveAsync: () => Promise<boolean>;
  onRefreshVariables?: (() => void) | undefined;
  refreshing?: boolean | undefined;
  onOpenRevisions?: (() => void) | undefined;
  /** "Delete document…" in the Save menu (document mode; owner, Nov 6): the confirm, then back to the record. */
  onDelete?: (() => void) | undefined;
  /** Set true before leaving on purpose (the document was deleted): the leave dialog stays away. */
  leaveFreelyRef?: React.MutableRefObject<boolean> | undefined;
  headerExtra?: React.ReactNode;
  /** Mode-specific content under the Title on the Document tab (the template picker). */
  documentTab?: React.ReactNode;
}) {
  const { state, dispatch, mode, kind } = props;
  const qc = useQueryClient();
  const router = useRouter();
  const dirty = props.dirtyOverride ?? state.dirty;
  // Leaving with unsaved edits asks (Nov 6: a sidebar click used to drop them silently; only
  // Back and closing the tab warned): Save and leave, Leave without saving, or Stay. The tab
  // close keeps the browser's own warning.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const leaveFreely = props.leaveFreelyRef;
  const blocker = useBlocker({
    shouldBlockFn: () => dirtyRef.current && !leaveFreely?.current,
    withResolver: true,
    enableBeforeUnload: () => dirtyRef.current && !leaveFreely?.current,
  });
  const [leaving, setLeaving] = useState(false);
  const activeEditorRef = useRef<Editor | null>(null);
  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y) undo and redo the document's own history —
  // modules and pages added, moved, deleted, options — unless the keys land in a text box or an
  // input, which keep their own undo (TipTap's, the browser's).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      if (inOwnUndoField(e.target)) return;
      e.preventDefault();
      dispatch({ type: k === "y" || e.shiftKey ? "redo" : "undo" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveModule, setSaveModule] = useState<DocModule | null>(null);
  // "Save page as snippet…" on a page's menu: the page being named, or null.
  const [savePage, setSavePage] = useState<DocPage | null>(null);
  // Each page's sheets as the canvas laid them out (continued sheets, an inserted PDF's pages):
  // the Pages list counts and lists every one (owner, Nov 10).
  const [sheetsByPage, setSheetsByPage] = useState<Record<string, SheetInfo[]>>({});
  const onSheets = useCallback((pageId: string, sheets: SheetInfo[]) => {
    setSheetsByPage((prev) =>
      JSON.stringify(prev[pageId] ?? null) === JSON.stringify(sheets)
        ? prev
        : { ...prev, [pageId]: sheets },
    );
  }, []);

  const savedFn = useServerFn(listSavedModules);
  const savedModules = useQuery({ queryKey: savedModulesKey, queryFn: () => savedFn() });

  // The sheets follow the PDF's own pagination (Nov 6): its text metrics, loaded once, and the
  // size of every picture as the canvas loads it.
  const measure = usePdfMeasure();
  const [imageSizes, setImageSizes] = useState<Record<string, ImageSize | null>>({});
  const reportImageSize = useCallback((key: string, size: ImageSize | null) => {
    setImageSizes((cur) => {
      const was = cur[key];
      if (was === size) return cur;
      if (was && size && was.width === size.width && was.height === size.height) return cur;
      return { ...cur, [key]: size };
    });
  }, []);

  const saveModuleFn = useServerFn(saveSavedModule);
  const saveModuleMut = useMutation({
    mutationFn: (input: { name: string; module: DocModule; pageModules?: DocModule[] }) =>
      saveModuleFn({ data: input }),
    onSuccess: (_row, input) => {
      if (input.pageModules)
        toast.success("Page saved as a snippet. Find it under Saved snippets on the Modules tab.");
      else toast.success("Snippet saved");
      setSaveModule(null);
      setSavePage(null);
      void qc.invalidateQueries({ queryKey: savedModulesKey });
    },
    onError: (e) => toast.error(`Could not save the snippet: ${errText(e)}`),
  });

  const env = useMemo<EditorEnv>(
    () => ({
      kind,
      mode,
      variables: props.variables,
      photos: props.photos,
      options: state.options,
      documentId: props.documentId,
      templateId: props.templateId,
      siteId: props.siteId ?? null,
      siteCoverUrl: props.siteCoverUrl ?? null,
      dispatch,
      setActiveEditor: (e) => {
        activeEditorRef.current = e;
      },
      onSaveModule: (m) => setSaveModule(m),
      onSavePage: setSavePage,
      onSheets,
      snippets: savedModules.data ?? EMPTY_SNIPPETS,
      measure,
      imageSizes,
      reportImageSize,
    }),
    [
      measure,
      imageSizes,
      reportImageSize,
      kind,
      mode,
      props.variables,
      props.photos,
      state.options,
      props.documentId,
      props.templateId,
      props.siteId,
      props.siteCoverUrl,
      dispatch,
      savedModules.data,
      onSheets,
    ],
  );

  const [toolsOpen, setToolsOpen] = useState(false);
  const addToSelected = (m: DocModule) => {
    setToolsOpen(false);
    const i = selectedPageIndex(state);
    dispatch({ type: "setPages", op: (pages) => addModule(pages, i, m) });
    const page = state.pages[i];
    if (page) window.setTimeout(() => scrollToPage(page.id), 50);
  };

  /** A page snippet: a NEW page right after the selected one, filled with fresh copies. */
  const addSavedPage = (name: string, modules: readonly DocModule[]) => {
    setToolsOpen(false);
    const r = insertPageSnippet(state.pages, selectedPageIndex(state), modules);
    if (!r) {
      toast.error(`A document holds ${MAX_PAGES} pages at most. Delete a page first.`);
      return;
    }
    dispatch({ type: "setPages", op: () => r.pages });
    toast.success(`“${name}” added as page ${r.index + 1}`);
    window.setTimeout(() => scrollToPage(r.pageId), 80);
  };

  const title = state.title || (mode === "template" ? "New template" : "Untitled");

  // The Document / Modules / Variables tabs: a side panel from md up; on a phone (Nov 6: the
  // panel was simply hidden, so nothing could be added or set) the same tabs in a sheet the
  // header's Tools button opens. Adding a module closes the sheet so the page is seen.
  const panelTabs = (
    <Tabs defaultValue="document" className="w-full">
      <TabsList className="m-3 grid w-auto grid-cols-3">
        <TabsTrigger value="document">Document</TabsTrigger>
        <TabsTrigger value="modules">Modules</TabsTrigger>
        <TabsTrigger value="variables">Variables</TabsTrigger>
      </TabsList>
      <TabsContent value="document" className="space-y-5 px-3 pb-6">
        <DocumentTab
          mode={mode}
          state={state}
          dispatch={dispatch}
          savedModules={savedModules.data ?? []}
          onSavePage={setSavePage}
          sheetsByPage={sheetsByPage}
        >
          {props.documentTab}
        </DocumentTab>
      </TabsContent>
      <TabsContent value="modules" className="space-y-4 px-3 pb-6">
        <ModulesTab
          savedModules={savedModules.data ?? []}
          savedError={savedModules.isError ? errText(savedModules.error) : null}
          onAdd={(type) => addToSelected(newModule(type))}
          onAddSaved={(m) => addToSelected(cloneModule(m))}
          onAddSavedPage={addSavedPage}
        />
      </TabsContent>
      <TabsContent value="variables" className="space-y-3 px-3 pb-6">
        <VariablesTab
          kind={kind}
          variables={props.variables}
          onInsert={(key) => {
            if (!insertVariable(activeEditorRef.current, key))
              toast.info("Click into a text box first, then click the variable.");
          }}
          onRefresh={props.onRefreshVariables}
          refreshing={props.refreshing ?? false}
        />
      </TabsContent>
    </Tabs>
  );

  return (
    <EditorEnvContext.Provider value={env}>
      <div className="-m-4 flex min-h-[calc(100svh-3.5rem)] flex-col sm:-m-6">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title={mode === "template" ? "Back to the templates" : "Back to the record"}
            onClick={() => void router.navigate({ href: props.back })}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="min-w-0 flex-1 truncate text-sm">
            <span className="text-muted-foreground">{props.recordLabel}</span>
            <span className="mx-2 text-muted-foreground">→</span>
            <span className="font-medium">{title}</span>
            {dirty ? <span className="ml-2 text-xs text-muted-foreground">(unsaved)</span> : null}
          </div>
          {/* flex-wrap: on a phone the row would widen the page (and the Tools sheet) past it. */}
          <div className="flex flex-wrap items-center justify-end gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="md:hidden"
              title="Title, options, modules, variables and pages"
              onClick={() => setToolsOpen(true)}
            >
              <PanelLeft className="h-4 w-4" />
              Tools
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              disabled={state.past.length === 0}
              onClick={() => dispatch({ type: "undo" })}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Redo (Ctrl+Shift+Z)"
              aria-label="Redo"
              disabled={state.future.length === 0}
              onClick={() => dispatch({ type: "redo" })}
            >
              <Redo2 className="h-4 w-4" />
            </Button>
            <div className="flex items-center">
              <Button
                type="button"
                size="sm"
                className="rounded-r-none"
                title="Save (Ctrl+S)"
                disabled={!dirty || props.saving}
                onClick={props.onSave}
              >
                {props.saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-l-none border-l border-primary-foreground/30 px-1.5"
                    title="More ways to save"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setSaveAsOpen(true)}>
                    <LayoutTemplate className="h-4 w-4" /> Save Template As…
                  </DropdownMenuItem>
                  {props.onOpenRevisions ? (
                    <DropdownMenuItem onClick={props.onOpenRevisions}>
                      <History className="h-4 w-4" /> Revisions…
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href={TEMPLATES_ADMIN_PATH}>
                      <LayoutTemplate className="h-4 w-4" /> Manage Templates
                    </a>
                  </DropdownMenuItem>
                  {props.onDelete ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={props.onDelete}>
                        <Trash2 className="h-4 w-4" /> Delete document…
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {props.headerExtra}
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 items-stretch">
          <aside
            className="sticky top-14 hidden w-[480px] shrink-0 self-start overflow-y-auto border-r bg-background md:block"
            style={{ maxHeight: "calc(100svh - 7rem)" }}
          >
            {panelTabs}
          </aside>
          <Sheet open={toolsOpen} onOpenChange={setToolsOpen}>
            <SheetContent side="left" className="w-full overflow-y-auto p-0 sm:max-w-md md:hidden">
              <SheetHeader className="sr-only">
                <SheetTitle>Tools</SheetTitle>
                <SheetDescription>Title, options, modules, variables and pages.</SheetDescription>
              </SheetHeader>
              {panelTabs}
            </SheetContent>
          </Sheet>
          <main className="min-w-0 flex-1">
            <PageCanvas
              pages={state.pages}
              options={state.options}
              selectedPageId={state.selectedPageId}
            />
          </main>
        </div>
      </div>

      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(o) => {
          if (!o && blocker.status === "blocked" && !leaving) blocker.reset();
        }}
      >
        <AlertDialogContent data-leave-dialog>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "template" ? "This template" : "This document"} has edits that are not saved
              yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>Stay</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              disabled={leaving}
              onClick={() => {
                if (blocker.status === "blocked") blocker.proceed();
              }}
            >
              Leave without saving
            </Button>
            <AlertDialogAction
              disabled={leaving}
              onClick={async (e) => {
                e.preventDefault();
                setLeaving(true);
                const ok = await props.onSaveAsync();
                setLeaving(false);
                if (blocker.status !== "blocked") return;
                if (ok) blocker.proceed();
                else blocker.reset();
              }}
            >
              {leaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save and leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SaveTemplateAsDialog
        open={saveAsOpen}
        onOpenChange={setSaveAsOpen}
        kind={kind}
        pages={state.pages}
        options={state.options}
        defaultName={mode === "template" ? `${state.title} copy` : state.title}
      />
      <NamePromptDialog
        open={saveModule !== null}
        onOpenChange={(o) => {
          if (!o) setSaveModule(null);
        }}
        title="Save as snippet"
        description="A saved snippet is this module with its content kept; it is offered under Saved snippets on the Modules tab of every document and template."
        label="Snippet name"
        placeholder="e.g. Sustainability_Sheet"
        busy={saveModuleMut.isPending}
        onSubmit={(name) => {
          if (saveModule) saveModuleMut.mutate({ name, module: cloneModule(saveModule) });
        }}
      />
      <NamePromptDialog
        open={savePage !== null}
        onOpenChange={(o) => {
          if (!o) setSavePage(null);
        }}
        title={
          savePage
            ? `Save page ${state.pages.findIndex((x) => x.id === savePage.id) + 1} as a snippet`
            : "Save page as a snippet"
        }
        description="This is the page you picked, by its menu or the button under it. The whole page is saved, every module with its content. It is offered under Saved snippets on the Modules tab of every document and template; its + adds it as a new page."
        label="Snippet name"
        placeholder="e.g. Roof Evaluation Summary"
        busy={saveModuleMut.isPending}
        onSubmit={(name) => {
          const mods = savePage ? pageSnippetModules(savePage) : null;
          if (mods) saveModuleMut.mutate({ name, module: mods[0]!, pageModules: mods });
        }}
      />
    </EditorEnvContext.Provider>
  );
}

// ------------------------------------------------------------------------- Document tab

function DocumentTab(props: {
  mode: "document" | "template";
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  savedModules: ReadonlyArray<{ name: string; module: DocModule }>;
  /** "Save page as snippet…" on a page's menu. */
  onSavePage?: (page: DocPage) => void;
  /** Each page's sheets as the canvas laid them out (absent until it has). */
  sheetsByPage?: Readonly<Record<string, readonly SheetInfo[] | undefined>>;
  children?: React.ReactNode;
}) {
  const { state, dispatch } = props;
  const [breakText, setBreakText] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, boolean>>({});
  const setOpt = (patch: Partial<DocOptions>) => dispatch({ type: "setOptions", patch });
  const op = (f: (pages: readonly DocPage[]) => DocPage[]) => dispatch({ type: "setPages", op: f });
  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="doc-title">{props.mode === "template" ? "Name" : "Title"}</Label>
        <Input
          id="doc-title"
          placeholder={props.mode === "template" ? "Template name" : "Document title"}
          value={state.title}
          onChange={(e) => dispatch({ type: "setTitle", title: e.target.value })}
        />
      </div>
      {props.children}

      <div className="space-y-2">
        <div className="text-sm font-medium">Options</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2 text-sm" title={OPTION_HINTS.prices}>
            <Checkbox
              checked={state.options.prices === "total"}
              onCheckedChange={(c) => setOpt({ prices: c ? "total" : "none" })}
            />
            With prices
          </label>
          <label className="flex items-center gap-2 text-sm" title={OPTION_HINTS.photos}>
            <Checkbox
              checked={state.options.photos}
              onCheckedChange={(c) => setOpt({ photos: c === true })}
            />
            Photos
          </label>
          <label className="flex items-center gap-2 text-sm" title={OPTION_HINTS.marks}>
            <Checkbox
              checked={state.options.marks}
              onCheckedChange={(c) => setOpt({ marks: c === true })}
            />
            Marks on photos
          </label>
          <label className="flex items-center gap-2 text-sm" title={OPTION_HINTS.footer}>
            <Checkbox
              checked={state.options.footer}
              onCheckedChange={(c) => setOpt({ footer: c === true })}
            />
            Footer
          </label>
          <label
            className="col-span-2 flex items-center gap-2 text-sm"
            title={OPTION_HINTS.itemPerPage}
          >
            <Checkbox
              checked={state.options.itemPerPage}
              onCheckedChange={(c) => setOpt({ itemPerPage: c === true })}
            />
            One checklist item per page
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="doc-page-break" className="shrink-0 text-sm">
            Page break
          </Label>
          <Input
            id="doc-page-break"
            type="number"
            inputMode="decimal"
            min={PAGE_BREAK_MIN}
            max={PAGE_BREAK_MAX}
            step="0.1"
            className="h-8 w-24"
            value={breakText ?? String(state.options.pageBreakIn)}
            onChange={(e) => setBreakText(e.target.value)}
            onBlur={() => {
              if (breakText === null) return;
              setOpt({ pageBreakIn: parsePageBreak(breakText) });
              setBreakText(null);
            }}
          />
          <span className="text-sm text-muted-foreground">inches</span>
        </div>
        <p className="text-xs text-muted-foreground">{PAGE_BREAK_HINT}</p>
      </div>

      <div className="space-y-1">
        <div className="text-sm font-medium" data-pages-total>
          Pages (
          {totalSheetPages(
            state.pages.map((p) => p.id),
            props.sheetsByPage ?? {},
          )}
          )
        </div>
        <ul className="divide-y rounded-md border">
          {state.pages.map((page, i) => {
            const chips = savedModuleNamesOnPage(page, props.savedModules);
            const selected = page.id === state.selectedPageId;
            const preview = previews[page.id] ?? false;
            return (
              <li key={page.id} className={cn("px-2 py-1.5", selected && "bg-accent/40")}>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex-1 text-left text-sm"
                    title="Select this page"
                    onClick={() => dispatch({ type: "selectPage", pageId: page.id })}
                  >
                    {i + 1} Page
                    <span className="ml-2 text-xs text-muted-foreground">
                      {page.modules.length} module{page.modules.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Edit this page (scroll to it)"
                    onClick={() => {
                      dispatch({ type: "selectPage", pageId: page.id });
                      scrollToPage(page.id);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title={preview ? "Hide what is on the page" : "Show what is on the page"}
                    onClick={() => setPreviews({ ...previews, [page.id]: !preview })}
                  >
                    {preview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Page menu"
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={i === 0}
                        onClick={() => op((p) => movePage(p, page.id, -1))}
                      >
                        Move up
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={i === state.pages.length - 1}
                        onClick={() => op((p) => movePage(p, page.id, 1))}
                      >
                        Move down
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => op((p) => duplicatePage(p, page.id))}>
                        <Copy className="h-4 w-4" /> Duplicate
                      </DropdownMenuItem>
                      {props.onSavePage && (
                        <DropdownMenuItem
                          disabled={page.modules.length === 0}
                          onClick={() => props.onSavePage?.(page)}
                        >
                          <Bookmark className="h-4 w-4" /> Save page {i + 1} as a snippet…
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        disabled={!canDeletePage(state.pages, page)}
                        onClick={() => deletePageWithUndo(dispatch, state.pages, page)}
                      >
                        <Trash2 className="h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {(props.sheetsByPage?.[page.id] ?? []).map((sheet, k) =>
                  sheet.kind === "page" ? null : (
                    <button
                      key={k}
                      type="button"
                      data-sheet-row={sheet.kind}
                      className="flex w-full items-center gap-1.5 py-0.5 pl-4 text-left text-xs text-muted-foreground hover:text-foreground"
                      title="Go to this page"
                      onClick={() => {
                        dispatch({ type: "selectPage", pageId: page.id });
                        scrollToSheet(page.id, k);
                      }}
                    >
                      <CornerDownRight className="h-3 w-3 shrink-0" />
                      <span className="truncate">{sheetInfoLabel(sheet)}</span>
                    </button>
                  ),
                )}
                {chips.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {chips.map((c) => (
                      <Badge
                        key={c}
                        variant="secondary"
                        className="h-5 px-1.5 text-[10px]"
                        title="A saved snippet on this page"
                      >
                        {c}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {preview ? (
                  <ol className="mt-1 list-inside list-decimal text-xs text-muted-foreground">
                    {page.modules.length === 0 ? <li className="list-none">Empty</li> : null}
                    {page.modules.map((m) => (
                      <li key={m.id}>
                        {MODULE_LABELS[m.type]}
                        {m.type === "pdf" ? `: ${m.name}` : ""}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

/**
 * Document mode: "From template: X" and "Start over from template…" (confirms, then replaces the
 * pages). The pick hands back the template too, so the label and the saved template_id follow it.
 */
function StartOverPicker(props: {
  kind: DocKind;
  templateName: string | null;
  options: DocOptions;
  onPick: (pages: DocPage[], template: { id: string; name: string }) => void;
}) {
  const listFn = useServerFn(listDocumentTemplates);
  const getFn = useServerFn(getDocumentTemplate);
  const templates = useQuery({
    queryKey: templatesKey(props.kind),
    queryFn: () => listFn({ data: { kind: props.kind } }),
    staleTime: 60_000,
  });
  const [pending, setPending] = useState<string | null>(null);
  const pendingRow = templates.data?.find((t) => t.id === pending) ?? null;
  const apply = useMutation({
    mutationFn: async (id: string) => getFn({ data: { id } }),
    onSuccess: (t) => {
      props.onPick(instantiatePages(t.pages, props.options), { id: t.id, name: t.name });
      setPending(null);
      toast.success(`Pages replaced from "${t.name}" — Save to keep them`);
    },
    onError: (e) => toast.error(`Could not load the template: ${errText(e)}`),
  });
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">
        From template: <span className="text-foreground">{props.templateName ?? "Blank"}</span>
      </div>
      <Select value="" onValueChange={(v) => setPending(v)}>
        <SelectTrigger className="h-8" title="Replace every page with a template's pages">
          <SelectValue placeholder="Start over from template…" />
        </SelectTrigger>
        <SelectContent>
          {(templates.data ?? []).map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Start over from "{pendingRow?.name ?? "this template"}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every page of this document is replaced with the template's pages, with the options as
              they are set now. Nothing is saved until you press Save.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={apply.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={apply.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pending) apply.mutate(pending);
              }}
            >
              {apply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Replace pages
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// -------------------------------------------------------------------------- Modules tab

/** One stable empty list while the snippets load, so the editor env does not re-memo each render. */
const EMPTY_SNIPPETS: ReadonlyArray<{ id: string; name: string; module: DocModule }> = [];

function ModulesTab(props: {
  savedModules: ReadonlyArray<{
    id: string;
    name: string;
    module: DocModule;
    page_modules?: DocModule[] | null;
  }>;
  savedError: string | null;
  onAdd: (type: ModuleType) => void;
  onAddSaved: (m: DocModule) => void;
  /** A page snippet: add it as a new page after the selected one. */
  onAddSavedPage: (name: string, modules: readonly DocModule[]) => void;
}) {
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteSavedModule);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Saved snippet deleted");
      setPendingDelete(null);
      void qc.invalidateQueries({ queryKey: savedModulesKey });
    },
    onError: (e) => toast.error(`Could not delete the saved snippet: ${errText(e)}`),
  });
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Drag a module or a snippet onto a page where you want it, or use + to add it to the bottom
        of the selected page.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {MODULE_TILES.map((type) => {
          const Icon = TILE_ICONS[type];
          return (
            <div
              key={type}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(MODULE_DRAG_TYPE, type);
                e.dataTransfer.effectAllowed = "copy";
              }}
              className="flex cursor-grab items-center gap-2 rounded-md border bg-card px-2 py-2 text-sm hover:bg-accent/50 active:cursor-grabbing"
              title={`${MODULE_LABELS[type]} — drag onto a page`}
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{MODULE_LABELS[type]}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                title={`Add ${MODULE_LABELS[type]} to the selected page`}
                onClick={() => props.onAdd(type)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium">Saved snippets</div>
        {props.savedError ? (
          <p className="text-xs text-destructive">
            Could not load the saved snippets: {props.savedError}
          </p>
        ) : props.savedModules.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None yet. Fill in a module on the page, hover it and use{" "}
            <BookmarkPlus className="inline h-3 w-3" /> Save as snippet…
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {props.savedModules.map((s) => (
              <li
                key={s.id}
                data-snippet={s.page_modules?.length ? "page" : "module"}
                // A page snippet becomes a new page (its +); only a one-module snippet is dragged.
                draggable={!s.page_modules?.length}
                onDragStart={(e) => {
                  if (s.page_modules?.length) return;
                  e.dataTransfer.setData(SNIPPET_DRAG_TYPE, s.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 text-sm hover:bg-accent/50",
                  !s.page_modules?.length && "cursor-grab active:cursor-grabbing",
                )}
                title={
                  s.page_modules?.length
                    ? `${s.name} — a whole page; its + adds it as a new page`
                    : `${s.name} — drag onto a page`
                }
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate" title={MODULE_LABELS[s.module.type]}>
                  {s.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {s.page_modules?.length
                    ? `Page · ${s.page_modules.length} ${s.page_modules.length === 1 ? "module" : "modules"}`
                    : MODULE_LABELS[s.module.type]}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title={
                    s.page_modules?.length
                      ? "Add as a new page after the selected page"
                      : "Add a copy to the selected page"
                  }
                  onClick={() =>
                    s.page_modules?.length
                      ? props.onAddSavedPage(s.name, s.page_modules)
                      : props.onAddSaved(s.module)
                  }
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  title="Delete this saved snippet"
                  onClick={() => setPendingDelete({ id: s.id, name: s.name })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the saved snippet "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Pages that already use it keep their copy; it just stops being offered here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) remove.mutate(pendingDelete.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ------------------------------------------------------------------------ Variables tab

function VariablesTab(props: {
  kind: DocKind;
  variables: Record<string, string>;
  onInsert: (key: string) => void;
  onRefresh?: (() => void) | undefined;
  refreshing: boolean;
}) {
  const [filter, setFilter] = useState("");
  // Which groups are unfolded (all fold by default; a typed filter shows every match).
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const defs = useMemo(() => variableDefs(props.kind), [props.kind]);
  const groups = useMemo(() => groupVariables(filterVariables(filter, defs)), [filter, defs]);
  const mostUsed = useMemo(() => mostUsedVariables(defs), [defs]);
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Available variables. Type / in a text box, drag one in, or click to insert at the cursor.
      </p>
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter"
          className="h-8"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {props.onRefresh ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Read the record again (the chips update)"
            disabled={props.refreshing}
            onClick={props.onRefresh}
          >
            {props.refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh data
          </Button>
        ) : null}
      </div>
      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">No variable matches "{filter}".</p>
      ) : null}
      {mostUsed.length && !filter.trim() ? (
        <VariableRows
          title="Most used"
          defs={mostUsed}
          variables={props.variables}
          onInsert={props.onInsert}
        />
      ) : null}
      {groups.map((g) => {
        // Folded unless a filter is typed (Nov 6: 45 rows buried the ones people need).
        const folded = !filter.trim() && !open[g.group];
        return (
          <VariableRows
            key={g.group}
            title={g.group}
            defs={g.defs}
            variables={props.variables}
            onInsert={props.onInsert}
            folded={folded}
            onToggle={
              filter.trim() ? undefined : () => setOpen({ ...open, [g.group]: !open[g.group] })
            }
          />
        );
      })}
    </>
  );
}

/** One titled list of variable rows: label, value (a dash for a blank), click to insert. */
function VariableRows(props: {
  title: string;
  defs: readonly VariableDef[];
  variables: Record<string, string>;
  onInsert: (key: string) => void;
  folded?: boolean | undefined;
  /** Given: the title is a button that folds / unfolds the list. */
  onToggle?: (() => void) | undefined;
}) {
  const heading = (
    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {props.title}
    </span>
  );
  return (
    <div className="space-y-0.5" data-variable-group={props.title}>
      {props.onToggle ? (
        <button
          type="button"
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-accent/50"
          title={props.folded ? "Show these variables" : "Hide these variables"}
          aria-expanded={!props.folded}
          onClick={props.onToggle}
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 text-muted-foreground", props.folded && "-rotate-90")}
          />
          {heading}
          <span className="text-xs text-muted-foreground">({props.defs.length})</span>
        </button>
      ) : (
        <div className="px-1">{heading}</div>
      )}
      {props.folded ? null : (
        <ul className="divide-y rounded-md border">
          {props.defs.map((d) => {
            const blank = !props.variables[d.key];
            return (
              <li key={d.key}>
                <button
                  type="button"
                  className="flex w-full items-baseline gap-2 px-2 py-1 text-left text-sm hover:bg-accent/50"
                  title={
                    blank
                      ? `Insert ${d.label} (${d.key}) at the cursor. ${BLANK_VARIABLE_HINT}`
                      : `Insert ${d.label} (${d.key}) at the cursor; prints "${chipText(d.key, props.variables)}"`
                  }
                  onClick={() => props.onInsert(d.key)}
                >
                  <span className="w-40 shrink-0 truncate">{d.label}</span>
                  <span className="text-muted-foreground">:</span>
                  <span className={cn("min-w-0 flex-1 truncate", blank && "text-muted-foreground")}>
                    {variableRowValue(props.variables[d.key])}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------ dialogs

function NamePromptDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  placeholder?: string | undefined;
  defaultValue?: string | undefined;
  busy: boolean;
  onSubmit: (name: string) => void;
  children?: React.ReactNode;
}) {
  const [name, setName] = useState<string | null>(null);
  const value = name ?? props.defaultValue ?? "";
  const submit = () => {
    if (value.trim() && !props.busy) props.onSubmit(value.trim());
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (!o) setName(null);
        props.onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="name-prompt">{props.label}</Label>
            <Input
              id="name-prompt"
              autoFocus
              placeholder={props.placeholder}
              value={value}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>
          {props.children}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!value.trim() || props.busy} onClick={submit}>
            {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SaveTemplateAsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: DocKind;
  pages: DocPage[];
  options: DocOptions;
  defaultName: string;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveDocumentTemplate);
  const [description, setDescription] = useState("");
  const save = useMutation({
    mutationFn: (name: string) =>
      saveFn({
        data: {
          kind: props.kind,
          name,
          description: description.trim(),
          pages: props.pages,
          options: props.options,
        },
      }),
    onSuccess: (row) => {
      toast.success(`Template "${row.name}" saved`);
      setDescription("");
      props.onOpenChange(false);
      void qc.invalidateQueries({ queryKey: templatesKey(props.kind) });
      void qc.invalidateQueries({ queryKey: templatesKey() });
    },
    onError: (e) => toast.error(`Could not save the template: ${errText(e)}`),
  });
  return (
    <NamePromptDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Save Template As"
      description="These pages and options become a template every new document of this kind can start from."
      label="Template name"
      defaultValue={props.defaultName}
      busy={save.isPending}
      onSubmit={(name) => save.mutate(name)}
    >
      <div className="space-y-1">
        <Label htmlFor="tpl-as-description">Description</Label>
        <Textarea
          id="tpl-as-description"
          rows={2}
          placeholder="What this template is for"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
    </NamePromptDialog>
  );
}

function RevisionsSheet(props: {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: () => Promise<void>;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listDocumentRevisions);
  const restoreFn = useServerFn(restoreDocumentRevision);
  const q = useQuery({
    queryKey: revisionsKey(props.documentId),
    queryFn: () => listFn({ data: { id: props.documentId } }),
    enabled: props.open,
  });
  const restore = useMutation({
    mutationFn: (version: number) => restoreFn({ data: { id: props.documentId, version } }),
    onSuccess: async (_r, version) => {
      toast.success(`Restored v${version} as a new save`);
      props.onOpenChange(false);
      void qc.invalidateQueries({ queryKey: revisionsKey(props.documentId) });
      await props.onRestored();
    },
    onError: (e) => toast.error(`Could not restore that revision: ${errText(e)}`),
  });
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Revisions</SheetTitle>
          <SheetDescription>
            Every save. Restore brings an earlier one back as a new save; nothing is lost.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {q.isLoading ? (
            <Loading what="revisions" />
          ) : q.isError ? (
            <p className="text-sm text-destructive">
              Could not load the revisions: {errText(q.error)}
            </p>
          ) : (q.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No saves yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {(q.data ?? []).map((r, i) => (
                <li key={r.version} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{r.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {versionLine({
                        version: r.version,
                        updated_at: r.saved_at,
                        updated_by_name: r.saved_by_name,
                      })}
                      {i === 0 ? " · current" : ""}
                    </div>
                  </div>
                  {i === 0 ? null : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      title="Bring this revision back"
                      disabled={restore.isPending}
                      onClick={() => restore.mutate(r.version)}
                    >
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
