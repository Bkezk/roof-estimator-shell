/**
 * The printed leave-behind, drawn (owner, Nov 25, 2026; lib/leave-behind.ts has the words):
 * one sheet of letter paper, the Roof Care plans on the front and the additional services on
 * the back, in the look of his own flyer, each side with its QR code and never a price.
 *
 * It is drawn twice on Setup › QR pages:
 *
 *  - small, in the card, so the office sees what will come out of the printer;
 *  - at full size, straight under the page's body, shown only to the printer. In print
 *    everything else on the page is taken away, so the paper holds the two sides and nothing
 *    more, whatever the menu and the rest of the page are doing.
 *
 * Every size is in inches and points, so it prints the same whatever the site's text size is
 * set to, and its colours are its own, so the dark theme does not reach the paper.
 *
 * A side that is fuller than usual (a longer services list, long names, a plan with more lines)
 * is set a little smaller, a step at a time, until it fits: the page measures the small copy and
 * both copies take the step. When the smallest step is still too full, the page says so.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff2?url";
import inter700 from "@fontsource/inter/files/inter-latin-700-normal.woff2?url";

import {
  SHEET_BACK_FOOT,
  SHEET_BACK_LEAD,
  SHEET_BACK_TITLE,
  SHEET_FRONT_FOOT,
  SHEET_FRONT_LEAD,
  SHEET_FRONT_NOTE,
  SHEET_FRONT_TITLE,
  SHEET_FIT_MAX,
  SHEET_STEPS,
  SHEET_TOO_FULL,
  sheetPlans,
  sheetServices,
} from "@/lib/leave-behind";
import { PUBLIC_COMPANY } from "@/lib/public-pages";
import { qrSvg } from "@/lib/qr";
import { RECOMMENDED_WORDS, type BenefitNumbers } from "@/lib/roof-care-benefits";
import { EMAIL_MAST_LINE } from "@/lib/roof-care-email-look";

/** Where the full-size copy for the printer hangs, straight under the page's body. */
export const LEAVE_BEHIND_PRINT_ID = "leave-behind-print";

/**
 * The sheet's own style. The body face is the flyer's (Inter), under a name of its own so
 * nothing else on the site picks it up; the headline face is the site's flyer face.
 */
export const LEAVE_BEHIND_CSS = `
@font-face { font-family: "JBK Sheet"; font-weight: 400; src: url(${inter400}) format("woff2"); }
@font-face { font-family: "JBK Sheet"; font-weight: 600; src: url(${inter600}) format("woff2"); }
@font-face { font-family: "JBK Sheet"; font-weight: 700; src: url(${inter700}) format("woff2"); }
@page { size: 8.5in 11in; margin: 0; }
.lb-page { --lb-green: #7eaf28; --lb-blue: #014b96; --lb-ink: #15171b; --lb-rule: #23262c;
  width: 8.5in; height: 11in; display: flex; flex-direction: column; overflow: hidden;
  background: #fff; color: var(--lb-ink); text-align: left;
  font-family: "JBK Sheet", Inter, Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.4;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  --lb-li: 10.6pt; --lb-li-gap: 0.125in; --lb-pitch: 10.4pt; --lb-svc-pad: 0.14in;
  --lb-svc-name: 19pt; --lb-svc-p: 10.2pt; --lb-svc-sq: 0.06in; }
.lb-fit-1 { --lb-li: 10pt; --lb-li-gap: 0.09in; --lb-pitch: 10pt; --lb-svc-pad: 0.1in;
  --lb-svc-name: 17pt; --lb-svc-p: 9.6pt; --lb-svc-sq: 0.05in; }
.lb-fit-2 { --lb-li: 9.4pt; --lb-li-gap: 0.065in; --lb-pitch: 9.6pt; --lb-svc-pad: 0.07in;
  --lb-svc-name: 15pt; --lb-svc-p: 9pt; --lb-svc-sq: 0.04in; }
.lb-fit-3 { --lb-li: 8.8pt; --lb-li-gap: 0.045in; --lb-pitch: 9.2pt; --lb-svc-pad: 0.05in;
  --lb-svc-name: 13.5pt; --lb-svc-p: 8.4pt; --lb-svc-sq: 0.03in; }
.lb-page * { box-sizing: border-box; margin: 0; padding: 0; }
.lb-head { font-family: "Barlow Condensed", "Arial Narrow", "Roboto Condensed", Arial, sans-serif;
  font-weight: 800; text-transform: uppercase; letter-spacing: 0.005em; line-height: 0.95; }
.lb-mast { height: 1.28in; padding: 0 0.58in; display: flex; align-items: center;
  justify-content: space-between; flex: none; }
.lb-logo { height: 1.02in; width: auto; display: block; }
.lb-mast-right { text-align: right; }
.lb-mast-line { color: var(--lb-blue); font-weight: 700; font-size: 10.5pt; letter-spacing: 0.12em;
  text-transform: uppercase; }
.lb-mast-place { font-weight: 600; font-size: 11.5pt; margin-top: 0.07in; }
.lb-bar { margin: 0 0.06in; font-weight: 400; }
.lb-band { background: var(--lb-green); padding: 0.2in 0.58in; flex: none; }
.lb-band h1 { font-size: 54pt; color: var(--lb-ink); }
.lb-band p { font-size: 12.2pt; line-height: 1.45; margin-top: 0.11in; }
.lb-plans { display: flex; padding: 0.16in 0.58in 0; flex: 1 1 auto; min-height: 0; }
.lb-plan { flex: 1 1 0; padding: 0 0.2in 0.1in; border-left: 1px solid var(--lb-rule); }
.lb-plan:first-child { border-left: 0; padding-left: 0; }
.lb-plan:last-child { padding-right: 0; }
.lb-tag-row { height: 0.23in; }
.lb-tag { display: inline-block; background: var(--lb-green); font-weight: 700; font-size: 7.6pt;
  letter-spacing: 0.14em; text-transform: uppercase; padding: 0.055in 0.09in; }
.lb-plan-name { font-size: 30pt; color: var(--lb-blue); margin-top: 0.03in; }
.lb-pitch { font-weight: 600; font-size: var(--lb-pitch); line-height: 1.38; margin-top: 0.1in;
  min-height: 0.62in; }
.lb-plan ul { list-style: none; margin-top: 0.14in; border-top: 1px solid var(--lb-rule);
  padding-top: 0.2in; }
.lb-plan li { position: relative; padding-left: 0.2in; font-size: var(--lb-li); line-height: 1.36;
  margin-bottom: var(--lb-li-gap); }
.lb-plan li::before { content: ""; position: absolute; left: 0; top: 0.06in; width: 0.07in;
  height: 0.07in; background: var(--lb-green); }
.lb-plan li b, .lb-step b, .lb-notes b { font-weight: 700; }
.lb-notes { padding: 0 0.58in; flex: none; }
.lb-notes p { border-top: 1px solid var(--lb-rule); padding: 0.09in 0 0.13in; font-size: 7.8pt;
  line-height: 1.45; }
.lb-foot { background: var(--lb-blue); color: #fff; padding: 0.26in 0.58in 0.28in; display: flex;
  align-items: center; justify-content: space-between; gap: 0.4in; flex: none; }
.lb-foot-text { flex: 1 1 auto; min-width: 0; }
.lb-foot-h { font-size: 34pt; }
.lb-foot-p { font-size: 11pt; line-height: 1.42; margin-top: 0.1in; }
.lb-foot-contact { margin-top: 0.15in; display: flex; align-items: baseline; flex-wrap: wrap;
  gap: 0.06in 0.24in; }
.lb-foot-phone { font-size: 23pt; }
.lb-foot-mail { font-weight: 700; font-size: 11pt; }
.lb-foot-web { font-size: 10pt; opacity: 0.92; margin-top: 0.04in; }
.lb-qr-wrap { flex: none; width: 2.05in; text-align: center; }
.lb-qr { width: 1.56in; height: 1.56in; background: #fff; padding: 0.05in; border-radius: 0.06in;
  margin: 0 auto; }
.lb-qr svg { width: 100%; height: 100%; display: block; }
.lb-qr-cap { font-size: 12pt; margin-top: 0.08in; letter-spacing: 0.03em; }
.lb-services { display: grid; grid-template-columns: 1fr 1fr; column-gap: 0.44in;
  padding: 0.24in 0.58in 0; flex: 1 1 auto; min-height: 0; align-content: start; }
.lb-service { border-top: 1px solid var(--lb-rule); position: relative;
  padding: var(--lb-svc-pad) 0 calc(var(--lb-svc-pad) + 0.01in) 0.22in; }
.lb-service:nth-child(-n + 2) { border-top: 0; padding-top: 0.04in; }
.lb-service::before { content: ""; position: absolute; left: 0; width: 0.1in; height: 0.1in;
  top: calc(var(--lb-svc-pad) + var(--lb-svc-sq)); background: var(--lb-green); }
.lb-service:nth-child(-n + 2)::before { top: calc(0.05in + var(--lb-svc-sq)); }
.lb-service-name { font-size: var(--lb-svc-name); color: var(--lb-blue); }
.lb-service p { font-size: var(--lb-svc-p); line-height: 1.4; margin-top: 0.06in; }
.lb-steps { display: flex; gap: 0.3in; padding: 0.16in 0 0.2in; flex: none;
  border-top: 1px solid var(--lb-rule); margin: 0 0.58in; }
.lb-step { flex: 1 1 0; display: flex; gap: 0.13in; align-items: flex-start; font-size: 10.2pt;
  line-height: 1.4; }
.lb-num { flex: none; width: 0.36in; height: 0.36in; background: var(--lb-green); display: flex;
  align-items: center; justify-content: center; font-size: 17pt; }

/* On the screen: both sides, small. */
.lb-preview { display: flex; flex-wrap: wrap; gap: 16px; }
.lb-preview .lb-page { zoom: 0.46; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.18); }
@media (max-width: 480px) { .lb-preview .lb-page { zoom: 0.38; } }

/* For the printer: the two sides and nothing else. */
#${LEAVE_BEHIND_PRINT_ID} { display: none; }
@media print {
  html, body { height: auto !important; min-height: 0 !important; overflow: visible !important;
    background: #fff !important; margin: 0 !important; padding: 0 !important; }
  body > *:not(#${LEAVE_BEHIND_PRINT_ID}) { display: none !important; }
  #${LEAVE_BEHIND_PRINT_ID} { display: block !important; }
  #${LEAVE_BEHIND_PRINT_ID} .lb-page { break-after: page; page-break-after: always; }
  #${LEAVE_BEHIND_PRINT_ID} .lb-page:last-child { break-after: auto; page-break-after: auto; }
}`;

export interface LeaveBehindProps {
  /** What the two codes hold: the public pages' saved addresses. */
  careUrl: string;
  requestUrl: string;
  /** What each plan includes today, in numbers; null says it without them. */
  numbers: BenefitNumbers | null;
  /** The services saved for the Request service form, in their order. */
  services: readonly string[];
}

/** How many steps smaller each side is set, 0 to SHEET_FIT_MAX. */
export interface SheetFit {
  front: number;
  back: number;
}

function Mast() {
  return (
    <header className="lb-mast">
      <img className="lb-logo" src="/jbk-logo.webp" alt={PUBLIC_COMPANY.name} />
      <div className="lb-mast-right">
        <div className="lb-mast-line">{EMAIL_MAST_LINE}</div>
        <div className="lb-mast-place">
          Kentucky <span className="lb-bar">|</span> Tennessee
        </div>
      </div>
    </header>
  );
}

function Foot({
  url,
  words,
  side,
}: {
  url: string;
  words: { title: string; line: string; cap: string };
  side: "care" | "request";
}) {
  return (
    <footer className="lb-foot">
      <div className="lb-foot-text">
        <div className="lb-head lb-foot-h">{words.title}</div>
        <p className="lb-foot-p">{words.line}</p>
        <div className="lb-foot-contact">
          <span className="lb-head lb-foot-phone">{PUBLIC_COMPANY.phone}</span>
          <span className="lb-foot-mail">{PUBLIC_COMPANY.email}</span>
        </div>
        <div className="lb-foot-web">{PUBLIC_COMPANY.web}</div>
      </div>
      <div className="lb-qr-wrap">
        <div
          className="lb-qr"
          data-sheet-qr={side}
          data-qr-url={url}
          // The picture is made here from the address alone: lib/qr.ts qrSvg.
          dangerouslySetInnerHTML={{ __html: qrSvg(url, words.cap) }}
        />
        <div className="lb-head lb-qr-cap">{words.cap}</div>
      </div>
    </footer>
  );
}

/** The two sides, at full size: 8.5 by 11 inches each. */
export function LeaveBehindPages({
  careUrl,
  requestUrl,
  numbers,
  services,
  fit,
}: LeaveBehindProps & { fit?: SheetFit }) {
  const step = (n: number | undefined) => (n ? ` lb-fit-${n}` : "");
  const plans = sheetPlans(numbers);
  const list = sheetServices(services);
  return (
    <>
      <section className={`lb-page${step(fit?.front)}`} data-sheet-side="front">
        <Mast />
        <div className="lb-band">
          <h1 className="lb-head">{SHEET_FRONT_TITLE}</h1>
          <p>
            {SHEET_FRONT_LEAD[0]}
            <br />
            {SHEET_FRONT_LEAD[1]}
          </p>
        </div>
        <div className="lb-plans">
          {plans.map((p) => (
            <div className="lb-plan" key={p.key} data-sheet-plan={p.key}>
              <div className="lb-tag-row">
                {p.recommended && <span className="lb-tag">{RECOMMENDED_WORDS}</span>}
              </div>
              <div className="lb-head lb-plan-name">{p.name}</div>
              <p className="lb-pitch">{p.pitch}</p>
              <ul>
                {p.lines.map((l) => (
                  <li key={l.bold + l.rest}>
                    {l.bold && <b>{l.bold}</b>}
                    {l.rest}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="lb-notes">
          <p>
            <b>*</b> {SHEET_FRONT_NOTE.star} <b>†</b> {SHEET_FRONT_NOTE.dagger}{" "}
            {SHEET_FRONT_NOTE.rest}
          </p>
        </div>
        <Foot url={careUrl} words={SHEET_FRONT_FOOT} side="care" />
      </section>
      <section className={`lb-page${step(fit?.back)}`} data-sheet-side="back">
        <Mast />
        <div className="lb-band">
          <h1 className="lb-head">{SHEET_BACK_TITLE}</h1>
          <p>
            {SHEET_BACK_LEAD[0]}
            <br />
            {SHEET_BACK_LEAD[1]}
          </p>
        </div>
        <div className="lb-services">
          {list.map((s) => (
            <div className="lb-service" key={s.title} data-sheet-service>
              <div className="lb-head lb-service-name">{s.title}</div>
              {s.line && <p>{s.line}</p>}
            </div>
          ))}
        </div>
        <div className="lb-steps">
          {SHEET_STEPS.map((s, i) => (
            <div className="lb-step" key={s.bold}>
              <span className="lb-head lb-num">{i + 1}</span>
              <div>
                <b>{s.bold}</b>
                <br />
                {s.rest}
              </div>
            </div>
          ))}
        </div>
        <Foot url={requestUrl} words={SHEET_BACK_FOOT} side="request" />
      </section>
    </>
  );
}

/** Is a side's middle part fuller than its room? Measured on the small copy on the screen. */
function tooFull(preview: HTMLElement, side: "front" | "back"): boolean {
  const body = preview.querySelector<HTMLElement>(
    `[data-sheet-side="${side}"] .lb-plans, [data-sheet-side="${side}"] .lb-services`,
  );
  if (!body) return false;
  const floor = body.getBoundingClientRect().bottom;
  for (const el of body.querySelectorAll<HTMLElement>("li, .lb-service")) {
    if (el.getBoundingClientRect().bottom > floor + 0.5) return true;
  }
  return false;
}

/**
 * The sheet on Setup › QR pages: the small copy in the card, and the full-size copy for the
 * printer under the page's body. The second one is hung once the page is on the screen (there
 * is no page body while the server draws it).
 */
export function LeaveBehind(props: LeaveBehindProps) {
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => setBody(document.body), []);

  // Set a full side smaller, a step at a time. It starts again from full size whenever what is
  // printed changes, and once the sheet's own faces have arrived (a stand-in face measures
  // differently).
  const preview = useRef<HTMLDivElement>(null);
  const [faces, setFaces] = useState(false);
  useEffect(() => {
    let live = true;
    void document.fonts.ready.then(() => live && setFaces(true));
    return () => {
      live = false;
    };
  }, []);
  const what = JSON.stringify([props.numbers, props.services, faces]);
  const [fitted, setFitted] = useState({ what, front: 0, back: 0, full: false });
  const fit = fitted.what === what ? fitted : { what, front: 0, back: 0, full: false };
  useEffect(() => {
    const el = preview.current;
    if (!el) return;
    const front = tooFull(el, "front");
    const back = tooFull(el, "back");
    const next = {
      what,
      front: front ? Math.min(fit.front + 1, SHEET_FIT_MAX) : fit.front,
      back: back ? Math.min(fit.back + 1, SHEET_FIT_MAX) : fit.back,
      full: (front && fit.front >= SHEET_FIT_MAX) || (back && fit.back >= SHEET_FIT_MAX),
    };
    if (next.front !== fit.front || next.back !== fit.back || next.full !== fit.full) {
      setFitted(next);
    }
  }, [what, fit.front, fit.back, fit.full]);

  return (
    <>
      <style>{LEAVE_BEHIND_CSS}</style>
      <div
        className="lb-preview"
        data-leave-behind="preview"
        data-sheet-fit={`${fit.front},${fit.back}`}
        ref={preview}
      >
        <LeaveBehindPages {...props} fit={fit} />
      </div>
      {fit.full && (
        <p className="text-amber-700 dark:text-amber-300" data-sheet-too-full>
          {SHEET_TOO_FULL}
        </p>
      )}
      {body &&
        createPortal(
          <div id={LEAVE_BEHIND_PRINT_ID} data-leave-behind="print">
            <LeaveBehindPages {...props} fit={fit} />
          </div>,
          body,
        )}
    </>
  );
}
