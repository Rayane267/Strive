-- ═══════════════════════════════════════════════════════════════════════════
-- profiles.app_version : la version de Strive installée, push accepté ou non
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Jusqu'ici, plateforme et version n'arrivaient qu'avec le jeton push : un
-- chauffeur qui n'avait pas accepté les notifications restait invisible, sans
-- même savoir s'il était sur iPhone ou sur Android.
--
-- L'app écrit désormais `device_platform` et `app_version` à chaque démarrage
-- de session (appReleaseService.reportAppVersion). `notify-release` s'en sert
-- pour ne pas annoncer une version à qui l'a déjà.
--
-- Une ligne par compte : avec deux téléphones, c'est le dernier ouvert qui parle.

alter table public.profiles
  add column if not exists app_version text;
