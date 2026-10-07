/**
 * GET /api/backup — the office server's nightly backup reads the portal through here with the
 * owner's BACKUP_SECRET (src/lib/backup-export.server.ts, docs/backup/windows-server-setup.md).
 * Read-only; anything but GET is answered 405.
 */
import { createFileRoute } from "@tanstack/react-router";

async function run(request: Request): Promise<Response> {
  const { backupRequest } = await import("@/lib/backup-export.server");
  return backupRequest(request);
}

export const Route = createFileRoute("/api/backup")({
  server: {
    handlers: {
      GET: ({ request }) => run(request),
      POST: ({ request }) => run(request),
    },
  },
});
