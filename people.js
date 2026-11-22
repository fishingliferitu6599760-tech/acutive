// 顧客の画面
import { esc, yen, uuid, fmtDate } from '../util.js';
import { live, nextCustomerCode } from '../calc.js';
import { $, $$, toast, saving } from '../ui.js';

let showArchived = false;
let q = '';

export function customersList(a, el) {
  const stats = new Map();
  for (const s of live(a.d.sales)) {
    const x = stats.get(s.customer_id) || { n: 0, total: 0, unpaid: 0, last: '' };
    x.n++; x.total += s.amount; if (!s.paid) x.unpaid += s.amount; if (s.date > x.last) x.last = s.date;
    stats.set(s.customer_id, x);
  }
  const draw = () => {
    const list = a.d.customers
      .filter((c) => showArchived || !c.archived)
      .filter((c) => !q || (c.name + (c.kana || '') + c.code).toLowerCase().includes(q.toLowerCase()))
      .sort((x, y) => (stats.get(y.id)?.last || '').localeCompare(stats.get(x.id)?.last || '') || x.code.localeCompare(y.code));
    $('#clist', el).innerHTML = list.map((c) => {
      const s = stats.get(c.id) || { n: 0, total: 0, unpaid: 0, last: '' };
      return `<a href="#/customer/${c.id}" class="li ${c.archived ? 'void' : ''}"><span>${esc(c.name)} <small class="muted">${esc(c.code)}${c.archived ? '・利用停止' : ''}</small><br><small class="muted">${s.n}回・最終 ${s.last ? fmtDate(s.last) : '−'}${s.unpaid ? `・<i class="tag warn">未入金 ${yen(s.unpaid)}</i>` : ''}</small></span><b>${yen(s.total)}</b></a>`;
    }).join('') || '<p class="muted">該当なし</p>';
  };
  el.innerHTML = `
  <div class="head"><h2>顧客</h2><a class="btn sm" href="#/customer/new">＋ 追加</a></div>
  <input id="q" type="search" placeholder="名前・ふりがな・顧客IDで検索" value="${esc(q)}">
  <label class="check"><input type="checkbox" id="arc" ${showArchived ? 'checked' : ''}> 利用停止中の顧客も表示</label>
  <div class="list" id="clist"></div>`;
  $('#q', el).oninput = (e) => { q = e.target.value; draw(); };
  $('#arc', el).onchange = (e) => { showArchived = e.target.checked; draw(); };
  draw();
}

export function customerDetail(a, el, id) {
  const c = id ? a.d.customers.find((x) => x.id === id) : null;
  if (id && !c) { el.innerHTML = '<p class="muted">見つかりません</p>'; return; }
  const f = c ? { ...c } : { id: uuid(), code: nextCustomerCode(a.d.customers), name: '', kana: '', contact: '', archived: false };
  const hist = c ? a.d.sales.filter((s) => s.customer_id === c.id).sort((x, y) => y.date.localeCompare(x.date)) : [];
  const lv = hist.filter((s) => !s.voided_at);
  el.innerHTML = `
  <div class="head"><a href="#/customers" class="back">‹ 顧客</a><h2>${c ? esc(c.name) : '顧客を追加'}</h2></div>
  <form id="f" novalidate>
    <p class="muted small">顧客ID：${esc(f.code)}</p>
    <label class="lbl" for="name">氏名</label><input id="name" value="${esc(f.name)}" required>
    <label class="lbl" for="kana">ふりがな（任意）</label><input id="kana" value="${esc(f.kana || '')}">
    <label class="lbl" for="contact">電話番号など（任意）</label><input id="contact" inputmode="tel" value="${esc(f.contact || '')}">
    ${c ? `<label class="check"><input type="checkbox" id="archived" ${f.archived ? 'checked' : ''}> 利用停止（一覧・選択肢から隠す。履歴は残ります）</label>` : ''}
    <div class="err" id="err" hidden></div>
    <button class="btn big primary" id="save" type="submit">保存</button>
  </form>
  ${c ? `<h3 class="sec">利用履歴（${lv.length}回・${yen(lv.reduce((s, x) => s + x.amount, 0))}）</h3>
  <a class="btn" href="#/sale/new" id="newSale">この顧客の売上を登録</a>
  <div class="list">${hist.map((s) => `<a href="#/sale/${s.id}" class="li ${s.voided_at ? 'void' : ''}"><span>${fmtDate(s.date)} ${esc(s.service)}<br><small class="muted">${s.voided_at ? '取消済み' : s.paid ? `入金済み ${fmtDate(s.paid_date)}` : '<i class="tag warn">未入金</i>'}</small></span><b>${yen(s.amount)}</b></a>`).join('') || '<p class="muted">まだありません</p>'}</div>` : ''}`;

  const ns = $('#newSale', el);
  if (ns) ns.onclick = () => { a.preselect = c.id; };
  $('#f', el).onsubmit = async (ev) => {
    ev.preventDefault();
    const name = $('#name', el).value.trim();
    const err = $('#err', el);
    if (!name) { err.hidden = false; err.textContent = '氏名を入力してください'; return; }
    const row = { name, kana: $('#kana', el).value.trim() || null, contact: $('#contact', el).value.trim() || null };
    const ok = await saving($('#save', el), err, async () => {
      if (c) await a.store.update('customers', c.id, { ...row, archived: $('#archived', el).checked });
      else await a.store.insert('customers', { ...f, ...row });
    });
    if (ok) { toast('保存しました'); a.go('#/customers'); }
  };
}
