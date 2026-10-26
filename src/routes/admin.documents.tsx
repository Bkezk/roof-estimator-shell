/**
 * Admin › Documents (owner, Oct 26: the CenterPoint-style document generator). What the editor
 * builds from: the TEMPLATES a new document starts from (one table per kind — bid documents,
 * ticket documents — with the default starred), the SAVED MODULES people keep from inside the
 * editor ("Save as module…"), and the PDF LIBRARY (award letters, warranty samples, spec sheets)
 * inserted under any page with Insert PDF. Managers and admins (pageForPath: /admin/documents →
 * manager, as Setup); the sidebar lists it in the Admin group for both. Editing a template opens
 * the editor itself (/documents?template=<id>); this page only lists, duplicates, stars and
 * deletes. "Restore defaults" is not needed: the server seeds a kind with none the first time it
 * is asked for them, so an empty table only says so.
 */
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  FileText,
  Files,
  Loader2,
  Pencil,
  Plus,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  deleteDocumentAsset,
  deleteDocumentTemplate,
  deleteSavedModule,
  duplicateDocumentTemplate,
  listDocumentAssets,
  listDocumentTemplates,
  listSavedModules,
  saveSavedModule,
  setDefaultDocumentTemplate,
  uploadDocumentAsset,
  type DocumentAssetListRow,
  type DocumentTemplateListRow,
  type SavedModuleRow,
} from "@/lib/documents.functions";
import { DOC_KINDS, MODULE_LABELS, type DocKind } from "@/lib/documents/model";
import {
  KIND_HELP,
  KIND_TITLES,
  assetNameFromFile,
  base64FromDataUrl,
  formatBytes,
  groupTemplatesByKind,
  pdfUploadProblem,
  templateEditorHref,
} from "@/lib/documents/admin-helpers";
import { shortDate } from "@/lib/stage-dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

export const DOCUMENTS_TABS = ["templates", "modules", "pdfs"] as const;
export type DocumentsTab = (typeof DOCUMENTS_TABS)[number];

export const Route = createFileRoute("/admin/documents")({
  validateSearch: (search: Record<string, unknown>): { tab?: DocumentsTab } =>
    DOCUMENTS_TABS.includes(search["tab"] as DocumentsTab)
      ? { tab: search["tab"] as DocumentsTab }
      : {},
  head: () => ({ meta: [{ title: "Documents — JBK Portal" }] }),
  component: DocumentsAdminPage,
});

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The query keys, shared with the editor's lists so a change here shows there at once. */
export const TEMPLATES_KEY = ["document-templates"] as const;
export const SAVED_MODULES_KEY = ["document-saved-modules"] as const;
export const DOCUMENT_ASSETS_KEY = ["document-assets"] as const;

function DocumentsAdminPage() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Files className="h-6 w-6" /> Documents
        </h1>
        <p className="text-sm text-muted-foreground">
          The templates proposals and letters start from, the modules saved from inside the editor,
          and the PDF library inserted into documents. Documents themselves are made from a bid (the
          estimator, Project Bids) or a ticket — every one by hand, none automatically.
        </p>
      </div>

      <Tabs
        value={tab ?? "templates"}
        onValueChange={(v) => navigate({ search: { tab: v as DocumentsTab }, replace: true })}
        className="space-y-4"
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="modules">Saved modules</TabsTrigger>
          <TabsTrigger value="pdfs">PDF library</TabsTrigger>
        </TabsList>
        <TabsContent value="templates">
          <TemplatesTab />
        </TabsContent>
        <TabsContent value="modules">
          <SavedModulesTab />
        </TabsContent>
        <TabsContent value="pdfs">
          <PdfLibraryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ------------------------------------------------------------------------------------ Templates

function TemplatesTab() {
  const qc = useQueryClient();
  const router = useRouter();
  const listFn = useServerFn(listDocumentTemplates);
  const duplicateFn = useServerFn(duplicateDocumentTemplate);
  const setDefaultFn = useServerFn(setDefaultDocumentTemplate);
  const deleteFn = useServerFn(deleteDocumentTemplate);
  const list = useQuery({ queryKey: TEMPLATES_KEY, queryFn: () => listFn({ data: {} }) });
  const [newKind, setNewKind] = useState<DocKind>("bid");
  const [confirmDelete, setConfirmDelete] = useState<DocumentTemplateListRow | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: TEMPLATES_KEY });

  const duplicate = useMutation({
    mutationFn: (id: string) => duplicateFn({ data: { id } }),
    onSuccess: (row) => {
      toast.success(`Template duplicated as “${row.name}”`);
      refresh();
    },
    onError: (e) => toast.error(`Could not duplicate the template: ${errText(e)}`),
  });
  const setDefault = useMutation({
    mutationFn: (id: string) => setDefaultFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Default template set");
      refresh();
    },
    onError: (e) => toast.error(`Could not set the default: ${errText(e)}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Template deleted");
      setConfirmDelete(null);
      refresh();
    },
    onError: (e) => toast.error(`Could not delete the template: ${errText(e)}`),
  });

  const edit = (id: string) => void router.navigate({ href: templateEditorHref({ id }) });
  const create = () => void router.navigate({ href: templateEditorHref({ kind: newKind }) });

  if (list.error)
    return (
      <p className="text-sm text-destructive">
        Could not load the templates: {errText(list.error)}
      </p>
    );

  const groups = groupTemplatesByKind(list.data ?? []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={newKind} onValueChange={(v) => setNewKind(v as DocKind)}>
          <SelectTrigger className="w-[180px]" aria-label="Kind of the new template">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOC_KINDS.map((k) => (
              <SelectItem key={k} value={k} title={KIND_HELP[k]}>
                {k === "bid" ? "Bid document" : "Ticket document"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={create} title="A blank template of this kind, opened in the editor">
          <Plus className="mr-1 h-4 w-4" /> New template
        </Button>
        <span className="text-xs text-muted-foreground">
          Edit opens the template in the editor; the default (★) is what a new document starts from
          when nothing else is picked.
        </span>
      </div>

      {list.isLoading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
        </p>
      )}

      {groups.map(({ kind, templates }) => (
        <Card key={kind} data-kind={kind}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" /> {KIND_TITLES[kind]}
            </CardTitle>
            <CardDescription>{KIND_HELP[kind]}</CardDescription>
          </CardHeader>
          <CardContent>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-hint="no-templates">
                No {KIND_TITLES[kind].toLowerCase()} yet. The built-in defaults are added the first
                time a document of this kind is made, or make one with New template.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" aria-label="Default" />
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="whitespace-nowrap">Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((t) => (
                    <TableRow key={t.id} data-template={t.id}>
                      <TableCell className="pr-0">
                        {t.is_default ? (
                          <Star
                            className="h-4 w-4 fill-amber-400 text-amber-500 dark:fill-amber-300 dark:text-amber-300"
                            aria-label="Default template"
                          />
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            title="Set as default: new documents of this kind start from it"
                            disabled={setDefault.isPending}
                            onClick={() => setDefault.mutate(t.id)}
                          >
                            <Star className="h-4 w-4" />
                            <span className="sr-only">Set as default</span>
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          className="text-left hover:underline"
                          title="Edit this template in the editor"
                          onClick={() => edit(t.id)}
                        >
                          {t.name}
                        </button>
                      </TableCell>
                      <TableCell className="max-w-md text-sm text-muted-foreground">
                        {t.description || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {shortDate(t.updated_at)}
                        {t.updated_by_name ? ` by ${t.updated_by_name}` : ""}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Edit this template in the editor"
                            onClick={() => edit(t.id)}
                          >
                            <Pencil className="h-4 w-4" />
                            <span className="sr-only">Edit</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Duplicate this template (a copy to change)"
                            disabled={duplicate.isPending}
                            onClick={() => duplicate.mutate(t.id)}
                          >
                            <Copy className="h-4 w-4" />
                            <span className="sr-only">Duplicate</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            title="Delete this template (documents already made from it keep their pages)"
                            disabled={remove.isPending}
                            onClick={() => setConfirmDelete(t)}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmDelete?.name}” will no longer be offered when a document is made. Documents
              already made from it keep their pages.
              {confirmDelete?.is_default
                ? " It is the default of its kind; another template becomes the default."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDelete) remove.mutate(confirmDelete.id);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// -------------------------------------------------------------------------------- Saved modules

function SavedModulesTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSavedModules);
  const saveFn = useServerFn(saveSavedModule);
  const deleteFn = useServerFn(deleteSavedModule);
  const list = useQuery({
    queryKey: SAVED_MODULES_KEY,
    queryFn: (): Promise<SavedModuleRow[]> => listFn(),
  });
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SavedModuleRow | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: SAVED_MODULES_KEY });

  const rename = useMutation({
    mutationFn: (m: SavedModuleRow & { newName: string }) =>
      saveFn({ data: { id: m.id, name: m.newName, module: m.module } }),
    onSuccess: () => {
      toast.success("Module renamed");
      setRenaming(null);
      refresh();
    },
    onError: (e) => toast.error(`Could not rename the module: ${errText(e)}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Module deleted");
      setConfirmDelete(null);
      refresh();
    },
    onError: (e) => toast.error(`Could not delete the module: ${errText(e)}`),
  });

  const commitRename = (m: SavedModuleRow) => {
    const newName = (renaming?.name ?? "").trim();
    if (!renaming || renaming.id !== m.id) return;
    if (!newName || newName === m.name) {
      setRenaming(null);
      return;
    }
    rename.mutate({ ...m, newName });
  };

  if (list.error)
    return (
      <p className="text-sm text-destructive">
        Could not load the saved modules: {errText(list.error)}
      </p>
    );
  const rows = list.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Saved modules</CardTitle>
          <CardDescription>
            Pieces people keep for reuse — a terms block, a warranty paragraph, a signature. Modules
            are saved from inside the editor (“Save as module…” on any module) and appear on its
            Modules tab; here they can be renamed or removed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading modules…
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No saved modules yet. Open a document, pick a module and choose “Save as module…”.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="whitespace-nowrap">Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => {
                  const editing = renaming?.id === m.id;
                  return (
                    <TableRow key={m.id} data-module={m.id}>
                      <TableCell className="font-medium">
                        {editing ? (
                          <form
                            className="flex items-center gap-1"
                            onSubmit={(e) => {
                              e.preventDefault();
                              commitRename(m);
                            }}
                          >
                            <Input
                              autoFocus
                              aria-label="Module name"
                              className="h-8 max-w-xs"
                              value={renaming.name}
                              disabled={rename.isPending}
                              onChange={(e) => setRenaming({ id: m.id, name: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setRenaming(null);
                              }}
                            />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Save the name"
                              disabled={rename.isPending}
                            >
                              {rename.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Check className="h-4 w-4" />
                              )}
                              <span className="sr-only">Save</span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Keep the old name"
                              disabled={rename.isPending}
                              onClick={() => setRenaming(null)}
                            >
                              <X className="h-4 w-4" />
                              <span className="sr-only">Cancel</span>
                            </Button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            className="text-left hover:underline"
                            title="Rename this module"
                            onClick={() => setRenaming({ id: m.id, name: m.name })}
                          >
                            {m.name}
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {MODULE_LABELS[m.module.type]}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {shortDate(m.updated_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Rename this module"
                            disabled={editing}
                            onClick={() => setRenaming({ id: m.id, name: m.name })}
                          >
                            <Pencil className="h-4 w-4" />
                            <span className="sr-only">Rename</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            title="Delete this saved module (documents that used it are not changed)"
                            disabled={remove.isPending}
                            onClick={() => setConfirmDelete(m)}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this saved module?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmDelete?.name}” leaves the editor's Modules tab. Documents and templates that
              already use it are not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDelete) remove.mutate(confirmDelete.id);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------------- PDF library

/** A File read as base64 (its data: URL body) for uploadDocumentAsset. */
function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.onload = () => resolve(base64FromDataUrl(String(reader.result ?? "")));
    reader.readAsDataURL(file);
  });
}

function PdfLibraryTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDocumentAssets);
  const uploadFn = useServerFn(uploadDocumentAsset);
  const deleteFn = useServerFn(deleteDocumentAsset);
  const list = useQuery({ queryKey: DOCUMENT_ASSETS_KEY, queryFn: () => listFn() });
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DocumentAssetListRow | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: DOCUMENT_ASSETS_KEY });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("PDF removed from the library");
      setConfirmDelete(null);
      refresh();
    },
    onError: (e) => toast.error(`Could not delete the PDF: ${errText(e)}`),
  });

  const upload = async (file: File) => {
    const problem = pdfUploadProblem(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    setUploading(file.name);
    try {
      const base64 = await readFileBase64(file);
      const row = await uploadFn({ data: { name: assetNameFromFile(file.name), base64 } });
      toast.success(
        `“${row.name}” added to the library (${row.page_count} page${row.page_count === 1 ? "" : "s"})`,
      );
      refresh();
    } catch (e) {
      toast.error(`Could not upload the PDF: ${errText(e)}`);
    } finally {
      setUploading(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  if (list.error)
    return (
      <p className="text-sm text-destructive">
        Could not load the PDF library: {errText(list.error)}
      </p>
    );
  const rows = list.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>PDF library</CardTitle>
          <CardDescription>
            Insert these into any document from the Insert PDF button under a page (award letters,
            warranty samples, spec sheets). PDF only, 20 MB at most.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              aria-label="PDF to upload"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <Button
              onClick={() => fileInput.current?.click()}
              disabled={uploading !== null}
              title="Add a PDF to the library (20 MB at most)"
            >
              {uploading !== null ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1 h-4 w-4" />
              )}
              {uploading !== null ? `Uploading ${uploading}…` : "Upload PDF"}
            </Button>
          </div>

          {list.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the library…
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing in the library yet. Upload a PDF to insert it into documents.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Pages</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead className="whitespace-nowrap">Uploaded</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id} data-asset={a.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {a.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.page_count}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatBytes(a.size_bytes)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {shortDate(a.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        title="Delete this PDF from the library"
                        disabled={remove.isPending}
                        onClick={() => setConfirmDelete(a)}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Delete</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this PDF from the library?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmDelete?.name}” can no longer be inserted into documents. Documents that
              already carry it may lose those pages when they are next rendered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDelete) remove.mutate(confirmDelete.id);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
