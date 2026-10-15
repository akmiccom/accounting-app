# DDL / Migration運用

## 方針

- 会計データは`accounting` schemaに分離する。
- 会計・証憑は機密データのため、初期段階では`anon` / `authenticated`から直接アクセスさせない。
- Storageは`accounting-receipts`と`accounting-imports`のprivate bucketを前提とする。
- Storage objectの作成・削除・移動はStorage API経由で行う。
- 本番DBの定義は`supabase/migrations/`を正本とする。
- `docs/ddl.sql`は初期DDLの参考ではなく、現在の主要構造を把握するための参照用ミラーとして扱う。

## これまでに追加された主な構造

初期スキーマに加え、migrationで次を追加・変更している。

- MF仕訳移行用のsource情報・entry_kind等
- 会計帳票View
  - general_ledger_v
  - trial_balance_v
  - monthly_profit_loss_v
  - monthly_balance_sheet_v
  - annual_profit_loss_v
  - annual_balance_sheet_v
- receiptsのCloudBox索引用拡張
- FY2025
- draft仕訳の一時的な借貸不一致許容
- 旧三井住友カード補助科目
- FY2025 MF仕訳・証憑リンク
- 銀行・カードCSV取込および自動照合
- reconciliation_groupsによるカード集合照合
- bank_transactions.reconciliation_status
- card_transaction_reconciliation_v
- bank_transaction_reconciliation_v

## 仕訳整合性

現在は`journals.total_debit = total_credit`の常時CHECKではなく、draft → posted時の`validate_journal_posting`でバランスを検証する。

理由:

- journal_linesを1行ずつ追加する途中では一時的に借貸不一致となる。
- 明細トリガーは親仕訳のtotalを逐次再計算する。
- postedへ遷移する時点で2行以上かつ借貸一致を必須にする方が実装と整合する。

## 照合整合性

### カード

- 1対1確定: `matched_journal_id`
- 集合照合: `reconciliation_groups`
- 表示用: `card_transaction_reconciliation_v`

### 銀行

- 1対1確定: `matched_journal_id`
- 状態: `reconciliation_status`
- 表示用: `bank_transaction_reconciliation_v`

## 監査設計

- posted / reversed仕訳は直接更新・削除しない。
- 修正は反対仕訳/調整仕訳を追加する。
- 証憑差替えは同一Storage pathの上書きではなく、新規receiptを登録し`supersedes_receipt_id`で関連付ける。
- 証憑・インポート原本にはSHA-256を記録する。

## 適用手順

```powershell
npx supabase db push --dry-run
npx supabase db push
```

適用前に対象migrationを確認し、適用後はSELECTで件数・制約・照合状態を検証する。

## 注意

古い`ddl.sql`だけを本番DBの定義とみなさない。現在の本番スキーマはmigration履歴の累積結果である。
