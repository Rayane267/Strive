-- Add preferred_lang column to profiles for localized push notifications
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_lang text NOT NULL DEFAULT 'fr';
