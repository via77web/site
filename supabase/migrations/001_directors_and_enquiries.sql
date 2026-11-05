-- Directors allowed into the dashboard. Add a row here to give someone access.
create table public.directors (
  email text primary key check (email = lower(email)),
  name text,
  created_at timestamptz not null default now()
);
insert into public.directors (email, name) values
  ('shazil.sohel@gmail.com', 'Shazil'),
  ('shabbirdesigner@gmail.com', 'Shabbir');

create function public.is_director() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.directors d
    where d.email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );
$$;
revoke all on function public.is_director() from public, anon;
grant execute on function public.is_director() to authenticated;

-- Stops anyone else creating an account at the sign-in step.
create function public.block_non_director_signup() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.directors d where d.email = lower(new.email)) then
    raise exception 'This email is not approved for the VIA77 dashboard.';
  end if;
  return new;
end;
$$;
revoke all on function public.block_non_director_signup() from public, anon, authenticated;
create trigger block_non_director_signup before insert on auth.users
  for each row execute function public.block_non_director_signup();

create type public.enquiry_status as enum ('new', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'spam');

create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  type text not null default 'project' check (type in ('project', 'assessment')),
  name text not null,
  email text not null,
  website text,
  message text not null,
  project text,
  budget text,
  timeline text,
  status public.enquiry_status not null default 'new',
  owner_email text references public.directors (email) on update cascade on delete set null,
  email_delivered boolean not null default false
);
create index enquiries_created_at_idx on public.enquiries (created_at desc);
create index enquiries_status_idx on public.enquiries (status);
create index enquiries_owner_email_idx on public.enquiries (owner_email);

create table public.enquiry_notes (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  author_email text not null default lower(auth.jwt() ->> 'email'),
  body text not null check (length(trim(body)) > 0 and length(body) <= 10000),
  created_at timestamptz not null default now()
);
create index enquiry_notes_enquiry_id_idx on public.enquiry_notes (enquiry_id, created_at);

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger enquiries_touch before update on public.enquiries
  for each row execute function public.touch_updated_at();

-- Directors may only change the workflow fields, not what the customer submitted.
revoke all on public.directors, public.enquiries, public.enquiry_notes from anon, authenticated;
grant select on public.directors to authenticated;
grant select on public.enquiries to authenticated;
grant update (status, owner_email) on public.enquiries to authenticated;
grant select, insert on public.enquiry_notes to authenticated;
grant all on public.directors, public.enquiries, public.enquiry_notes to service_role;

alter table public.directors enable row level security;
alter table public.enquiries enable row level security;
alter table public.enquiry_notes enable row level security;

create policy "Directors read directors" on public.directors for select to authenticated using ((select public.is_director()));
create policy "Directors read enquiries" on public.enquiries for select to authenticated using ((select public.is_director()));
create policy "Directors update enquiries" on public.enquiries for update to authenticated using ((select public.is_director())) with check ((select public.is_director()));
create policy "Directors read notes" on public.enquiry_notes for select to authenticated using ((select public.is_director()));
create policy "Directors add own notes" on public.enquiry_notes for insert to authenticated
  with check ((select public.is_director()) and author_email = lower((select auth.jwt()) ->> 'email'));
