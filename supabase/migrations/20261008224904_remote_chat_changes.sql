CREATE VIEW "accounting"."general_ledger_v" WITH (security_invoker=true) AS  SELECT j.company_id,
    j.fiscal_year_id,
    j.id AS journal_id,
    j.entry_date,
    j.voucher_no,
    j.entry_kind,
    j.status,
    jl.line_no,
    jl.side,
    jl.amount,
    a.id AS account_id,
    a.code AS account_code,
    a.name AS account_name,
    a.category AS account_category,
    sa.id AS sub_account_id,
    sa.code AS sub_account_code,
    sa.name AS sub_account_name,
        CASE
            WHEN (jl.side = 'debit'::text) THEN ((((j.source_data -> 'branches'::text) -> (jl.line_no - 1)) -> 'creditor'::text) ->> 'account_name'::text)
            ELSE ((((j.source_data -> 'branches'::text) -> (jl.line_no - 1)) -> 'debitor'::text) ->> 'account_name'::text)
        END AS counter_account_name,
        CASE
            WHEN (jl.side = 'debit'::text) THEN ((((j.source_data -> 'branches'::text) -> (jl.line_no - 1)) -> 'creditor'::text) ->> 'sub_account_name'::text)
            ELSE ((((j.source_data -> 'branches'::text) -> (jl.line_no - 1)) -> 'debitor'::text) ->> 'sub_account_name'::text)
        END AS counter_sub_account_name,
    jl.memo,
    jl.department,
    jl.tax_name,
    jl.partner_name,
    j.source_system,
    j.source_record_id
   FROM (((accounting.journal_lines jl
     JOIN accounting.journals j ON ((j.id = jl.journal_id)))
     JOIN accounting.accounts a ON ((a.id = jl.account_id)))
     LEFT JOIN accounting.sub_accounts sa ON ((sa.id = jl.sub_account_id)))
  WHERE (j.status = 'posted'::text);

CREATE VIEW "accounting"."monthly_balance_sheet_v" WITH (security_invoker=true) AS  WITH fy AS (
         SELECT fiscal_years.id AS fiscal_year_id,
            fiscal_years.company_id,
            fiscal_years.start_date,
            fiscal_years.end_date
           FROM accounting.fiscal_years
        ), periods AS (
         SELECT fy.company_id,
            fy.fiscal_year_id,
            gs.gs AS period_no,
            ((fy.start_date + (((gs.gs - 1))::double precision * '1 mon'::interval)))::date AS period_start,
            (((fy.start_date + ((gs.gs)::double precision * '1 mon'::interval)) - '1 day'::interval))::date AS period_end
           FROM (fy
             CROSS JOIN generate_series(1, 12) gs(gs))
        ), keys AS (
         SELECT DISTINCT j.company_id,
            j.fiscal_year_id,
            a.id AS account_id,
            a.code AS account_code,
            a.name AS account_name,
            a.category,
            sa.id AS sub_account_id,
            sa.code AS sub_account_code,
            COALESCE(sa.name, ''::text) AS sub_account_name
           FROM ((((accounting.general_ledger_v gl
             JOIN accounting.journals j ON ((j.id = gl.journal_id)))
             JOIN accounting.journal_lines jl ON (((jl.journal_id = gl.journal_id) AND (jl.line_no = gl.line_no) AND (jl.side = gl.side))))
             JOIN accounting.accounts a ON ((a.id = jl.account_id)))
             LEFT JOIN accounting.sub_accounts sa ON ((sa.id = jl.sub_account_id)))
          WHERE (a.category = ANY (ARRAY['asset'::text, 'liability'::text, 'equity'::text]))
        UNION
         SELECT DISTINCT j.company_id,
            j.fiscal_year_id,
            a.id,
            a.code,
            a.name,
            a.category,
            NULL::uuid AS uuid,
            NULL::text AS text,
            ''::text AS text
           FROM (((accounting.general_ledger_v gl
             JOIN accounting.journals j ON ((j.id = gl.journal_id)))
             JOIN accounting.journal_lines jl ON (((jl.journal_id = gl.journal_id) AND (jl.line_no = gl.line_no) AND (jl.side = gl.side))))
             JOIN accounting.accounts a ON ((a.id = jl.account_id)))
          WHERE (a.category = ANY (ARRAY['asset'::text, 'liability'::text, 'equity'::text]))
        ), base AS (
         SELECT k.company_id,
            k.fiscal_year_id,
            k.account_id,
            k.account_code,
            k.account_name,
            k.category,
            k.sub_account_id,
            k.sub_account_code,
            k.sub_account_name,
            p_1.period_no,
            p_1.period_start,
            p_1.period_end,
            COALESCE(sum(
                CASE
                    WHEN ((j.entry_kind = 'opening'::text) AND (jl.side = 'debit'::text)) THEN jl.amount
                    WHEN ((j.entry_kind = 'opening'::text) AND (jl.side = 'credit'::text)) THEN (- jl.amount)
                    ELSE (0)::numeric
                END), (0)::numeric) AS opening_signed_debit,
            COALESCE(sum(
                CASE
                    WHEN ((j.entry_kind = 'regular'::text) AND (j.entry_date <= p_1.period_end) AND (jl.side = 'debit'::text)) THEN jl.amount
                    WHEN ((j.entry_kind = 'regular'::text) AND (j.entry_date <= p_1.period_end) AND (jl.side = 'credit'::text)) THEN (- jl.amount)
                    ELSE (0)::numeric
                END), (0)::numeric) AS ordinary_signed_debit_cum
           FROM (((keys k
             JOIN periods p_1 USING (company_id, fiscal_year_id))
             LEFT JOIN accounting.journals j ON (((j.company_id = k.company_id) AND (j.fiscal_year_id = k.fiscal_year_id) AND (j.status = 'posted'::text))))
             LEFT JOIN accounting.journal_lines jl ON (((jl.journal_id = j.id) AND (jl.account_id = k.account_id) AND (((k.sub_account_id IS NULL) AND (k.sub_account_name = ''::text)) OR (jl.sub_account_id = k.sub_account_id)))))
          GROUP BY k.company_id, k.fiscal_year_id, k.account_id, k.account_code, k.account_name, k.category, k.sub_account_id, k.sub_account_code, k.sub_account_name, p_1.period_no, p_1.period_start, p_1.period_end
        ), pl_ytd AS (
         SELECT p_1.company_id,
            p_1.fiscal_year_id,
            p_1.period_no,
            COALESCE(sum(
                CASE
                    WHEN ((a.category = 'revenue'::text) AND (j.entry_kind = 'regular'::text) AND (j.entry_date <= p_1.period_end)) THEN
                    CASE
                        WHEN (jl.side = 'credit'::text) THEN jl.amount
                        ELSE (- jl.amount)
                    END
                    WHEN ((a.category = 'expense'::text) AND (j.entry_kind = 'regular'::text) AND (j.entry_date <= p_1.period_end)) THEN
                    CASE
                        WHEN (jl.side = 'debit'::text) THEN (- jl.amount)
                        ELSE jl.amount
                    END
                    ELSE (0)::numeric
                END), (0)::numeric) AS net_income_ytd
           FROM (((periods p_1
             LEFT JOIN accounting.journals j ON (((j.company_id = p_1.company_id) AND (j.fiscal_year_id = p_1.fiscal_year_id) AND (j.status = 'posted'::text))))
             LEFT JOIN accounting.journal_lines jl ON ((jl.journal_id = j.id)))
             LEFT JOIN accounting.accounts a ON ((a.id = jl.account_id)))
          GROUP BY p_1.company_id, p_1.fiscal_year_id, p_1.period_no
        ), final_bal AS (
         SELECT k.company_id,
            k.fiscal_year_id,
            k.account_id,
            k.sub_account_id,
            k.sub_account_name,
            COALESCE(sum(
                CASE
                    WHEN (jl.side = 'debit'::text) THEN jl.amount
                    WHEN (jl.side = 'credit'::text) THEN (- jl.amount)
                    ELSE (0)::numeric
                END), (0)::numeric) AS final_signed_debit,
            COALESCE(sum(
                CASE
                    WHEN ((j.entry_kind = 'opening'::text) AND (jl.side = 'debit'::text)) THEN jl.amount
                    WHEN ((j.entry_kind = 'opening'::text) AND (jl.side = 'credit'::text)) THEN (- jl.amount)
                    ELSE (0)::numeric
                END), (0)::numeric) AS opening_signed_debit
           FROM ((keys k
             LEFT JOIN accounting.journals j ON (((j.company_id = k.company_id) AND (j.fiscal_year_id = k.fiscal_year_id) AND (j.status = 'posted'::text))))
             LEFT JOIN accounting.journal_lines jl ON (((jl.journal_id = j.id) AND (jl.account_id = k.account_id) AND (((k.sub_account_id IS NULL) AND (k.sub_account_name = ''::text)) OR (jl.sub_account_id = k.sub_account_id)))))
          GROUP BY k.company_id, k.fiscal_year_id, k.account_id, k.sub_account_id, k.sub_account_name
        ), final_pl AS (
         SELECT j.company_id,
            j.fiscal_year_id,
            COALESCE(sum(
                CASE
                    WHEN ((a.category = 'revenue'::text) AND (j.entry_kind <> 'opening'::text)) THEN
                    CASE
                        WHEN (jl.side = 'credit'::text) THEN jl.amount
                        ELSE (- jl.amount)
                    END
                    WHEN ((a.category = 'expense'::text) AND (j.entry_kind <> 'opening'::text)) THEN
                    CASE
                        WHEN (jl.side = 'debit'::text) THEN (- jl.amount)
                        ELSE jl.amount
                    END
                    ELSE (0)::numeric
                END), (0)::numeric) AS net_income
           FROM ((accounting.journals j
             JOIN accounting.journal_lines jl ON ((jl.journal_id = j.id)))
             JOIN accounting.accounts a ON ((a.id = jl.account_id)))
          WHERE (j.status = 'posted'::text)
          GROUP BY j.company_id, j.fiscal_year_id
        )
 SELECT b.company_id,
    b.fiscal_year_id,
    b.account_id,
    b.account_code,
    b.account_name,
    b.category,
    b.sub_account_id,
    b.sub_account_code,
    NULLIF(b.sub_account_name, ''::text) AS sub_account_name,
    b.period_no,
    b.period_start,
    b.period_end,
        CASE
            WHEN ((b.account_name = '繰越利益剰余金'::text) AND (b.sub_account_name = ''::text)) THEN ((- b.opening_signed_debit) + p.net_income_ytd)
            WHEN (b.category = 'asset'::text) THEN (b.opening_signed_debit + b.ordinary_signed_debit_cum)
            ELSE ((- b.opening_signed_debit) - b.ordinary_signed_debit_cum)
        END AS ordinary_balance,
        CASE
            WHEN (b.period_no = 12) THEN
            CASE
                WHEN ((b.account_name = '繰越利益剰余金'::text) AND (b.sub_account_name = ''::text)) THEN ((- f.opening_signed_debit) + fp.net_income)
                WHEN (b.category = 'asset'::text) THEN f.final_signed_debit
                ELSE (- f.final_signed_debit)
            END
            ELSE NULL::numeric
        END AS year_end_adjusted_balance
   FROM (((base b
     JOIN pl_ytd p ON (((p.company_id = b.company_id) AND (p.fiscal_year_id = b.fiscal_year_id) AND (p.period_no = b.period_no))))
     JOIN final_bal f ON (((f.company_id = b.company_id) AND (f.fiscal_year_id = b.fiscal_year_id) AND (f.account_id = b.account_id) AND (NOT (f.sub_account_id IS DISTINCT FROM b.sub_account_id)) AND (f.sub_account_name = b.sub_account_name))))
     JOIN final_pl fp ON (((fp.company_id = b.company_id) AND (fp.fiscal_year_id = b.fiscal_year_id))));

CREATE VIEW "accounting"."monthly_profit_loss_v" WITH (security_invoker=true) AS  WITH fy AS (
         SELECT fiscal_years.id AS fiscal_year_id,
            fiscal_years.company_id,
            fiscal_years.start_date,
            fiscal_years.end_date
           FROM accounting.fiscal_years
        ), periods AS (
         SELECT fy.company_id,
            fy.fiscal_year_id,
            gs.gs AS period_no,
            ((fy.start_date + (((gs.gs - 1))::double precision * '1 mon'::interval)))::date AS period_start,
            (((fy.start_date + ((gs.gs)::double precision * '1 mon'::interval)) - '1 day'::interval))::date AS period_end
           FROM (fy
             CROSS JOIN generate_series(1, 12) gs(gs))
        ), keys AS (
         SELECT DISTINCT j.company_id,
            j.fiscal_year_id,
            a_1.id AS account_id,
            a_1.code AS account_code,
            a_1.name AS account_name,
            a_1.category,
            sa.id AS sub_account_id,
            sa.code AS sub_account_code,
            COALESCE(sa.name, ''::text) AS sub_account_name
           FROM ((((accounting.general_ledger_v gl
             JOIN accounting.journals j ON ((j.id = gl.journal_id)))
             JOIN accounting.journal_lines jl ON (((jl.journal_id = gl.journal_id) AND (jl.line_no = gl.line_no) AND (jl.side = gl.side))))
             JOIN accounting.accounts a_1 ON ((a_1.id = jl.account_id)))
             LEFT JOIN accounting.sub_accounts sa ON ((sa.id = jl.sub_account_id)))
          WHERE (a_1.category = ANY (ARRAY['revenue'::text, 'expense'::text]))
        UNION
         SELECT DISTINCT j.company_id,
            j.fiscal_year_id,
            a_1.id,
            a_1.code,
            a_1.name,
            a_1.category,
            NULL::uuid AS uuid,
            NULL::text AS text,
            ''::text AS text
           FROM (((accounting.general_ledger_v gl
             JOIN accounting.journals j ON ((j.id = gl.journal_id)))
             JOIN accounting.journal_lines jl ON (((jl.journal_id = gl.journal_id) AND (jl.line_no = gl.line_no) AND (jl.side = gl.side))))
             JOIN accounting.accounts a_1 ON ((a_1.id = jl.account_id)))
          WHERE (a_1.category = ANY (ARRAY['revenue'::text, 'expense'::text]))
        ), ordinary AS (
         SELECT k.company_id,
            k.fiscal_year_id,
            k.account_id,
            k.account_code,
            k.account_name,
            k.category,
            k.sub_account_id,
            k.sub_account_code,
            k.sub_account_name,
            p.period_no,
            p.period_start,
            p.period_end,
            COALESCE(sum(
                CASE
                    WHEN ((j.entry_kind = 'regular'::text) AND ((j.entry_date >= p.period_start) AND (j.entry_date <= p.period_end)) AND (jl.side = 'debit'::text)) THEN jl.amount
                    WHEN ((j.entry_kind = 'regular'::text) AND ((j.entry_date >= p.period_start) AND (j.entry_date <= p.period_end)) AND (jl.side = 'credit'::text)) THEN (- jl.amount)
                    ELSE (0)::numeric
                END), (0)::numeric) AS signed_debit
           FROM (((keys k
             JOIN periods p USING (company_id, fiscal_year_id))
             LEFT JOIN accounting.journals j ON (((j.company_id = k.company_id) AND (j.fiscal_year_id = k.fiscal_year_id) AND (j.status = 'posted'::text))))
             LEFT JOIN accounting.journal_lines jl ON (((jl.journal_id = j.id) AND (jl.account_id = k.account_id) AND (((k.sub_account_id IS NULL) AND (k.sub_account_name = ''::text)) OR (jl.sub_account_id = k.sub_account_id)))))
          GROUP BY k.company_id, k.fiscal_year_id, k.account_id, k.account_code, k.account_name, k.category, k.sub_account_id, k.sub_account_code, k.sub_account_name, p.period_no, p.period_start, p.period_end
        ), adjusting AS (
         SELECT k.company_id,
            k.fiscal_year_id,
            k.account_id,
            k.sub_account_id,
            k.sub_account_name,
            COALESCE(sum(
                CASE
                    WHEN ((j.entry_kind = 'adjusting'::text) AND (jl.side = 'debit'::text)) THEN jl.amount
                    WHEN ((j.entry_kind = 'adjusting'::text) AND (jl.side = 'credit'::text)) THEN (- jl.amount)
                    ELSE (0)::numeric
                END), (0)::numeric) AS signed_debit
           FROM ((keys k
             LEFT JOIN accounting.journals j ON (((j.company_id = k.company_id) AND (j.fiscal_year_id = k.fiscal_year_id) AND (j.status = 'posted'::text))))
             LEFT JOIN accounting.journal_lines jl ON (((jl.journal_id = j.id) AND (jl.account_id = k.account_id) AND (((k.sub_account_id IS NULL) AND (k.sub_account_name = ''::text)) OR (jl.sub_account_id = k.sub_account_id)))))
          GROUP BY k.company_id, k.fiscal_year_id, k.account_id, k.sub_account_id, k.sub_account_name
        )
 SELECT o.company_id,
    o.fiscal_year_id,
    o.account_id,
    o.account_code,
    o.account_name,
    o.category,
    o.sub_account_id,
    o.sub_account_code,
    NULLIF(o.sub_account_name, ''::text) AS sub_account_name,
    o.period_no,
    o.period_start,
    o.period_end,
        CASE
            WHEN (o.category = 'expense'::text) THEN o.signed_debit
            ELSE (- o.signed_debit)
        END AS ordinary_amount,
        CASE
            WHEN (o.period_no = 12) THEN
            CASE
                WHEN (o.category = 'expense'::text) THEN a.signed_debit
                ELSE (- a.signed_debit)
            END
            ELSE NULL::numeric
        END AS closing_adjustment_amount
   FROM (ordinary o
     JOIN adjusting a ON (((a.company_id = o.company_id) AND (a.fiscal_year_id = o.fiscal_year_id) AND (a.account_id = o.account_id) AND (NOT (a.sub_account_id IS DISTINCT FROM o.sub_account_id)) AND (a.sub_account_name = o.sub_account_name))));

CREATE VIEW "accounting"."trial_balance_v" WITH (security_invoker=true) AS  WITH base AS (
         SELECT j.company_id,
            j.fiscal_year_id,
            a.id AS account_id,
            a.code AS account_code,
            a.name AS account_name,
            a.category,
            sa.id AS sub_account_id,
            sa.code AS sub_account_code,
            COALESCE(sa.name, ''::text) AS sub_account_name,
            j.entry_kind,
            jl.side,
            jl.amount
           FROM ((((accounting.general_ledger_v gl
             JOIN accounting.journals j ON ((j.id = gl.journal_id)))
             JOIN accounting.journal_lines jl ON (((jl.journal_id = gl.journal_id) AND (jl.line_no = gl.line_no) AND (jl.side = gl.side))))
             JOIN accounting.accounts a ON ((a.id = jl.account_id)))
             LEFT JOIN accounting.sub_accounts sa ON ((sa.id = jl.sub_account_id)))
        ), detail AS (
         SELECT base.company_id,
            base.fiscal_year_id,
            base.account_id,
            base.account_code,
            base.account_name,
            base.category,
            base.sub_account_id,
            base.sub_account_code,
            base.sub_account_name,
            sum(
                CASE
                    WHEN ((base.entry_kind = 'opening'::text) AND (base.side = 'debit'::text)) THEN base.amount
                    WHEN ((base.entry_kind = 'opening'::text) AND (base.side = 'credit'::text)) THEN (- base.amount)
                    ELSE (0)::numeric
                END) AS opening_signed_debit,
            sum(
                CASE
                    WHEN ((base.entry_kind <> 'opening'::text) AND (base.side = 'debit'::text)) THEN base.amount
                    ELSE (0)::numeric
                END) AS period_debit,
            sum(
                CASE
                    WHEN ((base.entry_kind <> 'opening'::text) AND (base.side = 'credit'::text)) THEN base.amount
                    ELSE (0)::numeric
                END) AS period_credit
           FROM base
          GROUP BY base.company_id, base.fiscal_year_id, base.account_id, base.account_code, base.account_name, base.category, base.sub_account_id, base.sub_account_code, base.sub_account_name
        ), account_totals AS (
         SELECT detail.company_id,
            detail.fiscal_year_id,
            detail.account_id,
            detail.account_code,
            detail.account_name,
            detail.category,
            NULL::uuid AS sub_account_id,
            NULL::text AS sub_account_code,
            ''::text AS sub_account_name,
            sum(detail.opening_signed_debit) AS opening_signed_debit,
            sum(detail.period_debit) AS period_debit,
            sum(detail.period_credit) AS period_credit
           FROM detail
          GROUP BY detail.company_id, detail.fiscal_year_id, detail.account_id, detail.account_code, detail.account_name, detail.category
        ), pl_result AS (
         SELECT account_totals.company_id,
            account_totals.fiscal_year_id,
            (sum(
                CASE
                    WHEN (account_totals.category = 'revenue'::text) THEN (account_totals.period_credit - account_totals.period_debit)
                    ELSE (0)::numeric
                END) - sum(
                CASE
                    WHEN (account_totals.category = 'expense'::text) THEN (account_totals.period_debit - account_totals.period_credit)
                    ELSE (0)::numeric
                END)) AS net_income
           FROM account_totals
          GROUP BY account_totals.company_id, account_totals.fiscal_year_id
        ), rows0 AS (
         SELECT account_totals.company_id,
            account_totals.fiscal_year_id,
            account_totals.account_id,
            account_totals.account_code,
            account_totals.account_name,
            account_totals.category,
            account_totals.sub_account_id,
            account_totals.sub_account_code,
            account_totals.sub_account_name,
            account_totals.opening_signed_debit,
            account_totals.period_debit,
            account_totals.period_credit
           FROM account_totals
        UNION ALL
         SELECT detail.company_id,
            detail.fiscal_year_id,
            detail.account_id,
            detail.account_code,
            detail.account_name,
            detail.category,
            detail.sub_account_id,
            detail.sub_account_code,
            detail.sub_account_name,
            detail.opening_signed_debit,
            detail.period_debit,
            detail.period_credit
           FROM detail
          WHERE (detail.sub_account_name <> ''::text)
        ), rows1 AS (
         SELECT r.company_id,
            r.fiscal_year_id,
            r.account_id,
            r.account_code,
            r.account_name,
            r.category,
            r.sub_account_id,
            r.sub_account_code,
            r.sub_account_name,
            r.opening_signed_debit,
            r.period_debit,
            r.period_credit,
                CASE
                    WHEN (r.category = ANY (ARRAY['asset'::text, 'expense'::text])) THEN r.opening_signed_debit
                    ELSE (- r.opening_signed_debit)
                END AS opening_balance,
                CASE
                    WHEN ((r.account_name = '繰越利益剰余金'::text) AND (r.sub_account_name = ''::text)) THEN p.net_income
                    ELSE r.period_credit
                END AS report_period_credit
           FROM (rows0 r
             JOIN pl_result p USING (company_id, fiscal_year_id))
        )
 SELECT company_id,
    fiscal_year_id,
    account_id,
    account_code,
    account_name,
    category,
    sub_account_id,
    sub_account_code,
    NULLIF(sub_account_name, ''::text) AS sub_account_name,
    opening_balance,
    period_debit,
    report_period_credit AS period_credit,
        CASE
            WHEN (category = ANY (ARRAY['asset'::text, 'expense'::text])) THEN ((opening_balance + period_debit) - report_period_credit)
            ELSE ((opening_balance + report_period_credit) - period_debit)
        END AS ending_balance
   FROM rows1;

CREATE VIEW "accounting"."annual_balance_sheet_v" WITH (security_invoker=true) AS  WITH detail AS (
         SELECT tb.company_id,
            tb.fiscal_year_id,
            tb.account_id,
            tb.account_code,
            tb.account_name,
            tb.category,
            tb.sub_account_id,
            tb.sub_account_code,
            tb.sub_account_name,
                CASE
                    WHEN (tb.sub_account_id IS NULL) THEN 'account'::text
                    ELSE 'sub_account'::text
                END AS row_level,
            tb.opening_balance,
            tb.period_debit,
            tb.period_credit,
            tb.ending_balance
           FROM accounting.trial_balance_v tb
          WHERE (tb.category = ANY (ARRAY['asset'::text, 'liability'::text, 'equity'::text]))
        ), pl AS (
         SELECT tb.company_id,
            tb.fiscal_year_id,
            (sum(
                CASE
                    WHEN ((tb.category = 'revenue'::text) AND (tb.sub_account_id IS NULL)) THEN tb.ending_balance
                    ELSE (0)::numeric
                END) - sum(
                CASE
                    WHEN ((tb.category = 'expense'::text) AND (tb.sub_account_id IS NULL)) THEN tb.ending_balance
                    ELSE (0)::numeric
                END)) AS net_income
           FROM accounting.trial_balance_v tb
          GROUP BY tb.company_id, tb.fiscal_year_id
        ), totals AS (
         SELECT d_1.company_id,
            d_1.fiscal_year_id,
            COALESCE(sum(d_1.ending_balance) FILTER (WHERE ((d_1.category = 'asset'::text) AND (d_1.row_level = 'account'::text))), (0)::numeric) AS total_assets,
            COALESCE(sum(d_1.ending_balance) FILTER (WHERE ((d_1.category = 'liability'::text) AND (d_1.row_level = 'account'::text))), (0)::numeric) AS total_liabilities,
            (COALESCE(sum(d_1.ending_balance) FILTER (WHERE ((d_1.category = 'equity'::text) AND (d_1.row_level = 'account'::text))), (0)::numeric) +
                CASE
                    WHEN (NOT (EXISTS ( SELECT 1
                       FROM detail r
                      WHERE ((r.company_id = d_1.company_id) AND (r.fiscal_year_id = d_1.fiscal_year_id) AND (r.row_level = 'account'::text) AND (r.account_name = '繰越利益剰余金'::text))))) THEN COALESCE(p.net_income, (0)::numeric)
                    ELSE (0)::numeric
                END) AS total_equity
           FROM (detail d_1
             JOIN pl p USING (company_id, fiscal_year_id))
          GROUP BY d_1.company_id, d_1.fiscal_year_id, p.net_income
        )
 SELECT d.company_id,
    d.fiscal_year_id,
    d.account_id,
    d.account_code,
    d.account_name,
    d.category,
    d.sub_account_id,
    d.sub_account_code,
    d.sub_account_name,
    d.row_level,
    d.opening_balance,
    d.period_debit,
    d.period_credit,
    d.ending_balance,
    t.total_assets,
    t.total_liabilities,
    t.total_equity,
    (t.total_assets - (t.total_liabilities + t.total_equity)) AS balance_check
   FROM (detail d
     JOIN totals t USING (company_id, fiscal_year_id));

CREATE VIEW "accounting"."annual_profit_loss_v" WITH (security_invoker=true) AS  WITH detail AS (
         SELECT tb.company_id,
            tb.fiscal_year_id,
            tb.account_id,
            tb.account_code,
            tb.account_name,
            tb.category,
            tb.sub_account_id,
            tb.sub_account_code,
            tb.sub_account_name,
                CASE
                    WHEN (tb.sub_account_id IS NULL) THEN 'account'::text
                    ELSE 'sub_account'::text
                END AS row_level,
            tb.period_debit,
            tb.period_credit,
            tb.ending_balance AS annual_amount
           FROM accounting.trial_balance_v tb
          WHERE (tb.category = ANY (ARRAY['revenue'::text, 'expense'::text]))
        ), totals AS (
         SELECT detail.company_id,
            detail.fiscal_year_id,
            COALESCE(sum(detail.annual_amount) FILTER (WHERE ((detail.category = 'revenue'::text) AND (detail.row_level = 'account'::text))), (0)::numeric) AS total_revenue,
            COALESCE(sum(detail.annual_amount) FILTER (WHERE ((detail.category = 'expense'::text) AND (detail.row_level = 'account'::text))), (0)::numeric) AS total_expense
           FROM detail
          GROUP BY detail.company_id, detail.fiscal_year_id
        )
 SELECT d.company_id,
    d.fiscal_year_id,
    d.account_id,
    d.account_code,
    d.account_name,
    d.category,
    d.sub_account_id,
    d.sub_account_code,
    d.sub_account_name,
    d.row_level,
    d.period_debit,
    d.period_credit,
    d.annual_amount,
    t.total_revenue,
    t.total_expense,
    (t.total_revenue - t.total_expense) AS net_income
   FROM (detail d
     JOIN totals t USING (company_id, fiscal_year_id));

COMMENT ON VIEW "accounting"."annual_balance_sheet_v" IS 'Primary annual balance sheet report. Derived from posted journals via trial_balance_v. Account-level rows are authoritative for totals; sub-account rows are drill-down detail. For a first fiscal year with no retained-earnings account, current net income is included in total equity presentation. balance_check must be zero.';

COMMENT ON VIEW "accounting"."annual_profit_loss_v" IS 'Primary annual profit and loss report. Derived from posted journals via trial_balance_v. Account-level rows are authoritative for totals; sub-account rows are drill-down detail.';

