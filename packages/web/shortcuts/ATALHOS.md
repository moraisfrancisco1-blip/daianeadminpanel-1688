# Atalhos do iPhone da Dai — guia passo a passo

Os nomes das ações podem variar ligeiramente com a versão do iOS. Se o iPhone estiver em inglês, as ações
chamam-se: *Get Contents of URL*, *Get Dictionary Value*, *Show Notification*, etc.

## Antes de começar (uma vez)

1. Define o `SHORTCUTS_TOKEN` na Vercel (Settings → Environment Variables → Production) e faz redeploy.
2. Em **cada** ação "Obter conteúdo do URL" que vem abaixo, adiciona o cabeçalho:
   - Mostrar mais → Cabeçalhos → Adicionar novo cabeçalho
   - Chave: `Authorization`
   - Texto: `Bearer ` + o teu token (com um espaço depois de "Bearer")
3. O endereço base é `https://admin.studiodaioakes.com` (muda se o teu domínio do painel for outro).

Dica: faz o primeiro atalho, configura bem o cabeçalho, e **duplica** esse atalho para os seguintes. Assim não
tens de escrever o token todas as vezes.

Nunca partilhes estes atalhos: o token está escrito dentro deles.

---

## 1. Próxima cliente (a Siri diz quem vem a seguir)

1. **Obter conteúdo do URL** → `https://admin.studiodaioakes.com/api/shortcuts/next` · Método GET · cabeçalho Authorization.
2. **Obter valor do dicionário** → Obter valor de `summary` em *Conteúdo do URL*.
3. **Falar texto** → o valor do dicionário. (Ou *Mostrar resultado*.)
4. Dá-lhe o nome "Próxima cliente". Dizes: "Ei Siri, Próxima cliente".

## 2. Agenda de hoje

1. **Obter conteúdo do URL** → `.../api/shortcuts/today` (GET, cabeçalho).
2. **Obter valor do dicionário** → `items`.
3. **Repetir com cada item**
   - **Obter valor do dicionário** → `time` · **Obter valor do dicionário** → `name`
   - **Texto**: `time name` (as duas variáveis, com um espaço)
   - **Adicionar à variável** `Agenda`
4. **Mostrar resultado** com a variável `Agenda`.

## 3. Faturação de hoje

1. **Obter conteúdo do URL** → `.../api/shortcuts/stats` (GET, cabeçalho).
2. **Obter valor do dicionário** → `revenueToday`, `revenueWeek`, `overdueCount`, `overdueTotal`.
3. **Texto**: `Hoje €[revenueToday]. Semana €[revenueWeek]. Em atraso: [overdueCount] (€[overdueTotal]).`
4. **Falar texto** (ou *Mostrar resultado*).

## 4. Scan despesa (recibo → despesa)

1. **Tirar fotografia** (ou *Selecionar fotografias*).
2. **Converter imagem** → JPEG.
3. **Redimensionar imagem** → largura `1600` (a Vercel recusa pedidos acima de ~4,5 MB).
4. **Obter conteúdo do URL** → `.../api/shortcuts/expense-scan`
   - Método: **POST** · cabeçalho Authorization
   - Corpo do pedido: **Formulário** → Adicionar novo campo → tipo **Ficheiro** → chave `file` → valor: a imagem redimensionada.
5. **Obter valor do dicionário** → `summary`.
6. **Mostrar notificação** com esse valor.

A despesa fica guardada com a nota "REVER — digitalizado pelo iPhone". A Dai confirma-a depois no painel
(Expenses) e remove a nota ao editar.

## 5. Link de pagamento (cliente → link no WhatsApp)

Usa a fatura mais recente por pagar da cliente. Não cria nem altera faturas.

1. **Pedir dados** → tipo Texto → pergunta "Nome da cliente".
2. **Codificar URL** (URL Encode) → a entrada que o utilizador escreveu.
3. **Obter conteúdo do URL** → `.../api/shortcuts/clients?q=` + o texto codificado (GET, cabeçalho).
4. **Obter valor do dicionário** → `labels` (é uma lista de textos como "Maria Silva #14").
5. **Escolher da lista** → a lista `labels`. Guarda o resultado.
6. **Obter conteúdo do URL** → `.../api/shortcuts/payment-link`
   - Método **POST** · cabeçalho Authorization
   - Corpo do pedido: **JSON** → campo `clientRef` (Texto) = o item escolhido.
7. **Obter valor do dicionário** → `url`, `phone`, `firstName`, `summary`.
   - Se o passo 6 falhar (por exemplo "não tem faturas por pagar"), a resposta traz `summary` com a razão.
8. **Texto** (a mensagem): `Olá [firstName]! Aqui está o link para pagar: [url]`
9. **Codificar URL** → a mensagem.
10. **Abrir URL** → `https://wa.me/[phone só com dígitos]?text=[mensagem codificada]`
    - O `phone` tem de estar com indicativo do país e sem `+`, espaços ou zeros iniciais (ex.: `31642176755`).
      Se os números no painel vierem com espaços, usa a ação **Substituir texto** (espaço → nada) antes.

## 6. Marcar sessão

1. **Pedir dados** (Texto) → "Nome da cliente" → **Codificar URL**.
2. **Obter conteúdo do URL** → `.../api/shortcuts/clients?q=` + texto → **Obter valor** `labels` → **Escolher da lista** → guarda como `Cliente`.
3. **Obter conteúdo do URL** → `.../api/shortcuts/services` (GET, cabeçalho) → **Obter valor** `labels` → **Escolher da lista** → guarda como `Serviço`.
4. **Pedir dados** → tipo **Data** → "Que dia?" → **Formatar data** → formato personalizado `yyyy-MM-dd` → guarda como `Dia`.
5. **Pedir dados** → tipo **Hora** → "Que hora?" → **Formatar data** → formato personalizado `HH:mm` → guarda como `Hora`.
6. **Obter conteúdo do URL** → `.../api/shortcuts/book`
   - Método **POST** · cabeçalho Authorization
   - Corpo do pedido: **JSON** → `clientRef` = `Cliente`, `serviceRef` = `Serviço`, `date` = `Dia`, `startTime` = `Hora` (todos Texto).
7. **Obter valor do dicionário** → `summary` → **Mostrar notificação**.

Atenção: tal como uma marcação feita no painel, isto envia um email de confirmação à cliente e à Dai, e cria
uma fatura em rascunho. Se o horário estiver ocupado, aparece "Esse horário não está disponível".

---

## Automações (app Atalhos → separador Automação)

### A. Resumo às 7h
- Nova automação → **Hora do dia** → 07:00 → Diariamente → **Executar imediatamente**.
- Ação: **Obter conteúdo do URL** → `.../api/shortcuts/briefing` (GET, cabeçalho) → **Obter valor** `summary` → **Mostrar notificação**.

### B. Fim de sessão (etiqueta NFC)
- Compra uma etiqueta NFC (NTAG213 serve) e cola-a na marquesa ou na porta.
- Nova automação → **NFC** → lê a etiqueta → **Executar imediatamente**.
- Ação: **Obter conteúdo do URL** → `.../api/shortcuts/complete-session` · **POST** · cabeçalho → **Obter valor** `summary` → **Mostrar notificação**.
- Só marca como concluída a sessão de hoje que já começou. Não desconta pacote nem envia a review porque isso já
  acontece sozinho (o pacote é descontado quando a sessão é marcada, e o email de review sai automaticamente
  depois da sessão).

### C. Chegada à clínica
- Nova automação → **Chegada** → escolhe o local da clínica → **Executar imediatamente**.
- Ações: **Executar atalho** "Agenda de hoje" (o atalho 2) e **Definir foco** → Trabalho → Ativar.

---

## Widgets (app Scriptable)

1. Instala a app **Scriptable**.
2. Novo script → cola o conteúdo de `agenda-widget.js` → carrega em ▶ uma vez → cola o token quando pedir.
3. Repete com `packages-widget.js` (usa o mesmo token, já guardado).
4. No ecrã principal: manter premido → **+** → **Scriptable** → tamanho → **Editar widget** → escolhe o script.
5. Para os dois, deixa "When Interacting" em *Run Script* ou *Open URL* (o widget já abre o painel ao tocar).

## O que ainda não existe

- Alertas em tempo real (marcação online ou pagamento Stripe a chegar ao iPhone): precisam de uma conta
  Pushcut ou ntfy e de um webhook novo no painel.
- Link de pagamento com valor à escolha: hoje usa a fatura que já existe. Cria a fatura primeiro no painel.

## Privacidade

Widgets e notificações só mostram **primeiro nome e hora**. Nunca notas clínicas. Cada chamada fica no
Audit Log do painel. Se perderes o iPhone, muda o `SHORTCUTS_TOKEN` na Vercel: o iPhone deixa de ter acesso.
