/**
 * POST /api/restore — the office server's restore script puts a nightly backup back through
 * here with the owner's RESTORE_SECRET (src/lib/restore-door.server.ts,
 * scripts/backup/jbk-restore.ps1, docs/backup/windows-server-setup.md Step 8). POST only:
 * anything else is answered 405.
 */
import { createFileRoute } from "@tanstack/react-router";

async function run(request: Request): Promise<Response> {
  const { restoreRequest } = await import("@/lib/restore-door.server");
  return restoreRequest(request);
}

export const Route = createFileRoute("/api/restore")({
  server: {
    handlers: {
      GET: ({ request }) => run(request),
      POST: ({ request }) => run(request),
    },
  },
});
