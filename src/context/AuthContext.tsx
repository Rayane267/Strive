import React, { createContext, useState, useEffect, useContext, useRef, useCallback, useMemo } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { supabase } from '../services/supabase';
import { fetchProfileResult } from '../services/profileService';
import { fetchPlanLimits, getEffectivePlanTier } from '../services/subscriptionService';
import { initPurchases, logoutPurchases, getStoreEntitlement, syncPurchasesWithStore } from '../services/iapService';
import { registerPushToken, setupNotificationListeners } from '../services/notificationService';
import { scannerService } from '../services/scanner';
import { clearOfflineCache } from '../services/offlineService';
import { Session, User } from '@supabase/supabase-js';
import { Profile } from '../types/database';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileError: boolean;
  refreshProfile: () => Promise<void>;
  /** Déblocage optimiste après achat : met le tier en local immédiatement (RevenueCat
   *  a confirmé l'achat) sans attendre le webhook → DB. Réconcilié ensuite. */
  markSubscribed: (tier: 'plus' | 'premium') => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  loading: true,
  profileError: false,
  refreshProfile: async () => {},
  markSubscribed: () => {},
});

// Déblocage optimiste : on pousse une expiration future : sans ça, un ancien
// subscription_expires_at dans le passé (ré-abonné) ferait redémoter
// getEffectivePlanTier() en 'free' aussitôt → déblocage annulé. La
// réconciliation (refreshProfile, foreground + poll post-achat) écrasera avec la
// vraie date. Fenêtre de 24h : si le webhook RC tarde ou échoue, l'utilisateur
// qui a payé garde l'accès au lieu de retomber free en 1h.
const optimisticTier = (tier: 'plus' | 'premium') => (prev: Profile | null): Profile | null =>
  prev ? {
    ...prev,
    subscription_tier: tier,
    subscription_status: 'active',
    subscription_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  } : prev;

// Filet de sécurité abonnement : la DB ne connaît que ce que le webhook RC lui a
// dit. Un RENEWAL perdu = abonné qui paie mais retombe 'free' à la date
// d'expiration initiale — pile un mois après l'achat. RevenueCat, lui, a l'état
// réel du reçu Apple : s'il annonce un entitlement actif alors que le profil est
// expiré, on rouvre l'accès localement (fenêtre 24h, comme après un achat) et on
// renvoie le reçu à RC pour qu'il rejoue l'event manquant côté serveur.
const reconcileWithStore = (
  dbProfile: Profile,
  setProfile: React.Dispatch<React.SetStateAction<Profile | null>>,
) => {
  if (getEffectivePlanTier(dbProfile) !== 'free') return;
  getStoreEntitlement().then(store => {
    if (!store) return;
    const stillValid = !store.expiresAt || new Date(store.expiresAt).getTime() > Date.now();
    if (!stillValid) return;
    Sentry.captureMessage('Subscription desync: store active, DB expired', {
      level: 'warning',
      tags: { flow: 'iap_reconcile', tier: store.tier },
      extra: { dbExpiry: dbProfile.subscription_expires_at, storeExpiry: store.expiresAt },
    });
    setProfile(optimisticTier(store.tier));
    syncPurchasesWithStore();
  }).catch(() => {});
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const notifCleanupRef = useRef<(() => void) | null>(null);

  const loadProfile = async (userId: string) => {
    setProfileError(false);
    const res = await fetchProfileResult(userId);

    if ('profile' in res) {
      setProfile(res.profile);
      reconcileWithStore(res.profile, setProfile);
      return;
    }

    if ('error' in res) {
      // Vrai échec (réseau, RLS, colonne absente) : l'écran d'erreur et son
      // bouton Réessayer ont un sens.
      setProfileError(true);
      return;
    }

    // Aucune ligne de profil. Deux causes, et il faut demander au serveur
    // laquelle : soit le compte existe et sa ligne manque (anomalie rare, le
    // trigger `handle_new_user` la crée dans la même transaction), soit le
    // compte a été SUPPRIMÉ pendant que cette session vivait encore.
    //
    // Ce second cas était un piège sans issue : la session est stockée dans le
    // Keychain, qui survit à la désinstallation de l'app. Le chauffeur restait
    // donc enfermé sur « Impossible de charger votre profil » à vie, sans
    // qu'aucun redémarrage ni réinstallation n'y change quoi que ce soit.
    // `getUser()` interroge le serveur, contrairement à `getSession()` qui se
    // contente de relire le cache : c'est lui qui sait si le compte existe.
    const { error: userErr } = await supabase.auth.getUser();
    if (userErr) {
      Sentry.addBreadcrumb({
        category: 'auth',
        message: `profil absent + user invalide → signOut (${userErr.message})`,
        level: 'warning',
      });
      // `scope: 'local'` : le compte n'existe plus côté serveur, l'appel de
      // déconnexion échouerait et pourrait laisser la session en place. On vide
      // le stockage, c'est tout ce qui compte ici.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      return;
    }

    // Le compte existe bel et bien : on laisse `profile` à null. RootNavigator
    // route alors sur ProfileSetup, qui est exactement l'écran attendu pour un
    // profil incomplet — et non sur l'écran d'erreur.
    setProfile(null);
  };

  useEffect(() => {
    const initAuth = async () => {
      __DEV__ && console.log('[AUTH] Checking session...');
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          __DEV__ && console.error('[AUTH] getSession error:', error.message);
          setLoading(false);
          return;
        }

        const initialSession = data.session;
        __DEV__ && console.log('[AUTH] Session:', initialSession ? 'found' : 'none');

        if (initialSession) {
          setSession(initialSession);
          setUser(initialSession.user);
          Sentry.setUser({ id: initialSession.user.id, email: initialSession.user.email });
          Sentry.addBreadcrumb({ category: 'auth', message: 'Session restored', level: 'info' });
          // JWT au natif → édge function gemini-proxy autorise l'appel.
          try { scannerService.setSupabaseUserJwt(initialSession.access_token); } catch {}
          // Préchauffe le cache des limites tier (free=3, plus=15, premium=null).
          // Silencieux : si fetch échoue, fallback hardcodé pris.
          fetchPlanLimits().catch(() => {});
          initPurchases(initialSession.user.id);
          await loadProfile(initialSession.user.id);
          // `false` : silencieux au démarrage, comme sur SIGNED_IN. Aucune
          // fenêtre de permission ne doit partir d'un chemin automatique.
          registerPushToken(initialSession.user.id, false).catch((e) =>
            Sentry.captureException(e, { tags: { flow: 'push_token_init' } }),
          );
          notifCleanupRef.current = setupNotificationListeners();
        }
      } catch (err) {
        Sentry.captureException(err, { tags: { flow: 'auth_init' } });
        __DEV__ && console.error('[AUTH] Fatal error:', err);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, currentSession) => {
      __DEV__ && console.log('[AUTH] State change:', _event);
      setSession(currentSession);
      setUser(currentSession?.user ?? null);

      if (currentSession?.user) {
        Sentry.setUser({ id: currentSession.user.id, email: currentSession.user.email });
        Sentry.addBreadcrumb({ category: 'auth', message: `Auth state: ${_event}`, level: 'info' });
        // Sync JWT au natif à chaque event (SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED…) :
        // pas cher, et indispensable pour que la bulle scanner ait toujours un JWT frais.
        try { scannerService.setSupabaseUserJwt(currentSession.access_token); } catch {}

        // Heavy ops UNIQUEMENT sur SIGNED_IN : TOKEN_REFRESHED arrive ~1× / heure
        // et n'a pas besoin de relancer RevenueCat / FCM / profile. initAuth() a
        // déjà fait le boot initial pour les sessions restorées.
        if (_event === 'SIGNED_IN') {
          fetchPlanLimits().catch(() => {});
          initPurchases(currentSession.user.id);
          loadProfile(currentSession.user.id).catch((e) =>
            Sentry.captureException(e, { tags: { flow: 'profile_reload' } }),
          );
          // `false` : on n'affiche PAS la fenêtre de permission ici. À la
          // connexion, le chauffeur n'a encore rien vu de l'app — il n'a aucune
          // raison de dire oui, et son refus serait définitif. On se contente
          // d'enregistrer le jeton s'il a déjà accordé la permission ; la
          // demande, elle, part de l'interrupteur du Profil.
          registerPushToken(currentSession.user.id, false).catch((e) =>
            Sentry.captureException(e, { tags: { flow: 'push_token_refresh' } }),
          );
          if (!notifCleanupRef.current) {
            notifCleanupRef.current = setupNotificationListeners();
          }
        }
      } else {
        Sentry.setUser(null);
        Sentry.addBreadcrumb({ category: 'auth', message: 'User signed out', level: 'info' });
        // Purge le JWT côté natif au logout.
        try { scannerService.setSupabaseUserJwt(''); } catch {}
        // Et coupe ce qui survit au JS : le drapeau `sessionOnline` de l'App
        // Group commande le scan par raccourci, et la Live Activity reste à
        // l'écran tant que personne ne la termine — jusqu'à afficher les gains
        // de l'ancien chauffeur si un autre compte se connecte sur le même
        // appareil.
        //
        // ProfileScreen le fait déjà pour le bouton « Se déconnecter ». Ici on
        // couvre TOUS les autres chemins vers l'état déconnecté, qui passent
        // forcément par cet événement : session expirée, refresh token
        // invalidé, suppression de compte, déconnexion déclenchée ailleurs.
        // Idempotent — une carte déjà terminée ignore l'appel.
        try {
          const { ScanBridge } = NativeModules;
          ScanBridge?.setSessionOnline?.(false);
          if (Platform.OS === 'ios') ScanBridge?.stopLiveActivity?.();
        } catch {}
        // RGPD : vide les caches locaux porteurs d'adresses (géocodage + courses
        // hors-ligne) pour qu'un user suivant sur le même appareil n'en hérite
        // pas. Couvre aussi la suppression de compte (qui se termine par signOut).
        try { scannerService.clearGeocodeCache(); } catch {}
        clearOfflineCache().catch(() => {});
        setProfile(null);
        setProfileError(false);
        notifCleanupRef.current?.();
        notifCleanupRef.current = null;
        logoutPurchases();
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
      notifCleanupRef.current?.();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user]);

  // Refresh du profil au retour en premier plan : capte les changements
  // d'abonnement (renouvellement, upgrade/downgrade, expiration) survenus
  // pendant que l'app était en arrière-plan, sans attendre un cold start.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && user) {
        loadProfile(user.id).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [user]);

  // Déblocage optimiste post-achat : RevenueCat a confirmé l'entitlement, on
  // débloque l'UI tout de suite (le webhook → DB suit en quelques secondes).
  const markSubscribed = useCallback((tier: 'plus' | 'premium') => {
    setProfile(optimisticTier(tier));
  }, []);

  // Mémoïsé : sans ça l'objet value est recréé à chaque render du provider →
  // tous les consommateurs de useAuth() (≈ tous les écrans) re-render à chaque
  // TOKEN_REFRESHED (~1×/h), changement de loading, etc.
  const value = useMemo(
    () => ({ user, session, profile, loading, profileError, refreshProfile, markSubscribed }),
    [user, session, profile, loading, profileError, refreshProfile, markSubscribed],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
