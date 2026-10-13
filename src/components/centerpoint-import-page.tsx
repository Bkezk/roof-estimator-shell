/**
 * Admin › Import from CenterPoint (owner, Oct 13): the office exports Companies, Properties and
 * Contacts from CenterPoint's Book of Business, picks the three files here, runs a dry run (the
 * counts and a report, nothing written), reads the report, then imports. The Import button only
 * appears after a dry run of these exact files (a change to a file needs a new dry run), and
 * the confirm dialog restates the counts. The server plans again from the texts when it writes
 * (src/lib/centerpoint-import.functions.ts), so what the page shows is only a preview.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { confirmText, textsKey } from "@/lib/centerpoint-import";
import {
  applyCenterpointImport,
  planCenterpointImport,
  type ApplyResult,
  type ImportInput,
  type PlanResult,
} from "@/lib/centerpoint-import.functions";

type FileKey = keyof ImportInput;
const FILES: { key: FileKey; label: string; help: string }[] = [
  { key: "companies", label: "Companies", help: "Book of Business › Companies export" },
  { key: "properties", label: "Properties", help: "Book of Business › Properties export" },
  { key: "contacts", label: "Contacts", help: "Book of Business › Contacts export" },
];

const readText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("Could not read the file"));
    r.readAsText(file);
  });

const n = (v: number) => v.toLocaleString();

export function CenterpointImportPage() {
  const planFn = useServerFn(planCenterpointImport);
  const applyFn = useServerFn(applyCenterpointImport);
  const [texts, setTexts] = useState<Partial<Record<FileKey, string>>>({});
  const [names, setNames] = useState<Partial<Record<FileKey, string>>>({});
  const [busy, setBusy] = useState<"plan" | "apply" | null>(null);
  const [plan, setPlan] = useState<{ key: string; result: PlanResult } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [applied, setApplied] = useState<ApplyResult | null>(null);

  const input: ImportInput | null =
    texts.companies && texts.properties && texts.contacts
      ? { companies: texts.companies, properties: texts.properties, contacts: texts.contacts }
      : null;
  const currentKey = input ? textsKey(input) : null;
  const dryRunMatches = !!plan && plan.key === currentKey;

  const pick = async (key: FileKey, file: File | null) => {
    if (!file) return;
    try {
      const text = await readText(file);
      setTexts((t) => ({ ...t, [key]: text }));
      setNames((t) => ({ ...t, [key]: file.name }));
      setApplied(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the file");
    }
  };

  const dryRun = async () => {
    if (!input) return;
    setBusy("plan");
    setApplied(null);
    try {
      const result = await planFn({ data: input });
      setPlan({ key: textsKey(input), result });
      toast.success("Dry run finished; nothing was written");
    } catch (e) {
      setPlan(null);
      toast.error(e instanceof Error ? e.message : "The dry run failed");
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    if (!input || !dryRunMatches) return;
    setBusy("apply");
    try {
      const result = await applyFn({ data: input });
      setApplied(result);
      setConfirm(false);
      if (result.error) toast.error(`Import stopped: ${result.error}`);
      else toast.success("Import finished");
      // The files are now imported: a re-run would skip them, so ask for a new dry run.
      setPlan(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The import failed");
    } finally {
      setBusy(null);
    }
  };

  const downloadReport = () => {
    if (!plan) return;
    const blob = new Blob([plan.result.report], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `centerpoint-import-report-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const summary = plan?.result.summary;
  const counts = plan?.result.counts;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" /> Import from CenterPoint
          </CardTitle>
          <CardDescription>
            Bring the customers, properties and contacts over from CenterPoint Connect. Export the
            three Book of Business lists as CSV, pick them below and run a dry run first: it reads
            the files against the portal and reports what it would write, without writing anything.
            Customers already imported are skipped, a customer with the same name is linked, nothing
            is deleted or overwritten, and running it twice is safe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {FILES.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`cp-${f.key}`}>{f.label}</Label>
                <Input
                  id={`cp-${f.key}`}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => void pick(f.key, e.target.files?.[0] ?? null)}
                />
                <p className="truncate text-xs text-muted-foreground" title={names[f.key]}>
                  {names[f.key] ?? f.help}
                </p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={dryRun} disabled={!input || busy !== null}>
              <FileSpreadsheet className="mr-1 h-4 w-4" />
              {busy === "plan" ? "Reading…" : "Dry run"}
            </Button>
            {dryRunMatches && summary && (
              <Button
                type="button"
                variant="default"
                onClick={() => setConfirm(true)}
                disabled={
                  busy !== null || summary.accounts + summary.sites + summary.contacts === 0
                }
              >
                <Upload className="mr-1 h-4 w-4" /> Import
              </Button>
            )}
            {plan && !dryRunMatches && (
              <span className="text-xs text-muted-foreground">
                A file changed since the dry run; run it again before importing.
              </span>
            )}
            {!input && (
              <span className="text-xs text-muted-foreground">
                Pick all three files to run a dry run.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {applied && (
        <Card>
          <CardHeader>
            <CardTitle>{applied.error ? "Import stopped" : "Import finished"}</CardTitle>
            {applied.error && (
              <CardDescription className="text-destructive">
                {applied.error} — what is listed below was written; run a new dry run and import
                again to finish (already-imported rows are skipped).
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <table className="text-sm">
              <tbody>
                <tr>
                  <td className="pr-4 text-muted-foreground">Customers created</td>
                  <td className="tabular-nums">{n(applied.written.accounts)}</td>
                </tr>
                <tr>
                  <td className="pr-4 text-muted-foreground">Customers linked</td>
                  <td className="tabular-nums">{n(applied.written.accountLinks)}</td>
                </tr>
                <tr>
                  <td className="pr-4 text-muted-foreground">Properties created</td>
                  <td className="tabular-nums">{n(applied.written.sites)}</td>
                </tr>
                <tr>
                  <td className="pr-4 text-muted-foreground">Properties linked</td>
                  <td className="tabular-nums">{n(applied.written.siteLinks)}</td>
                </tr>
                <tr>
                  <td className="pr-4 text-muted-foreground">Contacts created</td>
                  <td className="tabular-nums">{n(applied.written.contacts)}</td>
                </tr>
                <tr>
                  <td className="pr-4 text-muted-foreground">Contacts linked</td>
                  <td className="tabular-nums">{n(applied.written.contactLinks)}</td>
                </tr>
                {(applied.unresolved.sites > 0 || applied.unresolved.contacts > 0) && (
                  <tr>
                    <td className="pr-4 text-muted-foreground">Without a customer (not written)</td>
                    <td className="tabular-nums">
                      {n(applied.unresolved.sites)} properties, {n(applied.unresolved.contacts)}{" "}
                      contacts
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {plan && summary && counts && (
        <Card>
          <CardHeader>
            <CardTitle>Dry run</CardTitle>
            <CardDescription>
              Nothing was written. Read the report before importing; the flagged rows are the ones
              to check in CenterPoint or fix in the portal afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <table className="w-full text-sm" data-table="dry-run-counts">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-4 font-normal"></th>
                  <th className="py-1 pr-4 font-normal">In file</th>
                  <th className="py-1 pr-4 font-normal">New</th>
                  <th className="py-1 pr-4 font-normal">Linked by name</th>
                  <th className="py-1 pr-4 font-normal">Already imported</th>
                  <th className="py-1 pr-4 font-normal">Folded twins</th>
                  <th className="py-1 pr-4 font-normal">Skipped</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr>
                  <td className="py-1 pr-4 font-medium">Customers</td>
                  <td className="py-1 pr-4">{n(counts.companies.rows)}</td>
                  <td className="py-1 pr-4">{n(summary.accounts)}</td>
                  <td className="py-1 pr-4">{n(summary.accountLinks)}</td>
                  <td className="py-1 pr-4">{n(counts.companies.already)}</td>
                  <td className="py-1 pr-4">{n(counts.companies.folded)}</td>
                  <td className="py-1 pr-4"></td>
                </tr>
                <tr>
                  <td className="py-1 pr-4 font-medium">Properties</td>
                  <td className="py-1 pr-4">{n(counts.properties.rows)}</td>
                  <td className="py-1 pr-4">{n(summary.sites)}</td>
                  <td className="py-1 pr-4">{n(summary.siteLinks)}</td>
                  <td className="py-1 pr-4">{n(counts.properties.already)}</td>
                  <td className="py-1 pr-4">{n(counts.properties.folded)}</td>
                  <td className="py-1 pr-4">{n(counts.properties.noCompany)}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4 font-medium">Contacts</td>
                  <td className="py-1 pr-4">{n(counts.contacts.rows)}</td>
                  <td className="py-1 pr-4">{n(summary.contacts)}</td>
                  <td className="py-1 pr-4">{n(summary.contactLinks)}</td>
                  <td className="py-1 pr-4">{n(counts.contacts.already)}</td>
                  <td className="py-1 pr-4">{n(counts.contacts.folded)}</td>
                  <td className="py-1 pr-4">
                    {n(counts.contacts.skippedNames + counts.contacts.noCompany)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              {n(counts.companies.noContactInfo)} customers come over with no email or phone (they
              show “No contact info” on the Customers page);{" "}
              {n(counts.companies.sameNameDifferentAddress)} share a name with another customer at a
              different address.
            </p>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Report</h3>
              <Button type="button" variant="outline" size="sm" onClick={downloadReport}>
                <Download className="mr-1 h-4 w-4" /> Download report
              </Button>
            </div>
            <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap">
              {plan.result.report}
            </pre>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirm} onOpenChange={(o) => busy === null && setConfirm(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import from CenterPoint?</DialogTitle>
            <DialogDescription>
              {summary ? confirmText(summary) : ""}
              {summary && summary.accountLinks + summary.siteLinks + summary.contactLinks > 0
                ? ` ${n(summary.accountLinks)} customers, ${n(summary.siteLinks)} properties and ${n(summary.contactLinks)} contacts that already exist by name are linked to their CenterPoint IDs.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirm(false)}
              disabled={busy !== null}
            >
              Cancel
            </Button>
            <Button type="button" onClick={runImport} disabled={busy !== null || !dryRunMatches}>
              {busy === "apply" ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
