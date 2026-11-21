/**
 * The public pages' own boxes and buttons (Nov 21). Their colours are written out, not taken
 * from the app's theme: these pages are the flyer on white on every phone. Every box has its
 * label, a 16 px letter (an iPhone zooms in on anything smaller) and a line under it for what
 * is wrong; every button is at least 48 px tall for a thumb.
 */
import type { ComponentProps, ReactNode } from "react";

import { FLYER_HEAD, FlyerBand, FlyerFoot, FlyerMasthead } from "@/components/roof-care/flyer-look";
import { PUBLIC_SAMPLE_LINE } from "@/lib/public-forms";
import { PUBLIC_COMPANY } from "@/lib/public-pages";

export const PUBLIC_BOX =
  "block h-[48px] w-full rounded-md border border-[var(--pub-line)] bg-[var(--pub-paper)] px-3 text-[16px] text-[var(--flyer-ink)] placeholder:text-[var(--flyer-soft)] focus:border-[var(--jbk-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--jbk-blue)]/40";

export function PublicField({
  id,
  label,
  optional,
  problem,
  hint,
  className = "",
  ...rest
}: {
  id: string;
  label: string;
  optional?: boolean | undefined;
  /** What is wrong with this box, shown under it once the visitor has tried to go on. */
  problem?: string | null | undefined;
  hint?: string | undefined;
} & ComponentProps<"input">) {
  return (
    <div className={`space-y-1 ${className}`} data-field={id}>
      <label htmlFor={id} className="block text-sm font-semibold text-[var(--flyer-ink)]">
        {label}
        {optional && <span className="font-normal text-[var(--flyer-soft)]"> (optional)</span>}
      </label>
      <input
        id={id}
        name={id}
        className={`${PUBLIC_BOX} ${problem ? "border-[var(--pub-bad)]" : ""}`}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-problem` : hint ? `${id}-hint` : undefined}
        {...rest}
      />
      {problem ? (
        <p
          id={`${id}-problem`}
          className="text-sm font-medium text-[var(--pub-bad)]"
          data-problem={id}
        >
          {problem}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-[var(--flyer-soft)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function PublicTextArea({
  id,
  label,
  optional,
  ...rest
}: { id: string; label: string; optional?: boolean } & ComponentProps<"textarea">) {
  return (
    <div className="space-y-1" data-field={id}>
      <label htmlFor={id} className="block text-sm font-semibold text-[var(--flyer-ink)]">
        {label}
        {optional && <span className="font-normal text-[var(--flyer-soft)]"> (optional)</span>}
      </label>
      <textarea
        id={id}
        name={id}
        rows={4}
        className={`${PUBLIC_BOX} h-auto min-h-[110px] py-2.5`}
        {...rest}
      />
    </div>
  );
}

/** A tick box or a radio with its words, as one big row to press. */
export function PublicChoice({
  id,
  type,
  checked,
  onChange,
  name,
  children,
  ...rest
}: {
  id: string;
  type: "checkbox" | "radio";
  checked: boolean;
  onChange: (on: boolean) => void;
  name?: string;
  children: ReactNode;
} & Omit<ComponentProps<"label">, "onChange">) {
  return (
    <label
      htmlFor={id}
      className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-md border-2 px-3 py-2 text-[16px] text-[var(--flyer-ink)] ${
        checked
          ? "border-[var(--jbk-blue)] bg-[var(--flyer-tint)]"
          : "border-[var(--pub-line)] bg-[var(--pub-paper)]"
      }`}
      {...rest}
    >
      <input
        id={id}
        name={name ?? id}
        type={type}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0 accent-[#014b96]"
      />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

/** The one big button of a step: green with dark print, as the flyer's green band. */
export function PublicButton({ className = "", ...rest }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={`${FLYER_HEAD} inline-flex min-h-[54px] w-full items-center justify-center gap-2 bg-[var(--jbk-green)] px-6 text-2xl text-[var(--jbk-green-ink)] transition hover:bg-[#8fc238] disabled:cursor-not-allowed disabled:bg-[#d7dbe1] disabled:text-[#566070] sm:w-auto ${className}`}
      {...rest}
    />
  );
}

/**
 * The box no person fills in: off the screen, out of the tab order and hidden from a screen
 * reader. A robot that fills every box fills this one, and the request is dropped.
 */
export function RobotTrap({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div aria-hidden className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
      {/* Nov 21: the box was named "website", a name browsers and password managers fill in by
          themselves, which would quietly drop a real person's request. This name means nothing
          to them. The request still carries it as `website`. */}
      <label htmlFor="jbk-leave-blank">Leave this box empty</label>
      <input
        id="jbk-leave-blank"
        name="jbk_leave_blank"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * Said only on the local test server, which has no key to the database: its prices are sample
 * numbers and nothing typed is kept. The published site never answers `sample`.
 */
export function PublicSampleLine() {
  return (
    <p
      className="rounded-md border-2 border-dashed border-[var(--pub-bad)] p-2 text-sm font-semibold text-[var(--pub-bad)]"
      data-public="sample"
    >
      {PUBLIC_SAMPLE_LINE}
    </p>
  );
}

/** The sheet around a public page: the logo, the green band, the page, the blue band. */
export function PublicSheet({
  title,
  lead,
  footTitle,
  children,
  ...rest
}: {
  title: string;
  lead: string;
  footTitle: string;
  children: ReactNode;
} & ComponentProps<"div">) {
  return (
    <div className="jbk-public min-h-svh" {...rest}>
      <div className="mx-auto w-full max-w-5xl">
        <FlyerMasthead />
        <FlyerBand title={`${title}.`} lead={lead} />
        <main className="space-y-9 px-4 py-7 sm:px-7">{children}</main>
        <FlyerFoot title={footTitle}>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
            <p className="max-w-md text-base text-white/95">
              Questions? Call us and a person answers. {PUBLIC_COMPANY.name}.
            </p>
            <p className="text-right">
              <a
                href={PUBLIC_COMPANY.phoneHref}
                className={`${FLYER_HEAD} flyer-h2 block text-white`}
                data-public="phone"
              >
                {PUBLIC_COMPANY.phone}
              </a>
              <a
                href={`mailto:${PUBLIC_COMPANY.email}`}
                className="block text-base font-semibold text-white"
              >
                {PUBLIC_COMPANY.email}
              </a>
              <span className="block text-sm text-white/90">{PUBLIC_COMPANY.web}</span>
            </p>
          </div>
        </FlyerFoot>
      </div>
    </div>
  );
}

/** What a visitor sees once a form has gone through. */
export function PublicThanks({
  reference,
  title,
  sample = false,
  children,
}: {
  reference: string;
  title: string;
  /** The local test server answered: nothing was really sent. */
  sample?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4" data-public="sent" role="status">
      {sample && <PublicSampleLine />}
      <h2 className={`${FLYER_HEAD} flyer-h2 text-[var(--jbk-blue)]`}>{title}</h2>
      <p className="text-base text-[var(--flyer-ink)]">
        Your reference is{" "}
        <b className="whitespace-nowrap text-lg" data-public="reference">
          {reference}
        </b>
        . Keep it handy if you call us.
      </p>
      {children}
      <p className="text-base text-[var(--flyer-ink)]">
        Need us sooner? Call{" "}
        <a href={PUBLIC_COMPANY.phoneHref} className="font-bold text-[var(--jbk-blue)] underline">
          {PUBLIC_COMPANY.phone}
        </a>
        .
      </p>
    </section>
  );
}
