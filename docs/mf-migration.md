# MFクラウド移行計画

## 目的

2025年度をMFクラウドと自前会計の並行検証期間とし、2026年度からSupabase中心の運用へ移行する。

## 2021年度～2024年度

- MF由来の仕訳をSupabaseへ移行済み。
- FY2024は総勘定元帳・試算表・月次PL/BSまで詳細照合済み。
- FY2021～FY2023は構造・借貸一致を確認済み。
- 過年度は参照・検証用として保持する。

## 2025年度（2025-11-01 ～ 2026-10-31）

MFクラウドを基準とする。

### 現在の到達点

- MF仕訳: 403件
- journal_lines: 817件
- 取込範囲: 2025-11-01 ～ 2026-09-27
- 借方合計 = 貸方合計 = 28,990,831円
- posted: 403件
- FY2025証憑: 218件を218仕訳へリンク済み
- カード: 318 / 318件を実効照合済み
  - direct 316
  - group 2
- 銀行:
  - direct 28
  - pending_journal 2

### 年度末に行うこと

1. 2026-09-28～2026-10-31のMF追加仕訳を再取得する
2. 10月分までの銀行・カードCSVを取り込む
3. カード・銀行を再照合する
4. pending_journalを解消する
5. 総勘定元帳・試算表・PL・BSをMF最終値と照合する
6. MF API rawデータ、帳票、証憑対応関係を最終保存する
7. Storage未保存の取込原本・証憑原本を補完する
8. バックアップと復元確認を行う
9. 決算・申告完了後にMF解約可否を判断する

## 2026年度（2026-11-01 ～ 2027-10-31）

Supabaseを正本とする。

- 仕訳: accounting.journals / accounting.journal_lines
- 証憑: accounting.receipts + Supabase Storage
- 銀行: GMOあおぞらネット銀行CSV
- 法人経費決済: GMOあおぞらネット銀行デビットカードを基本
- 確認/集計: Google Sheets
- 自動仕訳: 候補生成まで。postedは人が確認する

## MFデータの対応

| MF | accounting-app |
| --- | --- |
| journal id | journals.source_record_id |
| transaction_date | journals.entry_date |
| number | journals.voucher_no |
| memo | journals.memo |
| branch | journal_lines |
| debitor | journal_lines(side=debit) |
| creditor | journal_lines(side=credit) |
| remark | journal_lines.memo |
| account | accounts |
| sub account | sub_accounts |
| voucher_file_ids | source_data / journal_receiptsの検証に利用 |

本番で使用している`source_system`値は実データに合わせる。過去ドキュメントの`mf_cloud`固定表記を前提にしない。

## 証憑

- signed URLを恒久データとして保存しない。
- DBにはStorage bucket/pathおよび原本識別情報を保存する。
- CloudBoxファイル一覧918件をインデックス化済み。
- 日付不明34件は推測せずNULLのまま保持する。

## MF解約前チェック

- 仕訳全件
- 勘定科目・補助科目
- 総勘定元帳
- 仕訳帳
- 試算表
- PL
- BS
- 証憑との対応関係
- MF API rawデータ
- 銀行・カードとの最終照合
- 自前集計との一致確認
- Storage原本保存確認
- バックアップ・復元確認
- 決算・申告完了
