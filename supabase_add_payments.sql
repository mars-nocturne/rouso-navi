-- ============================================================
-- 労組結成ナビ — 組合費（納付管理）機能の追加SQL
-- すでに supabase_setup.sql を実行済みのプロジェクト向け。
-- Supabase ダッシュボード > SQL Editor に貼り付けて一度だけ実行してください。
-- （新規セットアップの場合は supabase_setup.sql だけでOK。このファイルは不要）
-- ============================================================

create table if not exists public.payments (
  id text primary key,
  org_id uuid references public.orgs(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz default now()
);

alter table public.payments enable row level security;

drop policy if exists "rw payments" on public.payments;
create policy "rw payments" on public.payments for all
  using (public.is_member(org_id))
  with check (public.is_member(org_id));

alter publication supabase_realtime add table public.payments;
