import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
} from 'react-native';
import SafeGradient from './SafeGradient';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { Ride } from '../types/database';
import { effectiveFare } from '../services/ridesService';
import { formatTimeAgo } from '../utils/dateUtils';
import AnimatedEntrance from './AnimatedEntrance';

const platformBackgrounds: Record<string, any> = {
  UBER:   require('../images/uber-bg.png'),
  BOLT:   require('../images/bolt-bg.png'),
  HEETCH: require('../images/heetch-bg.png'),
};

const PLATFORM_COLORS: Record<string, string> = {
  UBER:   '#FFFFFF',
  BOLT:   '#34BB78',
  HEETCH: '#FF3B80',
};

interface Props {
  ride: Ride;
  index: number;
  preferences: { min_hourly_rate: number; min_km_rate: number };
  onAccept: (rideId: string) => void;
  onDecline: (rideId: string) => void;
}

const DashboardRideCard = React.memo(({ ride, index, preferences, onAccept, onDecline }: Props) => {
  const { t } = useTranslation();
  const rawPlatform = ride.platform ? ride.platform.toString().toUpperCase().trim() : 'UBER';
  const isPending = ride.status === 'PENDING';
  const distance = Number(ride.distance_km) || 0;
  const fare = effectiveFare(ride);
  const fareIsConfirmed = ride.fare_final != null;
  const hourlyRate = Number(ride.hourly_rate || 0);
  const kmRate = Number(ride.km_rate || 0);
  const platformColor = PLATFORM_COLORS[rawPlatform] ?? '#FFFFFF';
  const bgImage = platformBackgrounds[rawPlatform] ?? platformBackgrounds.UBER;
  const rateOk = hourlyRate >= preferences.min_hourly_rate;
  const platformLabel = rawPlatform.charAt(0) + rawPlatform.slice(1).toLowerCase();

  return (
    <AnimatedEntrance delay={index * 80} slideFrom="bottom" slideDistance={30}>
      <View style={[styles.rideCard, !isPending && { opacity: 0.5 }]}>
        <View style={styles.rideImageWrap}>
          <Image source={bgImage} style={styles.rideImage} resizeMode="cover" />
          <SafeGradient colors={['transparent', colors.surface]} style={StyleSheet.absoluteFillObject} />
          <View style={styles.imageBadgesRow}>
            <View style={styles.platformPill}>
              <View style={[styles.platformDot, { backgroundColor: platformColor }]} />
              <Text style={styles.platformPillText}>{platformLabel}</Text>
            </View>
            <View style={[styles.ratePill, rateOk && styles.ratePillGood]}>
              <Feather name="trending-up" size={12} color={rateOk ? colors.background : colors.textMuted} />
              <Text style={[styles.ratePillText, rateOk && styles.ratePillTextGood]}>
                {hourlyRate.toFixed(0)}€/h
              </Text>
            </View>
            <View style={styles.timeAgoPill}>
              <Text style={styles.timeAgoText}>{formatTimeAgo(ride.created_at, t)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.rideContent}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Text style={styles.fareLabel}>{t('dashboard.estFare')}</Text>
            {!fareIsConfirmed && (
              <View style={styles.estBadge}>
                <Text style={styles.estBadgeText}>{t('dashboard.estimated', 'est.')}</Text>
              </View>
            )}
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{fare.toFixed(2)}€</Text>
            <View style={styles.tripMetrics}>
              <View style={styles.tripMetricCol}>
                <Text style={styles.tripMetricLabel}>{t('dashboard.distance')}</Text>
                <View style={styles.tripMetricItem}>
                  <MaterialCommunityIcons name="map-marker" size={14} color={colors.primary} />
                  <Text style={styles.tripMetricText}>{distance} km</Text>
                </View>
              </View>
              <View style={styles.tripMetricCol}>
                <Text style={styles.tripMetricLabel}>{t('dashboard.time')}</Text>
                <View style={styles.tripMetricItem}>
                  <MaterialCommunityIcons name="clock-outline" size={14} color={colors.primary} />
                  <Text style={styles.tripMetricText}>{Number(ride.duration_min || 0)} min</Text>
                </View>
              </View>
              <View style={styles.tripMetricCol}>
                <Text style={styles.tripMetricLabel}>{t('dashboard.kmRate')}</Text>
                <View style={styles.tripMetricItem}>
                  <Feather name="navigation" size={13} color={colors.primary} />
                  <Text style={styles.tripMetricText}>{kmRate.toFixed(2)}</Text>
                </View>
              </View>
            </View>
          </View>

          {isPending ? (
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.btnDecline}
                onPress={() => onDecline(ride.id)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('dashboard.decline', 'Decline')}
              >
                <Feather name="x" size={18} color="#FF5A5A" />
                <Text style={styles.btnDeclineText}>{t('dashboard.decline', 'Decline')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnAcceptGood}
                onPress={() => onAccept(ride.id)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('dashboard.accept', 'Accept')}
              >
                <Feather name="check" size={18} color={colors.background} />
                <Text style={styles.btnAcceptTextGood}>{t('dashboard.accept', 'Accept')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.statusResult}>
              <Feather
                name={ride.status === 'ACCEPTED' ? 'check-circle' : 'slash'}
                size={16}
                color={ride.status === 'ACCEPTED' ? colors.primary : '#FF5252'}
              />
              <Text style={{ color: ride.status === 'ACCEPTED' ? colors.primary : '#FF5252', fontWeight: '700', fontSize: 14 }}>
                {ride.status === 'ACCEPTED' ? t('dashboard.status.accepted') : t('dashboard.status.declined')}
              </Text>
            </View>
          )}
        </View>
      </View>
    </AnimatedEntrance>
  );
});

const styles = StyleSheet.create({
  rideCard: {
    backgroundColor: '#111E18',
    borderRadius: 22, marginBottom: 18,
    overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  rideImageWrap: { height: 130, position: 'relative' },
  rideImage: { width: '100%', height: '100%' },
  imageBadgesRow: {
    position: 'absolute', top: 10, left: 10, right: 10,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  platformPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.6, shadowRadius: 6, elevation: 6,
  },
  platformDot: { width: 8, height: 8, borderRadius: 4 },
  platformPillText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  ratePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  ratePillGood: {
    backgroundColor: colors.primary, borderColor: colors.primary,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.6, shadowRadius: 8, elevation: 6,
  },
  ratePillText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  ratePillTextGood: { color: colors.background },
  timeAgoPill: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  timeAgoText: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '500' },
  rideContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  fareLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: '500', marginBottom: 2 },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 },
  fareValue: { color: '#fff', fontSize: 42, fontWeight: '900', letterSpacing: -1.5 },
  tripMetrics: { flexDirection: 'row', gap: 16, alignItems: 'flex-end' },
  tripMetricCol: { alignItems: 'flex-start' },
  tripMetricLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  tripMetricItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tripMetricText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 10 },
  btnDecline: {
    flex: 1, height: 54, borderRadius: 14,
    borderWidth: 1.5, borderColor: 'rgba(255,90,90,0.45)',
    backgroundColor: 'rgba(255,90,90,0.08)',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  btnDeclineText: { color: '#FF5A5A', fontSize: 16, fontWeight: '700' },
  btnAcceptGood: {
    flex: 1, height: 54, borderRadius: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 14,
    elevation: 10,
  },
  btnAcceptTextGood: { color: colors.background, fontSize: 16, fontWeight: '800' },
  statusResult: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingVertical: 12, gap: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 12,
  },
  estBadge: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  estBadgeText: { color: colors.textDimmed, fontSize: 10, fontWeight: '600' },
});

export default DashboardRideCard;
