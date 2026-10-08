# DDL草案（Supabase PostgreSQL）

実体は [ddl.sql](ddl.sql) を参照する。

## 方針

- 会計データは `accounting` schema に分離する。
- 会計・証憑は機密データのため、初期段階では `anon` / `authenticated` から直接アクセスさせない。
- Web UIから直接Data APIを使う段階になった場合は、公開範囲とRLS policyを改めて設計する。
- Storageは `accounting-receipts` と `accounting-imports` のprivate bucketを前提とする。
- Storage objectの作成・削除・移動はStorage API経由で行い、`storage` schemaを直接更新しない。

## 既存MVPからの主な追加

- `sub_accounts`
- `receipts`
- `journal_receipts`
- `import_files`
- `bank_transactions`
- `card_transactions`

## 監査設計

- `journals.status = posted` 以降は直接更新・削除しない。
- 修正は反対仕訳/調整仕訳を追加する。
- `reversal_of_journal_id` で修正関係を追跡する。
- 証憑差替えは同一Storage pathの上書きではなく、新規receiptを登録し `supersedes_receipt_id` で関連付ける。
- 証憑・インポート原本にはSHA-256を記録する。

## MF移行

MFクラウド由来のデータは、`source_system = 'mf_cloud'` とし、MF側のjournal IDを `source_record_id` に保存する。
必要な移行検証情報は `source_data` に保持するが、恒久運用で不要な巨大JSONを無制限に格納しない。

## 実装時の注意

このDDLは設計草案であり、まだ本番DBに適用するmigrationではない。
Supabaseへ適用する際は、現在のSupabase CLI・PostgreSQLバージョン・Data API設定を確認し、migrationとして作成する。
適用後はRLS、Storage policy、database advisorを確認する。
