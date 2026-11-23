/**
 * The reminder timer calls the site at its own domain (Nov 23, 2026).
 *
 * The owner connected jbkbid.com. From that moment the old address answered every request with
 * a redirect to the new one, and a redirect to another host drops the header that carries the
 * timer's token: the next half-hourly run was refused (401) and no reminder pass ran. The timer
 * must post straight to the address the site lives at.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "supabase/migrations/";

/** The newest definition of maint.reminder_timer(), as the migrations leave it. */
function newestTimer(): { file: string; body: string } {
  const found = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const m = readFileSync(DIR + file, "utf8").match(
        /create or replace function maint\.reminder_timer\(\)[\s\S]*?as \$(\w*)\$([\s\S]*?)\$\1\$;/i,
      );
      return m ? { file, body: m[2]! } : null;
    })
    .filter((x): x is { file: string; body: string } => x !== null);
  return found[found.length - 1]!;
}

describe("the reminder timer's address", () => {
  it("posts to the site's own domain, not to an address that redirects", () => {
    const t = newestTimer();
    expect(t.body).toContain("url := 'https://jbkbid.com/api/cron/reminders',");
    expect(t.body).not.toContain("lovable.app");
  });

  it("still sends its token and waits two minutes, as before", () => {
    const t = newestTimer();
    expect(t.body).toContain("'Authorization', 'Bearer ' || v_token");
    expect(t.body).toContain("timeout_milliseconds := 120000");
  });
});
