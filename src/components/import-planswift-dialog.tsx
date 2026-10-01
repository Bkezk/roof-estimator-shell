/**
 * "Import PlanSwift takeoff (.xlsx)" — reads a PlanSwift 11 Excel export in the browser, shows one
 * review row per sheet row with the importer's guess (src/lib/planswift/classify.ts), lets the
 * estimator change any target, then starts a NEW bid from it in the estimator (linked to the
 * customer), the same way "Create bid" on a takeoff does. The choices are remembered per row name
 * in this browser (`planswift.mapping`) for the next export.
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { getEngineAdminData } from "@/lib/engine.functions";
import { useAuth } from "@/lib/auth-store";
import type { AccountHit } from "@/lib/crm.functions";
import { readPlanSwiftWorkbook, type PlanSwiftSheet } from "@/lib/planswift/parse";
import {
  classifyRows,
  describeTarget,
  PLANSWIFT_TARGET_LABELS,
  PLANSWIFT_TARGETS,
  type ClassifiedRow,
  type Confidence,
  type PlanSwiftTarget,
} from "@/lib/planswift/classify";
import {
  applyMappingMemory,
  readMappingMemory,
  rememberMappings,
} from "@/lib/planswift/mapping-memory";
import {
  planSwiftSeed,
  suggestPlanSwiftBidName,
  type PlanSwiftChoice,
} from "@/lib/planswift/to-seed";
import { stashPlanSwiftHandoff } from "@/lib/planswift/handoff";
import { AccountPicker, type AccountPickerValue } from "@/components/crm/account-picker";
import { SiteSelect } from "@/components/crm/site-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const num = (x: number) =>
  x.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** The review screen's order: what builds the bid first, "place by hand" and skip last. */
const TARGET_ORDER: PlanSwiftTarget[] = [...PLANSWIFT_TARGETS];

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: "text-emerald-700",
  medium: "text-amber-700",
  low: "text-destructive",
};
const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "sure",
  medium: "likely",
  low: "unsure",
};

const safeStorage = (kind: "local" | "session"): Storage | null => {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};

export function ImportPlanSwiftDialog(props: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  // Same rule as the New takeoff dialog: the customer is required whenever the user can search
  // customers; a user who cannot links the customer on the bid's Setup later.
  const canPickCustomer = can("customers") || can("service") || can("estimate");
  const getAdminFn = useServerFn(getEngineAdminData);
  const { data: liveAdmin } = useQuery({
    queryKey: ["engine-admin"],
    queryFn: () => getAdminFn(),
    enabled: props.open,
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<PlanSwiftSheet | null>(null);
  const [rows, setRows] = useState<PlanSwiftChoice[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [account, setAccount] = useState<AccountPickerValue | null>(null);
  // The picked customer, kept so the site box can re-pick it with a site.
  const [hit, setHit] = useState<AccountHit | null>(null);
  const [bidName, setBidName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFileName("");
    setSheet(null);
    setRows([]);
    setReadError(null);
    setAccount(null);
    setHit(null);
    setBidName("");
    setNameTouched(false);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const close = () => {
    if (busy) return;
    reset();
    props.onClose();
  };

  const readFile = async (file: File | null | undefined) => {
    if (!file) return;
    setReading(true);
    setReadError(null);
    try {
      const s = await readPlanSwiftWorkbook(new Uint8Array(await file.arrayBuffer()));
      const classified = applyMappingMemory(
        classifyRows(s.rows),
        readMappingMemory(safeStorage("local")),
      );
      setSheet(s);
      setFileName(file.name);
      setRows(classified.map((c) => ({ row: c, target: c.target })));
      if (!nameTouched) setBidName(suggestPlanSwiftBidName(account?.label, file.name));
    } catch (e) {
      const msg = `Could not read ${file.name}: ${errText(e)}`;
      setSheet(null);
      setRows([]);
      setReadError(msg);
      toast.error(msg);
    } finally {
      setReading(false);
    }
  };

  const pickAccount = (hit: AccountHit | null) => {
    const v: AccountPickerValue | null = hit
      ? {
          account_id: hit.account_id,
          site_id: hit.site_id,
          label: hit.site_name ? `${hit.account_name} — ${hit.site_name}` : hit.account_name,
        }
      : null;
    setAccount(v);
    setHit(hit);
    if (!nameTouched)
      setBidName(fileName || v ? suggestPlanSwiftBidName(v?.label ?? null, fileName) : "");
  };

  const setTarget = (i: number, target: PlanSwiftTarget) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { row: r.row, target } : r)));
  const setOnSection = (i: number, sheetRow: number) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, onSection: sheetRow } : r)));

  const sectionRows = rows.filter((r) => r.target === "section");

  // The seed as it stands (live), for its summary and warnings; errors show instead of the list.
  const preview = useMemo(() => {
    if (!sheet || rows.length === 0) return null;
    try {
      return {
        seed: planSwiftSeed(sheet, rows, {
          fileName,
          ...(liveAdmin?.underlaymentPrices
            ? { boardNames: Object.keys(liveAdmin.underlaymentPrices) }
            : {}),
          ...(liveAdmin?.labor ? { labor: liveAdmin.labor } : {}),
          ...(account ? { accountId: account.account_id } : {}),
        }),
        error: null,
      };
    } catch (e) {
      return { seed: null, error: errText(e) };
    }
  }, [sheet, rows, fileName, liveAdmin, account]);

  const missingCustomer = canPickCustomer && !account;
  const create = () => {
    if (busy) return;
    if (!preview?.seed) {
      toast.error(preview?.error ?? "Choose a PlanSwift export first.");
      return;
    }
    if (missingCustomer) {
      toast.error("Pick the customer this bid is for (or add them) before creating it.");
      return;
    }
    setBusy(true);
    try {
      const name = (bidName.trim() || suggestPlanSwiftBidName(account?.label, fileName)).trim();
      rememberMappings(
        safeStorage("local"),
        rows.map((r) => ({ key: r.row.key, target: r.target })),
      );
      const session = safeStorage("session");
      if (!session) throw new Error("This browser blocks tab storage, which the import needs.");
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      stashPlanSwiftHandoff(
        session,
        {
          seed: preview.seed,
          bidName: name || "Untitled bid",
          account: account
            ? { id: account.account_id, siteId: account.site_id, label: account.label }
            : null,
          createdAt: new Date().toISOString(),
        },
        id,
      );
      reset();
      props.onClose();
      void navigate({ to: "/estimate", search: { planswift: id } });
    } catch (e) {
      setBusy(false);
      toast.error(`Could not create the bid: ${errText(e)}`);
    }
  };

  const warnings = preview?.seed?.warnings ?? sheet?.warnings ?? [];

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Import PlanSwift takeoff (.xlsx)</DialogTitle>
          <DialogDescription>
            Pick a PlanSwift “Export to Excel” file. Check where each row goes, pick the customer,
            then Create bid opens a new bid in the estimator with the sections, parapets, curbs,
            pipe stacks and lines filled in. Nothing is saved until you save the bid.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="planswift-file">
              PlanSwift export <span className="text-destructive">*</span>
            </Label>
            <input
              id="planswift-file"
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5"
              disabled={busy || reading}
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
            {reading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading the export…
              </p>
            )}
            {readError && <p className="text-sm font-medium text-destructive">{readError}</p>}
            {sheet && !sheet.hasLinearTotal && (
              <p className="text-xs text-amber-700">
                This export has no “Linear total” column, so each roof section is a square of its
                area. Add Linear total to the PlanSwift export for the real perimeters.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {canPickCustomer && (
              <div className="space-y-1">
                <Label htmlFor="planswift-customer">
                  Customer <span className="text-destructive">*</span>
                </Label>
                <AccountPicker
                  id="planswift-customer"
                  value={account}
                  disabled={busy}
                  placeholder="Start typing a customer name…"
                  onChange={pickAccount}
                />
                <p className="text-xs text-muted-foreground">
                  Required. The bid is filed under this customer.
                </p>
              </div>
            )}
            {canPickCustomer && hit && (
              <div className="space-y-1">
                <Label htmlFor="planswift-site">Site (optional)</Label>
                <SiteSelect
                  id="planswift-site"
                  accountId={hit.account_id}
                  value={hit.site_id}
                  disabled={busy}
                  onChange={(s) =>
                    pickAccount({
                      ...hit,
                      site_id: s?.id ?? null,
                      site_name: s?.name ?? null,
                      site_address: "",
                    })
                  }
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="planswift-bid-name">Bid name</Label>
              <Input
                id="planswift-bid-name"
                value={bidName}
                disabled={busy}
                placeholder="Starts as the customer and the file name"
                onChange={(e) => {
                  setNameTouched(e.target.value.trim().length > 0);
                  setBidName(e.target.value);
                }}
              />
              <p className="text-xs text-muted-foreground">Optional.</p>
            </div>
          </div>

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">PlanSwift row</th>
                    <th className="px-2 py-1.5 text-right font-medium">Quantity</th>
                    <th className="px-2 py-1.5 font-medium">Goes to</th>
                    <th className="px-2 py-1.5 font-medium">Reads as</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r, i) => {
                    const c: ClassifiedRow = r.row;
                    const changed = r.target !== c.target;
                    return (
                      <tr key={c.row.sheetRow} className={r.target === "skip" ? "opacity-60" : ""}>
                        <td className="max-w-[280px] px-2 py-1.5 align-top">
                          <p className="break-words font-medium">{c.row.name}</p>
                          {c.row.description && (
                            <p className="text-xs text-muted-foreground">{c.row.description}</p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right align-top tabular-nums">
                          {num(c.row.qty)} {c.row.units}
                          {c.row.linearTotal !== null &&
                            c.row.linearTotal > 0 &&
                            c.row.unitKind === "sqft" && (
                              <p className="text-xs text-muted-foreground">
                                {num(c.row.linearTotal)} ft around
                              </p>
                            )}
                        </td>
                        <td className="min-w-[190px] px-2 py-1.5 align-top">
                          <Select
                            value={r.target}
                            onValueChange={(v) => setTarget(i, v as PlanSwiftTarget)}
                            disabled={busy}
                          >
                            <SelectTrigger
                              className="h-8"
                              aria-label={`Where “${c.row.name}” goes`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TARGET_ORDER.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {PLANSWIFT_TARGET_LABELS[t]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {r.target === "tapered" && sectionRows.length > 1 && (
                            <Select
                              value={String(
                                r.onSection ??
                                  [...sectionRows].sort((a, b) => b.row.row.qty - a.row.row.qty)[0]!
                                    .row.row.sheetRow,
                              )}
                              onValueChange={(v) => setOnSection(i, Number(v))}
                              disabled={busy}
                            >
                              <SelectTrigger className="mt-1 h-8 text-xs" aria-label="On section">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {sectionRows.map((s) => (
                                  <SelectItem
                                    key={s.row.row.sheetRow}
                                    value={String(s.row.row.sheetRow)}
                                  >
                                    on {s.row.row.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                        <td className="px-2 py-1.5 align-top text-xs">
                          <p>{describeTarget(c, r.target)}</p>
                          <p className="text-muted-foreground">
                            {changed ? (
                              <span>your choice (guessed {PLANSWIFT_TARGET_LABELS[c.target]})</span>
                            ) : (
                              <>
                                <span className={CONFIDENCE_STYLE[c.confidence]}>
                                  {c.remembered ? "remembered" : CONFIDENCE_LABEL[c.confidence]}
                                </span>{" "}
                                — {c.reason}
                              </>
                            )}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {preview?.error && (
            <p className="text-sm font-medium text-destructive">
              The bid cannot be built from these choices: {preview.error}
            </p>
          )}
          {preview?.seed && (
            <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
              <p>{preview.seed.summary}</p>
              {preview.seed.unmapped.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {preview.seed.unmapped.length} row
                  {preview.seed.unmapped.length === 1 ? "" : "s"} will be listed on the bid to place
                  by hand.
                </p>
              )}
            </div>
          )}
          {warnings.length > 0 && (
            <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <p className="flex items-center gap-1 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" /> {warnings.length} thing
                {warnings.length === 1 ? "" : "s"} to check
              </p>
              <ul className="list-disc space-y-0.5 pl-5">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy || !preview?.seed || missingCustomer}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="mr-2 h-4 w-4" />
            )}
            Create bid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
