/**
 * The restore script (scripts/backup/jbk-restore.ps1; owner, Oct 13) and its guide: it only ever
 * POSTs to the portal's /api/restore with the restore password, writes nothing on the share but
 * its log and report inside the slot, deletes nothing, refuses to run without -Project, and the
 * config / guide / door agree on RESTORE_SECRET. PowerShell cannot run here, so these are pins
 * on the text, including the 5.1 pitfalls (no ternaries, no ??, bodies sent as UTF-8 bytes).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("scripts/backup/jbk-restore.ps1", () => {
  const src = read("../../scripts/backup/jbk-restore.ps1");
  /** The script without its comments (the header explains the backup door; the code never calls it). */
  const code = src.replace(/<#[\s\S]*?#>/g, "").replace(/^\s*#[^\n]*$/gm, "");
  it("talks only to /api/restore with RestoreSecret, every op by POST, never the data API or the master key", () => {
    expect(src).toContain("'/api/restore'");
    expect(src).toContain('Authorization = "Bearer $($cfg.RestoreSecret)"');
    expect(src).not.toMatch(/SupabaseServiceKey|service_role|apikey/i);
    expect(code).not.toMatch(/rest\/v1|storage\/v1|\/api\/backup/);
    expect(src).not.toMatch(/pg_dump|pg_restore|psql/);
    const calls = src.match(/Invoke-(RestMethod|WebRequest)[^\n]*/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) {
      expect(c).toMatch(/-Method Post\b/);
      expect(c).toContain("-Uri $door");
    }
    for (const op of ["identify", "exists", "rows", "files_exist", "finish"])
      expect(src, op).toContain(`"op":"${op}"`);
    for (const op of ["plan", "create_user"]) expect(src, op).toContain(`op = '${op}'`);
    expect(src).toContain("'x-restore-op' = 'file'");
    expect(src).toContain("RestoreSecret must not be the backup password");
    expect(src).toContain("RestoreSecret must be at least 24 characters");
  });
  it("refuses to run without -Project, stops when the portal's label differs, and asks for it typed before -Apply unless -Yes", () => {
    expect(src).toContain("-Project is required");
    expect(src).toContain("if ([string]$id.project -ne $Project) {");
    expect(src).toMatch(/STOP: you named '\$Project' but the portal is[\s\S]*exit 2/);
    expect(src).toContain("if ($isApply -and -not $Yes) {");
    expect(src).toContain('Read-Host "Type the project label exactly to continue"');
    expect(src).toContain(
      "-Apply with -Mode replace overwrites live rows with the backup's: add -ReplaceConfirmed",
    );
    expect(src).toContain("[ValidateSet('skip', 'replace')]");
    expect(src).toContain("[ValidateSet('all', 'db', 'storage')]");
    // The dry run is the default: writing needs -Apply.
    expect(src).toContain("$isApply = [bool]$Apply");
    const identify = src.indexOf('Invoke-Door \'{"op":"identify"}\'');
    const firstWrite = src.indexOf('"op":"rows"');
    expect(identify).toBeGreaterThan(0);
    expect(firstWrite).toBeGreaterThan(identify);
  });
  it("writes only restore.log and the two reports inside the slot, deletes nothing, and refuses a drive root", () => {
    expect(src).toContain("function Assert-UnderRoot(");
    expect(src).toContain("$script:LogFile = Join-Path $slotPath 'restore.log'");
    expect(src).toContain(
      "$reportTxt = Assert-UnderRoot (Join-Path $slotPath 'restore-report.txt')",
    );
    expect(src).toContain(
      "$reportJson = Assert-UnderRoot (Join-Path $slotPath 'restore-report.json')",
    );
    expect(src).not.toMatch(/Remove-Item|Rename-Item|Move-Item|Copy-Item|New-Item/);
    const writes = src.match(/Set-Content[^\n]*/g) ?? [];
    expect(writes.length).toBe(2);
    for (const w of writes) expect(w).toMatch(/\$reportTxt|\$reportJson/);
    expect(src).toContain(
      "DestinationRoot must be a folder inside the drive, not the drive itself",
    );
    expect(src).toContain("-Slot is a folder NAME under the backup root, not a path");
  });
  it("the dry run checks the schema (plan), key clashes (exists), foreign keys, users and storage, and exits non-zero when anything would fail", () => {
    expect(src).toContain("op = 'plan'");
    expect(src).toContain("function Get-Clashes(");
    expect(src).toContain("function Get-MissingFk(");
    expect(src).toContain("in neither the backup nor the live project");
    expect(src).toContain(
      "have no live account: their profiles rows and everything pointing at them will be refused. Add -CreateUsers.",
    );
    expect(src).toContain('"op":"files_exist"');
    expect(src).toContain("$report.ok = ($wouldFail.Count -eq 0)");
    expect(src).toContain("if (-not $report.ok) { $exit = 1 }");
    expect(src).toContain("exit $exit");
  });
  it("the apply follows the portal's order, pages ≤ 1,000 rows, retries twice, carries on past refused rows, second pass on foreign keys, then storage, then finish", () => {
    expect(src).toContain("$restorable = @($plan.order | Where-Object");
    expect(src).toContain('Invoke-Door $body "rows $t $($p.Name)" 2');
    expect(src).toContain("if ($final -or $attempt -gt $retries)");
    expect(src).toContain("[string]$e.code -eq '23503'");
    expect(src).toContain("second pass for rows refused on a foreign key");
    const tables = src.indexOf("# 4b. the tables");
    const storage = src.indexOf("# 4c. the storage files");
    const finish = src.indexOf("# 4d. finish");
    expect(tables).toBeGreaterThan(0);
    expect(storage).toBeGreaterThan(tables);
    expect(finish).toBeGreaterThan(storage);
    expect(src).toContain('\'{"op":"finish","project":\' + $projectJson + \'}\'');
    expect(src).toContain(
      "Result (backup rows / live rows now / inserted / replaced / skipped / refused):",
    );
    // The pages go up as they are on disk (no re-serialising, which would mangle dates in 5.1).
    expect(src).toContain(",\"rows\":' + $content + '}'");
    expect(src).toContain("$utf8.GetBytes($json)");
  });
  it("users: created without a password, the one first-admin password typed as a secure string and never logged; the id map rides along on rows", () => {
    expect(src).toContain("op = 'create_user'");
    expect(src).toContain("-AsSecureString");
    expect(src).toContain("if ($isFirst -and $firstPassword) { $req.password = $firstPassword }");
    expect(src).toContain("$firstPassword = $null");
    expect(src).toContain("'created — initial password set by the operator'");
    expect(src).toContain("'created — set their password under Admin › Users & access'");
    expect(src).toContain("[int]$id.live_admins -eq 0");
    expect(src).toContain('"id_map":\' + $idMapJson');
    // The log never gets a request body (which may hold rows or, once, a password).
    expect(src).toMatch(/function Invoke-Door\(\[string\]\$json, \[string\]\$label/);
    expect(src).not.toMatch(/Write-Log[^\n]*\$json/);
    expect(src).not.toMatch(/Write-Log[^\n]*\$req\b/);
    expect(src).not.toMatch(/Write-Log[^\n]*\$(firstPassword|p1|p2|s1|s2|req|json|body)\b/);
  });
  it("is PowerShell 5.1: no ternaries, no ??, no `$var:` inside strings, every -f without braces in its arguments", () => {
    expect(src).not.toMatch(/\?\?/);
    expect(src).not.toMatch(/\$\([^)]*\?[^)]*:[^)]*\)/);
    expect(src).not.toMatch(/"[^"\n]*\$[A-Za-z_]+:[^"\n]*"/);
    expect(src).not.toMatch(/\[string\]\$\w+\s*\?\s/);
    // ConvertTo-Json via -InputObject (a piped single element loses its array in 5.1); the one
    // pipe is the report hashtable.
    expect(src.match(/\|\s*ConvertTo-Json[^\n]*/g)).toEqual([
      "| ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportJson -Encoding UTF8",
    ]);
  });
  it("the config example, the guide and the backup pins agree", () => {
    const example = JSON.parse(
      read("../../scripts/backup/jbk-backup.config.example.json"),
    ) as Record<string, unknown>;
    expect(String(example["RestoreSecret"])).toContain("PASTE");
    expect(example["RestoreSecret"]).not.toBe(example["BackupSecret"]);
    expect(read("../../.gitignore")).toContain("scripts/backup/jbk-backup.config.json");
    const guide = read("../../docs/backup/windows-server-setup.md");
    for (const s of [
      "## Step 8 — Restoring",
      "RESTORE_SECRET",
      '"RestoreSecret"',
      "jbk-restore.ps1",
      "-Apply",
      "-CreateUsers",
      "-ReplaceConfirmed",
      "Secrets are not in the backup",
      "Passwords are in no",
      "Set password",
      "quarterly test restore",
      "already live",
      "WOULD FAIL",
      "20261013100000_restore_door.sql",
      "Which restored admin signs in first".replace("Which", "which"),
    ])
      expect(guide, s).toContain(s);
    expect(guide).not.toContain("is a conversation with\nClaude");
  });
});
