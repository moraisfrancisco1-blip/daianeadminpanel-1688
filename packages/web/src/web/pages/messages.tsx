import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Copy, MessageCircle, Mail, Check, Smartphone, History } from "lucide-react";

type Client = { id: number; name: string; email: string | null; phone: string | null };
type Service = { id: number; name: string };
type ClientBooking = { id: number; serviceId: number | null; date: string; startTime: string; status: string };
type MessageLogRow = {
  id: number;
  clientId: number | null;
  clientName: string | null;
  channel: string;
  recipient: string;
  templateId: string | null;
  body: string;
  status: string;
  error: string | null;
  createdAt: string;
};

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Email" };

const TEMPLATES = [
  {
    id: "confirmation",
    label: "Confirmação de reserva",
    body: "Olá {{name}}, a sua sessão de {{service}} está confirmada para {{date}} às {{time}}. Até breve! 💛",
  },
  {
    id: "reminder",
    label: "Lembrete de sessão",
    body: "Olá {{name}}, só para lembrar: a sua sessão de {{service}} é {{date}} às {{time}}. Até já!",
  },
  {
    id: "payment",
    label: "Pagamento pendente",
    body: "Olá {{name}}, o pagamento referente à sua sessão de {{service}} ({{date}}) está pendente. Obrigada!",
  },
  {
    id: "reschedule",
    label: "Reagendamento",
    body: "Olá {{name}}, gostaria de reagendar a sua sessão de {{service}} ({{date}} às {{time}}). Qual horário lhe daria jeito?",
  },
  {
    id: "cancel",
    label: "Cancelamento",
    body: "Olá {{name}}, informo que a sua sessão de {{service}} em {{date}} às {{time}} foi cancelada. Obrigada pela compreensão.",
  },
  {
    id: "thanks",
    label: "Agradecimento",
    body: "Olá {{name}}, obrigada pela sua visita! Foi um prazer. Até à próxima sessão de {{service}}! 🌿",
  },
];

export default function MessagesPage() {
  return (
    <Protected>
      <MessagesContent />
    </Protected>
  );
}

function MessagesContent() {
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [clientId, setClientId] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [copied, setCopied] = useState(false);
  const [smsStatus, setSmsStatus] = useState<string>("");

  const clientsQ = useQuery({
    queryKey: ["messages-clients"],
    queryFn: async (): Promise<Client[]> => {
      const res = await api.clients.$get();
      return ((await res.json()) as { clients: Client[] }).clients;
    },
  });
  const servicesQ = useQuery({
    queryKey: ["messages-services"],
    queryFn: async (): Promise<Service[]> => {
      const res = await api.services.$get();
      return ((await res.json()) as { services: Service[] }).services;
    },
  });

  const clientsList = Array.isArray(clientsQ.data) ? clientsQ.data : [];
  const servicesList = Array.isArray(servicesQ.data) ? servicesQ.data : [];
  const selectedClient = clientsList.find((c) => c.id === Number(clientId));
  const selectedService = servicesList.find((s) => s.id === Number(serviceId));

  // Pull the client's next upcoming session so the message doesn't need the
  // date/time typed by hand every time — still editable afterwards.
  const clientDetailQ = useQuery({
    queryKey: ["messages-client-detail", clientId],
    queryFn: async (): Promise<{ bookings: ClientBooking[] }> => {
      const res = await api.clients[":id"].$get({ param: { id: clientId } });
      return (await res.json()) as any;
    },
    enabled: !!clientId,
  });

  useEffect(() => {
    if (!clientId || !clientDetailQ.data) return;
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = clientDetailQ.data.bookings
      .filter((b) => (b.status === "confirmed" || b.status === "pending_deposit") && b.date >= today)
      .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))[0];
    if (upcoming) {
      setDate(upcoming.date);
      setTime(upcoming.startTime);
      if (upcoming.serviceId) setServiceId(String(upcoming.serviceId));
    }
  }, [clientId, clientDetailQ.data]);

  const message = useMemo(() => {
    const tpl = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
    return tpl.body
      .replaceAll("{{name}}", name || "Cliente")
      .replaceAll("{{service}}", selectedService?.name ?? "sessão")
      .replaceAll("{{date}}", date || "[data]")
      .replaceAll("{{time}}", time || "[hora]");
  }, [templateId, name, selectedService, date, time]);

  function copy() {
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const phone = selectedClient?.phone?.replace(/[^\d+]/g, "");
  const waLink = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null;
  const mailLink = selectedClient?.email
    ? `mailto:${selectedClient.email}?subject=${encodeURIComponent("Studio Daï Oakes")}&body=${encodeURIComponent(message)}`
    : null;

  const qc = useQueryClient();

  const messagesLogQ = useQuery({
    queryKey: ["messages-log"],
    queryFn: async () => (await api.messages.log.$get()).json() as Promise<{ messages: MessageLogRow[] }>,
  });

  const smsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedClient?.phone) throw new Error("O cliente não tem número de telefone.");
      const res = await api.sms.send.$post({
        json: { to: selectedClient.phone, message, clientId: selectedClient.id, templateId },
      });
      const data = (await res.json()) as { success?: boolean; message?: string };
      if (!res.ok || !data.success) throw new Error(data.message ?? "Não foi possível enviar o SMS.");
      return data;
    },
    onSuccess: () => {
      setSmsStatus("SMS enviado com sucesso.");
      qc.invalidateQueries({ queryKey: ["messages-log"] });
    },
    onError: (error) => setSmsStatus(error instanceof Error ? error.message : "Não foi possível enviar o SMS."),
  });

  // WhatsApp/email open an external app, so this only records that the admin
  // opened it with the message pre-filled — not proof of actual delivery.
  function logOpened(channel: "whatsapp" | "email", recipient: string) {
    api.messages.log
      .$post({
        json: {
          clientId: selectedClient?.id ?? null,
          channel,
          recipient,
          templateId,
          body: message,
          status: "opened",
        },
      })
      .then(() => qc.invalidateQueries({ queryKey: ["messages-log"] }))
      .catch(() => {});
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-brand-teal">Mensagens rápidas</h1>
        <p className="text-muted-foreground mt-1">Templates com preenchimento automático</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Template</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm mt-1"
            >
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Cliente</label>
            <select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setSmsStatus("");
                const c = (clientsQ.data ?? []).find((x) => x.id === Number(e.target.value));
                if (c) setName(c.name);
              }}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm mt-1"
            >
              <option value="">— Selecionar —</option>
              {[...(clientsQ.data ?? [])]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Serviço</label>
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm mt-1"
            >
              <option value="">— Selecionar —</option>
              {[...(servicesQ.data ?? [])]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Nome</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome"
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Data</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm mt-1"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Hora</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm mt-1"
            />
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h3 className="font-medium">Pré-visualização</h3>
          <div className="bg-secondary/40 rounded-lg p-4 text-sm whitespace-pre-wrap min-h-[120px]">{message}</div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={copy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent"
            >
              {copied ? <Check className="size-4 text-[#4C7A56]" /> : <Copy className="size-4" />} {copied ? "Copiado!" : "Copiar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSmsStatus("");
                smsMutation.mutate();
              }}
              disabled={!selectedClient?.phone || smsMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand-teal text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Smartphone className="size-4" /> {smsMutation.isPending ? "A enviar..." : "Enviar SMS"}
            </button>
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                onClick={() => logOpened("whatsapp", phone ?? "")}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-[#25D366] text-white hover:opacity-90"
              >
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            )}
            {mailLink && (
              <a
                href={mailLink}
                onClick={() => logOpened("email", selectedClient?.email ?? "")}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent"
              >
                <Mail className="size-4" /> Email
              </a>
            )}
          </div>
          {smsStatus && (
            <p className={`text-sm ${smsStatus === "SMS enviado com sucesso." ? "text-green-700" : "text-red-600"}`}>{smsStatus}</p>
          )}
          {!selectedClient?.phone && !selectedClient?.email && (
            <p className="text-xs text-muted-foreground">
              Selecione um cliente com telefone ou email para abrir WhatsApp/Email diretamente.
            </p>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <h3 className="font-medium p-6 pb-3 flex items-center gap-2">
          <History className="size-4 text-brand-copper" /> Mensagens recentes
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Canal</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Quando</th>
              </tr>
            </thead>
            <tbody>
              {(messagesLogQ.data?.messages ?? []).map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="px-6 py-3 font-medium">{m.clientName ?? m.recipient}</td>
                  <td className="px-4 py-3 text-muted-foreground">{CHANNEL_LABEL[m.channel] ?? m.channel}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        m.status === "failed" ? "bg-red-600/12 text-red-700" : "bg-[#3F6B52]/12 text-[#3F6B52]"
                      }`}
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(m.createdAt).toLocaleString("en-GB")}</td>
                </tr>
              ))}
              {(messagesLogQ.data?.messages ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                    Sem mensagens registadas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
