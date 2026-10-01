import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";

import {
  listUsers,
  createUser,
  updateUserAccess,
  deleteUser,
  setDefaultBillRate,
  type UserProfile,
} from "@/lib/auth.functions";
import { RateBox } from "@/components/service/rate-box";
import {
  GRANTABLE_PAGES,
  PAGE_HELP,
  PAGE_LABELS,
  ROLES,
  ROLE_HELP,
  ROLE_LABELS,
  canAccess,
  type Page,
  type Role,
} from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "Users & access — JBK Portal" }] }),
  component: UsersPage,
});

const BILL_RATE_HELP =
  "What this technician bills per labor hour on a ticket's crew when the ticket's own $ box is blank. Blank here: the rate table (Admin › Service rates; tech rate as the lead, helper rate otherwise).";

const TECHNICIAN_HELP =
  "Appears on the service board, can be assigned tickets and vehicles; edits only their own tickets";

/**
 * Role picker (User / Manager / Admin) + one checkbox per page; admin and manager imply their
 * pages (shown ticked, disabled: a manager every page but Estimate Pricing). Technician is a
 * separate flag beside the pages (it is not a page; an admin or a manager can be one too).
 */
function AccessPicker(props: {
  role: Role;
  access: Page[];
  technician: boolean;
  disabled?: boolean;
  compact?: boolean;
  onChange: (role: Role, access: Page[], technician: boolean) => void;
}) {
  // Admins and managers get their pages from the role; the boxes only mirror it.
  const byRole = props.role !== "user";
  return (
    <div className={props.compact ? "flex flex-wrap gap-x-4 gap-y-1" : "flex flex-col gap-1.5"}>
      <label className="flex items-center gap-1.5 text-sm" title={ROLE_HELP[props.role]}>
        <span className="font-medium">Role</span>
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          aria-label="Role"
          value={props.role}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value as Role, props.access, props.technician)}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      {!props.compact && <p className="text-xs text-muted-foreground">{ROLE_HELP[props.role]}</p>}
      {GRANTABLE_PAGES.map((p) => (
        <label
          key={p}
          className={`flex items-center gap-1.5 text-sm ${byRole ? "text-muted-foreground" : ""}`}
          title={PAGE_HELP[p]}
        >
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={byRole ? canAccess({ role: props.role }, p) : props.access.includes(p)}
            disabled={props.disabled || byRole}
            onChange={(e) =>
              props.onChange(
                "user",
                e.target.checked
                  ? [...props.access.filter((x) => x !== p), p]
                  : props.access.filter((x) => x !== p),
                props.technician,
              )
            }
          />
          {PAGE_LABELS[p]}
        </label>
      ))}
      <label className="flex items-center gap-1.5 text-sm" title={TECHNICIAN_HELP}>
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={props.technician}
          disabled={props.disabled}
          onChange={(e) => props.onChange(props.role, props.access, e.target.checked)}
        />
        <span className="font-medium">Technician</span>
      </label>
      {!props.compact && <p className="text-xs text-muted-foreground">{TECHNICIAN_HELP}</p>}
    </div>
  );
}

function UsersPage() {
  const queryClient = useQueryClient();
  const { profile: me, refreshProfile } = useAuth();
  const listUsersFn = useServerFn(listUsers);
  const createUserFn = useServerFn(createUser);
  const updateAccessFn = useServerFn(updateUserAccess);
  const deleteUserFn = useServerFn(deleteUser);
  const rateFn = useServerFn(setDefaultBillRate);

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => listUsersFn(),
  });

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [access, setAccess] = useState<Page[]>(["estimate"]);
  const [technician, setTechnician] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const createMut = useMutation({
    mutationFn: (input: {
      email: string;
      password: string;
      full_name?: string;
      role: Role;
      access: Page[];
      technician: boolean;
    }) => createUserFn({ data: input }),
    onSuccess: () => {
      toast.success("User created");
      setEmail("");
      setFullName("");
      setPassword("");
      setRole("user");
      setAccess(["estimate"]);
      setTechnician(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not create user"),
  });

  const accessMut = useMutation({
    mutationFn: (input: { id: string; role: Role; access: Page[]; technician: boolean }) =>
      updateAccessFn({ data: input }),
    onSuccess: (_r, input) => {
      toast.success("Access updated");
      invalidate();
      if (input.id === me?.id) void refreshProfile();
    },
    onError: (e: Error) => toast.error(e.message || "Could not update access"),
  });

  const rateMut = useMutation({
    mutationFn: (input: { id: string; default_bill_rate: number | null }) =>
      rateFn({ data: input }),
    onSuccess: (r) => {
      toast.success(
        r.default_bill_rate == null
          ? "Default bill rate cleared (the rate table applies)"
          : `Default bill rate set to $${r.default_bill_rate.toFixed(2)}/hr`,
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not set the bill rate"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteUserFn({ data: { id } }),
    onSuccess: () => {
      toast.success("User removed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not remove user"),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (role === "user" && access.length === 0) {
      toast.error("Tick at least one page, or make the user a manager or an admin");
      return;
    }
    const trimmedName = fullName.trim();
    createMut.mutate({
      email: email.trim(),
      password,
      role,
      access,
      technician,
      ...(trimmedName ? { full_name: trimmedName } : {}),
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Users &amp; access</h1>
        <p className="text-sm text-muted-foreground">
          Who can sign in and which pages each person may open. Admins reach everything and manage
          this page. Managers see everyone&apos;s tickets, tasks and customers but not the admin or
          pricing pages. Anyone with Estimate access is listed as an estimator on a bid&apos;s Setup
          step; Inventory-only logins record leftovers but not adjustments.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> Add a user
          </CardTitle>
          <CardDescription>
            The person can sign in immediately with the password you set. Ask them to change it
            after their first sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-2 lg:col-span-1">
              <Label htmlFor="full_name">Name</Label>
              <Input
                id="full_name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2 lg:col-span-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2 lg:col-span-1">
              <Label htmlFor="password">Temporary password</Label>
              <Input
                id="password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2 lg:col-span-1">
              <Label>Access</Label>
              <AccessPicker
                role={role}
                access={access}
                technician={technician}
                onChange={(r, a, t) => {
                  setRole(r);
                  setAccess(a);
                  setTechnician(t);
                }}
              />
            </div>
            <div className="flex items-end lg:col-span-1">
              <Button type="submit" className="w-full" disabled={createMut.isPending}>
                {createMut.isPending ? "Adding…" : "Add user"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All users</CardTitle>
          <CardDescription>
            Tick the pages a person may open; changes apply the next time their app loads a page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead title={BILL_RATE_HELP}>Default bill rate</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users ?? []).map((u: UserProfile) => {
                  const isSelf = u.id === me?.id;
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.full_name || "—"}
                        {isSelf && (
                          <Badge variant="secondary" className="ml-2">
                            You
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell>
                        <AccessPicker
                          compact
                          role={u.role}
                          access={u.access}
                          technician={u.technician}
                          disabled={accessMut.isPending}
                          onChange={(r, a, t) =>
                            accessMut.mutate({ id: u.id, role: r, access: a, technician: t })
                          }
                        />
                      </TableCell>
                      <TableCell className="w-32 align-top">
                        {u.technician ? (
                          <RateBox
                            aria-label={`Default bill rate for ${u.full_name || u.email}, dollars per hour`}
                            title={BILL_RATE_HELP}
                            placeholder="rate table"
                            className="h-8"
                            value={u.default_bill_rate ?? null}
                            disabled={rateMut.isPending}
                            onCommit={(v) => rateMut.mutate({ id: u.id, default_bill_rate: v })}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">technicians only</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isSelf || deleteMut.isPending}
                          onClick={() => {
                            if (confirm(`Remove ${u.email}? This cannot be undone.`)) {
                              deleteMut.mutate(u.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
