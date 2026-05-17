import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Platform,
  StyleSheet,
  Animated,
} from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import FontAwesome5 from 'react-native-vector-icons/FontAwesome5';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from '@react-native-community/blur';
import { colors } from '../theme/colors';
import { useTranslation } from 'react-i18next';

import DashboardScreenRaw from '../screens/DashboardScreen';
import HistoryScreenRaw from '../screens/HistoryScreen';
import AnalyticsScreenRaw from '../screens/AnalyticsScreen';
import ProfileScreenRaw from '../screens/ProfileScreen';
import { withErrorBoundary } from '../components/ErrorBoundary';

// Chaque tab isolé dans son ErrorBoundary : un crash dans Analytics ne
// blanchit pas Dashboard/History/etc.
const DashboardScreen = withErrorBoundary(DashboardScreenRaw);
const HistoryScreen = withErrorBoundary(HistoryScreenRaw);
const AnalyticsScreen = withErrorBoundary(AnalyticsScreenRaw);
const ProfileScreen = withErrorBoundary(ProfileScreenRaw);

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, (color: string, size: number) => React.ReactNode> = {
  Dashboard: (c, s) => <MaterialCommunityIcons name="view-dashboard"    size={s} color={c} />,
  History:   (c, s) => <MaterialCommunityIcons name="history"           size={s} color={c} />,
  Analytics: (c, s) => <MaterialCommunityIcons name="google-analytics"  size={s} color={c} />,
  Profile:   (c, s) => <FontAwesome5           name="user"              size={s - 2} color={c} />,
};

// Vertical padding inside the pill for the sliding indicator
const INDICATOR_INSET_V = 5;
// Horizontal padding between indicator edge and tab cell edge
const INDICATOR_INSET_H = 4;

const IOSTabBar = ({ state, descriptors, navigation }: BottomTabBarProps) => {
  const insets = useSafeAreaInsets();
  const numTabs = state.routes.length;

  const [rowWidth, setRowWidth] = useState(0);
  const tabWidth = rowWidth > 0 ? rowWidth / numTabs : 0;

  const animIndex = useRef(new Animated.Value(state.index)).current;

  useEffect(() => {
    Animated.spring(animIndex, {
      toValue: state.index,
      useNativeDriver: true,
      damping: 22,
      stiffness: 220,
      mass: 0.75,
    }).start();
  }, [state.index]);

  const indicatorX = animIndex.interpolate({
    inputRange: state.routes.map((_, i) => i),
    outputRange: state.routes.map((_, i) => i * tabWidth),
    extrapolate: 'clamp',
  });

  return (
    <View
      style={[styles.wrapper, { bottom: Math.max(insets.bottom, 16) + 8 }]}
      pointerEvents="box-none"
    >
      <View style={styles.pill}>
        <BlurView
          style={StyleSheet.absoluteFill}
          blurType="chromeMaterialDark"
          blurAmount={40}
          reducedTransparencyFallbackColor="rgba(10,20,14,0.92)"
        />
        <View style={[StyleSheet.absoluteFill, styles.tintOverlay]} />
        <View style={styles.shimmer} />

        <View
          style={styles.row}
          onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
        >
          {tabWidth > 0 && (
            <Animated.View
              style={[
                styles.indicator,
                {
                  width: tabWidth - INDICATOR_INSET_H * 2,
                  transform: [
                    {
                      translateX: Animated.add(
                        indicatorX,
                        new Animated.Value(INDICATOR_INSET_H),
                      ),
                    },
                  ],
                },
              ]}
            >
              <BlurView
                style={StyleSheet.absoluteFill}
                blurType="light"
                blurAmount={12}
                reducedTransparencyFallbackColor="rgba(255,255,255,0.15)"
              />
              <View style={[StyleSheet.absoluteFill, styles.indicatorTint]} />
            </Animated.View>
          )}

          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const focused = state.index === index;
            const iconColor = focused ? colors.primary : 'rgba(255,255,255,0.42)';
            const label = (options.tabBarLabel as string) ?? route.name;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            return (
              <TouchableOpacity
                key={route.key}
                onPress={onPress}
                activeOpacity={0.75}
                style={styles.item}
                accessibilityRole="button"
                accessibilityLabel={options.tabBarAccessibilityLabel}
              >
                {TAB_ICONS[route.name]?.(iconColor, 22)}
                <Text
                  style={[styles.label, { color: iconColor }]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
};

const AndroidTabBar = ({ state, descriptors, navigation }: BottomTabBarProps) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.androidBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const iconColor = focused ? colors.primary : 'rgba(255,255,255,0.42)';
        const label = (options.tabBarLabel as string) ?? route.name;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <TouchableOpacity
            key={route.key}
            onPress={onPress}
            activeOpacity={0.75}
            style={styles.androidItem}
            accessibilityRole="button"
            accessibilityLabel={options.tabBarAccessibilityLabel}
          >
            {focused && <View style={styles.androidActiveIndicator} />}
            {TAB_ICONS[route.name]?.(iconColor, 22)}
            <Text
              style={[styles.label, { color: iconColor }]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const CustomTabBar = (props: BottomTabBarProps) => {
  return Platform.OS === 'ios' ? <IOSTabBar {...props} /> : <AndroidTabBar {...props} />;
};

const TabNavigator = () => {
  const { t } = useTranslation();

  const labels: Record<string, string> = {
    Dashboard: t('nav.dashboard'),
    History:   t('nav.history'),
    Analytics: t('nav.analytics'),
    Profile:   t('nav.profile'),
  };

  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        ...(Platform.OS === 'ios' ? { tabBarStyle: { position: 'absolute' } } : {}),
      }}
    >
      {Object.keys(labels).map((name) => {
        const screens: Record<string, React.ComponentType<any>> = {
          Dashboard: DashboardScreen,
          History:   HistoryScreen,
          Analytics: AnalyticsScreen,
          Profile:   ProfileScreen,
        };
        return (
          <Tab.Screen
            key={name}
            name={name}
            component={screens[name]}
            options={{
              tabBarLabel: labels[name],
              tabBarAccessibilityLabel: labels[name],
            }}
          />
        );
      })}
    </Tab.Navigator>
  );
};

const PILL_HEIGHT = 62;

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
  },

  pill: {
    width: '100%',
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 24,
  },

  tintOverlay: {
    backgroundColor: 'rgba(8, 22, 14, 0.35)',
  },

  androidBg: {
    backgroundColor: 'rgba(8, 22, 14, 0.94)',
  },

  shimmer: {
    position: 'absolute',
    top: 0,
    left: 28,
    right: 28,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 1,
  },

  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },

  // The single sliding glass pill indicator
  indicator: {
    position: 'absolute',
    top: INDICATOR_INSET_V,
    bottom: INDICATOR_INSET_V,
    borderRadius: (PILL_HEIGHT - INDICATOR_INSET_V * 2) / 2,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 230, 118, 0.35)',
    // subtle green glow
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },

  // Green tint on top of the nested blur
  indicatorTint: {
    backgroundColor: 'rgba(0, 230, 118, 0.13)',
  },

  item: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },

  label: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.1,
  },

  // Android classic tab bar
  androidBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 8,
  },
  androidItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 4,
    position: 'relative',
  },
  androidActiveIndicator: {
    position: 'absolute',
    top: -8,
    width: 32,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
});

export default TabNavigator;
