import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Bell, LogOut, Menu, Search, Settings, User, X } from "lucide-react";
import { useSession, signOut } from "../../lib/auth-client";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api";

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard" },
      { href: "/reports", label: "Reports" },
    ],
  },
  {
    label: "Clients & Schedule",
    items: [
      { href: "/clients", label: "Clients" },
      { href: "/calendar", label: "Agenda" },
      { href: "/bookings", label: "Bookings" },
      { href: "/reminders", label: "Reminders" },
    ],
  },
  {
    label: "Billing",
    items: [
      { href: "/catalog", label: "Catalog" },
      { href: "/quotes", label: "Quotes" },
      { href: "/invoices", label: "Invoices" },
      { href: "/payment-control", label: "Payment Control" },
      { href: "/refunds", label: "Refunds" },
      { href: "/packages", label: "Packages" },
    ],
  },
  {
    label: "Communication",
    items: [
      { href: "/messages", label: "Messages" },
      { href: "/emails", label: "Email History" },
    ],
  },
  {
    label: "Data",
    items: [{ href: "/exports", label: "Exports" }],
  },
];

function initialsOf(name?: string | null): string {
  if (!name) return "D";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "D";
}

function greetingNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 19) return "Boa tarde";
  return "Boa noite";
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  return (
    <>
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="mb-5">
          <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-gold/60">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map(({ href, label }) => {
              const active = location === href;
              return (
                <Link
                  key={href}
                  to={href}
                  onClick={onNavigate}
                  className={cn(
                    "relative flex items-center gap-3 pl-4 pr-3 py-2 rounded-md text-sm tracking-wide transition-colors",
                    active
                      ? "bg-white/10 text-brand-cream font-medium"
                      : "text-brand-cream/70 hover:bg-white/5 hover:text-brand-cream",
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r bg-brand-gold" />
                  )}
                  <span
                    className={cn(
                      "size-1.5 rounded-full shrink-0",
                      active ? "bg-brand-gold" : "border border-brand-cream/35 bg-transparent",
                    )}
                  />
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

function AvatarMenu({
  name,
  email,
  roleLabel,
  size = "md",
}: {
  name: string;
  email?: string | null;
  roleLabel: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2.5 rounded-full transition-colors",
          size === "sm" ? "" : "hover:bg-accent/60 pl-1 pr-2.5 py-1",
        )}
      >
        <span
          className={cn(
            "shrink-0 rounded-full bg-brand-teal text-brand-cream flex items-center justify-center font-display font-semibold ring-2 ring-brand-gold/70",
            size === "sm" ? "size-8 text-xs" : "size-9 text-sm",
          )}
        >
          {initialsOf(name)}
        </span>
        {size === "md" && (
          <span className="hidden sm:block text-left leading-tight">
            <span className="block text-sm font-medium text-foreground">{name}</span>
            <span className="block text-xs text-muted-foreground">{roleLabel}</span>
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-52 rounded-lg border border-border bg-card shadow-lg py-1.5 z-50">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-sm font-medium truncate">{name}</p>
            {email && <p className="text-xs text-muted-foreground truncate">{email}</p>}
          </div>
          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors">
            <User className="size-4" /> Profile
          </button>
          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors">
            <Settings className="size-4" /> Settings
          </button>
          <div className="border-t border-border mt-1 pt-1">
            <button
              onClick={() => signOut().then(() => window.location.assign("/login"))}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-destructive hover:bg-accent transition-colors"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const alerts = useQuery({
    queryKey: ["dashboard-alerts"],
    queryFn: async (): Promise<any> => (await api.dashboard.alerts.$get()).json(),
    staleTime: 60000,
  });
  const items = alerts.data?.alerts ?? [];

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative size-9 rounded-full flex items-center justify-center text-brand-teal hover:bg-accent transition-colors"
      >
        <Bell className="size-4.5" />
        {items.length > 0 && <span className="absolute top-1.5 right-2 size-2 rounded-full bg-destructive" />}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-lg border border-border bg-card shadow-lg py-1.5 z-50">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">
            Notifications
          </p>
          <div className="max-h-72 overflow-y-auto">
            {items.slice(0, 8).map((a: any) => (
              <Link
                key={a.id}
                to={a.link}
                onClick={() => setOpen(false)}
                className="flex items-start gap-2 px-3 py-2.5 hover:bg-accent transition-colors"
              >
                <span
                  className={cn(
                    "mt-1.5 size-2 rounded-full shrink-0",
                    a.severity === "high" ? "bg-destructive" : a.severity === "medium" ? "bg-brand-bronze" : "bg-brand-teal",
                  )}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{a.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{a.detail}</p>
                </div>
              </Link>
            ))}
            {items.length === 0 && <p className="px-3 py-6 text-sm text-center text-muted-foreground">No notifications.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const name = session?.user?.name || "Daï Oakes";

  return (
    <div className="min-h-screen flex bg-background">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 h-14 bg-brand-teal flex items-center justify-between px-4 z-40">
        <img src="/brand/logo.png" alt="Studio Daï Oakes" className="h-8 w-auto" />
        <button onClick={() => setMobileOpen(true)} className="text-brand-cream p-1">
          <Menu className="size-6" />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-gradient-to-b from-brand-teal to-brand-teal-dark flex flex-col">
            <div className="px-6 py-6 border-b border-white/10 flex items-center justify-between">
              <img src="/brand/logo.png" alt="Studio Daï Oakes" className="w-full max-w-[150px] h-auto" />
              <button onClick={() => setMobileOpen(false)} className="text-brand-cream shrink-0 ml-2">
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-5 overflow-y-auto">
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </nav>
            <div className="px-4 py-4 border-t border-brand-gold/25">
              <div className="flex items-center gap-2.5">
                <span className="size-8 shrink-0 rounded-full bg-white/10 text-brand-cream flex items-center justify-center font-display font-semibold text-xs ring-2 ring-brand-gold/70">
                  {initialsOf(name)}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-cream truncate">{name}</p>
                  <p className="text-xs text-brand-cream/60 truncate">Founder &amp; Lead Therapist</p>
                </div>
              </div>
              <button
                onClick={() => signOut().then(() => window.location.assign("/login"))}
                className="w-full mt-3 flex items-center gap-3 px-1 py-2 rounded-md text-sm font-medium text-brand-cream/70 hover:text-brand-cream transition-colors"
              >
                <LogOut className="size-4" />
                Sign out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 bg-gradient-to-b from-brand-teal to-brand-teal-dark flex-col">
        <div className="px-6 pt-8 pb-6 border-b border-white/10">
          <img src="/brand/logo.png" alt="Studio Daï Oakes" className="w-full max-w-[150px] h-auto" />
        </div>
        <nav className="flex-1 px-3 pt-5 overflow-y-auto">
          <NavLinks />
        </nav>
        <div className="px-4 py-4 border-t border-brand-gold/25">
          <div className="flex items-center gap-2.5">
            <span className="size-9 shrink-0 rounded-full bg-white/10 text-brand-cream flex items-center justify-center font-display font-semibold text-sm ring-2 ring-brand-gold/70">
              {initialsOf(name)}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-brand-cream truncate">{name}</p>
              <p className="text-xs text-brand-cream/60 truncate">Founder &amp; Lead Therapist</p>
            </div>
          </div>
          <button
            onClick={() => signOut().then(() => window.location.assign("/login"))}
            className="w-full mt-3 flex items-center gap-3 px-1 py-2 rounded-md text-sm font-medium text-brand-cream/70 hover:text-brand-cream transition-colors"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 pt-14 md:pt-0 flex flex-col">
        {/* Utility top bar */}
        <div className="hidden md:flex items-center justify-between gap-4 px-8 h-16 border-b border-border/70 shrink-0">
          <p className="text-sm text-muted-foreground">
            {greetingNow()}, {name.split(" ")[0]}
          </p>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                aria-label="Procurar cliente, fatura"
                placeholder="Procurar cliente, fatura..."
                className="w-64 h-9 pl-9 pr-3 rounded-full border border-input bg-secondary/40 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
            <NotificationsMenu />
            <AvatarMenu name={name} email={session?.user?.email} roleLabel="Admin" />
          </div>
        </div>

        <div className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 md:px-8 py-6 md:py-8">{children}</div>
      </main>
    </div>
  );
}
