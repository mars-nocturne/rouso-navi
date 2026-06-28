-- ============================================================
-- 労組ナビ — Supabase セットアップ用 SQL
-- Supabase ダッシュボード > SQL Editor に貼り付けて一度だけ実行してください。
-- ============================================================

-- 1) 組合（オンライン領域）とメンバーシップ
create table if not exists public.orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  join_code  text unique not null,
  created_at timestamptz default now()
);

create table if not exists public.org_members (
  org_id     uuid references public.orgs(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  role       text default 'member',
  created_at timestamptz default now(),
  primary key (org_id, user_id)
);

-- 2) データ本体（中身は JSON。アプリのオブジェクトをそのまま保存）
create table if not exists public.members (
  id text primary key,
  org_id uuid references public.orgs(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists public.cards (
  id text primary key,
  org_id uuid references public.orgs(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists public.notices (
  id text primary key,
  org_id uuid references public.orgs(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists public.polls (
  id text primary key,
  org_id uuid references public.orgs(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists public.votes (
  poll_id text,
  voter_id uuid references auth.users(id) on delete cascade,
  opt int not null,
  org_id uuid references public.orgs(id) on delete cascade,
  updated_at timestamptz default now(),
  primary key (poll_id, voter_id)
);

-- 3) 「自分がそのorgのメンバーか」を判定するヘルパー
create or replace function public.is_member(o uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.org_members
    where org_id = o and user_id = auth.uid()
  );
$$;

-- 4) 組合の作成／参加（RPC）
create or replace function public.create_org(p_name text)
returns public.orgs language plpgsql security definer as $$
declare o public.orgs;
begin
  insert into public.orgs(name, join_code)
    values (coalesce(nullif(trim(p_name), ''), '労働組合'),
            upper(substr(md5(random()::text), 1, 6)))
    returning * into o;
  insert into public.org_members(org_id, user_id, role)
    values (o.id, auth.uid(), 'admin');
  return o;
end; $$;

create or replace function public.join_org(p_code text)
returns public.orgs language plpgsql security definer as $$
declare o public.orgs;
begin
  select * into o from public.orgs where join_code = upper(trim(p_code));
  if o.id is null then
    raise exception '参加コードが見つかりません';
  end if;
  insert into public.org_members(org_id, user_id)
    values (o.id, auth.uid())
    on conflict do nothing;
  return o;
end; $$;

grant execute on function public.create_org(text) to authenticated, anon;
grant execute on function public.join_org(text)  to authenticated, anon;

-- 5) Row Level Security（自分が所属する組合のデータだけ読み書き可能に）
alter table public.orgs        enable row level security;
alter table public.org_members enable row level security;
alter table public.members     enable row level security;
alter table public.cards       enable row level security;
alter table public.notices     enable row level security;
alter table public.polls       enable row level security;
alter table public.votes       enable row level security;

drop policy if exists "org read" on public.orgs;
create policy "org read" on public.orgs for select
  using (public.is_member(id));

drop policy if exists "member read" on public.org_members;
create policy "member read" on public.org_members for select
  using (user_id = auth.uid() or public.is_member(org_id));

-- members / cards / notices / polls：所属組合のみ全操作可
do $$
declare t text;
begin
  foreach t in array array['members','cards','notices','polls'] loop
    execute format('drop policy if exists "rw %1$s" on public.%1$I;', t);
    execute format(
      'create policy "rw %1$s" on public.%1$I for all
         using (public.is_member(org_id))
         with check (public.is_member(org_id));', t);
  end loop;
end $$;

-- votes：所属組合内で、自分の票だけ作成・更新・削除可（閲覧は組合内全員）
drop policy if exists "vote read" on public.votes;
create policy "vote read" on public.votes for select
  using (public.is_member(org_id));
drop policy if exists "vote write" on public.votes;
create policy "vote write" on public.votes for all
  using (voter_id = auth.uid() and public.is_member(org_id))
  with check (voter_id = auth.uid() and public.is_member(org_id));

-- 6) リアルタイム配信を有効化
alter publication supabase_realtime add table
  public.members, public.cards, public.notices, public.polls, public.votes;

-- ============================================================
-- 実行後、ダッシュボードで以下を有効化してください：
--   Authentication > Providers > Anonymous Sign-ins を ON
-- ============================================================
