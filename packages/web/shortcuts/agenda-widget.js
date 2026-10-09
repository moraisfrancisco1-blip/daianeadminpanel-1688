// Scriptable widget: today's sessions (first name + time only) and money snapshot.
// Setup: install Scriptable, new script, paste this. Run it once inside the app — it asks for the token
// (the SHORTCUTS_TOKEN set in Vercel) and keeps it in the iOS Keychain. Then add a Scriptable widget.
const BASE = "https://admin.studiodaioakes.com"; // change if your admin domain differs
const KEY = "dai-shortcuts-token";

async function getToken() {
  if (Keychain.contains(KEY)) return Keychain.get(KEY);
  const a = new Alert();
  a.title = "Token do painel";
  a.message = "Cola o SHORTCUTS_TOKEN. Fica guardado no Keychain deste iPhone.";
  a.addSecureTextField("token");
  a.addAction("Guardar");
  await a.present();
  const t = a.textFieldValue(0).trim();
  if (t) Keychain.set(KEY, t);
  return t;
}

async function call(path, token) {
  const req = new Request(BASE + path);
  req.headers = { Authorization: "Bearer " + token };
  const data = await req.loadJSON();
  if (req.response.statusCode === 403) {
    Keychain.remove(KEY); // wrong/revoked token: ask again on the next run
    throw new Error("Token inválido");
  }
  return data;
}

const money = (n) => "€" + Number(n).toFixed(0);

async function build() {
  const w = new ListWidget();
  w.backgroundColor = new Color("#2F5459");
  w.url = BASE;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  try {
    const token = await getToken();
    const [today, stats] = await Promise.all([call("/api/shortcuts/today", token), call("/api/shortcuts/stats", token)]);

    const title = w.addText(`Hoje · ${today.remaining} por vir`);
    title.font = Font.boldSystemFont(14);
    title.textColor = Color.white();
    w.addSpacer(4);

    const max = config.widgetFamily === "large" ? 8 : config.widgetFamily === "medium" ? 3 : 2;
    const upcoming = today.items.filter((i) => !i.done).slice(0, max);
    if (upcoming.length === 0) {
      const t = w.addText("Sem mais marcações hoje");
      t.font = Font.systemFont(12);
      t.textColor = new Color("#FFFFFF", 0.8);
    }
    for (const i of upcoming) {
      const t = w.addText(`${i.time}  ${i.name}`);
      t.font = Font.systemFont(13);
      t.textColor = Color.white();
    }

    if (config.widgetFamily !== "small") {
      w.addSpacer();
      const s = w.addText(`Hoje ${money(stats.revenueToday)} · Semana ${money(stats.revenueWeek)}`);
      s.font = Font.mediumSystemFont(12);
      s.textColor = new Color("#E8D9A8");
      if (stats.overdueCount > 0) {
        const o = w.addText(`${stats.overdueCount} em atraso (${money(stats.overdueTotal)})`);
        o.font = Font.mediumSystemFont(12);
        o.textColor = new Color("#FF9E8F");
      }
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
