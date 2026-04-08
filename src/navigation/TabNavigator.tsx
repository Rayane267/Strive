import React from 'react';
import { View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import FontAwesome5 from 'react-native-vector-icons/FontAwesome5';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { useTranslation } from 'react-i18next';

import DashboardScreen from '../screens/DashboardScreen';
import HistoryScreen from '../screens/HistoryScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ShopScreen from '../screens/ShopScreen';

const Tab = createBottomTabNavigator();

const TabDot = ({ focused }: { focused: boolean }) => (
  <View
    style={{
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: focused ? colors.primary : 'transparent',
      marginTop: 4,
    }}
  />
);

const TabNavigator = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0D1A13',
          borderTopWidth: 1,
          borderTopColor: 'rgba(0,230,118,0.08)',
          // hauteur fixe du contenu (72) + espace système en bas (barre Samsung, iPhone home indicator...)
          height: 72 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom,
          elevation: 24,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -6 },
          shadowOpacity: 0.45,
          shadowRadius: 12,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: '#4A5A52',
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.2,
        },
        tabBarItemStyle: {
          paddingBottom: 10,
        },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarLabel: t('nav.dashboard'),
          tabBarAccessibilityLabel: t('nav.dashboard'),
          tabBarIcon: ({ color, focused }) => (
            <View style={{ alignItems: 'center' }}>
              <MaterialCommunityIcons name="view-dashboard" size={24} color={color} />
              <TabDot focused={focused} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{
          tabBarLabel: t('nav.history'),
          tabBarAccessibilityLabel: t('nav.history'),
          tabBarIcon: ({ color, focused }) => (
            <View style={{ alignItems: 'center' }}>
              <MaterialCommunityIcons name="history" size={24} color={color} />
              <TabDot focused={focused} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Analytics"
        component={AnalyticsScreen}
        options={{
          tabBarLabel: t('nav.analytics'),
          tabBarAccessibilityLabel: t('nav.analytics'),
          tabBarIcon: ({ color, focused }) => (
            <View style={{ alignItems: 'center' }}>
              <MaterialCommunityIcons name="google-analytics" size={24} color={color} />
              <TabDot focused={focused} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Shop"
        component={ShopScreen}
        options={{
          tabBarLabel: t('nav.shop'),
          tabBarAccessibilityLabel: t('nav.shop'),
          tabBarIcon: ({ color, focused }) => (
            <View style={{ alignItems: 'center' }}>
              <MaterialCommunityIcons name="storefront-outline" size={24} color={color} />
              <TabDot focused={focused} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: t('nav.profile'),
          tabBarAccessibilityLabel: t('nav.profile'),
          tabBarIcon: ({ color, focused }) => (
            <View style={{ alignItems: 'center' }}>
              <FontAwesome5 name="user" size={20} color={color} />
              <TabDot focused={focused} />
            </View>
          ),
        }}
      />
    </Tab.Navigator>
  );
};

export default TabNavigator;
