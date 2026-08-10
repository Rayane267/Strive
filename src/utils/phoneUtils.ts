// src/utils/phoneUtils.ts
//
// Source unique pour les indicatifs, la validation de longueur et le formatage
// avec espaces. Auparavant chaque écran avait sa règle : ProfileSetup validait
// par indicatif sans jamais formater, AccountInfo découpait en paires de 2 —
// y compris un numéro stocké en E.164, d'où l'affichage « +3 36 12 34 56 78 ».

import { Platform, NativeModules } from 'react-native';

export type DialCode = {
  code: string;
  iso: string;
  flag: string;
  nameKey: string;
  /** Longueurs acceptées pour le numéro NATIONAL (préfixe de départ retiré). */
  digits: number[];
  /** Découpage d'affichage par longueur. Sinon `fallbackGroups`. */
  groups?: Record<number, number[]>;
  /** `true` si un 0 initial est un préfixe national à retirer avant l'indicatif. */
  trunk?: boolean;
};

// `trunk` est explicite par pays : le code précédent faisait `replace(/^0+/, '')`
// partout, ce qui mangeait le 0 significatif des fixes italiens (06 = Rome) et
// rabotait des zéros là où aucun préfixe national n'existe (LU, CI, US).
export const DIAL_CODES: DialCode[] = [
  { code: '+33',  iso: 'FR', flag: '🇫🇷', nameKey: 'countries.fr', digits: [9],        trunk: true,  groups: { 9: [1, 2, 2, 2, 2] } },
  { code: '+32',  iso: 'BE', flag: '🇧🇪', nameKey: 'countries.be', digits: [8, 9],     trunk: true,  groups: { 9: [3, 2, 2, 2], 8: [2, 2, 2, 2] } },
  { code: '+41',  iso: 'CH', flag: '🇨🇭', nameKey: 'countries.ch', digits: [9],        trunk: true,  groups: { 9: [2, 3, 2, 2] } },
  { code: '+352', iso: 'LU', flag: '🇱🇺', nameKey: 'countries.lu', digits: [6, 7, 8, 9] },
  { code: '+213', iso: 'DZ', flag: '🇩🇿', nameKey: 'countries.dz', digits: [9],        trunk: true,  groups: { 9: [3, 2, 2, 2] } },
  { code: '+212', iso: 'MA', flag: '🇲🇦', nameKey: 'countries.ma', digits: [9],        trunk: true,  groups: { 9: [3, 2, 2, 2] } },
  { code: '+216', iso: 'TN', flag: '🇹🇳', nameKey: 'countries.tn', digits: [8],                      groups: { 8: [2, 3, 3] } },
  { code: '+221', iso: 'SN', flag: '🇸🇳', nameKey: 'countries.sn', digits: [9],                      groups: { 9: [2, 3, 2, 2] } },
  { code: '+225', iso: 'CI', flag: '🇨🇮', nameKey: 'countries.ci', digits: [10],                     groups: { 10: [2, 2, 2, 2, 2] } },
  { code: '+237', iso: 'CM', flag: '🇨🇲', nameKey: 'countries.cm', digits: [9],                      groups: { 9: [1, 2, 2, 2, 2] } },
  { code: '+223', iso: 'ML', flag: '🇲🇱', nameKey: 'countries.ml', digits: [8],                      groups: { 8: [2, 2, 2, 2] } },
  { code: '+224', iso: 'GN', flag: '🇬🇳', nameKey: 'countries.gn', digits: [9],                      groups: { 9: [3, 2, 2, 2] } },
  { code: '+351', iso: 'PT', flag: '🇵🇹', nameKey: 'countries.pt', digits: [9],                      groups: { 9: [3, 3, 3] } },
  { code: '+34',  iso: 'ES', flag: '🇪🇸', nameKey: 'countries.es', digits: [9],                      groups: { 9: [3, 3, 3] } },
  // Italie : le 0 des fixes fait partie du numéro (06… = Rome) → pas de trunk.
  { code: '+39',  iso: 'IT', flag: '🇮🇹', nameKey: 'countries.it', digits: [9, 10, 11],              groups: { 10: [3, 3, 4], 9: [3, 3, 3] } },
  { code: '+44',  iso: 'GB', flag: '🇬🇧', nameKey: 'countries.gb', digits: [9, 10],    trunk: true,  groups: { 10: [4, 6], 9: [3, 6] } },
  // Allemagne : longueur nationale très variable (fixes courts en province,
  // mobiles 10-11). On borne large plutôt que de rejeter des numéros valides.
  { code: '+49',  iso: 'DE', flag: '🇩🇪', nameKey: 'countries.de', digits: [7, 8, 9, 10, 11], trunk: true, groups: { 11: [3, 4, 4], 10: [3, 3, 4] } },
  { code: '+40',  iso: 'RO', flag: '🇷🇴', nameKey: 'countries.ro', digits: [9],        trunk: true,  groups: { 9: [3, 3, 3] } },
  { code: '+48',  iso: 'PL', flag: '🇵🇱', nameKey: 'countries.pl', digits: [9],                      groups: { 9: [3, 3, 3] } },
  { code: '+1',   iso: 'US', flag: '🇺🇸', nameKey: 'countries.us', digits: [10],                     groups: { 10: [3, 3, 4] } },
];

/** Indicatifs du plus long au plus court — nécessaire pour que `+352` gagne sur `+35`. */
const DIAL_BY_LENGTH = [...DIAL_CODES].sort((a, b) => b.code.length - a.code.length);

// Région (pays) de l'appareil → indicatif par défaut. On lit le code pays ISO
// depuis la locale Intl (ex. "fr-FR" → "FR"), avec fallback NativeModules.
export function getDeviceRegion(): string | null {
  const pickRegion = (raw?: string | null): string | null => {
    if (typeof raw !== 'string') return null;
    // On saute le 1er sous-tag (langue) et on cherche un token pays à 2 lettres.
    const region = raw.split(/[-_]/).slice(1).find(p => /^[A-Za-z]{2}$/.test(p));
    return region ? region.toUpperCase() : null;
  };
  try {
    const fromIntl = pickRegion(Intl.DateTimeFormat().resolvedOptions().locale);
    if (fromIntl) return fromIntl;
    const raw = Platform.OS === 'ios'
      ? NativeModules.SettingsManager?.settings?.AppleLocale ||
        NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
      : NativeModules.I18nManager?.localeIdentifier;
    return pickRegion(raw);
  } catch {
    return null;
  }
}

export const DEFAULT_DIAL: DialCode =
  DIAL_CODES.find(d => d.iso === getDeviceRegion()) ?? DIAL_CODES[0];

/** Groupes par défaut : un paquet de 3 en tête si la longueur est impaire, puis des paires. */
function fallbackGroups(len: number): number[] {
  if (len <= 4) return [len];
  const groups: number[] = [];
  let rest = len;
  if (rest % 2 === 1) { groups.push(3); rest -= 3; }
  while (rest > 0) { groups.push(2); rest -= 2; }
  return groups;
}

/** Chiffres seuls + retrait du préfixe national (UN seul 0, et seulement si le pays en a un). */
export function normalizeNational(raw: string, dial: DialCode): string {
  const digits = (raw || '').replace(/\D/g, '');
  return dial.trunk ? digits.replace(/^0/, '') : digits;
}

/**
 * Numéro national espacé selon le pays. Formate aussi les saisies partielles :
 * le découpage s'applique aux chiffres déjà tapés, sans espace final orphelin.
 */
export function formatNational(raw: string, dial: DialCode): string {
  const digits = normalizeNational(raw, dial);
  if (!digits) return '';
  const max = Math.max(...dial.digits);
  const capped = digits.slice(0, max);
  const pattern = dial.groups?.[capped.length]
    ?? dial.groups?.[max]
    ?? fallbackGroups(capped.length);

  const parts: string[] = [];
  let i = 0;
  for (const size of pattern) {
    if (i >= capped.length) break;
    parts.push(capped.slice(i, i + size));
    i += size;
  }
  if (i < capped.length) parts.push(capped.slice(i));
  return parts.join(' ');
}

/** Clé i18n d'erreur, ou `null` si le numéro national est valide pour cet indicatif. */
export function validateNationalKey(raw: string, dial: DialCode): string | null {
  const digits = (raw || '').replace(/[\s\-.()]/g, '');
  if (!digits) return 'profile.setup.errors.phoneRequired';
  if (!/^\d+$/.test(digits)) return 'profile.setup.errors.phoneInvalid';
  if (!dial.digits.includes(normalizeNational(digits, dial).length)) {
    return 'profile.setup.errors.phoneLength';
  }
  return null;
}

/** Longueurs attendues, pour un message d'erreur explicite (« 9 chiffres attendus »). */
export function expectedLengths(dial: DialCode): string {
  return dial.digits.join(' / ');
}

/** `+33` + national normalisé — la forme stockée en base (E.164, sans espaces). */
export function toE164(raw: string, dial: DialCode): string {
  return `${dial.code}${normalizeNational(raw, dial)}`;
}

/**
 * Découpe un E.164 stocké en (indicatif, national). Correspondance sur le
 * préfixe le PLUS LONG, sinon `+352…` serait lu comme `+35…`.
 */
export function splitE164(value: string): { dial: DialCode; national: string } | null {
  const compact = (value || '').replace(/[\s\-.()]/g, '');
  if (!compact.startsWith('+')) return null;
  const dial = DIAL_BY_LENGTH.find(d => compact.startsWith(d.code));
  if (!dial) return null;
  return { dial, national: compact.slice(dial.code.length) };
}

/**
 * Valide un numéro saisi librement, avec ou sans indicatif (champ sans
 * sélecteur de pays). Vide = valide : le téléphone est optionnel côté profil.
 */
export function validateFullNumberKey(
  value: string,
  fallbackDial: DialCode = DEFAULT_DIAL,
): string | null {
  const compact = (value || '').replace(/[\s\-.()]/g, '');
  if (!compact) return null;
  if (!/^\+?\d+$/.test(compact)) return 'profile.setup.errors.phoneInvalid';
  const split = splitE164(compact);
  if (split) return validateNationalKey(split.national, split.dial);
  if (compact.startsWith('+')) {
    // Indicatif hors liste : on ne connaît pas la longueur attendue, on retombe
    // sur la borne E.164 générique plutôt que de rejeter un numéro valide.
    const digits = compact.slice(1);
    return digits.length >= 6 && digits.length <= 15 ? null : 'profile.setup.errors.phoneInvalid';
  }
  return validateNationalKey(compact, fallbackDial);
}

/** Forme compacte à stocker en base, quelle que soit la façon dont c'est saisi. */
export function toCompactE164(value: string, fallbackDial: DialCode = DEFAULT_DIAL): string {
  const compact = (value || '').replace(/[\s\-.()]/g, '');
  if (!compact) return '';
  return compact.startsWith('+') ? compact : toE164(compact, fallbackDial);
}

/**
 * Formatage PENDANT la frappe, dans un champ libre (sans sélecteur d'indicatif).
 * Contrairement à `formatFullNumber`, n'ajoute jamais d'indicatif et ne retire
 * jamais le 0 initial : on n'insère que des espaces. Sinon le champ se remplit
 * tout seul et devient impossible à vider — chaque effacement étant annulé par
 * le reformatage.
 */
export function formatAsTyped(value: string, fallbackDial: DialCode = DEFAULT_DIAL): string {
  const compact = (value || '').replace(/[\s\-.()]/g, '');
  if (!compact) return '';
  if (compact.startsWith('+')) {
    const split = splitE164(compact);
    // Indicatif encore incomplet (« +3 ») ou hors liste : on laisse tel quel.
    if (!split) return compact;
    const body = formatNational(split.national, split.dial);
    return body ? `${split.dial.code} ${body}` : split.dial.code;
  }
  const digits = compact.replace(/\D/g, '');
  const trunk = fallbackDial.trunk && digits.startsWith('0');
  const body = formatNational(digits, fallbackDial);
  return trunk ? `0${body}` : body;
}

/** Indicatif reconnu dans une saisie, sinon celui de l'appareil. */
export function dialForValue(value: string, fallbackDial: DialCode = DEFAULT_DIAL): DialCode {
  return splitE164(value)?.dial ?? fallbackDial;
}

/**
 * Affichage lisible d'un numéro complet : « +33 6 12 34 56 78 ».
 * Indicatif inconnu ou absent → on renvoie la saisie nettoyée sans inventer
 * un découpage qui serait faux.
 */
export function formatFullNumber(value: string, fallbackDial: DialCode = DEFAULT_DIAL): string {
  const split = splitE164(value);
  if (split) {
    const body = formatNational(split.national, split.dial);
    return body ? `${split.dial.code} ${body}` : split.dial.code;
  }
  if ((value || '').trim().startsWith('+')) return (value || '').trim();
  const body = formatNational(value, fallbackDial);
  return body ? `${fallbackDial.code} ${body}` : '';
}
