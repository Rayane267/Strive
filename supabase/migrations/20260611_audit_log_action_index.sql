-- ═══════════════════════════════════════════════════════════════════════════
-- Index audit_log (action, created_at) — pour le budget global Gemini
-- ═══════════════════════════════════════════════════════════════════════════
-- gemini-proxy compte désormais les gemini_call GLOBAUX des dernières 24h à
-- chaque requête (circuit breaker coût). Sans cet index, ce count scanne la
-- table entière (l'index existant commence par user_id, inutilisable ici).

create index if not exists idx_audit_log_action_created
  on public.audit_log (action, created_at desc);
