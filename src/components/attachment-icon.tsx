import { Droplet, Magnet } from "lucide-react";

/** A screw: slotted head over a threaded shank (lucide has no screw glyph). */
function ScrewIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden="true"
    >
      <path d="M8 4h8l-1 4H9z" />
      <path d="M10 6h4" />
      <path d="M10 8v9l2 3 2-3V8" />
      <path d="M10 11h4M10 14h4" />
    </svg>
  );
}

/**
 * The little symbol beside an underlayment layer for how it is held down: a screw for
 * mechanical, a droplet for adhesive, a magnet for Duro-Bond's induction plates.
 */
export function AttachmentIcon(props: {
  attachment: "mechanical" | "adhesive" | "durobond" | "none" | string;
  className?: string;
}) {
  const cls = props.className ?? "h-3.5 w-3.5 shrink-0";
  const title: Record<string, string> = {
    mechanical: "Mechanically fastened",
    adhesive: "Adhered",
    durobond: "Held by the Duro-Bond induction plates",
  };
  const t = title[props.attachment];
  switch (props.attachment) {
    case "mechanical":
      return (
        <span title={t}>
          <ScrewIcon className={cls} />
        </span>
      );
    case "adhesive":
      return (
        <span title={t}>
          <Droplet className={cls} aria-hidden="true" />
        </span>
      );
    case "durobond":
      return (
        <span title={t}>
          <Magnet className={cls} aria-hidden="true" />
        </span>
      );
    default:
      return null;
  }
}
