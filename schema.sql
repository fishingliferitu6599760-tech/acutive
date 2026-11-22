-- =============================================================
-- Acutive｜顧客・売上・出金管理アプリ  データベース定義（初版 v1）
-- Supabase の SQL Editor に貼り付けて一度だけ実行してください。
--
-- 方針
--  * すべての表で Row Level Security（RLS）を有効化し、
--    「ログイン中の本人（auth.uid()）の行だけ」読み書きできる。
--  * 物理削除は禁止（DELETE権限なし）。取消は voided_at を入れる。
--  * 主キー(id)はアプリ側で発行するUUID。再送しても同じidなので二重登録にならない。
--  * 重要な変更は audit_log に自動記録（本人は閲覧のみ、改ざん不可）。
-- =============================================================

-- ---------- 共通：updated_at 自動更新 ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- 設定（1ユーザー1行） ----------
create table if not exists public.settings (
  user_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  fuel_km_per_l  numeric(6,2) not null default 12 check (fuel_km_per_l > 0),
  fuel_yen_per_l integer      not null default 170 check (fuel_yen_per_l >= 0),
  service_types  text[]       not null default array['出張施術','鍼灸','その他'],
  default_service text        not null default '出張施術',
  pay_methods    text[]       not null default array['現金','振込','QR決済','その他'],
  updated_at     timestamptz  not null default now()
);

-- ---------- 顧客 ----------
create table if not exists public.customers (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code       text not null,                       -- 表示用の顧客ID（例 C0001）
  name       text not null check (length(name) between 1 and 100),
  kana       text,
  contact    text,
  archived   boolean not null default false,      -- 非表示・利用停止（履歴は残る）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, code),
  unique (user_id, id)
);

-- ---------- 売上・入金（＝顧客の利用履歴。二重保存しない） ----------
create table if not exists public.sales (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,                      -- 利用日
  customer_id uuid not null,
  service     text not null,                      -- 仕事の種類
  amount      integer not null check (amount >= 0),
  paid        boolean not null default true,
  paid_date   date,
  paid_amount integer check (paid_amount >= 0),
  paid_method text,
  memo        text,
  voided_at   timestamptz,
  void_reason text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- 顧客は必ず本人の顧客（他人の顧客IDは参照できない）
  foreign key (user_id, customer_id) references public.customers (user_id, id),
  check ( (paid and paid_date is not null and paid_amount is not null)
       or (not paid and paid_date is null and paid_amount is null) )
);
create index if not exists sales_user_date on public.sales (user_id, date);

-- ---------- 支出 ----------
create table if not exists public.expenses (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date         date not null,
  amount       integer not null check (amount >= 0),
  category     text not null check (category in ('駐車場','高速道路','ガソリン','道具・備品','消耗品','その他')),
  source       text not null check (source in ('fund','personal')),  -- 副業資金／個人立替
  payee        text,
  memo         text,
  settled_date date,                               -- 個人立替を副業資金から精算した日
  voided_at    timestamptz,
  void_reason  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, id),
  check (source = 'personal' or settled_date is null)
);
create index if not exists expenses_user_date on public.expenses (user_id, date);

-- ---------- 移動（ガソリン概算） ----------
create table if not exists public.trips (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  odo_start   numeric(9,1),
  odo_end     numeric(9,1),
  km_total    numeric(7,1) not null check (km_total >= 0),
  km_private  numeric(7,1) not null default 0 check (km_private >= 0),
  km_business numeric(7,1) not null check (km_business >= 0),
  km_per_l    numeric(6,2) not null check (km_per_l > 0),   -- 登録時点の燃費
  yen_per_l   integer not null check (yen_per_l >= 0),      -- 登録時点の単価
  est_cost    integer not null check (est_cost >= 0),       -- 概算（参考値）
  expense_id  uuid,                                         -- 精算した支出（ひも付け）
  memo        text,
  voided_at   timestamptz,
  void_reason text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (user_id, expense_id) references public.expenses (user_id, id),
  check (km_private <= km_total),
  check (km_business = km_total - km_private)
);

-- ---------- 生活費などへの取り出し ----------
create table if not exists public.withdrawals (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  amount      integer not null check (amount > 0),
  purpose     text,
  voided_at   timestamptz,
  void_reason text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- 開始残高・資金補充・照合調整 ----------
create table if not exists public.fund_entries (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  kind        text not null check (kind in ('opening','topup','adjust')),
  amount      integer not null,                    -- adjust のみ負数可
  reason      text,
  voided_at   timestamptz,
  void_reason text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (kind = 'adjust' or amount >= 0),
  check (kind <> 'adjust' or (reason is not null and length(reason) > 0))
);

-- ---------- 変更履歴 ----------
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  table_name text not null,
  row_id     text not null,
  action     text not null,
  old_data   jsonb,
  new_data   jsonb,
  at         timestamptz not null default now()
);
create index if not exists audit_user_at on public.audit_log (user_id, at desc);

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  insert into public.audit_log (user_id, table_name, row_id, action, old_data, new_data)
  values (coalesce((n->>'user_id')::uuid, (o->>'user_id')::uuid),
          tg_table_name,
          coalesce(n->>'id', o->>'id', n->>'user_id', o->>'user_id'),
          tg_op, o, n);
  return null;
end $$;
revoke all on function public.audit_row() from public;

-- ---------- 支出を取り消したら、ひも付いた移動を「未精算」に戻す ----------
create or replace function public.unlink_trips_on_expense_void() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.voided_at is not null and old.voided_at is null then
    update public.trips set expense_id = null
     where expense_id = new.id and user_id = new.user_id;
  end if;
  return new;
end $$;

-- ---------- ガソリン精算（支出の登録と移動のひも付けを1トランザクションで） ----------
create or replace function public.settle_trips(p_expense jsonb, p_trip_ids uuid[])
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := (p_expense->>'id')::uuid;
begin
  if v_id is null then raise exception 'expense id required'; end if;

  insert into public.expenses (id, date, amount, category, source, payee, memo, settled_date)
  values (v_id,
          (p_expense->>'date')::date,
          (p_expense->>'amount')::integer,
          'ガソリン',
          coalesce(p_expense->>'source', 'fund'),
          nullif(p_expense->>'payee', ''),
          nullif(p_expense->>'memo', ''),
          nullif(p_expense->>'settled_date', '')::date)
  on conflict (id) do nothing;                      -- 再送しても1件のまま

  if not exists (select 1 from public.expenses
                  where id = v_id and category = 'ガソリン' and voided_at is null) then
    raise exception 'expense not usable for fuel settlement';
  end if;

  -- 既に別の支出で精算済みの移動が含まれていたら全体を中止（二重計上防止）
  if exists (select 1 from public.trips
              where id = any(p_trip_ids) and expense_id is not null and expense_id <> v_id) then
    raise exception 'already_settled';
  end if;

  update public.trips set expense_id = v_id
   where id = any(p_trip_ids) and expense_id is null and voided_at is null;
  return v_id;
end $$;

-- ---------- トリガー設定 ----------
do $$
declare t text;
begin
  foreach t in array array['settings','customers','sales','expenses','trips','withdrawals','fund_entries'] loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before update on public.%I for each row execute function public.touch_updated_at()', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

drop trigger if exists trg_unlink_trips on public.expenses;
create trigger trg_unlink_trips after update of voided_at on public.expenses
  for each row execute function public.unlink_trips_on_expense_void();

-- ---------- 権限と RLS ----------
do $$
declare t text;
begin
  foreach t in array array['settings','customers','sales','expenses','trips','withdrawals','fund_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);   -- DELETEは付与しない
    execute format('drop policy if exists own_select on public.%I', t);
    execute format('drop policy if exists own_insert on public.%I', t);
    execute format('drop policy if exists own_update on public.%I', t);
    execute format('create policy own_select on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy own_insert on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy own_update on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
drop policy if exists own_select on public.audit_log;
create policy own_select on public.audit_log for select to authenticated using (user_id = (select auth.uid()));

revoke all on function public.settle_trips(jsonb, uuid[]) from public, anon;
grant execute on function public.settle_trips(jsonb, uuid[]) to authenticated;
