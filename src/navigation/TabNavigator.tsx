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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from '@react-native-community/blur';
import SafeGradient from '../components/SafeGradient';
import { colors } from '../theme/colors';
import { hapticSelection } from '../utils/haptics';
import { useReduceMotion } from '../hooks/useReduceMotion';
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

// Une seule famille d'icônes, toutes en version pleine. Le profil tirait son
// glyphe de FontAwesome5, dont la variante par défaut est un contour : à côté de
// trois icônes pleines, il paraissait décroché.
const TAB_ICONS: Record<string, (color: string, size: number) => React.ReactNode> = {
  Dashboard: (c, s) => <MaterialCommunityIcons name="home"              size={s} color={c} />,
  History:   (c, s) => <MaterialCommunityIcons name="history"           size={s} color={c} />,
  Analytics: (c, s) => <MaterialCommunityIcons name="google-analytics"  size={s} color={c} />,
  Profile:   (c, s) => <MaterialCommunityIcons name="account"           size={s} color={c} />,
};

// Vertical padding inside the pill for the sliding indicator
const INDICATOR_INSET_V = 5;
// Horizontal padding between indicator edge and tab cell edge
const INDICATOR_INSET_H = 4;

const INACTIVE_TINT = 'rgba(255,255,255,0.42)';

// Ressort du déplacement : arrivée franche, sans rebond — c'est l'étirement du
// verre qui porte la matière, pas un dépassement de position.
const TRAVEL_SPRING = { damping: 22, stiffness: 220, mass: 0.75 } as const;
// Ressort du pop d'icône : amorti bas => dépassement visible. C'est le rebond.
const POP_SPRING = { damping: 9, stiffness: 260, mass: 0.9 } as const;

/**
 * Une cellule d'onglet : pop de l'icône à la sélection, compression à l'appui.
 *
 * L'icône et le libellé sont dessinés DEUX fois, en actif et en inactif, et se
 * croisent en opacité. Une interpolation de couleur obligerait à repasser par le
 * thread JS à chaque frame (`useNativeDriver` ne sait pas animer `color`) : à
 * quatre onglets ça se verrait au premier ralentissement.
 */
const TabItem = ({
  route, focused, label, reduceMotion, onPress, accessibilityLabel,
}: {
  route: string;
  focused: boolean;
  label: string;
  reduceMotion: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) => {
  const focus = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const press = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion) {
      Animated.timing(focus, {
        toValue: focused ? 1 : 0, duration: 150, useNativeDriver: true,
      }).start();
      return;
    }
    Animated.spring(focus, {
      toValue: focused ? 1 : 0, useNativeDriver: true, ...POP_SPRING,
    }).start();
  }, [focused, focus, reduceMotion]);

  // Le ressort dépasse 1 avant de se stabiliser : l'échelle monte donc au-delà
  // de 1,12 pendant un instant, et c'est ce dépassement qui fait le rebond.
  const popScale = reduceMotion
    ? 1
    : focus.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });

  const activeOpacity = focus.interpolate({
    inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp',
  });
  const inactiveOpacity = focus.interpolate({
    inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp',
  });

  return (
    <TouchableOpacity
      onPress={onPress}
      // Le retour d'appui est joué par `press` : l'opacité par défaut de
      // TouchableOpacity ferait un second effet, en désaccord avec le premier.
      activeOpacity={1}
      onPressIn={() => {
        Animated.timing(press, {
          toValue: 0.94, duration: 90, useNativeDriver: true,
        }).start();
      }}
      onPressOut={() => {
        Animated.spring(press, {
          toValue: 1, useNativeDriver: true, damping: 14, stiffness: 320, mass: 0.7,
        }).start();
      }}
      style={styles.item}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View
        style={[styles.itemInner, { transform: [{ scale: press }, { scale: popScale }] }]}
      >
        <View>
          <Animated.View style={{ opacity: inactiveOpacity }}>
            {TAB_ICONS[route]?.(INACTIVE_TINT, 22)}
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: activeOpacity }]}>
            {TAB_ICONS[route]?.(colors.primary, 22)}
          </Animated.View>
        </View>
        <View>
          <Animated.Text
            style={[styles.label, { color: INACTIVE_TINT, opacity: inactiveOpacity }]}
            numberOfLines={1}
          >
            {label}
          </Animated.Text>
          <Animated.Text
            style={[
              styles.label, styles.labelOverlay,
              { color: colors.primary, opacity: activeOpacity },
            ]}
            numberOfLines={1}
          >
            {label}
          </Animated.Text>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
};

const IOSTabBar = ({ state, descriptors, navigation }: BottomTabBarProps) => {
  const insets = useSafeAreaInsets();
  const numTabs = state.routes.length;

  const [rowWidth, setRowWidth] = useState(0);
  const tabWidth = rowWidth > 0 ? rowWidth / numTabs : 0;

  const reduceMotion = useReduceMotion();

  const animIndex = useRef(new Animated.Value(state.index)).current;
  // Cible atteinte instantanément, pendant qu'`animIndex` la rattrape au ressort.
  // L'écart entre les deux EST la distance qu'il reste à parcourir : c'est lui
  // qui pilote la déformation, sans avoir à mesurer une vitesse.
  const targetIndex = useRef(new Animated.Value(state.index)).current;

  useEffect(() => {
    targetIndex.setValue(state.index);
    if (reduceMotion) {
      Animated.timing(animIndex, {
        toValue: state.index, duration: 150, useNativeDriver: true,
      }).start();
      return;
    }
    Animated.spring(animIndex, {
      toValue: state.index, useNativeDriver: true, ...TRAVEL_SPRING,
    }).start();
  }, [state.index, animIndex, targetIndex, reduceMotion]);

  const indicatorX = animIndex.interpolate({
    inputRange: state.routes.map((_, i) => i),
    outputRange: state.routes.map((_, i) => i * tabWidth),
    extrapolate: 'clamp',
  });

  // Distance restante, en onglets, signée selon le sens du déplacement.
  const remaining = Animated.subtract(animIndex, targetIndex);

  // Le verre s'allonge dans le sens de la marche et se rétracte en arrivant.
  // L'amplitude suit la distance : un saut vers l'onglet voisin s'étire à peine,
  // une traversée complète s'étire franchement. Sortie symétrique (la valeur est
  // signée), d'où les paliers en miroir de part et d'autre de zéro.
  const stretch = remaining.interpolate({
    inputRange: [-3, -1, 0, 1, 3],
    outputRange: [1.24, 1.1, 1, 1.1, 1.24],
    extrapolate: 'clamp',
  });
  // Compensation verticale : un volume qui s'étire s'amincit. Sans elle
  // l'indicateur gonfle au lieu de se déformer.
  const squash = remaining.interpolate({
    inputRange: [-3, -1, 0, 1, 3],
    outputRange: [0.9, 0.96, 1, 0.96, 0.9],
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
        {/* Reflet du haut de la capsule, en DÉGRADÉ et non en aplat.
            Un aplat de 1 px posé à `top: 0` est une ligne DROITE en travers
            d'une capsule dont le bord haut est courbe : près des extrémités la
            ligne quitte le bord et ses bouts carrés restent visibles. Sur iOS,
            par-dessus le flou, ça se lit comme une barre oubliée sur la barre
            d'onglets.
            Un dégradé transparent → blanc → transparent n'a pas d'extrémité :
            il s'éteint avant d'atteindre la courbe. C'est aussi ce que fait un
            vrai reflet spéculaire, plus intense au centre. */}
        <SafeGradient
          colors={[
            'rgba(255,255,255,0)',
            'rgba(255,255,255,0.26)',
            'rgba(255,255,255,0)',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.shimmer}
          pointerEvents="none"
        />

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
                    // Après la translation : la déformation s'applique autour du
                    // centre de l'indicateur, où qu'il se trouve.
                    { scaleX: reduceMotion ? 1 : stretch },
                    { scaleY: reduceMotion ? 1 : squash },
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

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                // Avant la navigation : le tic doit coïncider avec le doigt, pas
                // avec le montage de l'écran suivant.
                hapticSelection();
                navigation.navigate(route.name);
              }
            };

            return (
              <TabItem
                key={route.key}
                route={route.name}
                focused={focused}
                label={(options.tabBarLabel as string) ?? route.name}
                reduceMotion={reduceMotion}
                onPress={onPress}
                accessibilityLabel={options.tabBarAccessibilityLabel}
              />
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
            hapticSelection();
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

  // Retrait en pourcentage : le reflet doit mourir avant l'arrondi, or celui-ci
  // vaut la moitié de la hauteur de la capsule quelle que soit la largeur de
  // l'écran. Les 28 px fixes d'avant laissaient dépasser la ligne sur un petit
  // écran et la coupaient trop court sur un grand.
  shimmer: {
    position: 'absolute',
    top: 0,
    left: '14%',
    right: '14%',
    height: 1,
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
  },

  // Porte les transformations : la cellule, elle, garde sa zone tactile pleine
  // hauteur — un doigt ne doit pas rater l'onglet parce que l'icône a rétréci.
  itemInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },

  label: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.1,
  },

  // Le libellé actif se superpose exactement à l'inactif — les deux se croisent
  // en opacité, sans décaler la mise en page.
  labelOverlay: {
    ...StyleSheet.absoluteFillObject,
    textAlign: 'center',
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
