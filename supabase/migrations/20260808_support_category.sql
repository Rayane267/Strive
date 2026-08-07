-- ═══════════════════════════════════════════════════════════════════════════
-- Tickets de support : catégorie + code d'erreur rattaché
-- ═══════════════════════════════════════════════════════════════════════════
-- Deux ajouts, deux objectifs distincts.
--
-- `category` : trier la file d'attente. Sans elle, tous les tickets arrivent en
-- vrac et il faut ouvrir chacun pour savoir s'il s'agit d'un bug de scan ou d'un
-- souci de paiement. Vocabulaire FERMÉ, contraint en base : une catégorie libre
-- redeviendrait du vrac au bout d'un mois.
--
-- `error_code` : le code que le chauffeur DÉSIGNE lui-même parmi les erreurs
-- qu'il vient de rencontrer. C'est plus fiable que le « dernier échec » joint
-- automatiquement, qui pouvait n'avoir aucun rapport avec sa demande — il ouvre
-- souvent un ticket bien après l'incident, et parfois pour autre chose.
-- Colonne plutôt que texte dans le message : ça se filtre et ça s'agrège.
-- Cf. SCAN_ERROR_CODES dans src/services/scanFailureService.ts.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.support_tickets
  add column if not exists category    text,
  add column if not exists subcategory text,
  add column if not exists error_code   text;

alter table public.support_tickets
  drop constraint if exists support_tickets_category_values;
alter table public.support_tickets
  add constraint support_tickets_category_values
  check (category is null or category in (
    'scan',          -- détection, verdict, adresses illisibles
    'subscription',  -- abonnement, paiement, restauration
    'account',       -- connexion, profil, suppression de compte
    'data',          -- historique, statistiques, courses manquantes
    'suggestion',    -- demande de fonctionnalité
    'other'
  ));

-- Sous-catégories PRÉFIXÉES par leur catégorie (`scan.addresses`). Ce n'est pas
-- cosmétique : ça permet à une seule contrainte de garantir l'appariement, au
-- lieu d'énumérer toutes les combinaisons valides. Un `scan.addresses` rangé
-- sous `subscription` est rejeté par la base, pas seulement par l'UI.
alter table public.support_tickets
  drop constraint if exists support_tickets_subcategory_values;
alter table public.support_tickets
  add constraint support_tickets_subcategory_values
  check (subcategory is null or subcategory in (
    'scan.no_detect', 'scan.wrong_values', 'scan.addresses',
    'scan.trigger', 'scan.display',
    'subscription.purchase', 'subscription.restore',
    'subscription.billing', 'subscription.cancel',
    'account.login', 'account.profile', 'account.delete',
    'data.missing_ride', 'data.wrong_stats', 'data.export'
  ));

alter table public.support_tickets
  drop constraint if exists support_tickets_subcategory_matches;
alter table public.support_tickets
  add constraint support_tickets_subcategory_matches
  check (subcategory is null or (category is not null and subcategory like category || '.%'));

-- Format `0xC0FEnnnn` uniquement : rejette un code inventé ou recopié de travers,
-- ce qui garderait la colonne agrégeable.
alter table public.support_tickets
  drop constraint if exists support_tickets_error_code_format;
alter table public.support_tickets
  add constraint support_tickets_error_code_format
  check (error_code is null or error_code ~ '^0xC0FE[0-9A-F]{4}$');

-- La file de support se trie par catégorie et par fraîcheur.
create index if not exists idx_support_tickets_category
  on public.support_tickets(category, last_message_at desc);

create index if not exists idx_support_tickets_subcategory
  on public.support_tickets(subcategory, last_message_at desc);

comment on column public.support_tickets.category is
  'Catégorie choisie par l''utilisateur. Vocabulaire fermé — voir la contrainte CHECK.';
comment on column public.support_tickets.subcategory is
  'Sous-catégorie, préfixée par sa catégorie (« scan.addresses »). Null pour « suggestion » et « other », qui n''en ont pas.';
comment on column public.support_tickets.error_code is
  'Code d''erreur que l''utilisateur a rattaché à son ticket, parmi les 3 derniers rencontrés. Format 0xC0FEnnnn.';
