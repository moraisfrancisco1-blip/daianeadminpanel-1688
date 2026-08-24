import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  Package,
  FileText,
  Receipt,
  Calendar,
  CalendarDays,
  BellRing,
  Download,
  BarChart3,
  MessageCircle,
  Layers,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useSession, signOut } from "../../lib/auth-client";
import { cn } from "../../lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/catalog", label: "Catalog", icon: Package },
  { href: "/quotes", label: "Quotes", icon: FileText },
  { href: "/invoices", label: "Invoices", icon: Receipt },
  { href: "/calendar", label: "Agenda", icon: Calendar },
  { href: "/bookings", label: "Bookings", icon: CalendarDays },
  { href: "/reminders", label: "Reminders", icon: BellRing },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/packages", label: "Packages", icon: Layers },
  { href: "/exports", label: "Exports", icon: Download },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  const NavLinks = () => (
    <>
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = location === href;
        return (
          <Link
            key={href}
            to={href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium tracking-wide transition-colors",
              active ? "bg-brand-copper text-white" : "text-brand-cream/75 hover:bg-white/10 hover:text-brand-cream",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </>
  );

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
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-brand-teal flex flex-col">
            <div className="px-6 py-6 border-b border-white/10 flex items-center justify-between">
              <img src="/brand/logo.png" alt="Studio Daï Oakes" className="w-full max-w-[150px] h-auto" />
              <button onClick={() => setMobileOpen(false)} className="text-brand-cream shrink-0 ml-2">
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
              <NavLinks />
            </nav>
            <div className="px-3 py-4 border-t border-white/10">
              <div className="px-3 py-2 mb-2">
                <p className="text-xs text-brand-cream/60 truncate">{session?.user?.email}</p>
              </div>
              <button
                onClick={() => signOut().then(() => window.location.assign("/login"))}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-brand-cream/70 hover:bg-white/10 hover:text-brand-cream transition-colors"
              >
                <LogOut className="size-4" />
                Sign out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 bg-brand-teal flex-col">
        <div className="px-6 py-8 border-b border-white/10 flex flex-col items-center text-center">
          <img src="/brand/logo.png" alt="Studio Daï Oakes" className="w-full max-w-[170px] h-auto" />
        </div>
        <nav className="flex-1 px-3 py-5 space-y-1">
          <NavLinks />
        </nav>
        <div className="px-3 py-4 border-t border-white/10">
          <div className="px-3 py-2 mb-2">
            <p className="text-xs text-brand-cream/60 truncate">{session?.user?.email}</p>
          </div>
          <button
            onClick={() => signOut().then(() => window.location.assign("/login"))}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-brand-cream/70 hover:bg-white/10 hover:text-brand-cream transition-colors"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 pt-14 md:pt-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 py-6 md:py-8">{children}</div>
      </main>
    </div>
  );
}
