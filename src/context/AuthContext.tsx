import React, { createContext, useState, useEffect, useContext, useRef } from 'react';
import { supabase } from '../services/supabase';
import { fetchProfile } from '../services/profileService';
import { initPurchases } from '../services/iapService';
import { registerPushToken, setupNotificationListeners } from '../services/notificationService';
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
          initPurchases(initialSession.user.id);
          await loadProfile(initialSession.user.id);
          registerPushToken(initialSession.user.id);
          notifCleanupRef.current = setupNotificationListeners();
        }
      } catch (err) {
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
        initPurchases(currentSession.user.id);
        loadProfile(currentSession.user.id);
        registerPushToken(currentSession.user.id);
        if (!notifCleanupRef.current) {
          notifCleanupRef.current = setupNotificationListeners();
        }
      } else {
        setProfile(null);
        setProfileError(false);
        notifCleanupRef.current?.();
        notifCleanupRef.current = null;
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
