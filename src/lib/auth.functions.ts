import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { PAGES, PAGE_LABELS, canAccess, normalizeAccess, type Page, type Role } from "@/lib/access";

export type { Role } from "@/lib/access";
/** admin: everything + user management; user: the pages in `access` (src/lib/access.ts). */
export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  access: Page[];
  created_at?: string;
}
const PROFILE_COLS = "id, email, full_name, role, access, created_at";
const toProfile = (row: {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  access: unknown;
  created_at?: string;
}): UserProfile => ({
  ...row,
  role: row.role === "admin" ? "admin" : "user",
  access: normalizeAccess(row.access),
});

/** Admin or a user granted the page — the server-side twin of RLS `has_access(page)`. */
export async function assertPageAccess(
  supabase: SupabaseClient<Database>,
  userId: string,
  page: Page,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("role, access")
    .eq("id", userId)
    .single();
  if (error || !data || !canAccess(data, page))
    throw new Error(`Forbidden: ${PAGE_LABELS[page]} access required`);
}

// supabaseAdmin bypasses RLS and requires SUPABASE_SERVICE_ROLE_KEY; it is only
// needed for the auth.admin API (createUser/deleteUser). Everything else runs
// under RLS through the caller's own client so it works without the key.
// Must never be imported at module top-level in a file that ships to the
// client bundle — load it inside the handler.
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// RLS lets every user read their own profiles row, so the caller's client is
// enough to verify the admin role.
async function assertAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data, error } = await supabase.from("profiles").select("role").eq("id", userId).single();
  if (error || !data || data.role !== "admin") {
    throw new Error("Forbidden: admin access required");
  }
}

// The signed-in user's own profile (id/email/role). Keyed strictly by the
// verified token subject, so a user can only ever read themselves here.
export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UserProfile | null> => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select(PROFILE_COLS)
      .eq("id", context.userId)
      .maybeSingle();
    // A missing row is a state, not a server error: returning null (instead of throwing a 500)
    // lets the client degrade to no-role and retry — right after login the first read can race
    // token propagation (seen on mobile) and momentarily see zero rows under RLS.
    if (error) throw new Error(error.message);
    return data ? toProfile(data) : null;
  });

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UserProfile[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("profiles")
      .select(PROFILE_COLS)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(toProfile);
  });

// The estimator roster for the Estimate → Setup "Estimator's Name" dropdown: every account with
// Estimate access (admins included). Any signed-in user may read it; only display names leave.
// `estimator_names()` is SECURITY DEFINER in the database (profiles RLS hides other users' rows
// from non-admins), so no service-role key is needed here.
export const listEstimatorNames = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<string[]> => {
    const { data, error } = await context.supabase.rpc("estimator_names");
    if (error) throw new Error(error.message);
    const names = new Set<string>();
    for (const name of data ?? []) if (name && name.trim()) names.add(name.trim());
    return [...names].sort((a, b) => a.localeCompare(b));
  });

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  full_name: z.string().trim().max(200).optional(),
  role: z.enum(["admin", "user"]),
  access: z.array(z.enum(PAGES)).default([]),
});

// Admin-only account creation. There is no public sign-up anywhere in the app;
// this is the only path that mints a user.
export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => createUserSchema.parse(data))
  .handler(async ({ data, context }): Promise<UserProfile> => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await admin();

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name ?? null },
    });
    if (createErr || !created?.user) {
      throw new Error(createErr?.message ?? "Could not create user");
    }

    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .insert({
        id: created.user.id,
        email: data.email,
        full_name: data.full_name ?? null,
        role: data.role,
        access: data.role === "admin" ? [] : data.access,
      })
      .select(PROFILE_COLS)
      .single();

    if (profErr || !profile) {
      // Roll back the auth user so we never leave an account with no profile.
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw new Error(profErr?.message ?? "Could not create profile");
    }
    return toProfile(profile);
  });

const updateAccessSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["admin", "user"]),
  access: z.array(z.enum(PAGES)).default([]),
});

/** Set a user's role (admin / user) and, for a user, the pages they may open. */
export const updateUserAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => updateAccessSchema.parse(data))
  .handler(async ({ data, context }): Promise<UserProfile> => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;

    // Never allow demoting the last remaining admin.
    if (data.role !== "admin") {
      const { count } = await sb
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      const { data: target } = await sb.from("profiles").select("role").eq("id", data.id).single();
      if ((count ?? 0) <= 1 && target?.role === "admin") {
        throw new Error("Cannot remove the last admin");
      }
    }

    const { data: profile, error } = await sb
      .from("profiles")
      .update({ role: data.role, access: data.role === "admin" ? [] : data.access })
      .eq("id", data.id)
      .select(PROFILE_COLS)
      .single();
    if (error || !profile) throw new Error(error?.message ?? "Update failed");
    return toProfile(profile);
  });

const deleteUserSchema = z.object({ id: z.string().uuid() });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => deleteUserSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertAdmin(context.supabase, context.userId);
    if (data.id === context.userId) {
      throw new Error("You cannot delete your own account");
    }
    const { data: target } = await context.supabase
      .from("profiles")
      .select("role")
      .eq("id", data.id)
      .single();
    if (target?.role === "admin") {
      const { count } = await context.supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1) throw new Error("Cannot delete the last admin");
    }
    // FK cascade removes the profile row.
    const supabaseAdmin = await admin();
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.id);
    if (error) throw new Error(error.message);
    return { id: data.id };
  });
