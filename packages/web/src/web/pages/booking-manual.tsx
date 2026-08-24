import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Link } from "wouter";
import { ArrowLeft, Loader2, Calendar, Clock, User, Mail, Phone, FileText } from "lucide-react";

export default function BookingManualPage() {
  return (
    <Protected>
      <BookingManualContent />
    </Protected>
  );
}

function BookingManualContent() {
  const [toast, setToast] = useState<string | null>(null);
  const initialParams = new URLSearchParams(window.location.search);
  const initialDate = initialParams.get("date") ?? "";
  const initialTime = initialParams.get("time") ?? "";
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    serviceId: "",
    date: initialDate,
    startTime: initialTime,
    depositAmount: "",
    paymentMethod: "",
    notes: "",
  });

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

  const createBooking = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await api.bookings.manual.$post({
        json: {
          name: data.name,
          email: data.email,
          phone: data.phone || null,
          serviceId: Number(data.serviceId),
          date: data.date,
          startTime: data.startTime,
          depositAmount: data.depositAmount ? Number(data.depositAmount) : null,
          paymentMethod: data.paymentMethod || null,
          notes: data.notes || null,
        },
      });
      const json = await response.json();
      if (!response.ok) throw new Error((json as { message?: string })?.message ?? "Failed to create booking");
      return json;
    },
    onSuccess: () => {
      setToast("Booking created successfully!");
      setTimeout(() => setToast(null), 3000);
      // Reset form
      setFormData({
        name: "",
        email: "",
        phone: "",
        serviceId: "",
        date: "",
        startTime: "",
        depositAmount: "",
        paymentMethod: "",
        notes: "",
      });
    },
    onError: (error) => {
      setToast(error instanceof Error ? error.message : "Error creating booking. Please try again.");
      setTimeout(() => setToast(null), 3000);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.serviceId || !formData.date || !formData.startTime) {
      setToast("Please fill in all required fields.");
      setTimeout(() => setToast(null), 3000);
      return;
    }
    createBooking.mutate(formData);
  };

  // Filter clients based on email input for autocomplete
  const allClients = (clients.data as { clients?: Array<{ id: number; name: string; email: string | null; phone: string | null }> } | undefined)?.clients ?? [];
  const filteredClients = allClients
    .filter((c) => c.email && c.email.toLowerCase().includes(formData.email.toLowerCase()))
    .slice(0, 5);

  const handleClientSelect = (client: { name: string; email: string | null; phone: string | null }) => {
    setFormData({
      ...formData,
      name: client.name,
      email: client.email ?? "",
      phone: client.phone ?? "",
    });
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
              {/* Client autocomplete */}
              {filteredClients.length > 0 && formData.email && (
                <div className="absolute z-10 w-full mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
                  {filteredClients.map((client, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleClientSelect(client)}
                      className="w-full px-4 py-2 text-left hover:bg-accent transition-colors"
                    >
                      <div className="font-medium">{client.name}</div>
                      <div className="text-xs text-muted-foreground">{client.email}</div>
                    </button>
                  ))}
                </div>
              )}
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
                {services.data?.services?.map((s) => (
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
            <div>
              <label className="block text-sm font-medium mb-1.5">Deposit Amount (€)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.depositAmount}
                onChange={(e) => setFormData({ ...formData, depositAmount: e.target.value })}
                placeholder="0.00"
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Leave empty for free services or if no deposit is required
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Payment Method</label>
              <select
                value={formData.paymentMethod}
                onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
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
    </div>
  );
}