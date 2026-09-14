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
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { elevation } from '../theme/elevation';
import { stroke, strokeWidth } from '../theme/stroke';
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
  // Verdict combiné (identique bulle / Dynamic Island / Share Extension) :
  // 2 = vert (les deux seuils OK), 1 = orange (un seul OK), 0 = sous les seuils.
  const hrOk = hourlyRate >= preferences.min_hourly_rate;
  const kmOk = kmRate >= preferences.min_km_rate;
  const level = hrOk && kmOk ? 2 : (hrOk || kmOk) ? 1 : 0;
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
            <View style={[styles.ratePill, level === 2 && styles.ratePillGood, level === 1 && styles.ratePillMid]}>
              <Feather name="trending-up" size={12} color={level === 2 ? colors.background : level === 1 ? '#3A2A00' : colors.textMuted} />
              <Text style={[styles.ratePillText, level === 2 && styles.ratePillTextGood, level === 1 && styles.ratePillTextMid]}>
                {hourlyRate.toFixed(0)}€/h
              </Text>
            </View>
            <View style={styles.timeAgoPill}>
              <Text style={styles.timeAgoText}>{formatTimeAgo(ride.created_at, t)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.rideContent}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs }}>
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
    borderRadius: radius.lg, marginBottom: space.lg,
    overflow: 'hidden',
    borderWidth: strokeWidth.control, borderColor: stroke.edge,
    ...elevation.raised.shadow,
  },
  rideImageWrap: { height: 130, position: 'relative' },
  rideImage: { width: '100%', height: '100%' },
  imageBadgesRow: {
    position: 'absolute', top: 10, left: 10, right: 10,
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
  },
  platformPill: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.full,
    borderWidth: strokeWidth.control, borderColor: stroke.edgeLit,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.6, shadowRadius: 6, elevation: 6,
  },
  platformDot: { width: 8, height: 8, borderRadius: radius.full },
  platformPillText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  ratePill: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.full,
    borderWidth: strokeWidth.control, borderColor: stroke.edgeLit,
  },
  ratePillGood: {
    backgroundColor: colors.primary, borderColor: colors.primary,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.6, shadowRadius: 8, elevation: 6,
  },
  ratePillMid: {
    backgroundColor: '#FF9800', borderColor: '#FF9800',
    shadowColor: '#FF9800', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5, shadowRadius: 8, elevation: 6,
  },
  ratePillText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  ratePillTextGood: { color: colors.background },
  ratePillTextMid: { color: '#3A2A00' },
  timeAgoPill: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.full,
    borderWidth: strokeWidth.control, borderColor: stroke.edge,
  },
  timeAgoText: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '500' },
  rideContent: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg },
  fareLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: '500', marginBottom: space.tight },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: space.lg },
  fareValue: { color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: -1.5, flexShrink: 1, marginRight: space.sm },
  tripMetrics: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-end' },
  tripMetricCol: { alignItems: 'flex-start' },
  tripMetricLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginBottom: space.xs },
  tripMetricItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  tripMetricText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: space.sm },
  btnDecline: {
    flex: 1, height: 54, borderRadius: radius.md,
    borderWidth: strokeWidth.control, borderColor: stroke.edgeLit,
    backgroundColor: 'rgba(255,90,90,0.08)',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
  },
  btnDeclineText: { color: '#FF5A5A', fontSize: 16, fontWeight: '700' },
  btnAcceptGood: {
    flex: 1, height: 54, borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    ...elevation.raised.shadow,
  },
  btnAcceptTextGood: { color: colors.background, fontSize: 16, fontWeight: '800' },
  statusResult: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingVertical: space.md, gap: space.sm,
    borderWidth: strokeWidth.control, borderColor: stroke.edge, borderRadius: radius.sm,
  },
  estBadge: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: radius.xs, paddingHorizontal: space.sm, paddingVertical: space.tight,
  },
  estBadgeText: { color: colors.textDimmed, fontSize: 10, fontWeight: '600' },
});

export default DashboardRideCard;
