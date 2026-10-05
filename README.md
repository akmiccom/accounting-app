# Accounting App

akmic合同会社の会計処理を、Money Forward クラウド依存から段階的に自社管理へ移行するためのリポジトリです。

## 目的

- 仕訳・証憑・銀行明細・カード明細を追跡可能な形で管理する
- 確定仕訳は直接書き換えず、修正仕訳で履歴を残す
- Supabase PostgreSQL を会計データの正本、Supabase Storage を証憑本体の保存先とする
- Google Sheets は確認・照合・集計用の画面として使い、正本にはしない
- MFクラウドの2025年度データを使って自前集計を検証し、決算・申告・最終バックアップ後に解約できる状態を作る
- 電子帳簿保存法の真実性・可視性・検索性を意識した証憑管理を行う

## 対象年度と移行方針

### 2025年度: 2025-11-01 ～ 2026-10-31

- MFクラウドを正式な会計処理の基準として継続
- MF APIで仕訳を取得し、Supabase側へ試験移行する
- 領収書・請求書等の証憑はGoogle Drive等に保管し、MF仕訳のメモから直接開けるリンクを付ける
- MFの試算表・PL・BSと、自前集計結果を照合する
- 決算・申告完了後に最終バックアップを取得してからMFクラウド解約を判断する

### 2026年度: 2026-11-01 ～ 2027-10-31

- Supabaseを会計DB＋証憑本体の保存基盤として運用する
- GMOあおぞらネット銀行と三井住友カードはCSV取込を基本とする
- Google Sheetsで未照合・仕訳候補・月次集計・帳票を確認する
- 自動仕訳は候補生成までとし、当面は人が確認してpostedにする

## 基本構成

```text
MFクラウド（2025年度の基準）
GMOあおぞらネット銀行 CSV
三井住友カード CSV
receipt-processor / 証憑入力
            |
            v
Supabase
├─ accounting schema
│  ├─ companies / fiscal_years
│  ├─ accounts / sub_accounts
│  ├─ journals / journal_lines
│  ├─ receipts / journal_receipts
│  ├─ import_files
│  ├─ bank_transactions
│  ├─ card_transactions
│  └─ audit_logs
└─ Storage (private)
   ├─ accounting-receipts
   └─ accounting-imports
            |
            v
Google Sheets
├─ 確認
├─ 証憑照合
├─ 未処理一覧
├─ 月次集計
├─ 試算表
├─ PL
└─ BS
```

## 重要ルール

- 1仕訳内で借方合計 = 貸方合計
- posted仕訳は直接更新・削除せず、反対仕訳または調整仕訳で修正する
- 証憑本体は原則上書きしない
- 証憑のハッシュ（SHA-256）、保存先、登録日時、原本ファイル名を記録する
- Supabase Storageの証憑bucketはprivateを前提とする
- Google Sheetsに正本を置かない
- service role / secret keyをブラウザや公開リポジトリに置かない

## ドキュメント

- [要件・スコープ](docs/requirements.md)
- [アーキテクチャ](docs/architecture.md)
- [データモデル](docs/data-model.md)
- [DDL草案](docs/ddl.md)
- [DDL SQL](docs/ddl.sql)
- [MFクラウド移行計画](docs/mf-migration.md)
- [電子帳簿保存法を意識した証憑管理](docs/electronic-bookkeeping.md)
- [API概要](docs/api-overview.md)
- [API詳細設計](docs/api-detail.md)
- [画面構成案](docs/ui-structure.md)
- [運用ルール](docs/operations.md)

## 実装順

1. Supabase向けデータモデル確定
2. 2025年度MF仕訳のインポート
3. MF試算表・PL・BSとの一致検証
4. 証憑Storage＋receipts＋journal_receipts
5. GMOあおぞら銀行CSV取込
6. 三井住友カードCSV取込
7. Google Sheets確認・集計
8. 2026年度の本運用
