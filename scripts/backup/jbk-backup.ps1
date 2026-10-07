<#
.SYNOPSIS
  Nightly backup of the JBK Portal (Lovable Cloud / Supabase) onto the office Windows server.

.DESCRIPTION
  Owner, Oct 7 2026: "a backup saved nightly on our server … save today 10/7, and tomorrow 10/8,
  then when it goes to save 10/9 it overwrites 10/7 … to be efficient with memory and prevent
  an empty or corrupted save from wiping all our data."

  What it does, every night:
    1. Dumps the whole database (schema public: bids, tickets, customers, invoices, settings,
       the audit log …) with pg_dump into a temporary "_incoming" folder.
    2. Checks the dump before trusting it: pg_restore can read its catalog and it holds at least
       MinTableDataEntries tables; its size is at least half of last night's; and the live row
       counts of the key tables are at least 90 % of last night's and never zero where last night
       had rows. Counts are written to manifest.json.
    3. Downloads the storage buckets (ticket photos, signatures, receipts, PDFs, takeoff plans),
       reusing last night's copy of any file whose size has not changed.
    4. Only then rotates: with two slots already present the OLDER one is removed, and the
       incoming folder becomes backup-YYYY-MM-DD. A failed night leaves both old slots untouched,
       keeps its folder as _failed-…, and writes LAST-BACKUP-FAILED.txt with the reason.
    5. Sundays: a copy of the dump goes to weekly\ (the newest WeeklyKeep are kept), so damage
       noticed a week later still has a clean copy.
    6. status.json and backup.log in the root say what happened.

  Safety rails (owner, Oct 7: "we need to make sure we cant do damage to the server"):
    - It only READS from the cloud (pg_dump, psql SELECT, storage downloads). It never writes to
      the portal's database or storage.
    - It writes only inside DestinationRoot, and refuses a root that is a drive root (X:\) or
      the share of another program's data. The only deletions are its own backup-*, _failed-*
      and weekly\ entries under that root.
    - Credentials live in jbk-backup.config.json beside this script, on the server only (see
      docs/backup/windows-server-setup.md for the folder permissions). They are never in the
      repository.

.PARAMETER ConfigPath
  The JSON config (default: jbk-backup.config.json next to this script).
.PARAMETER DryRun
  Do everything except rotate: the dump and files land in an _incoming folder you can inspect.
#>
[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'jbk-backup.config.json'),
  [switch]$DryRun
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
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
  throw "Config not found: $ConfigPath (copy jbk-backup.config.example.json and fill it in)"
}
$cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
foreach ($k in 'DestinationRoot', 'PgBinDir', 'DatabaseUrl', 'SupabaseUrl', 'SupabaseServiceKey') {
  if (-not $cfg.$k) { throw "Config is missing $k" }
}
$root = [string]$cfg.DestinationRoot
$buckets = @($cfg.Buckets); if (-not $buckets) { $buckets = @('service', 'takeoffs') }
$keyTables = @($cfg.KeyTables); if (-not $keyTables) { $keyTables = @('bids', 'service_jobs', 'crm_accounts', 'invoices') }
$weeklyKeep = if ($cfg.WeeklyKeep) { [int]$cfg.WeeklyKeep } else { 5 }
$minTables = if ($cfg.MinTableDataEntries) { [int]$cfg.MinTableDataEntries } else { 50 }

# The root must be a real folder below a drive or share root — never a drive root itself, so
# a typo like "X:\" can never make the rotation delete other folders on the share.
$rootItem = Get-Item -LiteralPath $root -ErrorAction SilentlyContinue
if (-not $rootItem -or -not $rootItem.PSIsContainer) { throw "DestinationRoot does not exist or is not a folder: $root" }
if ($rootItem.Parent -eq $null -or [System.IO.Path]::GetPathRoot($rootItem.FullName).TrimEnd('\') -eq $rootItem.FullName.TrimEnd('\')) {
  throw "DestinationRoot must be a folder inside the drive, not the drive itself: $root"
}
$root = $rootItem.FullName.TrimEnd('\')
$script:LogFile = Join-Path $root 'backup.log'

$pgDump = Join-Path $cfg.PgBinDir 'pg_dump.exe'
$pgRestore = Join-Path $cfg.PgBinDir 'pg_restore.exe'
$psql = Join-Path $cfg.PgBinDir 'psql.exe'
foreach ($exe in $pgDump, $pgRestore, $psql) { if (-not (Test-Path -LiteralPath $exe)) { throw "Not found: $exe (install the PostgreSQL 17 command-line tools)" } }

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

$slots = @(Get-ChildItem -LiteralPath $root -Directory -Filter 'backup-*' | Sort-Object Name)
$previous = if ($slots.Count -gt 0) { $slots[-1] } else { $null }
$incoming = Join-Path $root ("_incoming-" + $started.ToString('yyyy-MM-dd-HHmm'))
$null = New-Item -ItemType Directory -Path $incoming
Write-Log "Backup started → $incoming (previous: $(if ($previous) { $previous.Name } else { 'none' }))"

$status = [ordered]@{ ok = $false; at = $started.ToString('o'); slot = $null; dbBytes = 0; counts = @{}; objects = 0; reused = 0; error = $null; durationSec = 0 }

try {
  # ------------------------------------------------------------ 1. the database dump
  $dumpPath = Join-Path $incoming 'db.dump'
  Write-Log "pg_dump → db.dump"
  & $pgDump --format=custom --no-owner --no-privileges --schema=public --file=$dumpPath $cfg.DatabaseUrl
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }
  $dumpBytes = (Get-Item -LiteralPath $dumpPath).Length
  $status.dbBytes = $dumpBytes
  Write-Log ("db.dump: {0:N0} bytes" -f $dumpBytes)

  # ------------------------------------------------------------ 2. checks before trusting it
  $listing = & $pgRestore --list $dumpPath
  if ($LASTEXITCODE -ne 0) { throw "pg_restore --list failed: the dump cannot be read" }
  $tableData = @($listing | Where-Object { $_ -match ' TABLE DATA ' }).Count
  if ($tableData -lt $minTables) { throw "The dump holds only $tableData tables' data (expected at least $minTables)" }
  Write-Log "Dump catalog OK: $tableData tables with data"

  $counts = [ordered]@{}
  foreach ($t in $keyTables) {
    if ($t -notmatch '^[a-z_][a-z0-9_]*$') { throw "Bad key table name: $t" }
    $n = & $psql --no-psqlrc --tuples-only --no-align --command "select count(*) from public.$t" $cfg.DatabaseUrl
    if ($LASTEXITCODE -ne 0) { throw "Row count failed for $t" }
    $counts[$t] = [int64](($n | Select-Object -First 1).Trim())
  }
  $status.counts = $counts
  Write-Log ("Row counts: " + (($counts.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', '))

  if ($previous) {
    $prevManifestPath = Join-Path $previous.FullName 'manifest.json'
    if (Test-Path -LiteralPath $prevManifestPath) {
      $prev = Get-Content -LiteralPath $prevManifestPath -Raw | ConvertFrom-Json
      if ($prev.dbBytes -and $dumpBytes -lt 0.5 * [int64]$prev.dbBytes) {
        throw ("The dump is {0:N0} bytes, under half of last night's {1:N0}: not trusted" -f $dumpBytes, [int64]$prev.dbBytes)
      }
      foreach ($t in $keyTables) {
        $was = $prev.counts.$t
        if ($was -ne $null -and [int64]$was -gt 0) {
          $now = [int64]$counts[$t]
          if ($now -eq 0) { throw "$t has 0 rows tonight but had $was last night: not trusted" }
          if ($now -lt 0.9 * [int64]$was) { throw "$t has $now rows tonight, under 90 % of last night's ${was}: not trusted" }
        }
      }
      Write-Log "Compared with $($previous.Name): size and row counts are sound"
    }
  }

  # ------------------------------------------------------------ 3. storage files
  $headers = @{ Authorization = "Bearer $($cfg.SupabaseServiceKey)"; apikey = $cfg.SupabaseServiceKey }
  $base = ([string]$cfg.SupabaseUrl).TrimEnd('/')
  $objects = 0; $reused = 0
  function Get-BucketObjects([string]$bucket, [string]$prefix) {
    $out = @(); $offset = 0
    while ($true) {
      $body = @{ prefix = $prefix; limit = 1000; offset = $offset; sortBy = @{ column = 'name'; order = 'asc' } } | ConvertTo-Json -Compress
      $page = Invoke-RestMethod -Method Post -Uri "$base/storage/v1/object/list/$bucket" -Headers $headers -ContentType 'application/json' -Body $body
      foreach ($e in @($page)) {
        $name = if ($prefix) { "$prefix/$($e.name)" } else { $e.name }
        if ($e.id -eq $null) { $out += Get-BucketObjects $bucket $name }   # a folder
        else { $out += [pscustomobject]@{ path = $name; size = [int64]($e.metadata.size); updated = $e.updated_at } }
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
      $dest = Assert-UnderRoot (Join-Path $incoming (Join-Path 'storage' (Join-Path $bucket ($o.path -replace '/', '\'))))
      $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest)
      $prevFile = if ($previous) { Join-Path $previous.FullName (Join-Path 'storage' (Join-Path $bucket ($o.path -replace '/', '\'))) } else { $null }
      if ($prevFile -and (Test-Path -LiteralPath $prevFile) -and ((Get-Item -LiteralPath $prevFile).Length -eq $o.size)) {
        Copy-Item -LiteralPath $prevFile -Destination $dest
        $reused++
      } else {
        $enc = ($o.path -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
        Invoke-WebRequest -Uri "$base/storage/v1/object/$bucket/$enc" -Headers $headers -OutFile $dest
        if ((Get-Item -LiteralPath $dest).Length -ne $o.size) { throw "Downloaded size differs for $bucket/$($o.path)" }
      }
      $objects++
    }
  }
  $status.objects = $objects; $status.reused = $reused
  Write-Log "Storage: $objects files ($reused reused from last night)"

  # ------------------------------------------------------------ manifest
  $manifest = [ordered]@{ at = $started.ToString('o'); dbBytes = $dumpBytes; tableData = $tableData; counts = $counts; objects = $objects; postgres = 'pg_dump --format=custom --schema=public' }
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

    # ---------------------------------------------------------- 5. the Sunday copy of the dump
    if ($started.DayOfWeek -eq 'Sunday') {
      $weekly = Join-Path $root 'weekly'
      $null = New-Item -ItemType Directory -Force -Path $weekly
      Copy-Item -LiteralPath (Join-Path (Join-Path $root $slotName) 'db.dump') -Destination (Join-Path $weekly "$stamp-db.dump")
      $old = @(Get-ChildItem -LiteralPath $weekly -File -Filter '*-db.dump' | Sort-Object Name -Descending | Select-Object -Skip $weeklyKeep)
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
