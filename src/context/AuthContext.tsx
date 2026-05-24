import React, { createContext, useState, useEffect, useContext, useRef } from 'react';
import * as Sentry from '@sentry/react-native';
import { supabase } from '../services/supabase';
import { fetchProfile } from '../services/profileService';
import { fetchPlanLimits } from '../services/subscriptionService';
import { initPurchases, logoutPurchases } from '../services/iapService';
import { registerPushToken, setupNotificationListeners } from '../services/notificationService';
import { scannerService } from '../services/scanner';
import { Session, User } from '@supabase/supabase-js';
import { Profile } from '../types/database';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileError: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  loading: true,
  profileError: false,
  refreshProfile: async () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const notifCleanupRef = useRef<(() => void) | null>(null);

  const loadProfile = async (userId: string) => {
    setProfileError(false);
    const data = await fetchProfile(userId);
    if (data) {
      setProfile(data);
    } else {
      setProfileError(true);
    }
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
          registerPushToken(initialSession.user.id).catch((e) =>
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
          registerPushToken(currentSession.user.id).catch((e) =>
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

  const refreshProfile = async () => {
    if (user) await loadProfile(user.id);
  };

  return (
    <AuthContext.Provider
      value={{ user, session, profile, loading, profileError, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
