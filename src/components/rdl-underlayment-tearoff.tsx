import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { getLaborTables, saveLaborTable } from "@/lib/admin-rdl.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

interface LayoutData {
  deck_columns: string[];
  fastening_times_min_per_fastener_by_deck: Record<string, number>;
  rows: { underlayment: string; layout_hours_per_2500sqft: number }[];
}
interface AdhesiveData {
  adhesives: {
    adhesive: string;
    unit_type?: string;
    rows: { substrate: string; coverage_sqft: number; labor: number }[];
  }[];
}
interface TearoffData {
  deck_columns: string[];
  rows: { tearoff_type: string; by_deck: Record<string, number> }[];
}

function useTables() {
  const getFn = useServerFn(getLaborTables);
  return useQuery({ queryKey: ["rdl-labor-tables"], queryFn: () => getFn() });
}

function SaveButton({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <div className="flex justify-end">
      <Button onClick={onSave} disabled={saving}>
        <Save className="mr-2 h-4 w-4" />
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

export function UnderlaymentEditor() {
  const qc = useQueryClient();
  const { data: tables, isLoading } = useTables();
  const saveFn = useServerFn(saveLaborTable);
  const [saving, setSaving] = useState(false);

  const layoutRow = tables?.find((t) => t.id === "underlayment_layout_mechanical");
  const adhRow = tables?.find((t) => t.id === "underlayment_adhesive_times");

  const [layout, setLayout] = useState<LayoutData | null>(null);
  const [adh, setAdh] = useState<AdhesiveData | null>(null);
  const [initId, setInitId] = useState<string | null>(null);
  const currentKey = (layoutRow?.id ?? "") + (adhRow?.id ?? "");
  if (layoutRow && adhRow && initId !== currentKey) {
    setLayout(clone(layoutRow.data as unknown as LayoutData));
    setAdh(clone(adhRow.data as unknown as AdhesiveData));
    setInitId(currentKey);
  }

  const [selAdh, setSelAdh] = useState(0);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!layout || !adh) return null;

  const save = async () => {
    setSaving(true);
    try {
      await saveFn({
        data: { id: "underlayment_layout_mechanical", data: layout as never },
      });
      await saveFn({
        data: { id: "underlayment_adhesive_times", data: adh as never },
      });
      toast.success("Underlayment times saved");
      qc.invalidateQueries({ queryKey: ["rdl-labor-tables"] });
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const adhesive = adh.adhesives[selAdh]!;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Fastening time by deck (minutes per fastener)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deck type</TableHead>
                <TableHead>Minutes / fastener</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(layout.fastening_times_min_per_fastener_by_deck).map(([k, v]) => (
                <TableRow key={k}>
                  <TableCell className="font-medium">{k}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.001"
                      value={v}
                      onChange={(e) =>
                        setLayout((p) => {
                          const n = clone(p!);
                          n.fastening_times_min_per_fastener_by_deck[k] = num(e.target.value);
                          return n;
                        })
                      }
                      className="max-w-[140px]"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Underlayment layout time (hours per 2,500 sq ft)</CardTitle>
          <CardDescription>
            One row per underlayment product. Names ending in “…” were truncated in the old app and
            will be confirmed on live capture.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-h-[520px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Underlayment</TableHead>
                <TableHead>Layout hours / 2,500 sq ft</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {layout.rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.underlayment}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.001"
                      value={r.layout_hours_per_2500sqft}
                      onChange={(e) =>
                        setLayout((p) => {
                          const n = clone(p!);
                          n.rows[i]!.layout_hours_per_2500sqft = num(e.target.value);
                          return n;
                        })
                      }
                      className="max-w-[160px]"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Adhesive coverage &amp; labor</CardTitle>
          <CardDescription>
            Field coverage (sq ft) and labor per substrate, per adhesive.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">Adhesive</Label>
            <Select value={String(selAdh)} onValueChange={(v) => setSelAdh(Number(v))}>
              <SelectTrigger className="w-[320px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {adh.adhesives.map((a, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {a.adhesive}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Substrate</TableHead>
                <TableHead>Coverage (sq ft)</TableHead>
                <TableHead>Labor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adhesive.rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.substrate}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={r.coverage_sqft}
                      onChange={(e) =>
                        setAdh((p) => {
                          const n = clone(p!);
                          n.adhesives[selAdh]!.rows[i]!.coverage_sqft = num(e.target.value);
                          return n;
                        })
                      }
                      className="max-w-[140px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.1"
                      value={r.labor}
                      onChange={(e) =>
                        setAdh((p) => {
                          const n = clone(p!);
                          n.adhesives[selAdh]!.rows[i]!.labor = num(e.target.value);
                          return n;
                        })
                      }
                      className="max-w-[120px]"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SaveButton saving={saving} onSave={save} />
    </div>
  );
}

export function TearoffEditor() {
  const qc = useQueryClient();
  const { data: tables, isLoading } = useTables();
  const saveFn = useServerFn(saveLaborTable);
  const [saving, setSaving] = useState(false);

  const row = tables?.find((t) => t.id === "tearoff_times");
  const [t, setT] = useState<TearoffData | null>(null);
  const [initId, setInitId] = useState<string | null>(null);
  if (row && initId !== row.id) {
    setT(clone(row.data as unknown as TearoffData));
    setInitId(row.id);
  }

  const decks = useMemo(() => t?.deck_columns ?? [], [t]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!t) return null;

  const save = async () => {
    setSaving(true);
    try {
      await saveFn({ data: { id: "tearoff_times", data: t as never } });
      toast.success("Tearoff times saved");
      qc.invalidateQueries({ queryKey: ["rdl-labor-tables"] });
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Tearoff times</CardTitle>
          <CardDescription>
            Hours by tearoff type and deck. 0 means use the program default. Type names ending in
            “…” were truncated in the old app.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background">Tearoff type</TableHead>
                {decks.map((d) => (
                  <TableHead key={d} className="whitespace-nowrap">
                    {d}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.rows.map((r, ri) => (
                <TableRow key={ri}>
                  <TableCell className="sticky left-0 bg-background font-medium">
                    {r.tearoff_type}
                  </TableCell>
                  {decks.map((d) => (
                    <TableCell key={d}>
                      <Input
                        type="number"
                        step="0.0001"
                        value={r.by_deck[d] ?? 0}
                        onChange={(e) =>
                          setT((p) => {
                            const n = clone(p!);
                            n.rows[ri]!.by_deck[d] = num(e.target.value);
                            return n;
                          })
                        }
                        className="w-20"
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <SaveButton saving={saving} onSave={save} />
    </div>
  );
}
