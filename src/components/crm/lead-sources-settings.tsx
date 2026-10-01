/**
 * Settings › General › Lead sources (admins and Estimate Pricing): the list an opportunity's
 * Lead source box picks from (lib/lead-sources.ts). Add, rename and reorder in place, delete — a
 * name an opportunity still uses is refused with the count (lead-sources.functions.ts
 * deleteLeadSource). A rename also changes the opportunities that carry the old name.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import {
  deleteLeadSource,
  saveLeadSource,
  type LeadSource,
  type LeadSourceInput,
} from "@/lib/lead-sources.functions";
import { LEAD_SOURCES_KEY, useLeadSources } from "@/components/crm/use-lead-sources";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** `sort` as typed: "" = left as it is (a new one goes last). */
type Draft = { name: string; sort: string };

export function LeadSourcesSettings() {
  const qc = useQueryClient();
  const sources = useLeadSources();
  const saveFn = useServerFn(saveLeadSource);
  const deleteFn = useServerFn(deleteLeadSource);
  // "new" = the add row is open; an id = that row is being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", sort: "" });
  const [toDelete, setToDelete] = useState<LeadSource | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: LEAD_SOURCES_KEY });
    void qc.invalidateQueries({ queryKey: ["opportunities"] });
  };
  const save = useMutation({
    mutationFn: (data: LeadSourceInput) => saveFn({ data }),
    onSuccess: ({ row, renamed }) => {
      toast.success(
        `Saved ${row.name}${renamed ? ` — ${renamed} opportunit${renamed === 1 ? "y" : "ies"} renamed` : ""}`,
      );
      setEditing(null);
      refresh();
    },
    onError: (e) => toast.error(`Could not save the lead source: ${errText(e)}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Lead source deleted");
      setToDelete(null);
      refresh();
    },
    onError: (e) => {
      setToDelete(null);
      toast.error(`Could not delete the lead source: ${errText(e)}`);
    },
  });

  const start = (row: LeadSource | null) => {
    setEditing(row ? row.id : "new");
    setDraft(row ? { name: row.name, sort: String(row.sort) } : { name: "", sort: "" });
  };
  const submit = () => {
    if (!draft.name.trim()) {
      toast.error("A lead source needs a name");
      return;
    }
    const sort = draft.sort.trim() === "" ? undefined : Number(draft.sort);
    if (sort !== undefined && (!Number.isInteger(sort) || sort < 0)) {
      toast.error("The order is a whole number, 0 or more");
      return;
    }
    save.mutate({
      ...(editing && editing !== "new" ? { id: editing } : {}),
      name: draft.name,
      ...(sort !== undefined ? { sort } : {}),
    });
  };

  const rows = sources.data ?? [];
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
  };
  const editRow = (key: string) => (
    <TableRow key={key}>
      <TableCell>
        <Input
          aria-label="Name"
          autoFocus
          value={draft.name}
          maxLength={120}
          placeholder="Door hanger"
          className="h-8"
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          onKeyDown={onEnter}
        />
      </TableCell>
      <TableCell>
        <Input
          aria-label="Order"
          inputMode="numeric"
          value={draft.sort}
          placeholder={key === "new" ? "Last" : ""}
          className="h-8 w-20"
          onChange={(e) => setDraft((d) => ({ ...d, sort: e.target.value }))}
          onKeyDown={onEnter}
        />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button size="sm" disabled={save.isPending} onClick={submit}>
            {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={save.isPending}
            onClick={() => setEditing(null)}
          >
            Cancel
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Where an opportunity came from, picked on the opportunity (anyone who creates opportunities
        can also add a name there by typing it). Renaming one renames it on the opportunities that
        use it; one still in use cannot be deleted. The list is in Order, then by name.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {rows.length} lead source{rows.length === 1 ? "" : "s"}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={editing === "new"}
          onClick={() => start(null)}
        >
          <Plus className="mr-1 h-4 w-4" /> Add lead source
        </Button>
      </div>
      {sources.error ? (
        <p className="text-sm text-destructive">
          Could not load the lead sources: {errText(sources.error)}
        </p>
      ) : sources.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-28">Order</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {editing === "new" && editRow("new")}
              {rows.map((r) =>
                editing === r.id ? (
                  editRow(r.id)
                ) : (
                  <TableRow key={r.id}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.sort}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Rename ${r.name}`}
                        onClick={() => start(r)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Delete ${r.name}`}
                        onClick={() => setToDelete(r)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ),
              )}
              {rows.length === 0 && editing !== "new" && (
                <TableRow>
                  <TableCell colSpan={3} className="text-sm text-muted-foreground">
                    No lead sources yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog
        open={!!toDelete}
        onOpenChange={(o) => {
          if (!o && !remove.isPending) setToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the lead source {toDelete?.name ?? ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              Refused if an opportunity still uses it; change those opportunities first, or rename
              it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (toDelete) remove.mutate(toDelete.id);
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
