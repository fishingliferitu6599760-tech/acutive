# セットアップ・公開手順

所要時間：30〜45分。**★印はご本人のアカウント操作が必要な箇所**です（こちらでは実施していません）。

## 1. Supabase プロジェクトを作る ★
1. https://supabase.com にサインアップし、「New project」を作成。
   - Region：Northeast Asia (Tokyo) を推奨。
   - Database Password：長いものを設定し、パスワード管理アプリに保存。
2. 作成完了まで数分待つ。

## 2. データベースを作る ★
1. 左メニュー「SQL Editor」→「New query」。
2. `supabase/schema.sql` の中身をすべて貼り付けて「Run」。
3. 「Table Editor」に customers / sales / expenses / trips / withdrawals / fund_entries / settings / audit_log ができていれば成功。
4. 「Database」→「Advisors」→ Security Advisor を開き、RLS未設定の警告が出ていないことを確認。

## 3. 本人のログインを作り、新規登録を止める ★
1. 「Authentication」→「Users」→「Add user」→「Create new user」で、ご自身のメールアドレスとパスワードを登録（Auto Confirm にチェック）。
2. 「Authentication」→「Sign In / Providers」（表記は変わることがあります）で **「Allow new users to sign up」をオフ**。
   - オフにしても、仮に第三者が登録できたとしてもRLSにより他人のデータは見えませんが、不要な入口は閉じておきます。
3. 可能なら同画面で多要素認証（MFA）の利用も検討してください（初版のアプリ画面はMFA入力に未対応。未実装事項参照）。

## 4. 接続設定を書く ★
1. 「Project Settings」→「API Keys」を開く。
2. `js/config.js` に以下を転記：
   ```js
   SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
   SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxxxxx',
   ```
   - **publishable key（sb_publishable_…）だけ**を書きます。これは公開して問題ない鍵で、データの保護はRLSが担います。
   - **secret key（sb_secret_…／旧 service_role）は絶対に書かない・コミットしない**。
   - 旧形式の anon key でも動作しますが、Supabaseは旧キーを2026年末までに廃止予定としているため publishable key を使ってください。
3. 「Authentication」→「URL Configuration」の Site URL に、次の手順で決まるGitHub PagesのURLを登録。

## 5. GitHub Pages で公開 ★
1. GitHubで新しいリポジトリ（例 `acutive`）を作成。無料プランなら Public。
2. このフォルダ一式を push（`node_modules/` は .gitignore 済み）。
   ```
   git init && git add . && git commit -m "Acutive v1" && git branch -M main
   git remote add origin https://github.com/<ユーザー名>/acutive.git && git push -u origin main
   ```
3. リポジトリの「Settings」→「Pages」→ Source：Deploy from a branch／Branch：main・/(root) → Save。
4. 数分後 `https://<ユーザー名>.github.io/acutive/` で開けます。
5. スマホのSafariで開き、共有ボタン →「ホーム画面に追加」。

**GitHubに置いてよいもの**：コード、schema.sql、config.js（URLと公開鍵のみ）。
**置いてはいけないもの**：バックアップJSON、出力したCSV、secret key、DBパスワード（.gitignore で一部を除外済みですが、置き場所自体を分けてください）。

## 6. 初回の動作確認
1. ログイン → ホームの「開始残高を登録してください」から、手元の副業用現金を登録。
2. 試しに売上を1件登録 → Supabaseの「Table Editor」→ sales に行ができることを確認 → アプリで取消。
3. 別のブラウザ（シークレットウィンドウ）でURLを開き、ログインしないとデータが見えないことを確認。

## 7. 自分でテストを動かす場合（任意）
```
npm install
npm test          # 集計・CSV・データベースのアクセス制御テスト（29件）
```
データベースのテストは、PCの中だけで動くPostgres（PGlite）に schema.sql を適用し、本人以外のアクセス拒否などを確認します。実際のSupabaseには接続しません。

## 更新するとき
- 画面の修正：ファイルを直して push するだけ。
- 表の追加・変更：`supabase/schema.sql` の変更分を SQL Editor で実行してからアプリを更新。実行前にバックアップを取ってください。
