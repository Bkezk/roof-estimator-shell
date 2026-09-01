import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Save } from "lucide-react";

import {
  getLaborEngines,
  saveSetup,
  saveInspection,
  saveTemplates,
  saveCurb,
  saveParapet,
  type LaborEngines,
  type LaborTemplate,
} from "@/lib/admin-labor.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RoofDeckTab } from "@/components/rdl-editor";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/admin/labor")({
  head: () => ({ meta: [{ title: "Labor Engines — Duro-Last Estimator" }] }),
  component: LaborPage,
});

const num = (v: string) => (v === "" || v === "-" ? 0 : Number(v)) || 0;

function SaveBar({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <div className="flex justify-end">
      <Button onClick={onSave} disabled={saving}>
        <Save className="mr-2 h-4 w-4" />
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

function LaborPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getLaborEngines);
  const { data, isLoading } = useQuery({
    queryKey: ["labor-engines"],
    queryFn: () => getFn(),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["labor-engines"] });

  if (isLoading || !data) {
    return <p className="text-sm text-muted-foreground">Loading labor…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Labor Engines</h1>
        <p className="text-sm text-muted-foreground">
          Setup and inspection times, labor templates, and curb labor. These drive the man-hours
          calculated on every bid.
        </p>
      </div>
      <Tabs defaultValue="setup" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="setup">Setup Times</TabsTrigger>
          <TabsTrigger value="inspection">Inspection Times</TabsTrigger>
          <TabsTrigger value="templates">Labor Templates</TabsTrigger>
          <TabsTrigger value="curb">Curb Labor</TabsTrigger>
          <TabsTrigger value="roofdeck">Roof Deck Labor</TabsTrigger>
          <TabsTrigger value="parapet">Parapet Labor</TabsTrigger>
        </TabsList>
        <TabsContent value="setup">
          <SetupTab data={data} onSaved={invalidate} />
        </TabsContent>
        <TabsContent value="inspection">
          <InspectionTab data={data} onSaved={invalidate} />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesTab data={data} onSaved={invalidate} />
        </TabsContent>
        <TabsContent value="curb">
          <CurbTab data={data} onSaved={invalidate} />
        </TabsContent>
        <TabsContent value="roofdeck">
          <RoofDeckTab />
        </TabsContent>
        <TabsContent value="parapet">
          <ParapetTab data={data} onSaved={invalidate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SetupTab({ data, onSaved }: { data: LaborEngines; onSaved: () => void }) {
  const saveFn = useServerFn(saveSetup);
  const [min, setMin] = useState(data.setupMinimumHours);
  const [steps, setSteps] = useState(
    data.setupSteps.map((s) => ({ sqft: s.sqft, multiplier: s.multiplier })),
  );
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await saveFn({ data: { minimum_hours: min, steps } });
      toast.success("Setup times saved");
      onSaved();
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
          <CardTitle>Setup times</CardTitle>
          <CardDescription>
            Minimum hours to set up a job, plus a per-square-foot multiplier by job size. Hours =
            square footage × multiplier (never below the minimum).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-[220px] space-y-2">
            <Label>Minimum hours</Label>
            <Input
              type="number"
              step="0.5"
              value={min}
              onChange={(e) => setMin(num(e.target.value))}
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Square feet (up to)</TableHead>
                <TableHead>Multiplier</TableHead>
                <TableHead>Hours at this size</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {steps.map((s, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input
                      type="number"
                      value={s.sqft}
                      onChange={(e) =>
                        setSteps((p) =>
                          p.map((r, j) => (j === i ? { ...r, sqft: num(e.target.value) } : r)),
                        )
                      }
                      className="max-w-[160px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.0001"
                      value={s.multiplier}
                      onChange={(e) =>
                        setSteps((p) =>
                          p.map((r, j) =>
                            j === i ? { ...r, multiplier: num(e.target.value) } : r,
                          ),
                        )
                      }
                      className="max-w-[140px]"
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {(s.sqft * s.multiplier).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSteps((p) => p.filter((_, j) => j !== i))}
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
            onClick={() => setSteps((p) => [...p, { sqft: 0, multiplier: 0.003 }])}
          >
            <Plus className="mr-1 h-4 w-4" /> Add row
          </Button>
        </CardContent>
      </Card>
      <SaveBar saving={saving} onSave={save} />
    </div>
  );
}

function InspectionTab({ data, onSaved }: { data: LaborEngines; onSaved: () => void }) {
  const saveFn = useServerFn(saveInspection);
  const [steps, setSteps] = useState(
    data.inspectionSteps.map((s) => ({ sqft: s.sqft, hours: s.hours })),
  );
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await saveFn({ data: { steps } });
      toast.success("Inspection times saved");
      onSaved();
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
          <CardTitle>Inspection times</CardTitle>
          <CardDescription>
            Hours to inspect a finished job by square footage. First row is the minimum.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Square feet (from)</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {steps.map((s, i) => (
                <TableRow key={i}>
                  <TableCell>
                    {i === 0 ? (
                      <span className="text-sm text-muted-foreground">Minimum</span>
                    ) : (
                      <Input
                        type="number"
                        value={s.sqft}
                        onChange={(e) =>
                          setSteps((p) =>
                            p.map((r, j) => (j === i ? { ...r, sqft: num(e.target.value) } : r)),
                          )
                        }
                        className="max-w-[160px]"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.5"
                      value={s.hours}
                      onChange={(e) =>
                        setSteps((p) =>
                          p.map((r, j) => (j === i ? { ...r, hours: num(e.target.value) } : r)),
                        )
                      }
                      className="max-w-[140px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSteps((p) => p.filter((_, j) => j !== i))}
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
            onClick={() => setSteps((p) => [...p, { sqft: 0, hours: 0 }])}
          >
            <Plus className="mr-1 h-4 w-4" /> Add row
          </Button>
        </CardContent>
      </Card>
      <SaveBar saving={saving} onSave={save} />
    </div>
  );
}

function TemplatesTab({ data, onSaved }: { data: LaborEngines; onSaved: () => void }) {
  const saveFn = useServerFn(saveTemplates);
  const [tpls, setTpls] = useState<LaborTemplate[]>(data.templates);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await saveFn({
        data: {
          templates: tpls.map((t) => ({
            name: t.name,
            is_default: t.is_default,
            adjustments: t.adjustments.map((a) => ({
              area: a.area,
              value: a.value,
            })),
          })),
        },
      });
      toast.success("Templates saved");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        A template nudges the program's labor up or down per area. 0 (or 100) = no change; a
        positive number is a percent increase, negative a decrease.
      </p>
      {tpls.map((t, ti) => (
        <Card key={t.id || ti}>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              <Input
                value={t.name}
                onChange={(e) =>
                  setTpls((p) => p.map((x, j) => (j === ti ? { ...x, name: e.target.value } : x)))
                }
                className="max-w-[220px] font-medium"
              />
              <div className="flex items-center gap-2">
                <Switch
                  checked={t.is_default}
                  onCheckedChange={(v) =>
                    setTpls((p) =>
                      p.map((x, j) => ({
                        ...x,
                        is_default: j === ti ? v : false,
                      })),
                    )
                  }
                  id={`tdef-${ti}`}
                />
                <Label htmlFor={`tdef-${ti}`}>Default</Label>
              </div>
            </div>
            {tpls.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTpls((p) => p.filter((_, j) => j !== ti))}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {t.adjustments.map((a, ai) => (
                <div key={ai} className="flex items-center justify-between gap-3">
                  <Label className="text-sm">{a.area}</Label>
                  <Input
                    type="number"
                    step="1"
                    value={a.value}
                    onChange={(e) =>
                      setTpls((p) =>
                        p.map((x, j) =>
                          j === ti
                            ? {
                                ...x,
                                adjustments: x.adjustments.map((y, k) =>
                                  k === ai ? { ...y, value: num(e.target.value) } : y,
                                ),
                              }
                            : x,
                        ),
                      )
                    }
                    className="max-w-[110px]"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
      <SaveBar saving={saving} onSave={save} />
    </div>
  );
}

function CurbTab({ data, onSaved }: { data: LaborEngines; onSaved: () => void }) {
  const saveFn = useServerFn(saveCurb);
  const [setup, setSetup] = useState(data.curbSetupMinutes);
  const [deck, setDeck] = useState(
    data.curbDeck.map((d) => ({ deck_type: d.deck_type, minutes: d.minutes })),
  );
  const [types, setTypes] = useState(
    data.curbType.map((t) => ({
      curb_type: t.curb_type,
      multiplier: t.multiplier,
    })),
  );
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await saveFn({ data: { setup_minutes: setup, deck, types } });
      toast.success("Curb labor saved");
      onSaved();
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
          <CardTitle>Curb labor</CardTitle>
          <CardDescription>
            Time = setup time + (deck-type time × curb-type multiplier), per curb.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="max-w-[260px] space-y-2">
            <Label>Setup time per curb (minutes)</Label>
            <Input
              type="number"
              step="0.5"
              value={setup}
              onChange={(e) => setSetup(num(e.target.value))}
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium">
                Labor per lineal foot by deck type (minutes)
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deck type</TableHead>
                    <TableHead>Minutes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deck.map((d, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{d.deck_type}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.5"
                          value={d.minutes}
                          onChange={(e) =>
                            setDeck((p) =>
                              p.map((r, j) =>
                                j === i ? { ...r, minutes: num(e.target.value) } : r,
                              ),
                            )
                          }
                          className="max-w-[120px]"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">Multiplier by curb type</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Curb type</TableHead>
                    <TableHead>Multiplier</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {types.map((t, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{t.curb_type}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.1"
                          value={t.multiplier}
                          onChange={(e) =>
                            setTypes((p) =>
                              p.map((r, j) =>
                                j === i ? { ...r, multiplier: num(e.target.value) } : r,
                              ),
                            )
                          }
                          className="max-w-[120px]"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
      <SaveBar saving={saving} onSave={save} />
    </div>
  );
}

function ParapetTab({ data, onSaved }: { data: LaborEngines; onSaved: () => void }) {
  const saveFn = useServerFn(saveParapet);
  const [rows, setRows] = useState(
    data.parapet.map((r) => ({
      deck_type: r.deck_type,
      wall_height_band: r.wall_height_band,
      no_drill_no_cant: r.no_drill_no_cant,
      no_drill_canted: r.no_drill_canted,
      predrill_no_cant: r.predrill_no_cant,
      predrill_canted: r.predrill_canted,
    })),
  );
  const [saving, setSaving] = useState(false);
  const set = (i: number, key: string, v: number) =>
    setRows((p) => p.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  const save = async () => {
    setSaving(true);
    try {
      await saveFn({ data: { rows } });
      toast.success("Parapet labor saved");
      onSaved();
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
          <CardTitle>Parapet labor</CardTitle>
          <CardDescription>
            Man-hours per 50 lineal feet, by deck type and wall height, for each drill/cant
            combination.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deck type</TableHead>
                <TableHead>Wall height</TableHead>
                <TableHead>No drill, no cant</TableHead>
                <TableHead>No drill, canted</TableHead>
                <TableHead>Pre-drill, no cant</TableHead>
                <TableHead>Pre-drill, canted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const firstOfDeck = i === 0 || rows[i - 1]!.deck_type !== r.deck_type;
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{firstOfDeck ? r.deck_type : ""}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {r.wall_height_band}
                    </TableCell>
                    {(
                      [
                        "no_drill_no_cant",
                        "no_drill_canted",
                        "predrill_no_cant",
                        "predrill_canted",
                      ] as const
                    ).map((key) => (
                      <TableCell key={key}>
                        <Input
                          type="number"
                          step="0.01"
                          value={r[key]}
                          onChange={(e) => set(i, key, num(e.target.value))}
                          className="w-24"
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <SaveBar saving={saving} onSave={save} />
    </div>
  );
}
