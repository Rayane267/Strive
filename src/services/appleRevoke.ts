/**
 * Révocation Sign in with Apple à la suppression de compte.
 *
 * POURQUOI. App Store Review Guideline 5.1.1(v) : supprimer son compte dans une
 * app qui propose Sign in with Apple doit aussi révoquer le jeton Apple.
 * Effacer la ligne `auth.users` ne le fait pas — Strive resterait listé dans
 * Réglages → identifiant Apple → « Se connecter avec Apple », comme si le
 * compte vivait toujours. C'est un motif de rejet fréquent en review.
 *
 * COMMENT. Apple exige un `client_secret` signé avec la clé privée .p8, qui ne
 * peut pas vivre dans le bundle. Le travail est donc fait par l'edge function
 * `apple-revoke` ; l'app ne fournit qu'un code d'autorisation frais, à usage
 * unique et valable quelques minutes, qu'il faut redemander à l'appareil au
 * moment de la suppression.
 */

import { Platform } from 'react-native';
import { supabase } from './supabase';

let appleAuth: any = null;
if (Platform.OS === 'ios') {
  try {
    appleAuth = require('@invertase/react-native-apple-authentication').default;
  } catch {
    appleAuth = null;
  }
}

export type AppleRevokeOutcome =
  /** Jeton révoqué chez Apple. */
  | 'revoked'
  /** Rien à révoquer : pas iOS, ou compte sans identité Apple. */
  | 'skipped'
  /** L'utilisateur a refusé la ré-authentification Apple. */
  | 'cancelled'
  /** Tentée, échouée — réseau, secrets absents, code expiré. */
  | 'failed';

type MaybeUser = {
  app_metadata?: { provider?: string; providers?: string[] } | null;
  identities?: Array<{ provider?: string }> | null;
} | null | undefined;

/** Le compte est-il rattaché à Apple ? */
export function hasAppleIdentity(user: MaybeUser): boolean {
  if (!user) return false;
  // `identities` est la source fiable : un compte peut porter Google ET Apple,
  // auquel cas `app_metadata.provider` ne nomme que le dernier utilisé.
  if (Array.isArray(user.identities)) {
    if (user.identities.some(i => i?.provider === 'apple')) return true;
  }
  if (Array.isArray(user.app_metadata?.providers)) {
    if (user.app_metadata!.providers!.includes('apple')) return true;
  }
  return user.app_metadata?.provider === 'apple';
}

/**
 * Tente la révocation. NE LÈVE JAMAIS.
 *
 * L'appelant supprime le compte quoi qu'il arrive : entre un jeton Apple qui
 * traîne et un chauffeur prisonnier d'un compte qu'il veut voir disparaître, le
 * droit à l'effacement passe devant. Mais l'échec est RENVOYÉ, jamais avalé —
 * une révocation qu'on croit faite et qui ne l'est pas, c'est le rejet App
 * Store découvert trois semaines plus tard.
 */
export async function revokeAppleAccess(user: MaybeUser): Promise<AppleRevokeOutcome> {
  if (Platform.OS !== 'ios' || !appleAuth) return 'skipped';
  if (!hasAppleIdentity(user)) return 'skipped';

  let authorizationCode: string | null = null;
  try {
    // Re-authentification : le code d'autorisation est à usage unique et expire
    // en quelques minutes, celui de la connexion d'origine est mort depuis
    // longtemps. `requestedScopes` vide — on ne redemande ni nom ni email, on
    // ne veut qu'un code.
    const res = await appleAuth.performRequest({
      requestedOperation: appleAuth.Operation.LOGIN,
      requestedScopes: [],
    });
    authorizationCode = res?.authorizationCode ?? null;
  } catch (e: any) {
    if (e?.code === appleAuth.Error?.CANCELED) return 'cancelled';
    return 'failed';
  }
  if (!authorizationCode) return 'failed';

  try {
    // `functions.invoke` attache le JWT de session : la fonction n'accepte que
    // le titulaire du compte.
    const { data, error } = await supabase.functions.invoke('apple-revoke', {
      body: { authorizationCode },
    });
    if (error || !data?.revoked) return 'failed';
    return 'revoked';
  } catch {
    return 'failed';
  }
}
