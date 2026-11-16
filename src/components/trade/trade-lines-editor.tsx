/**
 * Trade Bids, the editor of a trade's setup (owner, Nov 16: "a bid setup where we can set labor
 * and cost and time similar to the project bid calculator but simpler and we can save it per job
 * type like fill it in for painting save it, fill it in for siding save it").
 *
 * One editor, two places: the trade's own setup (trade-setup-screen.tsx) and a single bid's copy
 * of it (trade-bid-screen.tsx, "Change this bid's rates and lines"; owner: "a saved bid should
 * keep its own numbers"). It is given a setup and hands back a new one on every change; it keeps
 * nothing itself, so whoever shows it decides what is saved and when.
 *
 * Four short sections, top to bottom, in the order a person thinks about a job:
 *
 *  1. What you measure: the amounts a bid asks for (walls in sq ft, doors each).
 *  2. Materials: what one costs and how far one goes.
 *  3. Labor: what an hour costs and how much one person gets done in it.
 *  4. Flat costs and markup: a lift or a permit, then overhead, profit, tax and the crew.
 *
 * The readers are office staff, so every box has its label printed above it (a phone has no
 * hover), each row stacks on a phone, and a sentence is written the way it is said: "One gallon
 * covers [350] sq ft".
 *
 * Number boxes (`AmountBox`, also used for a bid's measurements):
 *  - start blank and stay blank until typed in. A blank is "not typed yet", never 0: the price
 *    names the line that is waiting for it (trade-bid.ts).
 *  - are text boxes with the decimal keypad, not number boxes: a number box changes its value
 *    when the mouse wheel passes over it.
 *  - keep what was typed as text, so "0." and "1,250" can be typed without the box rewriting
 *    them. While a box holds something that is not a number, the setup holds nothing (null) for
 *    it, the box says so in words, and the screen is told how many such boxes there are through
 *    `onInvalidChange`, so it can keep Save off until they are fixed.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  amountText,
  type TradeBasis,
  type TradeFixed,
  type TradeLabor,
  type TradeMaterial,
  type TradeMeasure,
  type TradeSetup,
} from "@/lib/trade-bid";
import {
  BOX_MAX,
  LINE_MAX,
  SET_AMOUNT,
  addFixed,
  addLabor,
  addMaterial,
  addMeasure,
  amountProblem,
  amountValue,
  followers,
  goesBy,
  goesByPatch,
  patchLine,
  pluralUnit,
  removeLine,
  removeMeasure,
} from "@/lib/trade-bid-form";
import { cn } from "@/lib/utils";

// The shared Input drops to 14px from a tablet's width up, and iOS zooms the page into any box
// under 16px when it is tapped. These boxes stay at 16px at every width.
export const BOX = "h-10 text-base md:text-base";

// ── Number boxes ───────────────────────────────────────────────────────────────────────────────

/** How a number box tells whoever is counting that it holds a mistake (or no longer does). */
const InvalidContext = createContext<(boxId: string, bad: boolean) => void>(() => {});

/**
 * Counts the number boxes inside it that hold something that is not a number, and says how many
 * each time that changes. A box that goes away (its line was removed) stops counting.
 */
export function InvalidBoxes(props: {
  onChange?: ((count: number) => void) | undefined;
  children: ReactNode;
}) {
  const bad = useRef(new Set<string>());
  // The latest listener, read when a box reports: the boxes keep one stable way to report.
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const report = useCallback((boxId: string, isBad: boolean) => {
    if (bad.current.has(boxId) === isBad) return;
    if (isBad) bad.current.add(boxId);
    else bad.current.delete(boxId);
    onChange.current?.(bad.current.size);
  }, []);
  return <InvalidContext.Provider value={report}>{props.children}</InvalidContext.Provider>;
}

/**
 * One number box. `value` is the number it stands for, or null for none; `onChange` is given the
 * same. The text typed is kept here, so the box never rewrites what is being typed.
 */
export function AmountBox(props: {
  value: number | null;
  onChange: (next: number | null) => void;
  id?: string | undefined;
  /** The most the box takes; over it the box says so and stands for nothing. */
  max?: number | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  /** Words printed before the box ("$") and after it ("%", "sq ft"). */
  before?: string | undefined;
  after?: string | undefined;
  /** Its name for a screen reader, when no printed label points at `id`. */
  label?: string | undefined;
  className?: string | undefined;
  /** `data-` hooks for the box itself. */
  hooks?: Record<`data-${string}`, string> | undefined;
}) {
  const { value, max } = props;
  const [text, setText] = useState(() => amountText(value));
  const [focused, setFocused] = useState(false);
  const problem = amountProblem(text, max);

  // The box follows a number that changed from outside (a save that took the server's copy, a
  // screen started afresh), and only then: while the text still means the number ("0." for 0,
  // "1,250" for 1250) or holds a mistake the setup has no number for, it is left as typed.
  const shown = amountText(value);
  if (amountValue(text, max) !== value && text !== shown) setText(shown);

  const boxId = useId();
  const report = useContext(InvalidContext);
  useEffect(() => report(boxId, problem !== null), [report, boxId, problem]);
  useEffect(() => () => report(boxId, false), [report, boxId]);

  const problemId = `${boxId}-problem`;
  return (
    <div className={cn("min-w-0 space-y-1", props.className)}>
      <div className="flex items-center gap-1.5">
        {props.before && (
          <span className="shrink-0 text-sm text-muted-foreground" aria-hidden>
            {props.before}
          </span>
        )}
        <Input
          id={props.id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          disabled={props.disabled}
          placeholder={props.placeholder}
          aria-label={props.label}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? problemId : undefined}
          className={cn(BOX, "min-w-0 flex-1", problem && "border-destructive")}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const typed = e.target.value;
            setText(typed);
            const next = amountValue(typed, max);
            if (next !== value) props.onChange(next);
          }}
          {...props.hooks}
        />
        {props.after && (
          <span className="shrink-0 text-sm text-muted-foreground">{props.after}</span>
        )}
      </div>
      {/* The red outline is there at once; the words wait until the box is left, so they do
          not flash up between two keystrokes of a number still being typed. */}
      {problem && !focused && (
        <p id={problemId} role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * The job's measurements: one blank box per measure, named with its unit. The bid screen's
 * Measurements card, and the setup screen's "Try it".
 */
export function MeasureBoxes(props: {
  measures: readonly TradeMeasure[];
  quantities: Readonly<Record<string, number | null | undefined>>;
  onChange: (measureId: string, value: number | null) => void;
  disabled?: boolean | undefined;
}) {
  if (props.measures.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Nothing is measured yet. Add what a bid of this kind measures, such as wall area.
      </p>
    );
  return (
    // Laid out by the width of the card it is in: wide on a bid, narrow beside the setup.
    <div className="@container">
      <div className="grid gap-3 @md:grid-cols-2 @2xl:grid-cols-3">
        {props.measures.map((m) => (
          <MeasureBox
            key={m.id}
            measure={m}
            value={props.quantities[m.id] ?? null}
            disabled={props.disabled}
            onChange={(v) => props.onChange(m.id, v)}
          />
        ))}
      </div>
    </div>
  );
}

function MeasureBox(props: {
  measure: TradeMeasure;
  value: number | null;
  disabled: boolean | undefined;
  onChange: (value: number | null) => void;
}) {
  const id = useId();
  return (
    <Field label={props.measure.name.trim() || "No name yet"} htmlFor={id}>
      <AmountBox
        id={id}
        value={props.value}
        max={BOX_MAX.quantity}
        disabled={props.disabled}
        after={props.measure.unit.trim() || undefined}
        hooks={{ "data-quantity": props.measure.id }}
        onChange={props.onChange}
      />
    </Field>
  );
}

// ── Small pieces ───────────────────────────────────────────────────────────────────────────────

function Field(props: {
  label: string;
  htmlFor: string;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", props.className)}>
      <Label htmlFor={props.htmlFor} className="text-xs text-muted-foreground">
        {props.label}
      </Label>
      {props.children}
    </div>
  );
}

function SectionHead(props: { title: string; help: string; note: string | undefined }) {
  return (
    <CardHeader className="pb-3">
      <CardTitle className="text-base">{props.title}</CardTitle>
      <CardDescription>{props.help}</CardDescription>
      {props.note && <p className="text-sm font-medium">{props.note}</p>}
    </CardHeader>
  );
}

function RemoveButton(props: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      // Level with the boxes, which sit under a line of label.
      className="mt-5 shrink-0 text-muted-foreground hover:text-destructive"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Trash2 />
    </Button>
  );
}

const Empty = (props: { children: ReactNode }) => (
  <p className="text-sm text-muted-foreground">{props.children}</p>
);

const measureLabel = (m: TradeMeasure) => {
  const name = m.name.trim() || "No name yet";
  const unit = m.unit.trim();
  return unit ? `${name} (${unit})` : name;
};

/** "Goes by": one of the measures, or a set amount. */
function GoesBy(props: {
  id: string;
  line: { basis: TradeBasis; measure_id: string | null };
  measures: readonly TradeMeasure[];
  /** The set-amount choice in this section's words ("A set number of hours"). */
  setLabel: string;
  disabled: boolean;
  onPick: (patch: { basis: TradeBasis; measure_id: string | null }) => void;
}) {
  return (
    <Select
      value={goesBy(props.line, props.measures)}
      disabled={props.disabled}
      onValueChange={(v) => props.onPick(goesByPatch(v))}
    >
      <SelectTrigger id={props.id} className={BOX}>
        <SelectValue placeholder="Pick one…" />
      </SelectTrigger>
      <SelectContent>
        {props.measures.map((m) => (
          <SelectItem key={m.id} value={`m:${m.id}`}>
            {measureLabel(m)}
          </SelectItem>
        ))}
        <SelectItem value={SET_AMOUNT}>{props.setLabel}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** A line that goes by a measure nobody picked (or one since removed): it adds nothing yet. */
const PickMeasure = () => (
  <p className="self-end pb-2 text-sm font-medium text-amber-700 dark:text-amber-400">
    Pick what it is measured by.
  </p>
);

// ── The rows ───────────────────────────────────────────────────────────────────────────────────
//
// A row lays itself out by the width of the card it is in (the "@" sizes), not of the window:
// the same editor is full width on a bid and beside "Try it" on the setup screen, and on a
// phone every row stacks.

function MeasureRow(props: {
  measure: TradeMeasure;
  disabled: boolean;
  onPatch: (patch: Partial<Omit<TradeMeasure, "id">>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const m = props.measure;
  return (
    <div className="flex items-start gap-2 rounded-md border p-3" data-measure-row={m.id}>
      <div className="grid min-w-0 flex-1 gap-3 @lg:grid-cols-[2fr_1fr]">
        <Field label="What is measured" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            className={BOX}
            value={m.name}
            maxLength={80}
            placeholder="Walls"
            disabled={props.disabled}
            onChange={(e) => props.onPatch({ name: e.target.value })}
          />
        </Field>
        <Field label="Measured in" htmlFor={`${id}-unit`}>
          <Input
            id={`${id}-unit`}
            className={BOX}
            value={m.unit}
            maxLength={30}
            placeholder="sq ft"
            disabled={props.disabled}
            onChange={(e) => props.onPatch({ unit: e.target.value })}
          />
        </Field>
      </div>
      <RemoveButton
        label={`Remove ${m.name.trim() || "this measure"}`}
        disabled={props.disabled}
        onClick={props.onRemove}
      />
    </div>
  );
}

function MaterialRow(props: {
  material: TradeMaterial;
  measures: readonly TradeMeasure[];
  disabled: boolean;
  onPatch: (patch: Partial<Omit<TradeMaterial, "id">>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const m = props.material;
  const unit = m.unit.trim();
  const measure =
    m.basis === "measure" ? (props.measures.find((x) => x.id === m.measure_id) ?? null) : null;
  return (
    <div className="space-y-3 rounded-md border p-3" data-material-row={m.id}>
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-3 @xl:grid-cols-[2fr_1fr_1fr]">
          <Field label="Material" htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              className={BOX}
              value={m.name}
              maxLength={120}
              placeholder="Wall paint"
              disabled={props.disabled}
              onChange={(e) => props.onPatch({ name: e.target.value })}
            />
          </Field>
          <Field label="Bought in" htmlFor={`${id}-unit`}>
            <Input
              id={`${id}-unit`}
              className={BOX}
              value={m.unit}
              maxLength={30}
              placeholder="gallon"
              disabled={props.disabled}
              onChange={(e) => props.onPatch({ unit: e.target.value })}
            />
          </Field>
          <Field label={`Cost per ${unit || "unit"}`} htmlFor={`${id}-cost`}>
            <AmountBox
              id={`${id}-cost`}
              before="$"
              value={m.cost}
              max={BOX_MAX.amount}
              disabled={props.disabled}
              onChange={(cost) => props.onPatch({ cost })}
            />
          </Field>
        </div>
        <RemoveButton
          label={`Remove ${m.name.trim() || "this material"}`}
          disabled={props.disabled}
          onClick={props.onRemove}
        />
      </div>
      <div className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-4">
        <Field label="Goes by" htmlFor={`${id}-by`}>
          <GoesBy
            id={`${id}-by`}
            line={m}
            measures={props.measures}
            setLabel="A set amount"
            disabled={props.disabled}
            onPick={props.onPatch}
          />
        </Field>
        {m.basis === "flat" ? (
          <Field label="How many" htmlFor={`${id}-qty`}>
            <AmountBox
              id={`${id}-qty`}
              value={m.qty}
              max={BOX_MAX.amount}
              disabled={props.disabled}
              after={pluralUnit(unit, m.qty ?? 0) || undefined}
              onChange={(qty) => props.onPatch({ qty })}
            />
          </Field>
        ) : measure ? (
          <>
            <Field label={`One ${unit || "unit"} covers`} htmlFor={`${id}-covers`}>
              <AmountBox
                id={`${id}-covers`}
                value={m.coverage}
                max={BOX_MAX.amount}
                disabled={props.disabled}
                after={measure.unit.trim() || undefined}
                onChange={(coverage) => props.onPatch({ coverage })}
              />
            </Field>
            <Field label="Waste" htmlFor={`${id}-waste`}>
              <AmountBox
                id={`${id}-waste`}
                value={m.waste_pct}
                max={BOX_MAX.pct}
                disabled={props.disabled}
                after="%"
                onChange={(waste_pct) => props.onPatch({ waste_pct })}
              />
            </Field>
            <div className="flex items-center gap-2 self-end pb-2.5">
              <Checkbox
                id={`${id}-whole`}
                checked={m.whole}
                disabled={props.disabled}
                onCheckedChange={(v) => props.onPatch({ whole: v === true })}
              />
              <Label htmlFor={`${id}-whole`} className="font-normal">
                Bought whole (round up)
              </Label>
            </div>
          </>
        ) : (
          <PickMeasure />
        )}
      </div>
    </div>
  );
}

function LaborRow(props: {
  labor: TradeLabor;
  measures: readonly TradeMeasure[];
  disabled: boolean;
  onPatch: (patch: Partial<Omit<TradeLabor, "id">>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const l = props.labor;
  const measure =
    l.basis === "measure" ? (props.measures.find((x) => x.id === l.measure_id) ?? null) : null;
  return (
    <div className="space-y-3 rounded-md border p-3" data-labor-row={l.id}>
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-3 @lg:grid-cols-[2fr_1fr]">
          <Field label="Task" htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              className={BOX}
              value={l.name}
              maxLength={120}
              placeholder="Roll walls"
              disabled={props.disabled}
              onChange={(e) => props.onPatch({ name: e.target.value })}
            />
          </Field>
          <Field label="Hourly rate" htmlFor={`${id}-rate`}>
            <AmountBox
              id={`${id}-rate`}
              before="$"
              value={l.rate}
              max={BOX_MAX.amount}
              disabled={props.disabled}
              onChange={(rate) => props.onPatch({ rate })}
            />
          </Field>
        </div>
        <RemoveButton
          label={`Remove ${l.name.trim() || "this task"}`}
          disabled={props.disabled}
          onClick={props.onRemove}
        />
      </div>
      <div className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-4">
        <Field label="Goes by" htmlFor={`${id}-by`}>
          <GoesBy
            id={`${id}-by`}
            line={l}
            measures={props.measures}
            setLabel="A set number of hours"
            disabled={props.disabled}
            onPick={props.onPatch}
          />
        </Field>
        {l.basis === "flat" ? (
          <Field label="Hours" htmlFor={`${id}-hours`}>
            <AmountBox
              id={`${id}-hours`}
              value={l.hours}
              max={BOX_MAX.amount}
              disabled={props.disabled}
              onChange={(hours) => props.onPatch({ hours })}
            />
          </Field>
        ) : measure ? (
          <Field label="One person does" htmlFor={`${id}-does`} className="@3xl:col-span-2">
            <AmountBox
              id={`${id}-does`}
              value={l.per_hour}
              max={BOX_MAX.amount}
              disabled={props.disabled}
              after={`${measure.unit.trim()} an hour`.trim()}
              onChange={(per_hour) => props.onPatch({ per_hour })}
            />
          </Field>
        ) : (
          <PickMeasure />
        )}
      </div>
    </div>
  );
}

function FixedRow(props: {
  fixed: TradeFixed;
  disabled: boolean;
  onPatch: (patch: Partial<Omit<TradeFixed, "id">>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const f = props.fixed;
  return (
    <div className="flex items-start gap-2 rounded-md border p-3" data-fixed-row={f.id}>
      <div className="grid min-w-0 flex-1 gap-3 @lg:grid-cols-[2fr_1fr]">
        <Field label="What it is" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            className={BOX}
            value={f.name}
            maxLength={120}
            placeholder="Lift rental"
            disabled={props.disabled}
            onChange={(e) => props.onPatch({ name: e.target.value })}
          />
        </Field>
        <Field label="Cost" htmlFor={`${id}-cost`}>
          <AmountBox
            id={`${id}-cost`}
            before="$"
            value={f.cost}
            max={BOX_MAX.amount}
            disabled={props.disabled}
            onChange={(cost) => props.onPatch({ cost })}
          />
        </Field>
      </div>
      <RemoveButton
        label={`Remove ${f.name.trim() || "this flat cost"}`}
        disabled={props.disabled}
        onClick={props.onRemove}
      />
    </div>
  );
}

function AddButton(props: {
  kind: "measure" | "material" | "labor" | "fixed";
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-10"
      data-add={props.kind}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Plus /> {props.children}
    </Button>
  );
}

// ── The editor ─────────────────────────────────────────────────────────────────────────────────

export function TradeLinesEditor(props: {
  value: TradeSetup;
  onChange: (next: TradeSetup) => void;
  disabled?: boolean;
  /** Extra words under the title of each section, e.g. "Only this bid changes." */
  note?: string;
  /**
   * Told how many number boxes in the editor hold something that is not a number, each time
   * that changes (0 when all are fine). The setup holds null for such a box, so the screen
   * showing the editor keeps Save off while this is above 0: saving would drop what was typed.
   */
  onInvalidChange?: (count: number) => void;
}) {
  const { value, onChange } = props;
  const disabled = !!props.disabled;
  const idBase = useId();
  // The measure being removed while lines still go by it: asked about first.
  const [removing, setRemoving] = useState<string | null>(null);
  const asked = value.measures.find((m) => m.id === removing) ?? null;
  const askedLines = asked ? followers(value, asked.id) : [];
  const askedName = asked?.name.trim() || "this measure";

  const removeMeasureAsking = (m: TradeMeasure) => {
    if (followers(value, m.id).length > 0) setRemoving(m.id);
    else onChange(removeMeasure(value, m.id));
  };

  return (
    <InvalidBoxes onChange={props.onInvalidChange}>
      <div className="space-y-4" data-trade-lines>
        <Card data-card="trade-measures">
          <SectionHead
            title="What you measure"
            help="The amounts a bid asks for, such as wall area or number of doors."
            note={props.note}
          />
          <CardContent className="@container space-y-3">
            {value.measures.length === 0 && (
              <Empty>Nothing yet. Most trades measure one to three things.</Empty>
            )}
            {value.measures.map((m) => (
              <MeasureRow
                key={m.id}
                measure={m}
                disabled={disabled}
                onPatch={(patch) => onChange(patchLine(value, "measures", m.id, patch))}
                onRemove={() => removeMeasureAsking(m)}
              />
            ))}
            <AddButton
              kind="measure"
              disabled={disabled || value.measures.length >= LINE_MAX.measures}
              onClick={() => onChange(addMeasure(value))}
            >
              Add something to measure
            </AddButton>
          </CardContent>
        </Card>

        <Card data-card="trade-materials">
          <SectionHead
            title="Materials"
            help="What the job uses up: what one costs, and how far one goes."
            note={props.note}
          />
          <CardContent className="@container space-y-3">
            {value.materials.length === 0 && <Empty>No materials yet.</Empty>}
            {value.materials.map((m) => (
              <MaterialRow
                key={m.id}
                material={m}
                measures={value.measures}
                disabled={disabled}
                onPatch={(patch) => onChange(patchLine(value, "materials", m.id, patch))}
                onRemove={() => onChange(removeLine(value, "materials", m.id))}
              />
            ))}
            <AddButton
              kind="material"
              disabled={disabled || value.materials.length >= LINE_MAX.materials}
              onClick={() => onChange(addMaterial(value))}
            >
              Add a material
            </AddButton>
          </CardContent>
        </Card>

        <Card data-card="trade-labor">
          <SectionHead
            title="Labor"
            help="The work, task by task: what an hour costs, and how much one person gets done in it."
            note={props.note}
          />
          <CardContent className="@container space-y-3">
            {value.labor.length === 0 && <Empty>No labor yet.</Empty>}
            {value.labor.map((l) => (
              <LaborRow
                key={l.id}
                labor={l}
                measures={value.measures}
                disabled={disabled}
                onPatch={(patch) => onChange(patchLine(value, "labor", l.id, patch))}
                onRemove={() => onChange(removeLine(value, "labor", l.id))}
              />
            ))}
            <AddButton
              kind="labor"
              disabled={disabled || value.labor.length >= LINE_MAX.labor}
              onClick={() => onChange(addLabor(value))}
            >
              Add a task
            </AddButton>
          </CardContent>
        </Card>

        <Card data-card="trade-markup">
          <SectionHead
            title="Flat costs and markup"
            help="Costs that are the same whatever the job measures, such as a lift or a permit. Then what is added on top."
            note={props.note}
          />
          <CardContent className="@container space-y-4">
            <div className="space-y-3">
              {value.fixed.length === 0 && <Empty>No flat costs yet.</Empty>}
              {value.fixed.map((f) => (
                <FixedRow
                  key={f.id}
                  fixed={f}
                  disabled={disabled}
                  onPatch={(patch) => onChange(patchLine(value, "fixed", f.id, patch))}
                  onRemove={() => onChange(removeLine(value, "fixed", f.id))}
                />
              ))}
              <AddButton
                kind="fixed"
                disabled={disabled || value.fixed.length >= LINE_MAX.fixed}
                onClick={() => onChange(addFixed(value))}
              >
                Add a flat cost
              </AddButton>
            </div>

            <div className="space-y-2 border-t pt-4">
              <div className="grid gap-3 @lg:grid-cols-3">
                <Field label="Overhead" htmlFor={`${idBase}-overhead`}>
                  <AmountBox
                    id={`${idBase}-overhead`}
                    value={value.overhead_pct}
                    max={BOX_MAX.pct}
                    disabled={disabled}
                    after="%"
                    onChange={(overhead_pct) => onChange({ ...value, overhead_pct })}
                  />
                </Field>
                <Field label="Profit" htmlFor={`${idBase}-profit`}>
                  <AmountBox
                    id={`${idBase}-profit`}
                    value={value.profit_pct}
                    max={BOX_MAX.pct}
                    disabled={disabled}
                    after="%"
                    onChange={(profit_pct) => onChange({ ...value, profit_pct })}
                  />
                </Field>
                <Field label="Sales tax on materials" htmlFor={`${idBase}-tax`}>
                  <AmountBox
                    id={`${idBase}-tax`}
                    value={value.tax_pct}
                    max={BOX_MAX.pct}
                    disabled={disabled}
                    after="%"
                    onChange={(tax_pct) => onChange({ ...value, tax_pct })}
                  />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">
                Overhead is added to the cost. Profit is added on top of cost and overhead.
              </p>
              <p className="text-xs text-muted-foreground">
                Tax you pay the supplier. It is counted as a cost.
              </p>
            </div>

            <div className="space-y-2 border-t pt-4">
              <div className="grid gap-3 @lg:grid-cols-3">
                <Field label="People on the crew" htmlFor={`${idBase}-crew`}>
                  <AmountBox
                    id={`${idBase}-crew`}
                    value={value.crew_size}
                    max={BOX_MAX.crew}
                    disabled={disabled}
                    onChange={(crew_size) => onChange({ ...value, crew_size })}
                  />
                </Field>
                <Field label="Hours in a working day" htmlFor={`${idBase}-day`}>
                  <AmountBox
                    id={`${idBase}-day`}
                    value={value.hours_per_day}
                    max={BOX_MAX.hoursPerDay}
                    disabled={disabled}
                    onChange={(hours_per_day) => onChange({ ...value, hours_per_day })}
                  />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">
                These turn the labor hours into working days. They do not change the price.
              </p>
            </div>
          </CardContent>
        </Card>

        <AlertDialog open={!!asked} onOpenChange={(open) => !open && setRemoving(null)}>
          <AlertDialogContent data-dialog="remove-measure">
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {askedName}?</AlertDialogTitle>
              <AlertDialogDescription>
                {askedLines.length === 1 ? "1 line goes" : `${askedLines.length} lines go`} by{" "}
                {askedName}: {askedLines.join(", ")}.{" "}
                {askedLines.length === 1
                  ? "It stays, and will ask you to pick what it is measured by. Until then it adds nothing to the price."
                  : "They stay, and will ask you to pick what they are measured by. Until then they add nothing to the price."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (asked) onChange(removeMeasure(value, asked.id));
                  setRemoving(null);
                }}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </InvalidBoxes>
  );
}
