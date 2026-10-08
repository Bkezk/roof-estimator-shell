/**
 * "Import PlanSwift takeoff (.xlsx)" — reads a PlanSwift 11 Excel export in the browser, shows one
 * review row per sheet row with the importer's guess (src/lib/planswift/classify.ts), lets the
 * estimator change any target, then starts a NEW bid from it in the estimator, the same way
 * "Create bid" on a takeoff does. The customer is optional (owner, Oct 5: "get rid of that for
 * now and just have the imported planswift file make an untitled bid"): without one the bid
 * starts as "Untitled bid", unlinked, to be named and linked on its Setup screen. The choices
 * the estimator changes are remembered per row name in this browser (`planswift.mapping.v2`)
 * for the next export.
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { getAccessoryCatalog, getEngineAdminData, getMetalsCatalog } from "@/lib/engine.functions";
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
  planSwiftBidName,
  planSwiftSeed,
  suggestPlanSwiftBidName,
  type PlanSwiftChoice,
} from "@/lib/planswift/to-seed";
import {
  pickFor,
  sheetDownspoutSizes,
  unresolvedRows,
  type PickLists,
  type ReviewRow,
} from "@/lib/planswift/picks";
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
/** The name box's prefill: "<customer> · <file>" once a customer is picked; blank (Untitled bid) until then. */
const prefillName = (customerLabel: string | null | undefined, fileName: string) =>
  customerLabel ? suggestPlanSwiftBidName(customerLabel, fileName) : "";
const num = (x: number) =>
  x.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** The review screen's order: what builds the bid first, "place by hand" and skip last. */
const TARGET_ORDER: PlanSwiftTarget[] = [...PLANSWIFT_TARGETS];

/** A review row: a choice whose target may still be unanswered. */
type ReviewChoice = Omit<PlanSwiftChoice, "target"> & { target: PlanSwiftTarget | null };

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: "text-emerald-700 dark:text-emerald-400",
  medium: "text-amber-700 dark:text-amber-400",
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
  // The customer box shows to whoever can search customers; it is optional (owner, Oct 5). A
  // bid without one is "Untitled bid" and gets its customer on the bid's Setup later.
  const canPickCustomer = can("customers") || can("service") || can("estimate");
  const getAdminFn = useServerFn(getEngineAdminData);
  const { data: liveAdmin } = useQuery({
    queryKey: ["engine-admin"],
    queryFn: () => getAdminFn(),
    enabled: props.open,
  });
  // The Metals screen catalog (downspouts by size, two-piece metal) and the walk pad rows, so
  // those sheet rows land on their screens with prices (owner, Oct 6, Towneplace Suites).
  const getMetalsFn = useServerFn(getMetalsCatalog);
  const { data: metalsCatalog } = useQuery({
    queryKey: ["metals-catalog"],
    queryFn: () => getMetalsFn(),
    enabled: props.open,
  });
  const getAccessoriesFn = useServerFn(getAccessoryCatalog);
  const { data: accessoryCatalog } = useQuery({
    queryKey: ["accessory-catalog"],
    queryFn: () => getAccessoriesFn(),
    enabled: props.open,
  });
  const walkPadRows = useMemo(
    () =>
      (accessoryCatalog ?? [])
        .filter((i) => /walk\s*pad/i.test(i.description))
        .map((i) => i.description),
    [accessoryCatalog],
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<PlanSwiftSheet | null>(null);
  // The review rows: a row the classifier is unsure of starts with NO target (owner, Oct 8: "if
  // it doesn't know it'll ask"), and a row whose target needs a pick carries it (lib/planswift/picks.ts).
  const [rows, setRows] = useState<ReviewChoice[]>([]);
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
      setRows(
        classified.map((c) => ({
          row: c,
          // Unsure and not remembered: ask, rather than guess "place by hand".
          target: c.confidence === "low" && !c.remembered ? null : c.target,
        })),
      );
      if (!nameTouched) setBidName(prefillName(account?.label, file.name));
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
    if (!nameTouched) setBidName(prefillName(v?.label ?? null, fileName));
  };

  const setTarget = (i: number, target: PlanSwiftTarget) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { row: r.row, target } : r)));
  const setOnSection = (i: number, sheetRow: number) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, onSection: sheetRow } : r)));
  const setPick = (i: number, pick: string) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, pick } : r)));

  const sectionRows = rows.filter((r) => r.target === "section");
  // What the picks offer: the live lists, and the downspout sizes the sheet itself names.
  const lists: PickLists = useMemo(
    () => ({
      gutterSizesByStyle: liveAdmin?.metals?.gutters?.sizesByStyle,
      metalsCatalog,
      drainBoots: liveAdmin?.accessories?.drainBoots.map((b) => b.description),
      drainRings: liveAdmin?.accessories?.drainRings.map((r) => r.description),
    }),
    [liveAdmin, metalsCatalog],
  );
  const sheetSizes = useMemo(() => sheetDownspoutSizes(rows), [rows]);
  // Rows still waiting on the estimator: no target yet, or an empty pick box.
  const unresolved = useMemo(
    () => unresolvedRows(rows as ReviewRow[], lists, sheetSizes),
    [rows, lists, sheetSizes],
  );
  // The seed's choices: a row with no target yet is previewed as "place by hand".
  const choices: PlanSwiftChoice[] = useMemo(
    () => rows.map((r) => ({ ...r, target: r.target ?? "unmatched" })),
    [rows],
  );

  // The seed as it stands (live), for its summary and warnings; errors show instead of the list.
  const preview = useMemo(() => {
    if (!sheet || choices.length === 0) return null;
    try {
      return {
        seed: planSwiftSeed(sheet, choices, {
          fileName,
          ...(lists.gutterSizesByStyle ? { gutterSizesByStyle: lists.gutterSizesByStyle } : {}),
          ...(liveAdmin?.underlaymentPrices
            ? { boardNames: Object.keys(liveAdmin.underlaymentPrices) }
            : {}),
          ...(liveAdmin?.labor ? { labor: liveAdmin.labor } : {}),
          ...(metalsCatalog ? { metalsCatalog } : {}),
          ...(walkPadRows.length ? { walkPadRows } : {}),
          // Roof Drains & Boots: a sized drain row picks its boot and ring (owner, Oct 8).
          ...(liveAdmin?.accessories
            ? {
                drainBoots: liveAdmin.accessories.drainBoots.map((b) => b.description),
                drainRings: liveAdmin.accessories.drainRings.map((r) => r.description),
              }
            : {}),
          ...(account ? { accountId: account.account_id } : {}),
        }),
        error: null,
      };
    } catch (e) {
      return { seed: null, error: errText(e) };
    }
  }, [sheet, choices, lists, fileName, liveAdmin, metalsCatalog, walkPadRows, account]);

  const create = () => {
    if (busy) return;
    if (!preview?.seed) {
      toast.error(preview?.error ?? "Choose a PlanSwift export first.");
      return;
    }
    if (unresolved.length > 0) {
      toast.error(
        `${unresolved.length} row${unresolved.length === 1 ? " needs" : "s need"} your pick before the bid is created.`,
      );
      return;
    }
    setBusy(true);
    try {
      const name = planSwiftBidName(bidName, account?.label, fileName);
      // Only the rows the estimator changed are remembered (the importer's own guesses are not).
      rememberMappings(
        safeStorage("local"),
        choices.map((r) => ({
          key: r.row.key,
          target: r.target,
          guessed: r.row.guessed ?? r.row.target,
        })),
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
          bidName: name,
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
            Pick a PlanSwift “Export to Excel” file. Check where each row goes, then Create bid
            opens a new bid in the estimator with the sections, parapets, curbs, pipe stacks and
            lines filled in. The customer is optional here; without one the bid starts as “Untitled
            bid”. Nothing is saved until you save the bid.
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
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This export has no “Linear total” column, so each roof section is a square of its
                area. Add Linear total to the PlanSwift export for the real perimeters.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {canPickCustomer && (
              <div className="space-y-1">
                <Label htmlFor="planswift-customer">Customer (optional)</Label>
                <AccountPicker
                  id="planswift-customer"
                  value={account}
                  disabled={busy}
                  placeholder="Start typing a customer name…"
                  onChange={pickAccount}
                />
                <p className="text-xs text-muted-foreground">
                  Files the bid under this customer; it can be linked on the bid later instead.
                </p>
              </div>
            )}
            {canPickCustomer && hit && (
              <div className="space-y-1">
                <Label htmlFor="planswift-site">Property (optional)</Label>
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
                placeholder={account ? "Starts as the customer and the file name" : "Untitled bid"}
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
                    const changed = r.target !== null && r.target !== c.target;
                    const ask = r.target === null;
                    const pick = r.target ? pickFor(c, r.target, lists, sheetSizes) : null;
                    const pickMissing =
                      !!pick && !(r.pick && pick.options.some((o) => o.value === r.pick));
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
                            value={r.target ?? ""}
                            onValueChange={(v) => setTarget(i, v as PlanSwiftTarget)}
                            disabled={busy}
                          >
                            <SelectTrigger
                              className={`h-8 ${ask ? "border-destructive ring-1 ring-destructive" : ""}`}
                              aria-label={`Where “${c.row.name}” goes`}
                            >
                              <SelectValue placeholder="Pick where it goes…" />
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
                          {pick && (
                            <Select
                              value={pickMissing ? "" : (r.pick ?? "")}
                              onValueChange={(v) => setPick(i, v)}
                              disabled={busy}
                            >
                              <SelectTrigger
                                className={`mt-1 h-8 text-xs ${pickMissing ? "border-destructive ring-1 ring-destructive" : ""}`}
                                aria-label={`${pick.question} (${c.row.name})`}
                              >
                                <SelectValue placeholder={pick.question} />
                              </SelectTrigger>
                              <SelectContent>
                                {pick.options.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                        <td className="px-2 py-1.5 align-top text-xs">
                          {ask ? (
                            <p className="font-medium text-destructive">Needs your pick</p>
                          ) : (
                            <p>{describeTarget(c, r.target ?? c.target)}</p>
                          )}
                          {pickMissing && !ask && (
                            <p className="font-medium text-destructive">{pick!.question}</p>
                          )}
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
          {unresolved.length > 0 && (
            <p className="mr-auto self-center text-xs font-medium text-destructive">
              {unresolved.length} row{unresolved.length === 1 ? " needs" : "s need"} your pick
              (marked in red).
            </p>
          )}
          <Button onClick={create} disabled={busy || !preview?.seed || unresolved.length > 0}>
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
