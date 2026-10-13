<#
.SYNOPSIS
  Puts a nightly backup of the JBK Portal back into a Lovable Cloud project, through the portal's
  restore door — dry run first, then -Apply.

.DESCRIPTION
  Owner, Oct 13 2026: "go ahead and build it [a restore tool], we also need to ensure as we
  continue to develop the app, it's able to restore even as we make changes. it needs to be as
  robust and safe, and get all info where it needs to go accurately."

  Needs nothing installed: Windows PowerShell 5.1 and the restore password. The sister of
  jbk-backup.ps1: where that one READS every table through <portal>/api/backup with BackupSecret,
  this one WRITES them back through <portal>/api/restore with RestoreSecret — a second password
  the owner makes up and sets in Lovable Cloud › Secrets as RESTORE_SECRET (never the same value
  as the backup password: one reads, the other writes). The portal does the writing with its own
  server key through the database functions of supabase/migrations/20261013100000_restore_door.sql;
  this script never holds that key.

  What a run does:
    1. Reads the slot (a backup-YYYY-MM-DD folder, 'latest', or a weekly\YYYY-MM-DD-db copy):
       manifest.json, db\<table>\page-0001.json … and storage\<bucket>\….
    2. Asks the portal who it is (op identify): the project label — "<company name> @ <Supabase
       project ref>" — plus the live schema, the row counts, the table order (parents before
       children, from the foreign keys) and the live user accounts. The label MUST equal -Project
       or the script stops before anything is written; with -Apply you also type it in, unless
       -Yes. Every later call carries the label and the portal refuses a mismatch (412).
    3. Dry run (the default): for every table in the backup, the portal compares the backup's
       columns with the live schema (op plan): columns the table lost (ignored), new NOT NULL
       columns with no default (every row would be refused), tables the live project no longer
       has, tables without a primary key. The script then counts primary-key clashes (op exists:
       how many backup rows already exist live), foreign-key targets missing from both the backup
       and the live project, user accounts in the backup with no live account (matched by email;
       their rows need -CreateUsers), and which storage files already exist. Row counts are
       checked against the manifest. restore-report.txt / .json land in the slot folder; the exit
       code is non-zero if anything would fail.
    4. -Apply: first the missing user accounts (-CreateUsers: made WITHOUT a usable password —
       passwords are in no backup; the admin sets them from Admin › Users & access. In a fresh
       project with no admin yet you are asked, once, which restored admin signs in first and
       for that one account's initial password, typed here, sent over HTTPS, never logged or
       written anywhere). Then the tables in the portal's order, page by page (≤ 1,000 rows a
       call, a batch retried twice on a network error, a refused row reported and the batch
       carried on), with the user ids mapped old → new by email when they differ; tables whose
       rows were refused for a missing parent get a second pass once every table is in. Then the
       storage files (existing ones skipped, sizes verified). Then op finish: sequences reset past
       the restored ids, user triggers all back on, live counts compared with the manifest. The
       report says, table by table: backup rows / live rows / inserted / replaced / skipped /
       errors. Exit code 0 only when nothing was refused.

  Modes: skip (default) adds rows the live project lacks and leaves every existing row alone;
  replace overwrites rows with the same primary key with the backup's values (-ReplaceConfirmed
  is required with -Apply). Neither ever deletes a row: anything the backup does not know stays.

  Safety rails (owner, Oct 7: "we need to make sure we cant do damage to the server"):
    - It only ever POSTs to the portal's /api/restore; it never holds the database's master key
      and never calls the data API itself.
    - On the share it reads the slot folder and writes only restore.log, restore-report.txt and
      restore-report.json inside that same folder. It deletes nothing, anywhere.
    - It refuses to run without -Project, stops when the portal's label differs, refuses -Apply
      with -Mode replace unless -ReplaceConfirmed, and asks you to type the label before -Apply
      unless -Yes.

.PARAMETER ConfigPath
  The JSON config (default: jbk-backup.config.json next to this script) — the backup's config
  with one more key, RestoreSecret.
.PARAMETER Slot
  The backup folder to restore from: 'latest' (the newest backup-* folder), a folder name under
  the root (backup-2026-10-12), or a weekly copy (2026-10-11-db, under weekly\; tables only).
.PARAMETER Project
  REQUIRED. The project label the portal answers to identify (printed by any run), e.g.
  "JBK Roofing @ abcdefghijkl". The script stops before writing anything unless it matches.
.PARAMETER Mode
  skip (default) or replace — see above.
.PARAMETER DryRun
  The default: check everything, write nothing to the portal, file the report.
.PARAMETER Apply
  Write. Asks you to type the project label unless -Yes.
.PARAMETER Yes
  With -Apply: skip the typed confirmation (for a scripted test restore into a scratch project).
.PARAMETER ReplaceConfirmed
  Required together with -Apply -Mode replace.
.PARAMETER Tables
  Restore only these tables (default: every table in the backup).
.PARAMETER SkipStorage
  Leave the storage files out (same as -Only db).
.PARAMETER Only
  all (default), db, or storage.
.PARAMETER CreateUsers
  Create the user accounts the backup has and the project lacks (by email), before the tables.
#>
[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'jbk-backup.config.json'),
  [string]$Slot = 'latest',
  [string]$Project = '',
  [ValidateSet('skip', 'replace')]
  [string]$Mode = 'skip',
  [switch]$DryRun,
  [switch]$Apply,
  [switch]$Yes,
  [switch]$ReplaceConfirmed,
  [string[]]$Tables = @(),
  [switch]$SkipStorage,
  [ValidateSet('all', 'db', 'storage')]
  [string]$Only = 'all',
  [switch]$CreateUsers
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$started = Get-Date
$script:LogFile = $null
$pageSize = 1000

function Write-Log([string]$msg) {
  $line = "{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $msg
  Write-Host $line
  if ($script:LogFile) { Add-Content -Path $script:LogFile -Value $line -Encoding UTF8 }
}

# ---------------------------------------------------------------- the switches, before anything else
if ($Apply -and $DryRun) { throw "Pick one: -DryRun (the default) or -Apply" }
$isApply = [bool]$Apply
if (-not $Project -or -not $Project.Trim()) {
  throw "-Project is required: the label the portal prints on identify, e.g. -Project 'JBK Roofing @ abcdefghijkl'. Run once with any value to see it."
}
$Project = ($Project -replace '\s+', ' ').Trim()
if ($isApply -and $Mode -eq 'replace' -and -not $ReplaceConfirmed) {
  throw "-Apply with -Mode replace overwrites live rows with the backup's: add -ReplaceConfirmed if that is what you want"
}
$doDb = ($Only -ne 'storage')
$doStorage = ($Only -ne 'db') -and (-not $SkipStorage)

# ---------------------------------------------------------------- config and guards
if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Config not found: $ConfigPath (the backup's jbk-backup.config.json, with RestoreSecret added)"
}
$cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
foreach ($k in 'DestinationRoot', 'AppUrl', 'RestoreSecret') {
  if (-not ($cfg.PSObject.Properties.Name -contains $k) -or -not $cfg.$k) { throw "Config is missing $k (RestoreSecret is the same value you set as RESTORE_SECRET in Lovable Cloud › Secrets)" }
}
if ($cfg.AppUrl -like '*PASTE*' -or $cfg.RestoreSecret -like '*PASTE*') { throw "Put the portal address and the restore password into the config first" }
if (([string]$cfg.RestoreSecret).Length -lt 24) { throw "RestoreSecret must be at least 24 characters (the portal refuses shorter ones)" }
if (($cfg.PSObject.Properties.Name -contains 'BackupSecret') -and ([string]$cfg.BackupSecret -eq [string]$cfg.RestoreSecret)) {
  throw "RestoreSecret must not be the backup password: one reads, the other writes"
}
$root = [string]$cfg.DestinationRoot
$rootItem = Get-Item -LiteralPath $root -ErrorAction SilentlyContinue
if (-not $rootItem -or -not $rootItem.PSIsContainer) { throw "DestinationRoot does not exist or is not a folder: $root" }
if ([System.IO.Path]::GetPathRoot($rootItem.FullName).TrimEnd('\') -eq $rootItem.FullName.TrimEnd('\')) {
  throw "DestinationRoot must be a folder inside the drive, not the drive itself: $root"
}
$root = $rootItem.FullName.TrimEnd('\')

function Assert-UnderRoot([string]$path) {
  $full = [System.IO.Path]::GetFullPath($path)
  if (-not $full.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to touch a path outside the backup root: $full"
  }
  return $full
}

# ---------------------------------------------------------------- the slot
$slotPath = $null
if ($Slot -eq 'latest') {
  $slots = @(Get-ChildItem -LiteralPath $root -Directory -Filter 'backup-*' | Sort-Object Name)
  if ($slots.Count -eq 0) { throw "No backup-* folder under $root" }
  $slotPath = $slots[-1].FullName
} else {
  if ($Slot -match '[\\/]' -or $Slot -eq '.' -or $Slot -eq '..') { throw "-Slot is a folder NAME under the backup root, not a path: $Slot" }
  $candidate = Join-Path $root $Slot
  if (-not (Test-Path -LiteralPath $candidate)) { $candidate = Join-Path (Join-Path $root 'weekly') $Slot }
  if (-not (Test-Path -LiteralPath $candidate)) { throw "No such slot under $root (or its weekly\ folder): $Slot" }
  $slotPath = (Get-Item -LiteralPath $candidate).FullName
}
$slotPath = Assert-UnderRoot $slotPath
# A weekly copy IS the db folder (weekly\2026-10-11-db\<table>\…); a slot has db\ inside it.
$dbDir = Join-Path $slotPath 'db'
$isWeekly = $false
if (-not (Test-Path -LiteralPath $dbDir)) {
  if ($slotPath -like '*-db' -and (Test-Path -LiteralPath (Join-Path $slotPath 'schema.json'))) { $dbDir = $slotPath; $isWeekly = $true }
  else { throw "The slot has no db\ folder: $slotPath" }
}
$storageDir = Join-Path $slotPath 'storage'
$script:LogFile = Join-Path $slotPath 'restore.log'
$manifest = $null
$manifestPath = Join-Path $slotPath 'manifest.json'
if (Test-Path -LiteralPath $manifestPath) { $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json }
if ($isWeekly) { $doStorage = $false }

$what = 'DRY RUN'
if ($isApply) { $what = 'APPLY' }
Write-Log "Restore $what started: slot $slotPath, mode $Mode, project '$Project'"
if ($manifest) { Write-Log ("Manifest: taken {0}, {1} tables, {2:N0} rows, {3} files" -f $manifest.at, $manifest.tables, [int64]$manifest.rows, $manifest.objects) }
else { Write-Log "No manifest.json in this slot (a weekly copy): counts come from the pages" }

# ---------------------------------------------------------------- the portal's restore door
# src/routes/api.restore.ts: POST only, Authorization: Bearer <RESTORE_SECRET>, JSON { op, project, … }.
$door = ([string]$cfg.AppUrl).TrimEnd('/') + '/api/restore'
$headers = @{ Authorization = "Bearer $($cfg.RestoreSecret)" }
$utf8 = New-Object System.Text.UTF8Encoding($false)
$projectJson = ConvertTo-Json -InputObject $Project -Compress   # a quoted, escaped JSON string

# Reads the body of a refused answer (4xx/5xx) so the message reaches the log.
function Read-ErrorBody($webException) {
  $resp = $webException.Response
  if (-not $resp) { return $null }
  try {
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $text = $reader.ReadToEnd()
    $reader.Close()
    try { $obj = ConvertFrom-Json $text; if ($obj.PSObject.Properties.Name -contains 'error') { return [string]$obj.error } } catch { }
    return $text
  } catch { return $null }
}

# One call to the door. $json is the complete body; $label is what the log says (never the body:
# it may hold rows or, once, a password). Network errors and 5xx are retried $retries times;
# 403 / 412 / 4xx are final. Returns the parsed answer.
function Invoke-Door([string]$json, [string]$label, [int]$retries = 0) {
  $attempt = 0
  while ($true) {
    $attempt++
    try {
      $bytes = $utf8.GetBytes($json)
      $resp = Invoke-WebRequest -Method Post -Uri $door -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes -UseBasicParsing
      return (ConvertFrom-Json $resp.Content)
    } catch [System.Net.WebException] {
      $status = 0
      if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
      $detail = Read-ErrorBody $_.Exception
      if (-not $detail) { $detail = $_.Exception.Message }
      $final = ($status -ge 400 -and $status -lt 500)
      if ($final -or $attempt -gt $retries) {
        if ($status -eq 403) { throw "The portal refused the restore password ($detail). RESTORE_SECRET in Lovable Cloud › Secrets and RestoreSecret in the config must be the same value, and the portal republished after setting it." }
        if ($status -eq 412) { throw "The portal says this is not the project you named ($detail)" }
        if ($status -gt 0) { throw "$label failed: HTTP $status $detail" }
        throw "$label failed: $detail"
      }
      Write-Log "$label failed (attempt $attempt, HTTP $status): $detail — retrying"
      Start-Sleep -Seconds (5 * $attempt)
    }
  }
}

# One stored file, raw bytes, with the op in headers (x-restore-op: file).
function Send-File([string]$bucket, [string]$path, [string]$localPath, [string]$contentType) {
  $h = @{
    Authorization  = $headers.Authorization
    'x-restore-op' = 'file'
    'x-project'    = [uri]::EscapeDataString($Project)
    'x-bucket'     = $bucket
    'x-path'       = [uri]::EscapeDataString($path)
  }
  $attempt = 0
  while ($true) {
    $attempt++
    try {
      $resp = Invoke-WebRequest -Method Post -Uri $door -Headers $h -ContentType $contentType -InFile $localPath -UseBasicParsing
      return (ConvertFrom-Json $resp.Content)
    } catch [System.Net.WebException] {
      $status = 0
      if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
      $detail = Read-ErrorBody $_.Exception
      if (-not $detail) { $detail = $_.Exception.Message }
      if (($status -ge 400 -and $status -lt 500) -or $attempt -gt 2) { throw "upload $bucket/$path failed: HTTP $status $detail" }
      Write-Log "upload $bucket/$path failed (attempt $attempt): $detail — retrying"
      Start-Sleep -Seconds (5 * $attempt)
    }
  }
}

# The content type for an upload, from the file's extension (what the browser sent originally
# is not in the backup; the storage API is told this and the app reads files by path).
function Get-ContentType([string]$name) {
  $ext = [System.IO.Path]::GetExtension($name).ToLowerInvariant()
  switch ($ext) {
    '.jpg' { return 'image/jpeg' }
    '.jpeg' { return 'image/jpeg' }
    '.png' { return 'image/png' }
    '.gif' { return 'image/gif' }
    '.webp' { return 'image/webp' }
    '.heic' { return 'image/heic' }
    '.pdf' { return 'application/pdf' }
    '.json' { return 'application/json' }
    '.txt' { return 'text/plain' }
    '.csv' { return 'text/csv' }
    '.svg' { return 'image/svg+xml' }
    default { return 'application/octet-stream' }
  }
}

# A JSON value for a key: ConvertFrom-Json (PowerShell 5.1) turns ISO dates into [DateTime];
# give those back as text so a text key that looks like a date still matches.
function ConvertTo-KeyValue($v) {
  if ($v -is [DateTime]) { return $v.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ') }
  return $v
}

# ---------------------------------------------------------------- the backup's tables and pages
function Get-Pages([string]$table) {
  $tDir = Join-Path $dbDir $table
  return @(Get-ChildItem -LiteralPath $tDir -File -Filter 'page-*.json' | Sort-Object Name)
}
function Read-Rows([System.IO.FileInfo]$page) {
  $content = Get-Content -LiteralPath $page.FullName -Raw -Encoding UTF8
  if (-not $content -or -not $content.Trim()) { return @() }
  return @(ConvertFrom-Json $content)
}

$backupTables = @(Get-ChildItem -LiteralPath $dbDir -Directory | ForEach-Object { $_.Name } | Sort-Object)
if ($Tables.Count -gt 0) {
  foreach ($t in $Tables) { if ($backupTables -notcontains $t) { throw "-Tables names $t, which is not in this backup" } }
  $backupTables = @($backupTables | Where-Object { $Tables -contains $_ })
}
if ($backupTables.Count -eq 0) { throw "The slot holds no tables" }

# Per table: pages, row count (the manifest's, or counted), the columns (page 1's first row).
$info = @{}
foreach ($t in $backupTables) {
  $pages = Get-Pages $t
  $cols = @()
  $rows = -1
  if ($manifest -and $manifest.counts -and ($manifest.counts.PSObject.Properties.Name -contains $t)) { $rows = [int64]$manifest.counts.$t }
  if ($pages.Count -gt 0) {
    $first = Read-Rows $pages[0]
    if ($first.Count -gt 0) { $cols = @($first[0].PSObject.Properties.Name) }
    if ($rows -lt 0) {
      $rows = 0
      foreach ($p in $pages) { $rows += (Read-Rows $p).Count }
    }
  } elseif ($rows -lt 0) { $rows = 0 }
  $info[$t] = [pscustomobject]@{ pages = $pages; rows = $rows; columns = $cols }
}
Write-Log ("Backup tables: {0}, rows: {1:N0}" -f $backupTables.Count, (($info.Values | Measure-Object -Property rows -Sum).Sum))

# The backup's user accounts (profiles: id, email, role, name) for the id map.
$backupProfiles = @()
if ($backupTables -contains 'profiles') {
  foreach ($p in $info['profiles'].pages) {
    foreach ($r in (Read-Rows $p)) {
      $o = [ordered]@{ id = [string]$r.id; email = [string]$r.email; full_name = $null; role = $null }
      if ($r.PSObject.Properties.Name -contains 'full_name') { $o.full_name = $r.full_name }
      if ($r.PSObject.Properties.Name -contains 'role') { $o.role = $r.role }
      $backupProfiles += [pscustomobject]$o
    }
  }
}

# ---------------------------------------------------------------- 1. identify: the project
$id = Invoke-Door '{"op":"identify"}' 'identify' 2
Write-Log "Portal project: '$($id.project)' ($($id.schema.Count) live tables, $($id.auth_users.Count) user accounts, $($id.live_admins) admin(s))"
if ([string]$id.project -ne $Project) {
  Write-Log "STOP: you named '$Project' but the portal is '$($id.project)'. Nothing was written. Re-run with -Project '$($id.project)' if that is the project you mean."
  exit 2
}
if ($isApply -and -not $Yes) {
  Write-Host ""
  Write-Host "About to WRITE the backup '$(Split-Path -Leaf $slotPath)' into: $($id.project)  (mode: $Mode)" -ForegroundColor Yellow
  $typed = Read-Host "Type the project label exactly to continue"
  if ((($typed -replace '\s+', ' ').Trim()) -ne [string]$id.project) { Write-Log "STOP: the typed label did not match. Nothing was written."; exit 2 }
}
if ($id.cycles.Count -gt 0) { foreach ($c in $id.cycles) { Write-Log "Note: $c" } }

$liveCounts = @{}
foreach ($p in $id.live_counts.PSObject.Properties) { $liveCounts[$p.Name] = [int64]$p.Value }
$liveTables = @($id.schema | ForEach-Object { $_.name })
$pkOf = @{}
foreach ($s in $id.schema) { $pkOf[$s.name] = @($s.pk) }

# ---------------------------------------------------------------- 2. plan: the schema check and the user map
$planTables = @()
foreach ($t in $backupTables) { $planTables += [pscustomobject]@{ table = $t; columns = @($info[$t].columns); rows = [int64]$info[$t].rows } }
$planBody = [ordered]@{ op = 'plan'; project = $Project; tables = $planTables; profiles = $backupProfiles }
$plan = Invoke-Door (ConvertTo-Json -InputObject $planBody -Depth 6 -Compress) 'plan' 2
Write-Log "Plan: $(@($plan.tables).Count) tables checked, $(@($plan.tables | Where-Object { $_.blocked }).Count) would fail"
$planOf = @{}
foreach ($pt in $plan.tables) { $planOf[$pt.table] = $pt }
$restorable = @($plan.order | Where-Object { $planOf.ContainsKey($_) -and $planOf[$_].status -ne 'missing' -and $planOf[$_].status -ne 'denied' -and -not $planOf[$_].blocked })
$blockedTables = @($plan.tables | Where-Object { $_.blocked } | ForEach-Object { $_.table })
$deniedTables = @($plan.tables | Where-Object { $_.status -eq 'denied' } | ForEach-Object { $_.table })

$idMap = @{}
$missingUsers = @()
$usersMatched = 0
if ($plan.users) {
  foreach ($p in $plan.users.id_map.PSObject.Properties) { $idMap[$p.Name] = [string]$p.Value }
  $missingUsers = @($plan.users.missing)
  $usersMatched = [int]$plan.users.matched
}

$report = [ordered]@{
  at = $started.ToString('o'); mode = $Mode; applied = $isApply; slot = (Split-Path -Leaf $slotPath); project = $id.project
  tables = @(); users = [ordered]@{ matched = $usersMatched; missing = @($missingUsers | ForEach-Object { $_.email }); created = @(); ids_mapped = $idMap.Count }
  fk_missing = @(); storage = [ordered]@{ files = 0; existing = 0; to_upload = 0; uploaded = 0; size_mismatch = @() }
  sequences = @(); errors = 0; would_fail = @(); ok = $false
}
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("JBK Portal restore report — $what — " + $started.ToString('yyyy-MM-dd HH:mm'))
$lines.Add("Slot: $slotPath")
$lines.Add("Project: $($id.project)   Mode: $Mode")
$lines.Add("")
$lines.Add($plan.text)
$lines.Add("")

# ---------------------------------------------------------------- 3. the dry-run checks
$wouldFail = New-Object System.Collections.Generic.List[string]
foreach ($t in $blockedTables) { $wouldFail.Add("$t`: " + (($planOf[$t].notes) -join '; ')) }

# Primary-key clashes: how many backup rows already exist live (op exists, 1,000 keys a call).
function Get-Clashes([string]$t) {
  $pk = @($pkOf[$t])
  if ($pk.Count -eq 0 -or $info[$t].rows -eq 0) { return 0 }
  $n = 0
  foreach ($p in $info[$t].pages) {
    $keys = @()
    foreach ($r in (Read-Rows $p)) {
      $k = [ordered]@{}
      foreach ($c in $pk) { $k[$c] = ConvertTo-KeyValue $r.$c }
      $keys += [pscustomobject]$k
    }
    if ($keys.Count -eq 0) { continue }
    $body = '{"op":"exists","project":' + $projectJson + ',"table":"' + $t + '","keys":' + (ConvertTo-Json -InputObject $keys -Depth 3 -Compress) + '}'
    $ans = Invoke-Door $body "exists $t" 2
    $n += [int]$ans.existing
  }
  return $n
}

# Foreign-key targets missing from both the backup and the live project: for every FK of a
# backup table (parent in public), the child values not found in the parent's backup pages are
# asked of the live project (op exists on the parent, keyed by the referenced column).
$parentSets = @{}
function Get-ParentSet([string]$table, [string]$column) {
  $key = "$table.$column"
  if ($parentSets.ContainsKey($key)) { return $parentSets[$key] }
  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  if ($info.ContainsKey($table)) {
    foreach ($p in $info[$table].pages) {
      foreach ($r in (Read-Rows $p)) {
        if ($r.PSObject.Properties.Name -contains $column -and $null -ne $r.$column) { $null = $set.Add([string](ConvertTo-KeyValue $r.$column)) }
      }
    }
  }
  $parentSets[$key] = $set
  return $set
}
function Get-MissingFk($fk) {
  $child = [string]$fk.table
  $col = [string]$fk.columns[0]
  $ptable = [string]$fk.ref_table
  $pcol = [string]$fk.ref_columns[0]
  $parent = Get-ParentSet $ptable $pcol
  $candidates = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($p in $info[$child].pages) {
    foreach ($r in (Read-Rows $p)) {
      if (-not ($r.PSObject.Properties.Name -contains $col) -or $null -eq $r.$col) { continue }
      $v = [string](ConvertTo-KeyValue $r.$col)
      if (-not $parent.Contains($v)) { $null = $candidates.Add($v) }
    }
  }
  if ($candidates.Count -eq 0) { return @() }
  if ($liveTables -notcontains $ptable) { return @($candidates) }
  $missing = @()
  $all = @($candidates)
  for ($i = 0; $i -lt $all.Count; $i += $pageSize) {
    $end = [Math]::Min($i + $pageSize, $all.Count) - 1
    $chunk = @($all[$i..$end])
    $keys = @($chunk | ForEach-Object { $o = [ordered]@{}; $o[$pcol] = $_; [pscustomobject]$o })
    $body = '{"op":"exists","project":' + $projectJson + ',"table":"' + $ptable + '","keys":' + (ConvertTo-Json -InputObject $keys -Depth 3 -Compress) + '}'
    $ans = Invoke-Door $body "exists $ptable" 2
    $found = @{}
    foreach ($ix in @($ans.indices)) { $found[[int]$ix] = $true }
    for ($j = 0; $j -lt $chunk.Count; $j++) { if (-not $found.ContainsKey($j)) { $missing += $chunk[$j] } }
  }
  return $missing
}

if (-not $isApply) {
  # 3a. row counts and primary-key clashes
  $lines.Add("Table check (backup rows / live rows / already live / new):")
  foreach ($t in $backupTables) {
    $pt = $planOf[$t]
    $live = '-'
    if ($liveCounts.ContainsKey($t)) { $live = $liveCounts[$t] }
    $clash = 0
    if ($restorable -contains $t) { $clash = Get-Clashes $t }
    $new = [int64]$info[$t].rows - $clash
    $flag = ''
    if ($pt.blocked) { $flag = '  WOULD FAIL' }
    elseif ($pt.status -eq 'denied') { $flag = '  not restored (deny list)' }
    elseif ($pt.status -eq 'no_pk') { $flag = '  plain insert (no primary key)' }
    $lines.Add(("  {0,-36} {1,8} {2,8} {3,8} {4,8}{5}" -f $t, $info[$t].rows, $live, $clash, $new, $flag))
    $report.tables += [ordered]@{ table = $t; backup_rows = $info[$t].rows; live_rows = $live; already_live = $clash; new = $new; status = $pt.status; blocked = $pt.blocked; dropped_columns = @($pt.dropped_columns); new_required_columns = @($pt.new_required_columns); notes = @($pt.notes) }
  }
  $lines.Add("")
  # 3b. foreign keys
  $fkLines = 0
  foreach ($fk in @($id.foreign_keys)) {
    if ([string]$fk.ref_schema -ne 'public') { continue }
    if ($backupTables -notcontains [string]$fk.table) { continue }
    if ($info[[string]$fk.table].rows -eq 0) { continue }
    if (@($fk.columns).Count -ne 1) { continue }
    $miss = @(Get-MissingFk $fk)
    if ($miss.Count -gt 0) {
      $sample = @($miss | Select-Object -First 3) -join ', '
      $msg = "$($fk.table).$($fk.columns[0]) → $($fk.ref_table).$($fk.ref_columns[0]): $($miss.Count) value(s) in neither the backup nor the live project (e.g. $sample) — those rows will be refused"
      $lines.Add("FK: $msg")
      $wouldFail.Add($msg)
      $report.fk_missing += [ordered]@{ table = $fk.table; column = $fk.columns[0]; ref_table = $fk.ref_table; missing = $miss.Count; sample = @($miss | Select-Object -First 10) }
      $fkLines++
    }
  }
  if ($fkLines -eq 0) { $lines.Add("FK: every referenced row is in the backup or already live") }
  # 3c. user accounts
  foreach ($a in @($id.auth_dependent)) { $lines.Add("Users: $($a.table).$(@($a.columns) -join ', ') points at the user accounts (auth.users); each row needs a live account") }
  if ($missingUsers.Count -gt 0) {
    if ($CreateUsers) { $lines.Add("Users: $($missingUsers.Count) account(s) will be created by -Apply -CreateUsers (no password; see the guide)") }
    else {
      $msg = "$($missingUsers.Count) user account(s) in the backup have no live account: their profiles rows and everything pointing at them will be refused. Add -CreateUsers."
      $lines.Add("Users: $msg")
      $wouldFail.Add($msg)
    }
    foreach ($m in $missingUsers) { $lines.Add("  - $($m.email)  role: $($m.role)") }
  }
  if ($idMap.Count -gt 0) { $lines.Add("Users: $($idMap.Count) account(s) exist live under a different id (fresh project): their ids are mapped old → new on every user column during -Apply") }
  if ($id.live_admins -eq 0) { $lines.Add("Users: the project has NO admin account yet; -Apply -CreateUsers will ask which restored admin signs in first and for that one password") }
  $lines.Add("")
}

# 3d. storage: the slot's files vs what exists live
$localFiles = @()
if ($doStorage -and (Test-Path -LiteralPath $storageDir)) {
  foreach ($bDir in @(Get-ChildItem -LiteralPath $storageDir -Directory)) {
    $bucket = $bDir.Name
    foreach ($f in @(Get-ChildItem -LiteralPath $bDir.FullName -File -Recurse)) {
      $rel = $f.FullName.Substring($bDir.FullName.Length).TrimStart('\') -replace '\\', '/'
      $localFiles += [pscustomobject]@{ bucket = $bucket; path = $rel; size = [int64]$f.Length; local = $f.FullName }
    }
  }
}
$existing = @{}
if ($doStorage -and $localFiles.Count -gt 0) {
  foreach ($bucket in @($localFiles | ForEach-Object { $_.bucket } | Sort-Object -Unique)) {
    $paths = @($localFiles | Where-Object { $_.bucket -eq $bucket } | ForEach-Object { $_.path })
    for ($i = 0; $i -lt $paths.Count; $i += 1000) {
      $end = [Math]::Min($i + 1000, $paths.Count) - 1
      $chunk = @($paths[$i..$end])
      $body = '{"op":"files_exist","project":' + $projectJson + ',"bucket":"' + $bucket + '","paths":' + (ConvertTo-Json -InputObject $chunk -Compress) + '}'
      $ans = Invoke-Door $body "files_exist $bucket" 2
      foreach ($p in $ans.exists.PSObject.Properties) { $existing["$bucket/$($p.Name)"] = [int64]$p.Value }
    }
  }
  $toUpload = @($localFiles | Where-Object { -not $existing.ContainsKey("$($_.bucket)/$($_.path)") })
  $mismatch = @($localFiles | Where-Object { $existing.ContainsKey("$($_.bucket)/$($_.path)") -and $existing["$($_.bucket)/$($_.path)"] -ne $_.size })
  $report.storage.files = $localFiles.Count; $report.storage.existing = $existing.Count; $report.storage.to_upload = $toUpload.Count
  $report.storage.size_mismatch = @($mismatch | ForEach-Object { "$($_.bucket)/$($_.path)" })
  $lines.Add("Storage: $($localFiles.Count) files in the backup, $($existing.Count) already live (kept as they are), $($toUpload.Count) to upload")
  foreach ($m in $mismatch) { $lines.Add("  - $($m.bucket)/$($m.path) exists live with a different size (live $($existing["$($m.bucket)/$($m.path)"]) vs backup $($m.size)); the live one is kept") }
  $lines.Add("")
} elseif ($doStorage) {
  $lines.Add("Storage: no files in this slot")
  $lines.Add("")
}

# ---------------------------------------------------------------- 4. apply
$results = [ordered]@{}
if ($isApply) {
  # 4a. user accounts
  if ($doDb -and $missingUsers.Count -gt 0 -and $CreateUsers) {
    $firstAdmin = $null
    $firstPassword = $null
    if ([int]$id.live_admins -eq 0) {
      $admins = @($missingUsers | Where-Object { [string]$_.role -eq 'admin' })
      if ($admins.Count -gt 0) {
        Write-Host ""
        Write-Host "This project has no admin account yet. Passwords are in no backup, so one restored admin needs an initial password to sign in and set everyone else's (Admin › Users & access)." -ForegroundColor Yellow
        Write-Host "Restored admins:"
        foreach ($a in $admins) { Write-Host "  $($a.email)" }
        $pick = Read-Host "Which admin signs in first? [Enter = $($admins[0].email)]"
        if (-not $pick -or -not $pick.Trim()) { $pick = $admins[0].email }
        $firstAdmin = $admins | Where-Object { [string]$_.email -eq $pick.Trim() } | Select-Object -First 1
        if (-not $firstAdmin) { throw "No restored admin has the email '$pick'" }
        while ($true) {
          $s1 = Read-Host "Initial password for $($firstAdmin.email) (at least 8 characters)" -AsSecureString
          $s2 = Read-Host "Type it again" -AsSecureString
          $p1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
          $p2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))
          if ($p1.Length -lt 8) { Write-Host "At least 8 characters." -ForegroundColor Yellow; continue }
          if ($p1 -ne $p2) { Write-Host "They differ; again." -ForegroundColor Yellow; continue }
          $firstPassword = $p1
          break
        }
      } else {
        Write-Log "No admin among the missing accounts: the project stays without an admin until one is made"
      }
    } else {
      Write-Log "The project already has $($id.live_admins) admin account(s): passwords are set from Admin › Users & access"
    }
    foreach ($m in $missingUsers) {
      $req = [ordered]@{ op = 'create_user'; project = $Project; email = [string]$m.email; full_name = $m.full_name }
      $isFirst = ($firstAdmin -and ([string]$m.email -eq [string]$firstAdmin.email))
      if ($isFirst -and $firstPassword) { $req.password = $firstPassword }
      $ans = Invoke-Door (ConvertTo-Json -InputObject $req -Compress) "create_user" 1
      $req = $null
      $note = 'created — set their password under Admin › Users & access'
      if ($isFirst) { $note = 'created — initial password set by the operator' }
      if (-not $ans.created) { $note = 'already existed' }
      Write-Log "User $($m.email): $note"
      $report.users.created += [ordered]@{ email = $m.email; note = $note }
      if ([string]$ans.id -ne [string]$m.id) { $idMap[[string]$m.id] = [string]$ans.id }
    }
    $firstPassword = $null
    $report.users.ids_mapped = $idMap.Count
  } elseif ($doDb -and $missingUsers.Count -gt 0) {
    Write-Log "WARNING: $($missingUsers.Count) user account(s) are missing live and -CreateUsers was not given: their rows will be refused"
  }
  $idMapJson = ConvertTo-Json -InputObject $idMap -Compress
  if ($idMap.Count -eq 0) { $idMapJson = '{}' }

  # 4b. the tables, in the portal's order, page by page
  function Send-Table([string]$t, [bool]$secondPass) {
    $r = $results[$t]
    $fkFailed = 0
    # A second pass counts only what is STILL refused: the first pass's errors for this table go.
    if ($secondPass) { $r.errors = @() }
    foreach ($p in $info[$t].pages) {
      $content = Get-Content -LiteralPath $p.FullName -Raw -Encoding UTF8
      if (-not $content -or $content.Trim() -eq '' -or $content.Trim() -eq '[]') { continue }
      $body = '{"op":"rows","project":' + $projectJson + ',"table":"' + $t + '","mode":"' + $Mode + '","id_map":' + $idMapJson + ',"rows":' + $content + '}'
      $ans = Invoke-Door $body "rows $t $($p.Name)" 2
      $r.inserted += [int]$ans.inserted; $r.replaced += [int]$ans.replaced; $r.skipped += [int]$ans.skipped
      $r.remapped += [int]$ans.remapped
      foreach ($d in @($ans.dropped_columns)) { if ($r.dropped -notcontains $d) { $r.dropped += $d } }
      foreach ($e in @($ans.errors)) {
        $r.errors += [ordered]@{ page = $p.Name; index = $e.index; code = $e.code; message = $e.message }
        if ([string]$e.code -eq '23503') { $fkFailed++ }
      }
    }
    return $fkFailed
  }

  if ($doDb) {
    $needSecondPass = @()
    foreach ($t in $restorable) {
      if ($info[$t].rows -eq 0) { continue }
      $results[$t] = [ordered]@{ table = $t; backup_rows = $info[$t].rows; inserted = 0; replaced = 0; skipped = 0; errors = @(); dropped = @(); remapped = 0; live_rows = $null }
      $fkFailed = Send-Table $t $false
      $r = $results[$t]
      Write-Log ("{0}: {1} inserted, {2} replaced, {3} skipped, {4} refused" -f $t, $r.inserted, $r.replaced, $r.skipped, $r.errors.Count)
      if ($fkFailed -gt 0) { $needSecondPass += $t }
    }
    # Rows refused for a parent that was not there yet (circular references): one more pass now
    # that every table is in. The same pages are sent again; rows already in are skipped (or, in
    # replace mode, written again identically).
    foreach ($t in $needSecondPass) {
      Write-Log "$t`: second pass for rows refused on a foreign key"
      $before = $results[$t].errors.Count
      $null = Send-Table $t $true
      Write-Log ("{0}: second pass left {1} refused (was {2})" -f $t, $results[$t].errors.Count, $before)
    }
    foreach ($t in $backupTables) {
      if ($blockedTables -contains $t) { Write-Log "$t`: NOT restored (would fail: $(($planOf[$t].notes) -join '; '))" }
      elseif ($deniedTables -contains $t) { Write-Log "$t`: not restored (deny list)" }
    }
  }

  # 4c. the storage files: only what is missing live, sizes verified afterwards
  if ($doStorage -and $localFiles.Count -gt 0) {
    $uploaded = 0
    $toUpload = @($localFiles | Where-Object { -not $existing.ContainsKey("$($_.bucket)/$($_.path)") })
    foreach ($f in $toUpload) {
      $ans = Send-File $f.bucket $f.path $f.local (Get-ContentType $f.path)
      if ($ans.stored) {
        if ([int64]$ans.bytes -ne $f.size) { throw "Upload of $($f.bucket)/$($f.path) received $($ans.bytes) bytes, the file is $($f.size)" }
        $uploaded++
      }
    }
    $report.storage.uploaded = $uploaded
    Write-Log "Storage: $uploaded file(s) uploaded, $($existing.Count) already there"
    # Verify: every file in the backup now exists live with the backup's size (unless it already
    # existed with another size, which was reported and left alone).
    $verify = @{}
    foreach ($bucket in @($toUpload | ForEach-Object { $_.bucket } | Sort-Object -Unique)) {
      $paths = @($toUpload | Where-Object { $_.bucket -eq $bucket } | ForEach-Object { $_.path })
      for ($i = 0; $i -lt $paths.Count; $i += 1000) {
        $end = [Math]::Min($i + 1000, $paths.Count) - 1
        $chunk = @($paths[$i..$end])
        $body = '{"op":"files_exist","project":' + $projectJson + ',"bucket":"' + $bucket + '","paths":' + (ConvertTo-Json -InputObject $chunk -Compress) + '}'
        $ans = Invoke-Door $body "files_exist $bucket" 2
        foreach ($p in $ans.exists.PSObject.Properties) { $verify["$bucket/$($p.Name)"] = [int64]$p.Value }
      }
    }
    foreach ($f in $toUpload) {
      $k = "$($f.bucket)/$($f.path)"
      if (-not $verify.ContainsKey($k)) { $wouldFail.Add("$k is not in storage after the upload"); $report.errors++ }
      elseif ($verify[$k] -ne $f.size) { $wouldFail.Add("$k is $($verify[$k]) bytes live, $($f.size) in the backup"); $report.errors++ }
    }
  }

  # 4d. finish: sequences, triggers, live counts
  if ($doDb) {
    $fin = Invoke-Door ('{"op":"finish","project":' + $projectJson + '}') 'finish' 2
    $report.sequences = @($fin.sequences | ForEach-Object { "$($_.sequence) → $($_.next) ($($_.table).$($_.column) max $($_.max))" })
    Write-Log "Finish: $(@($fin.sequences).Count) sequence(s) reset, $(@($fin.triggers_enabled).Count) trigger(s) re-enabled"
    foreach ($p in $fin.live_counts.PSObject.Properties) { $liveCounts[$p.Name] = [int64]$p.Value }

    $lines.Add("Result (backup rows / live rows now / inserted / replaced / skipped / refused):")
    $totalErrors = 0
    foreach ($t in $backupTables) {
      $live = '-'
      if ($liveCounts.ContainsKey($t)) { $live = $liveCounts[$t] }
      if ($results.Contains($t)) {
        $r = $results[$t]
        $r.live_rows = $live
        $totalErrors += $r.errors.Count
        $flag = ''
        if ($r.errors.Count -gt 0) { $flag = '  REFUSED ROWS' }
        if ($r.dropped.Count -gt 0) { $flag += '  ignored columns: ' + ($r.dropped -join ', ') }
        $lines.Add(("  {0,-36} {1,8} {2,8} {3,8} {4,8} {5,8} {6,8}{7}" -f $t, $r.backup_rows, $live, $r.inserted, $r.replaced, $r.skipped, $r.errors.Count, $flag))
        $report.tables += $r
      } else {
        $why = 'no rows'
        if ($blockedTables -contains $t) { $why = 'NOT RESTORED — would fail' }
        elseif ($deniedTables -contains $t) { $why = 'not restored (deny list)' }
        $lines.Add(("  {0,-36} {1,8} {2,8}  {3}" -f $t, $info[$t].rows, $live, $why))
        $report.tables += [ordered]@{ table = $t; backup_rows = $info[$t].rows; live_rows = $live; inserted = 0; replaced = 0; skipped = 0; errors = @(); note = $why }
      }
      if ($liveCounts.ContainsKey($t) -and $liveCounts[$t] -lt $info[$t].rows -and ($restorable -contains $t)) {
        $lines.Add("    live has fewer rows than the backup: $($liveCounts[$t]) vs $($info[$t].rows)")
      }
    }
    $report.errors += $totalErrors
    $lines.Add("")
    if ($totalErrors -gt 0) {
      $lines.Add("Refused rows (first 50):")
      $shown = 0
      foreach ($t in $results.Keys) {
        foreach ($e in $results[$t].errors) {
          if ($shown -ge 50) { break }
          $lines.Add("  $t $($e.page) row $($e.index) [$($e.code)]: $($e.message)")
          $shown++
        }
      }
      $lines.Add("")
    }
    foreach ($s in $report.sequences) { $lines.Add("Sequence: $s") }
    foreach ($u in $report.users.created) { $lines.Add("User $($u.email): $($u.note)") }
    $lines.Add("")
  }
}

# ---------------------------------------------------------------- the report and the exit code
$report.would_fail = @($wouldFail)
$exit = 0
if ($isApply) {
  $report.ok = ($report.errors -eq 0 -and $wouldFail.Count -eq 0)
  if (-not $report.ok) { $exit = 1 }
  if ($report.ok) { $lines.Add("RESULT: restore complete, nothing refused") }
  else { $lines.Add("RESULT: restore finished with $($report.errors) refused row(s) / problem(s) — see above") }
} else {
  $report.ok = ($wouldFail.Count -eq 0)
  if (-not $report.ok) { $exit = 1 }
  if ($report.ok) { $lines.Add("RESULT: dry run clean — nothing would fail. Next: the same command with -Apply (and -Yes to skip the typed confirmation).") }
  else {
    $lines.Add("RESULT: dry run found $($wouldFail.Count) thing(s) that would fail:")
    foreach ($w in $wouldFail) { $lines.Add("  - $w") }
  }
}
$reportTxt = Assert-UnderRoot (Join-Path $slotPath 'restore-report.txt')
$reportJson = Assert-UnderRoot (Join-Path $slotPath 'restore-report.json')
$lines | Set-Content -LiteralPath $reportTxt -Encoding UTF8
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportJson -Encoding UTF8
Write-Host ""
foreach ($l in $lines) { Write-Host $l }
Write-Log ("Report: {0} ({1}s)" -f $reportTxt, [int]((Get-Date) - $started).TotalSeconds)
exit $exit
