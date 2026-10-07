<#
.SYNOPSIS
  Nightly backup of the JBK Portal (Lovable Cloud / Supabase) onto the office Windows server.

.DESCRIPTION
  Owner, Oct 7 2026: "a backup saved nightly on our server … save today 10/7, and tomorrow 10/8,
  then when it goes to save 10/9 it overwrites 10/7 … to be efficient with memory and prevent
  an empty or corrupted save from wiping all our data."

  Needs nothing installed: Windows PowerShell 5.1 (on every Windows machine) and the backup
  password. Lovable Cloud does not hand out the database's master key, so the portal's own server
  (which holds it) answers at <portal>/api/backup to this password alone — a value the owner makes
  up and sets in Lovable Cloud › Secrets as BACKUP_SECRET and here in the config as BackupSecret
  (owner, Oct 7: "could we not do the portal side backup door and i just set the password?").
  Every night it:
    1. Downloads every table of the portal's database through that door, 1,000 rows a page,
       into db\<table>\page-0001.json … (plus db\schema.json with the column types) in a
       temporary "_incoming" folder. Tables in SkipTables (the public map data the portal
       re-loads itself every month) are left out so the backup stays small and quick.
    2. Checks the copy before trusting it: at least MinTables tables came down, every table's
       rows match what the API said it holds, the folder is at least half of last night's size,
       and the key tables' row counts are at least 90 % of last night's and never zero where last
       night had rows. Counts go to manifest.json.
    3. Downloads the storage buckets (ticket photos, signatures, receipts, PDFs, takeoff plans),
       reusing last night's copy of any file whose size has not changed.
    4. Only then rotates: with two slots already present the OLDER one is removed, and the
       incoming folder becomes backup-YYYY-MM-DD. A failed night leaves both old slots untouched,
       keeps its folder as _failed-…, and writes LAST-BACKUP-FAILED.txt with the reason.
    5. Sundays: a copy of the db\ folder goes to weekly\ (the newest WeeklyKeep are kept), so
       damage noticed a week later still has a clean copy.
    6. status.json and backup.log in the root say what happened.

  Safety rails (owner, Oct 7: "we need to make sure we cant do damage to the server"):
    - It only READS from the cloud (GET requests to the portal's read-only /api/backup). It never
      writes to the portal, and it never holds the database's master key.
    - It writes only inside DestinationRoot, and refuses a root that is a drive root (X:\). The
      only deletions are its own backup-*, _failed-* and weekly\ entries under that root.
    - The backup password lives in jbk-backup.config.json beside this script, on the server only
      (see docs/backup/windows-server-setup.md for the folder permissions). Never in the repo.

.PARAMETER ConfigPath
  The JSON config (default: jbk-backup.config.json next to this script).
.PARAMETER DryRun
  Do everything except rotate: the copy lands in an _incoming folder you can inspect.
#>
[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'jbk-backup.config.json'),
  [switch]$DryRun
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$started = Get-Date
$stamp = $started.ToString('yyyy-MM-dd')
$script:LogFile = $null

function Write-Log([string]$msg) {
  $line = "{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $msg
  Write-Host $line
  if ($script:LogFile) { Add-Content -Path $script:LogFile -Value $line -Encoding UTF8 }
}

# ---------------------------------------------------------------- config and guards
if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Config not found: $ConfigPath (copy jbk-backup.config.example.json to jbk-backup.config.json and fill it in)"
}
$cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
foreach ($k in 'DestinationRoot', 'AppUrl', 'BackupSecret') {
  if (-not $cfg.$k) { throw "Config is missing $k" }
}
if ($cfg.AppUrl -like '*PASTE*' -or $cfg.BackupSecret -like '*PASTE*') { throw "Put the portal address and the backup password into the config first" }
if (([string]$cfg.BackupSecret).Length -lt 24) { throw "BackupSecret must be at least 24 characters (the portal refuses shorter ones)" }
$root = [string]$cfg.DestinationRoot
# Tables and buckets come from the portal each night (so one added later is backed up without
# touching this config); the config's Tables / Buckets are only the fallback when it lists none.
$cfgBuckets = @($cfg.Buckets); if (-not $cfgBuckets) { $cfgBuckets = @('service', 'takeoffs') }
$keyTables = @($cfg.KeyTables); if (-not $keyTables) { $keyTables = @('bids', 'service_jobs', 'crm_accounts', 'invoices') }
$skipTables = @($cfg.SkipTables)
$weeklyKeep = if ($cfg.WeeklyKeep) { [int]$cfg.WeeklyKeep } else { 5 }
$minTables = if ($cfg.MinTables) { [int]$cfg.MinTables } else { 50 }
$pageSize = 1000

# The root must be a real folder below a drive or share root — never a drive root itself, so a
# typo like "X:\" can never make the rotation remove other folders on the share.
$rootItem = Get-Item -LiteralPath $root -ErrorAction SilentlyContinue
if (-not $rootItem -or -not $rootItem.PSIsContainer) { throw "DestinationRoot does not exist or is not a folder: $root (create it first)" }
if ([System.IO.Path]::GetPathRoot($rootItem.FullName).TrimEnd('\') -eq $rootItem.FullName.TrimEnd('\')) {
  throw "DestinationRoot must be a folder inside the drive, not the drive itself: $root"
}
$root = $rootItem.FullName.TrimEnd('\')
$script:LogFile = Join-Path $root 'backup.log'

function Assert-UnderRoot([string]$path) {
  $full = [System.IO.Path]::GetFullPath($path)
  if (-not $full.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to touch a path outside the backup root: $full"
  }
  return $full
}
function Remove-UnderRoot([string]$path) {
  $full = Assert-UnderRoot $path
  Write-Log "Removing $full"
  Remove-Item -LiteralPath $full -Recurse -Force
}
function Get-FolderBytes([string]$path) {
  $sum = (Get-ChildItem -LiteralPath $path -Recurse -File | Measure-Object -Property Length -Sum).Sum
  if ($sum) { return [int64]$sum } else { return [int64]0 }
}

# The portal's backup door (src/routes/api.backup.ts): GET ?what=tables | rows | files | file.
$door = ([string]$cfg.AppUrl).TrimEnd('/') + '/api/backup'
$headers = @{ Authorization = "Bearer $($cfg.BackupSecret)" }

$slots = @(Get-ChildItem -LiteralPath $root -Directory -Filter 'backup-*' | Sort-Object Name)
$previous = if ($slots.Count -gt 0) { $slots[-1] } else { $null }
$incoming = Join-Path $root ("_incoming-" + $started.ToString('yyyy-MM-dd-HHmm'))
$null = New-Item -ItemType Directory -Path $incoming
Write-Log "Backup started → $incoming (previous: $(if ($previous) { $previous.Name } else { 'none' }))"

$status = [ordered]@{ ok = $false; at = $started.ToString('o'); slot = $null; bytes = 0; tables = 0; rows = 0; counts = @{}; objects = 0; reused = 0; error = $null; durationSec = 0 }

try {
  # ------------------------------------------------------------ 1. the tables, through the portal's door
  $dbDir = Join-Path $incoming 'db'
  $null = New-Item -ItemType Directory -Path $dbDir
  # The table list: what the portal describes (?what=tables: every table with whether it has an
  # id column, plus the column types, saved as schema.json), or the config's Tables when given.
  # A wrong password stops here with "401 (Unauthorized)"; a missing BACKUP_SECRET in Lovable
  # with "500" and the reason in the body.
  $desc = Invoke-RestMethod -Method Get -Uri "${door}?what=tables" -Headers $headers
  $defs = $desc.schema
  $idTables = @{}
  foreach ($d in @($desc.tables)) { $idTables[$d.name] = [bool]$d.hasId }
  if ($defs) { ($defs | ConvertTo-Json -Depth 20) | Set-Content -LiteralPath (Join-Path $dbDir 'schema.json') -Encoding UTF8 }
  $tables = @()
  if ($desc.tables) { $tables = @($desc.tables | ForEach-Object { $_.name } | Sort-Object) }
  elseif ($cfg.Tables) { $tables = @($cfg.Tables); Write-Log "The portal listed no tables; using the config's Tables" }
  else { throw "No table list: the portal described no tables and the config has no Tables" }
  $tables = @($tables | Where-Object { $skipTables -notcontains $_ })
  if ($tables.Count -lt $minTables) { throw "Only $($tables.Count) tables listed (expected at least $minTables)" }
  Write-Log "Tables to copy: $($tables.Count) (skipping: $($skipTables -join ', '))"

  $counts = [ordered]@{}
  $totalRows = [int64]0
  foreach ($t in $tables) {
    $hasId = if ($idTables.ContainsKey($t)) { $idTables[$t] } else { $true }
    $order = if ($hasId) { '&order=id' } else { '' }
    $tDir = Join-Path $dbDir $t
    $null = New-Item -ItemType Directory -Path $tDir
    # The first page also brings the exact row count (Content-Range: 0-999/12345).
    $first = Invoke-WebRequest -Method Get -Uri "${door}?what=rows&table=$t&limit=$pageSize&offset=0$order" -Headers $headers -UseBasicParsing
    $range = [string]$first.Headers['Content-Range']
    $expected = if ($range -match '/(\d+)$') { [int64]$Matches[1] } else { -1 }
    $page = 1
    $got = [int64]0
    $content = $first.Content
    while ($true) {
      $rows = @((ConvertFrom-Json $content))
      $got += $rows.Count
      Set-Content -LiteralPath (Join-Path $tDir ("page-{0:D4}.json" -f $page)) -Value $content -Encoding UTF8
      if ($rows.Count -lt $pageSize) { break }
      $page++
      $resp = Invoke-WebRequest -Method Get -Uri "${door}?what=rows&table=$t&limit=$pageSize&offset=$(($page - 1) * $pageSize)$order" -Headers $headers -UseBasicParsing
      $content = $resp.Content
    }
    if ($expected -ge 0 -and $got -ne $expected) { throw "$t came down with $got rows but the API holds $expected" }
    $counts[$t] = $got
    $totalRows += $got
  }
  $status.tables = $tables.Count; $status.rows = $totalRows
  Write-Log ("Tables: {0}, rows: {1:N0}" -f $tables.Count, $totalRows)
  Write-Log ("Key tables: " + (($keyTables | ForEach-Object { "$_=$($counts[$_])" }) -join ', '))

  # ------------------------------------------------------------ 2. compared with last night
  $dbBytes = Get-FolderBytes $dbDir
  if ($previous) {
    $prevManifestPath = Join-Path $previous.FullName 'manifest.json'
    if (Test-Path -LiteralPath $prevManifestPath) {
      $prev = Get-Content -LiteralPath $prevManifestPath -Raw | ConvertFrom-Json
      if ($prev.dbBytes -and $dbBytes -lt 0.5 * [int64]$prev.dbBytes) {
        throw ("The tables came to {0:N0} bytes, under half of last night's {1:N0}: not trusted" -f $dbBytes, [int64]$prev.dbBytes)
      }
      foreach ($t in $keyTables) {
        $was = $prev.counts.$t
        if ($null -ne $was -and [int64]$was -gt 0) {
          $now = [int64]$counts[$t]
          if ($now -eq 0) { throw "$t has 0 rows tonight but had $was last night: not trusted" }
          if ($now -lt 0.9 * [int64]$was) { throw "$t has $now rows tonight, under 90 % of last night's ${was}: not trusted" }
        }
      }
      Write-Log "Compared with $($previous.Name): size and row counts are sound"
    }
  }

  # ------------------------------------------------------------ 3. storage files
  $objects = 0; $reused = 0
  $buckets = @()
  try {
    $bl = Invoke-RestMethod -Method Get -Uri "${door}?what=buckets" -Headers $headers
    $buckets = @($bl.buckets)
  } catch { Write-Log "The portal did not list the buckets: $($_.Exception.Message)" }
  if (-not $buckets) { $buckets = $cfgBuckets; Write-Log "Using the config's Buckets" }
  function Get-BucketObjects([string]$bucket, [string]$prefix) {
    $out = @(); $offset = 0
    while ($true) {
      $page = Invoke-RestMethod -Method Get -Uri "${door}?what=files&bucket=$bucket&prefix=$([uri]::EscapeDataString($prefix))&offset=$offset" -Headers $headers
      foreach ($e in @($page)) {
        $name = if ($prefix) { "$prefix/$($e.name)" } else { $e.name }
        if ($null -eq $e.id) { $out += Get-BucketObjects $bucket $name }   # a folder
        else { $out += [pscustomobject]@{ path = $name; size = [int64]($e.metadata.size) } }
      }
      if (@($page).Count -lt 1000) { break }
      $offset += 1000
    }
    return $out
  }
  foreach ($bucket in $buckets) {
    $list = @(Get-BucketObjects $bucket '')
    Write-Log "Bucket ${bucket}: $($list.Count) files"
    foreach ($o in $list) {
      $rel = Join-Path 'storage' (Join-Path $bucket ($o.path -replace '/', '\'))
      $dest = Assert-UnderRoot (Join-Path $incoming $rel)
      $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest)
      $prevFile = if ($previous) { Join-Path $previous.FullName $rel } else { $null }
      if ($prevFile -and (Test-Path -LiteralPath $prevFile) -and ((Get-Item -LiteralPath $prevFile).Length -eq $o.size)) {
        Copy-Item -LiteralPath $prevFile -Destination $dest
        $reused++
      } else {
        Invoke-WebRequest -Method Get -Uri "${door}?what=file&bucket=$bucket&path=$([uri]::EscapeDataString($o.path))" -Headers $headers -OutFile $dest -UseBasicParsing
        if ((Get-Item -LiteralPath $dest).Length -ne $o.size) { throw "Downloaded size differs for $bucket/$($o.path)" }
      }
      $objects++
    }
  }
  $status.objects = $objects; $status.reused = $reused
  Write-Log "Storage: $objects files ($reused reused from last night)"

  # ------------------------------------------------------------ manifest
  $status.bytes = Get-FolderBytes $incoming
  $status.counts = $counts
  $manifest = [ordered]@{ at = $started.ToString('o'); dbBytes = $dbBytes; totalBytes = $status.bytes; tables = $tables.Count; rows = $totalRows; counts = $counts; objects = $objects; skipped = $skipTables; format = 'JSON pages from the portal /api/backup door (select=*, 1000 rows a page) + storage files' }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $incoming 'manifest.json') -Encoding UTF8

  if ($DryRun) {
    Write-Log "Dry run: nothing rotated; inspect $incoming"
    $status.ok = $true; $status.slot = (Split-Path -Leaf $incoming)
  } else {
    # ---------------------------------------------------------- 4. rotate: the older of two slots goes
    $slots = @(Get-ChildItem -LiteralPath $root -Directory -Filter 'backup-*' | Sort-Object Name)
    while ($slots.Count -ge 2) {
      Remove-UnderRoot $slots[0].FullName
      $slots = @(Get-ChildItem -LiteralPath $root -Directory -Filter 'backup-*' | Sort-Object Name)
    }
    $slotName = "backup-$stamp"
    if (Test-Path -LiteralPath (Join-Path $root $slotName)) { $slotName = "backup-$stamp-" + $started.ToString('HHmm') }
    Rename-Item -LiteralPath $incoming -NewName $slotName
    $status.slot = $slotName
    Write-Log "Promoted → $slotName"

    # ---------------------------------------------------------- 5. the Sunday copy of the tables
    if ($started.DayOfWeek -eq 'Sunday') {
      $weekly = Join-Path $root 'weekly'
      $null = New-Item -ItemType Directory -Force -Path $weekly
      Copy-Item -LiteralPath (Join-Path (Join-Path $root $slotName) 'db') -Destination (Join-Path $weekly "$stamp-db") -Recurse
      $old = @(Get-ChildItem -LiteralPath $weekly -Directory -Filter '*-db' | Sort-Object Name -Descending | Select-Object -Skip $weeklyKeep)
      foreach ($f in $old) { Remove-UnderRoot $f.FullName }
      Write-Log "Weekly copy kept ($weeklyKeep newest)"
    }

    # ---------------------------------------------------------- old failed folders (7 days)
    foreach ($f in @(Get-ChildItem -LiteralPath $root -Directory -Filter '_failed-*' | Where-Object { $_.CreationTime -lt $started.AddDays(-7) })) { Remove-UnderRoot $f.FullName }
    $status.ok = $true
  }
  $failedMarker = Join-Path $root 'LAST-BACKUP-FAILED.txt'
  if (Test-Path -LiteralPath $failedMarker) { Remove-Item -LiteralPath $failedMarker -Force }
}
catch {
  $status.ok = $false
  $status.error = $_.Exception.Message
  Write-Log "FAILED: $($_.Exception.Message)"
  try {
    if (Test-Path -LiteralPath $incoming) {
      $failedName = "_failed-" + $started.ToString('yyyy-MM-dd-HHmm')
      Rename-Item -LiteralPath $incoming -NewName $failedName
      $status.slot = $failedName
    }
    Set-Content -LiteralPath (Join-Path $root 'LAST-BACKUP-FAILED.txt') -Value ("{0}`r`n{1}`r`nBoth earlier backups were left untouched." -f (Get-Date), $_.Exception.Message) -Encoding UTF8
  } catch { Write-Log "Could not record the failure: $($_.Exception.Message)" }
}
finally {
  $status.durationSec = [int]((Get-Date) - $started).TotalSeconds
  $status | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'status.json') -Encoding UTF8
  Write-Log ("Finished: {0} in {1}s" -f $(if ($status.ok) { 'OK' } else { 'FAILED' }), $status.durationSec)
}
if (-not $status.ok) { exit 1 }
