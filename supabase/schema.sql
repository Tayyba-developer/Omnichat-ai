-- ============================================================
-- OmniChat AI -- Supabase schema (clean, 4-table core)
-- ------------------------------------------------------------
-- The backend (Express, port 5000) is the source of truth for
-- the dashboard. These 4 core tables are exactly what the API
-- reads/writes. Supporting tables (businesses, agents) exist
-- so the Next.js sign-in -> onboard flow keeps working.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- supporting: business + agent ----------
-- Minimal footprint for the frontend's onboarding + auth flow.
create table if not exists businesses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists agents (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  name        text not null,
  email       text not null,
  role        text not null check (role in ('owner', 'agent')) default 'agent',
  created_at  timestamptz not null default now()
);

-- ============================================================
-- 1. conversations
-- One row per WhatsApp contact (keyed by wa_id). The backend
-- Overview endpoint counts these; the Inbox reads the latest 50.
--   status: 'open' (needs attention), 'waiting' (handed to human),
--           'resolved'/'closed'
-- ============================================================
create table if not exists conversations (
  id            uuid primary key default gen_random_uuid(),
  wa_id         text unique not null,
  name          text not null,
  last_message  text,
  status        text not null default 'open'
                  check (status in ('open', 'needs_human', 'closed')),
  created_at    timestamptz not null default now()
);

-- ============================================================
-- 2. messages
-- Every inbound / outbound message lives here. `timestamp` is the
-- sort key the dashboard uses to order a conversation thread.
--   direction: 'inbound' (customer -> agent) | 'outbound'
--   status:    'received' | 'sent'
-- ============================================================
create table if not exists messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references conversations(id) on delete cascade,
  wa_id               text,
  direction           text not null check (direction in ('inbound', 'outbound')),
  text                text not null,
  timestamp           timestamptz not null default now(),
  provider_message_id text,
  status              text not null default 'received'
                        check (status in ('received', 'sent'))
);

-- ============================================================
-- 3. store_connections
-- Shopify / WooCommerce credentials. One connection per
-- (platform, shop) so the backend can sync without re-auth.
-- ============================================================
create table if not exists store_connections (
  id            uuid primary key default gen_random_uuid(),
  platform      text not null check (platform in ('shopify', 'woocommerce', 'manual')),
  shop          text,
  access_token  text,
  refresh_token text,
  customer_tag  text,
  connected_at  timestamptz not null default now(),
  unique (platform, shop)
);

-- ============================================================
-- 4. orders
-- Orders created from chat or synced from a store.
--   status: 'pending' (awaiting payment) | 'paid' | 'abandoned'
-- ============================================================
create table if not exists orders (
  id                uuid primary key default gen_random_uuid(),
  display_id        text,
  platform_order_id text,
  customer_wa_id    text,
  customer_name     text,
  total_cents       integer not null default 0,
  currency          text not null default 'USD',
  status            text not null check (status in ('pending', 'paid', 'abandoned')) default 'pending',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------- indexes ----------
create index if not exists idx_messages_conversation on messages(conversation_id);
create index if not exists idx_messages_timestamp    on messages(timestamp);
create index if not exists idx_conversations_status  on conversations(status);
create index if not exists idx_conversations_created on conversations(created_at desc);
create index if not exists idx_orders_status         on orders(status);
create index if not exists idx_orders_wa             on orders(customer_wa_id);
-- ============================================================
-- Row Level Security
-- ------------------------------------------------------------
-- The backend uses the service-role key (bypasses RLS), so core
-- tables stay flat. RLS is scoped to the supporting businesses /
-- agents tables so the frontend onboarding + auth flow works.
-- ============================================================
alter table businesses enable row level security;
alter table agents enable row level security;

create or replace function current_business_id() returns uuid as $$
  select business_id from agents where user_id = auth.uid() limit 1;
$$ language sql stable security definer set search_path = public;

-- Self-provision: a signed-in user creates their OWN agent + business row.
create policy "self-provision own agent row" on agents for insert
  with check (user_id = auth.uid());
create policy "read team" on agents for select
  using (business_id = current_business_id());
create policy "update team" on agents for update
  using (business_id = current_business_id());
create policy "remove team" on agents for delete
  using (business_id = current_business_id());

create policy "read own business" on businesses for select
  using (id = current_business_id());
create policy "create business" on businesses for insert
  with check (true);

-- ============================================================
-- Onboarding helper
-- Wraps (business insert + agent insert) in one SECURITY DEFINER
-- function so the frontend's "403 loading businesses"
-- chicken-and-egg is avoided: RLS would otherwise filter the
-- INSERT RETURNING of a business before any agent row exists.
-- ============================================================
create or replace function create_business_and_agent(business_name text, agent_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_business_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into businesses (name) values (business_name) returning id into new_business_id;

  insert into agents (business_id, user_id, name, email, role)
  values (new_business_id, auth.uid(), agent_name,
          coalesce(auth.jwt() ->> 'email', ''), 'owner');

  return new_business_id;
end;
$$;

grant execute on function create_business_and_agent(text, text) to authenticated;
grant usage on schema public to anon, authenticated;