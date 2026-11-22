// 画面共通の小さな部品
import { esc } from './util.js';

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), 1800);
  setTimeout(() => t.remove(), 2300);
}

/** 1行入力のダイアログ（取消理由など）。キャンセルなら null */
export function askText({ title, label = '', value = '', placeholder = '', required = true, ok = 'OK', type = 'text' }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'sheet';
    d.innerHTML = `<form method="dialog">
      <h3>${esc(title)}</h3>
      ${label ? `<p class="muted">${esc(label)}</p>` : ''}
      <input name="v" type="${type}" ${type === 'number' ? 'inputmode="numeric"' : ''} value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''}>
      <div class="row gap"><button value="cancel" formnovalidate class="btn ghost">やめる</button><button value="ok" class="btn primary">${esc(ok)}</button></div>
    </form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => { const v = d.returnValue === 'ok' ? d.querySelector('input').value.trim() : null; d.remove(); resolve(v); });
    d.showModal();
    setTimeout(() => d.querySelector('input').focus(), 50);
  });
}

export function confirmBox(title, body = '', ok = 'OK') {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'sheet';
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>${body ? `<p>${body}</p>` : ''}
      <div class="row gap"><button value="cancel" class="btn ghost">やめる</button><button value="ok" class="btn primary">${esc(ok)}</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => { const v = d.returnValue === 'ok'; d.remove(); resolve(v); });
    d.showModal();
  });
}

let busy = false;
/**
 * 保存処理の共通ラッパー
 *  - 実行中はボタンを無効化（連打防止）
 *  - 失敗時は入力を残したままエラー表示。再度押すと同じIDで再送（DB側で重複無視）
 */
export async function saving(btn, errBox, fn) {
  if (busy || btn.disabled) return false;
  busy = true;
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '保存中…';
  if (errBox) errBox.hidden = true;
  try {
    await fn();
    return true;
  } catch (e) {
    console.warn(e);
    if (errBox) {
      errBox.hidden = false;
      errBox.innerHTML = `<b>保存できませんでした</b>：${esc(e.message)}<br>入力内容はそのまま残っています。もう一度押すと同じ内容で再送します（二重登録にはなりません）。`;
    } else toast(e.message, 'err');
    return false;
  } finally {
    busy = false; btn.disabled = false; btn.textContent = label;
  }
}

export function download(filename, content, type = 'text/csv;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const opt = (v, label, sel) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(label ?? v)}</option>`;
