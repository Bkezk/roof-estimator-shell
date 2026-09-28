/**
 * Admin settings for the Leads page (owner, Sep 28), opened from the gear like the storm
 * thresholds: the roof keywords the planroom titles are matched against, and which Louisville
 * permits count (types, minimum size, how far back). They apply from the next refresh.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  setLeadSettings,
  type LeadSettingsInput,
  type LeadSettingsRow,
} from "@/lib/leads.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function LeadSettingsPanel(props: { settings: LeadSettingsRow; onClose: () => void }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(setLeadSettings);
  const s = props.settings;
  const [keywords, setKeywords] = useState(s.roof_keywords.join(", "));
  const [types, setTypes] = useState(s.louisville_types.join(", "));
  const [minSqft, setMinSqft] = useState(Number(s.louisville_min_sqft));
  const [days, setDays] = useState(Number(s.louisville_days));

  const save = useMutation({
    mutationFn: (d: LeadSettingsInput) => saveFn({ data: d }),
    onSuccess: () => {
      toast.success("Lead settings saved; they apply from the next refresh");
      void qc.invalidateQueries({ queryKey: ["lead-counts"] });
      props.onClose();
    },
    onError: (e) => toast.error(`Could not save lead settings: ${errText(e)}`),
  });

  const submit = () => {
    const problems: string[] = [];
    const kw = list(keywords);
    const ty = list(types);
    if (!kw.length) problems.push("add at least one roof keyword");
    if (kw.length > 50 || kw.some((k) => k.length > 40))
      problems.push("roof keywords: at most 50, each up to 40 characters");
    if (!ty.length) problems.push("add at least one Louisville permit type");
    if (ty.length > 20 || ty.some((t) => t.length > 60))
      problems.push("permit types: at most 20, each up to 60 characters");
    if (!Number.isFinite(minSqft) || minSqft < 0 || minSqft > 1_000_000)
      problems.push("min sq ft must be 0 to 1,000,000");
    if (!Number.isInteger(days) || days < 7 || days > 365)
      problems.push("window must be 7 to 365 days");
    if (problems.length) {
      toast.error(`Check the settings: ${problems.join("; ")}`);
      return;
    }
    save.mutate({
      roof_keywords: kw,
      louisville_types: ty,
      louisville_min_sqft: minSqft,
      louisville_days: days,
    });
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label className="text-xs text-muted-foreground">
            Roof keywords (comma-separated; a lead whose title or description has any of these is a
            roof lead)
          </Label>
          <Input className="h-8" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs text-muted-foreground">
            Louisville permit types (comma-separated)
          </Label>
          <Input className="h-8" value={types} onChange={(e) => setTypes(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Min building size (sq ft)</Label>
          <NumberField
            className="h-8"
            value={minSqft}
            blankZero={false}
            max={1_000_000}
            step="500"
            inputMode="numeric"
            onChange={(v) => setMinSqft(Math.round(v))}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Permit window (days back)</Label>
          <NumberField
            className="h-8"
            value={days}
            blankZero={false}
            min={0}
            max={365}
            inputMode="numeric"
            invalid={days < 7 || days > 365}
            onChange={(v) => setDays(Math.round(v))}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Changes apply from the next refresh.</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
