/**
 * Row security checks the person once per query (owner, Nov 10; speed pass findings 1, 2, 10).
 *
 * A policy that calls `has_access('prospect')` bare runs it for every row; written as
 * `(select has_access('prospect'))` Postgres runs it once and reuses the answer. Migration
 * 20261110210000_rls_check_once_per_query.sql rewrote every policy that way with one regular
 * expression. This is that expression's twin, so the rule can be unit tested and so a later
 * migration that adds a bare call is caught (rls-check-once-nov10b.test.ts).
 *
 * Pure: no database.
 */

/** The helpers that ask about the PERSON, not the row: safe to run once per query. */
export const RLS_ONCE_HELPERS = [
  "has_access",
  "is_admin",
  "is_manager",
  "documents_access",
  "is_technician",
  "is_sales_pm",
  "can_claim",
] as const;
/** Supabase's own two, schema-qualified. */
export const RLS_ONCE_AUTH = ["uid", "role"] as const;

const NAMES = `(?:public\\.)?(?:${RLS_ONCE_HELPERS.join("|")})|auth\\.(?:${RLS_ONCE_AUTH.join("|")})`;
/** A page name the way Postgres prints a policy (`'x'::text`) or the way a migration writes it. */
const ARG = `(?:'[a-z_]+'(?:::text)?)?`;

/** The migration's pattern, as text (its `\m` word start is `\b` here). */
export const RLS_WRAP_SQL_PATTERN = `(?<!SELECT )\\m((?:public\\.)?(?:${RLS_ONCE_HELPERS.join("|")})|auth\\.(?:${RLS_ONCE_AUTH.join("|")}))\\(((?:''[a-z_]+''::text)?)\\)`;

const bare = () => new RegExp(`(?<!select\\s{1,3})(?<![a-z_.])(${NAMES})\\((${ARG})\\)`, "gi");

/** A policy expression with every person-helper call wrapped; an already wrapped call is left. */
export function wrapPolicyExpr(expr: string): string {
  return expr.replace(bare(), "( SELECT $1($2))");
}

/** The person-helper calls in a piece of SQL that are NOT wrapped in a select. */
export function bareHelperCalls(sql: string): string[] {
  return [...sql.matchAll(bare())].map((m) => m[0]);
}

/**
 * The `create policy` / `alter policy` statements of a migration, comments removed. (The Nov 10
 * migration itself builds its statements at run time, so it has none to list.)
 */
export function policyStatements(sql: string): string[] {
  const flat = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
  return [...flat.matchAll(/\b(?:create|alter) policy\b[^;]*;/gi)].map((m) => m[0]);
}
