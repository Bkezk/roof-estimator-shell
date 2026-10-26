/**
 * One module on the page, drawn at screen scale the way it prints: letterhead (logo left, text
 * right), body, two columns, the four photo layouts, the editable table, the pricing table from
 * the record, the signature lines, a rule and an inserted PDF. Every edit goes through the
 * reducer (updateModule), and a small toolbar at the module's top-right on hover moves, copies,
 * saves or deletes it.
 */
import { useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Minus,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { IN_PX, pricingSourceFromVariables } from "@/lib/documents/editor-helpers";
import {
  type DocModule,
  duplicateModule,
  type FullPhotoModule,
  type ImageRef,
  type LetterheadModule,
  moveModule,
  type PhotoTextModule,
  type PricingTableModule,
  removeModule,
  resolveCellText,
  type SignatureModule,
  type TableModule,
  type TextAlign,
  type TwoColumnsModule,
  type TwoPhotosModule,
  updateModule,
} from "@/lib/documents/model";
import { pricingRows, variableLabel } from "@/lib/documents/variables";
import { cn } from "@/lib/utils";
import { NumberField } from "@/components/ui/number-field";
import { Switch } from "@/components/ui/switch";

import { useEditorEnv } from "./editor-context";
import { DocImage, ImageSlot } from "./photo-picker";
import { RichText } from "./rich-text";

// ------------------------------------------------------------------------------- the frame

export function ModuleView(props: {
  module: DocModule;
  /** Its place on the page, for the toolbar's ▲ ▼. */
  index: number;
  count: number;
}) {
  const env = useEditorEnv();
  const m = props.module;
  const set = (patch: (cur: DocModule) => DocModule) =>
    env.dispatch({ type: "setPages", op: (pages) => updateModule(pages, m.id, patch) });
  return (
    <div className="group/module relative" data-module-id={m.id} data-module-type={m.type}>
      <div
        className="absolute -top-3 right-0 z-10 hidden items-center gap-0.5 rounded-md border bg-popover p-0.5 text-popover-foreground shadow-md group-hover/module:flex"
        role="toolbar"
        aria-label="Module"
      >
        <IconButton
          title="Move up"
          onClick={() => env.dispatch({ type: "setPages", op: (p) => moveModule(p, m.id, -1) })}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          title="Move down"
          onClick={() => env.dispatch({ type: "setPages", op: (p) => moveModule(p, m.id, 1) })}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          title="Duplicate"
          onClick={() => env.dispatch({ type: "setPages", op: (p) => duplicateModule(p, m.id) })}
        >
          <Copy className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton title="Save as module…" onClick={() => env.onSaveModule(m)}>
          <BookmarkPlus className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          title="Delete"
          className="text-destructive"
          onClick={() => env.dispatch({ type: "setPages", op: (p) => removeModule(p, m.id) })}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="rounded-sm outline-1 outline-transparent group-hover/module:outline-dashed group-hover/module:outline-neutral-300">
        <ModuleBody module={m} set={set} />
      </div>
    </div>
  );
}

function IconButton(props: {
  title: string;
  onClick: () => void;
  className?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      className={cn("rounded p-1 hover:bg-accent hover:text-accent-foreground", props.className)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

type Setter = (patch: (cur: DocModule) => DocModule) => void;

function ModuleBody({ module: m, set }: { module: DocModule; set: Setter }) {
  switch (m.type) {
    case "letterhead":
      return <Letterhead m={m} set={set} />;
    case "body":
      return (
        <RichText
          key={m.id}
          value={m.text}
          placeholder="Type here, or / for a variable"
          onChange={(text) => set((c) => ({ ...c, text }) as DocModule)}
        />
      );
    case "twoColumns":
      return <TwoColumns m={m} set={set} />;
    case "fullPhoto":
      return <FullPhoto m={m} set={set} />;
    case "photoLeft":
    case "photoRight":
      return <PhotoText m={m} set={set} />;
    case "twoPhotos":
      return <TwoPhotos m={m} set={set} />;
    case "table":
      return <Table m={m} set={set} />;
    case "pricingTable":
      return <PricingTable m={m} set={set} />;
    case "signature":
      return <Signature m={m} set={set} />;
    case "hr":
      return <hr className="my-2 border-t border-neutral-800 dark:border-neutral-800" />;
    case "pdf":
      return (
        <div className="flex items-center gap-3 rounded-md bg-neutral-100 px-3 py-4 text-sm text-neutral-700 dark:bg-neutral-100 dark:text-neutral-700">
          <FileText className="h-5 w-5 shrink-0" />
          <span className="flex-1">
            Inserted PDF: <span className="font-medium">{m.name}</span>, {m.pageCount}{" "}
            {m.pageCount === 1 ? "page" : "pages"}
          </span>
          <span className="text-xs text-neutral-500">Prints as its own pages</span>
        </div>
      );
  }
}

// --------------------------------------------------------------------------------- pieces

const paperInput =
  "w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-inherit outline-none placeholder:text-neutral-400 hover:border-neutral-300 focus:border-neutral-400";

function Caption(props: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className={cn(paperInput, "mt-1 text-center text-xs italic")}
      placeholder="Caption"
      title="Caption under the picture"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

function Letterhead({ m, set }: { m: LetterheadModule; set: Setter }) {
  return (
    <div className="flex items-start gap-6">
      <div className="group/logo relative w-56 shrink-0">
        {m.logo ? (
          <DocImage image={{ kind: "logo" }} className="h-20 w-full object-left" alt="JBK logo" />
        ) : (
          <div className="h-20 w-full rounded-sm border border-dashed border-neutral-300 text-center text-xs leading-[5rem] text-neutral-400">
            No logo
          </div>
        )}
        <label className="absolute -bottom-5 left-0 hidden items-center gap-1 text-xs text-neutral-500 group-hover/logo:flex">
          <Switch
            checked={m.logo}
            onCheckedChange={(logo) => set((c) => ({ ...c, logo }) as DocModule)}
            title="Print the logo"
          />
          Logo
        </label>
      </div>
      <div className="min-w-0 flex-1">
        <RichText
          key={m.id}
          value={m.text}
          placeholder="Company block"
          onChange={(text) => set((c) => ({ ...c, text }) as DocModule)}
        />
      </div>
    </div>
  );
}

function TwoColumns({ m, set }: { m: TwoColumnsModule; set: Setter }) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <RichText
        key={`${m.id}-l`}
        value={m.left}
        placeholder="Left column"
        onChange={(left) => set((c) => ({ ...c, left }) as DocModule)}
      />
      <RichText
        key={`${m.id}-r`}
        value={m.right}
        placeholder="Right column"
        onChange={(right) => set((c) => ({ ...c, right }) as DocModule)}
      />
    </div>
  );
}

function FullPhoto({ m, set }: { m: FullPhotoModule; set: Setter }) {
  const heightPx = m.heightIn > 0 ? Math.round(m.heightIn * IN_PX) : undefined;
  return (
    <div className="group/photo">
      <ImageSlot
        image={m.image}
        heightPx={heightPx}
        onChange={(image) => set((c) => ({ ...c, image }) as DocModule)}
      />
      <div className="flex items-center gap-2">
        <Caption
          value={m.caption}
          onChange={(caption) => set((c) => ({ ...c, caption }) as DocModule)}
        />
        <label
          className="hidden shrink-0 items-center gap-1 text-xs text-neutral-500 group-hover/photo:flex"
          title="Printed height in inches; blank keeps the picture's shape"
        >
          Height
          <NumberField
            value={m.heightIn}
            min={0}
            max={9}
            step="0.5"
            inputMode="decimal"
            placeholder="auto"
            className="h-6 w-16 bg-transparent px-1 text-xs"
            onChange={(heightIn) => set((c) => ({ ...c, heightIn }) as DocModule)}
          />
          in
        </label>
      </div>
    </div>
  );
}

function PhotoText({ m, set }: { m: PhotoTextModule; set: Setter }) {
  const photo = (
    <div className="w-[45%] shrink-0">
      <ImageSlot image={m.image} onChange={(image) => set((c) => ({ ...c, image }) as DocModule)} />
      <Caption
        value={m.caption}
        onChange={(caption) => set((c) => ({ ...c, caption }) as DocModule)}
      />
    </div>
  );
  const text = (
    <div className="min-w-0 flex-1">
      <RichText
        key={m.id}
        value={m.text}
        placeholder="Text beside the photo"
        onChange={(t) => set((c) => ({ ...c, text: t }) as DocModule)}
      />
    </div>
  );
  return (
    <div className="flex items-start gap-6">
      {m.type === "photoLeft" ? (
        <>
          {photo}
          {text}
        </>
      ) : (
        <>
          {text}
          {photo}
        </>
      )}
    </div>
  );
}

function TwoPhotos({ m, set }: { m: TwoPhotosModule; set: Setter }) {
  const setImage = (i: 0 | 1, image: ImageRef | null) =>
    set((c) => {
      const cur = c as TwoPhotosModule;
      const images: [ImageRef | null, ImageRef | null] = [cur.images[0], cur.images[1]];
      images[i] = image;
      return { ...cur, images };
    });
  const setCaption = (i: 0 | 1, caption: string) =>
    set((c) => {
      const cur = c as TwoPhotosModule;
      const captions: [string, string] = [cur.captions[0], cur.captions[1]];
      captions[i] = caption;
      return { ...cur, captions };
    });
  return (
    <div className="grid grid-cols-2 gap-6">
      {([0, 1] as const).map((i) => (
        <div key={i}>
          <ImageSlot image={m.images[i]} onChange={(img) => setImage(i, img)} />
          <Caption value={m.captions[i]} onChange={(v) => setCaption(i, v)} />
        </div>
      ))}
    </div>
  );
}

const alignClass: Record<TextAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};
const NEXT_ALIGN: Record<TextAlign, TextAlign> = { left: "center", center: "right", right: "left" };
const AlignIcon = ({ align }: { align: TextAlign }) =>
  align === "left" ? (
    <AlignLeft className="h-3 w-3" />
  ) : align === "center" ? (
    <AlignCenter className="h-3 w-3" />
  ) : (
    <AlignRight className="h-3 w-3" />
  );

function Table({ m, set }: { m: TableModule; set: Setter }) {
  const env = useEditorEnv();
  const patch = (f: (t: TableModule) => TableModule) => set((c) => f(c as TableModule));
  const cols = m.columns.length;
  const setCell = (r: number, c: number, v: string) =>
    patch((t) => ({
      ...t,
      rows: t.rows.map((row, ri) => (ri === r ? row.map((x, ci) => (ci === c ? v : x)) : row)),
    }));
  const addRow = () => patch((t) => ({ ...t, rows: [...t.rows, Array<string>(cols).fill("")] }));
  const removeRow = (r: number) => patch((t) => ({ ...t, rows: t.rows.filter((_, i) => i !== r) }));
  const addColumn = () =>
    patch((t) => ({
      ...t,
      columns: [...t.columns, { title: "", align: "left" }],
      rows: t.rows.map((row) => [...row, ""]),
    }));
  const removeColumn = (c: number) =>
    patch((t) => ({
      ...t,
      columns: t.columns.filter((_, i) => i !== c),
      rows: t.rows.map((row) => row.filter((_, i) => i !== c)),
    }));
  const toggleAlign = (c: number) =>
    patch((t) => ({
      ...t,
      columns: t.columns.map((col, i) =>
        i === c ? { ...col, align: NEXT_ALIGN[col.align] } : col,
      ),
    }));
  const hasHeader = m.columns.some((c) => c.title.trim());
  return (
    <div className="group/table">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className={cn(!hasHeader && "opacity-60 group-hover/table:opacity-100")}>
            {m.columns.map((col, c) => (
              <th
                key={c}
                className={cn(
                  "border border-neutral-300 bg-neutral-100 p-0 font-semibold dark:bg-neutral-100",
                  alignClass[col.align],
                )}
              >
                <div className="flex items-center">
                  <input
                    className={cn(paperInput, "font-semibold", alignClass[col.align])}
                    placeholder="Heading"
                    title="Column heading (blank in every column = no header row)"
                    value={col.title}
                    onChange={(e) =>
                      patch((t) => ({
                        ...t,
                        columns: t.columns.map((x, i) =>
                          i === c ? { ...x, title: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <span className="hidden shrink-0 items-center group-hover/table:flex">
                    <button
                      type="button"
                      className="rounded p-0.5 text-neutral-500 hover:bg-neutral-200"
                      title={`Align: ${col.align} (click to change)`}
                      onClick={() => toggleAlign(c)}
                    >
                      <AlignIcon align={col.align} />
                    </button>
                    {cols > 1 ? (
                      <button
                        type="button"
                        className="rounded p-0.5 text-neutral-500 hover:bg-neutral-200"
                        title="Remove column"
                        onClick={() => removeColumn(c)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    ) : null}
                  </span>
                </div>
              </th>
            ))}
            <th className="w-6 border-0 p-0">
              <button
                type="button"
                className="hidden rounded p-0.5 text-neutral-500 hover:bg-neutral-200 group-hover/table:block"
                title="Add column"
                onClick={addColumn}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((row, r) => (
            <tr key={r}>
              {m.columns.map((col, c) => (
                <td key={c} className={cn("border border-neutral-300 p-0", alignClass[col.align])}>
                  <input
                    className={cn(paperInput, alignClass[col.align])}
                    title={
                      row[c]?.includes("{{")
                        ? `Prints: ${resolveCellText(row[c] ?? "", env.variables, variableLabel)}`
                        : "Cell ({{key}} prints a variable)"
                    }
                    value={row[c] ?? ""}
                    onChange={(e) => setCell(r, c, e.target.value)}
                  />
                </td>
              ))}
              <td className="w-6 border-0 p-0">
                <button
                  type="button"
                  className="hidden rounded p-0.5 text-neutral-500 hover:bg-neutral-200 group-hover/table:block"
                  title="Remove row"
                  onClick={() => removeRow(r)}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="mt-1 hidden items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800 group-hover/table:flex"
        title="Add a row"
        onClick={addRow}
      >
        <Plus className="h-3 w-3" /> Add row
      </button>
    </div>
  );
}

function PricingTable({ m, set }: { m: PricingTableModule; set: Setter }) {
  const env = useEditorEnv();
  const patch = (f: (t: PricingTableModule) => PricingTableModule) =>
    set((c) => f(c as PricingTableModule));
  const live = pricingRows(
    pricingSourceFromVariables(env.variables, env.mode === "template"),
    m.mode,
    m.showSections,
  );
  const rows = m.rows ?? live.rows;
  const editing = m.rows !== null;
  const setCell = (r: number, c: number, v: string) =>
    patch((t) => ({
      ...t,
      rows: (t.rows ?? live.rows).map((row, ri) =>
        ri === r ? row.map((x, ci) => (ci === c ? v : x)) : row,
      ),
    }));
  const right = (c: number) => c === 2 || c === live.columns.length - 1;
  return (
    <div className="group/pricing">
      <div className="mb-1 hidden items-center gap-3 text-xs text-neutral-500 group-hover/pricing:flex">
        <span title="From the document's checkbox (With prices)">
          Prices: {m.mode === "total" ? "with" : "without"}
        </span>
        <label className="flex items-center gap-1">
          <Switch
            checked={m.showSections}
            onCheckedChange={(showSections) => patch((t) => ({ ...t, showSections }))}
            title="One row per roof section"
          />
          Show sections
        </label>
        <span className="ml-auto flex items-center gap-2">
          {editing ? (
            <button
              type="button"
              className="underline hover:text-neutral-800"
              title="Back to the record's rows"
              onClick={() => patch((t) => ({ ...t, rows: null }))}
            >
              Reset
            </button>
          ) : (
            <button
              type="button"
              className="underline hover:text-neutral-800"
              title="Copy the rows so they can be edited by hand"
              onClick={() => patch((t) => ({ ...t, rows: live.rows.map((r) => [...r]) }))}
            >
              Edit rows
            </button>
          )}
        </span>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {live.columns.map((col, c) => (
              <th
                key={c}
                className={cn(
                  "border border-neutral-300 bg-neutral-100 px-2 py-1 font-semibold dark:bg-neutral-100",
                  right(c) ? "text-right" : "text-left",
                )}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={live.columns.length}
                className="border border-neutral-300 px-2 py-2 text-center text-xs text-neutral-500"
              >
                {m.mode === "none" && !m.showSections
                  ? "Nothing to show: prices are off and sections are hidden"
                  : "No roof sections on this record yet"}
              </td>
            </tr>
          ) : (
            rows.map((row, r) => {
              const total = row[0] === "Total";
              return (
                <tr key={r} className={cn(total && "font-semibold")}>
                  {live.columns.map((_, c) => (
                    <td
                      key={c}
                      className={cn(
                        "border border-neutral-300 px-2 py-1",
                        right(c) ? "text-right" : "text-left",
                      )}
                    >
                      {editing ? (
                        <input
                          className={cn(paperInput, right(c) ? "text-right" : "text-left")}
                          value={row[c] ?? ""}
                          onChange={(e) => setCell(r, c, e.target.value)}
                        />
                      ) : (
                        <span>{resolveCellText(row[c] ?? "", env.variables, variableLabel)}</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function Signature({ m, set }: { m: SignatureModule; set: Setter }) {
  const patch = (f: (t: SignatureModule) => SignatureModule) => set((c) => f(c as SignatureModule));
  return (
    <div className="group/sig mt-6">
      <div
        className="grid gap-x-10 gap-y-8"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
      >
        {m.lines.map((line, i) => (
          <div key={i} className="relative">
            <div className="h-8 border-b border-neutral-800 dark:border-neutral-800" />
            <div className="flex items-center">
              <input
                className={cn(paperInput, "text-xs")}
                placeholder="Line label"
                title="What goes on this line"
                value={line}
                onChange={(e) =>
                  patch((t) => ({
                    ...t,
                    lines: t.lines.map((x, j) => (j === i ? e.target.value : x)),
                  }))
                }
              />
              {m.lines.length > 1 ? (
                <button
                  type="button"
                  className="hidden rounded p-0.5 text-neutral-500 hover:bg-neutral-200 group-hover/sig:block"
                  title="Remove line"
                  onClick={() => patch((t) => ({ ...t, lines: t.lines.filter((_, j) => j !== i) }))}
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-1 hidden items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800 group-hover/sig:flex"
        title="Add a signature line"
        onClick={() => patch((t) => ({ ...t, lines: [...t.lines, ""] }))}
      >
        <Plus className="h-3 w-3" /> Add line
      </button>
    </div>
  );
}
