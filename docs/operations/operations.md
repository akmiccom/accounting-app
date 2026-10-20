# 運用ルール

## 仕訳のライフサイクル

- draft: 入力・照合途中。編集可能。作成途中は一時的な借貸不一致を許容する。
- posted: 確定済み。直接編集・削除しない。
- reversed: 反対仕訳・調整仕訳との関係を追跡する状態。

draft → posted時にDB側で次を検証する。

- 明細2行以上
- 借方合計 > 0
- 借方合計 = 貸方合計

posted後に誤りが判明した場合は、元仕訳を書き換えず、新しい反対仕訳または調整仕訳を追加する。

## 証憑

- 証憑本体はSupabase Storageのprivate bucketに保存する。
- 証憑ファイルは原則上書きしない。
- DBにはreceipt_code、取引日、金額、取引先、Storage path、原本ファイル名、MIME type、SHA-256等を保存する。
- 読み取れない項目は推測せずNULL/要確認として扱う。
- 訂正・差替えは新規receiptとして保存し、旧receiptとの関係を残す。
- signed URLは一時的な閲覧用であり、DBへ恒久保存しない。
- Google Drive受付で使用した原本のfile ID、原本名、hash等は追跡可能な形で残す。

## インポート

### MFクラウド

- 2025年度はMFを基準データとする。
- API取得したraw JSON/CSVを保存する。
- 元journal IDを保持する。
- MFの試算表・PL・BSと自前集計が一致するまでMFを解約しない。
- 年度末に9/28～10/31分を追加取得する。

### GMOあおぞらネット銀行

- CSV原本をStorageに保存する。
- SHA-256で同一ファイルの重複取込を防ぐ。
- 各行にsource_row_hashを付与する。
- `direct / pending_journal / review / unmatched`で状態管理する。
- 銀行実績が先行し、対応仕訳がまだ取り込まれていない場合は`pending_journal`とする。

### 法人カード

- CSV原本・ハッシュ・取込履歴を残す。
- 利用日・利用先・金額・支払日を正規化する。
- 1対1で確定できる場合は`matched_journal_id`でdirect照合する。
- 同日・同額など1対1が決められないが集合として一致する場合はreconciliation groupで照合する。
- 無理に1対1の組合せを作らない。

## Google Sheets

- DBからの確認・集計用途に限定する。
- Sheetsを唯一の保存場所にしない。
- 証憑はSheets上のリンクから開けるようにする。
- Sheetsから会計DBへ反映する場合は検証付きの処理を介する。

## DB変更

- 本番DDL・データ更新は原則migrationで管理する。
- `npx supabase db push --dry-run`で対象を確認してから`npx supabase db push`する。
- 適用後はSELECTで件数・照合状態・制約を確認する。
- 読み取り確認と変更操作を分離する。

## バックアップ

- 年度締め前後に、仕訳・マスタ・証憑一覧・インポート一覧をエクスポートする。
- 証憑・CSV・MF raw原本のStorage保存漏れを解消する。
- MF解約前に必要資料・APIデータ・帳票を最終保存する。
- バックアップを取得するだけでなく、復元可能性を確認する。

## セキュリティ

- service role / secret keyをフロントエンド、Google Sheets、公開リポジトリに置かない。
- Storageはprivate bucketとする。
- `accounting` schemaは初期段階ではサーバー側からのみ操作する。
- 直接Data APIへ公開する場合はRLSとauthorization設計を先に行う。

## 法令確認

電子帳簿保存法の要件は制度改正があり得るため、本番運用開始時と各年度切替時に国税庁の最新資料を確認する。
