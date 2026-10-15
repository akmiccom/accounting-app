# アーキテクチャ

## 基本方針

会計データの正本と証憑本体を会計専用Supabaseプロジェクトに集約する。スロット分析等の他用途のSupabaseプロジェクトとは完全分離する。Google Sheetsは確認・照合・集計用のビューとして扱い、正本にはしない。

2025年度はMFクラウドを会計処理の基準として並行検証し、2026年度からSupabase中心の運用へ移行する。

## 構成

- Database: 会計専用 Supabase PostgreSQL
- Database schema: `accounting`
- 証憑・取込原本: Supabase Storage
- Storage bucket:
  - `accounting-receipts`（private）
  - `accounting-imports`（private）
- 証憑受付: Google Drive + AIによる構造化
- 確認画面: Google Sheets
- Web UI: Next.js（将来）
- API / バッチ: 必要になった段階でサーバーサイド処理を実装

## データフロー

### 証憑

```text
紙領収書 / 電子領収書
        |
        v
Google Drive受付
        |
        v
AIで内容確認・JSON化
        |
        +--> Supabase Storage (private)
        |
        +--> accounting.receipts
                 |
                 v
        accounting.journal_receipts
                 |
                 v
        accounting.journals
```

証憑の不明項目は推測せず、要確認として保持する。元ファイル名、SHA-256、Storage path、source情報を保持する。

### 銀行・カード

```text
GMOあおぞら銀行 CSV ----+
                         +--> accounting.import_files
法人カード CSV ----------+          |
                                    v
                         bank_transactions /
                         card_transactions
                                    |
                                    v
                              照合処理
                         /                \
             direct / group          pending/review
                         \                /
                                    v
                                 journals
```

カードの1対1照合が一意でない場合は`reconciliation_groups`を使って集合として照合する。
銀行実績はあるが対応仕訳がまだ未取込の場合は`pending_journal`とする。

### 2025年度MF移行

```text
MF API
  |
  +--> raw JSON / CSVを保存
  |
  +--> journals / journal_lines
  |
  +--> 証憑 / カード / 銀行との照合
  |
  +--> MF試算表・PL・BSと比較
```

## 主要テーブル・View

### Core

- companies
- fiscal_years
- accounts
- sub_accounts
- journals
- journal_lines
- audit_logs

### Evidence / Import

- receipts
- journal_receipts
- import_files
- bank_transactions
- card_transactions

### Reconciliation

- reconciliation_groups
- reconciliation_group_card_transactions
- reconciliation_group_journals
- card_transaction_reconciliation_v
- bank_transaction_reconciliation_v

### Reports

- general_ledger_v
- trial_balance_v
- monthly_profit_loss_v
- monthly_balance_sheet_v
- annual_profit_loss_v
- annual_balance_sheet_v

## セキュリティ

- `accounting` schemaは原則として直接公開しない。
- RLSを有効化し、初期段階では`anon` / `authenticated`向けpolicyを作らない。
- Storage bucketはprivateとする。
- 証憑閲覧は認証付きdownloadまたは期限付きsigned URLを利用する。
- service role / secret keyはサーバー側だけで使用する。
- Storageの実ファイル操作はStorage API経由で行う。
- project ref、URL、APIキー、接続情報はGitへコミットしない。

## 監査・整合性

- draft作成中は一時的な借貸不一致を許容する。
- draft → posted時に2行以上かつ借方合計 = 貸方合計 > 0を検証する。
- posted / reversed仕訳のupdate/deleteは禁止する。
- 証憑ファイルは原則上書きしない。
- 証憑・取込元CSV/JSONにSHA-256を保持する。
- 外部データは`source_system` / `source_record_id` / `source_row_hash`で追跡する。
- 自動照合で一意に決められない場合は無理に直接紐付けしない。
- 本番DB変更は原則migrationで管理し、適用後にSELECTで検証する。

## Google Sheets

Sheetsは以下に限定する。

- 未照合・pending・review確認
- 証憑を開く
- 仕訳候補確認
- 月次集計
- 試算表 / PL / BS確認

SheetsからDBへ反映する場合は、直接テーブル編集ではなく検証付きのサーバー処理を介する。
