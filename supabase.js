// 本番ストア：Supabase（Auth + Postgres + RLS）。
// 顧客・金額はブラウザのメモリ上にだけ保持し、localStorageには保存しない。
// （supabase-js がログイン状態の維持のため認証トークンのみを localStorage に保存します）
import { TABLES, emptyData, DEFAULT_SETTINGS, BACKUP_FORMAT, BACKUP_VERSION, RESTORE_ORDER, validateBackup, stripRow } from './common.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm';

export async function createSupabaseStore({ url, key }) {
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  let data = emptyData();
  let userId = null;

  const fail = (error) => {
    if (!error) return;
    const m = error.message || String(error);
    if (/already_settled/.test(m)) throw new Error('すでに別の支出で精算済みの移動が含まれています');
    if (/JWT|session|401/i.test(m)) throw new Error('ログインの有効期限が切れました。再ログインしてください');
    if (/row-level security|permission denied/i.test(m)) throw new Error('この操作は許可されていません');
    if (/Failed to fetch|NetworkError|network/i.test(m)) throw new Error('通信できませんでした。電波の良い場所で再試行してください');
    throw new Error(m);
  };

  async function fetchAll(table) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data: rows, error } = await sb.from(table).select('*').order('created_at', { ascending: true }).range(from, from + 999);
      fail(error);
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }

  const store = {
    mode: 'supabase',
    get data() { return data; },

    async session() {
      const { data: s } = await sb.auth.getSession();
      userId = s.session?.user?.id ?? null;
      return s.session;
    },
    async signIn(email, password) {
      const { data: s, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error('メールアドレスまたはパスワードが違います');
      userId = s.user.id;
      return s.session;
    },
    async signOut() { await sb.auth.signOut(); data = emptyData(); userId = null; },
    onAuthChange(cb) { sb.auth.onAuthStateChange((_e, s) => cb(s)); },

    async init() {
      const next = emptyData();
      const { data: st, error } = await sb.from('settings').select('*').maybeSingle();
      fail(error);
      next.settings = { ...DEFAULT_SETTINGS, ...(st || {}) };
      const loaded = await Promise.all(Object.entries(TABLES).map(async ([k, t]) => [k, await fetchAll(t)]));
      for (const [k, rows] of loaded) next[k] = rows;
      data = next;
      return data;
    },

    /** id はアプリ側で発行済み。同じidの再送は ON CONFLICT DO NOTHING で無視（二重登録防止） */
    async insert(key, row) {
      const { error } = await sb.from(TABLES[key]).upsert({ ...row, user_id: userId }, { onConflict: 'id', ignoreDuplicates: true });
      fail(error);
      const { data: saved, error: e2 } = await sb.from(TABLES[key]).select('*').eq('id', row.id).single();
      fail(e2);
      const arr = data[key];
      const i = arr.findIndex((r) => r.id === saved.id);
      if (i >= 0) arr[i] = saved; else arr.push(saved);
      return saved;
    },

    async update(key, id, patch) {
      const { data: saved, error } = await sb.from(TABLES[key]).update(patch).eq('id', id).select('*').single();
      fail(error);
      const arr = data[key];
      const i = arr.findIndex((r) => r.id === id);
      if (i >= 0) arr[i] = saved;
      if (key === 'expenses' && patch.voided_at) data.trips = await fetchAll('trips'); // DB側でひも付け解除
      return saved;
    },

    async settleTrips(expense, tripIds) {
      const { error } = await sb.rpc('settle_trips', { p_expense: expense, p_trip_ids: tripIds });
      fail(error);
      data.expenses = await fetchAll('expenses');
      data.trips = await fetchAll('trips');
      return expense.id;
    },

    async saveSettings(s) {
      const row = { ...stripRow(s), user_id: userId };
      const { data: saved, error } = await sb.from('settings').upsert(row, { onConflict: 'user_id' }).select('*').single();
      fail(error);
      data.settings = { ...DEFAULT_SETTINGS, ...saved };
      return data.settings;
    },

    async auditLog(limit = 100) {
      const { data: rows, error } = await sb.from('audit_log').select('*').order('at', { ascending: false }).limit(limit);
      fail(error);
      return rows;
    },

    async backup() {
      await store.init();
      return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exported_at: new Date().toISOString(), mode: 'supabase',
        data: { settings: stripRow(data.settings), ...Object.fromEntries(RESTORE_ORDER.map((k) => [k, data[k].map(stripRow)])) } };
    },

    /** 同じidは上書き、無いものは追加。物理削除はしない */
    async restore(obj) {
      validateBackup(obj);
      if (obj.data.settings) await store.saveSettings(obj.data.settings);
      let n = 0;
      for (const k of RESTORE_ORDER) {
        const rows = obj.data[k].map((r) => ({ ...stripRow(r), user_id: userId }));
        // 移動→支出の参照は、支出を先に入れてから復元する（RESTORE_ORDERで担保）
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await sb.from(TABLES[k]).upsert(rows.slice(i, i + 200), { onConflict: 'id' });
          fail(error);
        }
        n += rows.length;
      }
      await store.init();
      return n;
    },
  };
  return store;
}
