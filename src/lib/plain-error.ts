/**
 * Error messages in plain English (owner, Nov 3, service review item 49): a technician on a
 * roof used to see "new row violates row-level security policy", "duplicate key value violates
 * unique constraint …", a JSON array from a refused input, or "Forbidden: Service access
 * required". One place turns what the server or the database said into a sentence; a message
 * already written for people passes through unchanged. Pure, tested.
 */

/** A refused input (zod) reaches the browser as the JSON text of its issues. */
function fromIssues(raw: string): string | null {
  const t = raw.trim();
  if (!t.startsWith("[")) return null;
  try {
    const issues = JSON.parse(t) as unknown;
    if (!Array.isArray(issues)) return null;
    const messages = [
      ...new Set(
        issues
          .map((i) => (i && typeof i === "object" ? (i as { message?: unknown }).message : null))
          .filter((m): m is string => typeof m === "string" && m.trim().length > 0),
      ),
    ];
    return messages.length ? messages.join("; ") : "Something in the form is not right";
  } catch {
    return null;
  }
}

const RULES: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  [/row-level security/i, "You do not have permission to change this. Ask the office."],
  [/duplicate key value/i, "That one already exists."],
  [
    /JSON object requested, multiple \(or no\) rows|PGRST116/,
    "That record was not found. It may have been deleted.",
  ],
  [
    /Failed to fetch|NetworkError|Load failed|network error|ERR_NETWORK|ERR_INTERNET|fetch failed/i,
    "No signal. Check your connection and try again.",
  ],
  [/^Unauthorized\b/, "You are signed out. Sign in again."],
  [/^Forbidden: admin only$/, "Only an admin can do this."],
  [/^Forbidden: (.+?) access required$/i, (m) => `You do not have ${m[1]} access. Ask an admin.`],
  [/^Forbidden: (.+)$/, (m) => `${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1)}`],
  [/violates check constraint/i, "That value is not allowed here."],
  [/violates foreign key constraint/i, "That is linked to something that no longer exists."],
  [/violates not-null constraint/i, "Something required is missing."],
  [/statement timeout|canceling statement/i, "That took too long. Try again in a moment."],
];

/** The message as a person should read it. */
export function plainError(raw: string): string {
  const issues = fromIssues(raw);
  if (issues) return issues;
  for (const [re, out] of RULES) {
    const m = raw.match(re);
    if (m) return typeof out === "string" ? out : out(m);
  }
  return raw;
}

/** `errText` for every screen: the thrown thing's message, made plain. */
export const plainErrText = (e: unknown): string =>
  plainError(e instanceof Error ? e.message : String(e));
