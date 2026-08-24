import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Copy, MessageCircle, Mail, Check } from "lucide-react";

type Client = { id: number; name: string; email: string | null; phone: string | null };
type Service = { id: number; name: string };

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

  const clientsQ = useQuery({
    queryKey: ["clients"],
    queryFn: async (): Promise<Client[]> => {
      const res = await api.clients.$get();
      return ((await res.json()) as { clients: Client[] }).clients;
    },
  });
  const servicesQ = useQuery({
    queryKey: ["services"],
    queryFn: async (): Promise<Service[]> => {
      const res = await api.services.$get();
      return ((await res.json()) as { services: Service[] }).services;
    },
  });

  const selectedClient = (clientsQ.data ?? []).find((c) => c.id === Number(clientId));
  const selectedService = (servicesQ.data ?? []).find((s) => s.id === Number(serviceId));

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
                const c = (clientsQ.data ?? []).find((x) => x.id === Number(e.target.value));
                if (c) setName(c.name);
              }}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm mt-1"
            >
              <option value="">— Selecionar —</option>
              {(clientsQ.data ?? []).map((c) => (
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
              {(servicesQ.data ?? []).map((s) => (
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
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-[#25D366] text-white hover:opacity-90"
              >
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            )}
            {mailLink && (
              <a
                href={mailLink}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent"
              >
                <Mail className="size-4" /> Email
              </a>
            )}
          </div>
          {!selectedClient?.phone && !selectedClient?.email && (
            <p className="text-xs text-muted-foreground">
              Selecione um cliente com telefone ou email para abrir WhatsApp/Email diretamente.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

