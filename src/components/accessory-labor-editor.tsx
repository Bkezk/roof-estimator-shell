import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { getAccessoryLabor, saveAccessoryCategory } from "@/lib/admin-rdl.functions";
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

interface CatData {
  columns: string[];
  rows: Record<string, string | number>[];
}

export function AccessoryLaborTab() {
  const qc = useQueryClient();
  const getFn = useServerFn(getAccessoryLabor);
  const saveFn = useServerFn(saveAccessoryCategory);
  const { data: cats, isLoading } = useQuery({
    queryKey: ["accessory-labor"],
    queryFn: () => getFn(),
  });

  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CatData | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => cats?.find((c) => c.id === (selId ?? cats?.[0]?.id)),
    [cats, selId],
  );

  if (selected && selected.id !== draftId) {
    setDraft(clone(selected.data as unknown as CatData));
    setDraftId(selected.id);
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!selected || !draft) return null;

  const valueCols = draft.columns.filter((c) => c !== "Description");

  const save = async () => {
    setSaving(true);
    try {
      await saveFn({ data: { id: selected.id, data: draft as never } });
      toast.success("Accessory labor saved");
      qc.invalidateQueries({ queryKey: ["accessory-labor"] });
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="text-sm">Accessory category</Label>
        <Select value={selected.id} onValueChange={(v) => setSelId(v)}>
          <SelectTrigger className="w-[300px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {cats!.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{selected.category}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                {valueCols.map((c) => (
                  <TableHead key={c} className="whitespace-nowrap">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.rows.map((row, ri) => (
                <TableRow key={ri}>
                  <TableCell className="font-medium">{String(row["Description"] ?? "")}</TableCell>
                  {valueCols.map((c) => (
                    <TableCell key={c}>
                      <Input
                        type="number"
                        step="0.0001"
                        value={Number(row[c] ?? 0)}
                        onChange={(e) =>
                          setDraft((p) => {
                            const n = clone(p!);
                            n.rows[ri]![c] = num(e.target.value);
                            return n;
                          })
                        }
                        className="w-28"
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
