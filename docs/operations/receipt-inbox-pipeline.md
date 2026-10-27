# 領収書Inbox処理パイプライン

## 目的

`H:\\マイドライブ\\akmic合同会社\\15_経理\\01_領収書受付` を、紙レシートとWebインボイスを混在させて投入できる単一の受付箱として扱う。

処理はできるだけコードで行い、紙レシートなどコードだけでは安定しない入力に限ってAIを使う。仕訳生成とは分離し、証憑の取込・分類・保存・台帳登録・既存仕訳との照合までを独立したパイプラインとする。

## 基本方針

- Google Driveは受付箱として使う。
- 証憑原本の正式保管先はSupabase Storageのprivate bucket `accounting-receipts` とする。
- 証憑台帳の正本は `accounting.receipts` とする。
- 仕訳との対応は `accounting.journal_receipts` で管理する。
- 証憑の取込処理では新規仕訳を作らない。
- 仕訳が未作成の場合は `receipts` に保持し、後日の再照合対象とする。
- AIは常用せず、紙レシートとコード処理失敗時のフォールバックに限定する。

## 入力

受付フォルダには次を混在させてよい。

- 紙レシートを撮影・スキャンした JPG / PNG / PDF
- Webから取得したPDFインボイス
- メール添付のPDF領収書・請求書

フォルダ分けは不要とし、取込時に内容から分類する。

## document_kind

`accounting.receipts.document_kind` は少なくとも次を使用する。

- `paper_receipt`: 紙レシートの撮影・スキャン
- `electronic_invoice`: Web発行の請求書・インボイス
- `electronic_receipt`: Web発行の領収書
- `unknown`: 自動分類できず要確認

`source_system` は証憑の種類ではなく、どこから取り込んだかを表す。

例:

- `google_drive_inbox`
- `gmail_attachment`
- `manual_upload`

## 処理順序

```text
01_領収書受付
    ↓
新規ファイル検出
    ↓
SHA-256計算
    ↓
完全重複チェック
    ↓
ファイル形式・内容判定
    ├─ テキスト抽出可能なPDF
    │    ↓
    │  コード解析
    │    ├─ 必須項目取得成功 → receipts登録へ
    │    └─ 取得失敗 → AIフォールバック
    │
    └─ JPG / PNG / 画像PDF
         ↓
       AIで画像を直接解析
         ↓
       receipts登録へ
    ↓
Supabase Storageへ原本保存
    ↓
accounting.receipts登録
    ↓
既存journalとの照合
    ↓
一意に確定 → journal_receipts
確定しない → receiptsのまま待機
```

## コード優先ルール

### Webインボイス

テキストレイヤーを持つPDFはAIを使わずコードで解析する。

発行元ごとにパーサーを用意し、次を抽出する。

- transaction_date
- supplier_name
- amount
- currency
- invoice number / receipt number
- tax registration number（取得できる場合）
- original_filename
- mime_type
- sha256

例: Supabase PDFでは `Invoice number`、`Receipt date`、`Amount paid` 等を正規表現で取得できる。

未知のPDFでも、共通ルールで必須項目を取得できればAIへ送らない。

### 紙レシート

紙レシートはOCR文字列だけに依存しない。

撮影歪み、感熱紙、薄い印字、縦長レシート等でOCR結果が崩れるケースが多いため、画像をAIへ直接渡して構造化結果を取得する。

最低限取得する項目:

- transaction_date
- supplier_name
- amount
- currency
- 適格請求書発行事業者登録番号（読める場合）

取得できない項目は推測せずNULLまたは要確認とする。

## 重複判定

### 1. 完全重複

原本ファイルのSHA-256が既存 `receipts.sha256` と一致した場合は同一ファイルとして自動スキップする。

ファイル名は重複判定に使用しない。同名のスキャンファイルが存在してもDrive file IDと内容が異なるケースがあるため。

### 2. 同一証憑候補

SHA-256が異なっていても、次が一致する場合は同じ証憑を再撮影・再取得した可能性があるため自動確定せず要確認とする。

- transaction_date
- supplier_name
- amount

必要になった場合のみ画像のperceptual hash等を追加する。

## Storage

正式保存先:

```text
accounting-receipts/
  YYYY/
    MM/
      <receipt_code>.<ext>
```

`receipts` には次を保持する。

- storage_bucket
- storage_path
- original_filename
- mime_type
- sha256
- source_system
- source_record_id
- source_metadata

AIやコードによる抽出結果の補助情報は、別JSONファイルを必須とせず `source_metadata` JSONBに保存する。

## 仕訳との照合

証憑取込時に新規仕訳は作成しない。

`reconcile-receipts.mjs` が未リンクの `receipts` と既存 `journals` を照合する。

基本条件:

1. 取引日
2. 金額
3. 候補が1件なら採用
4. 複数候補なら取引先名・摘要等を比較

一意に確定できない場合は自動リンクしない。

仕訳がまだ存在しない証憑は `receipts` に保持し、銀行・カード明細から仕訳が作成された後に再照合する。

## 既存スクリプトとの関係

### 維持する

- `scripts/sync-drive-receipts.mjs`
  - 既存の「Driveで生成済みJSON → receipts」取込用。
  - 既存データと移行期間の互換性のため当面残す。
- `scripts/reconcile-receipts.mjs`
  - receiptsとjournalsの照合・journal_receipts作成。
  - 新パイプラインでも継続使用する。

### 新規追加予定

- `scripts/process-receipt-inbox.mjs`
  - Inbox全体のオーケストレーター。
  - previewを標準で用意し、本実行前に分類・重複・抽出結果を確認できるようにする。
- `scripts/lib/receipt-file.mjs`
  - SHA-256、MIME/拡張子、ファイル情報。
- `scripts/lib/receipt-classifier.mjs`
  - paper / electronic / unknown の分類。
- `scripts/lib/receipt-pdf-parser.mjs`
  - テキストPDFの共通解析と発行元別パーサー。
- `scripts/lib/receipt-ai-parser.mjs`
  - 紙レシートとコード解析失敗時だけ呼び出すAI処理。

AI実装は特定プロバイダに密結合させず、呼び出し部分を分離する。

## 定期実行

想定スケジュール: 毎週月曜21:00。

順序:

1. Inboxの新規ファイル検出
2. SHA-256重複判定
3. 内容分類
4. Webインボイスをコード解析
5. 紙レシート・失敗ファイルのみAI解析
6. Storage保存
7. receipts登録
8. reconcile-receipts
9. 未処理・要確認件数を出力

定期処理で仕訳を自動postedにはしない。

## 実装フェーズ

### Phase 1

- Inbox分類preview
- SHA-256
- WebインボイスPDFのコード解析
- AI対象の切り分け
- DB/Storageへ書き込まない分類テスト

### Phase 2

- Storageアップロード
- receipts直接登録
- 冪等性・重複判定
- reconcile-receipts連携

### Phase 3

- 紙レシートAI解析
- AI失敗時の要確認処理
- 毎週月曜21時の定期実行

## 安全ルール

- previewではStorage、DB、Driveを変更しない。
- 元ファイルは取込完了確認前に移動・削除しない。
- AIが返した値を無条件で採用しない。
- 必須項目不足は要確認とする。
- 同一証憑候補は自動削除しない。
- service role等の秘密情報をリポジトリへ保存しない。
