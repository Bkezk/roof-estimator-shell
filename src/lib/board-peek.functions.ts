/**
 * The Tech Board's details pop-up on a phone (owner, Nov 17; lib/board-phone.ts): what the card on
 * the board does not carry. The board's own read is slim on purpose (LIST_JOB_COLUMNS), so a tap
 * on a ticket reads the rest here: its Special instructions, and who to call (the property
 * contact, and the customer's own number behind it).
 *
 * Access: Service or Customers, as the ticket itself; the rows are read with the caller's own
 * sign-in, so the database's rules decide what comes back. A contact or customer the caller may
 * not read comes back empty, never as an error: the pop-up still opens.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import { canAccess } from "@/lib/access";
import { readProfile } from "@/lib/profile-cache.server";
import { withInstructions } from "@/lib/ticket-instructions";

export interface BoardPeek {
  /** The ticket's Special instructions. */
  notes: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  account_phone: string | null;
}

export const getBoardPeek = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<BoardPeek> => {
    const sb = context.supabase;
    const p = await readProfile(sb, context.userId);
    if (!p || !(canAccess(p, "service") || canAccess(p, "customers")))
      throw new Error("Forbidden: Service access required");
    const { data: row, error } = await sb
      .from("service_jobs")
      .select("id, notes, notes_tech_visible, contact_id, account_id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Ticket not found");
    // Instructions kept from technicians (Nov 18): the office's pop-up still reads them; a
    // technician-only login is given none by the database.
    const { notes } = await withInstructions(sb, p, row);
    const [contact, account] = await Promise.all([
      row.contact_id
        ? sb
            .from("crm_contacts")
            .select("name, mobile, office_phone")
            .eq("id", row.contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      row.account_id
        ? sb.from("crm_accounts").select("phone").eq("id", row.account_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const c = contact.data;
    return {
      notes: (notes ?? "").trim() || null,
      contact_name: c?.name ?? null,
      contact_phone: c?.mobile || c?.office_phone || null,
      account_phone: account.data?.phone ?? null,
    };
  });
