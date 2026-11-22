// デモ用ストア：メモリ上だけで動作。再読み込みで消える。本番データとは完全に別。
import { TABLES, emptyData, DEFAULT_SETTINGS, BACKUP_FORMAT, BACKUP_VERSION, RESTORE_ORDER, validateBackup, stripRow } from './common.js';
import { todayJST, addMonths, monthOf, uuid } from '../util.js';
import { tripCalc } from '../calc.js';

export function createDemoStore({ seed = true, failRate = 0 } = {}) {
  const data = emptyData();
  const audit = [];
  const now = () => new Date().toISOString();
  const log = (table, id, action, old, neu) => audit.unshift({ id: audit.length + 1, table_name: table, row_id: id, action, old_data: old, new_data: neu, at: now() });
  const maybeFail = () => { if (failRate && Math.random() < failRate) throw new Error('通信エラー（デモの擬似エラー）'); };
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const store = {
    mode: 'demo',
    data,
    async init() { if (seed && !data.customers.length) seedDemo(store); return data; },
    async session() { return { user: { email: 'demo@example.invalid' } }; },
    async signOut() {},

    /** 同じidなら何もしない（二重登録防止） */
    async insert(key, row) {
      maybeFail();
      const arr = data[key];
      const exist = arr.find((r) => r.id === row.id);
      if (exist) return exist;
      const r = { ...clone(row), created_at: now(), updated_at: now() };
      arr.push(r);
      log(TABLES[key], r.id, 'INSERT', null, r);
      return r;
    },

    async update(key, id, patch) {
      maybeFail();
      const r = data[key].find((x) => x.id === id);
      if (!r) throw new Error('対象が見つかりません');
      const old = clone(r);
      Object.assign(r, clone(patch), { updated_at: now() });
      log(TABLES[key], id, 'UPDATE', old, clone(r));
      if (key === 'expenses' && patch.voided_at && !old.voided_at) {
        for (const t of data.trips) if (t.expense_id === id) await store.update('trips', t.id, { expense_id: null });
      }
      return r;
    },

    async settleTrips(expense, tripIds) {
      maybeFail();
      const trips = data.trips.filter((t) => tripIds.includes(t.id));
      if (trips.some((t) => t.expense_id && t.expense_id !== expense.id)) throw new Error('already_settled');
      await store.insert('expenses', { category: 'ガソリン', source: 'fund', settled_date: null, ...expense });
      for (const t of trips) if (!t.expense_id && !t.voided_at) await store.update('trips', t.id, { expense_id: expense.id });
      return expense.id;
    },

    async saveSettings(s) {
      const old = clone(data.settings);
      data.settings = { ...data.settings, ...clone(s) };
      log('settings', 'settings', 'UPDATE', old, clone(data.settings));
      return data.settings;
    },

    async auditLog(limit = 100) { return audit.slice(0, limit); },

    async backup() {
      return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exported_at: now(), mode: 'demo',
        data: { settings: clone(data.settings), ...Object.fromEntries(RESTORE_ORDER.map((k) => [k, clone(data[k])])) } };
    },

    async restore(obj) {
      validateBackup(obj);
      if (obj.data.settings) await store.saveSettings(stripRow(obj.data.settings));
      let n = 0;
      for (const k of RESTORE_ORDER) {
        for (const row of obj.data[k]) {
          const r = stripRow(row);
          const ex = data[k].find((x) => x.id === r.id);
          if (ex) await store.update(k, r.id, r); else await store.insert(k, r);
          n++;
        }
      }
      return n;
    },
  };
  return store;
}

function seedDemo(store) {
  const d = store.data;
  const today = todayJST();
  const ym = monthOf(today);
  const prev = addMonths(ym, -1);
  const day = (m, dd) => `${m}-${String(dd).padStart(2, '0')}`;
  const names = [['山田 花子', 'やまだ はなこ'], ['佐藤 一郎', 'さとう いちろう'], ['鈴木 和子', 'すずき かずこ'], ['高橋 誠', 'たかはし まこと']];
  const cs = names.map(([name, kana], i) => ({ id: uuid(), code: `C000${i + 1}`, name, kana, contact: '', archived: false }));
  d.customers.push(...cs);
  d.fundEntries.push({ id: uuid(), date: day(prev, '01'), kind: 'opening', amount: 20000, reason: '利用開始時の手元現金' });
  const mk = (date, c, amount, paid = true, paid_date = date) => ({
    id: uuid(), date, customer_id: c.id, service: DEFAULT_SETTINGS.default_service, amount,
    paid, paid_date: paid ? paid_date : null, paid_amount: paid ? amount : null, paid_method: paid ? '現金' : null, memo: '',
    created_at: date + 'T12:00:00Z',
  });
  const t1 = Math.min(Number(today.slice(8, 10)), 28);
  d.sales.push(
    mk(day(prev, 5), cs[0], 6000), mk(day(prev, 12), cs[1], 5000), mk(day(prev, 19), cs[2], 6000),
    mk(day(prev, 27), cs[3], 7000, true, day(ym, 1)),            // 前月の売上を今月入金
    mk(day(ym, 1), cs[0], 6000), mk(day(ym, Math.max(1, t1 - 1)), cs[1], 5000, false), // 未入金
  );
  d.expenses.push(
    { id: uuid(), date: day(prev, 12), amount: 600, category: '駐車場', source: 'fund', payee: '', memo: '', settled_date: null },
    { id: uuid(), date: day(ym, 1), amount: 1980, category: '消耗品', source: 'personal', payee: 'ドラッグストア', memo: '鍼・アルコール綿', settled_date: null },
  );
  const tc = tripCalc({ km_total: 42, km_private: 6, km_per_l: d.settings.fuel_km_per_l, yen_per_l: d.settings.fuel_yen_per_l });
  d.trips.push({ id: uuid(), date: day(ym, 1), odo_start: null, odo_end: null, ...tc, km_per_l: d.settings.fuel_km_per_l, yen_per_l: d.settings.fuel_yen_per_l, expense_id: null, memo: '2件訪問' });
  d.withdrawals.push({ id: uuid(), date: day(prev, 28), amount: 10000, purpose: '生活費' });
}
