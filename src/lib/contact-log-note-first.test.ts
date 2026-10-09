/**
 * Contact buttons (owner, Oct 1): "have the note already opened as to encourage them to add a
 * note when they click call/text/email/visit". A tap picks the method and opens the note; Save
 * (or Ctrl/⌘+Enter) logs the contact with the note when there is one.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/crm/contact-log.tsx", "utf8");
const buttons = src.slice(
  src.indexOf("export function LogContactButtons("),
  src.indexOf("export function ContactLogList("),
);

describe("LogContactButtons: tap opens the note, Save logs", () => {
  it("a tap picks the method instead of logging at once", () => {
    expect(buttons).toContain("const [picked, setPicked] = useState<ContactMethod | null>(null);");
    expect(buttons).toContain("onClick={() => setPicked(on ? null : method)}");
    expect(buttons).not.toContain("onClick={() => log.mutate(method)}");
    expect(buttons).toContain("aria-pressed={on}");
  });
  it("the note opens for the picked method, focused, with a hint for that method", () => {
    expect(buttons).toContain("{picked && (");
    expect(buttons).toContain("autoFocus");
    expect(buttons).toContain('placeholder={NOTE_HINTS[picked] ?? "What was said or learned"}');
    expect(src).toContain("const NOTE_HINTS: Partial<Record<ContactMethod, string>> = {");
    for (const m of ["called", "texted", "emailed", "visited"])
      expect(src).toContain(`  ${m}: "e.g. `);
  });
  it("Save logs the picked method (the note along when there is one); Ctrl/⌘+Enter too; Cancel clears", () => {
    // Since Oct 9 Save also waits for a valid "They asked to try again on" (holdReady).
    expect(buttons).toContain("if (picked && !log.isPending && holdReady) log.mutate(picked);");
    expect(buttons).toContain('if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {');
    expect(buttons).toContain("Save {CONTACT_METHOD_LABELS[picked]}");
    // Since Oct 9 the label also says "and hold until <day>" when a try-again date is set.
    expect(buttons.replace(/\s+/g, " ")).toContain(
      '{tryAgain ? ` and hold until ${shortDay(tryAgain)}` : note.trim() ? "" : " without a note"}',
    );
    expect(buttons).toContain("...(n ? { note: n } : {})");
    expect(buttons).toContain('<X className="mr-1 h-3.5 w-3.5" /> Cancel');
    // The old "+ note" toggle is gone.
    expect(buttons).not.toContain("noteOpen");
    expect(buttons).not.toContain('"No note"');
  });
});
