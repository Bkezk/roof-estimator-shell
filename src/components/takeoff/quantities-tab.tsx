/**
 * Quantities tab — what the drawing measures, straight from `takeoffQuantities`: sections,
 * linears, counts, totals, and the objects that cannot be measured yet (no scale on their page).
 * "Export CSV" writes every row into one file named after the takeoff.
 */
import { AlertTriangle, Download } from "lucide-react";

import {
  COUNT_ROLE_LABELS,
  LINEAR_ROLE_LABELS,
  type CountQuantity,
  type TakeoffPage,
  type TakeoffQuantities,
} from "@/lib/takeoff/model";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { csvLine, downloadText, fmtNum } from "./shapes";

const CSV_HEADER = [
  "Type",
  "Name",
  "Page",
  "Role",
  "Area (sq ft)",
  "Perimeter (ft)",
  "Sides",
  "Layout L (ft)",
  "Layout W (ft)",
  "Length (ft)",
  "Height (in)",
  "Qty",
  "Size (in)",
  "Curb W (in)",
  "Curb L (in)",
  "Drain roof type",
  "Reuse rings",
  "Drain boot",
  "Drain ring",
];
const DRAIN_COLS = 4;

/** "Boot · ring" for a drain row; the missing part named, so it is clear what is left to pick. */
function drainPicksLabel(c: CountQuantity): { text: string; complete: boolean } {
  if (!c.bootSize && !c.ringSize) return { text: "no boot / ring picked", complete: false };
  return {
    text: `${c.bootSize ?? "no boot picked"} · ${c.ringSize ?? "no ring picked"}`,
    complete: !!c.bootSize && !!c.ringSize,
  };
}

function quantitiesCsv(q: TakeoffQuantities, pageName: (i: number) => string): string {
  const rows: string[] = [csvLine(CSV_HEADER)];
  const blank = (n: number) => Array<string>(n).fill("");
  for (const s of q.sections)
    rows.push(
      csvLine([
        "Section",
        s.name,
        pageName(s.page),
        "",
        s.areaSqFt,
        s.perimeterFt,
        s.edgeLengthsFt.length,
        s.section.length,
        s.section.width,
        ...blank(6 + DRAIN_COLS),
      ]),
    );
  for (const l of q.linears)
    rows.push(
      csvLine([
        "Linear",
        l.name,
        pageName(l.page),
        LINEAR_ROLE_LABELS[l.role],
        ...blank(5),
        l.lengthFt,
        l.heightIn,
        ...blank(4 + DRAIN_COLS),
      ]),
    );
  for (const c of q.counts)
    rows.push(
      csvLine([
        "Count",
        c.name,
        "",
        COUNT_ROLE_LABELS[c.role],
        ...blank(7),
        c.qty,
        c.sizeIn,
        c.widthIn,
        c.lengthIn,
        ...(c.role === "drain"
          ? [c.roofType, c.reuseRings ? "Yes" : "", c.bootSize, c.ringSize]
          : blank(DRAIN_COLS)),
      ]),
    );
  rows.push(
    csvLine(["Total", "Roof area", "", "", q.totals.roofAreaSqFt, ...blank(10 + DRAIN_COLS)]),
  );
  rows.push(
    csvLine(["Total", "Perimeter", "", "", "", q.totals.perimeterFt, ...blank(9 + DRAIN_COLS)]),
  );
  rows.push(
    csvLine([
      "Total",
      "Parapet",
      "",
      "",
      ...blank(5),
      q.totals.parapetFt,
      ...blank(5 + DRAIN_COLS),
    ]),
  );
  for (const u of q.unscaled)
    rows.push(
      csvLine(["Unscaled (no scale on page)", u.name, pageName(u.page), ...blank(12 + DRAIN_COLS)]),
    );
  return rows.join("\r\n") + "\r\n";
}

const H = (p: { children: React.ReactNode; right?: boolean }) => (
  <TableHead className={`h-8 px-2 text-xs ${p.right ? "text-right" : ""}`}>{p.children}</TableHead>
);
const C = (p: { children: React.ReactNode; right?: boolean }) => (
  <TableCell className={`px-2 py-1 text-xs ${p.right ? "text-right tabular-nums" : ""}`}>
    {p.children}
  </TableCell>
);

export function QuantitiesTab(props: {
  name: string;
  pages: readonly TakeoffPage[];
  quantities: TakeoffQuantities;
}) {
  const q = props.quantities;
  const pageName = (i: number) => props.pages.find((p) => p.index === i)?.name ?? `Page ${i + 1}`;
  const exportCsv = () => {
    const base = props.name.trim().replace(/[^A-Za-z0-9 ._-]+/g, "_") || "takeoff";
    downloadText(`${base} quantities.csv`, quantitiesCsv(q, pageName));
  };
  const countTotal = q.counts.reduce((s, c) => s + c.qty, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Measured from the drawing, in feet.</p>
        <Button size="sm" variant="outline" onClick={exportCsv}>
          <Download className="mr-1 h-4 w-4" /> Export CSV
        </Button>
      </div>

      {q.unscaled.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100">
          <p className="flex items-center gap-1 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" /> Not measured — no scale on their page:
          </p>
          <ul className="ml-5 list-disc">
            {q.unscaled.map((u) => (
              <li key={u.objectId}>
                {u.name} ({pageName(u.page)})
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Totals</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="Roof area" value={`${fmtNum(q.totals.roofAreaSqFt, 0)} sq ft`} />
          <Stat label="Perimeter" value={`${fmtNum(q.totals.perimeterFt)} ft`} />
          <Stat label="Parapet" value={`${fmtNum(q.totals.parapetFt)} ft`} />
          <Stat label="Counted items" value={String(countTotal)} />
        </div>
      </section>

      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Sections</h3>
        {q.sections.length === 0 ? (
          <p className="text-xs text-muted-foreground">No measured areas yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <H>Name</H>
                <H>Page</H>
                <H right>Sq ft</H>
                <H right>Perim ft</H>
                <H right>Sides</H>
                <H right>L × W</H>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.sections.map((s) => (
                <TableRow key={s.objectId}>
                  <C>{s.name}</C>
                  <C>{pageName(s.page)}</C>
                  <C right>{fmtNum(s.areaSqFt, 0)}</C>
                  <C right>{fmtNum(s.perimeterFt)}</C>
                  <C right>{s.edgeLengthsFt.length}</C>
                  <C right>
                    {fmtNum(s.section.length)} × {fmtNum(s.section.width)}
                  </C>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Linears</h3>
        {q.linears.length === 0 ? (
          <p className="text-xs text-muted-foreground">No measured lines yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <H>Name</H>
                <H>Role</H>
                <H right>Ft</H>
                <H right>Height in</H>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.linears.map((l) => (
                <TableRow key={l.objectId}>
                  <C>{l.name}</C>
                  <C>{LINEAR_ROLE_LABELS[l.role]}</C>
                  <C right>{fmtNum(l.lengthFt)}</C>
                  <C right>{l.heightIn ?? ""}</C>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Counts</h3>
        {q.counts.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing counted yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <H>Name</H>
                <H>Role</H>
                <H right>Qty</H>
                <H right>Size</H>
                <H>Drain boot · ring</H>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.counts.map((c) => (
                <TableRow key={c.objectIds.join(",")}>
                  <C>{c.name}</C>
                  <C>{COUNT_ROLE_LABELS[c.role]}</C>
                  <C right>{c.qty}</C>
                  <C right>
                    {[
                      c.sizeIn !== undefined ? `${c.sizeIn} in` : "",
                      c.widthIn !== undefined || c.lengthIn !== undefined
                        ? `${c.widthIn ?? "?"} × ${c.lengthIn ?? "?"} in`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </C>
                  <C>
                    {c.role === "drain" &&
                      (() => {
                        const d = drainPicksLabel(c);
                        return (
                          <span
                            className={d.complete ? "" : "text-amber-700 dark:text-amber-400"}
                            title={
                              d.complete
                                ? `Goes into the bid's Roof Drains & Boots${c.roofType ? ` (roof: ${c.roofType})` : ""}${c.reuseRings ? ", reusing the existing rings" : ""}`
                                : "Not carried into the bid until a boot and a ring are picked (Objects tab)"
                            }
                          >
                            {d.text}
                            {c.reuseRings && d.complete ? " (reuse rings)" : ""}
                          </span>
                        );
                      })()}
                  </C>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-2 py-1.5">
      <div className="text-[11px] text-muted-foreground">{props.label}</div>
      <div className="font-semibold tabular-nums">{props.value}</div>
    </div>
  );
}
