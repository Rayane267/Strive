export type SubscriptionStatus =
  | 'active'
  | 'in_grace_period'
  | 'expired'
  | 'cancelled'
  | 'paused';

export interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email?: string | null;
  phone?: string | null;
  birth_date?: string | null;   // ISO : "YYYY-MM-DD"
  avatar_url?: string | null;
  is_online: boolean;
  // Subscription
  subscription_tier: 'free' | 'plus' | 'premium';
  subscription_status?: SubscriptionStatus | null;
  subscription_expires_at?: string | null;   // ISO timestamptz
  subscription_product_id?: string | null;
  revenuecat_user_id?: string | null;
  extra_scan_credits: number;
  // Admin
  is_admin?: boolean;
  // Véhicule (CarSettingsScreen)
  car_make?: string | null;
  car_model?: string | null;
  car_year?: string | null;
  car_reg?: string | null;
  fuel_type?: string | null;
  avg_cons?: number | null;
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
  pickup_address?: string | null;
  destination_address?: string | null;
  created_at: string;
}
