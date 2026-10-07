/**
 * The nightly office backup (owner, Oct 7): the script reads from the cloud and writes only
 * inside its own folder on the server. These pins keep the safety rails from eroding.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("scripts/backup/jbk-backup.ps1", () => {
  const src = read("../../scripts/backup/jbk-backup.ps1");
  it("only reads from the portal: pg_dump, SELECT count(*), storage downloads — no writes", () => {
    expect(src).toContain("--format=custom --no-owner --no-privileges --schema=public");
    expect(src).toContain('"select count(*) from public.$t"');
    expect(src).not.toMatch(
      /\b(insert|update|delete|drop|truncate|alter)\s+(into|from|table|role)?\b/i,
    );
    expect(src).not.toMatch(/Invoke-(RestMethod|WebRequest)[^\n]*-Method\s+(Put|Delete|Patch)/i);
    expect(src).not.toMatch(/storage\/v1\/object\/(upload|move|copy)/);
  });
  it("writes only inside the configured root, never a drive root, and deletes only its own entries", () => {
    expect(src).toContain(
      "DestinationRoot must be a folder inside the drive, not the drive itself",
    );
    expect(src).toContain("Refusing to touch a path outside the backup root");
    // Every Remove-Item of a folder or weekly dump goes through the root check.
    expect(src).toContain("function Remove-UnderRoot(");
    const removes = src.match(/Remove-Item -LiteralPath [^\n]*/g) ?? [];
    for (const r of removes)
      expect(r).toMatch(/\$full -Recurse -Force|LAST-BACKUP-FAILED|\$failedMarker/);
    expect(src).toContain("-Filter 'backup-*'");
    expect(src).toContain("-Filter '_failed-*'");
    expect(src).toContain("-Filter '*-db.dump'");
  });
  it("trusts a dump only after the checks, and a failed night leaves both slots alone", () => {
    expect(src).toContain("pg_restore --list failed");
    expect(src).toContain("under half of last night's");
    expect(src).toContain("under 90 % of last night's");
    expect(src).toContain("has 0 rows tonight but had");
    // Rotation happens after the checks and the storage copy, inside the try, never in catch.
    const rotate = src.indexOf("while ($slots.Count -ge 2)");
    const checks = src.indexOf("Compared with $($previous.Name)");
    const catchAt = src.indexOf("\ncatch {");
    expect(checks).toBeGreaterThan(0);
    expect(rotate).toBeGreaterThan(checks);
    expect(catchAt).toBeGreaterThan(rotate);
    expect(src).toContain("Both earlier backups were left untouched.");
  });
  it("the secrets file is git-ignored and the guide exists", () => {
    expect(read("../../.gitignore")).toContain("scripts/backup/jbk-backup.config.json");
    const guide = read("../../docs/backup/windows-server-setup.md");
    expect(guide).toContain("Command Line Tools");
    expect(guide).toContain("-DryRun");
    expect(guide).toContain("never touches J:, Y:");
    const example = JSON.parse(
      read("../../scripts/backup/jbk-backup.config.example.json"),
    ) as Record<string, unknown>;
    expect(example["DestinationRoot"]).toBe("X:\\JBK Portal Backups");
    expect(example["Buckets"]).toEqual(["service", "takeoffs"]);
  });
});
