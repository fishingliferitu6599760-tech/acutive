import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoStore } from '../js/store/demo.js';
import { monthSummary, currentStatus } from '../js/calc.js';

const sale = (id, cid) => ({ id, date: '2026-11-01', customer_id: cid, service: '出張施術', amount: 6000, paid: true, paid_date: '2026-11-01', paid_amount: 6000, paid_method: '現金', memo: null });

test('連打（同じIDで同時に複数回保存）しても1件', async () => {
  const s = createDemoStore({ seed: false });
  await s.insert('customers', { id: 'c1', code: 'C0001', name: 'A' });
  await Promise.all([s.insert('sales', sale('x', 'c1')), s.insert('sales', sale('x', 'c1')), s.insert('sales', sale('x', 'c1'))]);
  assert.equal(s.data.sales.length, 1);
});

test('通信失敗時は何も保存されない（再送は同じIDなので1件になる）', async () => {
  const s = createDemoStore({ seed: false, failRate: 1 });
  await assert.rejects(s.insert('sales', sale('y', 'c1')), /通信エラー/);
  assert.equal(s.data.sales.length, 0);
});

test('ガソリン精算の二重化を拒否し、支出取消で未精算に戻る', async () => {
  const s = createDemoStore({ seed: false });
  await s.insert('trips', { id: 't1', date: '2026-11-01', km_total: 50, km_private: 0, km_business: 50, km_per_l: 12.5, yen_per_l: 170, est_cost: 680, expense_id: null });
  await s.settleTrips({ id: 'e1', date: '2026-11-02', amount: 680 }, ['t1']);
  await s.settleTrips({ id: 'e1', date: '2026-11-02', amount: 680 }, ['t1']); // 再送
  assert.equal(s.data.expenses.length, 1);
  await assert.rejects(s.settleTrips({ id: 'e2', date: '2026-11-03', amount: 680 }, ['t1']), /already_settled/);
  assert.equal(s.data.expenses.length, 1);
  await s.update('expenses', 'e1', { voided_at: '2026-11-04T00:00:00Z', void_reason: 'x' });
  assert.equal(s.data.trips[0].expense_id, null);
});

test('バックアップ→別の空ストアへ復元で集計が一致（デモと本番は別ストア）', async () => {
  const src = createDemoStore();
  await src.init();
  const today = new Date().toISOString().slice(0, 10);
  const cs = (d) => { const c = currentStatus(d, today); return { ...c, unsettledTrips: c.unsettledTrips.map((t) => t.id) }; };
  const before = { m: monthSummary(src.data, today.slice(0, 7)), c: cs(src.data) };
  const bk = JSON.parse(JSON.stringify(await src.backup()));
  const dst = createDemoStore({ seed: false });
  const n = await dst.restore(bk);
  assert.ok(n > 5);
  assert.deepEqual(monthSummary(dst.data, today.slice(0, 7)), before.m);
  assert.deepEqual(cs(dst.data), before.c);
  // 2回復元しても増えない
  await dst.restore(bk);
  assert.equal(dst.data.sales.length, src.data.sales.length);
  await assert.rejects(dst.restore({ format: 'other' }), /バックアップファイルではありません/);
  const fresh = createDemoStore({ seed: false });
  assert.equal(fresh.data.sales.length, 0, '別のストアにデータは共有されない');
});

test('取消・修正は変更履歴に残る', async () => {
  const s = createDemoStore({ seed: false });
  await s.insert('customers', { id: 'c1', code: 'C0001', name: 'A' });
  await s.insert('sales', sale('z', 'c1'));
  await s.update('sales', 'z', { amount: 7000 });
  await s.update('sales', 'z', { voided_at: '2026-11-05T00:00:00Z', void_reason: '誤登録' });
  const log = await s.auditLog();
  assert.deepEqual(log.filter((l) => l.row_id === 'z').map((l) => l.action), ['UPDATE', 'UPDATE', 'INSERT']);
  assert.equal(log[0].new_data.void_reason, '誤登録');
  assert.equal(log[1].old_data.amount, 6000);
});
