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

## companies

| カラム | 説明 |
| --- | --- |
| id | 会社ID |
| name | 会社名 |
| created_at | 作成日時 |

## fiscal_years

| カラム | 説明 |
| --- | --- |
| id | 期ID |
| company_id | 会社ID |
| name | 例: 2025年度 |
| start_date | 期首 |
| end_date | 期末 |
| is_closed | 締め済み |

akmic合同会社では、2025年度は2025-11-01～2026-10-31、2026年度は2026-11-01～2027-10-31を想定する。

## accounts / sub_accounts

勘定科目と補助科目を分離して保持する。MFクラウドから移行する際は、名称だけでなく元IDも`source_record_id`として保持できる設計にする。

## journals

| カラム | 説明 |
| --- | --- |
| id | 仕訳ID |
| company_id | 会社ID |
| fiscal_year_id | 期ID |
| entry_date | 取引日 |
| voucher_no | 伝票番号 |
| description | 仕訳摘要 |
| memo | 仕訳レベルメモ |
| status | draft / posted / reversed |
| total_debit | 借方合計 |
| total_credit | 貸方合計 |
| source_system | manual / mf_cloud / bank_csv / card_csv 等 |
| source_record_id | 元システム上のID |
| source_data | 移行検証用の最小限の元データ |
| reversal_of_journal_id | 反対仕訳元 |
| created_at | 作成日時 |

## journal_lines

| カラム | 説明 |
| --- | --- |
| id | 明細ID |
| journal_id | 仕訳ID |
| line_no | 明細番号 |
| account_id | 勘定科目 |
| sub_account_id | 補助科目 |
| side | debit / credit |
| amount | 金額 |
| memo | 明細摘要 |
| department | 部門 |
| tax_name | 税区分名 |
| partner_name | 取引先名 |

## receipts

証憑の検索・追跡に必要な情報を保持する。

| カラム | 説明 |
| --- | --- |
| id | 内部ID |
| company_id | 会社ID |
| receipt_code | R-YYYYMMDD-NNNN等 |
| transaction_date | 取引日 |
| supplier_name | 取引先 |
| amount | 金額 |
| document_kind | paper_scan / electronic_original / other |
| storage_bucket | Storage bucket |
| storage_path | Storage object path |
| original_filename | 原本ファイル名 |
| mime_type | MIME type |
| sha256 | ファイルハッシュ |
| captured_at | 受領/撮影日時 |
| created_at | DB登録日時 |
| supersedes_receipt_id | 訂正時の旧証憑 |

`transaction_date`、`amount`、`supplier_name`は電子保存の検索性を意識して必須項目とする。

## journal_receipts

仕訳と証憑は多対多とする。1仕訳に複数領収書、1証憑を複数明細に関連付けるケースに対応する。

## import_files

MF JSON/CSV、銀行CSV、カードCSVなど、取込元ファイル自体を記録する。

主要項目:

- source_system
- file_kind
- storage_bucket
- storage_path
- original_filename
- sha256
- imported_at
- row_count

## bank_transactions

GMOあおぞらネット銀行等の銀行明細を正規化して保持する。

- transaction_date
- amount
- description
- balance
- source_row_hash
- matched_journal_id

## card_transactions

三井住友カード等のカード利用明細を正規化して保持する。

- used_date
- merchant_name
- amount
- payment_date
- source_row_hash
- matched_journal_id

## audit_logs

作成、更新、確定、反対仕訳、インポート、証憑紐付け等を記録する。

## 主要ルール

- journal_linesの借方合計 = 貸方合計
- posted以降の仕訳は直接update/deleteしない
- 証憑のStorage objectは原則上書きしない
- 証憑差替えは新規receiptを作り、`supersedes_receipt_id`で履歴を残す
- 外部明細は`source_row_hash`で重複取込を防止する
