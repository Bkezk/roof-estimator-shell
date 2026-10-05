/**
 * @mentions in a ticket note (service study M3, owner Oct 5). CenterPoint's notes say "Still
 * Leaking … @Brandon Keck @Garry Peters" and the named people get it in their bell; the portal's
 * notes notified no one. Typing "@" in the Timeline's note box suggests people; picking one
 * writes "@Full Name " into the text. When the note is saved the server reads the names back
 * out of the text (so a pasted or hand-typed "@Brandon Keck" counts too) and notifies each
 * person once — inbox, plus email / push by their own settings — never the writer.
 * Pure, so it is tested without the screen or the server.
 */

export interface Person {
  id: string;
  name: string;
}

/**
 * The "@…" being typed at the caret, for the suggestion list: the text after the "@" (may be
 * ""), or null when the caret is not in a mention. An "@" counts only at the start or after a
 * space / newline (so an email address does not open the list); at most 30 characters and
 * two spaces in, which covers "First Middle Last".
 */
export function mentionQuery(text: string, caret: number): { at: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || /\n/.test(query) || (query.match(/ /g) ?? []).length > 2) return null;
  return { at, query };
}

/** People whose name starts with (or has a word starting with) the query, A–Z, at most 6. */
export function suggestPeople(people: Person[], query: string): Person[] {
  const q = query.trim().toLowerCase();
  return people
    .filter((p) => {
      const n = p.name.toLowerCase();
      return !q || n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q));
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 6);
}

/** Replace the "@query" at `at` with "@Name " and say where the caret goes. */
export function insertMention(
  text: string,
  at: number,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const insert = `@${name} `;
  return { text: text.slice(0, at) + insert + text.slice(caret), caret: at + insert.length };
}

/**
 * Who a note mentions: everyone whose full name follows an "@" (any case), each once, in the
 * order first mentioned. Longer names are tried first so "@Mark Barger" is not read as a
 * shorter "@Mark". A name must end at a word boundary.
 */
export function mentionedIds(text: string, people: Person[]): string[] {
  const lower = text.toLowerCase();
  const byLength = [...people]
    .filter((p) => p.name.trim())
    .sort((a, b) => b.name.length - a.name.length);
  const hits: { id: string; index: number }[] = [];
  const taken: [number, number][] = [];
  for (const p of byLength) {
    const needle = `@${p.name.trim().toLowerCase()}`;
    let from = 0;
    for (;;) {
      const i = lower.indexOf(needle, from);
      if (i < 0) break;
      from = i + 1;
      const end = i + needle.length;
      const boundaryBefore = i === 0 || /[\s([]/.test(lower[i - 1]!);
      const boundaryAfter = end === lower.length || /[^a-z0-9]/.test(lower[end]!);
      if (!boundaryBefore || !boundaryAfter) continue;
      if (taken.some(([s, e]) => i < e && end > s)) continue;
      taken.push([i, end]);
      if (!hits.some((h) => h.id === p.id)) hits.push({ id: p.id, index: i });
    }
  }
  return hits.sort((a, b) => a.index - b.index).map((h) => h.id);
}
