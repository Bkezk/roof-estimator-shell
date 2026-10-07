# Nightly backup to the office server (Windows)

Owner, Oct 7 2026: a copy of everything in the portal, saved nightly on our server, two days deep
(tonight replaces the older of the two), so a bad or empty save can never wipe the data. The
server is the Windows machine the office drives come from (`\\server`: J:, X: "JBK Community",
Y: Peachtree). The backup goes into **one new folder on X:** and nowhere else. Nothing has to be
installed: the script is Windows PowerShell, which every Windows machine has.

What a backup folder holds (`X:\JBK Portal Backups\backup-2026-10-07\`):

| What | Where |
| --- | --- |
| Every table of the portal — bids, tickets, customers, properties, contacts, opportunities, invoices, settings, the audit log, inventory, repairs, materials — as JSON, 1,000 rows a file | `db\<table>\page-0001.json …` |
| The column types of every table | `db\schema.json` |
| Ticket photos, signatures, receipts, invoice PDFs, takeoff plans — the files as uploaded | `storage\service\…`, `storage\takeoffs\…` |
| When, how big, the row count of every table, how many files | `manifest.json` |

In the root: `backup.log` (every run), `status.json` (the last run), `weekly\` (Sunday copies of
the tables, the newest five), and `LAST-BACKUP-FAILED.txt` only while the last run has failed.

Left out on purpose (`SkipTables`): the public map data the portal re-loads itself every month
(address points, buildings, storm hits and reports, permits, leads). It is hundreds of megabytes
and comes back from its sources; everything the office typed is in the backup. User logins live in
Lovable Cloud's own auth tables, which it backs up itself; the `profiles` table (names, roles,
access) is in the backup.

> The backup contains the `app_secrets` table and the config file holds the service key, which
> can read everything. Keep both folders readable by you and the backup account only (step 5).

## Does the machine have to be on?

The backup runs at 2:00 AM on whichever machine holds the scheduled task, so that machine has to
be on then. The server is on around the clock — that is why it runs there, not on a desk PC. If
it is ever off at 2:00 AM, the task is set to run as soon as the machine comes back (step 6). Days
with the machine off simply have no backup; the two slots then hold the two most recent runs, and
nothing is lost or overwritten by the gap.

## Step 1 — Get the two values from Lovable (you, on your own PC)

1. **Project URL**: in this repository's `.env`, `VITE_SUPABASE_URL` — it looks like
   `https://xxxxxxxx.supabase.co`. (It is also under Cloud in the Lovable project.)
2. **Service role key**: Lovable → your project → Cloud → Secrets / API keys → the `service_role`
   key (a long string starting `eyJ…`). It reads every table and every file, so it goes only
   into the config file on the server (step 3). Never paste it into chat, email or the repository.

## Step 2 — Put the script on the server

Log on to the server (at its screen or by Remote Desktop) with an account that can create folders
on the X: share.

1. Make the folder `C:\JBK\backup`.
2. Save these two files from the repository into it (GitHub → the file → "Raw" → right-click →
   Save as):
   - `scripts/backup/jbk-backup.ps1`
   - `scripts/backup/jbk-backup.config.example.json`
3. Right-click `jbk-backup.ps1` → Properties → tick **Unblock** → OK (Windows marks downloaded
   scripts; this clears it).
4. Make the destination folder: on the server the X: share is a local folder (open the share's
   Properties → Sharing to see its path, e.g. `D:\Shares\JBK Community`); create
   `JBK Portal Backups` inside it. Use that **local path** in the config so the task does not
   depend on a mapped drive letter.

## Step 3 — Fill in the config

Copy `jbk-backup.config.example.json` to `jbk-backup.config.json` (same folder) and edit it in
Notepad:

```json
{
  "DestinationRoot": "D:\\Shares\\JBK Community\\JBK Portal Backups",
  "SupabaseUrl": "https://xxxxxxxx.supabase.co",
  "SupabaseServiceKey": "eyJ…",
  …leave the rest as it is…
}
```

Backslashes in paths are doubled in JSON (`\\`). `jbk-backup.config.json` is git-ignored and must
never be committed.

## Step 4 — Run it by hand first, watching

Open PowerShell on the server (Start → type PowerShell) and run a dry run — everything is
fetched and checked, nothing is rotated:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
cd C:\JBK\backup
.\jbk-backup.ps1 -DryRun
```

You should see lines like `Tables: 81, rows: 12,345`, `Bucket service: 6 files`, and
`Finished: OK`. Open the destination folder: an `_incoming-…` folder with `db\`, `storage\` and
`manifest.json`. Open `db\bids\page-0001.json` in Notepad and check your bids are in it. Then run
it for real:

```powershell
.\jbk-backup.ps1
```

Now there is `backup-2026-10-07\` and `status.json` says `"ok": true`. Run it once more and you
have two slots; the third run replaces the older one. Delete the `_incoming-…` dry-run folder by
hand when you are done looking (it is the only thing the script does not tidy).

If anything fails, `backup.log` says what, and `LAST-BACKUP-FAILED.txt` appears. The two most
common: a wrong key ("Secret API key required" or "Invalid API key") and a `DestinationRoot` that
does not exist yet.

## Step 5 — Lock the folders down

Only you and the account that runs the task should read the script folder (it holds the key)
and the backup folder (it holds the data). Make a plain user for the task first: Computer
Management → Local Users and Groups → Users → New User `backup-svc`, a long password, "Password
never expires", **not** in Administrators. Then, in PowerShell run as administrator (replace
`JBK\braden` with your own account and the path with your local share path):

```powershell
icacls "C:\JBK\backup" /inheritance:r /grant:r "JBK\braden:(OI)(CI)F" "backup-svc:(OI)(CI)RX" "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F"
icacls "D:\Shares\JBK Community\JBK Portal Backups" /inheritance:r /grant:r "JBK\braden:(OI)(CI)F" "backup-svc:(OI)(CI)M" "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F"
```

(`F` full, `M` modify, `RX` read and run.) If the server is not in a domain, write the account
as `SERVER\braden`.

## Step 6 — Schedule it nightly

Task Scheduler on the server → Create Task (not "Basic"):

- **General**: name `JBK Portal nightly backup`. "Run whether user is logged on or not". Change
  User to `backup-svc`. Leave "Run with highest privileges" unticked.
- **Triggers** → New: Daily, 2:00 AM.
- **Actions** → New: Start a program. Program: `powershell.exe`. Arguments:
  `-NoProfile -ExecutionPolicy Bypass -File "C:\JBK\backup\jbk-backup.ps1"`.
- **Conditions**: untick "Start the task only if the computer is on AC power" (servers report
  oddly); tick "Wake the computer to run this task".
- **Settings**: tick "Run task as soon as possible after a scheduled start is missed"; "Stop the
  task if it runs longer than 4 hours"; "If the task fails, restart every 30 minutes, up to 2
  times".
- OK, enter `backup-svc`'s password. Right-click the task → Run, then check `status.json`.

"Last Run Result" shows `0x0` after a good night and `0x1` after a failed one.

## Step 7 — What a failure does, and what the script never does

- A night that fails (no internet, a table that came down short, a row count under 90 % of last
  night's, a file that downloaded short) leaves **both** earlier backups exactly as they were. Its
  own folder stays as `_failed-…` for a week so you can see what came down.
- The script never writes to the portal: every call to the cloud is a read. A test in the
  repository (`src/lib/backup-script.test.ts`) checks that it holds no write statements.
- The only deletions are its own `backup-*`, `_failed-*` and `weekly\*-db` entries, and every one
  first checks the path is inside `DestinationRoot`. It refuses to run against a drive root. It
  never touches J:, Y: or anything else on the share.

## Step 8 — Restoring

A restore goes into a fresh portal database, never over the live one, and is a conversation with
Claude or whoever is helping at the time: the JSON pages are loaded table by table through the
same data API, then the storage files are uploaded back. Test it once a quarter by opening a
`db\bids\page-0001.json` and a photo from the newest slot; if both open, the backup is readable.
