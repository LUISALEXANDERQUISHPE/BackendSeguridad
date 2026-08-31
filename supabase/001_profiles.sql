create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.-]{3,32}$'),
  email text not null unique,
  full_name text not null default '',
  avatar_url text,
  plan text not null default 'free' check (plan in ('free', 'premium')),
  default_compiler text not null default 'pdfLaTeX',
  preferred_language text not null default 'es',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
update public.profiles p set email = u.email
from auth.users u where u.id = p.id and p.email is null;
alter table public.profiles alter column email set not null;
create unique index if not exists profiles_email_unique_idx on public.profiles (email);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, email, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles for select
to authenticated using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles for update
to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create index if not exists profiles_username_idx on public.profiles (username);

create index if not exists profiles_email_idx on public.profiles (email);
