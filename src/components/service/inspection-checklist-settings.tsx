/**
 * Admin › Service Rates: the inspection checklist (owner, Sep 30) — the items an Inspection
 * ticket asks about, in order. Add, rename, reorder, remove; "Save checklist" writes the list.
 * Inspections already done keep their own answers and labels (stored on the ticket).
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listChecklistItems, saveChecklistItems } from "@/lib/service-inspection.functions";
import { ITEM_LABEL_MAX } from "@/lib/inspection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
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
    },
    onError: (e) => toast.error(`Could not save the checklist: ${errText(e)}`),
  });

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
      <CardHeader>
        <CardTitle>Inspection checklist</CardTitle>
        <CardDescription>
          What an Inspection ticket asks the technician about, in this order: each item is marked
          OK, Issue or N/A with a note. Inspections already done keep their own answers.
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
                <li key={r.key} className="flex items-center gap-1.5">
                  <span className="w-6 text-right text-xs text-muted-foreground">{i + 1}.</span>
                  <Input
                    aria-label={`Item ${i + 1}`}
                    className="h-9 max-w-md"
                    maxLength={ITEM_LABEL_MAX}
                    value={r.label}
                    onChange={(e) =>
                      edit(rows.map((x) => (x.key === r.key ? { ...x, label: e.target.value } : x)))
                    }
                  />
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
                    onClick={() => edit(rows.filter((x) => x.key !== r.key))}
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
      </CardContent>
    </Card>
  );
}
