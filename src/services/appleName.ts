/**
 * Nom fourni par Sign in with Apple, retenu en mémoire le temps de la création
 * du profil.
 *
 * `signInWithIdToken` ouvre la session, et `RootNavigator` monte aussitôt
 * `ProfileSetupScreen` : l'`updateUser({ full_name })` qui suit arrive trop
 * tard pour son pré-remplissage, et le chauffeur retapait un nom qu'Apple
 * venait de donner — motif de rejet (Guideline 4). On le pose donc ici AVANT
 * d'ouvrir la session, et l'écran le lit sans attendre.
 */
export type AppleName = { givenName: string; familyName: string };

let pending: AppleName | null = null;

export function setPendingAppleName(name: AppleName | null) {
  pending = name && (name.givenName || name.familyName) ? name : null;
}

export function getPendingAppleName(): AppleName | null {
  return pending;
}
