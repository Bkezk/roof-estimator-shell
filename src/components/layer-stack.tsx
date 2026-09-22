/**
 * The legacy frmUnderlayment layer stack: one grey bar per layer (board name + a board glyph —
 * the tan 8'×4' / 4'×4' board, a flame for the Fire Rated tile), the attachment drawn BETWEEN a
 * layer and what it sits on (a black screw for mechanical, a green adhesive bed with the adhesive's
 * name arrowed beside it), and the blue Deck bar at the bottom. Clicking a bar selects that layer.
 */
import type { UnderlaymentLayer } from "@/lib/engine/bid-builder";

export type LayerAttachment = "mechanical" | "adhesive" | "none" | "durobond";

/** Tan board glyph with the legacy "8' 4'" (or "4' 4'") edge labels. */
export function BoardGlyph(props: { fourByFour?: boolean; className?: string | undefined }) {
  return (
    <svg viewBox="0 0 44 22" className={props.className ?? "h-5 w-10 shrink-0"} aria-hidden="true">
      <polygon points="3,14 13,4 41,4 31,14" fill="#e9d5a3" stroke="#b1935a" strokeWidth="1" />
      <polygon points="3,14 31,14 31,18 3,18" fill="#cdb27a" stroke="#b1935a" strokeWidth="1" />
      <text x="2" y="21.5" fontSize="7" fill="#000">
        {props.fourByFour ? "4'" : "8'"}
      </text>
      <text x="33" y="21.5" fontSize="7" fill="#000">
        4'
      </text>
    </svg>
  );
}

/** The legacy Fire Rated flame. */
export function FlameGlyph(props: { className?: string | undefined }) {
  return (
    <svg viewBox="0 0 24 28" className={props.className ?? "h-5 w-5 shrink-0"} aria-hidden="true">
      <path
        d="M12 1c1 5 6 7 6 14a6 6 0 0 1-12 0c0-3 1.5-5 3-6.5.2 2 1 3 2 3.5 0-4 1-7 1-11z"
        fill="#e8471b"
      />
      <path
        d="M12 12c.6 3 3 4 3 7a3 3 0 0 1-6 0c0-2 1-3 2-4 .2 1 .6 1.6 1 2 0-2 0-3.5 0-5z"
        fill="#f7b32b"
      />
    </svg>
  );
}

/** A slip sheet: a thin white sheet with a folded corner. */
function SheetGlyph(props: { className?: string | undefined }) {
  return (
    <svg viewBox="0 0 40 20" className={props.className ?? "h-5 w-10 shrink-0"} aria-hidden="true">
      <polygon points="2,15 12,4 38,4 28,15" fill="#fafafa" stroke="#777" strokeWidth="1" />
      <polygon points="28,15 38,4 38,8 32,15" fill="#ddd" stroke="#777" strokeWidth="1" />
    </svg>
  );
}

/** Tapered / crickets: a wedge. */
function WedgeGlyph(props: { className?: string | undefined }) {
  return (
    <svg viewBox="0 0 40 20" className={props.className ?? "h-5 w-10 shrink-0"} aria-hidden="true">
      <polygon points="2,18 38,18 38,4" fill="#e9d5a3" stroke="#b1935a" strokeWidth="1" />
    </svg>
  );
}

/** The legacy black screw, head up, driven down into the layer below. */
export function ScrewGlyph(props: { className?: string }) {
  return (
    <svg viewBox="0 0 16 30" className={props.className ?? "h-7 w-4 shrink-0"} aria-hidden="true">
      <rect x="2" y="1" width="12" height="4" rx="1" fill="#000" />
      <rect x="6.5" y="5" width="3" height="19" fill="#000" />
      <path d="M8 29 L4.5 24 H11.5 Z" fill="#000" />
      {[8, 11, 14, 17, 20].map((y) => (
        <path key={y} d={`M4 ${y} L12 ${y + 1.5}`} stroke="#000" strokeWidth="1.4" />
      ))}
    </svg>
  );
}

/** The legacy green adhesive bed with its black bead. */
function AdhesiveBed(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 20"
      preserveAspectRatio="none"
      className={props.className ?? "h-5 w-full"}
      aria-hidden="true"
    >
      <rect x="0" y="4" width="200" height="16" fill="#4bd07a" />
      <ellipse cx="100" cy="6" rx="26" ry="6" fill="#000" />
      <ellipse cx="100" cy="5.5" rx="20" ry="4" fill="#111" />
    </svg>
  );
}

/** The glyph shown on a layer bar (and its tab) for the board's picker tile. */
export function TileGlyph(props: { tile: number | undefined; className?: string | undefined }) {
  switch (props.tile) {
    case 1:
      return <SheetGlyph className={props.className} />;
    case 2:
    case 3:
    case 4:
      return <BoardGlyph className={props.className} />;
    case 5:
      return <FlameGlyph className={props.className} />;
    case 7:
    case 8:
      return <BoardGlyph fourByFour className={props.className} />;
    case 6:
      return <WedgeGlyph className={props.className} />;
    default:
      return null;
  }
}

export interface LayerStackProps {
  /** Slot indexes, TOP first (e.g. [4, 3, 2, 1, 0]). */
  slotsTopDown: number[];
  layers: UnderlaymentLayer[];
  selected: number;
  onSelect: (slot: number) => void;
  deckLabel: string;
  attachmentOf: (l: UnderlaymentLayer) => LayerAttachment;
  tileOf: (board: string) => number | undefined;
  quoteText?: (l: UnderlaymentLayer) => string | null;
}

export function LayerStack(p: LayerStackProps) {
  return (
    <div className="mx-auto grid w-full max-w-md grid-cols-[3.5rem_13rem_1fr] items-center gap-x-2 text-[11px]">
      {p.slotsTopDown.map((li) => {
        const l = p.layers[li];
        const att = l && !l.quote ? p.attachmentOf(l) : l ? "mechanical" : "none";
        const isSel = li === p.selected;
        const quote = l && p.quoteText ? p.quoteText(l) : null;
        return (
          <div key={li} className="contents">
            <span className="text-right text-xs">Layer {li + 1}</span>
            <button
              type="button"
              aria-pressed={isSel}
              title={`Select Layer ${li + 1}`}
              onClick={() => p.onSelect(li)}
              className={`flex w-full cursor-pointer items-center justify-between gap-1 border px-2 text-left text-xs transition hover:shadow-sm ${l ? "h-9" : "h-7"} ${
                isSel ? "border-2 border-yellow-400" : "border-neutral-500"
              } ${
                l
                  ? "bg-neutral-400 font-medium text-black dark:bg-neutral-500"
                  : "border-dashed bg-transparent text-muted-foreground"
              }`}
            >
              {l ? (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{l.board}</span>
                  {quote && (
                    <span className="truncate text-[10px] font-normal text-neutral-800 dark:text-neutral-100">
                      {quote}
                    </span>
                  )}
                </span>
              ) : (
                <span>Add Layer {li + 1}</span>
              )}
              {l && <TileGlyph tile={p.tileOf(l.board)} />}
            </button>
            <span />
            {/* Attachment drawn between this layer and what it sits on. */}
            <span />
            <div className={`flex w-full items-center justify-center ${l ? "h-7" : "h-2"}`}>
              {l && att === "mechanical" && <ScrewGlyph />}
              {l && att === "durobond" && <ScrewGlyph />}
              {l && att === "adhesive" && <AdhesiveBed />}
            </div>
            <span className="whitespace-nowrap text-xs">
              {l && att === "adhesive" && (
                <>
                  <svg viewBox="0 0 10 10" className="mr-1 inline h-2.5 w-2.5" aria-hidden="true">
                    <polygon points="10,0 0,5 10,10" fill="currentColor" />
                  </svg>
                  {l.adhesiveName || "Adhesive"}
                </>
              )}
              {l && att === "durobond" && "Duro-Bond"}
            </span>
          </div>
        );
      })}
      <span className="text-right text-xs">Deck</span>
      <div className="flex h-9 w-full items-center justify-center bg-blue-600 text-xs font-semibold text-white">
        {p.deckLabel}
      </div>
      <span />
    </div>
  );
}
