/**
 * /request, "Request service": the second public page the printed QR codes open, with no sign-in
 * (Roof Care step 4; owner, Nov 18: "everything needed to make an opportunity, and tick boxes
 * for the services wanted, more than one allowed"). The flyer's look, for a visitor on a phone.
 * The services to tick come from the office's own list; what is sent lands with the office. The
 * rules of what is still needed are lib/public-pages.ts.
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
  PublicThanks,
  RobotTrap,
} from "@/components/public/fields";
import { FlyerStepHead } from "@/components/roof-care/flyer-look";
import { publicSayLine } from "@/lib/public-forms";
import {
  PUBLIC_COMPANY,
  REQUEST_PAGE_LEAD,
  REQUEST_PAGE_TITLE,
  SEND_FAILED_LINE,
  addressProblems,
  adoptService,
  adoptTrap,
  contactProblems,
  missingLine,
  serviceMissing,
  serviceRequest,
  typedBoxes,
  type ServiceAnswers,
} from "@/lib/public-pages";

const errWords = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function PublicRequestPage() {
  const api = usePublicApi();
  const opened = useRef(Date.now());
  // The office's list of services. If it cannot be read the page still works: the text box
  // says what is wanted.
  const [choices, setChoices] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    api
      .services()
      .then((r) => live && setChoices(r.services))
      .catch(() => live && setChoices([]));
    return () => {
      live = false;
    };
  }, [api]);
  const [a, setA] = useState<ServiceAnswers>({
    address: "",
    city: "",
    state: "KY",
    zip: "",
    building_name: "",
    services: [],
    details: "",
    contact: { contact_name: "", company: "", phone: "", email: "" },
    referred_by: "",
  });
  const [website, setWebsite] = useState("");
  const [sentSample, setSentSample] = useState(false);
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const busy = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Nov 24: what was typed while the page was still loading is in the boxes, and the page did
  // not know it. Read once the script is ready (and again at the press of Send, below).
  useEffect(() => {
    const boxes = typedBoxes(formRef.current);
    setA((x) => adoptService(x, boxes, []));
    setWebsite((x) => adoptTrap(x, boxes));
  }, []);

  const missing = serviceMissing(a, choices);
  const addr = tried ? addressProblems(a) : {};
  const who = tried ? contactProblems(a.contact) : {};
  const set = <K extends keyof ServiceAnswers>(k: K, v: ServiceAnswers[K]) =>
    setA((x) => ({ ...x, [k]: v }));
  const setContact = (k: keyof ServiceAnswers["contact"], v: string) =>
    setA((x) => ({ ...x, contact: { ...x.contact, [k]: v } }));

  async function send() {
    setTried(true);
    // The boxes themselves are what is sent: a browser can fill them in without telling the page.
    const boxes = typedBoxes(formRef.current);
    const now = adoptService(a, boxes, choices);
    if (now !== a) setA(now);
    const trap = adoptTrap(website, boxes);
    if (trap !== website) setWebsite(trap);
    const data = serviceRequest(now, choices, {
      website: trap,
      open_ms: Date.now() - opened.current,
    });
    // The second of two presses in the same instant is dropped: one request, one answer.
    if (!data || busy.current) return;
    busy.current = true;
    setSending(true);
    setSendError(null);
    try {
      const r = await api.sendService({ data });
      setSentSample(r.sample === true);
      setSent(r.reference);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setSendError(publicSayLine(errWords(e)) ?? SEND_FAILED_LINE);
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  if (sent)
    return (
      <PublicSheet
        title={REQUEST_PAGE_TITLE}
        lead={REQUEST_PAGE_LEAD}
        footTitle="Thank you"
        data-public-page="request"
      >
        <PublicThanks reference={sent} title="We have your request" sample={sentSample}>
          <p className="text-base text-[var(--flyer-ink)]" data-public="next">
            We will call you at the number you gave to set up a visit.
          </p>
        </PublicThanks>
      </PublicSheet>
    );

  return (
    <PublicSheet
      title={REQUEST_PAGE_TITLE}
      lead={REQUEST_PAGE_LEAD}
      footTitle="Need us right away?"
      data-public-page="request"
    >
      <form ref={formRef} className="space-y-9" noValidate onSubmit={(e) => e.preventDefault()}>
        <RobotTrap value={website} onChange={setWebsite} />

        <section className="space-y-4" data-public-step={1}>
          <FlyerStepHead n={1} title="What do you need?" />
          {choices.length > 0 && (
            <fieldset className="space-y-2" data-public="services">
              <legend className="text-sm font-semibold text-[var(--flyer-ink)]">
                Tick everything that applies
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {choices.map((s, i) => (
                  <PublicChoice
                    key={s}
                    id={`service-${i}`}
                    name="services"
                    type="checkbox"
                    checked={a.services.includes(s)}
                    onChange={(on) =>
                      set("services", on ? [...a.services, s] : a.services.filter((x) => x !== s))
                    }
                  >
                    {s}
                  </PublicChoice>
                ))}
              </div>
            </fieldset>
          )}
          <PublicTextArea
            id="details"
            label="What is going on?"
            optional={choices.length > 0}
            value={a.details}
            onChange={(e) => set("details", e.target.value)}
          />
        </section>

        <section className="space-y-4" data-public-step={2}>
          <FlyerStepHead n={2} title="The building" />
          <div className="grid gap-4 sm:grid-cols-6">
            <PublicField
              id="address"
              label="Street address of the building"
              className="sm:col-span-6"
              autoComplete="street-address"
              value={a.address}
              onChange={(e) => set("address", e.target.value)}
              problem={addr.address}
            />
            <PublicField
              id="city"
              label="City"
              className="sm:col-span-3"
              autoComplete="address-level2"
              value={a.city}
              onChange={(e) => set("city", e.target.value)}
              problem={addr.city}
            />
            <PublicField
              id="state"
              label="State"
              className="sm:col-span-1"
              autoComplete="address-level1"
              autoCapitalize="characters"
              maxLength={2}
              value={a.state}
              onChange={(e) => set("state", e.target.value)}
              problem={addr.state}
            />
            <PublicField
              id="zip"
              label="Zip"
              className="sm:col-span-2"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={10}
              value={a.zip}
              onChange={(e) => set("zip", e.target.value)}
              problem={addr.zip}
            />
            <PublicField
              id="building_name"
              label="Name of the building"
              optional
              className="sm:col-span-6"
              autoComplete="off"
              value={a.building_name}
              onChange={(e) => set("building_name", e.target.value)}
            />
          </div>
        </section>

        <section className="space-y-4" data-public-step={3}>
          <FlyerStepHead n={3} title="About you" />
          <div className="grid gap-4 sm:grid-cols-2">
            <PublicField
              id="contact_name"
              label="Your name"
              autoComplete="name"
              value={a.contact.contact_name}
              onChange={(e) => setContact("contact_name", e.target.value)}
              problem={who.contact_name}
            />
            <PublicField
              id="company"
              label="Company"
              optional
              autoComplete="organization"
              value={a.contact.company}
              onChange={(e) => setContact("company", e.target.value)}
            />
            <PublicField
              id="phone"
              label="Phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={a.contact.phone}
              onChange={(e) => setContact("phone", e.target.value)}
              problem={who.phone}
            />
            <PublicField
              id="email"
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              value={a.contact.email}
              onChange={(e) => setContact("email", e.target.value)}
              problem={who.email}
            />
            <PublicField
              id="referred_by"
              label="Who referred you?"
              optional
              autoComplete="off"
              className="sm:col-span-2"
              value={a.referred_by}
              onChange={(e) => set("referred_by", e.target.value)}
            />
          </div>
        </section>

        <section className="space-y-2" data-public="send">
          <PublicButton onClick={() => void send()} disabled={sending} data-action="public-send">
            {sending && <Loader2 className="h-5 w-5 animate-spin" />}
            Send my request
          </PublicButton>
          {missing.length > 0 && (
            <p
              className={`text-sm ${tried ? "font-medium text-[var(--pub-bad)]" : "text-[var(--flyer-soft)]"}`}
              role={tried ? "alert" : undefined}
              data-public="missing"
            >
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
            We use what you send only to answer you about your roof. A leak right now? Call{" "}
            {PUBLIC_COMPANY.phone}.
          </p>
        </section>
      </form>
    </PublicSheet>
  );
}
