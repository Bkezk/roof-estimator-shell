/**
 * "New document" (CenterPoint's "Build a bid" checkboxes, owner Oct 26): pick a template (the
 * default preselected; "Blank" starts empty), a title, and the four options the template
 * defaults — With prices, Include photos, Marks on photos, Footer. Create makes the document and
 * opens the editor. Enter in the title creates, so a document is one click (or none) away.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

import { newDocumentTitle } from "@/lib/documents/editor-helpers";
import { DEFAULT_OPTIONS, type DocKind, type DocOptions } from "@/lib/documents/model";
import { createDocument, listDocumentTemplates } from "@/lib/documents.functions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { documentsKey, errText, type TemplateListRow, templatesKey } from "./document-types";

const BLANK = "__blank";

export function NewDocumentDialog(props: {
  kind: DocKind;
  bidId?: string | undefined;
  serviceJobId?: string | undefined;
  recordLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: ((id: string) => void) | undefined;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listDocumentTemplates);
  const createFn = useServerFn(createDocument);
  const templates = useQuery({
    queryKey: templatesKey(props.kind),
    queryFn: () => listFn({ data: { kind: props.kind } }),
    enabled: props.open,
    staleTime: 60_000,
  });
  const rows: TemplateListRow[] = useMemo(() => templates.data ?? [], [templates.data]);

  // The picked template (null = untouched: the default), the title and the options, each
  // following the template until the user types / clicks.
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [options, setOptions] = useState<DocOptions | null>(null);

  useEffect(() => {
    if (!props.open) {
      setTemplateId(null);
      setTitle(null);
      setOptions(null);
    }
  }, [props.open]);

  const defaultTemplate = rows.find((t) => t.is_default) ?? rows[0] ?? null;
  const pickedId = templateId ?? defaultTemplate?.id ?? BLANK;
  const picked = pickedId === BLANK ? null : (rows.find((t) => t.id === pickedId) ?? null);
  const effTitle =
    title ?? newDocumentTitle(picked?.name ?? null, { kind: props.kind, label: props.recordLabel });
  const effOptions: DocOptions = options ?? picked?.options ?? DEFAULT_OPTIONS;
  const setOpt = (patch: Partial<DocOptions>) => setOptions({ ...effOptions, ...patch });

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          kind: props.kind,
          ...(props.bidId ? { bidId: props.bidId } : {}),
          ...(props.serviceJobId ? { serviceJobId: props.serviceJobId } : {}),
          templateId: picked?.id ?? null,
          title: effTitle.trim() || "Untitled document",
          options: effOptions,
        },
      }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({
        queryKey: documentsKey({ bidId: props.bidId, serviceJobId: props.serviceJobId }),
      });
      props.onOpenChange(false);
      props.onCreated?.(r.id);
      void navigate({ to: "/documents", search: { id: r.id } });
    },
    onError: (e) => toast.error(`Could not create the document: ${errText(e)}`),
  });
  const canCreate = !create.isPending && !templates.isLoading;
  const submit = () => {
    if (canCreate) create.mutate();
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New document</DialogTitle>
          <DialogDescription>
            For {props.recordLabel}. Everything can be edited after.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="new-doc-template">Template</Label>
            <Select value={pickedId} onValueChange={(v) => setTemplateId(v)}>
              <SelectTrigger id="new-doc-template" title="The pages the document starts from">
                <SelectValue placeholder={templates.isLoading ? "Loading…" : "Template"} />
              </SelectTrigger>
              <SelectContent>
                {rows.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {t.is_default ? " (default)" : ""}
                  </SelectItem>
                ))}
                <SelectItem value={BLANK}>Blank</SelectItem>
              </SelectContent>
            </Select>
            {picked?.description ? (
              <p className="text-xs text-muted-foreground">{picked.description}</p>
            ) : null}
            {templates.isError ? (
              <p className="text-xs text-destructive">
                Could not load the templates: {errText(templates.error)}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-doc-title">Title</Label>
            <Input
              id="new-doc-title"
              autoFocus
              value={effTitle}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={effOptions.prices === "total"}
                onCheckedChange={(c) => setOpt({ prices: c ? "total" : "none" })}
              />
              With prices
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={effOptions.photos}
                onCheckedChange={(c) => setOpt({ photos: c === true })}
              />
              Include photos
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={effOptions.marks}
                disabled={!effOptions.photos}
                onCheckedChange={(c) => setOpt({ marks: c === true })}
              />
              Marks on photos
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={effOptions.footer}
                onCheckedChange={(c) => setOpt({ footer: c === true })}
              />
              Footer
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canCreate}
            title="Create and open the editor"
            onClick={submit}
          >
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
