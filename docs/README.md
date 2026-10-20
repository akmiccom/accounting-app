# ドキュメント一覧

このディレクトリは、会計アプリの設計・運用・移行・外部連携・会計処理方針をカテゴリ別に整理しています。

## product

要件と画面構成。

- [要件・スコープ](product/requirements.md)
- [画面構成案](product/ui-structure.md)

## architecture

システム構成、データモデル、DDL。

- [アーキテクチャ](architecture/architecture.md)
- [データモデル](architecture/data-model.md)
- [DDL草案](architecture/ddl.md)
- [DDL SQL](architecture/ddl.sql)

## api

将来のAPI設計。

- [API概要](api/api-overview.md)
- [API詳細設計](api/api-detail.md)

## operations

日常運用と電子帳簿保存法を意識した証憑管理。

- [運用ルール](operations/operations.md)
- [電子帳簿保存法を意識した証憑管理](operations/electronic-bookkeeping.md)

## migration

既存サービスからの移行。

- [MFクラウド移行計画](migration/mf-migration.md)

## integrations

外部サービス・データの取込仕様。

- [楽天証券CSVの仕訳取込](integrations/rakuten-securities-import.md)

## accounting

個別の会計処理方針と過年度訂正履歴。

- [楽天証券 VTI 配当金の会計処理方針](accounting/rakuten-dividend-policy.md)

## 位置付け

- 会計DB・実装ロジックの正本は、Supabaseのschema / migration / code。
- 本ディレクトリは設計意図・運用ルール・会計方針を説明する文書。
- 過年度の確定仕訳は直接書き換えず、訂正仕訳と監査ログで履歴を残す。
