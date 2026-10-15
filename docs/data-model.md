# データモデル

## テーブル一覧

### 会計コア

- companies
- fiscal_years
- accounts
- sub_accounts
- journals
- journal_lines
- audit_logs

### 証憑

- receipts
- journal_receipts

### 外部データ取込

- import_files
- bank_transactions
- card_transactions

### 照合

- reconciliation_groups
- reconciliation_group_card_transactions
- reconciliation_group_journals

## journals

主要項目:

- company_id
- fiscal_year_id
- entry_date
- voucher_no
- description
- memo
- status: draft / posted / reversed
- total_debit
- total_credit
- source_system
- source_record_id
- source_data
- reversal_of_journal_id

主要ルール:

- draftは作成途中のため一時的な借貸不一致を許容する。
- draft → posted時に2行以上かつ借方合計 = 貸方合計 > 0を検証する。
- posted / reversedは直接update/deleteしない。
- 外部由来の仕訳は`source_system` + `source_record_id`で重複を防ぐ。
- voucher_noの一意性は会計年度を考慮する実装へ移行済み。

## journal_lines

- journal_id
- line_no
- account_id
- sub_account_id
- side: debit / credit
- amount
- memo
- department
- tax_name
- partner_name

明細変更時に親仕訳の`total_debit` / `total_credit`を再計算する。

## receipts

証憑の検索・追跡に必要な情報を保持する。

主要項目:

- company_id
- receipt_code
- transaction_date
- supplier_name
- amount
- currency
- document_kind
- storage_bucket / storage_path
- original_filename
- mime_type
- sha256
- captured_at
- supersedes_receipt_id
- source_metadata
- source_system
- source_record_id
- external_url
- import_file_id

### 不明項目

過去データやAI読取で確定できない`transaction_date` / `supplier_name` / `amount`は推測せずNULLを許容する。
特にMF CloudBox移行では日付不明34件をNULLのまま保持している。

### receipt_code

`receipt_code`は証憑の内部識別子として使用する。取引日・取引先・金額など訂正可能な情報を識別子の意味に依存させすぎない。

## journal_receipts

仕訳と証憑は多対多とする。`relation_type`で関係を表現する。

## import_files

MF JSON/CSV、銀行CSV、カードCSVなど取込元ファイル自体を記録する。

主要項目:

- company_id
- source_system
- file_kind
- storage_bucket / storage_path
- original_filename
- sha256
- row_count
- imported_at
- import_metadata

`company_id + source_system + sha256`で同一取込原本の重複登録を防ぐ。

## bank_transactions

主要項目:

- company_id
- import_file_id
- source_system
- transaction_date
- amount
- description
- balance
- source_record_id
- source_row_hash
- matched_journal_id
- reconciliation_status
- raw_data

`reconciliation_status`:

- direct
- pending_journal
- review
- unmatched

`matched_journal_id`が設定された場合は`direct`として扱う。

## card_transactions

主要項目:

- company_id
- import_file_id
- source_system
- used_date
- merchant_name
- amount
- payment_date
- source_record_id
- source_row_hash
- matched_journal_id
- raw_data

直接照合できないが集合として一致するケースは、カード行側へ無理に`matched_journal_id`を設定せず、reconciliation groupを利用する。

## reconciliation_groups

同日・同額等で個別の1対1対応は確定できないが、集合として対応関係が確定できる場合に使用する。

主要項目:

- company_id
- group_key
- source_kind
- match_method
- status
- match_date
- amount
- transaction_count
- journal_count
- metadata

関連テーブル:

- reconciliation_group_card_transactions
- reconciliation_group_journals

## Views

- general_ledger_v
- trial_balance_v
- monthly_profit_loss_v
- monthly_balance_sheet_v
- annual_profit_loss_v
- annual_balance_sheet_v
- card_transaction_reconciliation_v
- bank_transaction_reconciliation_v

## 主要ルール

- posted以降の仕訳は直接update/deleteしない。
- 証憑のStorage objectは原則上書きしない。
- 証憑差替えは新規receiptを作り、`supersedes_receipt_id`で履歴を残す。
- 外部明細は`source_row_hash`で重複取込を防止する。
- 自動照合で一意に決められないものを無理に1対1へ結び付けない。
