/**
 * Device ID stable — stocké dans le Keychain iOS / Keystore Android.
 * Persiste même après désinstallation de l'app, contrairement à AsyncStorage.
 * Utilisé pour les quotas anti-multi-comptes (email + OAuth).
 */

import * as Keychain from 'react-native-keychain';
import { supabase } from '../services/supabase';

const KEYCHAIN_SERVICE = 'com.striveapp.deviceId';
const KEYCHAIN_OAUTH_SERVICE = 'com.striveapp.oauthSignups';

function uuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (existing && existing.password.length >= 16) return existing.password;
    const fresh = uuidV4();
    await Keychain.setGenericPassword('deviceId', fresh, { service: KEYCHAIN_SERVICE });
    return fresh;
  } catch {
    return uuidV4();
  }
}

/**
 * Quota serveur (table `device_signups`) : 5 IDENTITÉS distinctes par appareil
 * sur 60 jours glissants.
 *
 * `emailHash` est ce qui rend la suppression de compte réversible : revenir
 * avec une adresse déjà vue sur cet appareil n'est pas une inscription, c'est
 * un retour — ni compté, ni refusé. Sans lui, un chauffeur qui exerce son droit
 * à l'effacement puis se ravise consomme un slot à chaque aller-retour et finit
 * banni de son propre téléphone.
 *
 * Un hash, jamais l'adresse : `device_signups` est la seule table que
 * `delete_account` ne vide pas, et y laisser un email survivrait à l'effacement.
 */
export async function enforceSignupQuota(emailHash?: string): Promise<void> {
  const deviceId = await getOrCreateDeviceId();
  const { error } = await supabase.rpc('check_and_register_device_signup', {
    p_device_id: deviceId,
    p_email_hash: emailHash ?? null,
  });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('device_signup_limit_reached') || msg.includes('invalid_device_id')) {
      throw new Error('device_signup_limit_reached');
    }
    throw new Error('signup_quota_check_failed');
  }
}

/**
 * Crédits de bienvenue : 30 scans offerts, une fois par appareil, 14 jours.
 * À appeler à la sortie de l'onboarding, une fois le compte créé.
 *
 * Le device_id vient du Keychain, donc il survit à une désinstallation : c'est
 * ce qui empêche le cycle « désinstalle / recrée un compte / retouche 30 scans ».
 *
 * NE LÈVE JAMAIS. « Déjà servi » est un cas normal (réinstallation, second
 * compte du foyer) que la RPC renvoie en `granted: false`, et un échec réseau ne
 * doit surtout pas bloquer la fin de l'onboarding pour un cadeau. Retourne
 * `null` dans ces deux cas — l'appelant n'annonce alors rien, ce qui est la
 * bonne réponse : annoncer un cadeau non reçu serait pire que se taire.
 */
export async function grantWelcomeCredits(): Promise<
  { amount: number; expiresInDays: number } | null
> {
  try {
    const deviceId = await getOrCreateDeviceId();
    const { data, error } = await supabase.rpc('grant_welcome_credits', {
      p_device_id: deviceId,
    });
    if (error || !data?.granted) return null;
    // Les deux valeurs viennent du serveur et non de constantes côté app : le
    // montant et la durée sont modifiables par `create or replace` sur la RPC,
    // et un écran qui annoncerait « 30 » quand la base en crédite 20 serait un
    // mensonge que personne ne verrait passer.
    const amount = typeof data.amount === 'number' ? data.amount : 0;
    if (amount <= 0) return null;
    return {
      amount,
      expiresInDays: typeof data.expires_in_days === 'number' ? data.expires_in_days : 14,
    };
  } catch {
    return null;
  }
}

/**
 * Quota OAuth (Apple / Google) : max 5 créations de compte par device
 * par fenêtre rolling de 60 jours. Stocké dans le Keychain — persiste
 * après désinstallation.
 *
 * Le seuil est monté de 3 à 5 le 2026-09-02. À 3, un appareil partagé — un
 * iPhone de démo, un téléphone de famille, ou celui de l'équipe de vérification
 * d'Apple qui a déjà servi — tombait sur un mur infranchissable avant même
 * d'avoir vu l'app, et `delete_account` ne rouvre pas de slot.
 *
 * Barrière locale, doublée côté serveur par enforceSignupQuota (table
 * device_signups). Mêmes seuil et fenêtre des deux côtés : un écart ferait
 * qu'une des deux barrières bloquerait seule, et le diagnostic deviendrait
 * illisible.
 *
 * Appelée APRÈS `signInWithIdToken` uniquement si le user vient d'être
 * créé (created_at < 60s). Les logins existants ne sont jamais bloqués.
 */
export async function enforceOAuthSignupQuota(emailHash?: string): Promise<void> {
  const recent = await recentOAuthSignups();
  // Retour d'une identité déjà connue de cet appareil : jamais refusé, quel que
  // soit l'état du quota. C'est le chemin du chauffeur qui a supprimé son compte
  // et revient — le bloquer transformait le droit à l'effacement en aller simple.
  if (emailHash && recent.some(s => s.h === emailHash)) return;
  // On compte des identités, pas des passages. Les entrées sans hash datent
  // d'avant ce suivi : chacune compte pour une, faute de pouvoir les rattacher.
  // La position entre dans la clé — deux inscriptions héritées peuvent porter
  // le même horodatage, et les fondre en une seule desserrerait le quota.
  const identities = new Set(recent.map((s, i) => s.h ?? `legacy:${i}:${s.t}`));
  if (identities.size >= 5) {
    throw new Error('device_signup_limit_reached');
  }
}

export async function registerOAuthSignup(emailHash?: string): Promise<void> {
  const cleaned = await recentOAuthSignups();
  // Une identité déjà enregistrée ne se réenregistre pas : sinon chaque retour
  // ajouterait une ligne et le compteur regonflerait tout seul.
  if (emailHash && cleaned.some(s => s.h === emailHash)) return;
  cleaned.push({ t: Date.now(), ...(emailHash ? { h: emailHash } : {}) });
  await Keychain.setGenericPassword('oauthSignups', JSON.stringify(cleaned), {
    service: KEYCHAIN_OAUTH_SERVICE,
  });
}

/**
 * Remet à zéro les compteurs anti-abus de CET appareil. Réservé à l'écran
 * Diagnostic, lui-même hors du build App Store (dev ou compte admin).
 *
 * À quoi ça sert : tester le cycle création → suppression → recréation. Le
 * compteur local vit dans le Keychain, qui survit à la désinstallation — sans
 * ce bouton, trois essais suffisent à se bannir de son propre téléphone pour
 * 60 jours, et il n'existe aucun moyen de s'en sortir depuis l'appareil.
 *
 * `newDeviceId` régénère en plus l'identifiant : l'appareil devient neuf aux
 * yeux du serveur, donc `device_signups` et `welcome_grants` repartent de zéro
 * eux aussi — c'est ce qu'il faut pour rejouer le cadeau de bienvenue. Le
 * laisser à false ne libère que le quota d'inscription.
 */
export async function resetSignupCounters(newDeviceId = false): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: KEYCHAIN_OAUTH_SERVICE });
  } catch {}
  if (newDeviceId) {
    try {
      await Keychain.setGenericPassword('deviceId', uuidV4(), { service: KEYCHAIN_SERVICE });
    } catch {}
  }
}

/** Une inscription OAuth vue sur cet appareil. `h` = SHA-256 de l'email, absent
 *  sur les entrées écrites avant le suivi par identité. */
type OAuthSignup = { t: number; h?: string };

const OAUTH_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/** Entrées encore dans la fenêtre de 60 jours, purgées et normalisées. */
async function recentOAuthSignups(): Promise<OAuthSignup[]> {
  const windowStart = Date.now() - OAUTH_WINDOW_MS;
  try {
    const result = await Keychain.getGenericPassword({ service: KEYCHAIN_OAUTH_SERVICE });
    if (!result) return [];
    const raw = JSON.parse(result.password);
    if (!Array.isArray(raw)) return [];
    return raw
      // Compat ascendante : le format d'origine était un tableau d'horodatages nus.
      .map((e: unknown): OAuthSignup | null =>
        typeof e === 'number' ? { t: e }
        : e && typeof e === 'object' && typeof (e as OAuthSignup).t === 'number'
          ? (e as OAuthSignup)
          : null)
      .filter((e): e is OAuthSignup => e !== null && e.t > windowStart);
  } catch {}
  return [];
}
