import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, KeyRound, Trash2, UserPlus } from "lucide-react";

import {
  listUsers,
  createUser,
  updateUserAccess,
  deleteUser,
  setDefaultBillRate,
  setUserPassword,
  type UserProfile,
} from "@/lib/auth.functions";
import { RateBox } from "@/components/service/rate-box";
import {
  KIND_HELP,
  KIND_LABELS,
  kindOf,
  shapeForKind,
  USER_KINDS,
  type UserKind,
  PAGE_HELP,
  PAGE_LABELS,
  ROLES,
  ROLE_HELP,
  ROLE_LABELS,
  canAccess,
  type Page,
  type Role,
} from "@/lib/access";
import { TECH_NEEDS_SERVICE, technicianNeedsService, withService } from "@/lib/dispatch-access";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "Users & access — JBK Portal" }] }),
  component: UsersPage,
});

const BILL_RATE_HELP =
  "What this technician bills per labor hour on a ticket's crew when the ticket's own $ box is blank. Blank here: the rate table (Admin › Service rates; tech rate as the lead, helper rate otherwise).";

const TECHNICIAN_HELP =
  "Appears on the service board, can be assigned tickets and vehicles; edits only their own tickets";

/**
 * One picker for the four kinds of people (access.ts USER_KINDS; owner, Oct 8) plus, for an
 * owner, a manager or office, the Technician tick (on the board, assignable). A row saved under
 * the old per-page ticks that matches no kind reads "Custom" until one is picked.
 */
function KindPicker(props: {
  role: Role;
  access: Page[];
  technician: boolean;
  disabled?: boolean;
  compact?: boolean;
  onChange: (role: Role, access: Page[], technician: boolean) => void;
}) {
  const kind = kindOf(props);
  const pick = (k: UserKind, technician: boolean) => {
    const shape = shapeForKind(k, technician);
    props.onChange(shape.role, shape.access, shape.technician);
  };
  return (
    <div
      className={
        props.compact ? "flex flex-wrap items-center gap-x-4 gap-y-1" : "flex flex-col gap-1.5"
      }
    >
      <label className="flex items-center gap-1.5 text-sm">
        <span className="font-medium">Kind</span>
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          aria-label="Kind of user"
          value={kind}
          disabled={props.disabled}
          title={
            kind === "custom"
              ? "Pages ticked by hand before Oct 8 — pick a kind to tidy it"
              : KIND_HELP[kind]
          }
          onChange={(e) => pick(e.target.value as UserKind, props.technician)}
        >
          {kind === "custom" && (
            <option value="custom" disabled>
              Custom
            </option>
          )}
          {USER_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      {!props.compact && (
        <p className="text-xs text-muted-foreground">
          {kind === "custom" ? "Pages ticked by hand — pick a kind." : KIND_HELP[kind]}
        </p>
      )}
      {kind !== "technician" && (
        <label className="flex items-center gap-1.5 text-sm" title={TECHNICIAN_HELP}>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={props.technician}
            disabled={props.disabled || kind === "custom"}
            onChange={(e) => (kind === "custom" ? undefined : pick(kind, e.target.checked))}
          />
          <span className="font-medium">Also a technician</span>
        </label>
      )}
      {!props.compact && kind !== "technician" && (
        <p className="text-xs text-muted-foreground">{TECHNICIAN_HELP}</p>
      )}
    </div>
  );
}

/**
 * "Set password" (owner, Oct 13): the sign-in page has no "Forgot password" and only the user's
 * own Account page changes a password, so an admin sets one here — for a restored account
 * (passwords are in no backup; docs/backup/windows-server-setup.md Step 8) or anyone locked out.
 * Password + confirm, at least 8 characters; the person may change it on their Account page.
 */
function SetPasswordDialog(props: {
  user: UserProfile | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (id: string, password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const name = props.user ? props.user.full_name || props.user.email : "";
  const problem =
    password.length < 8
      ? "At least 8 characters"
      : password !== confirm
        ? "The two passwords differ"
        : null;
  const close = () => {
    setPassword("");
    setConfirm("");
    props.onClose();
  };
  return (
    <Dialog open={!!props.user} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set password for {name}</DialogTitle>
          <DialogDescription>
            They sign in with this password straight away and can change it on their Account page.
            Tell them in person or by phone, not by email.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (problem || !props.user) return;
            props.onSubmit(props.user.id, password);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="set-password">New password</Label>
            <Input
              id="set-password"
              type="text"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="set-password-confirm">Type it again</Label>
            <Input
              id="set-password-confirm"
              type="text"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {password && problem && <p className="text-xs text-muted-foreground">{problem}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={props.pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!!problem || props.pending}>
              {props.pending ? "Setting…" : "Set password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const passwordFn = useServerFn(setUserPassword);
  const [passwordFor, setPasswordFor] = useState<UserProfile | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => listUsersFn(),
  });

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  // A new user starts as a technician (owner, Oct 8: the four kinds; most new logins are crew).
  const [role, setRole] = useState<Role>(shapeForKind("technician", true).role);
  const [access, setAccess] = useState<Page[]>(shapeForKind("technician", true).access);
  const [technician, setTechnician] = useState(true);

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
      setRole(shapeForKind("technician", true).role);
      setAccess(shapeForKind("technician", true).access);
      setTechnician(true);
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

  const passwordMut = useMutation({
    mutationFn: (input: { id: string; password: string }) => passwordFn({ data: input }),
    onSuccess: (_r, input) => {
      const u = (users ?? []).find((x) => x.id === input.id);
      toast.success(`Password set for ${u ? u.full_name || u.email : "the user"}`);
      setPasswordFor(null);
    },
    onError: (e: Error) => toast.error(e.message || "Could not set the password"),
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
      toast.error("Pick a kind of user");
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
          Who can sign in and what kind of person they are. Owner: everything, including this page.
          Manager: everything but Users and Reminders; runs the tickets and their money. Office:
          every page, sees every ticket. Technician: Inventory and their own tickets, no prices.
          Owners, managers and office people can also be ticked as technicians (on the board,
          assignable). Anyone with Project Bids is listed as an estimator on a bid&apos;s Setup
          step.
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
              <KindPicker
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
            Pick each person&apos;s kind; changes apply the next time their app loads a page.
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
                        <KindPicker
                          compact
                          role={u.role}
                          access={u.access}
                          technician={u.technician}
                          disabled={accessMut.isPending}
                          onChange={(r, a, t) =>
                            accessMut.mutate({ id: u.id, role: r, access: a, technician: t })
                          }
                        />
                        {technicianNeedsService(u) && (
                          // Owner, Oct 6: a technician without Service access is left off the
                          // dispatch picker and sees no ticket (dispatch-access.ts); say so here.
                          <div
                            role="alert"
                            className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
                          >
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span>{TECH_NEEDS_SERVICE}</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              disabled={accessMut.isPending}
                              onClick={() =>
                                accessMut.mutate({
                                  id: u.id,
                                  role: u.role,
                                  access: withService(u.access),
                                  technician: u.technician,
                                })
                              }
                            >
                              Give Service access
                            </Button>
                          </div>
                        )}
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
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          title={`Set a password for ${u.full_name || u.email}`}
                          aria-label={`Set password for ${u.full_name || u.email}`}
                          disabled={passwordMut.isPending}
                          onClick={() => setPasswordFor(u)}
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
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
      <SetPasswordDialog
        user={passwordFor}
        pending={passwordMut.isPending}
        onClose={() => setPasswordFor(null)}
        onSubmit={(id, password) => passwordMut.mutate({ id, password })}
      />
    </div>
  );
}
