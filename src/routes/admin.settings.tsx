import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Save } from "lucide-react";

import {
  getGeneralSettings,
  saveCompanySettings,
  saveShippingSteps,
  saveMarkupOptions,
  saveWarranties,
  saveHighWind,
  type CompanySettings,
  type ShippingStep,
  type MarkupOption,
  type Warranty,
  type HighWindUpcharge,
} from "@/lib/admin-settings.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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

const SETTINGS_TABS = [
  "contractor",
  "shipping",
  "salestax",
  "basiclabor",
  "markup",
  "warranties",
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

export const Route = createFileRoute("/admin/settings")({
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } =>
    SETTINGS_TABS.includes(search["tab"] as SettingsTab)
      ? { tab: search["tab"] as SettingsTab }
      : {},
  head: () => ({ meta: [{ title: "General — Bid-O-Matic" }] }),
  component: SettingsPage,
});

const num = (v: string) => (v === "" || v === "-" ? 0 : Number(v)) || 0;

function SettingsPage() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const getFn = useServerFn(getGeneralSettings);
  const { data, isLoading } = useQuery({
    queryKey: ["general-settings"],
    queryFn: () => getFn(),
  });

  if (isLoading || !data) {
    return <p className="text-sm text-muted-foreground">Loading settings…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">General</h1>
        <p className="text-sm text-muted-foreground">
          Company defaults, shipping, labor &amp; markup, and warranty pricing. These feed every
          bid. Values are pre-filled from your current system.
        </p>
      </div>

      <Tabs
        value={tab ?? "contractor"}
        onValueChange={(v) => navigate({ search: { tab: v as SettingsTab }, replace: true })}
        className="space-y-4"
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="contractor">Contractor Information</TabsTrigger>
          <TabsTrigger value="shipping">Shipping Costs</TabsTrigger>
          <TabsTrigger value="salestax">Sales Tax</TabsTrigger>
          <TabsTrigger value="basiclabor">Basic Labor Settings</TabsTrigger>
          <TabsTrigger value="markup">Labor &amp; Markup Options</TabsTrigger>
          <TabsTrigger value="warranties">Warranties</TabsTrigger>
        </TabsList>

        <TabsContent value="contractor">
          <ContractorTab
            initial={data.company}
            onSaved={() => qc.invalidateQueries({ queryKey: ["general-settings"] })}
          />
        </TabsContent>
        <TabsContent value="salestax">
          <SalesTaxTab
            initial={data.company}
            onSaved={() => qc.invalidateQueries({ queryKey: ["general-settings"] })}
          />
        </TabsContent>
        <TabsContent value="basiclabor">
          <BasicLaborTab
            initial={data.company}
            onSaved={() => qc.invalidateQueries({ queryKey: ["general-settings"] })}
          />
        </TabsContent>
        <TabsContent value="shipping">
          <ShippingTab
            company={data.company}
            initialSteps={data.shippingSteps}
            onSaved={() => qc.invalidateQueries({ queryKey: ["general-settings"] })}
          />
        </TabsContent>
        <TabsContent value="markup">
          <MarkupTab
            initial={data.markupOptions}
            onSaved={() => qc.invalidateQueries({ queryKey: ["general-settings"] })}
          />
        </TabsContent>
        <TabsContent value="warranties">
          <WarrantiesTab
            initialWarranties={data.warranties}
            initialWind={data.highWind}
            onSaved={() => qc.invalidateQueries({ queryKey: ["general-settings"] })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function blankCompany(): CompanySettings {
  return {
    id: 1,
    company_name: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    phone: "",
    dl_account: "",
    master_elite: true,
    sales_tax_rate: 0,
    only_tax_material: true,
    labor_display: "man_hours",
    hours_per_man_day: 9,
    shipping_method: "stepped",
    shipping_percent: 0,
    updated_at: new Date().toISOString(),
  };
}

// Shared draft + save for the company settings row. Each of the three tabs below
// (Contractor Information / Sales Tax / Basic Labor Settings — split to mirror the
// legacy Bid-Advantage nav) edits its own slice but saves the whole row, exactly
// like the legacy per-screen saves.
function useCompanyDraft(initial: CompanySettings | null, onSaved: () => void, savedMsg: string) {
  const saveFn = useServerFn(saveCompanySettings);
  const [c, setC] = useState<CompanySettings>(initial ?? blankCompany());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (initial) setC(initial);
  }, [initial]);

  const set = <K extends keyof CompanySettings>(k: K, v: CompanySettings[K]) =>
    setC((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await saveFn({
        data: {
          company_name: c.company_name,
          address: c.address,
          city: c.city,
          state: c.state,
          zip: c.zip,
          phone: c.phone,
          dl_account: c.dl_account,
          master_elite: c.master_elite,
          sales_tax_rate: c.sales_tax_rate,
          only_tax_material: c.only_tax_material,
          labor_display: c.labor_display as "man_hours" | "man_days",
          hours_per_man_day: c.hours_per_man_day,
          shipping_method: c.shipping_method as "stepped" | "percent",
          shipping_percent: c.shipping_percent,
        },
      });
      toast.success(savedMsg);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return { c, set, save, saving };
}

type CompanyTabProps = { initial: CompanySettings | null; onSaved: () => void };

function ContractorTab({ initial, onSaved }: CompanyTabProps) {
  const { c, set, save, saving } = useCompanyDraft(initial, onSaved, "Contractor information saved");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Contractor information</CardTitle>
          <CardDescription>Company identity used on bids and orders.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name">
            <Input
              value={c.company_name ?? ""}
              onChange={(e) => set("company_name", e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <Input value={c.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Address">
            <Input value={c.address ?? ""} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="DL account #">
            <Input value={c.dl_account ?? ""} onChange={(e) => set("dl_account", e.target.value)} />
          </Field>
          <Field label="City">
            <Input value={c.city ?? ""} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State">
              <Input value={c.state ?? ""} onChange={(e) => set("state", e.target.value)} />
            </Field>
            <Field label="ZIP">
              <Input value={c.zip ?? ""} onChange={(e) => set("zip", e.target.value)} />
            </Field>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch
              checked={c.master_elite}
              onCheckedChange={(v) => set("master_elite", v)}
              id="master_elite"
            />
            <Label htmlFor="master_elite">Master / Elite contractor</Label>
          </div>
        </CardContent>
      </Card>

      <SaveBar saving={saving} onSave={save} />
    </div>
  );
}

function SalesTaxTab({ initial, onSaved }: CompanyTabProps) {
  const { c, set, save, saving } = useCompanyDraft(initial, onSaved, "Sales tax saved");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Sales tax</CardTitle>
          <CardDescription>Applied to every bid per the setting below.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <Field label="Sales tax rate (e.g. 0.0625 = 6.25%)">
            <Input
              type="number"
              step="0.0001"
              value={c.sales_tax_rate}
              onChange={(e) => set("sales_tax_rate", num(e.target.value))}
            />
          </Field>
          <div className="flex items-center gap-3 pt-6">
            <Switch
              id="only_tax_material"
              checked={c.only_tax_material}
              onCheckedChange={(v) => set("only_tax_material", v)}
            />
            <Label htmlFor="only_tax_material">
              Only tax material
              {!c.only_tax_material && (
                <span className="ml-2 text-xs text-destructive">entire bid will be taxed</span>
              )}
            </Label>
          </div>
        </CardContent>
      </Card>

      <SaveBar saving={saving} onSave={save} />
    </div>
  );
}

function BasicLaborTab({ initial, onSaved }: CompanyTabProps) {
  const { c, set, save, saving } = useCompanyDraft(initial, onSaved, "Basic labor settings saved");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Basic labor settings</CardTitle>
          <CardDescription>How labor is displayed and converted on bids.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div>
            <Label className="mb-2 block">Display labor in</Label>
            <RadioGroup
              value={c.labor_display}
              onValueChange={(v) => set("labor_display", v as CompanySettings["labor_display"])}
              className="flex gap-6"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="man_hours" id="mh" />
                <Label htmlFor="mh">Man hours</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="man_days" id="md" />
                <Label htmlFor="md">Man days</Label>
              </div>
            </RadioGroup>
          </div>
          <Field label="Hours per man-day">
            <Input
              type="number"
              step="0.5"
              value={c.hours_per_man_day}
              onChange={(e) => set("hours_per_man_day", num(e.target.value))}
            />
          </Field>
        </CardContent>
      </Card>

      <SaveBar saving={saving} onSave={save} />
    </div>
  );
}

function ShippingTab({
  company,
  initialSteps,
  onSaved,
}: {
  company: CompanySettings | null;
  initialSteps: ShippingStep[];
  onSaved: () => void;
}) {
  const saveStepsFn = useServerFn(saveShippingSteps);
  const saveCompanyFn = useServerFn(saveCompanySettings);
  const [method, setMethod] = useState(company?.shipping_method ?? "stepped");
  const [percent, setPercent] = useState(company?.shipping_percent ?? 0);
  const [steps, setSteps] = useState(
    initialSteps.map((s) => ({
      material_threshold: s.material_threshold,
      shipping_cost: s.shipping_cost,
    })),
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!company) return;
    setSaving(true);
    try {
      await saveCompanyFn({
        data: {
          company_name: company.company_name,
          address: company.address,
          city: company.city,
          state: company.state,
          zip: company.zip,
          phone: company.phone,
          dl_account: company.dl_account,
          master_elite: company.master_elite,
          sales_tax_rate: company.sales_tax_rate,
          only_tax_material: company.only_tax_material,
          labor_display: company.labor_display as "man_hours" | "man_days",
          hours_per_man_day: company.hours_per_man_day,
          shipping_method: method as "stepped" | "percent",
          shipping_percent: percent,
        },
      });
      await saveStepsFn({ data: { steps } });
      toast.success("Shipping saved");
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
          <CardTitle>Shipping method</CardTitle>
          <CardDescription>How shipping is added to a bid's Duro-Last material.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup value={method} onValueChange={setMethod} className="space-y-2">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="stepped" id="stepped" />
              <Label htmlFor="stepped">Stepped table (by material $)</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="percent" id="percent" />
              <Label htmlFor="percent">Percentage of material cost</Label>
            </div>
          </RadioGroup>
          {method === "percent" && (
            <Field label="% of material cost">
              <Input
                type="number"
                step="0.1"
                value={percent}
                onChange={(e) => setPercent(num(e.target.value))}
                className="max-w-[160px]"
              />
            </Field>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stepped shipping table</CardTitle>
          <CardDescription>
            Material $ threshold → shipping cost. Used when the stepped method is selected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material $ (from)</TableHead>
                <TableHead>Shipping $</TableHead>
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
                        value={s.material_threshold}
                        onChange={(e) =>
                          setSteps((prev) =>
                            prev.map((r, j) =>
                              j === i ? { ...r, material_threshold: num(e.target.value) } : r,
                            ),
                          )
                        }
                        className="max-w-[160px]"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={s.shipping_cost}
                      onChange={(e) =>
                        setSteps((prev) =>
                          prev.map((r, j) =>
                            j === i ? { ...r, shipping_cost: num(e.target.value) } : r,
                          ),
                        )
                      }
                      className="max-w-[160px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
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
            className="mt-3"
            onClick={() =>
              setSteps((prev) => [...prev, { material_threshold: 0, shipping_cost: 0 }])
            }
          >
            <Plus className="mr-1 h-4 w-4" /> Add row
          </Button>
        </CardContent>
      </Card>

      <SaveBar saving={saving} onSave={save} />
    </div>
  );
}

function MarkupTab({ initial, onSaved }: { initial: MarkupOption[]; onSaved: () => void }) {
  const saveFn = useServerFn(saveMarkupOptions);
  const [opts, setOpts] = useState(initial);
  const [saving, setSaving] = useState(false);

  const set = (i: number, patch: Partial<MarkupOption>) =>
    setOpts((prev) => prev.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  const save = async () => {
    setSaving(true);
    try {
      await saveFn({
        data: {
          options: opts.map((o) => ({
            name: o.name,
            hourly_rate: o.hourly_rate,
            markup_amount: o.markup_amount,
            markup_type: o.markup_type as "dollar_manday" | "percent_cost" | "gross_profit",
            include_per_diem: o.include_per_diem,
            include_commission: o.include_commission,
            is_default: o.is_default,
          })),
        },
      });
      toast.success("Labor & markup saved");
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
        Named labor-rate and markup presets. One is the default applied to new bids.
      </p>
      {opts.map((o, i) => (
        <Card key={o.id || i}>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Name">
              <Input value={o.name} onChange={(e) => set(i, { name: e.target.value })} />
            </Field>
            <Field label="Hourly labor rate ($)">
              <Input
                type="number"
                step="0.01"
                value={o.hourly_rate}
                onChange={(e) => set(i, { hourly_rate: num(e.target.value) })}
              />
            </Field>
            <Field label="Markup amount">
              <Input
                type="number"
                step="0.01"
                value={o.markup_amount}
                onChange={(e) => set(i, { markup_amount: num(e.target.value) })}
              />
            </Field>
            <Field label="Markup type">
              <Select value={o.markup_type} onValueChange={(v) => set(i, { markup_type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gross_profit">Gross profit %</SelectItem>
                  <SelectItem value="percent_cost">% of total cost</SelectItem>
                  <SelectItem value="dollar_manday">$ per man-day</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-center gap-2 pt-6">
              <Switch
                checked={o.include_per_diem}
                onCheckedChange={(v) => set(i, { include_per_diem: v })}
                id={`pd-${i}`}
              />
              <Label htmlFor={`pd-${i}`}>Per diem before markup</Label>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch
                checked={o.include_commission}
                onCheckedChange={(v) => set(i, { include_commission: v })}
                id={`co-${i}`}
              />
              <Label htmlFor={`co-${i}`}>Commission before markup</Label>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Switch
                checked={o.is_default}
                onCheckedChange={(v) =>
                  setOpts((prev) =>
                    prev.map((op, j) => ({ ...op, is_default: j === i ? v : false })),
                  )
                }
                id={`def-${i}`}
              />
              <Label htmlFor={`def-${i}`}>Default preset</Label>
              {opts.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  onClick={() => setOpts((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setOpts((prev) => [
              ...prev,
              {
                id: "",
                name: "New option",
                hourly_rate: 45,
                markup_amount: 35,
                markup_type: "gross_profit",
                include_per_diem: false,
                include_commission: false,
                is_default: prev.length === 0,
                sort: prev.length,
                created_at: new Date().toISOString(),
              },
            ])
          }
        >
          <Plus className="mr-1 h-4 w-4" /> Add preset
        </Button>
      </div>
      <SaveBar saving={saving} onSave={save} />
    </div>
  );
}

function WarrantiesTab({
  initialWarranties,
  initialWind,
  onSaved,
}: {
  initialWarranties: Warranty[];
  initialWind: HighWindUpcharge[];
  onSaved: () => void;
}) {
  const saveWarrFn = useServerFn(saveWarranties);
  const saveWindFn = useServerFn(saveHighWind);
  const [warr, setWarr] = useState(initialWarranties);
  const [wind, setWind] = useState(initialWind);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await saveWarrFn({
        data: {
          warranties: warr.map((w) => ({
            name: w.name,
            price_per_sqft: w.price_per_sqft,
            non_master_elite_surcharge: w.non_master_elite_surcharge,
          })),
        },
      });
      await saveWindFn({
        data: {
          rows: wind.map((r) => ({
            term_years: r.term_years,
            wind_band: r.wind_band,
            mech_per_sqft: r.mech_per_sqft,
            adhered_per_sqft: r.adhered_per_sqft,
          })),
        },
      });
      toast.success("Warranties saved");
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
          <CardTitle>Warranties</CardTitle>
          <CardDescription>
            Price per sq ft by warranty type, plus the non-Master/Elite surcharge.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Warranty</TableHead>
                <TableHead>Price / SqFt</TableHead>
                <TableHead>+ Non-Master/Elite / SqFt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {warr.map((w, i) => (
                <TableRow key={w.id || i}>
                  <TableCell className="font-medium">{w.name}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={w.price_per_sqft}
                      onChange={(e) =>
                        setWarr((prev) =>
                          prev.map((r, j) =>
                            j === i ? { ...r, price_per_sqft: num(e.target.value) } : r,
                          ),
                        )
                      }
                      className="max-w-[140px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={w.non_master_elite_surcharge}
                      onChange={(e) =>
                        setWarr((prev) =>
                          prev.map((r, j) =>
                            j === i
                              ? {
                                  ...r,
                                  non_master_elite_surcharge: num(e.target.value),
                                }
                              : r,
                          ),
                        )
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
          <CardTitle>High-wind upcharges</CardTitle>
          <CardDescription>
            Added per sq ft by warranty term and wind band, split by attachment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Term (yr)</TableHead>
                <TableHead>Wind band (mph)</TableHead>
                <TableHead>Mechanically attached / SqFt</TableHead>
                <TableHead>Fully adhered / SqFt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wind.map((r, i) => (
                <TableRow key={r.id || i}>
                  <TableCell className="font-medium">{r.term_years}</TableCell>
                  <TableCell>{r.wind_band}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={r.mech_per_sqft}
                      onChange={(e) =>
                        setWind((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, mech_per_sqft: num(e.target.value) } : x,
                          ),
                        )
                      }
                      className="max-w-[140px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={r.adhered_per_sqft}
                      onChange={(e) =>
                        setWind((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, adhered_per_sqft: num(e.target.value) } : x,
                          ),
                        )
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

      <SaveBar saving={saving} onSave={save} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  );
}

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
