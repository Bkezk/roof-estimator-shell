/**
 * /care, "Roof Care plans": the public page the printed QR code opens, with no sign-in (Roof Care
 * step 4; owner, Nov 20: "id like the public page to mimic that sign up process and style"). The
 * same steps as the sign-up pop-up, for a visitor on their own phone, in the flyer's look:
 *
 *   1. your building (address, name, the roof's size or a size range, several buildings);
 *   2. the three plans, with THIS building's yearly prices. No price shows until the address has
 *      been sent (owner, Nov 18: "hides the prices until the address is typed");
 *   3. about you, and how you would like to pay (nobody is charged on this page);
 *   4. the terms, the same ten as the sign-up, a tick and the typed name as the signature.
 *
 * What is sent lands with the office to be matched to a customer; the page never says whether
 * the visitor already is one. The rules of what is still needed are lib/public-pages.ts.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { usePublicApi } from "@/components/public/api";
import {
  PublicButton,
  PublicChoice,
  PublicField,
  PublicSheet,
  PublicTextArea,
  PublicSampleLine,
  PublicThanks,
  RobotTrap,
} from "@/components/public/fields";
import { FlyerPlan, FlyerStepHead } from "@/components/roof-care/flyer-look";
import {
  PUBLIC_SIZE_RANGES,
  PUBLIC_TOO_MANY,
  type PublicPlanKey,
  type PublicQuote,
  type PublicQuoteAsk,
  type PublicSizeRange,
} from "@/lib/public-forms";
import {
  CARE_PAGE_TITLE,
  CUSTOM_QUOTE_LINE,
  NOBODY_CHARGED,
  NOT_FOUND_LINE,
  PRICE_IS_ESTIMATE,
  PUBLIC_COMPANY,
  SEND_FAILED_LINE,
  SEVERAL_BUILDINGS_LINE,
  WHAT_HAPPENS_NEXT,
  buildingProblems,
  careMissing,
  careRequest,
  contactProblems,
  missingLine,
  offerPriceWords,
  priceSizeLine,
  quoteAsk,
  quoteHasPrices,
  sameAsk,
  type CareAnswers,
  type CareBuilding,
} from "@/lib/public-pages";
import {
  AGREE_WORDS,
  PAY_CARD_NOTE_CUSTOMER,
  PAY_CHECK_NOTE_CUSTOMER,
  PAY_QUESTION,
  PLAN_FOOTNOTES,
  PLAN_PITCH,
  PLAN_RECOMMENDED,
  PRICE_PAID_FIRST,
  RECOMMENDED_WORDS,
  SIGN_UP_LEAD,
  planIncludes,
} from "@/lib/roof-care-benefits";
import { ROOF_CARE_TERMS, ROOF_CARE_TERMS_VERSION } from "@/lib/roof-care-plan";
import { PLAN_KEYS, PLAN_NAMES } from "@/lib/roof-care-price";
import { roughPlaceLine } from "@/lib/roof-care-locate";

/** Under a plan before the address has been sent. */
export const PRICE_AFTER_ADDRESS = "Your price shows once we have your building's address";

const errWords = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function PublicCarePage() {
  const api = usePublicApi();
  const opened = useRef(Date.now());
  const [building, setBuilding] = useState<CareBuilding>({
    address: "",
    city: "",
    state: "KY",
    zip: "",
    building_name: "",
    sqft: "",
    size_range: null,
    several_buildings: false,
  });
  const [tried, setTried] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ ask: PublicQuoteAsk; quote: PublicQuote } | null>(null);
  const [plan, setPlan] = useState<PublicPlanKey | null>(null);
  const [contact, setContact] = useState({ contact_name: "", company: "", phone: "", email: "" });
  const [referredBy, setReferredBy] = useState("");
  const [payMethod, setPayMethod] = useState<"check" | "card" | null>(null);
  const [notes, setNotes] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [agreedBy, setAgreedBy] = useState("");
  const [website, setWebsite] = useState("");
  const [sentSample, setSentSample] = useState(false);
  const [triedSend, setTriedSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const busy = useRef(false);
  const plansRef = useRef<HTMLDivElement>(null);

  const problems = buildingProblems(building);
  // The prices belong to the building they were asked for: change the building and they go.
  const quote = answer && sameAsk(answer.ask, quoteAsk(building)) ? answer.quote : null;
  const priced = quoteHasPrices(quote);
  useEffect(() => {
    if (!priced) setPlan(null);
  }, [priced]);

  const set = <K extends keyof CareBuilding>(k: K, v: CareBuilding[K]) =>
    setBuilding((b) => ({ ...b, [k]: v }));

  async function showPrice() {
    setTried(true);
    if (Object.keys(problems).length > 0 || busy.current) return;
    busy.current = true;
    setAsking(true);
    setAskError(null);
    const ask = quoteAsk(building);
    try {
      const q = await api.quote({ data: ask });
      setAnswer({ ask, quote: q });
      // Bring the prices into view: on a phone they are below the fold.
      setTimeout(
        () => plansRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        50,
      );
    } catch (e) {
      const words = errWords(e);
      setAskError(words.includes(PUBLIC_TOO_MANY) ? PUBLIC_TOO_MANY : SEND_FAILED_LINE);
    } finally {
      busy.current = false;
      setAsking(false);
    }
  }

  const answers: CareAnswers = {
    building,
    quote,
    plan,
    contact,
    pay_method: payMethod,
    referred_by: referredBy,
    notes,
    agreed,
    agreed_by: agreedBy,
  };
  const missing = careMissing(answers);
  const contactBad = triedSend ? contactProblems(contact) : {};

  async function send() {
    setTriedSend(true);
    setTried(true);
    const data = careRequest(answers, {
      terms_version: ROOF_CARE_TERMS_VERSION,
      website,
      open_ms: Date.now() - opened.current,
    });
    // The second of two presses in the same instant is dropped: one request, one answer.
    if (!data || busy.current) return;
    busy.current = true;
    setSending(true);
    setSendError(null);
    try {
      const r = await api.sendCare({ data });
      setSentSample(r.sample === true);
      setSent(r.reference);
      window.scrollTo({ top: 0 });
    } catch (e) {
      const words = errWords(e);
      setSendError(words.includes(PUBLIC_TOO_MANY) ? PUBLIC_TOO_MANY : SEND_FAILED_LINE);
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  if (sent)
    return (
      <PublicSheet
        title={CARE_PAGE_TITLE}
        lead={SIGN_UP_LEAD}
        footTitle="Thank you"
        data-public-page="care"
      >
        <PublicThanks reference={sent} title="We have your request" sample={sentSample}>
          <div className="space-y-2">
            <p className="text-base font-bold text-[var(--flyer-ink)]">What happens next</p>
            <ol
              className="list-decimal space-y-1 pl-5 text-base text-[var(--flyer-ink)]"
              data-public="next"
            >
              {WHAT_HAPPENS_NEXT.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ol>
          </div>
        </PublicThanks>
      </PublicSheet>
    );

  const show = (k: keyof typeof problems) => (tried ? (problems[k] ?? null) : null);
  const offerOf = (k: PublicPlanKey) =>
    priced ? quote!.plans.find((o) => o.plan === k) : undefined;
  const sizeLine = priceSizeLine(quote, answer?.ask ?? null);

  return (
    <PublicSheet
      title={CARE_PAGE_TITLE}
      lead={SIGN_UP_LEAD}
      footTitle="Get your plan price"
      data-public-page="care"
    >
      <form
        className="space-y-9"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <RobotTrap value={website} onChange={setWebsite} />

        <section className="space-y-4" data-public-step={1}>
          <FlyerStepHead n={1} title="Your building" />
          <div className="grid gap-4 sm:grid-cols-6">
            <PublicField
              id="address"
              label="Street address of the building"
              className="sm:col-span-6"
              autoComplete="street-address"
              value={building.address}
              onChange={(e) => set("address", e.target.value)}
              problem={show("address")}
            />
            <PublicField
              id="city"
              label="City"
              className="sm:col-span-3"
              autoComplete="address-level2"
              value={building.city}
              onChange={(e) => set("city", e.target.value)}
              problem={show("city")}
            />
            <PublicField
              id="state"
              label="State"
              className="sm:col-span-1"
              autoComplete="address-level1"
              autoCapitalize="characters"
              maxLength={2}
              value={building.state}
              onChange={(e) => set("state", e.target.value)}
              problem={show("state")}
            />
            <PublicField
              id="zip"
              label="Zip"
              className="sm:col-span-2"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={10}
              value={building.zip}
              onChange={(e) => set("zip", e.target.value)}
              problem={show("zip")}
            />
            <PublicField
              id="building_name"
              label="Name of the building"
              optional
              className="sm:col-span-6"
              autoComplete="off"
              value={building.building_name}
              onChange={(e) => set("building_name", e.target.value)}
            />
          </div>
          <div className="space-y-2" data-public="size">
            <PublicField
              id="sqft"
              label="Roof size in square feet, if you know it"
              inputMode="numeric"
              autoComplete="off"
              className="sm:max-w-xs"
              value={building.sqft}
              onChange={(e) => set("sqft", e.target.value)}
            />
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-[var(--flyer-ink)]">
                Not sure? Pick the closest size
              </legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {PUBLIC_SIZE_RANGES.map((r) => (
                  <PublicChoice
                    key={r.key}
                    id={`size-${r.key}`}
                    name="size_range"
                    type="radio"
                    checked={building.size_range === r.key && !building.sqft.trim()}
                    onChange={() =>
                      setBuilding((b) => ({ ...b, sqft: "", size_range: r.key as PublicSizeRange }))
                    }
                  >
                    {r.label}
                  </PublicChoice>
                ))}
              </div>
            </fieldset>
            {show("size") && (
              <p className="text-sm font-medium text-[var(--pub-bad)]" data-problem="size">
                {show("size")}
              </p>
            )}
          </div>
          <PublicChoice
            id="several_buildings"
            type="checkbox"
            checked={building.several_buildings}
            onChange={(on) => set("several_buildings", on)}
          >
            I have several buildings
          </PublicChoice>
          {building.several_buildings && (
            <p className="text-sm text-[var(--flyer-ink)]" data-public="several">
              {SEVERAL_BUILDINGS_LINE}
            </p>
          )}
          <div className="space-y-2">
            <PublicButton
              onClick={() => void showPrice()}
              disabled={asking}
              data-action="public-price"
            >
              {asking && <Loader2 className="h-5 w-5 animate-spin" />}
              Show my price
            </PublicButton>
            {askError && (
              <p
                className="text-sm font-medium text-[var(--pub-bad)]"
                role="alert"
                data-public="ask-error"
              >
                {askError}
              </p>
            )}
            {answer && !quote && (
              <p className="text-sm font-medium text-[var(--pub-warn)]" data-public="stale">
                The building changed. Press Show my price again.
              </p>
            )}
          </div>
        </section>

        <section className="space-y-4 scroll-mt-4" data-public-step={2} ref={plansRef}>
          <FlyerStepHead n={2} title="Pick your plan" />
          {quote?.sample && <PublicSampleLine />}
          {quote && !quote.found && (
            <p
              className="text-base font-medium text-[var(--pub-bad)]"
              role="alert"
              data-public="not-found"
            >
              {NOT_FOUND_LINE}
            </p>
          )}
          {quote?.found && quote.custom_quote && (
            <p className="text-base font-medium text-[var(--flyer-ink)]" data-public="custom">
              {CUSTOM_QUOTE_LINE}
            </p>
          )}
          {quote?.found && quote.rough && (
            <p className="text-sm font-medium text-[var(--pub-warn)]" data-public="rough">
              {roughPlaceLine(quote.place)}
            </p>
          )}
          <div className="grid gap-y-5 sm:grid-cols-3" data-plan-cards>
            {PLAN_KEYS.map((k) => {
              const o = offerOf(k);
              const picked = plan === k && !!o;
              return (
                <FlyerPlan
                  key={k}
                  planKey={k}
                  disabled={!o}
                  onClick={() => setPlan(k)}
                  data-plan-offer={o ? k : undefined}
                  name={o?.name ?? PLAN_NAMES[k]}
                  promise={PLAN_PITCH[k]}
                  price={o ? offerPriceWords(o) : null}
                  waiting={PRICE_AFTER_ADDRESS}
                  lines={planIncludes(k, o?.benefits ?? null)}
                  recommended={k === PLAN_RECOMMENDED ? RECOMMENDED_WORDS : null}
                  picked={picked}
                  action={o ? (picked ? "Selected" : `Choose ${o.name}`) : null}
                />
              );
            })}
          </div>
          <div className="space-y-0.5 text-xs text-[var(--flyer-soft)]" data-plan-footnotes>
            {priced && sizeLine && (
              <p className="text-sm font-semibold text-[var(--flyer-ink)]" data-public="price-size">
                {sizeLine}
              </p>
            )}
            {priced && (
              <p className="text-sm font-semibold text-[var(--flyer-ink)]">{PRICE_IS_ESTIMATE}</p>
            )}
            <p>{PRICE_PAID_FIRST}.</p>
            {PLAN_FOOTNOTES.map((f) => (
              <p key={f}>{f}</p>
            ))}
          </div>
        </section>

        {quote?.found && (
          <>
            <section className="space-y-4" data-public-step={3}>
              <FlyerStepHead n={3} title="About you" />
              <div className="grid gap-4 sm:grid-cols-2">
                <PublicField
                  id="contact_name"
                  label="Your name"
                  autoComplete="name"
                  value={contact.contact_name}
                  onChange={(e) => setContact((c) => ({ ...c, contact_name: e.target.value }))}
                  problem={contactBad.contact_name}
                />
                <PublicField
                  id="company"
                  label="Company"
                  optional
                  autoComplete="organization"
                  value={contact.company}
                  onChange={(e) => setContact((c) => ({ ...c, company: e.target.value }))}
                />
                <PublicField
                  id="phone"
                  label="Phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={contact.phone}
                  onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
                  problem={contactBad.phone}
                />
                <PublicField
                  id="email"
                  label="Email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  value={contact.email}
                  onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
                  problem={contactBad.email}
                  hint="Your agreement and receipt are sent here."
                />
                <PublicField
                  id="referred_by"
                  label="Who referred you?"
                  optional
                  autoComplete="off"
                  className="sm:col-span-2"
                  value={referredBy}
                  onChange={(e) => setReferredBy(e.target.value)}
                />
              </div>
              {priced && (
                <fieldset className="space-y-2" data-public="pay">
                  <legend className="text-sm font-semibold text-[var(--flyer-ink)]">
                    {PAY_QUESTION}
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <PublicChoice
                      id="pay-check"
                      name="pay_method"
                      type="radio"
                      checked={payMethod === "check"}
                      onChange={() => setPayMethod("check")}
                    >
                      Check
                    </PublicChoice>
                    <PublicChoice
                      id="pay-card"
                      name="pay_method"
                      type="radio"
                      checked={payMethod === "card"}
                      onChange={() => setPayMethod("card")}
                    >
                      Card
                    </PublicChoice>
                  </div>
                  <p className="text-sm text-[var(--flyer-ink)]" data-public="nobody-charged">
                    {NOBODY_CHARGED}
                  </p>
                  {payMethod && (
                    <p className="text-xs text-[var(--flyer-soft)]" data-public="pay-note">
                      {payMethod === "card" ? PAY_CARD_NOTE_CUSTOMER : PAY_CHECK_NOTE_CUSTOMER}
                    </p>
                  )}
                </fieldset>
              )}
              <PublicTextArea
                id="notes"
                label="Anything we should know?"
                optional
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </section>

            {priced && (
              <section className="space-y-4" data-public-step={4}>
                <FlyerStepHead n={4} title="Your agreement" />
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-[var(--flyer-ink)]">
                    The terms of your plan
                  </p>
                  <ol
                    className="list-decimal space-y-1.5 rounded-md border border-[var(--pub-line)] bg-[var(--pub-paper)] py-3 pl-8 pr-3 text-sm text-[var(--flyer-ink)]"
                    data-public="terms"
                  >
                    {ROOF_CARE_TERMS.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ol>
                </div>
                <PublicChoice id="agreed" type="checkbox" checked={agreed} onChange={setAgreed}>
                  {AGREE_WORDS}
                </PublicChoice>
                <PublicField
                  id="agreed_by"
                  label="Type your full name as your signature"
                  autoComplete="name"
                  className="sm:max-w-md"
                  value={agreedBy}
                  onChange={(e) => setAgreedBy(e.target.value)}
                />
              </section>
            )}

            <section className="space-y-2" data-public="send">
              {priced && plan && (
                <p className="text-base text-[var(--flyer-ink)]" data-public="picked">
                  <b>{offerOf(plan)?.name}</b>: {offerPriceWords(offerOf(plan)!)} per year, an
                  estimate until we measure your roof.
                </p>
              )}
              <PublicButton
                onClick={() => void send()}
                disabled={sending}
                data-action="public-send"
              >
                {sending && <Loader2 className="h-5 w-5 animate-spin" />}
                {priced ? "Agree and send my request" : "Send my request"}
              </PublicButton>
              {missing.length > 0 && triedSend && (
                <p
                  className="text-sm font-medium text-[var(--pub-bad)]"
                  role="alert"
                  data-public="missing"
                >
                  {missingLine(missing)}
                </p>
              )}
              {missing.length > 0 && !triedSend && (
                <p className="text-sm text-[var(--flyer-soft)]" data-public="missing">
                  {missingLine(missing)}
                </p>
              )}
              {sendError && (
                <p
                  className="text-sm font-medium text-[var(--pub-bad)]"
                  role="alert"
                  data-public="send-error"
                >
                  {sendError}
                </p>
              )}
              <p className="text-xs text-[var(--flyer-soft)]">
                We use what you send only to answer you about your roof. Prefer to talk? Call{" "}
                {PUBLIC_COMPANY.phone}.
              </p>
            </section>
          </>
        )}
      </form>
    </PublicSheet>
  );
}
