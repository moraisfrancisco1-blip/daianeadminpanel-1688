import { useEffect } from "react";
import { useLocation } from "wouter";
import { useSession } from "../lib/auth-client";
import { AdminLayout } from "./layout/admin-layout";

export function Protected({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isPending && !session) navigate("/login");
  }, [isPending, session, navigate]);

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }
  if (!session) return null;

  return <AdminLayout>{children}</AdminLayout>;
}
