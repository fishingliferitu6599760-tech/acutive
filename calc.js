// 集計ロジック（純粋関数）。画面・CSV・印刷はすべてここを通すので、数字が一致する。
//
// ■ 集計基準（画面とドキュメントに明示）
//  売上      : 利用日基準（取消を除く）。未入金も含む。
//  入金額    : 入金日基準。過去月の売上が後から入金されても、入金した月に計上。
//  経費      : 支出日基準（副業資金払い・個人立替の両方。立替は精算前でも経費に含む）。
//              ガソリンの概算（移動記録）は含まない。
//  管理上の利益 = 売上 − 経費
//  取り出し  : 生活費などへの取り出し。経費にも利益にも含めない。
//  副業資金残高（現金ベース・累積。月でリセットしない）
//      = 開始残高 + 資金補充 ± 照合調整 + 入金額 − 副業資金で払った支出
//        − 個人立替の精算額（精算日） − 取り出し
//      ※ 未入金の売上は増やさない／個人立替は精算するまで減らさない／概算は減らさない
//  採算（参考）= 管理上の利益 − 未精算のガソリン概算

import { monthEnd, monthRange } from './util.js';

export const EXPENSE_CATEGORIES = ['駐車場', '高速道路', 'ガソリン', '道具・備品', '消耗品', 'その他'];

export const live = (arr) => (arr || []).filter((r) => !r.voided_at);
const sum = (arr, f) => arr.reduce((s, r) => s + (Number(f(r)) || 0), 0);
const inRange = (d, from, to) => d && d >= from && d <= to;

/** 副業資金の現金の動き（符号付き）を日付つきで列挙 */
export function fundMovements(data) {
  const mv = [];
  for (const f of live(data.fundEntries)) mv.push({ date: f.date, amount: f.amount, kind: f.kind, id: f.id });
  for (const s of live(data.sales)) if (s.paid) mv.push({ date: s.paid_date, amount: s.paid_amount, kind: 'receipt', id: s.id });
  for (const e of live(data.expenses)) {
    if (e.source === 'fund') mv.push({ date: e.date, amount: -e.amount, kind: 'expense', id: e.id });
    else if (e.settled_date) mv.push({ date: e.settled_date, amount: -e.amount, kind: 'reimburse', id: e.id });
  }
  for (const w of live(data.withdrawals)) mv.push({ date: w.date, amount: -w.amount, kind: 'withdrawal', id: w.id });
  return mv;
}

/** 指定日（含む）時点の副業資金残高 */
export function balanceAsOf(data, date) {
  return sum(fundMovements(data).filter((m) => m.date <= date), (m) => m.amount);
}

/** 期間 [from, to]（'YYYY-MM-DD'）の集計 */
export function periodSummary(data, from, to) {
  const sales = live(data.sales).filter((s) => inRange(s.date, from, to));
  const receipts = live(data.sales).filter((s) => s.paid && inRange(s.paid_date, from, to));
  const expenses = live(data.expenses).filter((e) => inRange(e.date, from, to));
  const withdrawals = live(data.withdrawals).filter((w) => inRange(w.date, from, to));
  const fund = live(data.fundEntries).filter((f) => inRange(f.date, from, to));
  const trips = live(data.trips).filter((t) => inRange(t.date, from, to));
  const reimbursed = live(data.expenses).filter((e) => e.source === 'personal' && inRange(e.settled_date, from, to));

  const salesTotal = sum(sales, (s) => s.amount);
  const expenseTotal = sum(expenses, (e) => e.amount);
  const count = sales.length;
  const tripsUnsettled = trips.filter((t) => !t.expense_id);
  const estFuelUnsettled = sum(tripsUnsettled, (t) => t.est_cost);

  const byCategory = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0]));
  for (const e of expenses) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  const byService = {};
  for (const s of sales) byService[s.service] = (byService[s.service] || 0) + s.amount;

  return {
    from, to,
    sales: salesTotal,
    received: sum(receipts, (s) => s.paid_amount),
    expenses: expenseTotal,
    expensesFund: sum(expenses.filter((e) => e.source === 'fund'), (e) => e.amount),
    expensesPersonal: sum(expenses.filter((e) => e.source === 'personal'), (e) => e.amount),
    reimbursed: sum(reimbursed, (e) => e.amount),
    profit: salesTotal - expenseTotal,
    withdrawals: sum(withdrawals, (w) => w.amount),
    opening: sum(fund.filter((f) => f.kind === 'opening'), (f) => f.amount),
    topups: sum(fund.filter((f) => f.kind === 'topup'), (f) => f.amount),
    adjustments: sum(fund.filter((f) => f.kind === 'adjust'), (f) => f.amount),
    count,
    // 平均売上単価 = 売上合計 ÷ 利用件数（取消除く。0円の取引も1件と数える）。円未満四捨五入
    avgPrice: count ? Math.round(salesTotal / count) : 0,
    unpaidInPeriod: sum(sales.filter((s) => !s.paid), (s) => s.amount),
    byCategory, byService,
    estFuelAll: sum(trips, (t) => t.est_cost),
    estFuelUnsettled,
    businessKm: sum(trips, (t) => t.km_business),
    profitWithEstimate: salesTotal - expenseTotal - estFuelUnsettled,
    balanceStart: balanceAsOf(data, prevDay(from)),
    balanceEnd: balanceAsOf(data, to),
    warnFuelDouble: tripsUnsettled.length > 0 && expenses.some((e) => e.category === 'ガソリン' && !isLinked(data, e.id)),
  };
}

function isLinked(data, expenseId) {
  return live(data.trips).some((t) => t.expense_id === expenseId);
}

function prevDay(d) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

export const monthSummary = (data, ym) => periodSummary(data, `${ym}-01`, monthEnd(ym));

/** 現時点の残高・未入金・未精算（期間に関係しない「今」の数字） */
export function currentStatus(data, today) {
  const unpaid = live(data.sales).filter((s) => !s.paid);
  const unsettled = live(data.expenses).filter((e) => e.source === 'personal' && !e.settled_date);
  return {
    balance: balanceAsOf(data, today),
    balanceAll: sum(fundMovements(data), (m) => m.amount), // 未来日付も含む（通常は同じ）
    unpaidTotal: sum(unpaid, (s) => s.amount),
    unpaidCount: unpaid.length,
    personalUnsettled: sum(unsettled, (e) => e.amount),
    personalUnsettledCount: unsettled.length,
    unsettledTrips: live(data.trips).filter((t) => !t.expense_id),
    hasOpening: live(data.fundEntries).some((f) => f.kind === 'opening'),
  };
}

/** 月別推移（実績資料） */
export function monthlySeries(data, fromYm, toYm) {
  return monthRange(fromYm, toYm).map((ym) => ({ ym, ...monthSummary(data, ym) }));
}

/** 移動の距離・概算の計算 */
export function tripCalc({ km_total, odo_start, odo_end, km_private = 0, km_per_l, yen_per_l }) {
  let total = km_total;
  if ((total == null || total === '') && odo_start != null && odo_end != null) total = Number(odo_end) - Number(odo_start);
  total = round1(Number(total));
  const priv = round1(Number(km_private || 0));
  if (!(total >= 0)) throw new Error('走行距離が正しくありません');
  if (priv < 0 || priv > total) throw new Error('私用距離は走行距離以下にしてください');
  const business = round1(total - priv);
  const est = Math.round((business / Number(km_per_l)) * Number(yen_per_l));
  return { km_total: total, km_private: priv, km_business: business, est_cost: est };
}
const round1 = (n) => Math.round(n * 10) / 10;

/** 最近使った顧客（売上の新しい順、重複なし） */
export function recentCustomers(data, n = 6) {
  const seen = new Set();
  const out = [];
  const sorted = live(data.sales).slice().sort((a, b) => (b.date + (b.created_at || '')).localeCompare(a.date + (a.created_at || '')));
  for (const s of sorted) {
    if (seen.has(s.customer_id)) continue;
    const c = data.customers.find((x) => x.id === s.customer_id && !x.archived);
    if (!c) continue;
    seen.add(s.customer_id); out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

export function nextCustomerCode(customers) {
  const max = (customers || []).reduce((m, c) => Math.max(m, parseInt(String(c.code).replace(/\D/g, ''), 10) || 0), 0);
  return 'C' + String(max + 1).padStart(4, '0');
}
