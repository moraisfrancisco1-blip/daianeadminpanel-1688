import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { authClient, useSession } from "../lib/auth-client";
import { Plus, X, Loader2, ShieldBan, ShieldCheck, Trash2 } from "lucide-react";

type TeamUser = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  banned: boolean | null;
};

export default function TeamPage() {
  return (
    <Protected adminOnly>
      <TeamContent />
    </Protected>
  );
}

function TeamContent() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const myId = session?.user?.id;
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  const usersQ = useQuery({
    queryKey: ["team-users"],
    queryFn: async (): Promise<{ users: TeamUser[] }> => {
      const { data, error } = await authClient.admin.listUsers({ query: { limit: 100, sortBy: "createdAt", sortDirection: "asc" } });
      if (error) throw new Error(error.message ?? "Failed to load users.");
      return data as { users: TeamUser[] };
    },
  });

  const setRole = useMutation({
    // "staff" isn't in better-auth's default role type (see auth.ts) —
    // this app's own requireAdmin middleware and better-auth's adminRoles
    // check both work on the raw string regardless of that type restriction.
    mutationFn: async ({ userId, role }: { userId: string; role: "admin" | "staff" }) => {
      const { error } = await authClient.admin.setRole({ userId, role: role as "admin" });
      if (error) throw new Error(error.message ?? "Failed to update role.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-users"] });
      notify("Role updated.");
    },
    onError: (e: any) => notify(e?.message ?? "Failed to update role."),
  });

  const toggleBan = useMutation({
    mutationFn: async ({ userId, ban }: { userId: string; ban: boolean }) => {
      const { error } = ban
        ? await authClient.admin.banUser({ userId, banReason: "Access revoked" })
        : await authClient.admin.unbanUser({ userId });
      if (error) throw new Error(error.message ?? "Failed to update access.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-users"] });
      notify("Access updated.");
    },
    onError: (e: any) => notify(e?.message ?? "Failed to update access."),
  });

  const removeUser = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await authClient.admin.removeUser({ userId });
      if (error) throw new Error(error.message ?? "Failed to remove user.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-users"] });
      notify("User removed.");
    },
    onError: (e: any) => notify(e?.message ?? "Failed to remove user."),
  });

  const users = usersQ.data?.users ?? [];

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-md text-sm font-medium bg-[#4C7A56] text-white">{toast}</div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-brand-teal">Team</h1>
          <p className="text-muted-foreground mt-1">Who has access, and what they can see</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90"
        >
          <Plus className="size-4" /> Add team member
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Admin</strong> sees everything, including invoices, reports and settings.{" "}
        <strong className="text-foreground">Staff</strong> can manage clients, the calendar, bookings, packages and
        messages, but not money or settings.
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {usersQ.isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center">
                    <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isMe = u.id === myId;
                  const role = u.role ?? "admin";
                  return (
                    <tr key={u.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">
                        {u.name} {isMe && <span className="text-xs text-muted-foreground">(you)</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                      <td className="px-4 py-3">
                        <select
                          value={role}
                          disabled={isMe || setRole.isPending}
                          onChange={(e) => setRole.mutate({ userId: u.id, role: e.target.value as "admin" | "staff" })}
                          className="h-8 px-2 rounded-md border border-input bg-background text-sm disabled:opacity-50"
                        >
                          <option value="admin">Admin</option>
                          <option value="staff">Staff</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        {u.banned ? (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-600/12 text-red-700">Access revoked</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[#3F6B52]/12 text-[#3F6B52]">Active</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => toggleBan.mutate({ userId: u.id, ban: !u.banned })}
                            disabled={isMe || toggleBan.isPending}
                            title={u.banned ? "Restore access" : "Revoke access"}
                            className="p-1.5 rounded text-muted-foreground hover:text-primary disabled:opacity-30"
                          >
                            {u.banned ? <ShieldCheck className="size-4" /> : <ShieldBan className="size-4" />}
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`Remove ${u.name} from the team? This cannot be undone.`)) removeUser.mutate(u.id);
                            }}
                            disabled={isMe || removeUser.isPending}
                            title="Remove"
                            className="p-1.5 rounded text-muted-foreground hover:text-destructive disabled:opacity-30"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <AddTeamMemberForm
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            qc.invalidateQueries({ queryKey: ["team-users"] });
            notify("Team member added.");
          }}
        />
      )}
    </div>
  );
}

function AddTeamMemberForm(props: { onClose: () => void; onCreated: () => void }) {
  const { onClose, onCreated } = props;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "staff">("staff");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    setError("");
    if (!name.trim() || !email.trim() || password.length < 8) {
      setError("Fill in name, email and a password of at least 8 characters.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await authClient.admin.createUser({ name: name.trim(), email: email.trim(), password, role: role as "admin" });
      if (error) throw new Error(error.message ?? "Failed to create the team member.");
      onCreated();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create the team member.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl p-6 w-full max-w-sm space-y-3 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground">
          <X className="size-4" />
        </button>
        <h2 className="font-display text-xl font-semibold">Add team member</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Temporary password (min. 8 characters)"
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
        />
        <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "staff")} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
          <option value="staff">Staff — clients, calendar, bookings, packages, messages</option>
          <option value="admin">Admin — full access</option>
        </select>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          onClick={create}
          disabled={saving}
          className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90 disabled:opacity-50"
        >
          {saving && <Loader2 className="size-4 animate-spin" />} Create account
        </button>
      </div>
    </div>
  );
}
