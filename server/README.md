# OmniChat AI — Backend

Production-grade Node.js + Express + TypeScript backend that powers the OmniChat
AI dashboard: WhatsApp / Instagram / Messenger + Web Widget conversations, AI
replies via Google Gemini (RAG + tool calling), Stripe checkout, abandoned cart
recovery, and compliance-first campaigns.

```
npm run dev      # starts the backend on http://localhost:4000
```

> Widget demo: http://localhost:4000/widget-demo.html

---

## Requirements

- Node.js >= 18.17 (native `fetch`, `crypto`, streams)
- A Supabase project (tables in `supabase-migration.sql`)
- Optional: Redis 6/7 for the durable BullMQ pipeline

## Quick start

```bash
cd server
npm install
cp .env.example .env      # optional; the server also reuses ../.env.local
npm run dev               # -> http://localhost:4000
```

Open http://localhost:4000/widget-demo.html, click the green bubble, type a
message.

## Project structure

```
server/
├── package.json
├── tsconfig.json              # strict TypeScript
├── .env.example
├── supabase-migration.sql     # schema + RLS (idempotent)
├── public/
│   ├── widget.js              # embeddable green-bubble widget (vanilla JS)
│   └── widget-demo.html       # live test page
└── src/
    ├── index.ts               # http + socket.io + workers + listen
    ├── app.ts                 # helmet, cors, raw webhook bodies, static, errors
    ├── config.ts              # env (.env + ../.env.local) validated with Zod
    ├── lib/                   # supabase, redis, socket, logger, crypto, upload
    ├── middleware/            # protect, rateLimit, validate, errorHandler
    ├── adapters/              # IChannelAdapter + Whats/Insta/Messenger + factory
    ├── services/              # gemini, conversation, channel, cart, order, catalog, campaign, widget
    ├── queues/                # BullMQ (or in-memory fallback)
    ├── controllers/           # thin HTTP handlers
    ├── routes/                # express routers
    └── workers/               # whatsapp / cart / campaign processors
```

## Environment variables

Use **exactly these names** (they match your root `.env.local`). The server
loads `server/.env` first, then falls back to `../.env.local`.

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | server-side only (never in browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | builds RLS-scoped clients |
| `GEMINI_API_KEY` | yes | Google AI Studio key |
| `GEMINI_MODEL` | no | default `gemini-1.5-flash` |
| `WHATSAPP_ACCESS_TOKEN` | yes | Meta Cloud API token |
| `WHATSAPP_PHONE_NUMBER_ID` | yes | WhatsApp sender number |
| `WHATSAPP_VERIFY_TOKEN` | yes | webhook handshake secret |
| `META_APP_SECRET` | yes | verifies `X-Hub-Signature-256` |
| `STRIPE_SECRET_KEY` | yes | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | yes | Stripe webhook signing secret |
| `REDIS_URL` | no | `redis://...`; required for durable queues in prod |
| `REDIS_PREFIX` | no | BullMQ key namespace |
| `PORT` | no | default `4000` |
| `ENCRYPTION_KEY` | no | 64-hex key for AES-256-GCM at rest |
| `CORS_ORIGINS` | no | comma-separated origins |
| `NEXT_PUBLIC_APP_URL` | no | Stripe success/cancel redirect |
| `CAMPAIGN_CRON_SECRET` | no | optional scheduler auth |
| `NODE_ENV` | no | `development` / `production` |

## Database migration

The migration is idempotent — safe to re-run on top of your current schema. It
creates any missing tables (`channel_connections`, `conversations`, `messages`,
`carts`, `orders`, `campaigns`, `campaign_recipients`, `message_templates`,
`opt_ins`, `agent_settings`, `widget_config`, `compliance_checks`), adds `'web'`
to the channel enum, adds `orders.stripe_session_id`, and applies **RLS policies
scoped by `current_business_id()`** for multi-tenancy.

Paste `server/supabase-migration.sql` into the Supabase **SQL Editor** and run it.
Then seed a widget for your business:

```sql
INSERT INTO widget_config (business_id, widget_id)
VALUES ('<your-business-uuid>', 'biz_margaret_7fz');
```

## Running the server & workers

```bash
npm run dev          # server + in-process workers (single command local dev)
npm run workers      # workers as a standalone process (production)
npm run build        # compile to dist/
npm start            # run dist/index.js
```

## API reference

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/webhooks/whatsapp` | provider | WhatsApp handshake |
| POST | `/api/webhooks/whatsapp` | provider | WhatsApp inbound → enqueue |
| GET | `/api/webhooks/instagram` | provider | Instagram handshake |
| POST | `/api/webhooks/instagram` | provider | Instagram inbound → enqueue |
| GET | `/api/webhooks/messenger` | provider | Messenger handshake |
| POST | `/api/webhooks/messenger` | provider | Messenger inbound → enqueue |
| POST | `/api/webhooks/stripe` | provider | Stripe event (signed) |
| POST | `/api/catalog/upload-csv` | Bearer | multipart CSV product import |
| POST | `/api/orders/create-checkout-link` | Bearer | Stripe checkout link |
| POST | `/api/campaigns/send` | Bearer | enqueue a campaign |
| POST | `/api/widget/:widgetId/message` | public | widget chat (AI reply) |
| GET | `/api/health` | – | liveness probe |
| GET | `/widget.js` | – | widget script |
| GET | `/widget-demo.html` | – | demo page |

Auth is **Supabase**: send `Authorization: Bearer <access_token>`. The
`protect` middleware calls `supabase.auth.getUser(token)` and resolves the
tenant `business_id` from the caller's user/agent relationship — no custom JWT.

## How the pieces fit

1. **Webhook → BullMQ**: Meta/Stripe webhooks validate (signature / verify
   token) and enqueue, answering `202` immediately — no inline processing.
2. **Worker → AI**: the inbound worker parses via the channel adapter, resolves
   the business, persists the conversation/message, calls Gemini (RAG over
   `products` + tool calling), saves the reply, and sends it back through the
   adapter.
3. **Tools**: Gemini can call `search_product`, `add_to_cart` (which schedules
   the 30-min abandonment delay), and `create_stripe_checkout_link`.
4. **Real-time**: Socket.io emits `message:new`, `conversation:updated`, and
   `order:updated` to the `business:<id>` room your dashboard joins.
5. **Campaigns**: only `opted_in` recipients are contacted (24h-window aware);
   every recipient gets a `campaign_recipients` status row.

## Local demo without Redis

If `REDIS_URL` is empty the backend boots with an **in-memory queue fallback**
that keeps the exact BullMQ `enqueue` interface. Webhooks still "validate then
enqueue" and the worker processes asynchronously — but jobs are **not durable /
retry-safe**. Set `REDIS_URL` for production.

## Production notes

- Set `REDIS_URL` and run `npm run workers` as a separate, horizontally scaled
  process.
- Set `ENCRYPTION_KEY` to a random 64-hex value so stored channel access tokens
  are AES-256-GCM encrypted with a real key (not derived from `META_APP_SECRET`).
- Keep the service-role key server-side only.
- Put the server behind HTTPS (webhooks and widget both require it in prod).
- For multi-instance rate limiting, point `express-rate-limit` at the Redis
  store.