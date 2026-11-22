import { chromium, devices } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const out = process.env.OUT || '/tmp/e2e/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const shot = (n) => page.screenshot({ path: out + n + '.png', fullPage: true });
const log = (...a) => console.log(...a);

await page.goto('http://localhost:8123/');
await page.waitForSelector('.cards');
await shot('01_home');
const lsBefore = await page.evaluate(() => JSON.stringify(localStorage));

// 売上登録：最近の顧客チップ → 金額 → 保存（連打）
await page.click('a.btn.big.primary');
await page.waitForSelector('#q');
await shot('02_sale_form');
await page.click('.chips .chip >> nth=0');
await page.fill('#amount', '6500');
await shot('03_sale_filled');
const countBefore = await page.evaluate(() => document.querySelectorAll('.list .li').length);
await Promise.all([page.click('#save'), page.click('#save').catch(() => {}), page.click('#save').catch(() => {})]);
await page.waitForSelector('.cards');
// 新規顧客を検索から追加
await page.click('a.btn.big.primary');
await page.fill('#q', '田中 新規');
await page.click('#addNew');
await page.fill('#amount', '5000');
await page.click('summary');
await page.click('label:has(input[name=paid][value="0"])');
await page.click('#save');
await page.waitForSelector('.cards');
await shot('04_home_after');

// 売上一覧で件数確認（6500は1件だけ）
await page.click('nav.tabs a[data-m=sale]');
await page.waitForSelector('.seg');
const n6500 = await page.locator('.list .li', { hasText: '¥6,500' }).count();
log('6500の件数（連打後）:', n6500);
// 未入金のみ → 入金
await page.click('label:has(input[name=flt][value=u])');
await shot('05_unpaid');
const unpaidN = await page.locator('[data-pay]').count();
await page.click('[data-pay] >> nth=0');
await page.click('dialog button[value=ok]');
await page.waitForTimeout(200);
log('未入金件数 入金前/後:', unpaidN, await page.locator('[data-pay]').count());

// 支出（個人立替）
await page.goto('http://localhost:8123/#/expense/new');
await page.waitForSelector('#amount');
await page.click('label:has(input[name=cat][value=消耗品])');
await page.fill('#amount', '1200');
await page.click('label:has(input[name=src][value=personal])');
await shot('06_expense');
await page.click('#save');
await page.waitForSelector('#settleAll');
await shot('07_expenses');

// 移動：メーター入力
await page.goto('http://localhost:8123/#/trips');
await page.waitForSelector('#km');
await page.click('label:has(input[name=mode][value=odo])');
await page.fill('#o1', '12000'); await page.fill('#o2', '12058'); await page.fill('#priv', '8');
log('概算表示:', await page.textContent('#est'));
await page.click('#save');
await page.waitForSelector('#settle');
await shot('08_trips');
await page.click('#settle');
await page.click('dialog button[value=ok]');
await page.waitForTimeout(300);
log('精算後の未精算見出し:', await page.locator('h3.sec').nth(0).textContent());

// 資金：取り出し・照合
await page.goto('http://localhost:8123/#/fund');
await page.waitForSelector('#w_amount');
const bal1 = await page.textContent('.card.strong .val');
await page.fill('#w_amount', '3000'); await page.click('#save_w');
await page.waitForTimeout(300);
const bal2 = await page.textContent('.card.strong .val');
log('取り出し前後の残高:', bal1, bal2);
await page.fill('#actual', '30000');
await page.dispatchEvent('#actual', 'input');
log('照合:', await page.textContent('#diff'));
await page.fill('#a_reason', '小銭の数え違い'); await page.click('#save_a');
await page.waitForTimeout(300);
log('照合後残高:', await page.textContent('.card.strong .val'));
await shot('09_fund');

// 出力
await page.goto('http://localhost:8123/#/report');
await page.waitForSelector('.tbl');
await shot('10_report_tax');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-csv="売上明細"]')]);
await dl.saveAs(out + 'sales.csv');
await page.click('label:has(input[name=p][value=plan])');
await page.waitForTimeout(200);
await shot('11_report_plan');
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-csv="plan"]')]);
await dl2.saveAs(out + 'plan.csv');
// 印刷画面
await page.evaluate(() => { window.print = () => {}; });
await page.click('#print');
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: out + 'print.pdf', format: 'A4' }).catch((e) => log('pdf skip', e.message));
await page.emulateMedia({ media: 'screen' });

// 顧客
await page.goto('http://localhost:8123/#/customers');
await page.waitForSelector('#clist .li');
await shot('12_customers');
await page.click('#clist .li >> nth=0');
await page.waitForSelector('#name');
await shot('13_customer_detail');

// 設定・バックアップ・変更履歴
await page.goto('http://localhost:8123/#/settings');
await page.waitForSelector('#audit .li');
const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('#bk')]);
await dl3.saveAs(out + 'backup.json');
await shot('14_settings');

// 売上取消
await page.goto('http://localhost:8123/#/sales');
await page.click('label:has(input[name=flt][value=m])');
await page.click('.list .li a >> nth=0');
await page.waitForSelector('#void');
await page.click('#void');
await page.fill('dialog input', 'テスト取消');
await page.click('dialog button[value=ok]');
await page.waitForTimeout(300);
log('取消済み表示:', await page.locator('.li.void').count());

// URLとlocalStorageに顧客・金額が出ていないか
log('URL例:', page.url());
log('localStorage（開始時/終了時）:', lsBefore, await page.evaluate(() => JSON.stringify(localStorage)));
log('エラー:', errors.length ? errors : 'なし');
await browser.close();
