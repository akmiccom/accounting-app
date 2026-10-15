# Accounting App

akmic合同会社の会計処理を、Money Forward クラウド依存から段階的に自社管理へ移行するためのリポジトリです。

## 目的

- 仕訳・証憑・銀行明細・カード明細を追跡可能な形で管理する
- 確定仕訳は直接書き換えず、修正仕訳で履歴を残す
- 会計専用Supabaseプロジェクトを作成し、そのPostgreSQLを会計データの正本、Storageを証憑本体・取込原本の保存先とする
- Google Sheets は確認・照合・集計用の画面として使い、正本にはしない
- MFクラウドの2025年度データを使って自前集計を検証し、決算・申告・最終バックアップ後に解約できる状態を作る
- 電子帳簿保存法の真実性・可視性・検索性を意識した証憑管理を行う

## 対象年度と移行方針

### 2021年度～2024年度

- MFクラウドから過年度仕訳をSupabaseへ移行済み
- 2024年度を基準年度として、総勘定元帳・試算表・月次PL/BSを手動照合済み
- 年次PL/BSをSupabase Viewで再現
- 過年度は原則として参照・検証用とし、posted仕訳は直接変更しない

### 2025年度: 2025-11-01 ～ 2026-10-31

- MFクラウドを正式な会計処理の基準として継続する
- MF仕訳CSVをSupabaseへ追加取り込みし、自前集計と照合する
- GMO銀行CSV・SMBCカードCSVをSupabaseへ取り込み、MF仕訳と再照合する
- 同じCSVを再投入しても二重登録しない冪等インポートを前提とする
- 決算・申告完了後に最終バックアップを取得してからMFクラウド解約を判断する
- 年度末まではMF側で追加された仕訳を再取得し、未照合を解消する

### 2026年度: 2026-11-01 ～ 2027-10-31

- Supabaseを会計DB＋証憑本体の保存基盤として運用する
- GMOあおぞらネット銀行はAPI自動取込を基本とし、CSVはバックアップ・検証用とする
- 法人カードは当面CSV取込を基本とする
- Google Sheetsで未照合・仕訳候補・月次集計・帳票を確認する
- 自動仕訳は候補生成までとし、当面は人が確認してpostedにする
- 法人経費はGMOあおぞらネット銀行のデビットカードを基本決済手段とする

## 現在の到達点

### MF仕訳

- FY2021～FY2024: Supabaseへ移行済み
- FY2024: 総勘定元帳・試算表・月次PL/BSまで基準資料と一致確認済み
- FY2025: 425仕訳 / 861明細を取り込み済み
- FY2025取込範囲: 2025-11-01 ～ 2026-10-14
- FY2025仕訳は425件すべてposted
- MF仕訳CSVインポータは再投入時に既存仕訳をduplicate判定し、二重登録しない
- 2026-09-01～2026-10-16抽出CSVでは、初回追加22件・既存35件、再投入時57件すべてduplicateを確認済み

### 証憑

- MF CloudBoxファイル一覧: 918件をインデックス化済み
- FY2025証憑: 218件を仕訳218件へリンク済み
- 日付不明34件は推測せず `transaction_date = NULL` のまま要確認として保持する
- 証憑・取込原本のStorage実体保存は、未完了分を今後補完する

### カード照合

FY2025対象SMBCカード明細は354件。

- `direct`: 318件
- `group`: 2件
- `review`: 0件
- `unmatched`: 34件

同日・同額で1対1対応を安全に決められない場合は、無理に `matched_journal_id` を設定せず、
`reconciliation_groups` を使って集合として照合する。

現在の `group` 2件は 2026-04-11 / 150円 × 2件で、カード2件と仕訳2件を2対2のグループとして照合済み。

`unmatched` は主に、カードCSV側には存在するが対応MF仕訳がまだ未取込、または対象期間外・照合条件未成立の明細。
MF仕訳追加取込後は `npm run reconcile:preview` / `npm run reconcile:run` で安全な1対1候補だけ再照合する。

### 銀行照合

FY2025対象GMOあおぞらネット銀行明細は39件。

- `direct`: 39件
- `pending_journal`: 0件
- `review`: 0件
- `unmatched`: 0件

2026-09-28 三井住友カード引落 45,700円、2026-10-01 普通預金利息 279円、
および2026-10-10以降のVisaデビット明細を、追加取得したMF仕訳と再照合済み。

## Supabaseプロジェクト方針

- 会計用は専用Supabaseプロジェクトとして運用する
- スロット分析用SupabaseプロジェクトとはDB・Storage・Auth・APIキーを完全分離する
- 会計プロジェクト内では `accounting` schema とprivate Storage bucketで会計データを整理する
- project ref、URL、APIキー、接続情報、service role keyはリポジトリへコミットしない
- 本番DDL・データ更新は原則migrationで管理し、`npx supabase db push` で適用する
- 読み取り確認はSELECTで行い、監査可能な変更経路を保つ

## 基本構成

```text
MFクラウド（2025年度の基準）
GMOあおぞらネット銀行 CSV
法人カード CSV
Google Drive / AI証憑入力
        |
        v
会計専用 Supabase Project
├─ accounting schema
│  ├─ companies / fiscal_years
│  ├─ accounts / sub_accounts
│  ├─ journals / journal_lines
│  ├─ receipts / journal_receipts
│  ├─ import_files
│  ├─ bank_transactions
│  ├─ card_transactions
│  ├─ reconciliation_groups
│  ├─ reconciliation_group_card_transactions
│  ├─ reconciliation_group_journals
│  └─ audit_logs
│
├─ accounting Views
│  ├─ general_ledger_v
│  ├─ trial_balance_v
│  ├─ monthly_profit_loss_v
│  ├─ monthly_balance_sheet_v
│  ├─ annual_profit_loss_v
│  ├─ annual_balance_sheet_v
│  ├─ card_transaction_reconciliation_v
│  └─ bank_transaction_reconciliation_v
│
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

## CSV取込・照合・仕訳ワークフロー

現在、GMO銀行・SMBCカード・MFクラウドの3系統のCSVを同じ会計DBへ取り込み、照合して仕訳へつなげる運用が可能。

### 1. GMO銀行CSV

プレビュー:

```powershell
npm run bank:preview:gmo:csv -- "path\to\gmo.csv"
```

本取込:

```powershell
npm run bank:import:gmo:csv -- "path\to\gmo.csv"
```

取込先は `accounting.bank_transactions`。同一明細はハッシュ・source IDで重複登録しない。

### 2. SMBCカードCSV

プレビュー:

```powershell
npm run card:preview:smbc:csv -- "path\to\smbc.csv"
```

本取込:

```powershell
npm run card:import:smbc:csv -- "path\to\smbc.csv"
```

取込先は `accounting.card_transactions`。同一明細は再投入しても重複登録しない。

### 3. MFクラウド仕訳CSV

プレビュー:

```powershell
npm run journal:preview:mf:csv -- "path\to\moneyforward.csv"
```

本取込:

```powershell
npm run journal:import:mf:csv -- "path\to\moneyforward.csv"
```

MF仕訳CSVは、取引No単位で借方・貸方を解決して `journals / journal_lines` へ取り込む。
既存仕訳と会計本体が一致する場合は `duplicate`、posted済み仕訳と内容が異なる場合は `conflict` として止める。
新規MF仕訳は元データが確定仕訳であるため `posted` として登録する。

### 4. 銀行・カード明細とMF仕訳の再照合

候補確認:

```powershell
npm run reconcile:preview
```

反映:

```powershell
npm run reconcile:run
```

再照合は、MF CSVインポータで追加された仕訳を対象に、日付・金額が1対1で一意に対応する場合だけ
`matched_journal_id` を設定する。曖昧な候補は自動では結び付けない。

### 5. MFを使わないFY2026以降の仕訳候補

銀行・カード明細から自前仕訳候補を作成する場合:

```powershell
npm run journal:candidates:preview
npm run journal:candidates:generate
```

`accounting_rules` を優先し、ルールがない場合は過去の照合済み仕訳履歴から分類候補を作る。
現在は purchaseルール13件、bankルール3件を登録済み。

**重要:** GMO/SMBC CSVを取り込んだだけでは確定仕訳を自動postedしない。
自動生成するのは `draft` の仕訳候補までで、人が確認してpostedへ進める。
これはFY2026本運用開始時の誤仕訳防止のための安全設計。

### 現在できること

```text
GMO CSV ─────┐
             ├─> bank/card transactions ─┐
SMBC CSV ────┘                            │
                                          ├─> 照合
MF仕訳CSV ─────> posted journals ─────────┘
                                          │
                                          └─> PL / BS / 総勘定元帳等

FY2026以降:
GMO / SMBC明細
    ↓
accounting_rules / 過去履歴
    ↓
draft仕訳候補
    ↓
人が確認
    ↓
posted
```

## GMOあおぞらネット銀行 API

sunabarで、法人APIの以下の疎通を確認済みです。

- 口座一覧照会
- 残高照会
- 入出金明細照会

API明細は `scripts/sync-gmo-bank.mjs` で `accounting.bank_transactions` へ取り込みます。

`itemKey` は口座IDごとの明細キーなので、DB側では `accountId:itemKey` を `source_record_id` として保持します。入出コードは `1=入金`、`2=出金` として、DBの `amount` は入金を正、出金を負に正規化します。

実行例:

```powershell
npm run bank:sync:gmo -- --from=2026-10-01 --to=2026-10-15
```

DBへ書き込まずAPIレスポンスだけ確認する場合（npmの `--dry-run` と衝突しないよう `--preview` を使用）:

```powershell
npm run bank:sync:gmo -- --from=2026-10-01 --to=2026-10-15 --preview
```

認証情報は `.env.local` にのみ保存し、Gitへコミットしません。

## 照合ステータス

### カード

- `direct`: 1対1で仕訳と直接照合
- `group`: 同日・同額などで個別対応を確定できないが、集合として照合済み
- `review`: 候補はあるが人の確認が必要
- `unmatched`: 対応候補なし

### 銀行

- `direct`: 仕訳と直接照合
- `pending_journal`: 銀行実績はあるが対応仕訳がまだ未取込
- `review`: 候補はあるが人の確認が必要
- `unmatched`: 対応候補なし

## 重要ルール

- 1仕訳内で借方合計 = 貸方合計とし、draftからpostedへの遷移時に検証する
- posted仕訳は直接更新・削除せず、反対仕訳または調整仕訳で修正する
- 当初作成中のdraftは一時的に借貸不一致を許容する
- 証憑本体は原則上書きしない
- 証憑のハッシュ（SHA-256）、保存先、登録日時、原本ファイル名を記録する
- 証憑の日付・金額・店舗等が不明な場合は推測せず、要確認として残す
- Supabase Storageの証憑bucketはprivateを前提とする
- Google Sheetsに正本を置かない
- service role / secret keyをブラウザや公開リポジトリに置かない
- 自動照合で一意に決められないものを無理に1対1へ結び付けない
- 元CSV・元証憑・MF取得原本は再現性確認のため保持する

## 直近の次作業

1. 2026-10-15～2026-10-31のMF最終仕訳を追加CSV取込する
2. 10月後半のGMO銀行・SMBCカード明細を追加取込する
3. `reconcile:preview` → `reconcile:run` で最終再照合する
4. FY2025の未照合カード明細を確認し、MF最終仕訳取込後も残るものだけ要確認とする
5. FY2025の総勘定元帳・試算表・PL・BSをMF最終値と照合する
6. FY2026開始後、`journal:candidates:preview` で自前仕訳候補の精度を検証する
7. 証憑・カードCSV・銀行CSV・MF原本のStorage未保存分を補完する
8. 最終バックアップと復元確認を行う
9. 決算・申告完了後にMFクラウド解約を判断する

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

## 実装状況

- [x] Supabase向けデータモデル確定
- [x] FY2021～FY2024 MF仕訳インポート
- [x] FY2024 基準資料との詳細照合
- [x] FY2025 MF仕訳の中間インポート
- [x] MF仕訳CSVの増分・冪等インポート
- [x] MF CloudBox証憑インデックス取込
- [x] FY2025証憑と仕訳のリンク
- [x] GMOあおぞら銀行CSV取込
- [x] 法人カードCSV取込
- [x] カード直接照合
- [x] カード2対2グループ照合
- [x] 銀行照合ステータス管理
- [x] GMO / SMBC / MF CSV間の再照合コマンド
- [x] accounting_rulesによるdraft仕訳候補生成
- [ ] FY2025年度末MF仕訳の最終取込（10/15～10/31）
- [ ] FY2025カード・銀行最終再照合
- [ ] Storage原本保存の未完了分補完
- [ ] Google Sheets確認・集計画面
- [ ] FY2025最終帳票照合
- [ ] 最終バックアップ・復元確認
- [ ] MFクラウド解約
- [ ] FY2026本運用
