// Concerts, spectacles et festivals saisis à la main (onglet « Événements »).
//
// Aucune source gratuite ne couvre les grandes salles et les stades : les
// billetteries (Fnac Spectacles, Ticketmaster) ne les ouvrent qu'en
// affiliation. En attendant, cette liste est relevée SALLE PAR SALLE sur les
// calendriers officiels et les agendas spécialisés (relevé du 7 octobre 2026 :
// octobre-décembre 2026 + grandes dates 2027 déjà annoncées). Elle vieillit
// vite : une date annulée ou déplacée ici est une erreur affichée au chauffeur.
//
// Périmètre : toutes les salles de 6 000 places et plus des 4 zones, les
// salons et les grands matchs hors Ligue 1 (rugby, Coupe d'Europe, EuroLeague),
// plus les fêtes de rue majeures. Concert sans heure publiée : 20:00. Match ou
// salon sans heure publiée : `start` à null, affiché « horaire à confirmer »
// plutôt que d'inventer une heure ou de taire un événement de 80 000 places.
// À compléter quand ils seront publiés : Harry Styles (Plenitude, juillet
// 2027), Nuits Sonores (5-9 mai 2027), corsos du Carnaval de Nice (février).

import type { SignalRow } from "./idfm.ts";

type Venue = { city: string; name: string; seats: number; lat: number; lon: number };

const V: Record<string, Venue> = {
  sdf: { city: "paris", name: "Stade de France", seats: 80_000, lat: 48.9245, lon: 2.3602 },
  plenitude: { city: "paris", name: "Plenitude Arena", seats: 40_000, lat: 48.8957, lon: 2.2296 },
  accor: { city: "paris", name: "Accor Arena", seats: 20_300, lat: 48.8386, lon: 2.3786 },
  adidas: { city: "paris", name: "Adidas Arena", seats: 8_000, lat: 48.8994, lon: 2.3600 },
  zenith: { city: "paris", name: "Zénith Paris", seats: 6_300, lat: 48.8940, lon: 2.3933 },
  groupama: { city: "lyon", name: "Groupama Stadium", seats: 59_000, lat: 45.7653, lon: 4.9822 },
  htg: { city: "lyon", name: "Halle Tony Garnier", seats: 17_000, lat: 45.7319, lon: 4.8246 },
  ldlc: { city: "lyon", name: "LDLC Arena", seats: 16_000, lat: 45.7637, lon: 4.9858 },
  lumieres: { city: "lyon", name: "Presqu'île", seats: 500_000, lat: 45.7578, lon: 4.8320 },
  velodrome: { city: "marseille", name: "Orange Vélodrome", seats: 67_000, lat: 43.2698, lon: 5.3959 },
  dome: { city: "marseille", name: "Le Dôme", seats: 8_500, lat: 43.3115, lon: 5.4038 },
  aix: { city: "marseille", name: "Arena du Pays d'Aix", seats: 8_500, lat: 43.4895, lon: 5.3725 },
  allianz: { city: "nice", name: "Allianz Riviera", seats: 36_000, lat: 43.7051, lon: 7.1926 },
  nikaia: { city: "nice", name: "Palais Nikaïa", seats: 9_000, lat: 43.6776, lon: 7.1952 },
  parc: { city: "paris", name: "Parc des Princes", seats: 48_000, lat: 48.8414, lon: 2.2530 },
  expo: { city: "paris", name: "Paris Expo Porte de Versailles", seats: 70_000, lat: 48.8323, lon: 2.2878 },
  villepinte: { city: "paris", name: "Paris Nord Villepinte", seats: 60_000, lat: 48.9725, lon: 2.5150 },
  louis2: { city: "nice", name: "Stade Louis-II", seats: 18_500, lat: 43.7276, lon: 7.4155 },
  eurexpo: { city: "lyon", name: "Eurexpo", seats: 30_000, lat: 45.7313, lon: 4.9472 },
  chanot: { city: "marseille", name: "Parc Chanot", seats: 15_000, lat: 43.2689, lon: 5.3950 },
};

type Item = {
  venue: keyof typeof V;
  type: "CONCERT" | "FESTIVAL" | "SPECTACLE" | "SPORT" | "SALON";
  title: string;
  dates: string[];
  start: string | null; // heure locale ; null = pas encore publiée
  end?: string; // heure de fin connue (fêtes) ; sinon début + 2 h 30
  seats?: number; // jauge de cette configuration si elle diffère de la salle
  approxEnd?: boolean; // `end` estimé, affiché « Fin ≈ » et non « Jusqu'à »
};

const c = (venue: keyof typeof V, title: string, dates: string[], start: string | null = "20:00", type: Item["type"] = "CONCERT"): Item =>
  ({ venue, type, title, dates, start });

export const CURATED: Item[] = [
  // ── Paris · Plenitude Arena (site officiel ; Céline Dion sur scène à 20:00) ──
  c("plenitude", "Céline Dion", ["2026-10-07", "2026-10-09", "2026-10-10", "2026-10-14", "2026-10-16", "2026-10-17"]),
  c("plenitude", "Muse", ["2026-11-27"]),
  c("plenitude", "Joé Dwèt Filé", ["2026-12-05"]),
  c("plenitude", "Anyma", ["2026-12-12"], "18:00"),
  c("plenitude", "Gims", ["2026-12-16", "2026-12-17"]),
  c("plenitude", "Enhypen", ["2027-02-27"]),
  c("plenitude", "KYO", ["2027-03-13"]),
  c("plenitude", "Olivia Rodrigo", ["2027-04-23", "2027-04-24"]),
  c("plenitude", "Céline Dion", ["2027-05-08", "2027-05-12", "2027-05-14", "2027-05-15", "2027-05-19",
    "2027-05-21", "2027-05-22", "2027-05-26", "2027-05-28", "2027-05-29"]),
  c("plenitude", "Blink-182", ["2027-06-15"]),
  c("plenitude", "Karol G", ["2027-07-01"]),

  // ── Paris · Accor Arena ──
  c("accor", "Stevie Wonder", ["2026-10-15"]),
  c("accor", "Gradur", ["2026-10-16"]),
  c("accor", "Youssou N'Dour", ["2026-10-17"], "19:00"),
  c("accor", "Bigflo & Oli", ["2026-10-19", "2026-10-20"]),
  c("accor", "Le Sserafim", ["2026-10-21"], "19:30"),
  c("accor", "The Strokes", ["2026-10-22"], "19:30"),
  c("accor", "Korn", ["2026-10-23"], "19:30"),
  c("accor", "Asake", ["2026-10-24"]),
  c("accor", "Don Toliver", ["2026-10-25"], "19:00"),
  c("accor", "Meryl", ["2026-10-26"]),
  c("accor", "Simple Plan", ["2026-10-31"]),
  c("accor", "The World of Hans Zimmer", ["2026-11-02"], "20:00", "SPECTACLE"),
  c("accor", "J. Cole", ["2026-11-05"]),
  c("accor", "Niall Horan", ["2026-11-06"]),
  c("accor", "Lujipeka", ["2026-11-07"]),
  c("accor", "Vanessa Paradis", ["2026-11-17"]),
  c("accor", "Christophe Maé", ["2026-11-19", "2026-11-20"]),
  c("accor", "Moise Mbiye", ["2026-11-21"]),
  c("accor", "Hatsune Miku", ["2026-11-22"]),
  c("accor", "Superbus", ["2026-11-24"]),
  c("accor", "Placebo", ["2026-11-25"]),
  c("accor", "Le Triangle des Bermudes", ["2026-11-27", "2026-11-28"]),
  c("accor", "Boy George", ["2026-12-04"]),
  c("accor", "Noah Kahan", ["2026-12-07"]),
  c("accor", "Orelsan", ["2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12", "2026-12-14", "2026-12-15", "2026-12-16",
    "2026-12-18", "2026-12-19", "2026-12-20", "2026-12-22", "2026-12-23", "2026-12-26", "2026-12-27", "2026-12-28"]),
  c("accor", "Guy2bezbar", ["2027-04-17"]),

  // ── Paris · Adidas Arena ──
  c("adidas", "Masego", ["2026-10-10"]),
  c("adidas", "Deep Purple", ["2026-10-22"]),
  c("adidas", "Young Thug", ["2026-10-24"]),
  c("adidas", "Tokio Hotel", ["2026-10-30", "2026-11-21"], "19:30"),
  c("adidas", "Doc Gynéco", ["2026-11-10"]),
  c("adidas", "Taemin", ["2026-11-16"]),
  c("adidas", "Helena", ["2026-11-17"]),
  c("adidas", "Bryson Tiller", ["2026-11-18"], "19:00"),
  c("adidas", "Papa Roach", ["2026-12-01"], "19:00"),
  c("adidas", "Kehlani", ["2026-12-03"], "19:00"),

  // ── Paris · Zénith ──
  c("zenith", "Jill Scott", ["2026-10-09"]),
  c("zenith", "Fat Freddy's Drop", ["2026-10-10"]),
  c("zenith", "Glorious", ["2026-10-11"]),
  c("zenith", "Tyla", ["2026-10-12"]),
  c("zenith", "Amon Amarth", ["2026-10-13"]),
  c("zenith", "Calbo", ["2026-10-14"]),
  c("zenith", "Behemoth × Dimmu Borgir", ["2026-10-16"]),
  c("zenith", "Mosimann", ["2026-10-17"]),
  c("zenith", "Shinedown", ["2026-10-31"]),
  c("zenith", "Saint Levant", ["2026-11-02", "2026-11-03"]),
  c("zenith", "Benjamin Biolay", ["2026-11-05", "2026-11-06"]),
  c("zenith", "Omah Lay", ["2026-11-13"]),
  c("zenith", "Westlife", ["2026-11-15"]),
  c("zenith", "Good Charlotte", ["2026-11-17"]),
  c("zenith", "Loboda", ["2026-11-22"]),
  c("zenith", "The Pretty Reckless", ["2026-11-24"]),
  c("zenith", "Beabadoobee", ["2026-11-30"]),
  c("zenith", "Ben Mazué", ["2026-12-15", "2026-12-16"]),

  // ── Paris · Stade de France (2027) ──
  c("sdf", "Niska", ["2027-04-09", "2027-04-10", "2027-04-11"]),
  c("sdf", "Sofiane Pamart", ["2027-04-17"]),
  c("sdf", "SCH", ["2027-04-24"]),
  c("sdf", "Kaaris", ["2027-05-22"]),
  c("sdf", "SDM", ["2027-05-29", "2027-05-30"]),
  c("sdf", "Oasis", ["2027-07-23", "2027-07-24"]),

  // ── Lyon · LDLC Arena (site officiel) ──
  c("ldlc", "LDLC ASVEL – Partizan", ["2026-10-28"], "20:00", "SPORT"),
  c("ldlc", "LDLC ASVEL – Baskonia", ["2026-10-30"], "20:00", "SPORT"),
  c("ldlc", "Dabeull Live Band", ["2026-10-31"]),
  c("ldlc", "Gims", ["2026-11-02"]),
  c("ldlc", "LDLC ASVEL – Bayern Munich", ["2026-11-05"], "20:00", "SPORT"),
  c("ldlc", "Bigflo & Oli", ["2026-11-06"]),
  c("ldlc", "Pitbull", ["2026-11-11"]),
  c("ldlc", "LDLC ASVEL – Besiktas", ["2026-11-13"], "20:30", "SPORT"),
  c("ldlc", "Vanessa Paradis", ["2026-11-14"]),
  c("ldlc", "Deep Purple", ["2026-11-15"]),
  c("ldlc", "Orelsan", ["2026-11-16"]),
  c("ldlc", "PLK", ["2026-11-20"]),
  c("ldlc", "Redouane Bougheraba", ["2026-11-21"], "20:00", "SPECTACLE"),
  c("ldlc", "Helena", ["2026-11-22"], "18:00"),
  c("ldlc", "Placebo", ["2026-11-23"]),
  c("ldlc", "LDLC ASVEL – Olimpia Milan", ["2026-11-24"], "20:45", "SPORT"),
  c("ldlc", "Ben Mazué", ["2026-11-26"]),
  c("ldlc", "Bryan Adams", ["2026-11-30"]),
  c("ldlc", "Eric Serra", ["2026-12-02"]),
  c("ldlc", "Florent Pagny", ["2026-12-03"]),
  c("ldlc", "Mustapha El Atrassi", ["2026-12-05"], "21:00", "SPECTACLE"),
  c("ldlc", "Papa Roach", ["2026-12-06"], "19:00"),
  c("ldlc", "Saez", ["2026-12-09"], "20:30"),
  c("ldlc", "Gaëtan Roussel", ["2026-12-10"]),
  c("ldlc", "Christophe Maé", ["2026-12-11"]),
  c("ldlc", "Superbus", ["2026-12-17"]),

  // ── Lyon · Halle Tony Garnier (site officiel) ──
  c("htg", "Festival Lumière · ouverture", ["2026-10-10"], "18:00", "FESTIVAL"),
  c("htg", "Nuit Encore × 23:59", ["2026-10-24"], "22:00", "FESTIVAL"),
  c("htg", "Djadja & Dinaz", ["2026-11-05", "2026-11-06"]),
  c("htg", "Josman", ["2026-11-07"]),
  c("htg", "The World of Hans Zimmer", ["2026-11-10"], "20:00", "SPECTACLE"),
  c("htg", "Malik Bentalha", ["2026-11-11"], "20:00", "SPECTACLE"),
  c("htg", "L'Héritage Goldman 2", ["2026-11-19"]),
  c("htg", "Disiz", ["2026-12-04"]),
  c("htg", "Face2Face All Night Long", ["2026-12-11"], "21:30", "FESTIVAL"),
  c("htg", "Disney en concert", ["2026-12-18"], "20:00", "SPECTACLE"),

  // ── Lyon · fête et stade ──
  { venue: "lumieres", type: "FESTIVAL", title: "Fête des Lumières",
    dates: ["2026-12-05", "2026-12-06", "2026-12-07", "2026-12-08"], start: "18:00", end: "00:00" },
  c("groupama", "Soprano", ["2027-07-10"], "19:00"),
  c("groupama", "Karol G", ["2027-07-21"], "19:00"),

  // ── Marseille · Le Dôme ──
  c("dome", "Jeff Panacloc", ["2026-10-15"], "20:00", "SPECTACLE"),
  c("dome", "Vanessa Paradis", ["2026-10-25"]),
  c("dome", "Patrick Bruel", ["2026-10-30"]),
  c("dome", "Josman", ["2026-11-06"]),
  c("dome", "Bigflo & Oli", ["2026-11-08"], "19:00"),
  c("dome", "Christophe Maé", ["2026-11-13"]),
  c("dome", "Legendary Rock Voices", ["2026-11-17"]),
  c("dome", "Disney en concert", ["2026-11-27"], "20:00", "SPECTACLE"),
  c("dome", "Goldmen", ["2026-11-28"]),
  c("dome", "Orelsan", ["2026-12-02", "2026-12-03"]),
  c("dome", "PLK", ["2026-12-04"]),
  c("dome", "Feu! Chatterton", ["2026-12-10"]),

  // ── Marseille · Arena du Pays d'Aix ──
  c("aix", "La Dame de Pierre", ["2026-10-11"], "18:00", "SPECTACLE"),
  c("aix", "Le Lac des Cygnes", ["2026-10-21"], "20:00", "SPECTACLE"),
  c("aix", "Dorothée", ["2026-11-19"]),
  c("aix", "L'Héritage Goldman 2", ["2026-11-22"], "18:00"),
  c("aix", "Eric Serra", ["2026-11-27"]),
  c("aix", "Ben Mazué", ["2026-11-28"]),
  c("aix", "David Hallyday", ["2026-12-02"]),
  c("aix", "Saez", ["2026-12-05"], "20:30"),
  c("aix", "Casse-Noisette", ["2026-12-16"], "20:00", "SPECTACLE"),

  // ── Marseille · Vélodrome (2027) ──
  c("velodrome", "Gims", ["2027-06-19"]),

  // ── Nice · Palais Nikaïa ──
  c("nikaia", "La Dame de Pierre", ["2026-10-10"], "20:45", "SPECTACLE"),
  c("nikaia", "Laura Pausini", ["2026-10-30"]),
  c("nikaia", "Bigflo & Oli", ["2026-11-05"]),
  c("nikaia", "Véronique Sanson", ["2026-11-12"], "20:30"),
  c("nikaia", "Vanessa Paradis", ["2026-11-13"]),
  c("nikaia", "L'Héritage Goldman 2", ["2026-11-21"], "20:30"),
  c("nikaia", "Eric Serra", ["2026-11-28"]),
  c("nikaia", "La Reine des Neiges sur glace", ["2026-12-01"], "18:30", "SPECTACLE"),
  c("nikaia", "Christophe Maé", ["2026-12-04"]),
  c("nikaia", "PLK", ["2026-12-06"], "19:00"),
  c("nikaia", "Florent Pagny", ["2026-12-07"]),

  // ── Nice · Allianz Riviera (2027) ──
  c("allianz", "Gims", ["2027-07-03"]),

  // ── Sport hors Ligue 1 (horaires officiels des clubs et fédérations) ──
  c("groupama", "France – Fidji (rugby)", ["2026-11-07"], "21:10", "SPORT"),
  c("sdf", "France – Afrique du Sud (rugby)", ["2026-11-13"], "21:10", "SPORT"),
  c("sdf", "France – Argentine (rugby)", ["2026-11-21"], "21:10", "SPORT"),
  c("parc", "PSG – FC Barcelone (Ligue des champions)", ["2026-10-20"], "21:00", "SPORT"),
  c("parc", "PSG – AS Roma (Ligue des champions)", ["2026-11-25"], "21:00", "SPORT"),
  c("velodrome", "OM – Olympiakos (Ligue Europa)", ["2026-10-15"], "21:00", "SPORT"),
  c("velodrome", "OM – Levski Sofia (Ligue Europa)", ["2026-11-26"], "18:45", "SPORT"),
  c("velodrome", "OM – Celta Vigo (Ligue Europa)", ["2026-12-10"], "18:45", "SPORT"),
  c("velodrome", "OM – Anderlecht (Ligue Europa)", ["2027-01-28"], "21:00", "SPORT"),
  c("groupama", "OL – Crystal Palace (Ligue Europa)", ["2026-10-15"], "18:45", "SPORT"),
  c("groupama", "OL – Lillestrøm (Ligue Europa)", ["2026-11-26"], "21:00", "SPORT"),
  c("groupama", "OL – Union Saint-Gilloise (Ligue Europa)", ["2026-12-10"], "21:00", "SPORT"),
  c("groupama", "OL – Bayer Leverkusen (Ligue Europa)", ["2027-01-28"], "21:00", "SPORT"),
  c("louis2", "Monaco – Fribourg (Ligue Conférence)", ["2026-10-22"], "21:00", "SPORT"),
  c("louis2", "Monaco – Nordsjælland (Ligue Conférence)", ["2026-11-05"], "21:00", "SPORT"),
  c("louis2", "Monaco – Lincoln Red Imps (Ligue Conférence)", ["2026-12-17"], "21:00", "SPORT"),
  // OGC Nice : pas de Coupe d'Europe en 2026-27 (calendrier officiel du club).
  c("adidas", "Paris Basketball – ASVEL (EuroLeague)", ["2026-10-07"], "20:45", "SPORT"),
  c("adidas", "Paris Basketball – Virtus Bologne (EuroLeague)", ["2026-10-14"], "20:45", "SPORT"),
  c("adidas", "Paris Basketball – Hapoel Tel-Aviv (EuroLeague)", ["2026-11-19"], "20:45", "SPORT"),
  c("adidas", "Paris Basketball – Real Madrid (EuroLeague)", ["2026-12-10"], "20:45", "SPORT"),
  // Rolex Paris Masters (configuration tennis ≈ 16 000) : la séance du soir
  // (19:00, deux matchs, fin estimée vers 23:00) est celle qui compte pour les
  // VTC. Qualifications des 31/10-1/11 omises (tribunes clairsemées). Demi-
  // finales du 7/11 : horaire pas encore publié. Finale du simple à 15:00.
  { ...c("plenitude", "Rolex Paris Masters · séance du soir",
    ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"], "19:00", "SPORT"),
    end: "23:00", approxEnd: true, seats: 16_000 },
  { ...c("plenitude", "Rolex Paris Masters · demi-finales", ["2026-11-07"], null, "SPORT"), seats: 16_000 },
  { ...c("plenitude", "Rolex Paris Masters · finale", ["2026-11-08"], "15:00", "SPORT"), seats: 16_000 },
  c("plenitude", "Supercross de Paris", ["2026-11-21", "2026-11-22"], null, "SPECTACLE"),
  c("adidas", "Cirque du Soleil · OVO", ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"], null, "SPECTACLE"),

  // ── Salons ──
  { venue: "expo", type: "SALON", title: "Mondial de l'Auto", dates: ["2026-10-13", "2026-10-14", "2026-10-15"], start: "09:30", end: "20:00" },
  { venue: "expo", type: "SALON", title: "Mondial de l'Auto", dates: ["2026-10-16", "2026-10-17"], start: "09:30", end: "22:00" },
  { venue: "expo", type: "SALON", title: "Mondial de l'Auto", dates: ["2026-10-18"], start: "09:30", end: "18:30" },
  // Fréquentation par jour = ordre de grandeur (bilans des éditions passées).
  { ...c("expo", "Paris Games Week", ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"], null, "SALON"), seats: 40_000 },
  { ...c("expo", "Salon du Chocolat", ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"], null, "SALON"), seats: 20_000 },
  { ...c("expo", "EquipHotel (salon pro)", ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"], null, "SALON"), seats: 25_000 },
  { ...c("expo", "MIF Expo", ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"], null, "SALON"), seats: 20_000 },
  { ...c("expo", "Créations & Savoir-Faire", ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"], null, "SALON"), seats: 20_000 },
  { ...c("villepinte", "SIAL Paris (salon pro)", ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"], null, "SALON"), seats: 60_000 },
  { ...c("eurexpo", "Equita Lyon", ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"], null, "SALON"), seats: 30_000 },
  { ...c("eurexpo", "Epoqu'auto", ["2026-11-06", "2026-11-07", "2026-11-08"], null, "SALON"), seats: 25_000 },
  { ...c("eurexpo", "Japan Touch", ["2026-11-28", "2026-11-29"], null, "SALON"), seats: 20_000 },
  { ...c("chanot", "HeroFestival", ["2026-11-07", "2026-11-08"], null, "SALON"), seats: 15_000 },
  { ...c("chanot", "Salon de l'Auto de Marseille", ["2026-11-13", "2026-11-14", "2026-11-15"], null, "SALON"), seats: 10_000 },
];

const DAY = 86_400_000;
// Onglet « Événements » : 2 mois devant, au-delà le chauffeur ne planifie pas.
export const EVENTS_AHEAD_DAYS = 60;
const pad = (n: number) => String(n).padStart(2, "0");

/** « 2026-10-15 » + « 20:00 » + minutes → heure locale ISO sans fuseau, jour suivant compris. */
function shift(date: string, hhmm: string, plusMin: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + plusMin;
  const day = new Date(Date.parse(`${date}T00:00:00Z`) + Math.floor(total / 1440) * DAY).toISOString().slice(0, 10);
  return `${day}T${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}:00`;
}

const minutes = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

export function curatedEvents(now = new Date()): SignalRow[] {
  const from = now.getTime() - DAY / 2;
  const to = now.getTime() + EVENTS_AHEAD_DAYS * DAY;
  const rows: SignalRow[] = [];
  for (const it of CURATED) {
    const v = V[it.venue];
    const seats = it.seats ?? v.seats;
    for (const date of it.dates) {
      const t = Date.parse(`${date}T12:00:00Z`);
      if (t < from || t > to) continue;
      // Fin connue : si elle passe minuit, c'est le lendemain.
      const ends = !it.start ? null
        : it.end ? shift(date, it.start, (minutes(it.end) - minutes(it.start) + 1440) % 1440 || 1440)
        // Match ≈ 2 h (mi-temps et arrêts compris), concert ou spectacle ≈ 2 h 30.
        : shift(date, it.start, it.type === "SPORT" ? 120 : 150);
      rows.push({
        id: `${it.venue}:${date}:${it.title}`,
        city: v.city,
        kind: "event",
        title: it.title,
        detail: `${!ends ? "Horaire à confirmer" : `${it.end && !it.approxEnd ? "Jusqu'à" : "Fin ≈"} ${ends.slice(11, 16)}`}` +
          ` · ≈ ${seats.toLocaleString("fr-FR")} ${it.venue === "lumieres" ? "visiteurs" : it.type === "SALON" ? "visiteurs / jour" : "places"}`,
        place: v.name,
        mode: it.type.toLowerCase(),
        lat: v.lat,
        lon: v.lon,
        starts_local: `${date}T${it.start ?? "00:00"}:00`,
        ends_local: ends,
        intensity: seats >= 40_000 ? 5 : seats >= 20_000 ? 4 : seats >= 12_000 ? 3 : 2,
      });
    }
  }
  return rows;
}
