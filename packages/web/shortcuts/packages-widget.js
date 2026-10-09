// Scriptable widget: packages about to run out (1 session left) or expire (<= 14 days) — first name only.
// Same setup as agenda-widget.js (shares the Keychain token).
const BASE = "https://admin.studiodaioakes.com"; // change if your admin domain differs
const KEY = "dai-shortcuts-token";

async function build() {
  const w = new ListWidget();
  w.backgroundColor = new Color("#2F5459");
  w.url = BASE + "/packages";
  w.refreshAfterDate = new Date(Date.now() + 60 * 60 * 1000);
  try {
    if (!Keychain.contains(KEY)) throw new Error("Corre primeiro o widget da agenda para guardar o token");
    const req = new Request(BASE + "/api/shortcuts/packages-expiring");
    req.headers = { Authorization: "Bearer " + Keychain.get(KEY) };
    const data = await req.loadJSON();
    if (req.response.statusCode === 403) throw new Error("Token inválido");

    const title = w.addText(`Renovações · ${data.total}`);
    title.font = Font.boldSystemFont(14);
    title.textColor = Color.white();
    w.addSpacer(4);
    const max = config.widgetFamily === "large" ? 8 : config.widgetFamily === "medium" ? 4 : 3;
    if (data.items.length === 0) {
      const t = w.addText("Nenhum pacote a terminar");
      t.font = Font.systemFont(12);
      t.textColor = new Color("#FFFFFF", 0.8);
    }
    for (const i of data.items.slice(0, max)) {
      const when = i.daysLeft === null ? "" : ` · ${i.daysLeft}d`;
      const t = w.addText(`${i.name}  ${i.remaining} sessão${i.remaining === 1 ? "" : "ões"}${when}`);
      t.font = Font.systemFont(13);
      t.textColor = Color.white();
    }
  } catch (e) {
    const t = w.addText("Erro: " + e.message);
    t.font = Font.systemFont(12);
    t.textColor = Color.white();
  }
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
