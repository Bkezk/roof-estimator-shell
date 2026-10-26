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
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
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
  Copy,
  Eye,
  EyeOff,
  FileDown,
  History,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  LayoutTemplate,
  ListChecks,
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
  RefreshCw,
  Save,
  Table as TableIcon,
  Trash2,
} from "lucide-react";

import {
  backHref,
  chipText,
  documentSearch,
  filterVariables,
  groupVariables,
  MODULE_DRAG_TYPE,
  PAGE_BREAK_HINT,
  PAGE_BREAK_MAX,
  PAGE_BREAK_MIN,
  parsePageBreak,
  savedModuleNamesOnPage,
  TEMPLATES_ADMIN_PATH,
  variableRowValue,
  versionLine,
} from "@/lib/documents/editor-helpers";
import {
  addModule,
  cloneModule,
  DEFAULT_OPTIONS,
  type DocKind,
  type DocModule,
  type DocOptions,
  type DocPage,
  duplicatePage,
  instantiatePages,
  MODULE_LABELS,
  MODULE_TILES,
  type ModuleType,
  movePage,
  newModule,
  newPage,
  removePage,
} from "@/lib/documents/model";
import { sampleVariables, variableDefs } from "@/lib/documents/variables";
import {
  deleteSavedModule,
  getDocument,
  getDocumentTemplate,
  listDocumentRevisions,
  listDocumentTemplates,
  listSavedModules,
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
import { scrollToPage } from "@/components/documents/editor/editor-dom";
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

export const Route = createFileRoute("/documents")({
  head: () => ({ meta: [{ title: "Documents — JBK Portal" }] }),
  validateSearch: documentSearch,
  component: DocumentsRoute,
});

function DocumentsRoute() {
  const { id, template, kind } = Route.useSearch();
  if (id) return <DocumentEditorLoader id={id} />;
  if (template === "new") return <TemplateEditor template={null} kind={kind ?? "bid"} />;
  if (template) return <TemplateEditorLoader id={template} />;
  return (
    <div className="mx-auto max-w-md space-y-3 rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">Documents open from a bid or a ticket.</p>
      <p className="text-sm text-muted-foreground">
        Use "Documents" on the bid or ticket to make or open one. Templates are under Admin.
      </p>
      <Button asChild variant="outline">
        <a href={TEMPLATES_ADMIN_PATH}>Manage Templates</a>
      </Button>
    </div>
  );
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
  });
  if (q.isLoading) return <Loading what="document" />;
  if (q.isError || !q.data)
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
  if (q.isError || !q.data)
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

/** Warn before the tab closes with unsaved edits. */
function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);
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
  useLeaveGuard(state.dirty);

  const refreshFn = useServerFn(refreshDocumentVariables);
  const refresh = useMutation({
    mutationFn: () => refreshFn({ data: { id: doc.id } }),
    onSuccess: (r) => {
      setVariables(r.variables);
      toast.success("Data refreshed");
    },
    onError: (e) => toast.error(`Could not refresh the data: ${errText(e)}`),
  });

  const actions = useDocumentActions(
    { id: doc.id, title: state.title, shared: !!doc.share_token, contacts: bundle.contacts },
    {
      onChanged: () => void qc.invalidateQueries({ queryKey: documentKey(doc.id) }),
      onDeleted: () => void router.navigate({ href: backHref(bundle.backTo) }),
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
      onRefreshVariables={() => refresh.mutate()}
      refreshing={refresh.isPending}
      onOpenRevisions={() => setRevisionsOpen(true)}
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
          templateName={bundle.templateName}
          onPick={(pages) => dispatch({ type: "setPages", op: () => pages })}
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
  useLeaveGuard(dirty);

  return (
    <EditorShell
      mode="template"
      kind={props.kind}
      state={state}
      dispatch={dispatch}
      variables={variables}
      photos={[]}
      templateId={template?.id}
      recordLabel="Templates"
      back={TEMPLATES_ADMIN_PATH}
      saving={save.isPending}
      dirtyOverride={dirty}
      onSave={doSave}
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
  pdf: FileDown,
  photoGrid: LayoutGrid,
  repairList: ListChecks,
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
  onRefreshVariables?: (() => void) | undefined;
  refreshing?: boolean | undefined;
  onOpenRevisions?: (() => void) | undefined;
  headerExtra?: React.ReactNode;
  /** Mode-specific content under the Title on the Document tab (the template picker). */
  documentTab?: React.ReactNode;
}) {
  const { state, dispatch, mode, kind } = props;
  const qc = useQueryClient();
  const router = useRouter();
  const dirty = props.dirtyOverride ?? state.dirty;
  const activeEditorRef = useRef<Editor | null>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveModule, setSaveModule] = useState<DocModule | null>(null);

  const savedFn = useServerFn(listSavedModules);
  const savedModules = useQuery({ queryKey: savedModulesKey, queryFn: () => savedFn() });

  const saveModuleFn = useServerFn(saveSavedModule);
  const saveModuleMut = useMutation({
    mutationFn: (input: { name: string; module: DocModule }) => saveModuleFn({ data: input }),
    onSuccess: () => {
      toast.success("Module saved");
      setSaveModule(null);
      void qc.invalidateQueries({ queryKey: savedModulesKey });
    },
    onError: (e) => toast.error(`Could not save the module: ${errText(e)}`),
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
    }),
    [
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
    ],
  );

  const addToSelected = (m: DocModule) => {
    const i = selectedPageIndex(state);
    dispatch({ type: "setPages", op: (pages) => addModule(pages, i, m) });
    const page = state.pages[i];
    if (page) window.setTimeout(() => scrollToPage(page.id), 50);
  };

  const title = state.title || (mode === "template" ? "New template" : "Untitled");

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
            onClick={() => {
              if (dirty && !window.confirm("Leave without saving? Your edits will be lost."))
                return;
              void router.navigate({ href: props.back });
            }}
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
          <div className="flex items-center gap-1">
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
                  onSaveAs={() => setSaveAsOpen(true)}
                  onOpenRevisions={props.onOpenRevisions}
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
          </aside>
          <main className="min-w-0 flex-1">
            <PageCanvas
              pages={state.pages}
              options={state.options}
              selectedPageId={state.selectedPageId}
            />
          </main>
        </div>
      </div>

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
        title="Save as module"
        description="A saved module is offered on the Modules tab of every document and template."
        label="Module name"
        placeholder="e.g. Sustainability_Sheet"
        busy={saveModuleMut.isPending}
        onSubmit={(name) => {
          if (saveModule) saveModuleMut.mutate({ name, module: cloneModule(saveModule) });
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
  onSaveAs: () => void;
  onOpenRevisions?: (() => void) | undefined;
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
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={state.options.prices === "total"}
              onCheckedChange={(c) => setOpt({ prices: c ? "total" : "none" })}
            />
            With prices
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={state.options.photos}
              onCheckedChange={(c) => setOpt({ photos: c === true })}
            />
            Photos
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={state.options.marks}
              onCheckedChange={(c) => setOpt({ marks: c === true })}
            />
            Marks on photos
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={state.options.footer}
              onCheckedChange={(c) => setOpt({ footer: c === true })}
            />
            Footer
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

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          title="Save these pages as a template"
          onClick={props.onSaveAs}
        >
          <LayoutTemplate className="h-4 w-4" />
          Save Template As
        </Button>
        <Button asChild variant="outline" size="sm" title="The templates list under Admin">
          <a href={TEMPLATES_ADMIN_PATH}>Manage Templates</a>
        </Button>
        {props.onOpenRevisions ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Earlier saves of this document"
            onClick={props.onOpenRevisions}
          >
            <History className="h-4 w-4" />
            Revisions
          </Button>
        ) : null}
      </div>

      <div className="space-y-1">
        <div className="text-sm font-medium">Pages ({state.pages.length})</div>
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
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => op((p) => removePage(p, page.id))}
                      >
                        <Trash2 className="h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {chips.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {chips.map((c) => (
                      <Badge
                        key={c}
                        variant="secondary"
                        className="h-5 px-1.5 text-[10px]"
                        title="A saved module on this page"
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

/** Document mode: "From template: X" and "Start over from template…" (confirms, then replaces the pages). */
function StartOverPicker(props: {
  kind: DocKind;
  templateName: string | null;
  options: DocOptions;
  onPick: (pages: DocPage[]) => void;
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
      props.onPick(instantiatePages(t.pages, props.options));
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

function ModulesTab(props: {
  savedModules: ReadonlyArray<{ id: string; name: string; module: DocModule }>;
  savedError: string | null;
  onAdd: (type: ModuleType) => void;
  onAddSaved: (m: DocModule) => void;
}) {
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteSavedModule);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Saved module deleted");
      setPendingDelete(null);
      void qc.invalidateQueries({ queryKey: savedModulesKey });
    },
    onError: (e) => toast.error(`Could not delete the saved module: ${errText(e)}`),
  });
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Drag a module onto a page, or use + to add it to the selected page.
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
        <div className="text-sm font-medium">Saved modules</div>
        {props.savedError ? (
          <p className="text-xs text-destructive">
            Could not load the saved modules: {props.savedError}
          </p>
        ) : props.savedModules.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None yet. Hover a module on the page and use <BookmarkPlus className="inline h-3 w-3" />{" "}
            Save as module…
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {props.savedModules.map((s) => (
              <li key={s.id} className="flex items-center gap-1 px-2 py-1 text-sm">
                <span className="flex-1 truncate" title={MODULE_LABELS[s.module.type]}>
                  {s.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {MODULE_LABELS[s.module.type]}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title="Add a copy to the selected page"
                  onClick={() => props.onAddSaved(s.module)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  title="Delete this saved module"
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
            <AlertDialogTitle>Delete the saved module "{pendingDelete?.name}"?</AlertDialogTitle>
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
  const defs = useMemo(() => variableDefs(props.kind), [props.kind]);
  const groups = useMemo(() => groupVariables(filterVariables(filter, defs)), [filter, defs]);
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
      {groups.map((g) => (
        <div key={g.group} className="space-y-0.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.group}
          </div>
          <ul className="divide-y rounded-md border">
            {g.defs.map((d) => (
              <li key={d.key}>
                <button
                  type="button"
                  className="flex w-full items-baseline gap-2 px-2 py-1 text-left text-sm hover:bg-accent/50"
                  title={`Insert ${d.label} (${d.key}) at the cursor; prints "${chipText(d.key, props.variables)}"`}
                  onClick={() => props.onInsert(d.key)}
                >
                  <span className="w-40 shrink-0 truncate">{d.label}</span>
                  <span className="text-muted-foreground">:</span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      !props.variables[d.key] && "text-muted-foreground",
                    )}
                  >
                    {variableRowValue(props.variables[d.key])}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
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
