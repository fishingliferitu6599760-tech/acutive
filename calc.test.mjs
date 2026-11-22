import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthSummary, currentStatus, balanceAsOf, tripCalc, monthlySeries, recentCustomers, nextCustomerCode } from '../js/calc.js';
import { toCSV, safeCell, taxCsvs, planRows } from '../js/csv.js';
import { todayJST, monthRange } from '../js/util.js';

const base = () => ({
  customers: [{ id: 'c1', code: 'C0001', name: '山田', archived: false }, { id: 'c2', code: 'C0002', name: '=HYPERLINK("x")', archived: false }],
  sales: [], expenses: [], trips: [], withdrawals: [],
  fundEntries: [{ id: 'f0', date: '2026-09-30', kind: 'opening', amount: 10000 }],
});
const sale = (id, date, amount, paid = true, paid_date = date) =>
  ({ id, date, customer_id: 'c1', service: '出張施術', amount, paid, paid_date: paid ? paid_date : null, paid_amount: paid ? amount : null, paid_method: paid ? '現金' : null });

test('未入金の売上は残高を増やさず、後日入金した月に入金として計上される', () => {
  const d = base();
  d.sales.push(sale('s1', '2026-10-28', 6000, false));
  let oct = monthSummary(d, '2026-10');
  assert.equal(oct.sales, 6000);
  assert.equal(oct.received, 0);
  assert.equal(oct.balanceEnd, 10000);
  assert.equal(currentStatus(d, '2026-10-31').unpaidTotal, 6000);
  // 11/3に入金
  Object.assign(d.sales[0], { paid: true, paid_date: '2026-11-03', paid_amount: 6000, paid_method: '現金' });
  oct = monthSummary(d, '2026-10');
  const nov = monthSummary(d, '2026-11');
  assert.equal(oct.sales, 6000, '売上は利用月のまま');
  assert.equal(oct.received, 0);
  assert.equal(oct.balanceEnd, 10000, '10月末残高は変わらない');
  assert.equal(nov.sales, 0);
  assert.equal(nov.received, 6000, '入金は入金月');
  assert.equal(nov.balanceEnd, 16000);
  assert.equal(currentStatus(d, '2026-11-30').unpaidTotal, 0);
});

test('残高は月をまたいで累積し、リセットされない', () => {
  const d = base();
  d.sales.push(sale('s1', '2026-10-05', 5000), sale('s2', '2026-11-05', 7000), sale('s3', '2026-12-01', 3000));
  d.expenses.push({ id: 'e1', date: '2026-11-10', amount: 1500, category: '駐車場', source: 'fund' });
  assert.equal(monthSummary(d, '2026-10').balanceEnd, 15000);
  assert.equal(monthSummary(d, '2026-11').balanceStart, 15000);
  assert.equal(monthSummary(d, '2026-11').balanceEnd, 20500);
  assert.equal(monthSummary(d, '2026-12').balanceEnd, 23500);
  const s = monthlySeries(d, '2026-10', '2026-12');
  assert.deepEqual(s.map((m) => m.balanceEnd), [15000, 20500, 23500]);
});

test('個人立替は経費に入るが、精算するまで残高を減らさない', () => {
  const d = base();
  d.expenses.push({ id: 'e1', date: '2026-11-02', amount: 800, category: '消耗品', source: 'personal', settled_date: null });
  let nov = monthSummary(d, '2026-11');
  assert.equal(nov.expenses, 800);
  assert.equal(nov.profit, -800);
  assert.equal(nov.balanceEnd, 10000);
  assert.equal(currentStatus(d, '2026-11-30').personalUnsettled, 800);
  // 12/1 に精算
  d.expenses[0].settled_date = '2026-12-01';
  nov = monthSummary(d, '2026-11');
  const dec = monthSummary(d, '2026-12');
  assert.equal(nov.balanceEnd, 10000);
  assert.equal(dec.expenses, 0, '精算は経費の二重計上にならない');
  assert.equal(dec.reimbursed, 800);
  assert.equal(dec.balanceEnd, 9200);
  assert.equal(currentStatus(d, '2026-12-31').personalUnsettled, 0);
});

test('生活費への取り出しは残高を減らすが経費・利益には含めない', () => {
  const d = base();
  d.sales.push(sale('s1', '2026-11-01', 20000));
  d.withdrawals.push({ id: 'w1', date: '2026-11-20', amount: 15000, purpose: '生活費' });
  const nov = monthSummary(d, '2026-11');
  assert.equal(nov.expenses, 0);
  assert.equal(nov.profit, 20000);
  assert.equal(nov.withdrawals, 15000);
  assert.equal(nov.balanceEnd, 15000);
});

test('開始残高・資金補充は売上に含めない／照合調整は残高だけ動かす', () => {
  const d = base();
  d.fundEntries.push({ id: 'f1', date: '2026-11-01', kind: 'topup', amount: 5000 }, { id: 'f2', date: '2026-11-02', kind: 'adjust', amount: -300, reason: '数え違い' });
  const nov = monthSummary(d, '2026-11');
  assert.equal(nov.sales, 0);
  assert.equal(nov.profit, 0);
  assert.equal(nov.balanceEnd, 14700);
});

test('ガソリン概算は残高を減らさず、精算後は概算を採算から外して二重計上しない', () => {
  const d = base();
  d.sales.push(sale('s1', '2026-11-01', 10000));
  const t = tripCalc({ odo_start: 1000, odo_end: 1060, km_private: 10, km_per_l: 12.5, yen_per_l: 170 });
  assert.deepEqual(t, { km_total: 60, km_private: 10, km_business: 50, est_cost: 680 });
  d.trips.push({ id: 't1', date: '2026-11-01', ...t, expense_id: null });
  let nov = monthSummary(d, '2026-11');
  assert.equal(nov.expenses, 0, '概算は経費（実績）に入らない');
  assert.equal(nov.balanceEnd, 20000, '概算は残高を減らさない');
  assert.equal(nov.estFuelUnsettled, 680);
  assert.equal(nov.profitWithEstimate, 9320, '採算（参考）は概算を差し引く');
  // 副業資金から精算 → 支出(ガソリン)にひも付け
  d.expenses.push({ id: 'e1', date: '2026-11-05', amount: 680, category: 'ガソリン', source: 'fund' });
  d.trips[0].expense_id = 'e1';
  nov = monthSummary(d, '2026-11');
  assert.equal(nov.expenses, 680);
  assert.equal(nov.estFuelUnsettled, 0);
  assert.equal(nov.profitWithEstimate, nov.profit, '精算後は採算と利益が一致＝二重計上なし');
  assert.equal(nov.balanceEnd, 19320);
  assert.equal(nov.warnFuelDouble, false);
});

test('ひも付けのないガソリン支出と未精算の概算が同月にあると警告', () => {
  const d = base();
  d.trips.push({ id: 't1', date: '2026-11-01', km_total: 10, km_private: 0, km_business: 10, km_per_l: 10, yen_per_l: 170, est_cost: 170, expense_id: null });
  d.expenses.push({ id: 'e1', date: '2026-11-05', amount: 3000, category: 'ガソリン', source: 'fund' });
  assert.equal(monthSummary(d, '2026-11').warnFuelDouble, true);
});

test('取消（voided_at）は集計から除外', () => {
  const d = base();
  d.sales.push({ ...sale('s1', '2026-11-01', 5000), voided_at: '2026-11-02T00:00:00Z' });
  assert.equal(monthSummary(d, '2026-11').sales, 0);
  assert.equal(balanceAsOf(d, '2026-11-30'), 10000);
});

test('利用件数と平均売上単価', () => {
  const d = base();
  d.sales.push(sale('s1', '2026-11-01', 5000), sale('s2', '2026-11-02', 6000), sale('s3', '2026-11-03', 6500, false));
  const m = monthSummary(d, '2026-11');
  assert.equal(m.count, 3);
  assert.equal(m.avgPrice, Math.round(17500 / 3));
});

test('CSV：BOM・CRLF・数式インジェクション対策', () => {
  assert.equal(safeCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(safeCell('+81 90'), "'+81 90");
  assert.equal(safeCell('-x'), "'-x");
  assert.equal(safeCell('@cmd'), "'@cmd");
  assert.equal(safeCell(-500), '-500', '数値はそのまま');
  const csv = toCSV([['a', 'b,c', 'd"e'], [1, '=1+1', '改行\nあり']]);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('\r\n'));
  assert.ok(csv.includes('"b,c"'));
  assert.ok(csv.includes('"d""e"'));
  assert.ok(csv.includes("'=1+1"));
});

test('出力CSVの数字が画面の集計と一致し、顧客名を含まない', () => {
  const d = base();
  d.sales.push({ ...sale('s1', '2026-11-01', 5000), customer_id: 'c2' }, sale('s2', '2026-11-02', 6000, false));
  d.expenses.push({ id: 'e1', date: '2026-11-03', amount: 500, category: '駐車場', source: 'fund' });
  const csvs = taxCsvs(d, '2026-11-01', '2026-11-30');
  const m = monthSummary(d, '2026-11');
  const kv = Object.fromEntries(csvs['区分別集計'].slice(1));
  assert.equal(kv['売上（利用日基準）'], m.sales);
  assert.equal(kv['経費合計（支出日基準）'], m.expenses);
  assert.equal(kv['期末の副業資金残高'], m.balanceEnd);
  const all = Object.values(csvs).flat(2).join('|');
  assert.ok(!all.includes('山田') && !all.includes('HYPERLINK'), '顧客名は出力しない');
  assert.equal(csvs['未入金一覧'].length - 1, 1);
  const plan = planRows(d, '2026-11', '2026-11');
  assert.deepEqual(plan[1], ['2026-11', m.sales, m.received, m.expenses, m.profit, m.withdrawals, m.balanceEnd, m.count, m.avgPrice]);
});

test('補助関数', () => {
  assert.equal(todayJST(new Date('2026-11-21T15:30:00Z')), '2026-11-22', 'UTC15時半は日本時間で翌日');
  assert.deepEqual(monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.equal(nextCustomerCode([{ code: 'C0009' }, { code: 'C0002' }]), 'C0010');
  const d = base();
  d.sales.push({ ...sale('s1', '2026-11-01', 1), customer_id: 'c2' }, sale('s2', '2026-11-02', 1));
  assert.deepEqual(recentCustomers(d).map((c) => c.id), ['c1', 'c2']);
});
