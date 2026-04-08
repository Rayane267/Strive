import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Récupération des variables d'environnement Expo
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.PUBLIC_SUPABASE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Pas besoin de processLock ici pour Expo
  },
});
