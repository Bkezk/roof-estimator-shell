/**
 * Admin › General › Service rates (docs/service-module-design.md §4): the twelve hourly rates
 * the invoice uses (Standard / Urgent / Emergency × Tech / Helper × Travel / Labor, each with a
 * bill and a cost rate), the material markup, the default tax rate, the payment terms, the
 * contact line on the PDF and the invoice email. Admins and Estimate Pricing users (the server
 * refuses everyone else). A draft invoice picks up changes when it is rebuilt from its ticket.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

import {
  getServiceRates,
  RATE_KIND_LABELS,
  RATE_KINDS,
  setServiceRates,
  type ServiceRateRow,
} from "@/lib/invoices.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";
import { Textarea } from "@/components/ui/textarea";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
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
  markup_pct: number;
  tax_pct: number;
  payment_terms: string;
  invoice_contact: string;
  email_subject: string;
  email_message: string;
}

export function ServiceRatesSettings() {
  const qc = useQueryClient();
  const getFn = useServerFn(getServiceRates);
  const setFn = useServerFn(setServiceRates);
  const q = useQuery({ queryKey: ["service-rates"], queryFn: () => getFn() });

  const [rates, setRates] = useState<Record<number, RateDraft>>({});
  const [s, setS] = useState<SettingsDraft | null>(null);
  useEffect(() => {
    const d = q.data;
    if (!d) return;
    setRates(
      Object.fromEntries(
        d.rates.map((r) => [r.id, { bill: Number(r.bill_rate), cost: Number(r.cost_rate) }]),
      ),
    );
    setS({
      markup_pct: toPct(d.settings.material_markup),
      tax_pct: toPct(d.settings.tax_rate),
      payment_terms: d.settings.payment_terms,
      invoice_contact: d.settings.invoice_contact ?? "",
      email_subject: d.settings.email_subject,
      email_message: d.settings.email_message,
    });
  }, [q.data]);

  const find = (kind: string, role: string, time: string): ServiceRateRow | undefined =>
    q.data?.rates.find((r) => r.rate_kind === kind && r.role === role && r.time_kind === time);
  const setS2 = <K extends keyof SettingsDraft>(k: K, v: SettingsDraft[K]) =>
    setS((cur) => (cur ? { ...cur, [k]: v } : cur));

  const save = useMutation({
    mutationFn: () => {
      if (!s) throw new Error("Settings not loaded");
      return setFn({
        data: {
          rates: Object.entries(rates).map(([id, r]) => ({
            id: Number(id),
            bill_rate: r.bill,
            cost_rate: r.cost,
          })),
          settings: {
            material_markup: fromPct(s.markup_pct),
            tax_rate: fromPct(s.tax_pct),
            payment_terms: s.payment_terms.trim(),
            invoice_contact: s.invoice_contact.trim() || null,
            email_subject: s.email_subject.trim(),
            email_message: s.email_message.trim(),
          },
        },
      });
    },
    onSuccess: () => {
      toast.success("Service rates saved");
      void qc.invalidateQueries({ queryKey: ["service-rates"] });
    },
    onError: (e) => toast.error(`Could not save the service rates: ${errText(e)}`),
  });
  const submit = () => {
    if (!s) return;
    if (!s.email_subject.trim()) {
      toast.error("The email subject cannot be empty");
      return;
    }
    if (s.markup_pct > 1000) {
      toast.error("Material markup is at most 1000 %");
      return;
    }
    save.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service rates</CardTitle>
        <CardDescription>
          The hourly rates, markup and wording a ticket's invoice is built with. The ticket's Labor
          rate (Standard / Urgent / Emergency) picks the row; each extra technician is billed as a
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
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100 md:truncate">
              Defaults came from the CenterPoint invoices in the report; confirm the helper travel
              rates with the office.
            </p>
            <p className="text-xs text-muted-foreground">
              On a ticket with named technicians, each one&apos;s labor bills at the $ typed beside
              their name, else their default bill rate (Admin › Users), else the Tech / Helper labor
              rate below. Travel and the cost side always come from this table.
            </p>

            <div className="overflow-x-auto">
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
                        {COLUMNS.map((c) => {
                          const row = find(kind, role.key, c.time);
                          const draft = row ? rates[row.id] : undefined;
                          return (
                            <td key={c.label} className="py-1 pr-2">
                              {row && draft ? (
                                <NumberField
                                  value={draft[c.field]}
                                  step="0.01"
                                  inputMode="decimal"
                                  className="ml-auto h-8 w-24 text-right"
                                  title={`${RATE_KIND_LABELS[kind]} ${role.label} ${c.label}`}
                                  onChange={(v) =>
                                    setRates((rs) => ({
                                      ...rs,
                                      [row.id]: { ...draft, ...rs[row.id], [c.field]: v },
                                    }))
                                  }
                                />
                              ) : (
                                <span className="ml-auto block w-24 text-right text-muted-foreground">
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Material markup %</Label>
                <NumberField
                  value={s.markup_pct}
                  max={1000}
                  step="0.1"
                  inputMode="decimal"
                  onChange={(v) => setS2("markup_pct", v)}
                />
                <p className="text-xs text-muted-foreground">
                  Materials bill at cost × (1 + markup): 75 % bills a $10 part at $17.50.
                </p>
              </div>
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
                  On the taxable lines of new invoices; a tax-exempt customer gets 0.
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

            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
