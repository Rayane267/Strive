export interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email?: string | null;
  phone?: string | null;
  birth_date?: string | null;   // ISO : "YYYY-MM-DD"
  avatar_url?: string | null;
  is_online: boolean;
  subscription_tier: 'free' | 'plus' | 'premium';
  extra_scan_credits: number;
}

export interface Ride {
  id: string;
  user_id: string;
  platform: 'UBER' | 'BOLT' | 'HEETCH';
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  fare_estimated: number;
  fare_final: number | null;
  distance_km: number;
  duration_min: number;
  hourly_rate: number;
  km_rate: number;
  created_at: string;
}
