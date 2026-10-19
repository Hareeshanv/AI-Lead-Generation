-- Analytics: org-scoped aggregate functions used by GET /api/analytics/summary and /reports.
-- Ranges are half-open [p_from, p_to). Only the service role (the API) may call them.
-- Idempotent: safe to re-run.

-- 1. Indexes for range scans
CREATE INDEX IF NOT EXISTS idx_deals_org_created ON public.deals (org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deals_org_closed ON public.deals (org_id, (coalesce(closed_at, updated_at)));
CREATE INDEX IF NOT EXISTS idx_messages_org_sent ON public.messages (org_id, sent_at) WHERE direction = 'outbound';
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_org_started ON public.pipeline_runs (org_id, started_at);

-- 2. Period KPIs (raw counts; rates are derived by the API)
CREATE OR REPLACE FUNCTION public.analytics_kpis(p_org_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
WITH cfg AS (
    SELECT coalesce((
        SELECT (s.scoring ->> 'hot')::int FROM public.org_settings s WHERE s.org_id = p_org_id
    ), 80) AS hot
),
period_leads AS (
    SELECT le.id, le.score, le.source, le.status, le.last_contacted_at
    FROM public.leads le
    WHERE le.org_id = p_org_id AND le.created_at >= p_from AND le.created_at < p_to
),
l AS (
    SELECT
        count(*) AS leads,
        count(*) FILTER (WHERE pl.score >= (SELECT hot FROM cfg)) AS hot_leads,
        round(avg(pl.score)::numeric, 1) AS avg_score,
        count(*) FILTER (WHERE lower(coalesce(pl.source, '')) IN ('ai agent', 'agent', 'ai_agent', 'discovery')) AS agent_leads,
        count(*) FILTER (WHERE lower(coalesce(pl.status, 'new')) <> 'new' OR pl.last_contacted_at IS NOT NULL) AS contacted,
        count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM public.deals d WHERE d.org_id = p_org_id AND d.lead_id = pl.id
        )) AS leads_with_deal,
        count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM public.deals d WHERE d.org_id = p_org_id AND d.lead_id = pl.id AND d.stage ILIKE '%won%'
        )) AS leads_won
    FROM period_leads pl
),
created_deals AS (
    SELECT count(*) AS created, coalesce(sum(d.value), 0) AS created_value
    FROM public.deals d
    WHERE d.org_id = p_org_id AND d.created_at >= p_from AND d.created_at < p_to
),
closed_deals AS (
    SELECT
        count(*) FILTER (WHERE d.stage ILIKE '%won%') AS won,
        count(*) FILTER (WHERE d.stage ILIKE '%lost%') AS lost,
        coalesce(sum(d.value) FILTER (WHERE d.stage ILIKE '%won%'), 0) AS won_value,
        round((avg(extract(epoch FROM (coalesce(d.closed_at, d.updated_at) - d.created_at)))
            FILTER (WHERE d.stage ILIKE '%won%') / 86400.0)::numeric, 1) AS avg_cycle_days
    FROM public.deals d
    WHERE d.org_id = p_org_id
      AND (d.stage ILIKE '%won%' OR d.stage ILIKE '%lost%')
      AND coalesce(d.closed_at, d.updated_at) >= p_from
      AND coalesce(d.closed_at, d.updated_at) < p_to
),
msgs AS (
    SELECT
        count(*) AS sent,
        count(*) FILTER (WHERE m.delivered_at IS NOT NULL OR m.opened_at IS NOT NULL
                          OR m.clicked_at IS NOT NULL OR m.replied_at IS NOT NULL
                          OR m.status IN ('delivered', 'opened', 'clicked', 'replied')) AS delivered,
        count(*) FILTER (WHERE m.opened_at IS NOT NULL OR m.clicked_at IS NOT NULL) AS opened,
        count(*) FILTER (WHERE m.clicked_at IS NOT NULL) AS clicked,
        count(*) FILTER (WHERE m.replied_at IS NOT NULL OR m.status = 'replied') AS replied,
        count(*) FILTER (WHERE m.bounced_at IS NOT NULL OR m.status = 'bounced') AS bounced,
        count(*) FILTER (WHERE m.failed_at IS NOT NULL OR m.status = 'failed') AS failed
    FROM public.messages m
    WHERE m.org_id = p_org_id AND m.direction = 'outbound' AND m.sent_at >= p_from AND m.sent_at < p_to
),
runs AS (
    SELECT
        count(*) AS runs,
        count(*) FILTER (WHERE r.status IN ('completed', 'completed_with_errors')) AS succeeded,
        count(*) FILTER (WHERE r.status = 'failed') AS failed,
        coalesce(sum(r.total_leads_found), 0) AS leads_found,
        round(avg(r.duration_ms)) AS avg_duration_ms,
        coalesce((
            SELECT sum(e.tokens_used) FROM public.agent_executions e
            WHERE e.pipeline_run_id IN (
                SELECT r2.id FROM public.pipeline_runs r2
                WHERE r2.org_id = p_org_id AND r2.started_at >= p_from AND r2.started_at < p_to
            )
        ), 0) AS tokens_used
    FROM public.pipeline_runs r
    WHERE r.org_id = p_org_id AND r.started_at >= p_from AND r.started_at < p_to
)
SELECT jsonb_build_object(
    'leads', l.leads,
    'hotLeads', l.hot_leads,
    'avgScore', l.avg_score,
    'agentLeads', l.agent_leads,
    'contactedLeads', l.contacted,
    'leadsWithDeal', l.leads_with_deal,
    'leadsWon', l.leads_won,
    'dealsCreated', cd.created,
    'dealsCreatedValue', cd.created_value,
    'dealsWon', xd.won,
    'dealsLost', xd.lost,
    'wonValue', xd.won_value,
    'avgDealCycleDays', xd.avg_cycle_days,
    'messagesSent', m.sent,
    'messagesDelivered', m.delivered,
    'messagesOpened', m.opened,
    'messagesClicked', m.clicked,
    'messagesReplied', m.replied,
    'messagesBounced', m.bounced,
    'messagesFailed', m.failed,
    'agentRuns', r.runs,
    'agentRunsSucceeded', r.succeeded,
    'agentRunsFailed', r.failed,
    'agentLeadsFound', r.leads_found,
    'agentAvgDurationMs', r.avg_duration_ms,
    'agentTokensUsed', r.tokens_used
)
FROM l, created_deals cd, closed_deals xd, msgs m, runs r;
$$;

-- 3. Pipeline snapshot (current state, not range-bound)
CREATE OR REPLACE FUNCTION public.analytics_pipeline(p_org_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
WITH d AS (
    SELECT
        coalesce(nullif(trim(x.stage), ''), 'New') AS stage,
        coalesce(x.value, 0) AS value,
        coalesce(x.value, 0) * least(greatest(coalesce(x.probability, 0), 0), 100) / 100.0 AS weighted,
        (x.stage ILIKE '%won%' OR x.stage ILIKE '%lost%') AS closed
    FROM public.deals x
    WHERE x.org_id = p_org_id
)
SELECT jsonb_build_object(
    'openDeals', (SELECT count(*) FROM d WHERE NOT d.closed),
    'openValue', (SELECT coalesce(sum(d.value), 0) FROM d WHERE NOT d.closed),
    'weightedValue', (SELECT round(coalesce(sum(d.weighted), 0)::numeric, 2) FROM d WHERE NOT d.closed),
    'byStage', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'stage', s.stage, 'count', s.n, 'value', s.v, 'weightedValue', round(s.w::numeric, 2), 'closed', s.closed
        ) ORDER BY s.closed, s.n DESC)
        FROM (SELECT d.stage, d.closed, count(*) AS n, sum(d.value) AS v, sum(d.weighted) AS w FROM d GROUP BY d.stage, d.closed) s
    ), '[]'::jsonb)
);
$$;

-- 4. Time series bucketed by day / week / month in the org's time zone
CREATE OR REPLACE FUNCTION public.analytics_timeseries(
    p_org_id UUID,
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ,
    p_bucket TEXT DEFAULT 'day',
    p_tz TEXT DEFAULT 'UTC'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    v_bucket TEXT := CASE WHEN p_bucket IN ('day', 'week', 'month') THEN p_bucket ELSE 'day' END;
    v_tz TEXT := coalesce(nullif(p_tz, ''), 'UTC');
    v_result JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_tz) THEN
        v_tz := 'UTC';
    END IF;

    WITH buckets AS (
        SELECT generate_series(
            date_trunc(v_bucket, p_from AT TIME ZONE v_tz),
            date_trunc(v_bucket, (p_to - INTERVAL '1 microsecond') AT TIME ZONE v_tz),
            ('1 ' || v_bucket)::INTERVAL
        ) AS b
    ),
    lc AS (
        SELECT date_trunc(v_bucket, le.created_at AT TIME ZONE v_tz) AS b, count(*) AS n
        FROM public.leads le
        WHERE le.org_id = p_org_id AND le.created_at >= p_from AND le.created_at < p_to
        GROUP BY 1
    ),
    dc AS (
        SELECT date_trunc(v_bucket, d.created_at AT TIME ZONE v_tz) AS b, count(*) AS n
        FROM public.deals d
        WHERE d.org_id = p_org_id AND d.created_at >= p_from AND d.created_at < p_to
        GROUP BY 1
    ),
    dw AS (
        SELECT date_trunc(v_bucket, coalesce(d.closed_at, d.updated_at) AT TIME ZONE v_tz) AS b,
               count(*) AS n, coalesce(sum(d.value), 0) AS v
        FROM public.deals d
        WHERE d.org_id = p_org_id AND d.stage ILIKE '%won%'
          AND coalesce(d.closed_at, d.updated_at) >= p_from AND coalesce(d.closed_at, d.updated_at) < p_to
        GROUP BY 1
    ),
    ms AS (
        SELECT date_trunc(v_bucket, m.sent_at AT TIME ZONE v_tz) AS b,
               count(*) AS sent,
               count(*) FILTER (WHERE m.replied_at IS NOT NULL OR m.status = 'replied') AS replied
        FROM public.messages m
        WHERE m.org_id = p_org_id AND m.direction = 'outbound' AND m.sent_at >= p_from AND m.sent_at < p_to
        GROUP BY 1
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'bucket', to_char(bk.b, 'YYYY-MM-DD'),
        'leads', coalesce(lc.n, 0),
        'deals', coalesce(dc.n, 0),
        'won', coalesce(dw.n, 0),
        'wonValue', coalesce(dw.v, 0),
        'messagesSent', coalesce(ms.sent, 0),
        'replies', coalesce(ms.replied, 0)
    ) ORDER BY bk.b), '[]'::jsonb)
    INTO v_result
    FROM buckets bk
    LEFT JOIN lc ON lc.b = bk.b
    LEFT JOIN dc ON dc.b = bk.b
    LEFT JOIN dw ON dw.b = bk.b
    LEFT JOIN ms ON ms.b = bk.b;

    RETURN v_result;
END;
$$;

-- 5. Report breakdowns for a period
CREATE OR REPLACE FUNCTION public.analytics_breakdowns(p_org_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
WITH pl AS (
    SELECT le.id, le.score, le.status, le.last_contacted_at,
           coalesce(nullif(trim(le.source), ''), nullif(trim(le.source_platform), ''), 'Unknown') AS source
    FROM public.leads le
    WHERE le.org_id = p_org_id AND le.created_at >= p_from AND le.created_at < p_to
),
pl_deals AS (
    SELECT pl.*,
        EXISTS (SELECT 1 FROM public.deals d WHERE d.org_id = p_org_id AND d.lead_id = pl.id) AS has_deal,
        EXISTS (SELECT 1 FROM public.deals d WHERE d.org_id = p_org_id AND d.lead_id = pl.id AND d.stage ILIKE '%won%') AS has_won
    FROM pl
)
SELECT jsonb_build_object(
    'bySource', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'source', s.source, 'leads', s.n, 'avgScore', s.avg_score, 'deals', s.deals, 'won', s.won
        ) ORDER BY s.n DESC)
        FROM (
            SELECT p.source, count(*) AS n, round(avg(p.score)::numeric, 1) AS avg_score,
                   count(*) FILTER (WHERE p.has_deal) AS deals, count(*) FILTER (WHERE p.has_won) AS won
            FROM pl_deals p GROUP BY p.source
        ) s
    ), '[]'::jsonb),
    'byStatus', coalesce((
        SELECT jsonb_agg(jsonb_build_object('status', s.status, 'leads', s.n) ORDER BY s.n DESC)
        FROM (SELECT coalesce(nullif(trim(p.status), ''), 'New') AS status, count(*) AS n FROM pl p GROUP BY 1) s
    ), '[]'::jsonb),
    'scoreDistribution', (
        SELECT jsonb_build_array(
            jsonb_build_object('range', '0-19', 'min', 0, 'max', 19, 'leads', count(*) FILTER (WHERE coalesce(p.score, 0) < 20)),
            jsonb_build_object('range', '20-39', 'min', 20, 'max', 39, 'leads', count(*) FILTER (WHERE p.score >= 20 AND p.score < 40)),
            jsonb_build_object('range', '40-59', 'min', 40, 'max', 59, 'leads', count(*) FILTER (WHERE p.score >= 40 AND p.score < 60)),
            jsonb_build_object('range', '60-79', 'min', 60, 'max', 79, 'leads', count(*) FILTER (WHERE p.score >= 60 AND p.score < 80)),
            jsonb_build_object('range', '80-100', 'min', 80, 'max', 100, 'leads', count(*) FILTER (WHERE p.score >= 80))
        )
        FROM pl p
    ),
    'funnel', (
        SELECT jsonb_build_object(
            'leads', count(*),
            'contacted', count(*) FILTER (WHERE lower(coalesce(p.status, 'new')) <> 'new' OR p.last_contacted_at IS NOT NULL),
            'deals', count(*) FILTER (WHERE p.has_deal),
            'won', count(*) FILTER (WHERE p.has_won)
        )
        FROM pl_deals p
    ),
    'campaigns', coalesce((
        SELECT jsonb_agg(to_jsonb(c) ORDER BY c.sent DESC)
        FROM (
            SELECT
                cp.id, cp.name, cp.channel, cp.status,
                count(*) AS sent,
                count(*) FILTER (WHERE m.delivered_at IS NOT NULL OR m.opened_at IS NOT NULL OR m.clicked_at IS NOT NULL
                                  OR m.replied_at IS NOT NULL OR m.status IN ('delivered', 'opened', 'clicked', 'replied')) AS delivered,
                count(*) FILTER (WHERE m.opened_at IS NOT NULL OR m.clicked_at IS NOT NULL) AS opened,
                count(*) FILTER (WHERE m.clicked_at IS NOT NULL) AS clicked,
                count(*) FILTER (WHERE m.replied_at IS NOT NULL OR m.status = 'replied') AS replied,
                count(*) FILTER (WHERE m.bounced_at IS NOT NULL OR m.status = 'bounced') AS bounced
            FROM public.messages m
            JOIN public.campaigns cp ON cp.id = m.campaign_id
            WHERE m.org_id = p_org_id AND m.direction = 'outbound' AND m.sent_at >= p_from AND m.sent_at < p_to
            GROUP BY cp.id, cp.name, cp.channel, cp.status
            ORDER BY count(*) DESC
            LIMIT 100
        ) c
    ), '[]'::jsonb),
    'agentRuns', coalesce((
        SELECT jsonb_agg(to_jsonb(r) ORDER BY r.started_at DESC)
        FROM (
            SELECT
                pr.id, pr.query, pr.location, pr.status,
                coalesce(pr.total_leads_found, 0) AS leads_found,
                pr.duration_ms, pr.started_at,
                coalesce((SELECT sum(e.tokens_used) FROM public.agent_executions e WHERE e.pipeline_run_id = pr.id), 0) AS tokens_used
            FROM public.pipeline_runs pr
            WHERE pr.org_id = p_org_id AND pr.started_at >= p_from AND pr.started_at < p_to
            ORDER BY pr.started_at DESC
            LIMIT 100
        ) r
    ), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.analytics_kpis(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_pipeline(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_timeseries(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_breakdowns(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_kpis(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_pipeline(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_timeseries(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_breakdowns(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
