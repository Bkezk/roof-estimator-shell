import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { getRdlCombos, saveRdlCombo, type RdlData } from "@/lib/admin-rdl.functions";
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

export function RoofDeckTab() {
  const qc = useQueryClient();
  const getFn = useServerFn(getRdlCombos);
  const saveFn = useServerFn(saveRdlCombo);
  const { data: combos, isLoading } = useQuery({
    queryKey: ["rdl-combos"],
    queryFn: () => getFn(),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RdlData | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => combos?.find((c) => c.id === (selectedId ?? combos?.[0]?.id)),
    [combos, selectedId],
  );

  // Initialize the draft the first time a combo is shown or when selection changes.
  const activeId = selected?.id ?? null;
  const [draftForId, setDraftForId] = useState<string | null>(null);
  if (selected && activeId !== draftForId) {
    setDraft(clone(selected.data as RdlData));
    setDraftForId(activeId);
  }

  if (isLoading || !combos) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!selected || !draft) {
    return <p className="text-sm text-muted-foreground">No combinations.</p>;
  }

  const update = (fn: (d: RdlData) => void) =>
    setDraft((prev) => {
      const next = clone(prev!);
      fn(next);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      await saveFn({ data: { id: selected.id, data: draft as never } });
      toast.success("Roof deck labor saved");
      qc.invalidateQueries({ queryKey: ["rdl-combos"] });
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const d = draft;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label className="text-sm">Roof system &amp; attachment</Label>
          <Select value={selected.id} onValueChange={(v) => setSelectedId(v)}>
            <SelectTrigger className="w-[320px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {combos.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.roof_system} — {c.attachment === "mechanical" ? "Mechanical" : "Adhesive"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selected.formula && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {selected.formula}
        </p>
      )}

      {/* Base tab/width */}
      {d.base && d.base.tab_or_width_label && (
        <Card>
          <CardHeader>
            <CardTitle>Base labor</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6">
            <div className="space-y-2">
              <Label>{d.base.tab_or_width_label}</Label>
              <Input
                type="number"
                value={d.base.tab_value ?? 0}
                onChange={(e) =>
                  update((x) => {
                    x.base = { ...x.base, tab_value: num(e.target.value) };
                  })
                }
                className="max-w-[140px]"
              />
            </div>
            <div className="space-y-2">
              <Label>{d.base.tab_or_width_label === "Width" ? "Width" : "Tab"} multiplier</Label>
              <Input
                type="number"
                step="0.0001"
                value={d.base.tab_multiplier ?? 0}
                onChange={(e) =>
                  update((x) => {
                    x.base = {
                      ...x.base,
                      tab_multiplier: num(e.target.value),
                    };
                  })
                }
                className="max-w-[160px]"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Duro-Bond base labor */}
      {d.duro_bond_base_labor && (
        <Card>
          <CardHeader>
            <CardTitle>Base labor (Duro-Bond)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-[220px] space-y-2">
              <Label>Sheet layout (hours)</Label>
              <Input
                type="number"
                step="0.01"
                value={d.duro_bond_base_labor.sheet_layout_hr}
                onChange={(e) =>
                  update((x) => {
                    x.duro_bond_base_labor!.sheet_layout_hr = num(e.target.value);
                  })
                }
              />
            </div>
            <ObjectGrid
              title="Fastener time (min per fastener) by deck"
              obj={d.duro_bond_base_labor.single_fastener_time_min_per_fastener_by_deck}
              onChange={(k, v) =>
                update((x) => {
                  x.duro_bond_base_labor!.single_fastener_time_min_per_fastener_by_deck[k] = v;
                })
              }
            />
          </CardContent>
        </Card>
      )}

      {/* Deck multipliers */}
      {d.deck_multipliers && (
        <Card>
          <CardHeader>
            <CardTitle>Deck-type multipliers</CardTitle>
          </CardHeader>
          <CardContent>
            <ObjectGrid
              obj={d.deck_multipliers}
              onChange={(k, v) =>
                update((x) => {
                  x.deck_multipliers![k] = v;
                })
              }
            />
          </CardContent>
        </Card>
      )}

      {/* Fastener spacing multipliers */}
      {d.fastener_spacing_multipliers && (
        <Card>
          <CardHeader>
            <CardTitle>Fastener-spacing multipliers</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Spacing (in)</TableHead>
                  <TableHead>Multiplier</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.fastener_spacing_multipliers.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.spacing_in}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={r.multiplier}
                        onChange={(e) =>
                          update((x) => {
                            x.fastener_spacing_multipliers![i]!.multiplier = num(e.target.value);
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
      )}

      {/* Complexity factors */}
      {d.complexity_factors && (
        <Card>
          <CardHeader>
            <CardTitle>Complexity factors</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Complexity</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.complexity_factors.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={r.value}
                        onChange={(e) =>
                          update((x) => {
                            x.complexity_factors![i]!.value = num(e.target.value);
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
      )}

      {/* Sheet size multipliers */}
      {d.sheet_size_multipliers && (
        <Card>
          <CardHeader>
            <CardTitle>{d.sheet_size_label ?? "Sheet-size multipliers"}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sheet size</TableHead>
                  <TableHead>Roof section</TableHead>
                  <TableHead>Underlayment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.sheet_size_multipliers.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell>
                      <NullableNumber
                        value={r.roof_section}
                        onChange={(v) =>
                          update((x) => {
                            x.sheet_size_multipliers![i]!.roof_section = v;
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <NullableNumber
                        value={r.underlayment}
                        onChange={(v) =>
                          update((x) => {
                            x.sheet_size_multipliers![i]!.underlayment = v;
                          })
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Adhesive base labor */}
      {d.adhesive && (
        <Card>
          <CardHeader>
            <CardTitle>Adhesive base labor (per 1,000 sq ft)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Substrate / adhesive</TableHead>
                  <TableHead>Labor / 1,000 sq ft</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.adhesive.base_hours_per_1000_sqft_by_substrate.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.substrate}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.0001"
                        value={r.labor_per_1000_sqft}
                        onChange={(e) =>
                          update((x) => {
                            x.adhesive!.base_hours_per_1000_sqft_by_substrate[
                              i
                            ]!.labor_per_1000_sqft = num(e.target.value);
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
      )}

      {/* Thickness multipliers */}
      {d.thickness_multipliers && (
        <Card>
          <CardHeader>
            <CardTitle>Membrane thickness multipliers</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Thickness</TableHead>
                  <TableHead>Multiplier</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.thickness_multipliers.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">
                      {typeof r.mil === "number" ? `${r.mil}mil` : r.mil}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={r.multiplier}
                        onChange={(e) =>
                          update((x) => {
                            x.thickness_multipliers![i]!.multiplier = num(e.target.value);
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

function NullableNumber({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <Input
      type="number"
      step="0.01"
      value={value ?? ""}
      placeholder="—"
      onChange={(e) => onChange(e.target.value === "" ? null : num(e.target.value))}
      className="max-w-[120px]"
    />
  );
}

function ObjectGrid({
  title,
  obj,
  onChange,
}: {
  title?: string;
  obj: Record<string, number>;
  onChange: (key: string, value: number) => void;
}) {
  return (
    <div className="space-y-2">
      {title && <h3 className="text-sm font-medium">{title}</h3>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Deck type</TableHead>
            <TableHead>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(obj).map(([k, v]) => (
            <TableRow key={k}>
              <TableCell className="font-medium">{k}</TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="0.0001"
                  value={v}
                  onChange={(e) => onChange(k, num(e.target.value))}
                  className="max-w-[140px]"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
