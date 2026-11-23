/**
 * The Care plans tab on the Customers page (`/customers?tab=care`; owner, Nov 23: "add a care
 * plan tab that shows the customers that have a plan, which plan they have, their reference
 * number they get when they sign up, their price, and any other pertinent details").
 *
 * A list to read and to find a plan in. Nothing is changed here: a row opens the property's
 * page, where the plan is signed, paid, renewed and ended. Rules: lib/care-plan-list.ts.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  CARE_PLANS_NONE,
  CARE_PLANS_NONE_SHOWN,
  CARE_PLAN_SHOWS,
  CARE_PLAN_SHOW_WORDS,
  CARE_PLAN_STATE_WORDS,
  carePlanCreditWords,
  carePlanListKey,
  carePlanRenewsWords,
  carePlanTotalsWords,
  filterCarePlans,
  type CarePlanRow,
  type CarePlanShow,
  type CarePlanState,
} from "@/lib/care-plan-list";
import { listCarePlans } from "@/lib/care-plan-list.functions";
import { easternYmd } from "@/lib/field-day";
import { longDay } from "@/lib/followup-rules";
import { PAY_METHOD_WORDS, planName } from "@/lib/roof-care-plan";
import { money0 } from "@/lib/roof-care-price";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const STATE_LOOK: Record<CarePlanState, string> = {
  active: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  waiting: "border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  expired: "border-border bg-muted text-muted-foreground",
  ended: "border-border bg-muted text-muted-foreground",
};

function StateBadge({ state }: { state: CarePlanState }) {
  return (
    <Badge
      variant="outline"
      className={`whitespace-nowrap px-1.5 py-0 text-[11px] font-medium ${STATE_LOOK[state]}`}
      data-care-plan-state={state}
    >
      {CARE_PLAN_STATE_WORDS[state]}
    </Badge>
  );
}

/** The plan's name, with "renewal" when it carries on from last year's. */
const planWords = (r: CarePlanRow) => `${planName(r.plan)}${r.renewal ? " (renewal)" : ""}`;
const priceWords = (r: CarePlanRow) => `${money0(r.price)} a year`;
const sizeWords = (r: CarePlanRow) =>
  r.roof_sqft > 0 ? `${Math.round(r.roof_sqft).toLocaleString("en-US")} sq ft` : "";
/** Under the price: how it is paid, and what the plan includes in repairs. */
const payWords = (r: CarePlanRow) =>
  [
    r.pay_method ? `By ${PAY_METHOD_WORDS[r.pay_method].toLowerCase()}` : "",
    r.starts_on ? `paid ${longDay(r.starts_on)}` : "",
  ]
    .filter(Boolean)
    .join(", ");
const inspectionWords = (r: CarePlanRow) =>
  r.state === "active"
    ? r.next_inspection
      ? `${r.next_inspection}${r.next_late ? " (late)" : ""}`
      : `${r.inspections_done} of 2 done`
    : "";

export function CarePlansSection() {
  const fn = useServerFn(listCarePlans);
  const list = useQuery({ queryKey: carePlanListKey, queryFn: () => fn(), staleTime: 60_000 });
  const [show, setShow] = useState<CarePlanShow>("current");
  const [search, setSearch] = useState("");
  const today = easternYmd();
  const all = list.data ?? [];
  const rows = filterCarePlans(all, show, search);

  return (
    <div className="space-y-3" data-care-plans>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          placeholder="Search customer, property, plan or number…"
          aria-label="Search care plans"
          value={search}
          className="min-w-0 flex-1 sm:max-w-sm"
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Which plans to show">
          {CARE_PLAN_SHOWS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={show === s}
              data-care-plan-show={s}
              onClick={() => setShow(s)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                show === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {CARE_PLAN_SHOW_WORDS[s]}
            </button>
          ))}
        </div>
      </div>
      {list.data && all.length > 0 && (
        <p className="text-sm font-medium" data-care-plan-totals>
          {carePlanTotalsWords(all)}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Roof Care plans, one row for each plan. Open the property to sign, renew or end a plan.
      </p>

      {list.error ? (
        <p className="text-sm text-destructive">
          Could not load the care plans ({errText(list.error)}). Try refreshing, or sign in again.
        </p>
      ) : list.isLoading || !list.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading care plans…
        </p>
      ) : all.length === 0 ? (
        <p
          className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
          data-care-plans-none
        >
          {CARE_PLANS_NONE}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{CARE_PLANS_NONE_SHOWN}</p>
      ) : (
        <>
          {/* A computer: one line for each plan. */}
          <div className="hidden rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Customer and property</th>
                  <th className="px-3 py-2 font-medium">Plan</th>
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-3 py-2 font-medium">Price</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Renews</th>
                  <th className="px-3 py-2 font-medium">Next inspection</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const renews = carePlanRenewsWords(r, today);
                  const credit = carePlanCreditWords(r);
                  return (
                    <tr
                      key={r.id}
                      className="border-b align-top last:border-0"
                      data-care-plan-row={r.id}
                    >
                      <td className="px-3 py-2">
                        <Link
                          to="/customers/$id"
                          params={{ id: r.account_id }}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {r.account_name || "Customer"}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          <Link
                            to="/properties/$id"
                            params={{ id: r.site_id }}
                            className="underline-offset-2 hover:underline"
                          >
                            {r.site_name || "Property"}
                          </Link>
                          {r.site_place ? `, ${r.site_place}` : ""}
                        </div>
                        {credit && <div className="text-xs text-muted-foreground">{credit}</div>}
                      </td>
                      <td className="px-3 py-2">
                        {planWords(r)}
                        <div className="text-xs text-muted-foreground">{sizeWords(r)}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium" data-care-plan-number>
                        {r.number || "None"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="whitespace-nowrap" data-care-plan-price>
                          {priceWords(r)}
                        </span>
                        <div className="text-xs text-muted-foreground">{payWords(r)}</div>
                        {r.repair_allowance > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {money0(r.repair_allowance)} of minor repairs included
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StateBadge state={r.state} />
                        {r.state === "ended" && r.ended_reason && (
                          <div className="text-xs text-muted-foreground">{r.ended_reason}</div>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2 ${renews.soon ? "font-medium text-amber-700 dark:text-amber-300" : ""}`}
                      >
                        {renews.text}
                      </td>
                      <td className={`px-3 py-2 ${r.next_late ? "text-destructive" : ""}`}>
                        {inspectionWords(r)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* A phone: one card for each plan, nothing to scroll sideways. */}
          <ul className="space-y-2 md:hidden">
            {rows.map((r) => {
              const renews = carePlanRenewsWords(r, today);
              const credit = carePlanCreditWords(r);
              const inspection = inspectionWords(r);
              return (
                <li
                  key={r.id}
                  className="space-y-1 rounded-lg border p-3 text-sm"
                  data-care-plan-card={r.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link
                      to="/customers/$id"
                      params={{ id: r.account_id }}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {r.account_name || "Customer"}
                    </Link>
                    <StateBadge state={r.state} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <Link
                      to="/properties/$id"
                      params={{ id: r.site_id }}
                      className="underline underline-offset-2"
                    >
                      {r.site_name || "Property"}
                    </Link>
                    {r.site_place ? `, ${r.site_place}` : ""}
                  </div>
                  <p>
                    <span className="font-medium">{planWords(r)}</span>
                    {r.number ? `, ${r.number}` : ""}, {priceWords(r)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[sizeWords(r), payWords(r)].filter(Boolean).join(". ")}
                  </p>
                  <p
                    className={renews.soon ? "font-medium text-amber-700 dark:text-amber-300" : ""}
                  >
                    {r.state === "active" ? `Renews ${renews.text}` : renews.text}
                  </p>
                  {inspection && (
                    <p className={r.next_late ? "text-destructive" : ""}>
                      Next inspection: {inspection}
                    </p>
                  )}
                  {credit && <p className="text-xs text-muted-foreground">{credit}</p>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
