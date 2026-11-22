// アプリ本体：起動・ログイン・画面切り替え
import { CONFIG } from './config.js';
import { createDemoStore } from './store/demo.js';
import { todayJST, monthOf, esc } from './util.js';
import { $, toast } from './ui.js';
import * as money from './views/money.js';
import * as people from './views/people.js';
import * as other from './views/other.js';

const isConfigured = () => /^https:\/\/.+/.test(CONFIG.SUPABASE_URL || '') && (CONFIG.SUPABASE_PUBLISHABLE_KEY || '').length > 20;

export const App = {
  store: null,
  get d() { return this.store.data; },
  get today() { return todayJST(); },
  month: monthOf(todayJST()),
  go(hash) { if (location.hash === hash) render(); else location.hash = hash; },
  render: () => render(),
};

const ROUTES = [
  [/^#\/home$/, money.home],
  [/^#\/sale\/new$/, (a, el) => money.saleForm(a, el, null)],
  [/^#\/sale\/([\w-]+)$/, (a, el, m) => money.saleForm(a, el, m[1])],
  [/^#\/sales$/, money.salesList],
  [/^#\/expense\/new$/, (a, el) => money.expenseForm(a, el, null)],
  [/^#\/expense\/([\w-]+)$/, (a, el, m) => money.expenseForm(a, el, m[1])],
  [/^#\/expenses$/, money.expensesList],
  [/^#\/customers$/, people.customersList],
  [/^#\/customer\/new$/, (a, el) => people.customerDetail(a, el, null)],
  [/^#\/customer\/([\w-]+)$/, (a, el, m) => people.customerDetail(a, el, m[1])],
  [/^#\/more$/, other.more],
  [/^#\/trips$/, other.trips],
  [/^#\/fund$/, other.fund],
  [/^#\/report$/, other.report],
  [/^#\/settings$/, other.settings],
];

function render() {
  const el = $('#main');
  const h = location.hash || '#/home';
  for (const [re, fn] of ROUTES) {
    const m = h.match(re);
    if (m) {
      const key = h.split('/')[1] || 'home';
      document.querySelectorAll('nav.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.m.split(',').some((k) => key.startsWith(k))));
      el.innerHTML = '';
      fn(App, el, m);
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/home';
}

function showBanner() {
  const b = $('#modeBanner');
  if (App.store.mode === 'demo') {
    b.hidden = false;
    b.innerHTML = isConfigured()
      ? 'デモ表示中：架空のデータです。保存されず、本番データとは別です。<a href="./">ログイン画面へ</a>'
      : 'デモモード：本番の保存先（Supabase）が未接続です。入力は保存されず、再読み込みで消えます。本番利用はできません。';
  } else b.hidden = true;
}

async function startApp(store) {
  App.store = store;
  showBanner();
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#main').innerHTML = '<p class="muted center">読み込み中…</p>';
  try {
    await store.init();
  } catch (e) {
    $('#main').innerHTML = `<div class="err">データを読み込めませんでした：${esc(e.message)}<br><button class="btn" id="reload">再読み込み</button></div>`;
    $('#reload').onclick = () => location.reload();
    return;
  }
  window.addEventListener('hashchange', render);
  render();
}

function showLogin(store) {
  $('#app').hidden = true;
  const f = $('#login');
  f.hidden = false;
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = $('#loginBtn');
    btn.disabled = true; $('#loginErr').hidden = true;
    try {
      await store.signIn($('#email').value.trim(), $('#password').value);
      $('#password').value = '';
      await startApp(store);
    } catch (e) {
      $('#loginErr').hidden = false; $('#loginErr').textContent = e.message;
    } finally { btn.disabled = false; }
  };
  $('#demoLink').onclick = (ev) => { ev.preventDefault(); startApp(createDemoStore()); };
}

async function boot() {
  if (!isConfigured()) { $('#demoLink').hidden = true; return startApp(createDemoStore()); }
  try {
    const { createSupabaseStore } = await import('./store/supabase.js');
    const store = await createSupabaseStore({ url: CONFIG.SUPABASE_URL, key: CONFIG.SUPABASE_PUBLISHABLE_KEY });
    store.onAuthChange((s) => { if (!s && App.store === store) { toast('ログアウトしました'); showLogin(store); } });
    if (await store.session()) return startApp(store);
    showLogin(store);
  } catch (e) {
    $('#main').innerHTML = '';
    $('#login').hidden = false;
    $('#loginErr').hidden = false;
    $('#loginErr').textContent = '接続ライブラリを読み込めませんでした。通信状況を確認してください：' + e.message;
  }
}

boot();
