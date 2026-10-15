# API詳細設計（将来実装）

> 現時点ではAPI未実装。DBの制約・trigger・viewが正本であり、本書は将来のサーバーAPI設計案とする。

## 共通仕様

### 認証・認可

- 認証: JWT（Authorization: Bearer <token>）
- 権限: admin / accountant / viewer
- 監査ログ: 重要操作（作成/更新/確定/修正/インポート/照合）で記録

### 日付・金額

- 日付: `YYYY-MM-DD`
- 金額: NUMERIC(14,2)相当

## 仕訳

### POST /api/journals

- 概要: draft仕訳作成
- 権限: accountant以上
- draft保存時点では借貸不一致を許容する
- 明細追加・編集に伴いDB側でtotalを再計算する

### PATCH /api/journals/{id}

- `status=draft`のみ更新可能

### POST /api/journals/{id}/post

- `status=draft`のみ
- DB側で次を必須検証する
  - 明細2行以上
  - 借方合計 > 0
  - 借方合計 = 貸方合計
- 成功後`posted`
- 監査ログ記録

### POST /api/journals/{id}/reverse

- `status=posted`のみ
- 元仕訳を直接変更しない
- 反対仕訳または調整仕訳を新規作成して関連付ける

## 帳票

DB Viewを基本ソースとする。

- GET /api/ledger → `general_ledger_v`
- GET /api/trial-balance → `trial_balance_v`
- GET /api/reports/pl → monthly / annual PL view
- GET /api/reports/bs → monthly / annual BS view

## カード照合

### GET /api/reconciliation/cards

`card_transaction_reconciliation_v`を参照する。

status:

- direct
- group
- review
- unmatched

`group`では個別の`matched_journal_id`を無理に設定しない。

## 銀行照合

### GET /api/reconciliation/banks

`bank_transaction_reconciliation_v`を参照する。

status:

- direct
- pending_journal
- review
- unmatched

`pending_journal`は銀行実績が確認済みだが、対応する仕訳がまだDBへ取り込まれていない状態。

## インポート

### POST /api/imports/mf

- raw原本を保存
- source_record_idで重複を防止
- draft組立後にpostedへ遷移
- 取込結果を検証

### POST /api/imports/bank

- 原本ファイルのSHA-256で重複を防止
- 行単位source_row_hashで重複を防止
- 既存仕訳との保守的な自動照合

### POST /api/imports/card

- 原本ファイルのSHA-256で重複を防止
- 行単位source_row_hashで重複を防止
- 1対1の一意一致のみdirect
- 一意に決められない同日同額等はgroup候補として扱う

## エラー設計

代表例:

- validation_error
- journal_not_balanced
- journal_finalized
- duplicate_import_file
- duplicate_source_record
- ambiguous_reconciliation
- invalid_reconciliation_transition

## 監査ログ

対象:

- accounts
- journals
- receipts
- imports
- reconciliation

操作:

- create
- update
- post
- reverse
- import
- link
- reconcile
