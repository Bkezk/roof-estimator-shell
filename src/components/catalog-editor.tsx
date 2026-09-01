import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2, Save } from "lucide-react";

import {
  getPricingCatalog,
  savePricingScreen,
  type CatalogScreenData,
} from "@/lib/admin-pricing.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const num = (v: string) => (v === "" || v === "-" ? 0 : Number(v)) || 0;
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

export function CatalogEditor({
  branch,
  title,
  intro,
  hideHeader,
}: {
  branch: string;
  title: string;
  intro?: string;
  hideHeader?: boolean;
}) {
  const qc = useQueryClient();
  const getFn = useServerFn(getPricingCatalog);
  const saveFn = useServerFn(savePricingScreen);
  const { data: screens, isLoading } = useQuery({
    queryKey: ["pricing-catalog", branch],
    queryFn: () => getFn({ data: { branch } }),
  });

  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CatalogScreenData | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => screens?.find((s) => s.id === (selId ?? screens?.[0]?.id)),
    [screens, selId],
  );
  if (selected && selected.id !== draftId) {
    setDraft(clone(selected.data as unknown as CatalogScreenData));
    setDraftId(selected.id);
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!screens || screens.length === 0)
    return <p className="text-sm text-muted-foreground">Nothing here yet.</p>;
  if (!selected || !draft) return null;

  const cols = draft.columns;
  const valueCols = cols.filter((c) => c !== "Description");

  const setCell = (ri: number, col: string, v: string | number) =>
    setDraft((p) => {
      const n = clone(p!);
      n.rows[ri]![col] = v;
      return n;
    });

  const save = async () => {
    setSaving(true);
    try {
      await saveFn({ data: { id: selected.id, data: draft as never } });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["pricing-catalog", branch] });
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {!hideHeader && (
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {intro && <p className="text-sm text-muted-foreground">{intro}</p>}
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-sm">Category</Label>
        <Select value={selected.id} onValueChange={(v) => setSelId(v)}>
          <SelectTrigger className="w-[320px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {screens.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {draft.extras && Object.keys(draft.extras).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Options</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6">
            {Object.entries(draft.extras).map(([k, v]) => (
              <div key={k} className="space-y-2">
                <Label className="text-sm capitalize">{k.replace(/_/g, " ")}</Label>
                <Input
                  value={String(v)}
                  onChange={(e) =>
                    setDraft((p) => {
                      const n = clone(p!);
                      const raw = e.target.value;
                      n.extras = {
                        ...n.extras,
                        [k]: typeof v === "number" && raw !== "" ? num(raw) : raw,
                      };
                      return n;
                    })
                  }
                  className="max-w-[220px]"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{selected.category}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {cols.map((c) => (
                  <TableHead key={c} className="whitespace-nowrap">
                    {c}
                  </TableHead>
                ))}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.rows.map((row, ri) => (
                <TableRow key={ri}>
                  <TableCell>
                    <Input
                      value={String(row["Description"] ?? "")}
                      onChange={(e) => setCell(ri, "Description", e.target.value)}
                      className="min-w-[220px]"
                    />
                  </TableCell>
                  {valueCols.map((c) => (
                    <TableCell key={c}>
                      <Input
                        type="number"
                        step="0.0001"
                        value={Number(row[c] ?? 0)}
                        onChange={(e) => setCell(ri, c, num(e.target.value))}
                        className="w-28"
                      />
                    </TableCell>
                  ))}
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setDraft((p) => {
                          const n = clone(p!);
                          n.rows.splice(ri, 1);
                          return n;
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setDraft((p) => {
                const n = clone(p!);
                const blank: Record<string, string | number> = {};
                for (const c of n.columns) blank[c] = c === "Description" ? "" : 0;
                n.rows.push(blank);
                return n;
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" /> Add row
          </Button>
        </CardContent>
      </Card>

      {draft.help && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{draft.help}</p>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
