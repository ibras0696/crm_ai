from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from statistics import median
from typing import Any

from sqlalchemy import case, func, literal_column, select, text

from src.common.enums import AuditAction
from src.infrastructure.uow import UnitOfWork
from src.modules.ai.models import AIUsageLog
from src.modules.audit.models import AuditLog
from src.modules.auth.models import User
from src.modules.billing.models import Plan
from src.modules.files.models import File
from src.modules.org.models import Membership, Organization
from src.modules.tables.models import Table
from src.modules.tables.records import Record


def _safe_int(v) -> int:
    try:
        return int(v or 0)
    except Exception:
        return 0


class SuperadminOverviewService:
    """Overview/dashboard use-cases for superadmin."""

    async def dashboard_data(self) -> dict:
        now = datetime.now(UTC)
        d1 = now - timedelta(days=1)
        d7 = now - timedelta(days=7)
        d14 = now - timedelta(days=14)
        d30 = now - timedelta(days=30)
        d60 = now - timedelta(days=60)
        d120 = now - timedelta(days=120)

        async with UnitOfWork() as uow:
            orgs_count = (await uow.session.execute(select(func.count()).select_from(Organization))).scalar() or 0
            users_count = (await uow.session.execute(select(func.count()).select_from(User))).scalar() or 0
            tables_count = (await uow.session.execute(select(func.count()).select_from(Table))).scalar() or 0
            records_count = (await uow.session.execute(select(func.count()).select_from(Record))).scalar() or 0
            files_row = (
                await uow.session.execute(
                    select(func.count(), func.coalesce(func.sum(File.size), 0)).select_from(File),
                )
            ).one()
            ai_row = (
                await uow.session.execute(
                    select(func.count(), func.coalesce(func.sum(AIUsageLog.total_tokens), 0)).select_from(AIUsageLog),
                )
            ).one()

            reg_stmt = (
                select(func.date_trunc("day", User.created_at).label("day"), func.count().label("cnt"))
                .where(User.created_at >= d30)
                .group_by(text("day"))
                .order_by(text("day"))
            )
            reg_rows = (await uow.session.execute(reg_stmt)).all()

            plan_stmt = select(Organization.plan, func.count().label("cnt")).group_by(Organization.plan)
            plan_rows = (await uow.session.execute(plan_stmt)).all()

            # Funnel
            activated_orgs = (
                await uow.session.execute(
                    select(func.count(func.distinct(AuditLog.org_id))).where(AuditLog.action == AuditAction.LOGIN.value),
                )
            ).scalar() or 0
            first_table_orgs = (await uow.session.execute(select(func.count(func.distinct(Table.org_id))))).scalar() or 0
            first_record_orgs = (await uow.session.execute(select(func.count(func.distinct(Record.org_id))))).scalar() or 0

            # WAU/MAU / stickiness
            dau = (
                await uow.session.execute(
                    select(func.count(func.distinct(AuditLog.actor_id))).where(
                        AuditLog.actor_id.is_not(None),
                        AuditLog.created_at >= d1,
                    )
                )
            ).scalar() or 0
            wau = (
                await uow.session.execute(
                    select(func.count(func.distinct(AuditLog.actor_id))).where(
                        AuditLog.actor_id.is_not(None),
                        AuditLog.created_at >= d7,
                    )
                )
            ).scalar() or 0
            mau = (
                await uow.session.execute(
                    select(func.count(func.distinct(AuditLog.actor_id))).where(
                        AuditLog.actor_id.is_not(None),
                        AuditLog.created_at >= d30,
                    )
                )
            ).scalar() or 0

            # Role activity (30d)
            role_rows = (
                await uow.session.execute(
                    select(
                        Membership.role,
                        func.count(AuditLog.id).label("events"),
                        func.count(func.distinct(AuditLog.actor_id)).label("active_users"),
                    )
                    .join(
                        Membership,
                        (Membership.user_id == AuditLog.actor_id) & (Membership.org_id == AuditLog.org_id),
                    )
                    .where(AuditLog.created_at >= d30, AuditLog.actor_id.is_not(None))
                    .group_by(Membership.role)
                    .order_by(func.count(AuditLog.id).desc()),
                )
            ).all()

            # Module activity by entity_type (30d)
            module_rows = (
                await uow.session.execute(
                    select(AuditLog.entity_type, func.count(AuditLog.id).label("events"))
                    .where(AuditLog.created_at >= d30)
                    .group_by(AuditLog.entity_type)
                    .order_by(func.count(AuditLog.id).desc())
                    .limit(12),
                )
            ).all()

            # Cohorts (orgs) D1/D7/D30
            org_rows = (
                await uow.session.execute(
                    select(Organization.id, func.date(Organization.created_at).label("cohort_day"))
                    .where(Organization.created_at >= d120),
                )
            ).all()
            org_ids = [r.id for r in org_rows]
            activity_days_by_org: dict[Any, set[date]] = defaultdict(set)
            if org_ids:
                act_rows = (
                    await uow.session.execute(
                        select(AuditLog.org_id, func.date(AuditLog.created_at).label("active_day"))
                        .where(AuditLog.org_id.in_(org_ids), AuditLog.created_at >= d120)
                        .group_by(AuditLog.org_id, literal_column("active_day")),
                    )
                ).all()
                for row in act_rows:
                    if row.active_day:
                        activity_days_by_org[row.org_id].add(row.active_day)
            cohorts: dict[str, dict[str, int]] = defaultdict(lambda: {"size": 0, "d1": 0, "d7": 0, "d30": 0})
            for row in org_rows:
                cohort_day: date = row.cohort_day
                key = str(cohort_day)
                cohorts[key]["size"] += 1
                active_days = activity_days_by_org.get(row.id, set())
                if cohort_day + timedelta(days=1) in active_days:
                    cohorts[key]["d1"] += 1
                if cohort_day + timedelta(days=7) in active_days:
                    cohorts[key]["d7"] += 1
                if cohort_day + timedelta(days=30) in active_days:
                    cohorts[key]["d30"] += 1
            retention_cohorts = [
                {
                    "cohort": k,
                    "size": v["size"],
                    "d1": _safe_int(v["d1"]),
                    "d7": _safe_int(v["d7"]),
                    "d30": _safe_int(v["d30"]),
                    "d1_rate": round((v["d1"] / max(v["size"], 1)) * 100, 1),
                    "d7_rate": round((v["d7"] / max(v["size"], 1)) * 100, 1),
                    "d30_rate": round((v["d30"] / max(v["size"], 1)) * 100, 1),
                }
                for k, v in sorted(cohorts.items())[-10:]
            ]

            # Churn risk per org (top 10 by score)
            org_base_rows = (
                await uow.session.execute(select(Organization.id, Organization.name, Organization.created_at))
            ).all()
            logins_14_rows = (
                await uow.session.execute(
                    select(AuditLog.org_id, func.count().label("cnt"))
                    .where(AuditLog.created_at >= d14, AuditLog.action == AuditAction.LOGIN.value)
                    .group_by(AuditLog.org_id),
                )
            ).all()
            events_14_rows = (
                await uow.session.execute(
                    select(AuditLog.org_id, func.count().label("cnt"))
                    .where(AuditLog.created_at >= d14)
                    .group_by(AuditLog.org_id),
                )
            ).all()
            events_prev_14_rows = (
                await uow.session.execute(
                    select(AuditLog.org_id, func.count().label("cnt"))
                    .where(AuditLog.created_at >= (d14 - timedelta(days=14)), AuditLog.created_at < d14)
                    .group_by(AuditLog.org_id),
                )
            ).all()
            rec_14_rows = (
                await uow.session.execute(
                    select(Record.org_id, func.count().label("cnt"))
                    .where(Record.created_at >= d14)
                    .group_by(Record.org_id),
                )
            ).all()
            logins_14 = {r.org_id: _safe_int(r.cnt) for r in logins_14_rows}
            events_14 = {r.org_id: _safe_int(r.cnt) for r in events_14_rows}
            events_prev_14 = {r.org_id: _safe_int(r.cnt) for r in events_prev_14_rows}
            rec_14 = {r.org_id: _safe_int(r.cnt) for r in rec_14_rows}
            churn_risk_items: list[dict[str, Any]] = []
            for row in org_base_rows:
                score = 0
                reasons: list[str] = []
                org_age_days = max(0, (now.date() - row.created_at.date()).days) if row.created_at else 0
                l14 = logins_14.get(row.id, 0)
                e14 = events_14.get(row.id, 0)
                ep14 = events_prev_14.get(row.id, 0)
                r14 = rec_14.get(row.id, 0)
                if org_age_days >= 14 and l14 == 0:
                    score += 40
                    reasons.append("0 логинов за 14 дней")
                if org_age_days >= 14 and r14 == 0:
                    score += 30
                    reasons.append("0 записей за 14 дней")
                if org_age_days >= 14 and e14 == 0:
                    score += 20
                    reasons.append("нет событий активности за 14 дней")
                if ep14 > 0 and e14 < int(ep14 * 0.5):
                    score += 20
                    reasons.append("падение активности >50%")
                if score > 0:
                    churn_risk_items.append(
                        {
                            "org_id": str(row.id),
                            "org_name": row.name,
                            "score": min(score, 100),
                            "reasons": reasons,
                            "events_14d": e14,
                            "events_prev_14d": ep14,
                        }
                    )
            churn_risk_items.sort(key=lambda x: x["score"], reverse=True)
            churn_risk_items = churn_risk_items[:10]

            # Tariff analytics (conversions + time-to-upgrade)
            conv_rows = (
                await uow.session.execute(
                    select(
                        func.coalesce(AuditLog.meta["old_plan"].astext, "").label("old_plan"),
                        func.coalesce(AuditLog.meta["new_plan"].astext, "").label("new_plan"),
                        func.count().label("cnt"),
                    )
                    .where(
                        AuditLog.created_at >= d30,
                        AuditLog.entity_type == "org_plan",
                        AuditLog.action == AuditAction.UPDATE.value,
                    )
                    .group_by(literal_column("old_plan"), literal_column("new_plan")),
                )
            ).all()
            free_to_team = 0
            free_to_business = 0
            for r in conv_rows:
                if r.old_plan == "free" and r.new_plan == "team":
                    free_to_team += _safe_int(r.cnt)
                if r.old_plan == "free" and r.new_plan == "business":
                    free_to_business += _safe_int(r.cnt)

            first_upgrade_rows = (
                await uow.session.execute(
                    select(
                        AuditLog.entity_id.label("org_id"),
                        func.min(AuditLog.created_at).label("first_upgrade_at"),
                    )
                    .where(
                        AuditLog.entity_type == "org_plan",
                        AuditLog.action == AuditAction.UPDATE.value,
                        AuditLog.meta["old_plan"].astext == "free",
                        AuditLog.meta["new_plan"].astext.in_(["team", "business"]),
                    )
                    .group_by(AuditLog.entity_id),
                )
            ).all()
            org_created_map = {str(r.id): r.created_at for r in org_base_rows}
            ttu_days: list[float] = []
            for r in first_upgrade_rows:
                created_at = org_created_map.get(str(r.org_id))
                if created_at and r.first_upgrade_at:
                    ttu_days.append(max(0.0, (r.first_upgrade_at - created_at).total_seconds() / 86400))

            # Limits usage + simple forecast
            org_plan_rows = (
                await uow.session.execute(select(Organization.id, Organization.name, Organization.plan))
            ).all()
            plans_rows = (await uow.session.execute(select(Plan))).scalars().all()
            plan_limits = {
                (p.name or "").strip().lower(): {
                    "max_tables": _safe_int(p.max_tables),
                    "max_records": _safe_int(p.max_records),
                    "max_storage_bytes": _safe_int(p.max_storage_mb) * 1024 * 1024,
                }
                for p in plans_rows
            }
            tbl_by_org_rows = (
                await uow.session.execute(
                    select(Table.org_id, func.count().label("cnt")).group_by(Table.org_id),
                )
            ).all()
            rec_by_org_rows = (
                await uow.session.execute(
                    select(Record.org_id, func.count().label("cnt")).group_by(Record.org_id),
                )
            ).all()
            storage_by_org_rows = (
                await uow.session.execute(
                    select(File.org_id, func.coalesce(func.sum(File.size), 0).label("bytes")).group_by(File.org_id),
                )
            ).all()
            rec_30_by_org_rows = (
                await uow.session.execute(
                    select(Record.org_id, func.count().label("cnt")).where(Record.created_at >= d30).group_by(Record.org_id),
                )
            ).all()
            storage_30_by_org_rows = (
                await uow.session.execute(
                    select(File.org_id, func.coalesce(func.sum(File.size), 0).label("bytes"))
                    .where(File.created_at >= d30)
                    .group_by(File.org_id),
                )
            ).all()
            tbl_by_org = {r.org_id: _safe_int(r.cnt) for r in tbl_by_org_rows}
            rec_by_org = {r.org_id: _safe_int(r.cnt) for r in rec_by_org_rows}
            storage_by_org = {r.org_id: _safe_int(r.bytes) for r in storage_by_org_rows}
            rec_30_by_org = {r.org_id: _safe_int(r.cnt) for r in rec_30_by_org_rows}
            storage_30_by_org = {r.org_id: _safe_int(r.bytes) for r in storage_30_by_org_rows}
            limits_items: list[dict[str, Any]] = []
            for row in org_plan_rows:
                plan_name = str(row.plan.value if hasattr(row.plan, "value") else row.plan).lower()
                limits = plan_limits.get(plan_name)
                if not limits:
                    continue
                t_cnt = tbl_by_org.get(row.id, 0)
                r_cnt = rec_by_org.get(row.id, 0)
                s_cnt = storage_by_org.get(row.id, 0)
                t_ratio = (t_cnt / max(limits["max_tables"], 1)) * 100 if limits["max_tables"] > 0 else 0
                r_ratio = (r_cnt / max(limits["max_records"], 1)) * 100 if limits["max_records"] > 0 else 0
                s_ratio = (s_cnt / max(limits["max_storage_bytes"], 1)) * 100 if limits["max_storage_bytes"] > 0 else 0
                rec_growth_day = rec_30_by_org.get(row.id, 0) / 30
                storage_growth_day = storage_30_by_org.get(row.id, 0) / 30
                rec_days_left = (
                    (limits["max_records"] - r_cnt) / rec_growth_day
                    if rec_growth_day > 0 and limits["max_records"] > 0 and r_cnt < limits["max_records"]
                    else None
                )
                storage_days_left = (
                    (limits["max_storage_bytes"] - s_cnt) / storage_growth_day
                    if storage_growth_day > 0 and limits["max_storage_bytes"] > 0 and s_cnt < limits["max_storage_bytes"]
                    else None
                )
                days_candidates = [x for x in [rec_days_left, storage_days_left] if isinstance(x, (int, float))]
                limits_items.append(
                    {
                        "org_id": str(row.id),
                        "org_name": row.name,
                        "plan": plan_name,
                        "tables_usage_pct": round(t_ratio, 1),
                        "records_usage_pct": round(r_ratio, 1),
                        "storage_usage_pct": round(s_ratio, 1),
                        "eta_days_to_limit": round(min(days_candidates), 1) if days_candidates else None,
                    }
                )
            limits_items.sort(
                key=lambda x: max(x["tables_usage_pct"], x["records_usage_pct"], x["storage_usage_pct"]),
                reverse=True,
            )
            limits_items = limits_items[:10]

            # Security anomalies
            sec_last_rows = (
                await uow.session.execute(
                    select(AuditLog.action, func.count().label("cnt"))
                    .where(
                        AuditLog.created_at >= d1,
                        AuditLog.action.in_(
                            [
                                AuditAction.LOGIN_FAILED.value,
                                AuditAction.ACCESS_DENIED.value,
                                AuditAction.TOKEN_ANOMALY.value,
                            ]
                        ),
                    )
                    .group_by(AuditLog.action),
                )
            ).all()
            sec_prev_rows = (
                await uow.session.execute(
                    select(AuditLog.action, func.count().label("cnt"))
                    .where(
                        AuditLog.created_at >= d1 - timedelta(days=1),
                        AuditLog.created_at < d1,
                        AuditLog.action.in_(
                            [
                                AuditAction.LOGIN_FAILED.value,
                                AuditAction.ACCESS_DENIED.value,
                                AuditAction.TOKEN_ANOMALY.value,
                            ]
                        ),
                    )
                    .group_by(AuditLog.action),
                )
            ).all()
            sec_last = {str(r.action): _safe_int(r.cnt) for r in sec_last_rows}
            sec_prev = {str(r.action): _safe_int(r.cnt) for r in sec_prev_rows}
            sec_ip_rows = (
                await uow.session.execute(
                    select(AuditLog.ip_address, func.count().label("cnt"))
                    .where(
                        AuditLog.created_at >= d1,
                        AuditLog.action.in_(
                            [
                                AuditAction.LOGIN_FAILED.value,
                                AuditAction.ACCESS_DENIED.value,
                                AuditAction.TOKEN_ANOMALY.value,
                            ]
                        ),
                        AuditLog.ip_address.is_not(None),
                    )
                    .group_by(AuditLog.ip_address)
                    .order_by(func.count().desc())
                    .limit(10),
                )
            ).all()

            # Data quality
            quality_row = (
                await uow.session.execute(
                    text(
                        """
                        WITH cells AS (
                            SELECT e.value AS v
                            FROM table_records r
                            LEFT JOIN LATERAL jsonb_each(r.data) AS e(key, value) ON TRUE
                        )
                        SELECT
                            COALESCE(COUNT(*), 0) AS total_cells,
                            COALESCE(SUM(CASE WHEN v IS NULL OR trim(both '"' from v::text) IN ('', 'null', 'undefined', 'nan') THEN 1 ELSE 0 END), 0) AS empty_or_invalid_cells
                        FROM cells
                        """
                    )
                )
            ).one()
            duplicate_groups_row = (
                await uow.session.execute(
                    text(
                        """
                        SELECT COALESCE(COUNT(*), 0)
                        FROM (
                          SELECT table_id, md5(data::text) AS fp, COUNT(*) AS c
                          FROM table_records
                          GROUP BY table_id, md5(data::text)
                          HAVING COUNT(*) > 1
                        ) d
                        """
                    )
                )
            ).scalar() or 0
            total_cells = _safe_int(quality_row.total_cells)
            empty_or_invalid_cells = _safe_int(quality_row.empty_or_invalid_cells)
            empty_rate = round((empty_or_invalid_cells / max(total_cells, 1)) * 100, 2)

            # SLA backend (fallback without Prometheus query integration)
            # We provide explicit N/A to avoid misleading numbers from DB events.
            sla_backend = {
                "source": "prometheus",
                "available": False,
                "p95_ms": None,
                "p99_ms": None,
                "error_rate_pct": None,
                "note": "Нужна интеграция с Prometheus API для реальных p95/p99/error rate по endpoint.",
            }

            # AI analytics
            ai_user_rows = (
                await uow.session.execute(
                    select(
                        AIUsageLog.user_id,
                        func.count().label("requests"),
                        func.coalesce(func.sum(AIUsageLog.total_tokens), 0).label("tokens"),
                    )
                    .where(AIUsageLog.created_at >= d30, AIUsageLog.user_id.is_not(None))
                    .group_by(AIUsageLog.user_id),
                )
            ).all()
            ai_org_rows = (
                await uow.session.execute(
                    select(
                        AIUsageLog.org_id,
                        func.count().label("requests"),
                        func.coalesce(func.sum(AIUsageLog.total_tokens), 0).label("tokens"),
                    )
                    .where(AIUsageLog.created_at >= d30)
                    .group_by(AIUsageLog.org_id)
                    .order_by(func.sum(AIUsageLog.total_tokens).desc())
                    .limit(10),
                )
            ).all()
            ai_query_actions_30d = (
                await uow.session.execute(
                    select(func.count()).where(
                        AuditLog.created_at >= d30,
                        AuditLog.action == AuditAction.AI_QUERY.value,
                    ),
                )
            ).scalar() or 0

            # Export / import analytics
            export_import_rows = (
                await uow.session.execute(
                    select(
                        case(
                            (AuditLog.action == AuditAction.EXPORT.value, "export"),
                            (AuditLog.entity_type.ilike("%import%"), "import"),
                            else_="other",
                        ).label("kind"),
                        func.count().label("cnt"),
                    )
                    .where(AuditLog.created_at >= d30)
                    .group_by(literal_column("kind")),
                )
            ).all()

            # Geo/timezone and activity heatmap
            timezone_rows = (
                await uow.session.execute(
                    select(User.timezone, func.count().label("cnt")).group_by(User.timezone).order_by(func.count().desc()).limit(20),
                )
            ).all()
            heatmap_rows = (
                await uow.session.execute(
                    select(
                        func.extract("dow", AuditLog.created_at).label("dow"),
                        func.extract("hour", AuditLog.created_at).label("hour"),
                        func.count().label("cnt"),
                    )
                    .where(AuditLog.created_at >= d30)
                    .group_by(literal_column("dow"), literal_column("hour")),
                )
            ).all()

            # Executive cards
            plan_prices = {(p.name or "").strip().lower(): _safe_int(p.price_monthly) for p in plans_rows}
            org_plan_counts = {
                str(r.plan.value if hasattr(r.plan, "value") else r.plan).lower(): _safe_int(r.cnt)
                for r in plan_rows
            }
            mrr_proxy_cents = sum(org_plan_counts.get(plan, 0) * price for plan, price in plan_prices.items())
            new_orgs_30 = (await uow.session.execute(select(func.count()).where(Organization.created_at >= d30))).scalar() or 0
            new_orgs_prev_30 = (
                await uow.session.execute(
                    select(func.count()).where(Organization.created_at >= d60, Organization.created_at < d30),
                )
            ).scalar() or 0

        sec_anomalies = []
        for action in [AuditAction.LOGIN_FAILED.value, AuditAction.ACCESS_DENIED.value, AuditAction.TOKEN_ANOMALY.value]:
            last = _safe_int(sec_last.get(action, 0))
            prev = _safe_int(sec_prev.get(action, 0))
            growth_pct = round(((last - prev) / max(prev, 1)) * 100, 1) if prev > 0 else (100.0 if last > 0 else 0.0)
            sec_anomalies.append({"action": action, "last_24h": last, "prev_24h": prev, "growth_pct": growth_pct})

        export_import = {"export_count_30d": 0, "import_count_30d": 0, "avg_duration_ms": None}
        for r in export_import_rows:
            kind = str(r.kind)
            if kind == "export":
                export_import["export_count_30d"] = _safe_int(r.cnt)
            elif kind == "import":
                export_import["import_count_30d"] = _safe_int(r.cnt)

        heatmap = [
            {"dow": _safe_int(r.dow), "hour": _safe_int(r.hour), "count": _safe_int(r.cnt)}
            for r in heatmap_rows
        ]
        ai_tokens = [_safe_int(r.tokens) for r in ai_user_rows]
        total_ai_requests = sum(_safe_int(r.requests) for r in ai_user_rows)
        total_ai_users = len(ai_user_rows)

        analytics = {
            "funnel": {
                "registered_orgs": _safe_int(orgs_count),
                "activated_orgs": _safe_int(activated_orgs),
                "first_table_orgs": _safe_int(first_table_orgs),
                "first_record_orgs": _safe_int(first_record_orgs),
                "activation_rate_pct": round((_safe_int(activated_orgs) / max(_safe_int(orgs_count), 1)) * 100, 1),
                "table_conversion_pct": round((_safe_int(first_table_orgs) / max(_safe_int(orgs_count), 1)) * 100, 1),
                "record_conversion_pct": round((_safe_int(first_record_orgs) / max(_safe_int(orgs_count), 1)) * 100, 1),
            },
            "retention": {"cohorts": retention_cohorts},
            "engagement": {
                "dau": _safe_int(dau),
                "wau": _safe_int(wau),
                "mau": _safe_int(mau),
                "stickiness_pct": round((_safe_int(dau) / max(_safe_int(mau), 1)) * 100, 1),
            },
            "activity_by_role": [
                {
                    "role": str(r.role.value if hasattr(r.role, "value") else r.role),
                    "events_30d": _safe_int(r.events),
                    "active_users_30d": _safe_int(r.active_users),
                }
                for r in role_rows
            ],
            "activity_by_module": [{"module": str(r.entity_type or "unknown"), "events_30d": _safe_int(r.events)} for r in module_rows],
            "churn_risk": {"top_orgs": churn_risk_items},
            "tariff_analytics": {
                "free_to_team_30d": _safe_int(free_to_team),
                "free_to_business_30d": _safe_int(free_to_business),
                "free_to_paid_30d": _safe_int(free_to_team + free_to_business),
                "median_time_to_upgrade_days": round(float(median(ttu_days)), 1) if ttu_days else None,
            },
            "limits_usage": {"orgs": limits_items},
            "security_anomalies": {
                "top": sec_anomalies,
                "top_ips_24h": [{"ip": str(r.ip_address), "events": _safe_int(r.cnt)} for r in sec_ip_rows],
            },
            "data_quality": {
                "total_cells": total_cells,
                "empty_or_invalid_cells": empty_or_invalid_cells,
                "empty_or_invalid_rate_pct": empty_rate,
                "duplicate_groups": _safe_int(duplicate_groups_row),
            },
            "sla_backend": sla_backend,
            "ai_analytics": {
                "requests_per_user_30d": round(total_ai_requests / max(total_ai_users, 1), 2),
                "avg_tokens_per_request_30d": round((sum(ai_tokens) / max(total_ai_requests, 1)), 2),
                "tokens_per_org_30d": [
                    {
                        "org_id": str(r.org_id),
                        "requests": _safe_int(r.requests),
                        "tokens": _safe_int(r.tokens),
                    }
                    for r in ai_org_rows
                ],
                "ai_query_actions_30d": _safe_int(ai_query_actions_30d),
            },
            "export_import": export_import,
            "geo_timezones": {
                "top_timezones": [{"timezone": str(r.timezone or "UTC"), "users": _safe_int(r.cnt)} for r in timezone_rows],
                "activity_heatmap_30d": heatmap,
            },
            "executive_cards": {
                "mrr_proxy": round(mrr_proxy_cents / 100, 2),
                "new_orgs_30d": _safe_int(new_orgs_30),
                "new_orgs_prev_30d": _safe_int(new_orgs_prev_30),
                "growth_rate_pct": round(((_safe_int(new_orgs_30) - _safe_int(new_orgs_prev_30)) / max(_safe_int(new_orgs_prev_30), 1)) * 100, 1),
                "net_org_growth_30d": _safe_int(new_orgs_30) - _safe_int(new_orgs_prev_30),
            },
        }

        return {
            "totals": {
                "orgs": _safe_int(orgs_count),
                "users": _safe_int(users_count),
                "tables": _safe_int(tables_count),
                "records": _safe_int(records_count),
                "files": _safe_int(files_row[0]),
                "storage_bytes": _safe_int(files_row[1]),
                "ai_requests": _safe_int(ai_row[0]),
                "ai_tokens": _safe_int(ai_row[1]),
            },
            "registrations_timeline": [{"date": str(r.day)[:10], "count": r.cnt} for r in reg_rows],
            "orgs_by_plan": [
                {"plan": str(r.plan.value if hasattr(r.plan, "value") else r.plan), "count": r.cnt}
                for r in plan_rows
            ],
            "analytics": analytics,
        }

    async def list_org_options(self, limit: int = 200) -> list[dict]:
        async with UnitOfWork() as uow:
            stmt = select(Organization).order_by(Organization.created_at.desc()).limit(limit)
            orgs = list((await uow.session.execute(stmt)).scalars().all())
            return [
                {
                    "id": str(org.id),
                    "name": org.name,
                    "slug": org.slug,
                    "plan": org.plan.value if hasattr(org.plan, "value") else str(org.plan),
                    "created_at": org.created_at.isoformat() if org.created_at else None,
                }
                for org in orgs
            ]

    async def overview_data(self, org_limit: int = 200) -> dict:
        dash = await self.dashboard_data()
        orgs = await self.list_org_options(limit=org_limit)
        return {"dashboard": dash, "orgs": orgs, "generated_at": datetime.now(UTC).isoformat()}

    async def list_tables(self, limit: int, offset: int) -> list[dict]:
        async with UnitOfWork() as uow:
            stmt = select(Table).order_by(Table.created_at.desc()).limit(limit).offset(offset)
            tables = list((await uow.session.execute(stmt)).scalars().all())
            result: list[dict] = []
            for table in tables:
                rec_cnt = (
                    await uow.session.execute(
                        select(func.count()).select_from(Record).where(Record.table_id == table.id),
                    )
                ).scalar() or 0
                result.append(
                    {
                        "id": str(table.id),
                        "name": table.name,
                        "org_id": str(table.org_id),
                        "columns": len(table.columns) if table.columns else 0,
                        "records": rec_cnt,
                        "created_at": table.created_at.isoformat() if table.created_at else None,
                    },
                )
        return result

    async def ai_usage_by_org(self) -> list[dict]:
        async with UnitOfWork() as uow:
            stmt = (
                select(
                    AIUsageLog.org_id,
                    func.count().label("requests"),
                    func.coalesce(func.sum(AIUsageLog.total_tokens), 0).label("tokens"),
                )
                .group_by(AIUsageLog.org_id)
                .order_by(func.sum(AIUsageLog.total_tokens).desc())
            )
            rows = (await uow.session.execute(stmt)).all()
            org_ids = [row.org_id for row in rows]
            orgs_map: dict = {}
            if org_ids:
                orgs = list(
                    (
                        await uow.session.execute(select(Organization).where(Organization.id.in_(org_ids)))
                    ).scalars().all(),
                )
                orgs_map = {org.id: org.name for org in orgs}

        return [
            {
                "org_id": str(row.org_id),
                "org_name": orgs_map.get(row.org_id, "-"),
                "requests": _safe_int(row.requests),
                "tokens": _safe_int(row.tokens),
            }
            for row in rows
        ]
