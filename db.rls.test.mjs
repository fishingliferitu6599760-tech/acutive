// Supabase と同じ仕組み（auth.uid() と anon/authenticated ロール）を PGlite 上に再現し、
// schema.sql のアクセス制御・二重登録防止・ガソリン精算を検証する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const SHIM = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
insert into auth.users values ('${A}'), ('${B}');
`;

const db = new PGlite();
await db.exec(SHIM);
await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));

async function as(user, sql, params) {
  await db.exec('reset role');
  if (user === 'anon') {
    await db.exec(`set role anon; select set_config('request.jwt.claims', '', false);`);
  } else {
    await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${user}"}', false);`);
  }
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}

test('本人は自分の顧客・売上を登録できる', async () => {
  await as(A, `insert into customers (id, code, name) values ($1, 'C0001', '山田')`, [uuid(1)]);
  await as(A, `insert into sales (id, date, customer_id, service, amount, paid, paid_date, paid_amount, paid_method)
               values ($1, '2026-10-30', $2, '出張施術', 6000, false, null, null, null)`, [uuid(10), uuid(1)]);
  const r = await as(A, 'select count(*)::int n from sales');
  assert.equal(r.rows[0].n, 1);
});

test('同じ取引IDで再送しても1件のまま（二重登録防止）', async () => {
  for (let i = 0; i < 3; i++) {
    await as(A, `insert into sales (id, date, customer_id, service, amount, paid, paid_date, paid_amount, paid_method)
                 values ($1, '2026-11-01', $2, '出張施術', 5000, true, '2026-11-01', 5000, '現金')
                 on conflict (id) do nothing`, [uuid(11), uuid(1)]);
  }
  const r = await as(A, 'select count(*)::int n from sales where id = $1', [uuid(11)]);
  assert.equal(r.rows[0].n, 1);
});

test('他人（B）はAのデータを読めない・変更できない', async () => {
  const r = await as(B, 'select count(*)::int n from sales');
  assert.equal(r.rows[0].n, 0);
  const c = await as(B, 'select count(*)::int n from customers');
  assert.equal(c.rows[0].n, 0);
  const u = await as(B, `update sales set amount = 1 where id = $1`, [uuid(10)]);
  assert.equal(u.affectedRows, 0);
  const still = await as(A, 'select amount from sales where id = $1', [uuid(10)]);
  assert.equal(still.rows[0].amount, 6000);
});

test('BがAのuser_idを名乗って登録しようとすると拒否', async () => {
  await assert.rejects(as(B, `insert into customers (id, user_id, code, name) values ($1, $2, 'C9', 'x')`, [uuid(2), A]),
    /row-level security/);
});

test('BがAの顧客IDを参照した売上は作れない', async () => {
  await as(B, `insert into customers (id, code, name) values ($1, 'C0001', '鈴木')`, [uuid(3)]);
  await assert.rejects(as(B, `insert into sales (id, date, customer_id, service, amount, paid) values ($1,'2026-11-01',$2,'x',1,false)`, [uuid(12), uuid(1)]),
    /foreign key/);
});

test('未ログイン（anon）は何も読めない', async () => {
  await assert.rejects(as('anon', 'select * from sales'), /permission denied/);
  await assert.rejects(as('anon', 'select * from customers'), /permission denied/);
  await assert.rejects(as('anon', 'select * from audit_log'), /permission denied/);
});

test('削除は誰もできない（取消は voided_at）', async () => {
  await assert.rejects(as(A, 'delete from sales where id = $1', [uuid(10)]), /permission denied/);
});

test('入金状況の矛盾（入金済みなのに入金日なし）は保存できない', async () => {
  await assert.rejects(as(A, `insert into sales (id, date, customer_id, service, amount, paid) values ($1,'2026-11-01',$2,'x',1,true)`, [uuid(13), uuid(1)]),
    /check constraint/);
});

test('後日入金・修正・取消が変更履歴に残り、本人だけが見られる', async () => {
  await as(A, `update sales set paid = true, paid_date = '2026-11-05', paid_amount = 6000, paid_method = '現金' where id = $1`, [uuid(10)]);
  await as(A, `update sales set voided_at = now(), void_reason = 'テスト' where id = $1`, [uuid(11)]);
  const logs = await as(A, `select action, table_name from audit_log where row_id = $1 order by id`, [uuid(11)]);
  assert.deepEqual(logs.rows.map((r) => r.action), ['INSERT', 'UPDATE']);
  const bLogs = await as(B, `select count(*)::int n from audit_log where user_id = $1`, [A]);
  assert.equal(bLogs.rows[0].n, 0);
  await assert.rejects(as(A, `delete from audit_log`), /permission denied/);
  await assert.rejects(as(A, `update audit_log set action = 'x'`), /permission denied/);
});

test('ガソリン精算：ひも付け済みの移動は別の支出で二重に精算できない', async () => {
  const trip = (id) => as(A, `insert into trips (id, date, km_total, km_private, km_business, km_per_l, yen_per_l, est_cost)
                              values ($1, '2026-11-02', 60, 10, 50, 12.5, 170, 680)`, [id]);
  await trip(uuid(20)); await trip(uuid(21));
  const exp1 = JSON.stringify({ id: uuid(30), date: '2026-11-03', amount: 1360, source: 'fund' });
  await as(A, `select settle_trips($1::jsonb, $2::uuid[])`, [exp1, [uuid(20), uuid(21)]]);
  // 再送しても支出は1件
  await as(A, `select settle_trips($1::jsonb, $2::uuid[])`, [exp1, [uuid(20), uuid(21)]]);
  const n = await as(A, `select count(*)::int n from expenses where id = $1`, [uuid(30)]);
  assert.equal(n.rows[0].n, 1);
  // 別の支出で同じ移動を精算しようとすると全体が中止される
  const exp2 = JSON.stringify({ id: uuid(31), date: '2026-11-04', amount: 680, source: 'fund' });
  await assert.rejects(as(A, `select settle_trips($1::jsonb, $2::uuid[])`, [exp2, [uuid(20)]]), /already_settled/);
  const n2 = await as(A, `select count(*)::int n from expenses where id = $1`, [uuid(31)]);
  assert.equal(n2.rows[0].n, 0, '中止時は支出も作られない');
  // 支出を取り消すと移動は未精算に戻る
  await as(A, `update expenses set voided_at = now(), void_reason = '誤り' where id = $1`, [uuid(30)]);
  const t = await as(A, `select count(*)::int n from trips where expense_id is null`);
  assert.equal(t.rows[0].n, 2);
});

test('Bは他人の移動を精算できない', async () => {
  const exp = JSON.stringify({ id: uuid(40), date: '2026-11-04', amount: 1, source: 'fund' });
  await as(B, `select settle_trips($1::jsonb, $2::uuid[])`, [exp, [uuid(20)]]);
  const t = await as(A, `select expense_id from trips where id = $1`, [uuid(20)]);
  assert.equal(t.rows[0].expense_id, null);
});

test('照合調整は理由が必須', async () => {
  await assert.rejects(as(A, `insert into fund_entries (id, date, kind, amount) values ($1,'2026-11-01','adjust',-500)`, [uuid(50)]),
    /check constraint/);
  await as(A, `insert into fund_entries (id, date, kind, amount, reason) values ($1,'2026-11-01','adjust',-500,'釣り銭の数え違い')`, [uuid(50)]);
});
