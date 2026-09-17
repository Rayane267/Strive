-- ═══════════════════════════════════════════════════════════════════════════
-- device_scan_usage — réamorcer le compteur d'appareil depuis le serveur
-- ═══════════════════════════════════════════════════════════════════════════
--
-- LE TROU QU'ELLE BOUCHE. Le plafond de scans par appareil est appliqué à deux
-- endroits : le natif refuse AVANT l'OCR (donc sans rien dépenser), le serveur
-- refuse à l'insertion (donc après). Le compteur natif vit dans l'App Group,
-- que la désinstallation efface — alors que le `device_id` du Keychain, lui,
-- survit.
--
-- Conséquence : après « supprime le compte, désinstalle, réinstalle, recrée »,
-- le natif repartait de zéro et laissait passer le scan. Vision, TomTom et
-- Gemini étaient dépensés, puis le serveur refusait l'insertion. Le chauffeur
-- était bien bloqué, mais l'appel était payé.
--
-- POURQUOI UNE SIMPLE LECTURE SUFFIT. La désinstallation efface aussi le JWT de
-- l'App Group, et `AnalyzeRideIntent.isSignedIn` refuse tout scan sans jeton. Le
-- chauffeur DOIT donc rouvrir l'app et se connecter avant de pouvoir scanner :
-- il n'existe aucune fenêtre où un scan part d'un App Group vierge sans que le
-- JS ait tourné avant. Le JS n'a qu'à redescendre le compteur au passage.
--
-- Pas besoin, donc, de déplacer le compteur dans le Keychain : le serveur est
-- déjà la source de vérité, il suffit de la lire au bon moment.

create or replace function public.device_scan_usage()
returns int
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  v_device text;
  v_day    date;
  v_used   int;
begin
  if uid is null then
    return 0;
  end if;

  -- `request_device_id()` est révoquée de `public` : c'est le SECURITY DEFINER
  -- qui donne le droit de l'appeler. Sans en-tête — client antérieur, appel hors
  -- PostgREST — elle rend NULL, et on rend 0 : le natif gardera son compteur
  -- local, et le serveur restera de toute façon le juge à l'insertion.
  v_device := public.request_device_id();
  if v_device is null then
    return 0;
  end if;

  -- Même journée que `enforce_scan_quota` : celle du chauffeur, heure de reset
  -- comprise. Un décalage ici rendrait le compteur poussé au natif incohérent
  -- avec celui qui décide côté serveur.
  v_day := public.user_day_start(uid)::date;

  select coalesce(sum(l.scans), 0)::int
    into v_used
    from public.device_scan_ledger l
   where l.device_id = v_device
     and l.day = v_day;

  return coalesce(v_used, 0);
end;
$$;

-- Le chauffeur a le droit de lire CE chiffre — c'est la consommation de son
-- propre téléphone, et elle conditionne ce que l'app lui affiche. La table, elle,
-- reste fermée : il n'a pas à savoir quels comptes l'ont consommée.
grant execute on function public.device_scan_usage() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════
-- Depuis l'éditeur SQL (pas d'en-tête HTTP) → 0, et c'est normal :
--   select public.device_scan_usage();
--
-- Depuis l'app (supabase.rpc('device_scan_usage')) → le nombre de scans faits
-- aujourd'hui depuis ce téléphone, tous comptes confondus.
--
-- Recoupement manuel :
--   select sum(scans) from public.device_scan_ledger
--    where device_id = '<device_id>' and day = current_date;
