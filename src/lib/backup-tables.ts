/**
 * The one place the backup door (src/lib/backup-export.server.ts) and the restore door
 * (src/lib/restore-door.server.ts) agree on which names are tables and which tables the restore
 * refuses. Neither door hard-codes a table list: the backup copies whatever the data API
 * describes, the restore puts back whatever the catalog (restore_catalog()) holds, so a table
 * added next month is covered by both without a code change. restore-door.test.ts walks every
 * migration and fails if a table the migrations create is refused for any reason but this list.
 */

/** A plain Postgres identifier: what a table or bucket name has to look like to be served. */
export const NAME_RE = /^[a-z][a-z0-9_]{0,62}$/;

export const isPlainName = (v: unknown): v is string => typeof v === "string" && NAME_RE.test(v);

/**
 * Tables the restore never writes, mirrored by restore_deny_list() in
 * supabase/migrations/20261013100000_restore_door.sql (the test pins the two to the same set).
 * Empty today, on purpose (owner, Oct 13: "wouldn't the user accounts and secrets be needed?"):
 * app_secrets holds only the VAPID push-signing pair the app generated for itself
 * (notify.server.ts vapidKeys), readable by the service role alone, and restoring it is what
 * keeps every phone's push subscription valid; the real secrets (RESEND_API_KEY, BACKUP_SECRET,
 * RESTORE_SECRET, the Supabase keys) live in Lovable Cloud › Secrets, never in the database, so
 * no backup carries them. Anything genuinely unrestorable goes here, with the reason.
 */
export const RESTORE_DENY: readonly string[] = [];

export const isRestorable = (table: string): boolean => !RESTORE_DENY.includes(table);
