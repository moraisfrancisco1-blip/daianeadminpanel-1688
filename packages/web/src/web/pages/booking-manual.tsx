import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { normalize, idFromQuery } from "../lib/list";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Loader2, Calendar, Clock, User, Mail, Phone, FileText, Search, UserPlus, AlertTriangle, X, Car } from "lucide-react";

type ClientSuggestion = { id: number; name: string; email: string | null; phone: string | null };

const FAR_DATE_WARNING_DAYS = 15;

/** How many days a YYYY-MM-DD date is from today (negative = in the past). */
function daysFromToday(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

export default function BookingManualPage() {
  return (
    <Protected>
      <BookingManualContent />
    </Protected>
  );
}

function BookingManualContent() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<ClientSuggestion[] | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const initialParams = new URLSearchParams(window.location.search);
  const initialDate = initialParams.get("date") ?? "";
  const initialTime = initialParams.get("time") ?? "";
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    clientId: null as number | null,
    serviceId: "",
    date: initialDate,
    startTime: initialTime,
    paymentMethod: "",
    generateInvoice: true,
    packageId: null as number | null,
    notes: "",
    travelPrice: "",
    travelKm: "",
    travelTimeMinutes: "",
    travelVatRate: "0.09",
  });
  const [showTravel, setShowTravel] = useState(false);

  // Session packages the selected client can pay this booking with.
  const clientPackagesQ = useQuery({
    queryKey: ["client-packages", formData.clientId],
    queryFn: async (): Promise<{ packages: { id: number; name: string; totalSessions: number; sessionsUsed: number; expiresAt: string | null }[] }> => {
      const res = await api.clients[":id"].$get({ param: { id: String(formData.clientId) } });
      const data = (await res.json()) as any;
      return { packages: data.packages ?? [] };
    },
    enabled: formData.clientId != null,
  });
  const availablePackages = (clientPackagesQ.data?.packages ?? []).filter(
    (p) => p.sessionsUsed < p.totalSessions && (!p.expiresAt || new Date(p.expiresAt).getTime() >= Date.now()),
  );

  // Fetch services
  const services = useQuery({
    queryKey: ["services"],
    queryFn: async () => (await api.services.$get()).json(),
  });

  // Fetch clients for autocomplete
  const clients = useQuery({
    queryKey: ["clients"],
    queryFn: async () => (await api.clients.$get()).json(),
  });

  const allClients = (clients.data as { clients?: ClientSuggestion[] } | undefined)?.clients ?? [];
  const searchQ = normalize(search);
  const searchId = idFromQuery(search);
  const filteredClients = allClients
    .filter((c) => {
      if (!searchQ) return false;
      if (searchId !== null && c.id === searchId) return true;
      return normalize([c.name, c.email, c.phone].filter(Boolean).join(" ")).includes(searchQ);
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 8);
  const showDropdown = search.trim().length > 0;

  // Close the dropdown when clicking outside the search field.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearch("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const createBooking = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await api.bookings.manual.$post({
        json: {
          clientId: data.clientId ?? undefined,
          name: data.name,
          email: data.email,
          phone: data.phone || null,
          serviceId: Number(data.serviceId),
          date: data.date,
          startTime: data.startTime,
          paymentMethod: data.paymentMethod || null,
          generateInvoice: data.generateInvoice,
          packageId: data.packageId ?? undefined,
          notes: data.notes || null,
          travelPrice: data.travelPrice ? Number(data.travelPrice) : undefined,
          travelKm: data.travelKm ? Number(data.travelKm) : undefined,
          travelTimeMinutes: data.travelTimeMinutes ? Number(data.travelTimeMinutes) : undefined,
          travelVatRate: data.travelPrice ? Number(data.travelVatRate) : undefined,
        },
      });
      const json = await response.json();
      if (!response.ok) throw new Error((json as { message?: string })?.message ?? "Failed to create booking");
      return json;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["calendar-bookings"] });
      qc.invalidateQueries({ queryKey: ["blocked"] });
      setToast("Booking created successfully!");
      setTimeout(() => setToast(null), 3000);
      setSearch("");
      // Reset form
      setFormData({
        name: "",
        email: "",
        phone: "",
        clientId: null,
        serviceId: "",
        date: "",
        startTime: "",
        paymentMethod: "",
        generateInvoice: true,
        packageId: null,
        notes: "",
        travelPrice: "",
        travelKm: "",
        travelTimeMinutes: "",
        travelVatRate: "0.09",
      });
      setShowTravel(false);
      // Return to the Agenda (same week/date) when the form was opened from a double-click.
      if (initialDate) {
        const createdDate = (data as any)?.booking?.date || initialDate;
        navigate(`/calendar?date=${createdDate}`);
      }
    },
    onError: (error) => {
      setToast(error instanceof Error ? error.message : "Error creating booking. Please try again.");
      setTimeout(() => setToast(null), 3000);
    },
  });

  const handleClientSelect = (client: ClientSuggestion) => {
    setFormData((prev) => ({
      ...prev,
      clientId: client.id,
      name: client.name,
      email: client.email ?? "",
      phone: client.phone ?? "",
      packageId: null,
    }));
    setSearch("");
  };

  const handleCreateNew = () => {
    setFormData((prev) => ({ ...prev, clientId: null, packageId: null }));
    setSearch("");
  };

  const findPossibleDuplicates = () => {
    const emailN = normalize(formData.email);
    const phoneN = normalize(formData.phone);
    const nameN = normalize(formData.name);
    return allClients.filter((c) => {
      if (emailN && c.email && normalize(c.email) === emailN) return true;
      if (phoneN && c.phone && normalize(c.phone) === phoneN) return true;
      if (nameN && normalize(c.name) === nameN) return true;
      return false;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.serviceId || !formData.date || !formData.startTime) {
      setToast("Please fill in all required fields.");
      setTimeout(() => setToast(null), 3000);
      return;
    }
    // Duplicate check for new clients (no existing client selected).
    if (formData.clientId == null) {
      const dupes = findPossibleDuplicates();
      if (dupes.length > 0) {
        setDuplicateWarning(dupes);
        return;
      }
    }
    createBooking.mutate(formData);
  };

  // Fetch available slots for the selected date/service (respects weekly schedule + bookings).
  const availability = useQuery({
    queryKey: ["availability", formData.date, formData.serviceId],
    queryFn: async () => {
      if (!formData.date || !formData.serviceId) return { slots: [] as string[] };
      const res = await api.bookings.availability.$get({
        query: { date: formData.date, serviceId: formData.serviceId },
      });
      return (await res.json()) as { slots: string[] };
    },
    enabled: !!formData.date && !!formData.serviceId,
  });
  const timeSlots = availability.data?.slots ?? [];

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-md text-sm font-medium ${
          toast.includes("Error") ? "bg-destructive text-white" : "bg-[#4C7A56] text-white"
        }`}>
          {toast}
        </div>
      )}

      <div className="flex items-center gap-4">
        <Link to="/bookings" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="font-display text-3xl font-semibold">Create Manual Booking</h1>
          <p className="text-muted-foreground mt-1">
            Create a booking directly for a client
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        {/* Client Information */}
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h2 className="font-display text-xl font-semibold flex items-center gap-2">
            <User className="size-5" />
            Client Information
          </h2>

          <div className="space-y-4">
            <div ref={searchRef}>
              <label className="block text-sm font-medium mb-1.5">Find client</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, email, phone or #ID…"
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {showDropdown && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
                    {filteredClients.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => handleClientSelect(client)}
                        className="w-full px-4 py-2.5 text-left hover:bg-accent transition-colors border-b border-border last:border-b-0"
                      >
                        <div className="font-medium">{client.name}</div>
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5">
                          {client.email && <span>{client.email}</span>}
                          {client.phone && <span>{client.phone}</span>}
                          <span className="text-brand-copper font-medium">Cliente #{client.id}</span>
                        </div>
                      </button>
                    ))}
                    {filteredClients.length === 0 && (
                      <p className="px-4 py-2.5 text-sm text-muted-foreground">No matching clients.</p>
                    )}
                    <button
                      type="button"
                      onClick={handleCreateNew}
                      className="w-full px-4 py-2.5 text-left hover:bg-accent transition-colors border-t border-border flex items-center gap-2 text-sm font-medium"
                    >
                      <UserPlus className="size-4" /> Create new client
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                Name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Client name"
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                Email <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="client@example.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Phone</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+31 6 12345678"
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Booking Details */}
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h2 className="font-display text-xl font-semibold flex items-center gap-2">
            <Calendar className="size-5" />
            Booking Details
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Service <span className="text-destructive">*</span>
              </label>
              <select
                value={formData.serviceId}
                onChange={(e) => setFormData({ ...formData, serviceId: e.target.value, startTime: "" })}
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                required
              >
                <option value="">Select a service</option>
                {[...(services.data?.services ?? [])]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — €{s.price.toFixed(2)} ({s.durationMinutes} min)
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Date <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value, startTime: "" })}
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                    required
                  />
                </div>
                {formData.date && Math.abs(daysFromToday(formData.date)) > FAR_DATE_WARNING_DAYS && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-600">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    {new Date(`${formData.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                    {" — "}
                    that's {Math.abs(daysFromToday(formData.date))} days {daysFromToday(formData.date) > 0 ? "from now" : "ago"}. Please confirm this is the right date.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Time <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <select
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                    required
                  >
                    <option value="">Select time</option>
                    {timeSlots.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Payment Details */}
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h2 className="font-display text-xl font-semibold flex items-center gap-2">
            <FileText className="size-5" />
            Payment Details
          </h2>

          <div className="space-y-4">
            {availablePackages.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-1.5">Pay with session package</label>
                <select
                  value={formData.packageId ?? ""}
                  onChange={(e) => setFormData({ ...formData, packageId: e.target.value ? Number(e.target.value) : null })}
                  className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Don't use a package</option>
                  {availablePackages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.totalSessions - p.sessionsUsed} left)
                    </option>
                  ))}
                </select>
                {formData.packageId != null && (
                  <p className="text-xs text-muted-foreground mt-1">
                    This session will be deducted from the package — no invoice will be generated for it.
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1.5">Payment Method</label>
              <select
                value={formData.paymentMethod}
                onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                disabled={formData.packageId != null}
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
              >
                <option value="">Select payment method</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="stripe_card">Card (Stripe)</option>
                <option value="ideal">iDEAL</option>
                <option value="manual">Manual</option>
              </select>
            </div>

            <div>
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={formData.generateInvoice}
                  onChange={(e) => setFormData({ ...formData, generateInvoice: e.target.checked })}
                  disabled={formData.packageId != null}
                  className="mt-0.5 size-4 disabled:opacity-50"
                />
                <span>
                  Generate an invoice automatically for the remaining balance
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Turn this off if payment is already settled outside the app (e.g. cash on the day) — no invoice
                    will be created. You can always add one later from the Invoices page.
                  </span>
                </span>
              </label>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowTravel((v) => !v)}
                className="flex items-center gap-2 text-sm font-medium text-brand-copper"
              >
                <Car className="size-4" /> {showTravel ? "Remove travel / home-visit charge" : "Add travel / home-visit charge"}
              </button>
              {showTravel && (
                <div className="mt-3 p-4 rounded-lg border border-border bg-muted/30 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Added as a separate invoice line, with its own VAT rate — fill in what applies for this session.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Travel price (€)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={formData.travelPrice}
                        onChange={(e) => setFormData({ ...formData, travelPrice: e.target.value })}
                        placeholder="0.00"
                        className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">VAT rate</label>
                      <select
                        value={formData.travelVatRate}
                        onChange={(e) => setFormData({ ...formData, travelVatRate: e.target.value })}
                        className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        <option value="0.21">21%</option>
                        <option value="0.09">9%</option>
                        <option value="0">0%</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Distance (km)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={formData.travelKm}
                        onChange={(e) => setFormData({ ...formData, travelKm: e.target.value })}
                        placeholder="0"
                        className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Travel time (min)</label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={formData.travelTimeMinutes}
                        onChange={(e) => setFormData({ ...formData, travelTimeMinutes: e.target.value })}
                        placeholder="0"
                        className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Any additional notes..."
                rows={3}
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex gap-4">
          <Link
            to="/bookings"
            className="flex-1 px-6 py-3 rounded-lg border border-border text-center hover:bg-accent transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={createBooking.isPending}
            className="flex-1 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {createBooking.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Booking"
            )}
          </button>
        </div>
      </form>

      {duplicateWarning && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl p-6 w-full max-w-md space-y-4 relative">
            <button onClick={() => setDuplicateWarning(null)} className="absolute top-4 right-4 text-muted-foreground">
              <X className="size-4" />
            </button>
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <h2 className="font-display text-lg font-semibold">Possible existing client found</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Please select an existing client or confirm that you want to create a new one.
                </p>
              </div>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {duplicateWarning.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    handleClientSelect(c);
                    setDuplicateWarning(null);
                  }}
                  className="w-full text-left px-3 py-2 rounded-md border border-border hover:bg-accent transition-colors"
                >
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {[c.email, c.phone].filter(Boolean).join(" · ")} · Cliente #{c.id}
                  </div>
                </button>
              ))}
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setDuplicateWarning(null)}
                className="flex-1 px-4 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setDuplicateWarning(null);
                  createBooking.mutate(formData);
                }}
                className="flex-1 px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
              >
                Create new anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}