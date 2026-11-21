/**
 * The look of the Roof Care flyer (owner, Nov 20: "a bit more color similar to the one sheeter
 * i sent you and id like the public page to mimic that sign up process and style"). One set of
 * parts, shared by the sign-up pop-up (plan-card.tsx) and the two public pages (/care, /request):
 *
 *  - the lime-green band with the heavy, condensed, black headline in capitals;
 *  - the plan columns: the name in heavy blue capitals, one bold line of what it is, a rule, the
 *    yearly price in the heavy face with "per year" under it, a rule, then the list with small
 *    green squares, and the green "Our recommendation" tag on top of the one recommended;
 *  - a numbered step heading in the same face;
 *  - the deep blue band at the bottom with white print.
 *
 * Colours and the face come from styles.css (--jbk-green, --jbk-blue, --flyer-*, .flyer-head),
 * so the same parts read on the white public pages, the light app and the dark app. Nothing here
 * knows a price: every number is handed in.
 */
import type { ComponentProps, ReactNode } from "react";

/** The headline face: heavy, condensed, capitals. Add a size (flyer-h1 / h2 / h3 or text-*). */
export const FLYER_HEAD = "flyer-head";
/** The green band's own classes, for a band whose title is a dialog's title. */
export const FLYER_BAND =
  "bg-[var(--jbk-green)] px-4 py-5 text-left text-[var(--jbk-green-ink)] sm:px-7 sm:py-6";
export const FLYER_BAND_TITLE = `${FLYER_HEAD} flyer-h1 text-[var(--jbk-green-ink)]`;
export const FLYER_BAND_LEAD = "mt-2 max-w-3xl text-base font-medium text-[var(--jbk-green-ink)]";
/** The blue band at the foot. */
export const FLYER_FOOT = "bg-[var(--jbk-blue)] px-4 py-5 text-white sm:px-7";

/** The green band across the top with the headline and the lines under it. */
export function FlyerBand({
  title,
  lead,
  className = "",
}: {
  title: ReactNode;
  lead?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`${FLYER_BAND} ${className}`} data-flyer="band">
      <h1 className={FLYER_BAND_TITLE}>{title}</h1>
      {lead && <p className={FLYER_BAND_LEAD}>{lead}</p>}
    </header>
  );
}

/** The top of the sheet: the logo, and what the company does and where. */
export function FlyerMasthead() {
  return (
    <div
      className="flex items-center justify-between gap-3 bg-[var(--pub-paper)] px-4 py-3 sm:px-7 sm:py-4"
      data-flyer="masthead"
    >
      <img
        src="/jbk-logo.webp"
        alt="JBK Commercial Roofing"
        width={150}
        height={84}
        className="h-[56px] w-auto sm:h-[76px]"
      />
      <p className="text-right leading-tight">
        <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--jbk-blue)]">
          Commercial &amp; Industrial Roofing
        </span>
        <span className="block text-sm font-semibold text-[var(--flyer-ink)]">
          Kentucky | Tennessee
        </span>
      </p>
    </div>
  );
}

/** The heading of one numbered step: the number on green, the title in the heavy face. */
export function FlyerStepHead({ n, title }: { n: number; title: ReactNode }) {
  return (
    <h3
      className="flex items-center gap-2.5 border-b-2 border-[var(--flyer-rule)] pb-1.5"
      data-flyer="step"
    >
      <span
        className={`${FLYER_HEAD} flex h-8 w-8 shrink-0 items-center justify-center bg-[var(--jbk-green)] text-xl text-[var(--jbk-green-ink)]`}
        aria-hidden
      >
        {n}
      </span>
      <span className={`${FLYER_HEAD} flyer-h3 text-[var(--flyer-name)]`}>
        <span className="sr-only">Step {n}: </span>
        {title}
      </span>
    </h3>
  );
}

/** The list under a plan: a small green square before each line. */
export function FlyerBullets({
  lines,
  ...rest
}: { lines: readonly string[] } & ComponentProps<"ul">) {
  return (
    <ul className="space-y-1.5 text-sm text-[var(--flyer-ink)]" {...rest}>
      {lines.map((line) => (
        <li key={line} className="flex gap-2">
          <span
            className="mt-[0.42em] h-[7px] w-[7px] shrink-0 bg-[var(--jbk-green)]"
            aria-hidden
          />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

/** The green tag that sits on top of the recommended plan. */
export function FlyerTag({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-block whitespace-nowrap bg-[var(--jbk-green)] px-2 py-1 text-[10px] font-bold uppercase leading-none tracking-[0.16em] text-[var(--jbk-green-ink)]"
      data-plan-recommended
    >
      {children}
    </span>
  );
}

export interface FlyerPlanProps extends Omit<ComponentProps<"button">, "name"> {
  /** "watch" / "care" / "guard": written on the parts so a page or a test can find them. */
  planKey: string;
  /** "Roof Care". */
  name: string;
  /** One bold line of what the plan is. */
  promise: string;
  /** The yearly price as it is to be read, dollar sign and all; null while there is none yet. */
  price: string | null;
  /** Said in the price's place while there is none. */
  waiting: string;
  /** What the plan includes, a line each. */
  lines: readonly string[];
  /** The words of the tag, on the recommended plan only. */
  recommended?: string | null;
  picked: boolean;
  /** The words of the row at the foot: "Choose Roof Care" / "Selected". None when not offered. */
  action?: string | null;
}

/**
 * One plan as the flyer draws it, and a button: a press picks it. The three sit side by side
 * with a thin dark rule between them from a tablet up, and under each other on a phone.
 */
export function FlyerPlan({
  planKey,
  name,
  promise,
  price,
  waiting,
  lines,
  recommended,
  picked,
  action,
  className = "",
  ...rest
}: FlyerPlanProps) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      data-plan-card={planKey}
      data-flyer="plan"
      data-picked={picked ? "yes" : undefined}
      className={`flex h-full w-full flex-col rounded-none border-0 border-t-2 border-[var(--flyer-rule)] px-3 pb-4 pt-2 text-left transition sm:border-l sm:border-t-0 sm:px-4 sm:first:border-l-0 ${
        picked
          ? "bg-[var(--flyer-tint)] shadow-[inset_0_0_0_3px_var(--flyer-name)]"
          : "bg-transparent enabled:hover:bg-[var(--flyer-tint)]"
      } ${className}`}
      {...rest}
    >
      {/* The tag's row is kept on every plan, so the three names line up. */}
      <span className="block min-h-[24px]">
        {recommended && <FlyerTag>{recommended}</FlyerTag>}
      </span>
      <span className={`${FLYER_HEAD} flyer-h2 mt-1 block text-[var(--flyer-name)]`}>{name}</span>
      <span className="mt-1.5 block text-sm font-bold text-[var(--flyer-ink)]">{promise}</span>
      <span className="mt-3 block border-t-2 border-[var(--flyer-rule)] pt-2.5">
        {price != null ? (
          <span className="block" data-plan-price>
            <span className={`${FLYER_HEAD} flyer-h2 block text-[var(--flyer-ink)]`}>{price}</span>
            <span className="block text-sm text-[var(--flyer-ink)]">per year</span>
          </span>
        ) : (
          <span className="block text-sm italic text-[var(--flyer-soft)]">{waiting}</span>
        )}
      </span>
      <span className="mt-2.5 block flex-1 border-t-2 border-[var(--flyer-rule)] pt-3">
        <FlyerBullets lines={lines} data-plan-includes={planKey} />
      </span>
      {action && (
        <span
          className={`mt-4 block min-h-[44px] px-3 py-3 text-center text-sm font-bold uppercase tracking-wide ${
            picked
              ? "bg-[var(--jbk-blue)] text-white"
              : "border-2 border-[var(--flyer-name)] text-[var(--flyer-name)]"
          }`}
          data-plan-action
        >
          {action}
        </span>
      )}
    </button>
  );
}

/** The blue band at the foot of the sheet: a heavy white heading and what goes beside it. */
export function FlyerFoot({
  title,
  children,
  className = "",
}: {
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <footer className={`${FLYER_FOOT} ${className}`} data-flyer="foot">
      {title && <p className={`${FLYER_HEAD} flyer-h2 text-white`}>{title}</p>}
      {children}
    </footer>
  );
}
