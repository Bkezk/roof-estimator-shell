/**
 * A site's roof warranties (service study M5, owner Oct 5): under each site on the Customers
 * page — the list, Add warranty, and Edit / Delete on each — and the badge the ticket and the
 * Today card show while one is in force (src/lib/warranty.ts).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  deleteSiteWarranty,
  listSiteWarranties,
  saveSiteWarranty,
} from "@/lib/warranties.functions";
import {
  WARRANTY_MAX,
  inForce,
  monthYear,
  warrantyBadges,
  warrantyLabel,
  warrantyProblem,
  type Warranty,
} from "@/lib/warranty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pad = (n: number) => String(n).padStart(2, "0");
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const warrantyKey = (siteId: string) => ["site-warranties", siteId] as const;

/** The badge(s) on a ticket: the site's warranties in force today; nothing when there are none. */
export function WarrantyBadges({ siteId }: { siteId: string | null | undefined }) {
  const { session } = useAuth();
  const listFn = useServerFn(listSiteWarranties);
  const q = useQuery({
    queryKey: warrantyKey(siteId ?? ""),
    queryFn: () => listFn({ data: { site_id: siteId! } }),
    enabled: !!session && !!siteId,
  });
  const badges = warrantyBadges(q.data ?? [], todayYmd());
  if (!badges.length) return null;
  return <WarrantyBadgeList badges={badges} />;
}

export function WarrantyBadgeList({ badges }: { badges: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Warranty">
      {badges.map((b) => (
        <Badge key={b} variant="outline" className="gap-1 border-primary/40 font-medium">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Warranty: {b}
        </Badge>
      ))}
    </div>
  );
}

interface Draft {
  manufacturer: string;
  kind: string;
  number: string;
  start_date: string;
  end_date: string;
  notes: string;
}
const draftOf = (w?: Warranty): Draft => ({
  manufacturer: w?.manufacturer ?? "",
  kind: w?.kind ?? "",
  number: w?.number ?? "",
  start_date: w?.start_date ?? "",
  end_date: w?.end_date ?? "",
  notes: w?.notes ?? "",
});

/** The site's warranties on the Customers page, with Add / Edit / Delete unless read-only. */
export function SiteWarranties({ siteId, readOnly }: { siteId: string; readOnly: boolean }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listSiteWarranties);
  const delFn = useServerFn(deleteSiteWarranty);
  const q = useQuery({
    queryKey: warrantyKey(siteId),
    queryFn: () => listFn({ data: { site_id: siteId } }),
    enabled: !!session,
  });
  const [editing, setEditing] = useState<string | null>(null); // id, "new" or null
  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Warranty deleted");
      void qc.invalidateQueries({ queryKey: warrantyKey(siteId) });
    },
    onError: (e) => toast.error(`Could not delete the warranty: ${errText(e)}`),
  });
  const list = q.data ?? [];
  const today = todayYmd();
  if (q.error)
    return (
      <p className="mt-1 text-xs text-destructive">Could not load warranties: {errText(q.error)}</p>
    );
  if (!list.length && readOnly) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {list.map((w) =>
        editing === w.id ? (
          <WarrantyForm key={w.id} siteId={siteId} warranty={w} onDone={() => setEditing(null)} />
        ) : (
          <div key={w.id} className="flex flex-wrap items-center gap-2 text-xs">
            <ShieldCheck
              className={`h-3.5 w-3.5 ${inForce(w, today) ? "text-primary" : "text-muted-foreground"}`}
              aria-hidden
            />
            <span className="font-medium">Warranty: {warrantyLabel(w)}</span>
            {w.number && <span className="text-muted-foreground">#{w.number}</span>}
            {w.start_date && (
              <span className="text-muted-foreground">from {monthYear(w.start_date)}</span>
            )}
            {!inForce(w, today) && <Badge variant="secondary">not in force</Badge>}
            {w.notes && <span className="text-muted-foreground">· {w.notes}</span>}
            {!readOnly && (
              <span className="ml-auto flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  aria-label="Edit warranty"
                  onClick={() => setEditing(w.id)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  aria-label="Delete warranty"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete the warranty "${warrantyLabel(w)}"?`))
                      remove.mutate(w.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </span>
            )}
          </div>
        ),
      )}
      {!readOnly &&
        (editing === "new" ? (
          <WarrantyForm siteId={siteId} onDone={() => setEditing(null)} />
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setEditing("new")}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add warranty
          </Button>
        ))}
    </div>
  );
}

function WarrantyForm({
  siteId,
  warranty,
  onDone,
}: {
  siteId: string;
  warranty?: Warranty;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveSiteWarranty);
  const [f, setF] = useState<Draft>(() => draftOf(warranty));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const problem = warrantyProblem({
    manufacturer: f.manufacturer,
    start_date: f.start_date || null,
    end_date: f.end_date || null,
  });
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          ...(warranty ? { id: warranty.id } : {}),
          site_id: siteId,
          manufacturer: f.manufacturer,
          kind: f.kind,
          number: f.number,
          start_date: f.start_date || null,
          end_date: f.end_date || null,
          notes: f.notes,
        },
      }),
    onSuccess: () => {
      toast.success(warranty ? "Warranty saved" : "Warranty added");
      void qc.invalidateQueries({ queryKey: warrantyKey(siteId) });
      onDone();
    },
    onError: (e) => toast.error(`Could not save the warranty: ${errText(e)}`),
  });
  const id = warranty?.id ?? `new-${siteId}`;
  return (
    <form
      className="grid gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) save.mutate();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`${id}-mfr`} className="text-xs">
          Manufacturer
        </Label>
        <Input
          id={`${id}-mfr`}
          value={f.manufacturer}
          maxLength={WARRANTY_MAX.manufacturer}
          placeholder="e.g. Duro-Last"
          onChange={(e) => set("manufacturer", e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-kind`} className="text-xs">
          Type
        </Label>
        <Input
          id={`${id}-kind`}
          value={f.kind}
          maxLength={WARRANTY_MAX.kind}
          placeholder="e.g. 15 NDL"
          onChange={(e) => set("kind", e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-num`} className="text-xs">
          Warranty #
        </Label>
        <Input
          id={`${id}-num`}
          value={f.number}
          maxLength={WARRANTY_MAX.number}
          onChange={(e) => set("number", e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-start`} className="text-xs">
            Start
          </Label>
          <Input
            id={`${id}-start`}
            type="date"
            value={f.start_date}
            onChange={(e) => set("start_date", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-end`} className="text-xs">
            End
          </Label>
          <Input
            id={`${id}-end`}
            type="date"
            value={f.end_date}
            onChange={(e) => set("end_date", e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${id}-notes`} className="text-xs">
          Notes
        </Label>
        <Input
          id={`${id}-notes`}
          value={f.notes}
          maxLength={WARRANTY_MAX.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={!!problem || save.isPending}>
          {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {warranty ? "Save warranty" : "Add warranty"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {problem && f.manufacturer && <span className="text-xs text-destructive">{problem}</span>}
      </div>
    </form>
  );
}
