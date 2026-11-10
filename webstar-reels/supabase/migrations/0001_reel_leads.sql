-- Reel funnel: views -> clicks -> enquiries -> deposits, per reel.
-- Apply with `supabase db push`, or paste into the Supabase SQL editor.

create table if not exists public.reels (
  id text primary key,                 -- e.g. webstar-2026-11-12-crumb-co--detail
  brand text not null,
  variant text not null,               -- full, detail, before-after, interaction, transformation, ...
  hook text,
  day date,                            -- local posting date
  scheduled_for timestamptz,
  title text,
  -- Filled in weekly from Buffer's post metrics.
  views bigint,
  watch_seconds numeric,
  shares bigint,
  reactions bigint,
  comments bigint,
  metrics_updated_at timestamptz,
  created_at timestamptz not null default now()
);

-- Every tracked link: one per reel, plus each brand's link-in-bio and comment-to-DM links.
create table if not exists public.tracked_links (
  id text primary key,                 -- a reel id, or <brand>-bio / <brand>-dm
  brand text not null,
  kind text not null check (kind in ('reel', 'bio', 'dm')),
  destination text not null,           -- the brand's site or link-in-bio page
  reel_id text references public.reels (id) on delete set null,
  utm jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  type text not null check (type in ('click', 'enquiry', 'deposit')),
  brand text not null,
  link_id text,                        -- which tracked link it came through
  reel_id text,                        -- null for bio and DM links
  platform text,                       -- instagram, tiktok, youtube, manychat, ...
  utm jsonb not null default '{}'::jsonb,
  email text,
  name text,
  message text,
  amount_cents bigint,
  currency text,
  stripe_session_id text unique,       -- makes Stripe webhook retries harmless
  meta jsonb not null default '{}'::jsonb
);

create index if not exists lead_events_reel on public.lead_events (reel_id, type);
create index if not exists lead_events_brand_time on public.lead_events (brand, created_at desc);

-- One row per reel with its whole funnel.
create or replace view public.reel_funnel
with (security_invoker = true) as
select
  r.id, r.brand, r.day, r.variant, r.hook, r.title,
  r.views, r.watch_seconds, r.shares, r.reactions, r.comments,
  count(e.*) filter (where e.type = 'click') as clicks,
  count(e.*) filter (where e.type = 'enquiry') as enquiries,
  count(e.*) filter (where e.type = 'deposit') as deposits,
  coalesce(sum(e.amount_cents) filter (where e.type = 'deposit'), 0) as deposit_cents
from public.reels r
left join public.lead_events e on e.reel_id = r.id
group by r.id
order by r.day desc nulls last;

-- Locked down: no policies, so only the service role (the edge functions and the reel
-- pipeline) can read or write. Nothing here is readable with the public anon key.
alter table public.reels enable row level security;
alter table public.tracked_links enable row level security;
alter table public.lead_events enable row level security;
