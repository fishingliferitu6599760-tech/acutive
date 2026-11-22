// CSV作成（日本語版Excel向け：UTF-8 BOM付き・CRLF）と出力用の明細組み立て
import { live, periodSummary, monthlySeries, EXPENSE_CATEGORIES } from './calc.js';

/** 数式として解釈されうる文字列の先頭に ' を付ける（CSVインジェクション対策） */
export function safeCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) || /^[＝＋－＠]/.test(s)) s = "'" + s;
  return s;
}

export function toCSV(rows) {
  const line = (r) => r.map((v) => {
    const s = safeCell(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',');
  return '﻿' + rows.map(line).join('\r\n') + '\r\n';
}

const SRC = { fund: '副業資金', personal: '個人立替' };
const KIND = { opening: '開始残高', topup: '資金補充', adjust: '照合調整' };
const code = (data, id) => data.customers.find((c) => c.id === id)?.code ?? '';
const between = (d, from, to) => d && d >= from && d <= to;
const byDate = (k) => (a, b) => (a[k] || '').localeCompare(b[k] || '');

/** 税務向け整理資料：CSVの種類ごとに行を返す（顧客名・連絡先は含めない） */
export function taxCsvs(data, from, to) {
  const sales = live(data.sales).filter((s) => between(s.date, from, to)).sort(byDate('date'));
  const receipts = live(data.sales).filter((s) => s.paid && between(s.paid_date, from, to)).sort(byDate('paid_date'));
  const expenses = live(data.expenses).filter((e) => between(e.date, from, to)).sort(byDate('date'));
  const withdrawals = live(data.withdrawals).filter((w) => between(w.date, from, to)).sort(byDate('date'));
  const fund = live(data.fundEntries).filter((f) => between(f.date, from, to)).sort(byDate('date'));
  const unpaid = live(data.sales).filter((s) => !s.paid && s.date <= to).sort(byDate('date'));
  const unsettled = live(data.expenses).filter((e) => e.source === 'personal' && e.date <= to && (!e.settled_date || e.settled_date > to)).sort(byDate('date'));
  const sum = periodSummary(data, from, to);

  return {
    '売上明細': [['取引ID', '利用日', '顧客ID', '仕事の種類', '売上金額', '入金状況', '入金日', '入金額', '入金方法'],
      ...sales.map((s) => [s.id, s.date, code(data, s.customer_id), s.service, s.amount, s.paid ? '入金済み' : '未入金', s.paid_date || '', s.paid ? s.paid_amount : '', s.paid_method || ''])],
    '入金明細': [['取引ID', '入金日', '利用日', '顧客ID', '入金額', '入金方法'],
      ...receipts.map((s) => [s.id, s.paid_date, s.date, code(data, s.customer_id), s.paid_amount, s.paid_method || ''])],
    '支出明細': [['支出ID', '日付', '支出区分', '金額', '支払元', '精算日', '支払先', 'メモ'],
      ...expenses.map((e) => [e.id, e.date, e.category, e.amount, SRC[e.source], e.settled_date || '', e.payee || '', e.memo || ''])],
    '取り出し明細': [['ID', '日付', '金額', '用途'], ...withdrawals.map((w) => [w.id, w.date, w.amount, w.purpose || ''])],
    '資金の入出明細': [['ID', '日付', '種類', '金額', '理由'], ...fund.map((f) => [f.id, f.date, KIND[f.kind], f.amount, f.reason || ''])],
    '区分別集計': [['項目', '金額'],
      ['売上（利用日基準）', sum.sales], ['入金（入金日基準）', sum.received],
      ...EXPENSE_CATEGORIES.map((c) => [`経費：${c}`, sum.byCategory[c] || 0]),
      ['経費合計（支出日基準）', sum.expenses], ['管理上の利益（売上−経費）', sum.profit],
      ['生活費などへの取り出し', sum.withdrawals], ['期首の副業資金残高', sum.balanceStart], ['期末の副業資金残高', sum.balanceEnd]],
    '未入金一覧': [['取引ID', '利用日', '顧客ID', '仕事の種類', '売上金額'],
      ...unpaid.map((s) => [s.id, s.date, code(data, s.customer_id), s.service, s.amount])],
    '個人立替未精算一覧': [['支出ID', '日付', '支出区分', '金額', '支払先'],
      ...unsettled.map((e) => [e.id, e.date, e.category, e.amount, e.payee || ''])],
  };
}

/** 事業計画・借入相談向け実績資料：月別推移 */
export function planRows(data, fromYm, toYm) {
  const series = monthlySeries(data, fromYm, toYm);
  return [['月', '売上', '入金', '経費', '管理上の利益', '生活費などへの取り出し', '月末の副業資金残高', '利用件数', '平均売上単価'],
    ...series.map((m) => [m.ym, m.sales, m.received, m.expenses, m.profit, m.withdrawals, m.balanceEnd, m.count, m.avgPrice])];
}
