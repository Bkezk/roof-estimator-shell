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
  type UserProfile,
} from "@/lib/auth.functions";
import { PAGES, PAGE_HELP, PAGE_LABELS, type Page, type Role } from "@/lib/access";
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
  head: () => ({ meta: [{ title: "Users & access — Bid-O-Matic" }] }),
  component: UsersPage,
});

/** Admin checkbox + one checkbox per page; admin implies every page (shown ticked, disabled). */
function AccessPicker(props: {
  role: Role;
  access: Page[];
  disabled?: boolean;
  compact?: boolean;
  onChange: (role: Role, access: Page[]) => void;
}) {
  const isAdmin = props.role === "admin";
  return (
    <div className={props.compact ? "flex flex-wrap gap-x-4 gap-y-1" : "flex flex-col gap-1.5"}>
      <label className="flex items-center gap-1.5 text-sm" title="Everything, plus Users & access">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={isAdmin}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.checked ? "admin" : "user", props.access)}
        />
        <span className="font-medium">Admin</span>
      </label>
      {PAGES.map((p) => (
        <label
          key={p}
          className={`flex items-center gap-1.5 text-sm ${isAdmin ? "text-muted-foreground" : ""}`}
          title={PAGE_HELP[p]}
        >
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={isAdmin || props.access.includes(p)}
            disabled={props.disabled || isAdmin}
            onChange={(e) =>
              props.onChange(
                "user",
                e.target.checked
                  ? [...props.access.filter((x) => x !== p), p]
                  : props.access.filter((x) => x !== p),
              )
            }
          />
          {PAGE_LABELS[p]}
        </label>
      ))}
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

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => listUsersFn(),
  });

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [access, setAccess] = useState<Page[]>(["estimate"]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const createMut = useMutation({
    mutationFn: (input: {
      email: string;
      password: string;
      full_name?: string;
      role: Role;
      access: Page[];
    }) => createUserFn({ data: input }),
    onSuccess: () => {
      toast.success("User created");
      setEmail("");
      setFullName("");
      setPassword("");
      setRole("user");
      setAccess(["estimate"]);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not create user"),
  });

  const accessMut = useMutation({
    mutationFn: (input: { id: string; role: Role; access: Page[] }) =>
      updateAccessFn({ data: input }),
    onSuccess: (_r, input) => {
      toast.success("Access updated");
      invalidate();
      if (input.id === me?.id) void refreshProfile();
    },
    onError: (e: Error) => toast.error(e.message || "Could not update access"),
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
    if (role !== "admin" && access.length === 0) {
      toast.error("Tick at least one page, or make the user an admin");
      return;
    }
    const trimmedName = fullName.trim();
    createMut.mutate({
      email: email.trim(),
      password,
      role,
      access,
      ...(trimmedName ? { full_name: trimmedName } : {}),
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Users &amp; access</h1>
        <p className="text-sm text-muted-foreground">
          Who can sign in and which pages each person may open. Admins reach everything and manage
          this page. Anyone with Estimate access is listed as an estimator on a bid&apos;s Setup
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
                onChange={(r, a) => {
                  setRole(r);
                  setAccess(a);
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
                          disabled={accessMut.isPending}
                          onChange={(r, a) => accessMut.mutate({ id: u.id, role: r, access: a })}
                        />
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
