import { useState } from "react";
import { useLocation } from "wouter";
import { signIn } from "../lib/auth-client";
import { Button } from "../components/ui/button";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [, navigate] = useLocation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await signIn.email({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message ?? "Invalid credentials");
      return;
    }
    navigate("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-teal px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/brand/logo.png" alt="Studio Daï Oakes" className="w-full max-w-[220px] mx-auto h-auto" />
          <p className="text-sm text-brand-cream/70 mt-3 tracking-wide">Admin Panel</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-brand-cream rounded-lg p-6 space-y-4 shadow-lg">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-brand-teal">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-brand-tan/40 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-copper"
              placeholder="daianeoakes@gmail.com"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-brand-teal">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-brand-tan/40 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-copper"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full bg-brand-copper hover:bg-brand-copper/90 text-white tracking-wide" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
