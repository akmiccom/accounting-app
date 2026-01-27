# データモデル

## テーブル一覧（MVP）
- companies（会社）
- fiscal_years（年度/期）
- accounts（勘定科目）
- journals（仕訳ヘッダ）
- journal_lines（仕訳明細）
- audit_logs（監査ログ）

## テーブル概要

### companies
| カラム | 型 | 説明 |
| --- | --- | --- |
| id | UUID | 会社ID |
| name | text | 会社名 |
| created_at | timestamp | 作成日時 |

### fiscal_years
| カラム | 型 | 説明 |
| --- | --- | --- |
| id | UUID | 期ID |
| company_id | UUID | 会社ID |
| name | text | 例: 2024年度 |
| start_date | date | 期首日 |
| end_date | date | 期末日 |
| is_closed | boolean | 期末締め |

### accounts
| カラム | 型 | 説明 |
| --- | --- | --- |
| id | UUID | 勘定科目ID |
| company_id | UUID | 会社ID |
| code | text | 科目コード |
| name | text | 科目名 |
| category | text | 資産/負債/純資産/収益/費用 |
| is_active | boolean | 有効フラグ |

### journals
| カラム | 型 | 説明 |
| --- | --- | --- |
| id | UUID | 仕訳ID |
| company_id | UUID | 会社ID |
| fiscal_year_id | UUID | 期ID |
| entry_date | date | 取引日 |
| voucher_no | text | 伝票番号 |
| description | text | 摘要 |
| status | text | draft/posted/reversed |
| total_debit | numeric | 借方合計 |
| total_credit | numeric | 貸方合計 |
| created_by | UUID | 作成者 |
| created_at | timestamp | 作成日時 |

### journal_lines
| カラム | 型 | 説明 |
| --- | --- | --- |
| id | UUID | 明細ID |
| journal_id | UUID | 仕訳ID |
| account_id | UUID | 勘定科目ID |
| side | text | debit/credit |
| amount | numeric | 金額 |
| memo | text | 摘要 |
| department | text | 部門（任意） |

### audit_logs
| カラム | 型 | 説明 |
| --- | --- | --- |
| id | UUID | ログID |
| company_id | UUID | 会社ID |
| actor_id | UUID | 操作者 |
| action | text | create/update/post/reverse/import |
| target_type | text | journals/accounts/etc |
| target_id | UUID | 対象ID |
| before | jsonb | 変更前 |
| after | jsonb | 変更後 |
| created_at | timestamp | 実行日時 |

## 制約・ルール
- journal_lines の借方合計 = 貸方合計
- posted 以降の journals は update/delete 不可
- 修正は reversal/adjustment の追加仕訳で行う
