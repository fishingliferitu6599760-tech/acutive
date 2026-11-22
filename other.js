// その他：移動（ガソリン）・資金・出力・設定
import { esc, yen, uuid, toInt, toNum, fmtDate, fmtMonth, monthOf, addMonths, monthEnd } from '../util.js';
import { live, tripCalc, currentStatus, periodSummary, monthlySeries, EXPENSE_CATEGORIES } from '../calc.js';
import { taxCsvs, planRows, toCSV } from '../csv.js';
import { $, $$, toast, askText, confirmBox, saving, download, opt } from '../ui.js';

export function more(a, el) {
  el.innerHTML = `
  <div class="head"><h2>その他</h2></div>
  <div class="menu">
    <a href="#/trips" class="li"><span>移動・ガソリン概算<br><small class="muted">走行距離の記録と、副業資金からの精算</small></span>›</a>
    <a href="#/fund" class="li"><span>副業資金<br><small class="muted">開始残高・資金補充・生活費への取り出し・現金照合</small></span>›</a>
    <a href="#/report" class="li"><span>集計・出力<br><small class="muted">税務向け整理資料／事業計画向け実績資料</small></span>›</a>
    <a href="#/settings" class="li"><span>設定・バックアップ<br><small class="muted">燃費・単価、仕事の種類、変更履歴、ログアウト</small></span>›</a>
  </div>`;
}

// ---------------------------------------------------------------- 移動
let settleId = null; // 精算の再送でも同じ支出IDを使う
export function trips(a, el) {
  const st = a.d.settings;
  const list = a.d.trips.slice().sort((x, y) => y.date.localeCompare(x.date)).slice(0, 60);
  const open = live(a.d.trips).filter((t) => !t.expense_id);
  const fid = uuid();
  el.innerHTML = `
  <div class="head"><a href="#/more" class="back">‹ その他</a><h2>移動・ガソリン概算</h2></div>
  <form id="f" novalidate class="panel">
    <div class="grid2"><div><label class="lbl" for="date">日付</label><input id="date" type="date" value="${a.today}"></div>
    <div><label class="lbl">入力方法</label><div class="seg"><label><input type="radio" name="mode" value="km" checked><span>距離</span></label><label><input type="radio" name="mode" value="odo"><span>メーター</span></label></div></div></div>
    <div id="kmBox"><label class="lbl" for="km">走行距離（km・一連の移動の合計）</label><input id="km" inputmode="decimal" placeholder="例 42"></div>
    <div id="odoBox" class="grid2" hidden><div><label class="lbl" for="o1">出発メーター</label><input id="o1" inputmode="decimal"></div><div><label class="lbl" for="o2">終了メーター</label><input id="o2" inputmode="decimal"></div></div>
    <label class="lbl" for="priv">うち私用の距離（km）</label><input id="priv" inputmode="decimal" value="0">
    <label class="lbl" for="memo">メモ（任意）</label><input id="memo" placeholder="例 2件訪問">
    <p class="est" id="est">燃費 ${st.fuel_km_per_l}km/L・単価 ${yen(st.fuel_yen_per_l)}/L</p>
    <div class="err" id="err" hidden></div>
    <button class="btn big primary" id="save" type="submit">移動を記録</button>
    <p class="muted small">概算は採算を見るための参考値です。記録しただけでは副業資金の残高は減りません。</p>
  </form>
  <h3 class="sec">未精算の移動（${open.length}件・概算 ${yen(open.reduce((s, t) => s + t.est_cost, 0))}）</h3>
  ${open.length ? `<div class="list">${open.map((t) => `<label class="li check"><span><input type="checkbox" name="sel" value="${t.id}" checked> ${fmtDate(t.date)} 仕事${t.km_business}km${t.km_private ? `（私用${t.km_private}km除く）` : ''} ${esc(t.memo || '')}</span><b>${yen(t.est_cost)}</b></label>`).join('')}</div>
  <button class="btn" id="settle">選んだ移動を副業資金から精算</button>
  <p class="muted small">精算すると「ガソリン」の支出として記録され、移動とひも付きます。ひも付いた移動の概算は参考値から外れるので二重計上になりません。給油レシートを支出から登録する場合は、支出画面で移動を選んでください。</p>` : '<p class="muted">なし</p>'}
  <h3 class="sec">履歴</h3>
  <div class="list">${list.map((t) => `<div class="li ${t.voided_at ? 'void' : ''}"><span>${fmtDate(t.date)} ${t.km_total}km（仕事${t.km_business}km）<br><small class="muted">${t.voided_at ? '取消済み' : t.expense_id ? '精算済み' : '未精算'}・${t.km_per_l}km/L・${yen(t.yen_per_l)}/L</small></span><b>${yen(t.est_cost)}</b>${!t.voided_at && !t.expense_id ? `<button class="btn sm ghost" data-void="${t.id}">取消</button>` : ''}</div>`).join('') || '<p class="muted">なし</p>'}</div>`;

  const mode = () => $('input[name=mode]:checked', el).value;
  const calc = () => tripCalc({
    km_total: mode() === 'km' ? toNum($('#km', el).value) : null,
    odo_start: mode() === 'odo' ? toNum($('#o1', el).value) : null,
    odo_end: mode() === 'odo' ? toNum($('#o2', el).value) : null,
    km_private: toNum($('#priv', el).value) || 0, km_per_l: st.fuel_km_per_l, yen_per_l: st.fuel_yen_per_l,
  });
  const upd = () => {
    $('#kmBox', el).hidden = mode() !== 'km'; $('#odoBox', el).hidden = mode() !== 'odo';
    try { const r = calc(); $('#est', el).textContent = `仕事の距離 ${r.km_business}km ÷ ${st.fuel_km_per_l}km/L × ${st.fuel_yen_per_l}円 ＝ 概算 ${yen(r.est_cost)}（参考）`; }
    catch { $('#est', el).textContent = `燃費 ${st.fuel_km_per_l}km/L・単価 ${yen(st.fuel_yen_per_l)}/L`; }
  };
  $$('input', $('#f', el)).forEach((i) => (i.oninput = i.onchange = upd));

  $('#f', el).onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $('#err', el);
    let r;
    try {
      if (mode() === 'km' && toNum($('#km', el).value) === null) throw new Error('走行距離を入力してください');
      if (mode() === 'odo' && (toNum($('#o1', el).value) === null || toNum($('#o2', el).value) === null)) throw new Error('メーターを入力してください');
      r = calc();
    } catch (e) { err.hidden = false; err.textContent = e.message; return; }
    const row = { id: fid, date: $('#date', el).value || a.today,
      odo_start: mode() === 'odo' ? toNum($('#o1', el).value) : null, odo_end: mode() === 'odo' ? toNum($('#o2', el).value) : null,
      ...r, km_per_l: st.fuel_km_per_l, yen_per_l: st.fuel_yen_per_l, expense_id: null, memo: $('#memo', el).value.trim() || null };
    if (await saving($('#save', el), err, () => a.store.insert('trips', row))) { toast(`記録しました（概算 ${yen(r.est_cost)}）`); a.render(); }
  };

  const sb = $('#settle', el);
  if (sb) sb.onclick = async () => {
    const ids = $$('input[name=sel]:checked', el).map((x) => x.value);
    if (!ids.length) return toast('移動を選んでください', 'err');
    const est = open.filter((t) => ids.includes(t.id)).reduce((s, t) => s + t.est_cost, 0);
    const v = await askText({ title: `${ids.length}件を精算`, label: '副業資金から実際に出した金額（円）。初期値は概算の合計です。', value: String(est), type: 'number', ok: '精算する' });
    if (v === null) return;
    const amount = toInt(v);
    if (amount === null || amount < 0) return toast('金額が正しくありません', 'err');
    settleId = settleId || uuid();
    const ok = await saving(sb, null, () => a.store.settleTrips({ id: settleId, date: a.today, amount, source: 'fund', memo: `移動精算 ${ids.length}件` }, ids));
    if (ok) { settleId = null; toast('精算を記録しました'); a.render(); }
  };
  $$('[data-void]', el).forEach((b) => (b.onclick = async () => {
    const reason = await askText({ title: 'この移動を取消しますか？', placeholder: '理由', ok: '取消する' });
    if (!reason) return;
    if (await saving(b, null, () => a.store.update('trips', b.dataset.void, { voided_at: new Date().toISOString(), void_reason: reason }))) a.render();
  }));
}

// ---------------------------------------------------------------- 副業資金
export function fund(a, el) {
  const now = currentStatus(a.d, a.today);
  const ids = { w: uuid(), f: uuid(), adj: uuid() };
  const hist = [
    ...a.d.withdrawals.map((w) => ({ t: 'withdrawals', r: w, label: `取り出し・${w.purpose || ''}`, amt: -w.amount })),
    ...a.d.fundEntries.map((f) => ({ t: 'fundEntries', r: f, label: { opening: '開始残高', topup: '資金補充', adjust: '照合調整' }[f.kind] + (f.reason ? `・${f.reason}` : ''), amt: f.amount })),
  ].sort((x, y) => y.r.date.localeCompare(x.r.date)).slice(0, 50);

  el.innerHTML = `
  <div class="head"><a href="#/more" class="back">‹ その他</a><h2>副業資金</h2></div>
  <div class="card wide strong"><div class="label">副業資金の現在残高</div><div class="val">${yen(now.balance)}</div></div>

  <h3 class="sec">生活費などへの取り出し</h3>
  <form id="fw" class="panel" novalidate>
    <div class="grid2"><div><label class="lbl" for="w_amount">金額</label><input id="w_amount" class="amount" inputmode="numeric"></div>
    <div><label class="lbl" for="w_date">日付</label><input id="w_date" type="date" value="${a.today}"></div></div>
    <label class="lbl" for="w_purpose">用途</label><input id="w_purpose" value="生活費" list="purposes"><datalist id="purposes"><option value="生活費"><option value="家計へ"><option value="貯蓄へ"></datalist>
    <p class="muted small">仕事の経費ではありません。利益とは別に集計し、残高だけを減らします。立替の精算は支出画面から行ってください。</p>
    <div class="err" id="err_w" hidden></div>
    <button class="btn primary" id="save_w">取り出しを記録</button>
  </form>

  <h3 class="sec">開始残高・資金補充</h3>
  <form id="ff" class="panel" novalidate>
    <div class="seg"><label><input type="radio" name="kind" value="opening" ${now.hasOpening ? '' : 'checked'}><span>開始残高</span></label><label><input type="radio" name="kind" value="topup" ${now.hasOpening ? 'checked' : ''}><span>個人のお金を補充</span></label></div>
    <div class="grid2"><div><label class="lbl" for="f_amount">金額</label><input id="f_amount" class="amount" inputmode="numeric"></div>
    <div><label class="lbl" for="f_date">日付</label><input id="f_date" type="date" value="${a.today}"></div></div>
    <label class="lbl" for="f_reason">メモ（任意）</label><input id="f_reason">
    <p class="muted small">売上には含めません。</p>
    <div class="err" id="err_f" hidden></div>
    <button class="btn primary" id="save_f">記録</button>
  </form>

  <h3 class="sec">現金の照合</h3>
  <form id="fa" class="panel" novalidate>
    <label class="lbl" for="actual">手元の副業用現金の実額（数えた金額）</label><input id="actual" class="amount" inputmode="numeric">
    <p id="diff" class="est">アプリ上の残高：${yen(now.balance)}</p>
    <label class="lbl" for="a_reason">差異の理由（必須）</label><input id="a_reason" placeholder="例：レシート紛失の駐車場代">
    <div class="err" id="err_a" hidden></div>
    <button class="btn" id="save_a">差額を調整として記録</button>
  </form>

  <h3 class="sec">履歴</h3>
  <div class="list">${hist.map((h) => `<div class="li ${h.r.voided_at ? 'void' : ''}"><span>${fmtDate(h.r.date)} ${esc(h.label)}${h.r.voided_at ? '（取消済み）' : ''}</span><b class="${h.amt < 0 ? 'minus' : ''}">${yen(h.amt)}</b>${h.r.voided_at ? '' : `<button class="btn sm ghost" data-t="${h.t}" data-id="${h.r.id}">取消</button>`}</div>`).join('') || '<p class="muted">なし</p>'}</div>`;

  $('#fw', el).onsubmit = async (ev) => {
    ev.preventDefault();
    const amount = toInt($('#w_amount', el).value);
    if (!amount || amount <= 0) { $('#err_w', el).hidden = false; $('#err_w', el).textContent = '金額を入力してください'; return; }
    if (await saving($('#save_w', el), $('#err_w', el), () => a.store.insert('withdrawals', { id: ids.w, date: $('#w_date', el).value || a.today, amount, purpose: $('#w_purpose', el).value.trim() || null }))) { toast('記録しました'); a.render(); }
  };
  $('#ff', el).onsubmit = async (ev) => {
    ev.preventDefault();
    const amount = toInt($('#f_amount', el).value);
    if (amount === null || amount < 0) { $('#err_f', el).hidden = false; $('#err_f', el).textContent = '金額を入力してください'; return; }
    const kind = $('input[name=kind]:checked', el).value;
    if (kind === 'opening' && now.hasOpening && !(await confirmBox('開始残高はすでに登録されています', '2件目の開始残高として加算されます。修正したい場合は、既存の開始残高を取消してから登録してください。', 'それでも登録'))) return;
    if (await saving($('#save_f', el), $('#err_f', el), () => a.store.insert('fundEntries', { id: ids.f, date: $('#f_date', el).value || a.today, kind, amount, reason: $('#f_reason', el).value.trim() || null }))) { toast('記録しました'); a.render(); }
  };
  const diffOf = () => { const v = toInt($('#actual', el).value); return v === null ? null : v - now.balance; };
  $('#actual', el).oninput = () => { const d = diffOf(); $('#diff', el).textContent = d === null ? `アプリ上の残高：${yen(now.balance)}` : d === 0 ? '差異はありません' : `差異 ${d > 0 ? '+' : ''}${d.toLocaleString()}円（実額 − アプリ上の残高）`; };
  $('#fa', el).onsubmit = async (ev) => {
    ev.preventDefault();
    const d = diffOf(); const reason = $('#a_reason', el).value.trim(); const err = $('#err_a', el);
    if (d === null) { err.hidden = false; err.textContent = '実額を入力してください'; return; }
    if (d === 0) { toast('差異はありません'); return; }
    if (!reason) { err.hidden = false; err.textContent = '差異の理由を入力してください'; return; }
    if (await saving($('#save_a', el), err, () => a.store.insert('fundEntries', { id: ids.adj, date: a.today, kind: 'adjust', amount: d, reason }))) { toast('調整を記録しました'); a.render(); }
  };
  $$('[data-t]', el).forEach((b) => (b.onclick = async () => {
    const reason = await askText({ title: 'この記録を取消しますか？', placeholder: '理由', ok: '取消する' });
    if (!reason) return;
    if (await saving(b, null, () => a.store.update(b.dataset.t, b.dataset.id, { voided_at: new Date().toISOString(), void_reason: reason }))) a.render();
  }));
}

// ---------------------------------------------------------------- 集計・出力
const rep = { purpose: 'tax', from: null, to: null };
export function report(a, el) {
  const thisM = monthOf(a.today);
  if (!rep.from) { rep.from = thisM; rep.to = thisM; }
  const from = `${rep.from}-01`, to = monthEnd(rep.to);
  const s = periodSummary(a.d, from, to);
  const series = monthlySeries(a.d, rep.from, rep.to);
  const period = rep.from === rep.to ? fmtMonth(rep.from) : `${fmtMonth(rep.from)}〜${fmtMonth(rep.to)}`;
  const tr = (k, v, cls = '') => `<tr class="${cls}"><th>${k}</th><td>${typeof v === 'number' ? yen(v) : v}</td></tr>`;

  const summaryTable = `<table class="tbl">
    ${tr('売上（利用日基準）', s.sales)}${tr('入金（入金日基準）', s.received)}
    ${EXPENSE_CATEGORIES.map((c) => tr(`　経費：${c}`, s.byCategory[c] || 0, 'sub')).join('')}
    ${tr('経費合計（支出日基準）', s.expenses)}${tr('管理上の利益（売上−経費）', s.profit, 'strong')}
    ${tr('生活費などへの取り出し', s.withdrawals)}${tr('開始残高・資金補充', s.opening + s.topups)}${tr('照合調整', s.adjustments)}
    ${tr('立替の精算（期間中）', s.reimbursed)}
    ${tr('期首の副業資金残高', s.balanceStart)}${tr('期末の副業資金残高', s.balanceEnd, 'strong')}
    ${tr('利用件数', `${s.count}件`)}${tr('平均売上単価', s.avgPrice)}
    ${tr('期間内の未入金', s.unpaidInPeriod)}
    ${tr('参考：未精算のガソリン概算', s.estFuelUnsettled, 'ref')}${tr('参考：採算（概算を含む）', s.profitWithEstimate, 'ref')}
  </table>`;
  const seriesTable = `<table class="tbl wide"><tr><th>月</th><th>売上</th><th>経費</th><th>利益</th><th>月末残高</th><th>件数</th><th>平均単価</th></tr>
    ${series.map((m) => `<tr><td>${m.ym}</td><td>${yen(m.sales)}</td><td>${yen(m.expenses)}</td><td>${yen(m.profit)}</td><td>${yen(m.balanceEnd)}</td><td>${m.count}</td><td>${yen(m.avgPrice)}</td></tr>`).join('')}</table>`;
  const notes = `<ul class="small muted">
    <li>売上は利用日、入金は入金日、経費は支出日の期間で集計。取消した記録は除外。</li>
    <li>利用件数＝期間内の売上記録の件数（取消を除く）。平均売上単価＝売上合計÷利用件数（円未満四捨五入）。</li>
    <li>残高は開始残高からの累積（現金ベース）。ガソリン概算は参考値で、残高・経費には含みません。</li>
    <li>顧客名・連絡先は出力に含めていません（顧客IDのみ）。</li></ul>`;
  const title = rep.purpose === 'plan' ? '事業計画・借入相談向け 実績資料' : rep.purpose === 'tax' ? '税務向け 整理資料' : '集計';

  el.innerHTML = `
  <div class="head"><a href="#/more" class="back">‹ その他</a><h2>集計・出力</h2></div>
  <div class="panel">
    <label class="lbl">用途</label>
    <div class="seg three">
      <label><input type="radio" name="p" value="tax" ${rep.purpose === 'tax' ? 'checked' : ''}><span>税務向け整理資料</span></label>
      <label><input type="radio" name="p" value="plan" ${rep.purpose === 'plan' ? 'checked' : ''}><span>事業計画・借入相談</span></label>
      <label><input type="radio" name="p" value="none" ${rep.purpose === 'none' ? 'checked' : ''}><span>出力しない</span></label>
    </div>
    <div class="grid2"><div><label class="lbl" for="from">開始月</label><input id="from" type="month" value="${rep.from}"></div><div><label class="lbl" for="to">終了月</label><input id="to" type="month" value="${rep.to}"></div></div>
    <div class="chips"><button class="chip" data-r="this">今月</button><button class="chip" data-r="last">先月</button><button class="chip" data-r="year">今年</button><button class="chip" data-r="lastyear">昨年</button><button class="chip" data-r="12">直近12か月</button></div>
  </div>
  <p class="notice">これは記録を整理した<b>${rep.purpose === 'plan' ? '実績資料' : '整理資料'}</b>です。確定申告書や金融機関の指定様式ではなく、そのまま正式な提出書類として使えるものではありません。</p>
  <h3 class="sec">${esc(title)}（${period}）</h3>
  ${summaryTable}
  ${rep.purpose === 'plan' || rep.from !== rep.to ? `<h3 class="sec">月別推移</h3>${seriesTable}` : ''}
  ${notes}
  ${rep.purpose === 'none' ? '<p class="muted">出力は行いません。記録はそのまま保持されます。</p>' : `
  <h3 class="sec">出力</h3>
  <button class="btn primary" id="print">印刷・PDF保存用の画面</button>
  <div class="csvs">${rep.purpose === 'tax' ? Object.keys(taxCsvs(a.d, from, to)).map((k) => `<button class="btn" data-csv="${k}">CSV：${k}</button>`).join('') : '<button class="btn" data-csv="plan">CSV：月別実績</button>'}</div>
  <p class="muted small">CSVは日本語版Excelでそのまま開ける形式（UTF-8 BOM付き）です。</p>`}`;

  $$('input[name=p]', el).forEach((r) => (r.onchange = () => {
    rep.purpose = r.value;
    if (r.value === 'plan' && rep.from === rep.to) { rep.from = addMonths(thisM, -11); rep.to = thisM; }
    a.render();
  }));
  $('#from', el).onchange = (e) => { rep.from = e.target.value || thisM; if (rep.from > rep.to) rep.to = rep.from; a.render(); };
  $('#to', el).onchange = (e) => { rep.to = e.target.value || thisM; if (rep.from > rep.to) rep.from = rep.to; a.render(); };
  $$('[data-r]', el).forEach((b) => (b.onclick = () => {
    const y = thisM.slice(0, 4);
    ({ this: () => { rep.from = rep.to = thisM; }, last: () => { rep.from = rep.to = addMonths(thisM, -1); },
       year: () => { rep.from = `${y}-01`; rep.to = thisM; }, lastyear: () => { rep.from = `${y - 1}-01`; rep.to = `${y - 1}-12`; },
       12: () => { rep.from = addMonths(thisM, -11); rep.to = thisM; } })[b.dataset.r]();
    a.render();
  }));
  const tag = rep.from === rep.to ? rep.from : `${rep.from}_${rep.to}`;
  $$('[data-csv]', el).forEach((b) => (b.onclick = () => {
    const k = b.dataset.csv;
    if (k === 'plan') download(`acutive_月別実績_${tag}.csv`, toCSV(planRows(a.d, rep.from, rep.to)));
    else download(`acutive_${k}_${tag}.csv`, toCSV(taxCsvs(a.d, from, to)[k]));
  }));
  const pb = $('#print', el);
  if (pb) pb.onclick = () => {
    const p = $('#print-area');
    p.innerHTML = `<h1>${esc(title)}</h1><p>対象期間：${period}　作成日：${a.today}</p>
      <p class="notice">本資料は日々の記録を整理したものです。確定申告書・金融機関の指定様式ではありません。</p>
      ${summaryTable}${rep.purpose === 'plan' || rep.from !== rep.to ? `<h2>月別推移</h2>${seriesTable}` : ''}${notes}
      ${rep.purpose === 'tax' ? printLists(a, from, to) : ''}`;
    window.print();
  };
}

function printLists(a, from, to) {
  const c = taxCsvs(a.d, from, to);
  const t = (name) => {
    const rows = c[name];
    if (rows.length <= 1) return `<h2>${name}</h2><p>該当なし</p>`;
    const head = rows[0].filter((h) => !/ID$/.test(h) || h === '顧客ID');
    const idx = head.map((h) => rows[0].indexOf(h));
    return `<h2>${name}</h2><table class="tbl wide"><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.slice(1).map((r) => `<tr>${idx.map((i) => `<td>${esc(typeof r[i] === 'number' ? r[i].toLocaleString() : r[i])}</td>`).join('')}</tr>`).join('')}</table>`;
  };
  return ['未入金一覧', '個人立替未精算一覧', '支出明細', '取り出し明細'].map(t).join('');
}

// ---------------------------------------------------------------- 設定
export async function settings(a, el) {
  const st = a.d.settings;
  const sess = a.store.mode === 'supabase' ? await a.store.session() : null;
  el.innerHTML = `
  <div class="head"><a href="#/more" class="back">‹ その他</a><h2>設定</h2></div>
  <form id="f" class="panel" novalidate>
    <div class="grid2"><div><label class="lbl" for="kmpl">燃費（km/L）</label><input id="kmpl" inputmode="decimal" value="${st.fuel_km_per_l}"></div>
    <div><label class="lbl" for="ypl">ガソリン単価（円/L）</label><input id="ypl" inputmode="numeric" value="${st.fuel_yen_per_l}"></div></div>
    <p class="muted small">変更は、これから記録する移動の概算に使われます（過去の記録は登録時の値のまま）。</p>
    <label class="lbl" for="svc">仕事の種類（1行に1つ）</label><textarea id="svc" rows="3">${esc(st.service_types.join('\n'))}</textarea>
    <label class="lbl" for="def">売上登録の初期値</label><select id="def">${st.service_types.map((s) => opt(s, s, st.default_service)).join('')}</select>
    <label class="lbl" for="pm">入金方法（1行に1つ・先頭が初期値）</label><textarea id="pm" rows="3">${esc(st.pay_methods.join('\n'))}</textarea>
    <div class="err" id="err" hidden></div>
    <button class="btn primary" id="save">設定を保存</button>
  </form>

  <h3 class="sec">バックアップ・復元</h3>
  <div class="panel">
    <button class="btn" id="bk">バックアップを保存（JSON）</button>
    <p class="muted small">全データ（顧客情報を含む）を1ファイルに保存します。ファイルはパスワード付きの場所（例：個人のクラウドの非公開フォルダ）に保管し、GitHubには置かないでください。</p>
    <label class="btn" for="rs">バックアップから復元</label><input id="rs" type="file" accept="application/json,.json" hidden>
    <p class="muted small">同じIDの記録は上書き、無い記録は追加します（削除はしません）。</p>
  </div>

  <h3 class="sec">変更履歴（最新50件）</h3>
  <div class="list small" id="audit"><p class="muted">読み込み中…</p></div>

  <h3 class="sec">アカウント</h3>
  <div class="panel">
    <p>${a.store.mode === 'demo' ? '<b class="warn">デモモード（保存されません）</b>' : `本番（Supabase）に接続中：${esc(sess?.user?.email || '')}`}</p>
    ${a.store.mode === 'supabase' ? '<button class="btn" id="out">ログアウト</button>' : '<a class="btn" href="./">最初の画面へ</a>'}
  </div>`;

  $('#f', el).onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $('#err', el);
    const lines = (id) => [...new Set($(id, el).value.split('\n').map((x) => x.trim()).filter(Boolean))];
    const s = { fuel_km_per_l: toNum($('#kmpl', el).value), fuel_yen_per_l: toInt($('#ypl', el).value), service_types: lines('#svc'), pay_methods: lines('#pm') };
    s.default_service = s.service_types.includes($('#def', el).value) ? $('#def', el).value : s.service_types[0];
    if (!(s.fuel_km_per_l > 0) || !(s.fuel_yen_per_l >= 0) || !s.service_types.length || !s.pay_methods.length) { err.hidden = false; err.textContent = '入力内容を確認してください'; return; }
    if (await saving($('#save', el), err, () => a.store.saveSettings(s))) { toast('保存しました'); a.render(); }
  };
  $('#bk', el).onclick = async () => {
    const b = await a.store.backup();
    download(`acutive_backup_${a.today}${b.mode === 'demo' ? '_DEMO' : ''}.json`, JSON.stringify(b, null, 1), 'application/json');
  };
  $('#rs', el).onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (obj.mode === 'demo' && a.store.mode === 'supabase' && !(await confirmBox('デモのバックアップです', '本番にデモデータを取り込もうとしています。続けますか？', '取り込む'))) return;
      if (!(await confirmBox('バックアップから復元しますか？', `作成日時：${esc(obj.exported_at || '不明')}`, '復元する'))) return;
      const n = await a.store.restore(obj);
      toast(`${n}件を復元しました`); a.render();
    } catch (er) { toast('復元できませんでした：' + er.message, 'err'); }
  };
  const out = $('#out', el);
  if (out) out.onclick = async () => { await a.store.signOut(); location.hash = ''; location.reload(); };

  const LABEL = { customers: '顧客', sales: '売上', expenses: '支出', trips: '移動', withdrawals: '取り出し', fund_entries: '資金', settings: '設定' };
  try {
    const logs = await a.store.auditLog(50);
    $('#audit', el).innerHTML = logs.map((l) => {
      const n = l.new_data || {}, o = l.old_data || {};
      let what = l.action === 'INSERT' ? '登録' : '修正';
      if (n.voided_at && !o.voided_at) what = `取消（${esc(n.void_reason || '')}）`;
      else if (o.voided_at && !n.voided_at && l.action === 'UPDATE') what = '取消を戻す';
      else if (l.action === 'UPDATE' && n.paid && !o.paid) what = '入金';
      const amt = n.amount !== undefined ? ` ${yen(n.amount)}${o.amount !== undefined && o.amount !== n.amount ? `（旧 ${yen(o.amount)}）` : ''}` : '';
      return `<div class="li"><span>${new Date(l.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} ${LABEL[l.table_name] || l.table_name}・${what}${amt}</span></div>`;
    }).join('') || '<p class="muted">なし</p>';
  } catch (er) { $('#audit', el).innerHTML = `<p class="err">${esc(er.message)}</p>`; }
}
