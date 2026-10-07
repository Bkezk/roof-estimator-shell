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
  it("only reads from the portal: GET pages of every table, a GET per file — no writes", () => {
    expect(src).toContain("select=*&limit=$pageSize&offset=");
    expect(src).toContain("Prefer = 'count=exact'");
    expect(src).not.toMatch(
      /\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b|\bdrop\s+(table|role|schema)\b|\btruncate\b|\balter\s+(table|role)\b/i,
    );
    expect(src).not.toMatch(/Invoke-(RestMethod|WebRequest)[^\n]*-Method\s+(Put|Delete|Patch)/i);
    expect(src).not.toMatch(/storage\/v1\/object\/(upload|move|copy)/);
    // The one POST is the storage listing (that endpoint is a read).
    const posts = src.match(/-Method Post[^\n]*/g) ?? [];
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("storage/v1/object/list/");
  });
  it("writes only inside the configured root, never a drive root, and deletes only its own entries", () => {
    expect(src).toContain(
      "DestinationRoot must be a folder inside the drive, not the drive itself",
    );
    expect(src).toContain("Refusing to touch a path outside the backup root");
    expect(src).toContain("function Remove-UnderRoot(");
    const removes = src.match(/Remove-Item -LiteralPath [^\n]*/g) ?? [];
    for (const r of removes) expect(r).toMatch(/\$full -Recurse -Force|\$failedMarker/);
    expect(src).toContain("-Filter 'backup-*'");
    expect(src).toContain("-Filter '_failed-*'");
    expect(src).toContain("-Filter '*-db'");
  });
  it("trusts a copy only after the checks, and a failed night leaves both slots alone", () => {
    expect(src).toContain("came down with $got rows but the API holds $expected");
    expect(src).toContain("under half of last night's");
    expect(src).toContain("under 90 % of last night's");
    expect(src).toContain("has 0 rows tonight but had");
    const rotate = src.indexOf("while ($slots.Count -ge 2)");
    const checks = src.indexOf("Compared with $($previous.Name)");
    const catchAt = src.indexOf("\ncatch {");
    expect(checks).toBeGreaterThan(0);
    expect(rotate).toBeGreaterThan(checks);
    expect(catchAt).toBeGreaterThan(rotate);
    expect(src).toContain("Both earlier backups were left untouched.");
  });
  it("needs nothing installed, the secrets file is git-ignored, and the guide and config agree", () => {
    expect(src).not.toMatch(/pg_dump|pg_restore|psql/);
    expect(read("../../.gitignore")).toContain("scripts/backup/jbk-backup.config.json");
    const guide = read("../../docs/backup/windows-server-setup.md");
    expect(guide).toContain("-DryRun");
    expect(guide).toContain("never touches J:, Y:");
    expect(guide).toContain("Run task as soon as possible after a scheduled start is missed");
    expect(guide).not.toContain("Command Line Tools");
    const example = JSON.parse(read("../../scripts/backup/jbk-backup.config.example.json")) as {
      DestinationRoot: string;
      Buckets: string[];
      Tables: string[];
      SkipTables: string[];
      KeyTables: string[];
    };
    expect(example.DestinationRoot).toBe("X:\\JBK Portal Backups");
    expect(example.Buckets).toEqual(["service", "takeoffs"]);
    expect(example.Tables.length).toBeGreaterThan(80);
    for (const t of example.KeyTables) expect(example.Tables).toContain(t);
    for (const t of example.SkipTables) expect(example.Tables).toContain(t);
    expect(example.Tables).toContain("app_secrets");
  });
});
