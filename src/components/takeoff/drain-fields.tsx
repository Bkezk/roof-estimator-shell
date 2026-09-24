/**
 * The four drain picks the estimator's Roof Drains & Boots entry needs (existing roof type,
 * reuse existing rings, drain boot, drain ring), shared by the Setup tab's defaults and the
 * Objects tab's per-drain editor. The option lists are the same reference data the estimator's
 * Drains screen offers (`admin.accessories`). Nothing is preselected.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/lib/auth-store";
import { getEngineAdminData } from "@/lib/engine.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { DrainKey, DrainPicks } from "./shapes";

/** The admin data query (same key as the Setup tab and the estimator, so it is shared). */
function useEngineAdmin() {
  const { session } = useAuth();
  const getAdminFn = useServerFn(getEngineAdminData);
  return useQuery({
    queryKey: ["engine-admin"],
    queryFn: () => getAdminFn(),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });
}

const NONE = "__none__";

function PickList(props: {
  id: string;
  label: string;
  value: string | undefined;
  options: string[];
  onChange: (v: string | undefined) => void;
}) {
  // Keep a saved value that is no longer offered visible in its list.
  const list =
    props.value && !props.options.includes(props.value)
      ? [props.value, ...props.options]
      : props.options;
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id} className="text-xs text-muted-foreground">
        {props.label}
      </Label>
      <Select
        value={props.value ?? ""}
        onValueChange={(v) => props.onChange(v === NONE ? undefined : v)}
      >
        <SelectTrigger id={props.id} className="h-8 text-sm">
          <SelectValue placeholder={list.length ? "Choose…" : "No options loaded"} />
        </SelectTrigger>
        <SelectContent>
          {props.value && (
            <SelectItem value={NONE} className="text-muted-foreground">
              Not picked
            </SelectItem>
          )}
          {list.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Four grid cells (roof type, reuse rings, boot, ring) for a two-column grid. `idPrefix` keeps
 * the label/control ids unique when two sets are on screen (Setup and Objects).
 */
export function DrainFields(props: {
  idPrefix: string;
  value: DrainPicks;
  onChange: (k: DrainKey, v: string | boolean | undefined) => void;
}) {
  const { data: admin } = useEngineAdmin();
  const acc = admin?.accessories;
  const roofTypes = (acc?.drainRoofTypes ?? []).map((r) => r.name);
  const boots = (acc?.drainBoots ?? []).map((b) => b.description);
  const rings = (acc?.drainRings ?? []).map((r) => r.description);
  const v = props.value;
  return (
    <>
      <PickList
        id={`${props.idPrefix}-roof-type`}
        label="Existing roof type"
        value={v.roofType}
        options={roofTypes}
        onChange={(x) => props.onChange("roofType", x)}
      />
      <label
        htmlFor={`${props.idPrefix}-reuse`}
        className="flex items-center gap-2 self-end pb-2 text-sm"
      >
        <Checkbox
          id={`${props.idPrefix}-reuse`}
          checked={v.reuseRings ?? false}
          onCheckedChange={(c) => props.onChange("reuseRings", c === true)}
        />
        Reuse existing rings
      </label>
      <PickList
        id={`${props.idPrefix}-boot`}
        label="Drain boot"
        value={v.bootSize}
        options={boots}
        onChange={(x) => props.onChange("bootSize", x)}
      />
      <PickList
        id={`${props.idPrefix}-ring`}
        label="Drain ring"
        value={v.ringSize}
        options={rings}
        onChange={(x) => props.onChange("ringSize", x)}
      />
    </>
  );
}
