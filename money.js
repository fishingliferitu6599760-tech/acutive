// ホーム・売上・支出の画面
import { esc, yen, uuid, toInt, fmtDate, fmtMonth, addMonths, monthOf } from '../util.js';
import { monthSummary, currentStatus, recentCustomers, nextCustomerCode, live, EXPENSE_CATEGORIES } from '../calc.js';
import { $, $$, toast, askText, confirmBox, saving, opt } from '../ui.js';

const custName = (a, id) => a.d.customers.find((c) => c.id === id)?.name ?? '（不明）';

// ---------------------------------------------------------------- ホーム
export function home(a, el) {
  const ym = a.month;
  const m = monthSummary(a.d, ym);
  const now = currentStatus(a.d, a.today);
  const isThis = ym === monthOf(a.today);
  const card = (label, val, note = '', cls = '') => `<div class="card ${cls}"><div class="label">${label}</div><div class="val">${yen(val)}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;

  const recent = [
    ...live(a.d.sales).map((s) => ({ at: s.created_at, html: `<a href="#/sale/${s.id}" class="li"><span>${fmtDate(s.date)} ${esc(custName(a, s.customer_id))}${s.paid ? '' : ' <i class="tag warn">未入金</i>'}</span><b>${yen(s.amount)}</b></a>` })),
    ...live(a.d.expenses).map((e) => ({ at: e.created_at, html: `<a href="#/expense/${e.id}" class="li"><span>${fmtDate(e.date)} 支出・${esc(e.category)}${e.source === 'personal' ? ' <i class="tag">立替</i>' : ''}</span><b class="minus">−${yen(e.amount)}</b></a>` })),
    ...live(a.d.withdrawals).map((w) => ({ at: w.created_at, html: `<a href="#/fund" class="li"><span>${fmtDate(w.date)} 取り出し・${esc(w.purpose || '')}</span><b class="minus">−${yen(w.amount)}</b></a>` })),
  ].sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 8);

  el.innerHTML = `
  <div class="monthbar"><button class="btn ghost" data-mv="-1" aria-label="前の月">‹</button><h2>${fmtMonth(ym)}${isThis ? '' : ''}</h2><button class="btn ghost" data-mv="1" aria-label="次の月">›</button></div>
  ${now.hasOpening ? '' : `<div class="warnbox">はじめに<a href="#/fund">副業資金の開始残高</a>を登録してください（手元の副業用現金の額）。</div>`}
  <a class="btn big primary" href="#/sale/new">＋ 売上を登録</a>
  <div class="quick">
    <a class="btn" href="#/expense/new">支出</a><a class="btn" href="#/trips">移動</a><a class="btn" href="#/fund">取り出し・資金</a>
  </div>
  <div class="cards">
    ${card('売上', m.sales, `${m.count}件`)}
    ${card('入金額', m.received)}
    ${card('経費', m.expenses)}
    ${card('管理上の利益', m.profit, '売上 − 経費', m.profit < 0 ? 'neg' : 'pos')}
    ${card('生活費などへの取り出し', m.withdrawals, '経費・利益には含めない')}
    ${isThis ? '' : card('この月の月末残高', m.balanceEnd)}
  </div>
  <div class="cards now">
    ${card('副業資金の現在残高', now.balance, '開始残高からの累積（現金ベース）', 'wide strong')}
    <a href="#/sales" class="card link"><div class="label">未入金額（全期間）</div><div class="val">${yen(now.unpaidTotal)}</div><div class="note">${now.unpaidCount}件</div></a>
    <a href="#/expenses" class="card link"><div class="label">個人立替の未精算額</div><div class="val">${yen(now.personalUnsettled)}</div><div class="note">${now.personalUnsettledCount}件</div></a>
  </div>
  <div class="refbox">
    <div class="reftitle">参考値（ガソリン概算を含む・実際のお金の動きではありません）</div>
    <div class="row between"><span>未精算のガソリン概算（${fmtMonth(ym)}）</span><b>${yen(m.estFuelUnsettled)}</b></div>
    <div class="row between"><span>採算（参考）＝利益 − 未精算の概算</span><b>${yen(m.profitWithEstimate)}</b></div>
    ${m.warnFuelDouble ? '<p class="warn small">この月に「移動とひも付いていないガソリン支出」と「未精算の概算」があります。同じ給油なら、移動画面で精算としてひも付けてください（二重計上の防止）。</p>' : ''}
  </div>
  <details class="basis"><summary>集計の基準</summary>
    <ul>
      <li>売上：利用日の月に計上（未入金も含む）。入金額：実際に受け取った日の月に計上。</li>
      <li>経費：支出日の月に計上。個人立替も精算前から経費に含めます。ガソリン概算は含みません。</li>
      <li>残高：開始残高＋資金補充±照合調整＋入金−副業資金で払った支出−立替の精算−取り出し。月が変わってもリセットしません。未入金の売上・未精算の立替・ガソリン概算は残高を動かしません。</li>
    </ul>
  </details>
  <h3 class="sec">最近の記録</h3>
  <div class="list">${recent.map((r) => r.html).join('') || '<p class="muted">まだ記録がありません</p>'}</div>`;

  $$('[data-mv]', el).forEach((b) => (b.onclick = () => { a.month = addMonths(a.month, Number(b.dataset.mv)); a.render(); }));
}

// ---------------------------------------------------------------- 売上登録・修正
export function saleForm(a, el, id) {
  const st = a.d.settings;
  const existing = id ? a.d.sales.find((s) => s.id === id) : null;
  if (id && !existing) { el.innerHTML = '<p class="muted">見つかりません</p>'; return; }
  const f = existing ? { ...existing } : {
    id: uuid(), date: a.today, customer_id: a.preselect || null, service: st.default_service, amount: null,
    paid: true, paid_date: null, paid_amount: null, paid_method: st.pay_methods[0] || '現金', memo: '',
  };
  a.preselect = null;
  let newCustomer = null; // { id, code, name }（保存時に同時登録）
  let query = '';

  el.innerHTML = `
  <div class="head"><a href="#/home" class="back">‹ 戻る</a><h2>${existing ? '売上の修正' : '売上を登録'}</h2></div>
  ${existing?.voided_at ? `<div class="warnbox">この取引は取消済みです（理由：${esc(existing.void_reason || '')}）。集計には含まれません。</div>` : ''}
  <form id="f" autocomplete="off" novalidate>
    <label class="lbl">顧客</label>
    <div id="cust"></div>
    <label class="lbl" for="amount">金額（円）</label>
    <input id="amount" class="amount" inputmode="numeric" pattern="[0-9]*" placeholder="例 6000" value="${f.amount ?? ''}">
    <div id="chips" class="chips"></div>
    <div class="grid2">
      <div><label class="lbl" for="date">利用日</label><input id="date" type="date" value="${f.date}"></div>
      <div><label class="lbl" for="service">仕事の種類</label><select id="service">${[...new Set([...st.service_types, f.service])].map((s) => opt(s, s, f.service)).join('')}</select></div>
    </div>
    <details ${existing && !existing.paid ? 'open' : ''}><summary>入金状況・メモ（通常は現金で受領済み）</summary>
      <div class="seg" role="radiogroup">
        <label><input type="radio" name="paid" value="1" ${f.paid ? 'checked' : ''}><span>受領済み</span></label>
        <label><input type="radio" name="paid" value="0" ${f.paid ? '' : 'checked'}><span>未入金</span></label>
      </div>
      <div id="paidBox" class="grid2">
        <div><label class="lbl" for="paid_date">入金日</label><input id="paid_date" type="date" value="${f.paid_date || ''}" placeholder="利用日と同じ"></div>
        <div><label class="lbl" for="paid_amount">入金額</label><input id="paid_amount" inputmode="numeric" value="${f.paid ? f.paid_amount ?? '' : ''}" placeholder="売上と同じ"></div>
        <div><label class="lbl" for="paid_method">入金方法</label><select id="paid_method">${st.pay_methods.map((x) => opt(x, x, f.paid_method)).join('')}</select></div>
      </div>
      <label class="lbl" for="memo">メモ</label><input id="memo" value="${esc(f.memo || '')}">
    </details>
    <div class="err" id="err" hidden></div>
    <button class="btn big primary" id="save" type="submit">保存</button>
    ${existing ? `<div class="row gap">${existing.voided_at ? '<button type="button" class="btn ghost" id="unvoid">取消を元に戻す</button>' : '<button type="button" class="btn danger" id="void">この売上を取消</button>'}</div>` : ''}
  </form>`;

  const paidBox = $('#paidBox', el);
  const syncPaid = () => { paidBox.hidden = $('input[name=paid]:checked', el).value === '0'; };
  $$('input[name=paid]', el).forEach((r) => (r.onchange = syncPaid));
  syncPaid();

  function renderCustomer() {
    const box = $('#cust', el);
    const sel = newCustomer || a.d.customers.find((c) => c.id === f.customer_id);
    if (sel) {
      box.innerHTML = `<div class="selected"><b>${esc(sel.name)}</b> <span class="muted">${esc(sel.code)}${newCustomer ? '（新規）' : ''}</span><button type="button" class="btn ghost sm" id="chg">変更</button></div>`;
      $('#chg', box).onclick = () => { f.customer_id = null; newCustomer = null; renderCustomer(); setTimeout(() => $('#q', el)?.focus(), 0); };
      renderChips();
      return;
    }
    const active = a.d.customers.filter((c) => !c.archived);
    const q = query.trim();
    const hits = q ? active.filter((c) => (c.name + (c.kana || '') + c.code).toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
    const recent = recentCustomers(a.d);
    box.innerHTML = `
      <input id="q" type="search" placeholder="名前・ふりがなで検索" value="${esc(query)}">
      ${!q && recent.length ? `<div class="muted small">最近の顧客</div><div class="chips">${recent.map((c) => `<button type="button" class="chip" data-c="${c.id}">${esc(c.name)}</button>`).join('')}</div>` : ''}
      ${q ? `<div class="picklist">${hits.map((c) => `<button type="button" data-c="${c.id}">${esc(c.name)} <span class="muted">${esc(c.kana || '')}</span></button>`).join('')}
        <button type="button" id="addNew" class="addnew">＋「${esc(q)}」を新しい顧客として追加</button></div>` : ''}`;
    const qi = $('#q', box);
    qi.oninput = () => { query = qi.value; const pos = qi.selectionStart; renderCustomer(); const n = $('#q', el); n.focus(); n.setSelectionRange(pos, pos); };
    $$('[data-c]', box).forEach((b) => (b.onclick = () => { f.customer_id = b.dataset.c; renderCustomer(); $('#amount', el).focus(); }));
    const add = $('#addNew', box);
    if (add) add.onclick = () => { newCustomer = { id: uuid(), code: nextCustomerCode(a.d.customers), name: q, kana: '', contact: '', archived: false }; renderCustomer(); $('#amount', el).focus(); };
    $('#chips', el).innerHTML = '';
  }
  function renderChips() {
    const cid = newCustomer?.id || f.customer_id;
    const amounts = [...new Set(live(a.d.sales).filter((s) => s.customer_id === cid).sort((x, y) => y.date.localeCompare(x.date)).map((s) => s.amount))].slice(0, 3);
    $('#chips', el).innerHTML = amounts.map((v) => `<button type="button" class="chip" data-v="${v}">前回 ${yen(v)}</button>`).join('');
    $$('[data-v]', el).forEach((b) => (b.onclick = () => { $('#amount', el).value = b.dataset.v; }));
  }
  renderCustomer();

  $('#f', el).onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $('#err', el);
    const amount = toInt($('#amount', el).value);
    const cid = newCustomer?.id || f.customer_id;
    const msgs = [];
    if (!cid) msgs.push('顧客を選んでください');
    if (amount === null || amount < 0) msgs.push('金額を数字で入力してください');
    const date = $('#date', el).value;
    if (!date) msgs.push('利用日を入力してください');
    const paid = $('input[name=paid]:checked', el).value === '1';
    const pa = toInt($('#paid_amount', el).value);
    if (msgs.length) { err.hidden = false; err.textContent = msgs.join(' / '); return; }
    const row = {
      id: f.id, date, customer_id: cid, service: $('#service', el).value, amount,
      paid,
      paid_date: paid ? ($('#paid_date', el).value || date) : null,
      paid_amount: paid ? (pa ?? amount) : null,
      paid_method: paid ? $('#paid_method', el).value : null,
      memo: $('#memo', el).value.trim() || null,
    };
    const ok = await saving($('#save', el), err, async () => {
      if (newCustomer) { await a.store.insert('customers', newCustomer); f.customer_id = newCustomer.id; newCustomer = null; }
      if (existing) { const { id: _, ...patch } = row; await a.store.update('sales', f.id, patch); }
      else await a.store.insert('sales', row);
    });
    if (ok) { toast(`保存しました ${yen(amount)}`); history.length > 1 && existing ? history.back() : a.go('#/home'); }
  };

  const vb = $('#void', el);
  if (vb) vb.onclick = async () => {
    const reason = await askText({ title: 'この売上を取消しますか？', label: '記録は削除されず「取消」として残ります。理由を入力してください。', placeholder: '例：二重入力', ok: '取消する' });
    if (!reason) return;
    await saving(vb, $('#err', el), () => a.store.update('sales', f.id, { voided_at: new Date().toISOString(), void_reason: reason }));
    toast('取消しました'); a.go('#/sales');
  };
  const ub = $('#unvoid', el);
  if (ub) ub.onclick = async () => {
    await saving(ub, $('#err', el), () => a.store.update('sales', f.id, { voided_at: null, void_reason: null }));
    toast('元に戻しました'); a.render();
  };
}

// ---------------------------------------------------------------- 売上一覧
export function salesList(a, el) {
  const ym = a.month;
  const unpaidOnly = sessionFlag('unpaidOnly');
  const rows = unpaidOnly
    ? live(a.d.sales).filter((s) => !s.paid)
    : a.d.sales.filter((s) => monthOf(s.date) === ym);
  rows.sort((x, y) => y.date.localeCompare(x.date) || String(y.created_at).localeCompare(String(x.created_at)));
  const m = monthSummary(a.d, ym);
  el.innerHTML = `
  <div class="monthbar"><button class="btn ghost" data-mv="-1">‹</button><h2>${unpaidOnly ? '未入金（全期間）' : fmtMonth(ym) + 'の売上'}</h2><button class="btn ghost" data-mv="1">›</button></div>
  <a class="btn big primary" href="#/sale/new">＋ 売上を登録</a>
  <div class="seg"><label><input type="radio" name="flt" value="m" ${unpaidOnly ? '' : 'checked'}><span>月別</span></label><label><input type="radio" name="flt" value="u" ${unpaidOnly ? 'checked' : ''}><span>未入金のみ</span></label></div>
  ${unpaidOnly ? '' : `<p class="sum">売上 <b>${yen(m.sales)}</b>（${m.count}件）・入金 <b>${yen(m.received)}</b></p>`}
  <div class="list">${rows.map((s) => `
    <div class="li ${s.voided_at ? 'void' : ''}">
      <a href="#/sale/${s.id}" class="grow"><span>${fmtDate(s.date)} ${esc(custName(a, s.customer_id))}<br><small class="muted">${esc(s.service)}${s.paid ? `・${esc(s.paid_method || '')}${s.paid_date !== s.date ? ` ${fmtDate(s.paid_date)}入金` : ''}` : ''}${s.voided_at ? '・取消済み' : ''}</small></span></a>
      <b>${yen(s.amount)}</b>
      ${!s.paid && !s.voided_at ? `<button class="btn sm" data-pay="${s.id}">入金</button>` : ''}
    </div>`).join('') || '<p class="muted">該当なし</p>'}</div>`;
  $$('[data-mv]', el).forEach((b) => (b.onclick = () => { a.month = addMonths(a.month, Number(b.dataset.mv)); setFlag('unpaidOnly', false); a.render(); }));
  $$('input[name=flt]', el).forEach((r) => (r.onchange = () => { setFlag('unpaidOnly', r.value === 'u'); a.render(); }));
  $$('[data-pay]', el).forEach((b) => (b.onclick = async () => {
    const s = a.d.sales.find((x) => x.id === b.dataset.pay);
    const v = await askText({ title: `${custName(a, s.customer_id)}　${yen(s.amount)} の入金`, label: '入金日（日本時間の今日が初期値）', type: 'date', value: a.today, ok: '入金済みにする' });
    if (!v) return;
    const ok = await saving(b, null, () => a.store.update('sales', s.id, { paid: true, paid_date: v, paid_amount: s.amount, paid_method: a.d.settings.pay_methods[0] || '現金' }));
    if (ok) { toast('入金を記録しました'); a.render(); }
  }));
}

const flags = {};
const sessionFlag = (k) => !!flags[k];
const setFlag = (k, v) => { flags[k] = v; };

// ---------------------------------------------------------------- 支出登録・修正
export function expenseForm(a, el, id) {
  const existing = id ? a.d.expenses.find((e) => e.id === id) : null;
  if (id && !existing) { el.innerHTML = '<p class="muted">見つかりません</p>'; return; }
  const f = existing ? { ...existing } : { id: uuid(), date: a.today, amount: null, category: '駐車場', source: 'fund', payee: '', memo: '', settled_date: null };
  const openTrips = live(a.d.trips).filter((t) => !t.expense_id);
  const linked = existing ? live(a.d.trips).filter((t) => t.expense_id === existing.id) : [];

  el.innerHTML = `
  <div class="head"><a href="#/expenses" class="back">‹ 戻る</a><h2>${existing ? '支出の修正' : '支出を登録'}</h2></div>
  ${existing?.voided_at ? `<div class="warnbox">取消済み（理由：${esc(existing.void_reason || '')}）</div>` : ''}
  <form id="f" novalidate>
    <label class="lbl">区分</label>
    <div class="chips cat">${EXPENSE_CATEGORIES.map((c) => `<label class="chip"><input type="radio" name="cat" value="${c}" ${c === f.category ? 'checked' : ''}><span>${c}</span></label>`).join('')}</div>
    <label class="lbl" for="amount">金額（円）</label>
    <input id="amount" class="amount" inputmode="numeric" value="${f.amount ?? ''}" placeholder="例 600">
    <label class="lbl">支払元</label>
    <div class="seg"><label><input type="radio" name="src" value="fund" ${f.source === 'fund' ? 'checked' : ''}><span>副業資金</span></label><label><input type="radio" name="src" value="personal" ${f.source === 'personal' ? 'checked' : ''}><span>個人のお金で立替</span></label></div>
    <label class="lbl" for="date">日付</label><input id="date" type="date" value="${f.date}">
    <div id="tripBox"></div>
    <details><summary>支払先・メモ</summary>
      <label class="lbl" for="payee">支払先</label><input id="payee" value="${esc(f.payee || '')}">
      <label class="lbl" for="memo">メモ</label><input id="memo" value="${esc(f.memo || '')}">
    </details>
    <div class="err" id="err" hidden></div>
    <button class="btn big primary" id="save" type="submit">保存</button>
    ${existing && existing.source === 'personal' && !existing.voided_at ? `<button type="button" class="btn" id="settle">${existing.settled_date ? `精算済み（${fmtDate(existing.settled_date)}）を未精算に戻す` : '副業資金から精算した'}</button>` : ''}
    ${existing ? (existing.voided_at ? '<button type="button" class="btn ghost" id="unvoid">取消を元に戻す</button>' : '<button type="button" class="btn danger" id="void">この支出を取消</button>') : ''}
  </form>`;

  const tripBox = $('#tripBox', el);
  const renderTrips = () => {
    const cat = $('input[name=cat]:checked', el).value;
    if (cat !== 'ガソリン') { tripBox.innerHTML = ''; return; }
    if (existing) {
      tripBox.innerHTML = linked.length ? `<p class="muted small">ひも付いた移動：${linked.map((t) => `${fmtDate(t.date)} ${t.km_business}km`).join('、')}</p>` : '';
      return;
    }
    tripBox.innerHTML = openTrips.length ? `<div class="refbox"><div class="reftitle">この給油で精算する移動（概算と二重計上しないため選択）</div>
      ${openTrips.map((t) => `<label class="check"><input type="checkbox" name="trip" value="${t.id}"> ${fmtDate(t.date)} 仕事${t.km_business}km 概算${yen(t.est_cost)}</label>`).join('')}</div>` : '';
  };
  $$('input[name=cat]', el).forEach((r) => (r.onchange = renderTrips));
  renderTrips();

  $('#f', el).onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $('#err', el);
    const amount = toInt($('#amount', el).value);
    if (amount === null || amount < 0) { err.hidden = false; err.textContent = '金額を数字で入力してください'; return; }
    const source = $('input[name=src]:checked', el).value;
    const row = {
      id: f.id, date: $('#date', el).value || a.today, amount, category: $('input[name=cat]:checked', el).value, source,
      payee: $('#payee', el).value.trim() || null, memo: $('#memo', el).value.trim() || null,
      settled_date: source === 'personal' ? (existing?.settled_date ?? null) : null,
    };
    const tripIds = $$('input[name=trip]:checked', el).map((x) => x.value);
    const ok = await saving($('#save', el), err, async () => {
      if (existing) { const { id: _, ...patch } = row; await a.store.update('expenses', f.id, patch); }
      else if (row.category === 'ガソリン' && tripIds.length) await a.store.settleTrips(row, tripIds);
      else await a.store.insert('expenses', row);
    });
    if (ok) { toast('保存しました'); a.go('#/expenses'); }
  };

  const sb = $('#settle', el);
  if (sb) sb.onclick = async () => {
    if (existing.settled_date) {
      if (!(await confirmBox('未精算に戻しますか？'))) return;
      await saving(sb, $('#err', el), () => a.store.update('expenses', f.id, { settled_date: null }));
    } else {
      const v = await askText({ title: `立替 ${yen(existing.amount)} を精算`, label: '副業資金から本人に戻した日', type: 'date', value: a.today, ok: '精算済みにする' });
      if (!v) return;
      await saving(sb, $('#err', el), () => a.store.update('expenses', f.id, { settled_date: v }));
    }
    toast('更新しました'); a.go('#/expenses');
  };
  const vb = $('#void', el);
  if (vb) vb.onclick = async () => {
    const reason = await askText({ title: 'この支出を取消しますか？', label: '記録は残ります。ひも付いた移動は未精算に戻ります。', placeholder: '理由', ok: '取消する' });
    if (!reason) return;
    await saving(vb, $('#err', el), () => a.store.update('expenses', f.id, { voided_at: new Date().toISOString(), void_reason: reason }));
    toast('取消しました'); a.go('#/expenses');
  };
  const ub = $('#unvoid', el);
  if (ub) ub.onclick = async () => { await saving(ub, $('#err', el), () => a.store.update('expenses', f.id, { voided_at: null, void_reason: null })); a.render(); };
}

// ---------------------------------------------------------------- 支出一覧
export function expensesList(a, el) {
  const ym = a.month;
  const m = monthSummary(a.d, ym);
  const rows = a.d.expenses.filter((e) => monthOf(e.date) === ym).sort((x, y) => y.date.localeCompare(x.date));
  const unsettled = live(a.d.expenses).filter((e) => e.source === 'personal' && !e.settled_date);
  el.innerHTML = `
  <div class="monthbar"><button class="btn ghost" data-mv="-1">‹</button><h2>${fmtMonth(ym)}の支出</h2><button class="btn ghost" data-mv="1">›</button></div>
  <a class="btn big primary" href="#/expense/new">＋ 支出を登録</a>
  <p class="sum">経費 <b>${yen(m.expenses)}</b>（副業資金 ${yen(m.expensesFund)}・立替 ${yen(m.expensesPersonal)}）</p>
  ${unsettled.length ? `<div class="refbox"><div class="row between"><span>個人立替の未精算 ${unsettled.length}件</span><b>${yen(unsettled.reduce((s, e) => s + e.amount, 0))}</b></div>
    <button class="btn" id="settleAll">未精算の立替をまとめて精算</button>
    <p class="muted small">副業資金から立替分を本人に戻したときに押します。残高が減ります（経費は登録時に計上済みのため増えません）。</p></div>` : ''}
  <div class="list">${rows.map((e) => `<a href="#/expense/${e.id}" class="li ${e.voided_at ? 'void' : ''}"><span>${fmtDate(e.date)} ${esc(e.category)}${e.payee ? `・${esc(e.payee)}` : ''}<br><small class="muted">${e.source === 'fund' ? '副業資金' : e.settled_date ? `立替・${fmtDate(e.settled_date)}精算済み` : '立替・未精算'}${e.voided_at ? '・取消済み' : ''}</small></span><b>${yen(e.amount)}</b></a>`).join('') || '<p class="muted">該当なし</p>'}</div>`;
  $$('[data-mv]', el).forEach((b) => (b.onclick = () => { a.month = addMonths(a.month, Number(b.dataset.mv)); a.render(); }));
  const sa = $('#settleAll', el);
  if (sa) sa.onclick = async () => {
    const v = await askText({ title: `立替 ${unsettled.length}件をまとめて精算`, label: '精算日', type: 'date', value: a.today, ok: '精算済みにする' });
    if (!v) return;
    const ok = await saving(sa, null, async () => { for (const e of unsettled) if (!e.settled_date) await a.store.update('expenses', e.id, { settled_date: v }); });
    if (ok) { toast('精算を記録しました'); a.render(); }
  };
}
