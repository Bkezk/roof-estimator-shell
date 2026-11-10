/**
 * Setup › Inspection checklist: the inspection checklist (owner, Sep 30) — the items an Inspection
 * ticket asks about, in order. Add, rename, reorder, remove; "Save checklist" writes the list.
 * Inspections already done keep their own answers and labels (stored on the ticket).
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { SETUP_HISTORY_KEY, SetupHistory } from "@/components/setup-history";
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listChecklistItems, saveChecklistItems } from "@/lib/service-inspection.functions";
import { hiddenChecklistItem, ITEM_LABEL_MAX } from "@/lib/inspection";
import { useSetupForm } from "@/lib/setup-forms";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { plainErrText } from "@/lib/plain-error";

const errText = plainErrText;
const KEY = ["inspection-checklist"] as const;

interface Row {
  key: string;
  id?: string;
  label: string;
}

export function InspectionChecklistSettings() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listChecklistItems);
  const saveFn = useServerFn(saveChecklistItems);
  const q = useQuery({ queryKey: KEY, queryFn: () => listFn(), enabled: !!session });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [dirty, setDirty] = useState(false);
  // Remove asks first (owner, Nov 3, review item 32): the trash can sat beside the arrows, one
  // slip took an item off the list, and Save made it final.
  const [removing, setRemoving] = useState<Row | null>(null);
  useEffect(() => {
    if (q.data && !dirty) setRows(q.data.map((r) => ({ key: r.id, id: r.id, label: r.label })));
  }, [q.data, dirty]);

  const edit = (next: Row[]) => {
    setRows(next);
    setDirty(true);
  };
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          items: (rows ?? []).map((r) => ({
            ...(r.id ? { id: r.id } : {}),
            label: r.label.trim(),
          })),
        },
      }),
    onSuccess: (saved) => {
      qc.setQueryData(KEY, saved);
      setDirty(false);
      setRows(saved.map((r) => ({ key: r.id, id: r.id, label: r.label })));
      toast.success("Inspection checklist saved");
      void qc.invalidateQueries({ queryKey: SETUP_HISTORY_KEY });
    },
    onError: (e) => toast.error(`Could not save the checklist: ${errText(e)}`),
  });
  // The page's leave dialog and tab marker (Nov 4, review item 1).
  useSetupForm("inspection", dirty, () => save.mutateAsync());

  const move = (i: number, d: -1 | 1) => {
    if (!rows) return;
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    edit(next);
  };

  return (
    <Card>
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove &ldquo;{removing?.label.trim() || "this item"}&rdquo; from the checklist?
            </AlertDialogTitle>
            <AlertDialogDescription>
              New inspections will not ask about it. Inspections already done keep their answers.
              Nothing changes until you press Save.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing && rows) edit(rows.filter((x) => x.key !== removing.key));
                setRemoving(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CardHeader>
        <CardTitle>Inspection checklist</CardTitle>
        <CardDescription>
          What an Inspection ticket asks the technician about, in this order: each item is marked
          OK, Issue or N/A with a note. Inspections already done keep their own answers. One row is
          different: &ldquo;Recommend repairs&rdquo; is asked as a switch in the Findings step, not
          as a checklist row, so the phone shows one row fewer than this list.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.error ? (
          <p className="text-sm text-destructive">
            Could not load the checklist: {errText(q.error)}
          </p>
        ) : !rows ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <>
            <ol className="space-y-1.5">
              {rows.map((r, i) => (
                <li key={r.key} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-6 text-right text-xs text-muted-foreground">{i + 1}.</span>
                  <Input
                    aria-label={`Item ${i + 1}`}
                    className="h-9 min-w-0 max-w-md flex-1"
                    maxLength={ITEM_LABEL_MAX}
                    value={r.label}
                    onChange={(e) =>
                      edit(rows.map((x) => (x.key === r.key ? { ...x, label: e.target.value } : x)))
                    }
                  />
                  {hiddenChecklistItem(r.label) && (
                    // Under the box on a phone (review item 4), beside it on a wide screen.
                    <span
                      className="order-last basis-full pl-7 text-xs text-muted-foreground md:order-none md:basis-auto md:pl-0"
                      data-line="findings-switch"
                    >
                      asked as the switch in Findings — not a row on the phone
                    </span>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Move down"
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${r.label || "item"}`}
                    onClick={() => setRemoving(r)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  edit([...rows, { key: `new-${Date.now()}-${rows.length}`, label: "" }])
                }
              >
                <Plus className="mr-1 h-4 w-4" /> Add item
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1 h-4 w-4" />
                )}
                Save checklist
              </Button>
              {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
            </div>
          </>
        )}
        <SetupHistory tab="inspection" />
      </CardContent>
    </Card>
  );
}
