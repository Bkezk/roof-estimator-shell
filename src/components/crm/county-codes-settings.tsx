/**
 * Settings › General › County codes (admins and Estimate Pricing): the JBK county code list a
 * site picks from (lib/county-codes.ts). Add, edit in place, delete — a code a site still uses
 * is refused with the count (county-codes.functions.ts deleteCountyCode).
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { COUNTY_STATES, countyCodeLabel, filterCountyCodes } from "@/lib/county-codes";
import {
  deleteCountyCode,
  saveCountyCode,
  type CountyCode,
  type CountyCodeInput,
} from "@/lib/county-codes.functions";
import { COUNTY_CODES_KEY, useCountyCodes } from "@/components/crm/use-county-codes";
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

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Draft = { code: string; county: string; state: "KY" | "TN" };
const blank = (): Draft => ({ code: "", county: "", state: "KY" });

export function CountyCodesSettings() {
  const qc = useQueryClient();
  const codes = useCountyCodes();
  const saveFn = useServerFn(saveCountyCode);
  const deleteFn = useServerFn(deleteCountyCode);
  const [query, setQuery] = useState("");
  // "new" = the add row is open; an id = that row is being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [toDelete, setToDelete] = useState<CountyCode | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: COUNTY_CODES_KEY });
  const save = useMutation({
    mutationFn: (data: CountyCodeInput) => saveFn({ data }),
    onSuccess: (row) => {
      toast.success(`Saved ${countyCodeLabel(row)}`);
      setEditing(null);
      refresh();
    },
    onError: (e) => toast.error(`Could not save the county code: ${errText(e)}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("County code deleted");
      setToDelete(null);
      refresh();
    },
    onError: (e) => {
      setToDelete(null);
      toast.error(`Could not delete the county code: ${errText(e)}`);
    },
  });

  const start = (row: CountyCode | null) => {
    setEditing(row ? row.id : "new");
    setDraft(
      row ? { code: row.code, county: row.county, state: row.state as Draft["state"] } : blank(),
    );
  };
  const submit = () => {
    if (!draft.code.trim() || !draft.county.trim()) {
      toast.error("A county code needs the code and the county");
      return;
    }
    save.mutate({ ...(editing && editing !== "new" ? { id: editing } : {}), ...draft });
  };

  const rows = filterCountyCodes(codes.data ?? [], query);
  const editRow = (key: string) => (
    <TableRow key={key}>
      <TableCell>
        <Input
          aria-label="Code"
          autoFocus
          value={draft.code}
          placeholder="0022"
          className="h-8 w-24"
          onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </TableCell>
      <TableCell>
        <Input
          aria-label="County"
          value={draft.county}
          placeholder="Anderson"
          className="h-8"
          onChange={(e) => setDraft((d) => ({ ...d, county: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </TableCell>
      <TableCell>
        <Select
          value={draft.state}
          onValueChange={(v) => setDraft((d) => ({ ...d, state: v as Draft["state"] }))}
        >
          <SelectTrigger aria-label="State" className="h-8 w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COUNTY_STATES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        JBK&apos;s county code for each site, picked on the site under Customers. A code a site
        still uses cannot be deleted.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Filter county codes"
          placeholder="Filter by code, county or state…"
          value={query}
          className="max-w-xs"
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          {rows.length} of {codes.data?.length ?? 0}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={editing === "new"}
          onClick={() => start(null)}
        >
          <Plus className="mr-1 h-4 w-4" /> Add county code
        </Button>
      </div>
      {codes.error ? (
        <p className="text-sm text-destructive">
          Could not load the county codes: {errText(codes.error)}
        </p>
      ) : codes.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Code</TableHead>
                <TableHead>County</TableHead>
                <TableHead className="w-24">State</TableHead>
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
                    <TableCell className="font-mono">{r.code}</TableCell>
                    <TableCell>{r.county}</TableCell>
                    <TableCell>{r.state}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit ${countyCodeLabel(r)}`}
                        onClick={() => start(r)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Delete ${countyCodeLabel(r)}`}
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
                  <TableCell colSpan={4} className="text-sm text-muted-foreground">
                    {codes.data?.length ? "No code matches." : "No county codes yet."}
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
            <AlertDialogTitle>
              Delete the county code {toDelete ? countyCodeLabel(toDelete) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Refused if a property still uses it; change those properties first.
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
