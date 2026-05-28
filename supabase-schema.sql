create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'staff',
  permissions jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.diamonds (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  shape text not null,
  carat numeric not null,
  color text not null,
  clarity text not null,
  price numeric not null,
  status text not null default 'Added',
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text default '',
  phone text default '',
  email text default '',
  address text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  memo_number text not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  diamond_ids uuid[] not null default '{}',
  total_amount numeric not null default 0,
  from_date date not null,
  to_date date not null,
  status text not null default 'Open',
  notes text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  diamond_ids uuid[] not null default '{}',
  memo_id uuid references public.memos(id) on delete set null,
  total_amount numeric not null default 0,
  status text not null default 'Draft',
  notes text default '',
  created_at timestamptz not null default now()
);
