# MFクラウド移行計画

## 目的

2025年度をMFクラウドと自前会計の並行検証期間とし、2026年度からSupabase中心の運用へ移行する。

## 2025年度（2025-11-01 ～ 2026-10-31）

MFクラウドを基準とする。

1. MF APIから仕訳を取得する
2. raw JSON / raw CSV / 展開CSVを保存する
3. 証憑がある仕訳は、MFのメモから証憑を直接開けるようにする
4. journals / journal_linesへ試験インポートする
5. 勘定科目・補助科目をマッピングする
6. 自前で総勘定元帳・試算表・PL・BSを計算する
7. MF出力と一致確認する
8. 決算・申告を完了する
9. MF上の必要データを最終バックアップする
10. 解約可否を判断する

## 2026年度（2026-11-01 ～ 2027-10-31）

Supabaseを正本とする。

- 仕訳: accounting.journals / accounting.journal_lines
- 証憑: accounting.receipts + Supabase Storage
- 銀行: GMOあおぞらネット銀行CSV
- カード: 三井住友カードCSV
- 確認/集計: Google Sheets

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
| voucher_file_ids | 移行検証用source_data、または証憑紐付け確認に利用 |

## 証憑

2025年度のMF仕訳メモには、JSONファイル名ではなく、利用者が直接証憑を確認できるリンクを入れる。

ただし2026年度の自前システムでは、期限付きsigned URLを恒久データとして保存しない。
DBにはStorage bucket/pathを保存し、閲覧時にURLを生成する。

## MF解約前チェック

- 仕訳全件のバックアップ
- 勘定科目・補助科目
- 試算表
- PL
- BS
- 総勘定元帳
- 仕訳帳
- 証憑との対応関係
- MF API rawデータ
- 自前集計との一致確認
- 決算・申告完了
