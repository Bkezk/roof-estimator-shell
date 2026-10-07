# Nightly backup to the office server (Windows)

Owner, Oct 7 2026: a copy of everything in the portal, saved nightly on our server, two days deep
(tonight replaces the older of the two), so a bad or empty save can never wipe the data. The
server is the Windows machine the office drives come from (`\\server`: J:, X: "JBK Community",
Y: Peachtree). The backup goes into **one new folder on X:** and nowhere else.

What is in a backup folder (`X:\JBK Portal Backups\backup-2026-10-07\`):

| File | What |
| --- | --- |
| `db.dump` | The whole portal database (schema `public`): bids, tickets, customers, properties, contacts, opportunities, invoices, settings, the audit log, inventory, leads. PostgreSQL custom format, restorable with `pg_restore`. |
| `storage\service\…`, `storage\takeoffs\…` | Ticket photos, signatures, receipts, invoice PDFs, takeoff plans — the files as uploaded. |
| `manifest.json` | When, the dump size, the row counts of the key tables, how many files. Tomorrow's run compares against it. |

In the root: `backup.log` (every run), `status.json` (the last run), `weekly\` (Sunday dumps, the
newest five), and `LAST-BACKUP-FAILED.txt` only when the last run failed.

User logins (the `auth` schema) are Supabase's own and are not in the dump; Lovable Cloud backs
those up itself. Everything the office types is in `public`, which is what the dump holds.

> The dump contains the `app_secrets` table and the config file holds the database password and
> the service key. Keep the folder and the script folder readable by you and the backup account
> only (step 5).

## 1. Install the PostgreSQL 17 command-line tools (once)

The portal runs PostgreSQL 17, so the tools must be 17 too (an older `pg_dump` refuses).

1. On the server, download the PostgreSQL 17 installer for Windows from EnterpriseDB (the
   installer Lovable's docs and postgresql.org point to).
2. Run it and tick **only "Command Line Tools"** (untick the server, pgAdmin and Stack Builder).
3. Confirm `C:\Program Files\PostgreSQL\17\bin\pg_dump.exe` exists.

## 2. Get the two credentials (you, never pasted anywhere but the config file)

1. **Database connection string**: in Lovable, open the project → Cloud → the database settings
   → "Connection string". Take the **session pooler** form (host `…pooler.supabase.com`, port
   5432, user `postgres.<project>`), with the database password filled in. The direct host is
   IPv6-only and most offices cannot reach it.
2. **Service role key**: Cloud → API keys → `service_role`. It reads every storage file; it stays
   on the server only.

## 3. Put the script on the server

1. Make the folder `C:\JBK\backup\` on the server and copy into it, from this repository:
   `scripts/backup/jbk-backup.ps1` and `scripts/backup/jbk-backup.config.example.json`.
2. Copy the example to `jbk-backup.config.json` and fill it in:

```json
{
  "DestinationRoot": "X:\\JBK Portal Backups",
  "PgBinDir": "C:\\Program Files\\PostgreSQL\\17\\bin",
  "DatabaseUrl": "postgresql://postgres.PROJECT:PASSWORD@HOST:5432/postgres",
  "SupabaseUrl": "https://PROJECT.supabase.co",
  "SupabaseServiceKey": "…",
  "Buckets": ["service", "takeoffs"],
  "KeyTables": ["bids", "service_jobs", "crm_accounts", "crm_sites", "invoices", "profiles"],
  "WeeklyKeep": 5,
  "MinTableDataEntries": 50
}
```

   On the server itself the X: share is a local folder (something like `D:\Shares\JBK Community`);
   use that local path for `DestinationRoot` when the task runs on the server, so it does not
   depend on a mapped drive letter. `jbk-backup.config.json` is git-ignored and must never be
   committed.
3. Create the destination folder by hand (`X:\JBK Portal Backups`). The script refuses to run
   against a drive root or a folder that does not exist.

## 4. Run it by hand first, watching

Open PowerShell on the server and run a dry run — everything is fetched and checked, nothing is
rotated:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
cd C:\JBK\backup
.\jbk-backup.ps1 -DryRun
```

Read `backup.log`, open the `_incoming-…` folder and look at `db.dump`'s size (hundreds of MB —
the map data is most of it) and the `storage` folder. Then run it for real:

```powershell
.\jbk-backup.ps1
```

You should see `backup-2026-10-07\` and `status.json` with `"ok": true`. Run it once more and
you have two slots; a third run replaces the older one.

## 5. Lock the folders down

Only you and the account that runs the task should read the script folder (it holds the
password) and the backup folder (it holds the dump). In an elevated PowerShell on the server,
with `JBK\backup-svc` as the task account (step 6) and `JBK\braden` as you:

```powershell
icacls "C:\JBK\backup" /inheritance:r /grant:r "JBK\braden:(OI)(CI)F" "JBK\backup-svc:(OI)(CI)RX" "SYSTEM:(OI)(CI)F"
icacls "D:\Shares\JBK Community\JBK Portal Backups" /inheritance:r /grant:r "JBK\braden:(OI)(CI)F" "JBK\backup-svc:(OI)(CI)M" "SYSTEM:(OI)(CI)F"
```

(Adjust the account names and the local path of the X: share.)

## 6. Schedule it nightly

Task Scheduler on the server → Create Task:

- General: name `JBK Portal nightly backup`; "Run whether user is logged on or not"; a dedicated
  standard user (not an administrator) that has Modify on the backup folder and Read on the
  script folder.
- Triggers: Daily at 2:00 AM.
- Actions: Start a program — `powershell.exe` with arguments
  `-NoProfile -ExecutionPolicy Bypass -File "C:\JBK\backup\jbk-backup.ps1"`.
- Settings: "Stop the task if it runs longer than 4 hours"; "If the task fails, restart every 30
  minutes, up to 2 times".

The task's "Last Run Result" is `0x0` after a good night and `0x1` after a failed one, and
`LAST-BACKUP-FAILED.txt` in the backup root says why.

## 7. What a failure does, and what it never does

- A night that fails (no internet, a bad dump, a row count that fell below 90 % of last night's,
  a storage download that came back short) leaves **both** earlier backups exactly as they were.
  Its own folder stays as `_failed-…` for a week so you can see what came down.
- The script never writes to the portal: `pg_dump` and `psql SELECT count(*)` read the database,
  and the storage files are downloaded. A test in the repository (`src/lib/backup-script.test.ts`)
  checks that the script holds no `INSERT`, `UPDATE`, `DELETE` or `DROP`.
- The only deletions are its own `backup-*`, `_failed-*` and `weekly\*-db.dump` entries, and every
  deletion first checks the path is inside `DestinationRoot`. It never touches J:, Y: or anything
  else on the share.

## 8. Restoring

Restoring goes into a fresh database, never over the live one, and is a conversation with
Claude or whoever is helping at the time: `pg_restore --no-owner --no-privileges -d <new db>
db.dump`, then the storage files are uploaded back. Test it once a quarter: restore the latest
dump into a local PostgreSQL on the server and check a few bids and tickets open.
