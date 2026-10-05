# アーキテクチャ

## 基本方針

会計データの正本と証憑本体をSupabaseに集約する。Google Sheetsは確認・照合・集計用のビューとして扱う。

## 構成

- Database: Supabase PostgreSQL
- 証憑: Supabase Storage
- Database schema: `accounting`（原則private）
- Storage bucket:
  - `accounting-receipts`（private）
  - `accounting-imports`（private）
- Web UI: Next.js（将来）
- API / バッチ: FastAPIまたはサーバーサイド処理（必要になった段階で実装）
- 確認画面: Google Sheets
- 認証: Supabase Authを使う場合も、認可は別途RLS/サーバー側で制御する

## データフロー

### 証憑

```text
紙領収書 / 電子領収書
        |
        v
画像・PDFの確認/構造化
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

### 銀行・カード

```text
GMOあおぞら銀行 CSV ----+
                         +--> accounting.import_files
三井住友カード CSV ------+         |
                                   v
                       bank_transactions /
                       card_transactions
                                   |
                                   v
                            仕訳候補・照合
                                   |
                                   v
                               journals
```

### 2025年度MF移行

```text
MF API
  |
  +--> raw JSON / CSVを保存
  |
  +--> journals / journal_lines
  |
  +--> MF試算表・PL・BSと比較
```

## セキュリティ

- `accounting` schemaは機密データを扱うため、原則として直接公開しない。
- exposed schemaにテーブルを置く場合はRLSを有効化し、所有会社・ユーザー等に基づく明示的なpolicyを設定する。
- Storage bucketはprivateとする。
- 証憑閲覧は認証付きdownloadまたは期限付きsigned URLを利用する。
- service role / secret keyはサーバー側だけで使用する。
- Storageの実ファイル操作はStorage API経由で行い、`storage` schemaを直接更新しない。

## 監査・整合性

- posted仕訳のupdate/deleteは禁止し、修正は新規仕訳で行う。
- 証憑ファイルは原則上書きしない。
- 証憑にSHA-256を保持する。
- インポート元CSV/JSONにもSHA-256を保持する。
- 外部データは`source_system` / `source_record_id` / `source_row_hash`で追跡する。

## Google Sheets

Sheetsは以下に限定する。

- 未照合確認
- 証憑を開く
- 仕訳候補確認
- 月次集計
- 試算表 / PL / BSの確認

SheetsからDBへ反映する場合は、直接テーブル編集ではなく、検証付きのサーバー処理を介する。
