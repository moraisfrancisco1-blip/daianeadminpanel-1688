# Stripe Integration - Admin Panel

## Overview

Esta integração sincroniza bidirecionalmente **clientes** e **faturas (invoices)** entre o Admin Panel e o Stripe:

### Clientes
- **Admin Panel → Stripe**: Quando um cliente é criado/atualizado/excluído no admin panel, ele é automaticamente sincronizado com o Stripe
- **Stripe → Admin Panel**: Quando um cliente é criado/atualizado/excluído no Stripe, ele é automaticamente sincronizado com o admin panel via webhooks

### Faturas (Invoices)
- **Admin Panel → Stripe**: Quando uma fatura é criada/enviada/cancelada/excluída no admin panel, ela é automaticamente sincronizada com o Stripe
- **Stripe → Admin Panel**: Quando uma fatura é paga/atualizada no Stripe, o status é automaticamente sincronizado com o admin panel via webhooks

## Configuration

### 1. Adicione suas chaves do Stripe no `.env`:

```env
STRIPE_SECRET_KEY=sk_test_...  # ou sk_live_... para produção
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 2. Configure o Webhook no Stripe Dashboard

1. Acesse [Stripe Dashboard](https://dashboard.stripe.com/) → Developers → Webhooks
2. Clique em "Add endpoint"
3. Insira a URL do webhook:
   - **Local**: `http://localhost:3000/api/stripe-webhook` (ou a URL do seu servidor local)
   - **Produção**: `https://admin.studiodaioakes.com/api/stripe-webhook`
4. Selecione os eventos para ouvir:
   - **Customer events**:
     - `customer.created`
     - `customer.updated`
     - `customer.deleted`
   - **Invoice events**:
     - `invoice.created`
     - `invoice.updated`
     - `invoice.finalized`
     - `invoice.paid`
     - `invoice.payment_failed`
     - `invoice.voided`
     - `invoice.deleted`
5. Clique em "Add endpoint"
6. Copie o "Signing secret" (começa com `whsec_...`) e cole no `.env` como `STRIPE_WEBHOOK_SECRET`

### 3. Para desenvolvimento local (testar webhooks)

Use o Stripe CLI para encaminhar eventos para seu servidor local:

```bash
# Instale o Stripe CLI: https://stripe.com/docs/stripe-cli
stripe login

# Encaminhe eventos para o servidor local
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

O Stripe CLI imprimirá um "webhook signing secret" (começa com `whsec_...`). Use este valor no seu `.env`.

## Database Schema

### Tabela `clients`
```sql
ALTER TABLE clients ADD COLUMN stripe_customer_id TEXT UNIQUE;
```

### Tabela `invoices`
```sql
ALTER TABLE invoices ADD COLUMN stripe_invoice_id TEXT UNIQUE;
ALTER TABLE invoices ADD COLUMN stripe_payment_intent_id TEXT UNIQUE;
```

## How it works

### Clientes

#### Admin Panel → Stripe

1. **Criar cliente**: Quando um cliente é criado via `POST /api/clients`, o sistema:
   - Cria o cliente no Stripe (se Stripe estiver configurado)
   - Salva o `stripeCustomerId` retornado pelo Stripe no banco de dados local

2. **Atualizar cliente**: Quando um cliente é atualizado via `PUT /api/clients/:id`, o sistema:
   - Atualiza o cliente correspondente no Stripe (se tiver `stripeCustomerId`)
   - Atualiza o banco de dados local

3. **Excluir cliente**: Quando um cliente é excluído via `DELETE /api/clients/:id`, o sistema:
   - Exclui o cliente correspondente no Stripe (se tiver `stripeCustomerId`)
   - Exclui o registro do banco de dados local

#### Stripe → Admin Panel

1. **Webhook `customer.created`**: Quando um cliente é criado no Stripe:
   - O webhook é recebido em `POST /api/stripe-webhook`
   - O cliente é criado/atualizado no banco de dados local com o `stripeCustomerId`

2. **Webhook `customer.updated`**: Quando um cliente é atualizado no Stripe:
   - O webhook é recebido e o cliente correspondente é atualizado no banco de dados local

3. **Webhook `customer.deleted`**: Quando um cliente é excluído no Stripe:
   - O webhook é recebido e o `stripeCustomerId` é removido do cliente local (o cliente não é excluído)

### Faturas (Invoices)

#### Admin Panel → Stripe

1. **Criar fatura**: Quando uma fatura é criada via `POST /api/invoices`, o sistema:
   - Verifica se o cliente tem `stripeCustomerId`
   - Cria a fatura no Stripe (como draft)
   - Salva o `stripeInvoiceId` e `stripePaymentIntentId` no banco de dados local

2. **Enviar fatura**: Quando uma fatura é enviada via `POST /api/invoices/:id/send`, o sistema:
   - Finaliza a fatura no Stripe (`finalizeInvoice`)
   - Envia o email para o cliente
   - Atualiza o status local para "sent"

3. **Cancelar fatura**: Quando uma fatura é cancelada via `PUT /api/invoices/:id/status`, o sistema:
   - Anula a fatura no Stripe (`voidInvoice`)
   - Atualiza o status local para "cancelled"

4. **Excluir fatura**: Quando uma fatura é excluída via `DELETE /api/invoices/:id`, o sistema:
   - Exclui a fatura do Stripe (se ainda estiver como draft)
   - Exclui o registro do banco de dados local

#### Stripe → Admin Panel

1. **Webhook `invoice.paid`**: Quando uma fatura é paga no Stripe:
   - O webhook é recebido e o status é atualizado para "paid" no banco de dados local
   - O campo `paidAt` é preenchido com a data de pagamento

2. **Webhook `invoice.updated`**: Quando uma fatura é atualizada no Stripe:
   - O webhook é recebido e o status é sincronizado com o banco de dados local

3. **Webhook `invoice.finalized`**: Quando uma fatura é finalizada no Stripe:
   - O webhook é recebido e o status é atualizado para "sent" no banco de dados local

4. **Webhook `invoice.voided`**: Quando uma fatura é anulada no Stripe:
   - O webhook é recebido e o status é atualizado para "cancelled" no banco de dados local

5. **Webhook `invoice.deleted`**: Quando uma fatura é excluída no Stripe:
   - O webhook é recebido e os campos `stripeInvoiceId` e `stripePaymentIntentId` são removidos do registro local

## Testing

1. Configure as variáveis de ambiente conforme instruções acima
2. Inicie o servidor de desenvolvimento:
   ```bash
   cd packages/web
   bun run dev
   ```
3. **Testar clientes**:
   - Crie um cliente no admin panel e verifique se ele aparece no Stripe Dashboard
   - Crie um cliente no Stripe Dashboard e verifique se ele aparece no admin panel (após receber o webhook)
4. **Testar faturas**:
   - Crie uma fatura no admin panel para um cliente com `stripeCustomerId`
   - Verifique se a fatura aparece no Stripe Dashboard
   - Envie a fatura e verifique se ela é finalizada no Stripe
   - Pague a fatura no Stripe e verifique se o status é atualizado no admin panel

## Notes

- Se o Stripe não estiver configurado (`STRIPE_SECRET_KEY` vazio), o sistema funciona normalmente sem sincronização
- O webhook não requer autenticação (é acessado publicamente pelo Stripe)
- O `stripeCustomerId` é único por cliente, garantindo que não haja duplicações
- O `stripeInvoiceId` é único por fatura, garantindo que não haja duplicações
- Faturas só são sincronizadas com o Stripe se o cliente associado tiver um `stripeCustomerId`
- A moeda padrão para faturas no Stripe é EUR (euros)
- Os valores são convertidos para centavos automaticamente antes de enviar ao Stripe