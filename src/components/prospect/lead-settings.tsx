/**
 * Admin settings for the Leads page (owner, Sep 28), opened from the gear like the storm
 * thresholds: the roof keywords the planroom titles are matched against and the Chattanooga
 * permit cost floor. (The Louisville and Nashville permit settings left this form Oct 6 with
 * their sources — lib/leads-retired.ts; the columns keep their old values.) Formerly: which
 * Louisville permits count (types, minimum size, how far back), and which Nashville permits count (types
 * and a minimum construction cost: that layer has no square footage; the window is shared).
 * The cost floor applies to Chattanooga's new non-residential permits too (their window is a
 * fixed 180 days: that layer runs a month or two behind). They apply from the next refresh.
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
  // The Chattanooga permit threshold lives in the nashville_min_cost column (it was shared).
  const [nashMinCost, setNashMinCost] = useState(Number(s.nashville_min_cost));

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
    if (!kw.length) problems.push("add at least one roof keyword");
    if (kw.length > 50 || kw.some((k) => k.length > 40))
      problems.push("roof keywords: at most 50, each up to 40 characters");
    if (!Number.isFinite(nashMinCost) || nashMinCost < 0 || nashMinCost > 100_000_000)
      problems.push("Chattanooga min cost must be $0 to $100,000,000");
    if (problems.length) {
      toast.error(`Check the settings: ${problems.join("; ")}`);
      return;
    }
    // The retired Louisville / Nashville settings are saved back as they were (the columns
    // and the server's checks still want them).
    save.mutate({
      roof_keywords: kw,
      louisville_types: s.louisville_types,
      louisville_min_sqft: Number(s.louisville_min_sqft),
      louisville_days: Number(s.louisville_days),
      nashville_types: s.nashville_types,
      nashville_min_cost: nashMinCost,
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
        {/* The Louisville and Nashville permit settings are gone from here (sources retired,
            owner Oct 6); their saved values ride along unchanged below. */}
        <div>
          <Label className="text-xs text-muted-foreground">
            Min construction cost for Chattanooga permits ($; looks back 180 days)
          </Label>
          <NumberField
            className="h-8"
            value={nashMinCost}
            blankZero={false}
            max={100_000_000}
            step="10000"
            inputMode="numeric"
            onChange={(v) => setNashMinCost(Math.round(v))}
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
