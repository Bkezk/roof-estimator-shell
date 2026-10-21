/**
 * Owner, Oct 21: "when someone clicks on previous repairs at this property on the My tickets
 * link it centers on the history at this property box and that's the only box expanded".
 * Arriving with ?open=history: the page provides FoldAllContext = 1, every self-managed Box
 * closes for that visit (its remembered state untouched), the controlled History fold stays
 * open, and the scroll centres it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const box = read("src/components/service/field-shared.tsx");
const page = read("src/components/service-page.tsx");

describe("Box folds on the page's token, remembered state untouched", () => {
  it("exports the context and reads it", () => {
    expect(box).toContain("export const FoldAllContext = createContext(0);");
    expect(box).toContain("const foldAll = useContext(FoldAllContext);");
  });
  it("a self-managed Box closes when the token is set; a controlled one is left to its parent", () => {
    expect(flat(box)).toContain(
      "useEffect(() => { if (foldAll && controlledOpen === undefined) setOwnOpen(false); }, [foldAll, controlledOpen]);",
    );
    // It sets state only — never writeSection, so the next visit opens as the user left it.
    const effect = box.slice(
      box.indexOf("const foldAll = useContext"),
      box.indexOf("const open = controlledOpen ?? ownOpen;"),
    );
    expect(effect).not.toContain("writeSection");
  });
});

describe("the ticket page on arrival at the history", () => {
  it("provides the token only when it arrived for the history, around both section layouts", () => {
    expect(page).toContain('import { FoldAllContext } from "@/components/service/field-shared";');
    const provider = page.indexOf("<FoldAllContext.Provider value={arrivedAtHistory ? 1 : 0}>");
    const twoPane = page.indexOf("{twoPane && job ? (");
    const close = page.indexOf("</FoldAllContext.Provider>");
    expect(provider).toBeGreaterThan(0);
    expect(twoPane).toBeGreaterThan(provider);
    expect(close).toBeGreaterThan(twoPane);
    // Both HistoryFold renderings (side column and stacked) sit inside it.
    const inside = page.slice(provider, close);
    expect(
      inside.match(
        /<HistoryFold job=\{job\} open=\{historyOpen\} onOpenChange=\{setHistoryOpen\} \/>/g,
      ),
    ).toHaveLength(2);
  });
  it("the History fold is controlled (so the fold-all leaves it open) and the scroll centres it", () => {
    expect(page).toContain(
      "const [historyOpen, setHistoryOpen] = useState(prefill.open === HISTORY_OPEN_PARAM);",
    );
    expect(flat(page)).toContain('?.scrollIntoView({ behavior: "smooth", block: "center" })');
    expect(page).not.toContain('block: "start" }),');
  });
  it("the My tickets strip still links with ?open=history", () => {
    expect(read("src/components/service/site-history.tsx")).toContain(
      "search={{ id: jobId, open: HISTORY_OPEN_PARAM }}",
    );
  });
});
