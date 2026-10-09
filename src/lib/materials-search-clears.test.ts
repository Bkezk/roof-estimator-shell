/**
 * Owner, Oct 9: "once you've added a material in the close out workflow the find any material
 * search bar should clear." The box (aria-label "Find any material", bound to `find`) kept what
 * was typed after a result chip was tapped, so the results stayed over the new line. Now it
 * clears when the add LANDS — in the same place the new "On this ticket" line gets focus (the
 * chip's `focusAfter`), which every search-result add reaches: the chip itself, and the
 * short-stock question's "It came from … — log it" (add(s.r, s.units, false, true) on the same
 * cell). A refused add (the server's "Only N … on the shelf", a failed call) keeps the text.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/service/materials-section.tsx", "utf8");
const add = src.slice(src.indexOf("const add = (r: ListRow"), src.indexOf("/** Take `units` back"));

describe("the Find any material box clears after an add from its results", () => {
  it("the box is the `find` state (not the truck fold's `search`)", () => {
    expect(src).toMatch(
      /aria-label="Find any material"\s*value=\{find\}\s*onChange=\{\(e\) => setFind\(e\.target\.value\)\}/,
    );
    expect(src).toContain('const [find, setFind] = useState("");');
  });
  it("clears on the landing of a search-result add, with the focus hand-off — not before the call, not on a refusal", () => {
    // Every search-result add marks the cell first…
    expect(src).toMatch(/focusAfter\.current = r\.key;\s*add\(r, 1, src\.on_hand !== null\);/);
    // …and the clear sits inside the landed branch, after record() returned.
    expect(add).toMatch(
      /await record\(r, units, "consumed", ok\);[\s\S]*?if \(focusAfter\.current === r\.key\) \{\s*focusAfter\.current = null;\s*setFocusKey\(r\.key\);\s*setFind\(""\);\s*\}/,
    );
    expect(add.match(/setFind\(""\)/g)).toHaveLength(1);
    // The refusal path (the short question) returns before it; a thrown error never reaches it.
    const catchBlock = add.slice(
      add.indexOf("} catch (e) {"),
      add.indexOf("if (focusAfter.current"),
    );
    expect(catchBlock).not.toContain("setFind");
    expect(catchBlock).toMatch(/setShort\(\{ r, units \}\);\s*return;\s*\}\s*throw e;/);
    // The short dialog's yes goes through the same add, so the same landing clears the box.
    expect(src).toContain("add(s.r, s.units, false, true);");
  });
  it("nothing else clears it: the chip tap, the dialog and the search typing leave it alone", () => {
    const outsideAdd = src.replace(add, "");
    expect(outsideAdd.match(/setFind\(/g)).toHaveLength(1); // the input's onChange
  });
});
