import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Feather from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { getPlanTier, getPlanLimits, getRemainingScans } from '../services/subscriptionService';

interface PremiumBannerProps {
  todayScanCount: number;
  onPressUpgrade?: () => void;
  onPressShop?: () => void;
}

export const PremiumBanner = ({ todayScanCount, onPressUpgrade, onPressShop }: PremiumBannerProps) => {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const tier = getPlanTier(profile?.subscription_tier);
  const { dailyScans } = getPlanLimits(tier);
  const extraCredits = profile?.extra_scan_credits ?? 0;
  const remaining = getRemainingScans(tier, todayScanCount, extraCredits);

  if (tier !== 'free') return null;

  const isExhausted = remaining === 0;

  // Only show when quota is fully exhausted — the scan counter bar handles the "low" state
  if (!isExhausted) return null;

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={isExhausted ? onPressShop : onPressUpgrade}
      style={styles.container}
    >
      <LinearGradient
        colors={isExhausted ? ['#1A0A0A', '#2B1A1A', '#FF5252'] : ['#0A120E', '#1A2B23', '#10B981']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.iconContainer}>
          <MaterialCommunityIcons
            name={isExhausted ? 'shield-lock-outline' : 'crown'}
            size={28}
            color="#FFFFFF"
          />
        </View>

        <View style={styles.textContainer}>
          {isExhausted ? (
            <>
              <Text style={styles.title}>{t('dashboard.banner.exhaustedTitle')}</Text>
              <Text style={styles.subtitle}>{t('dashboard.banner.exhaustedSub')}</Text>
            </>
          ) : dailyScans !== null ? (
            <>
              <Text style={styles.title}>{t('dashboard.banner.remaining', { count: remaining })}</Text>
              <Text style={styles.subtitle}>{t('dashboard.banner.upgradeSub')}</Text>
            </>
          ) : null}
        </View>

        {isExhausted && (
          <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.shopBtn} onPress={onPressShop}>
              <MaterialCommunityIcons name="ticket-percent-outline" size={14} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}

        {!isExhausted && <Feather name="chevron-right" size={20} color="rgba(255,255,255,0.7)" />}
      </LinearGradient>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 12,
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: 16,
  },
  iconContainer: {
    width: 48,
    height: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  textContainer: { flex: 1 },
  title: { fontSize: 15, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 3 },
  subtitle: { fontSize: 11, color: 'rgba(255, 255, 255, 0.8)', fontWeight: '500' },
  actionButtons: { flexDirection: 'row', gap: 8 },
  shopBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
