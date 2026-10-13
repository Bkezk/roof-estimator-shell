# Nightly backup to the office server (Windows)

Owner, Oct 7 2026: a copy of everything in the portal, saved nightly on our server, two days deep
(tonight replaces the older of the two), so a bad or empty save can never wipe the data. The
server is the Windows machine the office drives come from (`\\server`: J:, X: "JBK Community",
Y: Peachtree). The backup goes into **one new folder on X:** and nowhere else. Nothing has to be
installed: the script is Windows PowerShell, which every Windows machine has.

How it reaches the data: Lovable Cloud does not hand out the database's master key (Supabase:
"Service role and API keys are not accessible for Lovable Cloud–managed projects"), but the
portal's own server holds it, the way it does for the reminder emails. So the portal has a
read-only backup door, `<portal address>/api/backup`, that answers only to a **backup password**
you make up (owner, Oct 7: "could we not do the portal side backup door and i just set the
password?"). The password goes in two places: Lovable Cloud › Secrets as `BACKUP_SECRET`, and the
script's config on the server as `BackupSecret`. The script never sees the master key, every call
it makes is a read, and the portal logs every call (allowed or refused) with the caller's address.

What a backup folder holds (`X:\JBK Portal Backups\backup-2026-10-07\`):

| What                                                                                                                                                                                     | Where                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Every table of the portal — bids, tickets, customers, properties, contacts, opportunities, invoices, settings, the audit log, inventory, repairs, materials — as JSON, 1,000 rows a file | `db\<table>\page-0001.json …`             |
| The column types of every table                                                                                                                                                          | `db\schema.json`                          |
| Ticket photos, signatures, receipts, invoice PDFs, takeoff plans — the files as uploaded                                                                                                 | `storage\service\…`, `storage\takeoffs\…` |
| When, how big, the row count of every table, how many files                                                                                                                              | `manifest.json`                           |

In the root: `backup.log` (every run), `status.json` (the last run), `weekly\` (Sunday copies of
the tables, the newest five), and `LAST-BACKUP-FAILED.txt` only while the last run has failed.

**Portal updates need no change here.** The script asks the portal each night which tables and
storage buckets exist, so a table or bucket added in a later update is backed up automatically.
The `Tables` and `Buckets` lists in the config are only a fallback for a night the portal lists
none. The two lists worth a glance after a big change are `KeyTables` (the row-count checks) and
`SkipTables` (below).

Left out on purpose (`SkipTables`): the public map data the portal re-loads itself every month
(address points, buildings, storm hits and reports, permits, leads). It is hundreds of megabytes
and comes back from its sources; everything the office typed is in the backup. User logins live in
Lovable Cloud's own auth tables, which it backs up itself; the `profiles` table (names, roles,
access) is in the backup.

> The backup contains the `app_secrets` table and the config file holds the backup password, which
> reads everything. Keep both folders readable by you and the backup account only (step 5). If the
> password ever leaks, change it in Lovable Cloud › Secrets and in the config: the old one stops
> working the moment the portal is republished.

## Does the machine have to be on?

The backup runs at 2:00 AM on whichever machine holds the scheduled task, so that machine has to
be on then. The server is on around the clock — that is why it runs there, not on a desk PC. If
it is ever off at 2:00 AM, the task is set to run as soon as the machine comes back (step 6). Days
with the machine off simply have no backup; the two slots then hold the two most recent runs, and
nothing is lost or overwritten by the gap.

## Step 1 — Make the backup password and put it in Lovable (you, on your own PC)

1. **Make up the password.** At least 24 characters; a password manager's generator, or three or
   four unrelated words with numbers, is fine. Write it down somewhere safe for step 3; it is never
   pasted into chat, email or the repository.
2. **Set it in Lovable**: Lovable → your project → Cloud → Secrets → Add secret. Name
   `BACKUP_SECRET`, value the password. This is the same place `CRON_SECRET` was added on Sep 29.
3. **Publish** the portal (Lovable → Publish) so the server picks the new secret up.
4. **The portal address** (`AppUrl` in step 3) is the address you open the portal at in the
   browser, e.g. `https://portal.example.com` — without anything after the domain.

Why a password and not a key: Lovable Cloud does not hand out the database's master key, so the
portal's own server reads on the script's behalf (see the top of this page). Other ways to a copy,
for the record: Lovable's own "Export project data" (Cloud › Overview › Advanced settings; one
export per 24 hours, up to 5 GB, tables only, no stored files), and moving the portal onto our own
Supabase project, which would hand us the key and Supabase's native backups.

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
  "AppUrl": "https://the-portal-address",
  "BackupSecret": "the password from step 1",
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
common: a wrong password ("401 (Unauthorized)": the config and Lovable Secrets disagree, or the
portal was not republished after adding the secret; "500" with "BACKUP_SECRET is not set": the
secret is missing in Lovable) and a `DestinationRoot` that does not exist yet.

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

Owner, Oct 13: "go ahead and build it [a restore tool] … it needs to be as robust and safe, and
get all info where it needs to go accurately." The restore is the sister script,
`scripts/backup/jbk-restore.ps1`, next to the backup script. It puts a backup slot back through
the portal's **restore door**, `<portal address>/api/restore`, which answers only to a second
password, `RESTORE_SECRET`. It never holds the database's master key, only ever POSTs to that one
address, reads the slot folder and writes nothing on the share but `restore.log`,
`restore-report.txt` and `restore-report.json` inside that slot. It never deletes a row or a
file, anywhere.

### When to restore where

| Situation                                                                                            | Where                                                                                         | Mode                                |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------- |
| Rows were deleted or mangled by mistake today (a bad import, a wrong click); everything else is fine | **The live project.** Rows the live project lacks come back; every existing row is left alone | `skip` (the default)                |
| A table's rows are wrong and last night's are right                                                  | The live project, naming the table: `-Tables bids`                                            | `replace`, with `-ReplaceConfirmed` |
| The project is gone or unusable (Lovable project lost, database reset)                               | **A fresh Lovable project** made from this repository, after its migrations have run          | `skip`, with `-CreateUsers`         |
| The quarterly test                                                                                   | A scratch Lovable project, deleted afterwards                                                 | `skip`, with `-CreateUsers -Yes`    |

`skip` adds what is missing and touches nothing that exists. `replace` overwrites rows with the
same primary key with the backup's values — rows the backup does not know still stay. Neither
mode deletes.

### Set the restore password (once)

1. Make up a second password, at least 24 characters, **different from the backup password**
   (one reads, the other writes; the script refuses a config where they are equal).
2. Lovable → your project → Cloud → Secrets → Add secret: name `RESTORE_SECRET`, value the
   password. Publish the portal.
3. On the server, add it to `C:\JBK\backup\jbk-backup.config.json`:
   `"RestoreSecret": "that password"`. The restore script reads the backup's config.

Without the secret the door answers "Restores are off: RESTORE_SECRET is not set in Lovable
Cloud › Secrets" and nothing can be written through it. You may leave it unset between restores
and set it only when you need one; a wrong password is "Wrong restore password", logged by the
portal with the caller's address.

### Secrets are not in the backup

The backup holds every table (the `app_secrets` table included — it carries only the push-signing
key pair the app generated for itself, and restoring it keeps every phone's push subscription
working) and every stored file. It does **not** hold the secrets in Lovable Cloud › Secrets,
because they are not in the database: `RESEND_API_KEY` (email), `GOOGLE_MAPS_API_KEY`,
`CRON_SECRET`, `BACKUP_SECRET`, `RESTORE_SECRET`, and the Supabase keys Lovable sets itself.
Keep a private note — a password manager entry, never a file in the repository — of the secret
**names** and where each value comes from (Resend dashboard, Google Cloud console, the ones you
made up), never the values. A fresh project needs them set again before email, maps, the cron
jobs or the backup work. Passwords are not in any backup either (see "User accounts" below).

### The commands

On the server, PowerShell in `C:\JBK\backup`. Every run needs `-Project`: the portal's label,
"company name @ Supabase project ref". Run once with anything to see it printed:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
cd C:\JBK\backup
.\jbk-restore.ps1 -Slot latest -Project x
#  → Portal project: 'JBK Roofing @ abcdefghijkl' … STOP: you named 'x'
```

**1. Dry run** (the default — nothing is written; a report is filed in the slot folder):

```powershell
.\jbk-restore.ps1 -Slot latest -Project 'JBK Roofing @ abcdefghijkl'
```

**2. Read `restore-report.txt`** in the slot folder (also printed). It ends with `RESULT: dry run
clean` or a list of what would fail. Fix those (see the columns below) or leave the tables out
with `-Tables`, and run the dry run again until it is clean.

**3. Apply:**

```powershell
.\jbk-restore.ps1 -Slot latest -Project 'JBK Roofing @ abcdefghijkl' -Apply
```

It asks you to type the label once more; add `-Yes` to skip that (a scripted test). Other
switches: `-Slot backup-2026-10-12` (a named slot) or `-Slot 2026-10-11-db` (a Sunday copy under
`weekly\`, tables only); `-Tables bids,invoices`; `-Only db` / `-Only storage` / `-SkipStorage`;
`-Mode replace -ReplaceConfirmed`; `-CreateUsers` (below). The exit code is 0 only when nothing
was refused; `restore.log` in the slot holds every line.

### User accounts (a fresh project)

User logins live in Lovable Cloud's auth tables, outside the backup; the backup's `profiles`
table carries each person's email, name, role, access and technician tick. **Passwords are in no
backup**, ever. The script matches backup profiles to live accounts **by email**: in the live
project the ids are the same and nothing changes; in a fresh project the new accounts get new
ids, and the script maps every user column (who created a ticket, who is assigned, who held a
follow-up, who authorised, every `created_by`) from the old id to the new one as the rows go in.
The dry run lists the accounts the project lacks.

Nothing in the portal makes a first admin (there is no sign-up and only an admin can add users),
so for a fresh project the restore does it:

1. Make the Lovable project from the repository and let its migrations run (the restore door is
   one of them: `20261013100000_restore_door.sql`).
2. Set `RESTORE_SECRET` and the other secrets from your names note. Publish.
3. Dry run: `.\jbk-restore.ps1 -Slot latest -Project '<label>' -CreateUsers`.
4. Apply: `.\jbk-restore.ps1 -Slot latest -Project '<label>' -Apply -CreateUsers`. Because the
   project has no admin yet, you are asked **which restored admin signs in first** (Enter takes
   the first one; normally your own account, the one created when the portal was set up) and for
   that one account's **initial password**, typed twice, sent over HTTPS once and never logged or
   written anywhere. Every other account is created with no usable password.
5. Sign in as that admin. Admin › Users & access → the key button on each row → **Set password**,
   then tell each person theirs (in person or by phone, not by email).
6. People sign in and may change their password on their Account page.

If the project already has an admin (a restore into the live project, or you made one in
Lovable first), the script says so, asks for no password, and you set the others' passwords from
Admin › Users & access as above.

### What the report says

The dry run's table check, one row per table — `backup rows / live rows / already live / new`:

- **backup rows** — in the slot (the manifest's count); **live rows** — in the project now.
- **already live** — backup rows whose primary key already exists live. `skip` leaves them;
  `replace` overwrites them. **new** — rows the restore would add.
- `WOULD FAIL` — the live project has no such table, or it gained a NOT NULL column with no
  default that the backup lacks (every row would be refused); add that default in a migration or
  leave the table out. `plain insert (no primary key)` — such a table is inserted plainly, so a
  second restore adds duplicates. `not restored (deny list)` — refused on purpose (none today).
- `ignored (no longer live): …` — columns the backup has and the table lost; dropped quietly.
  `take their default: …` — columns the table gained since; filled by the database.
- `FK: …` — rows pointing at a parent row that is in neither the backup nor the live project;
  those rows are refused and listed.
- `Users: …` — accounts the project lacks (`-CreateUsers`), ids that will be mapped, whether the
  project has an admin yet.
- `Storage: …` — files in the slot, how many already exist live (kept as they are, a size
  difference is noted), how many will be uploaded.

After `-Apply`: `backup rows / live rows now / inserted / replaced / skipped / refused` per table,
the refused rows with the database's reason, the sequences reset (ticket and invoice numbers
carry on past the restored ones), the users created, and `RESULT`.

### Changes to the app never need a change here

Nothing in the restore names a table or a column: the portal reads its live schema each time
(`restore_catalog()`), the tables go in parents-first from the live foreign keys, a column the
backup has and the table lost is ignored, a column the table gained takes its default, and the
restore functions run with the table's triggers off so no notice, audit row or follow-up is
re-fired. Tests in the repository (`src/lib/restore-door.test.ts`) walk every migration and fail
if a table ever becomes un-restorable or a user-id column appears the id map would not cover.

### The quarterly test restore

Once a quarter, restore the newest slot into a scratch Lovable project (Lovable → New project →
from this repository; let the migrations run; set `RESTORE_SECRET` there) with
`-Project '<the scratch label>' -Apply -CreateUsers -Yes`, open it, check a few tickets, bids,
customers and photos against the live portal, then delete the scratch project. A backup that
has never been restored is a hope, not a backup. Keep the dry-run report from the live project
too (`-Slot latest -Project '<live label>'`, no `-Apply`): it should end `dry run clean` with
every row `already live`.
