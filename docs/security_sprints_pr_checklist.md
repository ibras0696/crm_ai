# Security Sprints PR Checklist

Дата: 2026-02-24
Ветка: `feat`

## Выполненные пункты по спринтам

- [x] Спринт 1: baseline hardening инфраструктуры и prod policy.
- [x] Спринт 2: JWT/superadmin auth hardening, refresh race fix, security audit events.
- [x] Спринт 3: shared rate limit, upload/table IO hardening, safe AI errors.
- [x] Спринт 4: cookie-session, CSP hardening, blocking CI checks, security regression tests, dependency audit policy.

## Ссылки на коммиты

- `3945ebb` - sprint1 hardening baseline
- `a218e64` - sprint2 auth/JWT/security-audit hardening
- `257bf80` - sprint3 runtime/data hardening

## Коммиты, входящие в текущий PR (рабочее дерево)

Ниже изменения, которые должны быть закоммичены перед открытием PR:

- cookie-session migration (user + superadmin)
- CSP update (frontend nginx + backend headers)
- CI blocking checks + dependency audit jobs
- security regression tests
- docs updates (runbook, checklist, policy)

## Definition of Done статус

- [x] Есть PR checklist с выполненными пунктами и ссылками на коммиты.
- [x] Есть обновленный runbook по новым настройкам и ротации секретов.
- [ ] Нужна отметка QA/DevOps после smoke/regression на релизном окружении.
