/**
 * Setup tab — the material questions asked BEFORE drawing (owner, Sep 24). Every field maps
 * 1:1 onto `TakeoffSetup`; the option lists come from the same admin data the estimator's Setup
 * step reads (roof systems, thicknesses, colours, sheet sizes, deck order), with plain fixed
 * lists when that data is not available. Nothing is prefilled with made-up values.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/lib/auth-store";
import { getEngineAdminData } from "@/lib/engine.functions";
import { attachedWithOptions, STANDARD_DECK_ORDER } from "@/lib/engine/adapters";
import { ARP_SIZE_OPTIONS, TERMINATION_OPTIONS } from "@/lib/engine/edges";
import { DESIGN_TABLE_OPTIONS, LEGACY_ROOF_SYSTEM_IDS } from "@/lib/engine/fastener-spacing";
import type { Attachment } from "@/lib/engine/estimate";
import type { TakeoffSetup } from "@/lib/takeoff/model";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { DrainFields } from "./drain-fields";
import { withDrainPick } from "./shapes";

type Opt = { value: string; label: string };
const opts = (xs: readonly (string | number)[]): Opt[] =>
  xs.map((x) => ({ value: String(x), label: String(x) }));
/** Keep a saved value that is no longer offered visible in its list. */
const withCurrent = (list: Opt[], cur: string | undefined): Opt[] =>
  cur && !list.some((o) => o.value === cur) ? [{ value: cur, label: cur }, ...list] : list;

const ATTACHMENTS: Opt[] = [
  { value: "mechanical", label: "Mechanically fastened" },
  { value: "adhered", label: "Adhered" },
];
const ARP_OPTS: Opt[] = ARP_SIZE_OPTIONS.map((n) => ({
  value: String(n),
  label: n === 0 ? "None" : `${n} in`,
}));

function Field(props: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${props.className ?? ""}`}>
      <Label className="text-xs text-muted-foreground">{props.label}</Label>
      {props.children}
    </div>
  );
}

function Pick(props: {
  value: string | undefined;
  options: Opt[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const list = withCurrent(props.options, props.value);
  return (
    <Select value={props.value ?? ""} onValueChange={props.onChange}>
      <SelectTrigger className="h-8 text-sm">
        <SelectValue placeholder={props.placeholder ?? "Choose…"} />
      </SelectTrigger>
      <SelectContent>
        {list.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Group(props: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border p-3">
      <h3 className="text-sm font-semibold">{props.title}</h3>
      {props.note && <p className="text-xs text-muted-foreground">{props.note}</p>}
      <div className="grid grid-cols-2 gap-2">{props.children}</div>
    </section>
  );
}

export function SetupTab(props: {
  setup: TakeoffSetup;
  onChange: (next: TakeoffSetup) => void;
  isNew: boolean;
}) {
  const { setup, onChange } = props;
  const { session } = useAuth();
  const getAdminFn = useServerFn(getEngineAdminData);
  const { data: admin } = useQuery({
    queryKey: ["engine-admin"],
    queryFn: () => getAdminFn(),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });

  const systems = useMemo(() => {
    const fromAdmin = admin
      ? [...new Set(Object.keys(admin.labor).map((k) => k.split("|")[0]!))]
      : [];
    return opts(fromAdmin.length ? fromAdmin : Object.keys(LEGACY_ROOF_SYSTEM_IDS));
  }, [admin]);
  const colors = useMemo(() => {
    const set = new Set<string>();
    for (const byTier of Object.values(admin?.priceMatrix ?? {}))
      for (const byColor of Object.values(byTier ?? {}))
        for (const c of Object.keys(byColor ?? {})) set.add(c);
    return opts(set.size ? [...set] : ["White", "Gray", "Tan"]);
  }, [admin]);
  const decks = opts(admin?.deckOrder.length ? admin.deckOrder : [...STANDARD_DECK_ORDER]);

  const combo =
    setup.roofSystem &&
    admin?.labor[
      `${setup.roofSystem}|${setup.attachment === "adhered" ? "adhesive" : "mechanical"}`
    ];
  const mils = Object.keys((combo && combo.thicknessLaborByMil) || {})
    .map(Number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const thicknesses = opts(mils.length ? mils : [40, 50, 60]);
  const sheetSizes = combo ? Object.keys(combo.sheetSizeMultiByLabel) : [];
  const adhesives = attachedWithOptions(admin, setup.roofSystem ?? "Duro-Last", "roof")
    .filter((o) => o.attachment === "adhered")
    .map((o) => o.adhesiveName);

  const set = <K extends keyof TakeoffSetup>(k: K, v: TakeoffSetup[K] | undefined) => {
    const nx: TakeoffSetup = { ...setup };
    if (v === undefined || v === "" || (typeof v === "number" && !(v > 0))) delete nx[k];
    else nx[k] = v;
    onChange(nx);
  };
  const edge = setup.edge ?? {};
  const setEdge = <K extends keyof NonNullable<TakeoffSetup["edge"]>>(
    k: K,
    v: NonNullable<TakeoffSetup["edge"]>[K],
  ) => onChange({ ...setup, edge: { ...edge, [k]: v } });
  const parapet = setup.parapet ?? {};
  const setParapet = <K extends keyof NonNullable<TakeoffSetup["parapet"]>>(
    k: K,
    v: NonNullable<TakeoffSetup["parapet"]>[K] | undefined,
  ) => {
    const nx = { ...parapet };
    if (v === undefined || v === "") delete nx[k];
    else nx[k] = v;
    onChange({ ...setup, parapet: nx });
  };

  const setDrain = (k: Parameters<typeof withDrainPick>[1], v: string | boolean | undefined) => {
    const drain = withDrainPick(setup.drain ?? {}, k, v);
    const nx: TakeoffSetup = { ...setup, drain };
    if (Object.keys(drain).length === 0) delete nx.drain;
    onChange(nx);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {props.isNew
          ? "Start here: answer the material questions for this roof, then draw. Each new area's sides take the edge defaults below (you can still change any side)."
          : "The material answers for this takeoff. Changes apply to areas you draw from now on; existing sides keep their own settings."}
      </p>

      <Group title="Roof membrane">
        <Field label="Roofing system">
          <Pick value={setup.roofSystem} options={systems} onChange={(v) => set("roofSystem", v)} />
        </Field>
        <Field label="Attachment">
          <Pick
            value={setup.attachment}
            options={ATTACHMENTS}
            onChange={(v) => {
              const nx: TakeoffSetup = { ...setup, attachment: v as Attachment };
              if (v !== "adhered") delete nx.membraneAdhesiveName;
              onChange(nx);
            }}
          />
        </Field>
        {setup.attachment === "adhered" && (
          <Field label="Adhesive" className="col-span-2">
            {adhesives.length ? (
              <Pick
                value={setup.membraneAdhesiveName}
                options={opts(adhesives)}
                onChange={(v) => set("membraneAdhesiveName", v)}
              />
            ) : (
              <Input
                className="h-8"
                value={setup.membraneAdhesiveName ?? ""}
                onChange={(e) => set("membraneAdhesiveName", e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label="Membrane (mil)">
          <Pick
            value={setup.thickness === undefined ? undefined : String(setup.thickness)}
            options={thicknesses}
            onChange={(v) => set("thickness", Number(v))}
          />
        </Field>
        <Field label="Colour">
          <Pick value={setup.color} options={colors} onChange={(v) => set("color", v)} />
        </Field>
        <Field label="Sheet size" className="col-span-2">
          {sheetSizes.length ? (
            <Pick
              value={setup.sheetSizeLabel}
              options={opts(sheetSizes)}
              onChange={(v) => set("sheetSizeLabel", v)}
            />
          ) : (
            <Input
              className="h-8"
              placeholder="e.g. 1500 sf"
              value={setup.sheetSizeLabel ?? ""}
              onChange={(e) => set("sheetSizeLabel", e.target.value)}
            />
          )}
        </Field>
      </Group>

      <Group title="Deck and fastening">
        <Field label="Deck type">
          <Pick value={setup.deckType} options={decks} onChange={(v) => set("deckType", v)} />
        </Field>
        <Field label="Design table (psf)">
          <Pick
            value={setup.designTable === undefined ? undefined : String(setup.designTable)}
            options={opts(DESIGN_TABLE_OPTIONS)}
            onChange={(v) => set("designTable", Number(v))}
          />
        </Field>
        <Field label="Pull test (lbs)">
          <NumberField
            className="h-8"
            value={setup.pullTest ?? 0}
            onChange={(v) => set("pullTest", v)}
            step="any"
          />
        </Field>
        <Field label="Field lap (in)">
          <NumberField
            className="h-8"
            value={setup.fieldLap ?? 0}
            onChange={(v) => set("fieldLap", v)}
            step="any"
          />
        </Field>
      </Group>

      <Group title="Edge defaults" note="Applied to every side of each new area as you draw it.">
        <label className="col-span-2 flex items-center justify-between gap-2 text-sm">
          Perimeter edge
          <Switch
            checked={edge.isPerimeter ?? true}
            onCheckedChange={(c) => setEdge("isPerimeter", c)}
          />
        </label>
        <Field label="Termination" className="col-span-2">
          <Pick
            value={edge.termination}
            options={opts(TERMINATION_OPTIONS)}
            onChange={(v) => setEdge("termination", v)}
          />
        </Field>
        <label className="flex items-center justify-between gap-2 text-sm">
          Wood blocking
          <Switch
            checked={edge.blocking ?? false}
            onCheckedChange={(c) => setEdge("blocking", c)}
          />
        </label>
        <Field label="ARP size">
          <Pick
            value={edge.arpSizeIn === undefined ? undefined : String(edge.arpSizeIn)}
            options={ARP_OPTS}
            onChange={(v) => setEdge("arpSizeIn", Number(v))}
          />
        </Field>
      </Group>

      <Group title="Parapet defaults">
        <Field label="System">
          <Pick
            value={parapet.roofSystem}
            options={systems}
            onChange={(v) => setParapet("roofSystem", v)}
          />
        </Field>
        <Field label="Attachment">
          <Pick
            value={parapet.attachment}
            options={ATTACHMENTS}
            onChange={(v) => setParapet("attachment", v as Attachment)}
          />
        </Field>
        <Field label="Height band">
          <Input
            className="h-8"
            placeholder="e.g. 12–24 in"
            value={parapet.heightBand ?? ""}
            onChange={(e) => setParapet("heightBand", e.target.value)}
          />
        </Field>
        <Field label="Deck type">
          <Pick
            value={parapet.deckType}
            options={decks}
            onChange={(v) => setParapet("deckType", v)}
          />
        </Field>
      </Group>

      <Group
        title="Drains"
        note="Given to every drain you place from now on (each drain can still be changed). A drain needs a boot and a ring to go into the bid's Roof Drains & Boots."
      >
        <DrainFields idPrefix="setup-drain" value={setup.drain ?? {}} onChange={setDrain} />
      </Group>

      <section className="space-y-1">
        <Label className="text-xs text-muted-foreground">Notes</Label>
        <Textarea
          rows={3}
          value={setup.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
        />
      </section>
    </div>
  );
}
