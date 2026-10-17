-- ═══════════════════════════════════════════════════════════════════════════
-- rides : les courses longues ne sont plus refusées à l'écriture
-- ═══════════════════════════════════════════════════════════════════════════
--
-- L'app lit désormais un prix jusqu'à 2 000 €, une distance jusqu'à 2 000 km et
-- une durée jusqu'à 24 h (le plafond de 200 € a fait perdre un abonné le
-- 2026-10-15 : Lisses → Lyon, 432 km, 272,30 €). Les bornes posées ici en
-- 20260425_security_hardening (1 000 €, 1 000 km, 1 200 min) restaient en
-- dessous : une course mesurée aurait été rejetée au moment de l'enregistrer.
--
-- Ces CHECK restent un filet contre l'écriture de valeurs absurdes ; ils
-- doivent seulement rester AU-DESSUS des plafonds de l'app.

alter table public.rides
  drop constraint if exists rides_fare_estimated_check,
  drop constraint if exists rides_fare_final_check,
  drop constraint if exists rides_distance_km_check,
  drop constraint if exists rides_duration_min_check;

alter table public.rides
  add constraint rides_fare_estimated_check check (fare_estimated >= 0 and fare_estimated <= 5000),
  add constraint rides_fare_final_check     check (fare_final is null or (fare_final >= 0 and fare_final <= 5000)),
  add constraint rides_distance_km_check    check (distance_km > 0 and distance_km <= 5000),
  add constraint rides_duration_min_check   check (duration_min >= 0 and duration_min <= 2880);
