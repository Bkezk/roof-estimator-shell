/**
 * Owner, Oct 9: "you cant easily get rid of materials if you accidentally add them on the close
 * out workflow." The "On this ticket" rows had − (one unit) and the typed count only; taking a
 * whole line off meant tapping − per piece or typing 0. Now each row has Remove (a trash button,
 * "Remove <name>"): one tap, no confirm, takes the whole line back the way − does (planReduce:
 * the tech's own fresh entries are undone — the movement deleted, RLS allows own entries for
 * 24 h — else a `released` movement the server caps at what the ticket took; the stock goes back
 * to the cell it came from and the caches move as the add moved them), with Undo on the toast
 * that logs the same amount again from the same place. − still steps a count down by one.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { planReduce } from "@/components/service/materials-utils";
import { removeLabel, removedToast } from "@/lib/materials-remove";

const src = readFileSync("src/components/service/materials-section.tsx", "utf8");
const form = src.slice(0, src.indexOf("function TruckRow("));
const row = src.slice(src.indexOf("function TruckRow("));
const reduce = src.slice(
  src.indexOf("const reduce = (r: ListRow"),
  src.indexOf("const removeRow = "),
);
const removeRow = src.slice(
  src.indexOf("const removeRow = "),
  src.indexOf("/** Set the ticket's total"),
);

describe("the words (pure)", () => {
  it("the button is named for the material; the toast says what was removed", () => {
    expect(removeLabel("Caulk, clear")).toBe("Remove Caulk, clear");
    expect(removedToast("Caulk, clear", 3, { name: "cartridge", perPack: 12 }, "CS")).toBe(
      "Removed 3 cartridges of Caulk, clear",
    );
    expect(removedToast("Caulk, clear", 1, { name: "cartridge", perPack: 12 }, "CS")).toBe(
      "Removed 1 cartridge of Caulk, clear",
    );
    expect(removedToast("Membrane", 2, null, "RL")).toBe("Removed 2 RLs of Membrane");
  });
});

describe("the whole line comes back the way the add went (planReduce)", () => {
  it("one own fresh entry of the whole amount: undo it (the movement is deleted, the stock is back)", () => {
    expect(planReduce([{ id: 7, units: 3 }], 3, true)).toEqual([{ kind: "undo", id: 7, units: 3 }]);
  });
  it("several own taps (+ + +): one release of the lot, capped by the server at what the ticket took", () => {
    expect(
      planReduce(
        [
          { id: 9, units: 1 },
          { id: 8, units: 1 },
          { id: 7, units: 1 },
        ],
        3,
        true,
      ),
    ).toEqual([{ kind: "release", units: 3 }]);
  });
  it("someone else's or an old entry (nothing of mine to undo): a release", () => {
    expect(planReduce([], 2, true)).toEqual([{ kind: "release", units: 2 }]);
  });
});

describe("the screen", () => {
  it("every On this ticket line with something used gets Remove; the truck fold and the browse panel do not", () => {
    expect(row).toContain("onRemove?: (() => void) | undefined;");
    expect(row).toMatch(
      /\{onRemove && used > EPS && \([\s\S]*?<Button\s+type="button"\s+variant="ghost"\s+size="sm"[\s\S]*?aria-label=\{removeLabel\(cellName\(row\)\)\}\s+onClick=\{onRemove\}\s*>\s*<Trash2 className="mr-1 h-4 w-4" \/> Remove/,
    );
    expect(form).toMatch(
      /aria-label="On this ticket"[\s\S]*?<TruckRow[\s\S]*?onReduce=\{\(n\) => reduce\(r, n\)\}[\s\S]*?onRemove=\{\(\) => removeRow\(r, r\.known\)\}/,
    );
    expect(form.match(/onRemove=/g)).toHaveLength(1);
    expect(src).toContain('import { removeLabel, removedToast } from "@/lib/materials-remove";');
  });
  it("one tap, no confirm: the whole used amount goes through reduce (undo own entries, else release), the stock back where it came from", () => {
    expect(removeRow).toMatch(
      /const units = usedUnits\(r\);\s*if \(!\(units > EPS\)\) return;\s*reduce\(r, units, \(\) =>/,
    );
    expect(src).not.toContain("window.confirm");
    expect(src).not.toContain("Remove this material?");
    // reduce plans against the live ledger and reports when every step landed.
    expect(reduce).toContain(
      "const reduce = (r: ListRow, units: number, onDone?: () => void) => {",
    );
    expect(reduce).toContain(
      "const plan = planReduce(ownFreshEntries(now, r, r.piece, myName), units, canRelease);",
    );
    expect(reduce).toMatch(/if \(step\.kind === "undo"\) await undo\(r, step\.id\);/);
    expect(reduce).toMatch(
      /else if \(step\.kind === "release"\) await record\(r, step\.units, "released"\);/,
    );
    expect(reduce).toMatch(/\}\s*\}\s*onDone\?\.\(\);\s*\}\);\s*\};/);
    // The caches move as the add moved them: undo drops the ledger row and puts the on-hand back;
    // a release adds its row and moves the on-hand the same way (recorded → moveTruck).
    expect(form).toMatch(
      /const undo = async \(r: ListRow, id: number\) => \{\s*await undoFn\(\{ data: \{ id \} \}\);[\s\S]*?old\?\.filter\(\(m\) => m\.id !== id\),\s*\);\s*if \(gone\) moveTruck\(r, -Number\(gone\.qty\)\);/,
    );
    expect(form).toMatch(/recorded\(r, res, [\s\S]*?\);\s*\};/);
    expect(form).toContain("moveTruck(r, res.qty);");
  });
  it("the toast carries Undo, which logs the same amount again from the same place (stock checked as the row's + is)", () => {
    expect(removeRow).toMatch(
      /toast\.success\(removedToast\(cellName\(r\), units, r\.piece, r\.unit\), \{\s*action: \{ label: "Undo", onClick: \(\) => add\(r, units, known\) \},\s*\}\),/,
    );
    expect(src).toContain('import { toast } from "sonner";');
  });
  it("a count above one still steps down by one with −", () => {
    expect(row).toContain("onClick={() => onReduce(Math.min(1, used))}");
    expect(row).toContain("disabled={used <= EPS}");
  });
});

describe("the server and RLS let a technician take it back (no assumption)", () => {
  const inv = readFileSync("src/lib/inventory.functions.ts", "utf8");
  it("undoMovement deletes the tech's own entry within 24 h; the delete policy says the same", () => {
    expect(inv).toContain("const mine = row.created_by === context.userId;");
    expect(inv).toContain(
      "const fresh = Date.now() - Date.parse(row.created_at) < 24 * 3600 * 1000;",
    );
    expect(inv).toContain('if (me?.role !== "admin" && !(mine && fresh))');
    const policy = readFileSync(
      "supabase/migrations/20260924080000_inventory_undo_own.sql",
      "utf8",
    );
    expect(policy).toContain(
      "create policy inventory_movements_delete on public.inventory_movements",
    );
    expect(policy).toContain(
      "or (created_by = auth.uid() and created_at > now() - interval '24 hours')",
    );
  });
  it("a `released` movement against a ticket is allowed for anyone who may log material, capped at what the ticket took", () => {
    expect(inv).toContain(
      'const jobRelease = data.reason === "released" && !!data.service_job_id;',
    );
    expect(inv).toContain(
      "This ticket only took ${Math.round(net * 1000) / 1000} ${unit} from ${location.name}",
    );
    const policy = readFileSync("supabase/migrations/20260926120000_service_phase_a.sql", "utf8");
    expect(policy).toContain("or (reason = 'released' and service_job_id is not null)))");
    // The screen lets every login that may log material release (the server caps it).
    expect(src).toContain("const canRelease = canLog;");
  });
});
