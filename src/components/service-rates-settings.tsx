/**
 * Setup › Service rates (docs/service-module-design.md §4): the twelve hourly rates
 * the invoice uses (Standard / Urgent / Emergency × Tech / Helper × Travel / Labor, each with a
 * bill and a cost rate), the default tax rate, the payment terms, the
 * contact line on the PDF and the invoice email. Admins and Estimate Pricing users (the server
 * refuses everyone else). A draft invoice picks up changes when it is rebuilt from its ticket.
 *
 * Nov 4 (review items 1, 3, 4): three headings — Hourly rates, Invoices, Authorizing Done
 * tickets — over one form and one Save; Save is enabled only with unsaved edits, and the page's
 * leave dialog knows about them (lib/setup-forms.ts). The CenterPoint note stays until "These
 * rates are confirmed" is pressed (confirmServiceRates stamps who and when). On a phone the
 * rates stack under each role instead of a table that scrolls sideways.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { SETUP_HISTORY_KEY, SetupHistory } from "@/components/setup-history";
import { Check, Loader2, Save } from "lucide-react";

import {
  confirmServiceRates,
  getServiceRates,
  RATE_KIND_LABELS,
  RATE_KINDS,
  setServiceRates,
  type ServiceRateRow,
} from "@/lib/invoices.functions";
import { authorizerFallbackLabel } from "@/lib/default-authorizer";
import { plainErrText } from "@/lib/plain-error";
import { useSetupForm } from "@/lib/setup-forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Plain words for a failed save (audit, Nov 6, finding 2): as the other cards.
const errText = plainErrText;
const toPct = (frac: number | string) => Number((Number(frac) * 100).toFixed(4));
const fromPct = (pct: number) => Number((pct / 100).toFixed(6));

const ROLES = [
  { key: "tech", label: "Tech" },
  { key: "helper", label: "Helper" },
] as const;
const COLUMNS = [
  { time: "travel", field: "bill", label: "Travel bill" },
  { time: "labor", field: "bill", label: "Labor bill" },
  { time: "travel", field: "cost", label: "Travel cost" },
  { time: "labor", field: "cost", label: "Labor cost" },
] as const;

interface RateDraft {
  bill: number;
  cost: number;
}
interface SettingsDraft {
  tax_pct: number;
  payment_terms: string;
  invoice_contact: string;
  email_subject: string;
  email_message: string;
  /** Who owns the Authorize reminder (M9); "" = the admins and managers in order. */
  authorizer_id: string;
}

/** The authorizer select's "Admins and managers" item (a Select item cannot have an empty value). */
const ADMINS = "admins";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function ServiceRatesSettings() {
  const qc = useQueryClient();
  const getFn = useServerFn(getServiceRates);
  const setFn = useServerFn(setServiceRates);
  const confirmFn = useServerFn(confirmServiceRates);
  const q = useQuery({ queryKey: ["service-rates"], queryFn: () => getFn() });

  const [rates, setRates] = useState<Record<number, RateDraft>>({});
  const [s, setS] = useState<SettingsDraft | null>(null);
  /** What the boxes were filled from: Save is enabled while the drafts differ from it. */
  const loaded = useMemo(() => {
    const d = q.data;
    if (!d) return null;
    return {
      rates: Object.fromEntries(
        d.rates.map((r) => [r.id, { bill: Number(r.bill_rate), cost: Number(r.cost_rate) }]),
      ) as Record<number, RateDraft>,
      s: {
        tax_pct: toPct(d.settings.tax_rate),
        payment_terms: d.settings.payment_terms,
        invoice_contact: d.settings.invoice_contact ?? "",
        email_subject: d.settings.email_subject,
        email_message: d.settings.email_message,
        authorizer_id: d.settings.authorizer_id ?? "",
      } satisfies SettingsDraft,
    };
  }, [q.data]);
  const dirty =
    !!loaded &&
    !!s &&
    JSON.stringify({ rates, s }) !== JSON.stringify({ rates: loaded.rates, s: loaded.s });
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  /** Set by a save: the next load refills the boxes even if the server trimmed something. */
  const refillRef = useRef(false);
  // Fill the boxes from the server; a refetch (window focus) never overwrites unsaved edits.
  useEffect(() => {
    if (!loaded || (dirtyRef.current && !refillRef.current)) return;
    refillRef.current = false;
    setRates(loaded.rates);
    setS(loaded.s);
  }, [loaded]);

  const find = (kind: string, role: string, time: string): ServiceRateRow | undefined =>
    q.data?.rates.find((r) => r.rate_kind === kind && r.role === role && r.time_kind === time);
  const setS2 = <K extends keyof SettingsDraft>(k: K, v: SettingsDraft[K]) =>
    setS((cur) => (cur ? { ...cur, [k]: v } : cur));

  const save = useMutation({
    mutationFn: () => {
      if (!s) throw new Error("Settings not loaded");
      if (!s.email_subject.trim()) throw new Error("The email subject cannot be empty");
      return setFn({
        data: {
          rates: Object.entries(rates).map(([id, r]) => ({
            id: Number(id),
            bill_rate: r.bill,
            cost_rate: r.cost,
          })),
          settings: {
            tax_rate: fromPct(s.tax_pct),
            payment_terms: s.payment_terms.trim(),
            invoice_contact: s.invoice_contact.trim() || null,
            email_subject: s.email_subject.trim(),
            email_message: s.email_message.trim(),
            // Sent only when changed (the column arrives with 20261005150000_ticket_authorizer.sql).
            ...(s.authorizer_id !== (q.data?.settings.authorizer_id ?? "")
              ? { authorizer_id: s.authorizer_id || null }
              : {}),
          },
        },
      });
    },
    onSuccess: async () => {
      toast.success("Service rates saved");
      // The drafts are refilled from the fresh row once it is here.
      refillRef.current = true;
      await qc.invalidateQueries({ queryKey: ["service-rates"] });
      void qc.invalidateQueries({ queryKey: SETUP_HISTORY_KEY });
    },
    onError: (e) => toast.error(`Could not save the service rates: ${errText(e)}`),
  });
  const submit = () => {
    if (!s || !dirty) return;
    save.mutate();
  };
  useSetupForm("rates", dirty, () => save.mutateAsync());

  const confirm = useMutation({
    mutationFn: () => confirmFn(),
    onSuccess: (r) => {
      toast.success("Rates confirmed");
      void qc.invalidateQueries({ queryKey: SETUP_HISTORY_KEY });
      qc.setQueryData(["service-rates"], (cur: typeof q.data) =>
        cur
          ? {
              ...cur,
              settings: {
                ...cur.settings,
                rates_confirmed_at: r.rates_confirmed_at,
                rates_confirmed_by_name: r.by,
              },
            }
          : cur,
      );
    },
    onError: (e) => toast.error(`Could not confirm the rates: ${errText(e)}`),
  });

  // Who authorizes when nothing is picked (QA audit bug 6, owner Oct 6): Brandon by name once
  // his profile is an admin / manager, else "not added as a user yet; until then every admin".
  const fallback = authorizerFallbackLabel(
    { authorizer_id: s?.authorizer_id || null },
    q.data?.managers ?? [],
  );

  const rateBox = (
    kind: (typeof RATE_KINDS)[number],
    role: string,
    c: (typeof COLUMNS)[number],
    className: string,
  ) => {
    const row = find(kind, role, c.time);
    const draft = row ? rates[row.id] : undefined;
    const roleLabel = ROLES.find((r) => r.key === role)?.label ?? role;
    return row && draft ? (
      <NumberField
        value={draft[c.field]}
        step="0.01"
        inputMode="decimal"
        className={className}
        title={`${RATE_KIND_LABELS[kind]} ${roleLabel} ${c.label}`}
        onChange={(v) =>
          setRates((rs) => ({
            ...rs,
            [row.id]: { ...draft, ...rs[row.id], [c.field]: v },
          }))
        }
      />
    ) : (
      <span className="ml-auto block w-24 text-right text-muted-foreground">—</span>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service rates</CardTitle>
        <CardDescription>
          The hourly rates and wording a ticket's invoice is built with. The ticket's Labor rate
          (Standard / Urgent / Emergency) picks the row; each extra technician is billed as a
          Helper. A draft invoice picks up changes when it is rebuilt from its ticket.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.error ? (
          <p className="text-sm text-destructive">
            Could not load the service rates: {errText(q.error)}
          </p>
        ) : !q.data || !s ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <section className="space-y-3" aria-labelledby="rates-h-hourly">
              <h3 id="rates-h-hourly" className="text-sm font-semibold">
                Hourly rates
              </h3>
              {!q.data.settings.rates_confirmed_at ? (
                <div
                  className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
                  data-note="centerpoint"
                >
                  <p className="min-w-0 flex-1 md:truncate">
                    Defaults came from the CenterPoint invoices in the report; confirm the helper
                    travel rates with the office.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 bg-background"
                    disabled={confirm.isPending}
                    onClick={() => confirm.mutate()}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" aria-hidden /> These rates are confirmed
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground" data-note="confirmed">
                  Rates confirmed {when(q.data.settings.rates_confirmed_at)}
                  {q.data.settings.rates_confirmed_by_name
                    ? ` by ${q.data.settings.rates_confirmed_by_name}`
                    : ""}
                  .
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                On a ticket with named technicians, each one&apos;s labor bills at the $ typed
                beside their name, else their default bill rate (Admin › Users & access), else the
                Tech / Helper labor rate below. Travel and the cost side always come from this
                table.
              </p>

              <div className="hidden overflow-x-auto md:block">
                <table className="text-sm">
                  <caption className="caption-top pb-1 text-left text-xs text-muted-foreground">
                    $ per hour
                  </caption>
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Rate kind
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Role
                      </th>
                      {COLUMNS.map((c) => (
                        <th key={c.label} scope="col" className="py-1 pr-2 text-right font-medium">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {RATE_KINDS.flatMap((kind) =>
                      ROLES.map((role, i) => (
                        <tr
                          key={`${kind}-${role.key}`}
                          className={i === ROLES.length - 1 ? "border-b last:border-b-0" : ""}
                        >
                          {i === 0 ? (
                            <th
                              scope="row"
                              rowSpan={ROLES.length}
                              className="whitespace-nowrap py-1 pr-4 text-left align-middle font-medium"
                            >
                              {RATE_KIND_LABELS[kind]}
                            </th>
                          ) : null}
                          <td className="py-1 pr-4 text-muted-foreground">{role.label}</td>
                          {COLUMNS.map((c) => (
                            <td key={c.label} className="py-1 pr-2">
                              {rateBox(kind, role.key, c, "ml-auto h-8 w-24 text-right")}
                            </td>
                          ))}
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
              {/* Phones: the four boxes of each role under the role, labelled, nothing off-screen. */}
              <div className="space-y-3 md:hidden" data-layout="rates-stacked">
                <p className="text-xs text-muted-foreground">$ per hour</p>
                {RATE_KINDS.map((kind) => (
                  <div key={kind} className="rounded-md border p-2">
                    <p className="text-sm font-medium">{RATE_KIND_LABELS[kind]}</p>
                    {ROLES.map((role) => (
                      <div key={role.key} className="mt-2">
                        <p className="text-xs text-muted-foreground">{role.label}</p>
                        <div className="mt-1 grid grid-cols-2 gap-2">
                          {COLUMNS.map((c) => (
                            <label key={c.label} className="space-y-0.5">
                              <span className="block text-[11px] text-muted-foreground">
                                {c.label}
                              </span>
                              {rateBox(kind, role.key, c, "h-9 w-full")}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3" aria-labelledby="rates-h-invoices">
              <h3 id="rates-h-invoices" className="text-sm font-semibold">
                Invoices
              </h3>
              <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Tax rate %</Label>
                  <NumberField
                    value={s.tax_pct}
                    max={100}
                    step="0.01"
                    inputMode="decimal"
                    onChange={(v) => setS2("tax_pct", v)}
                  />
                  <p className="text-xs text-muted-foreground">
                    On the taxable lines of new invoices; blank means no tax, and a tax-exempt
                    customer gets 0 either way.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rates-terms">Payment terms</Label>
                  <Input
                    id="rates-terms"
                    value={s.payment_terms}
                    maxLength={500}
                    onChange={(e) => setS2("payment_terms", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rates-contact">Invoice contact line</Label>
                  <Input
                    id="rates-contact"
                    value={s.invoice_contact}
                    maxLength={500}
                    placeholder="e.g. Questions? Call the office at …"
                    onChange={(e) => setS2("invoice_contact", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Printed on the invoice PDF.</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rates-subject">Email subject</Label>
                  <Input
                    id="rates-subject"
                    value={s.email_subject}
                    maxLength={200}
                    onChange={(e) => setS2("email_subject", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {"{number}"} is replaced with the invoice number.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rates-message">Email message</Label>
                  <Textarea
                    id="rates-message"
                    rows={3}
                    maxLength={2000}
                    value={s.email_message}
                    onChange={(e) => setS2("email_message", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    The default message in the Send dialog; it can be changed per send.
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-3" aria-labelledby="rates-h-authorizing">
              <h3 id="rates-h-authorizing" className="text-sm font-semibold">
                Authorizing Done tickets
              </h3>
              <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="rates-authorizer">Authorizes Done tickets</Label>
                  <Select
                    value={s.authorizer_id || ADMINS}
                    onValueChange={(v) => setS2("authorizer_id", v === ADMINS ? "" : v)}
                  >
                    <SelectTrigger id="rates-authorizer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ADMINS}>Admins and managers</SelectItem>
                      {(q.data?.managers ?? []).map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {/* Nothing picked: who it falls to (QA audit bug 6, owner Oct 6). */}
                    {fallback ? <>{fallback}. </> : null}
                    Owns the &quot;Authorize ticket&quot; reminder when a ticket is Done. Every
                    admin and manager is told the ticket is done, sees it under Needs authorization
                    on Work Overview and can mark it Authorized.
                  </p>
                </div>
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!dirty || save.isPending}>
                {save.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save
              </Button>
              {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
            </div>
          </form>
        )}
        <SetupHistory tab="rates" />
      </CardContent>
    </Card>
  );
}
