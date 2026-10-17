module.exports = {
  project: {
    ios: {},
    android: {},
  },
  assets: ['./node_modules/react-native-vector-icons/Fonts/'],
  dependencies: {
    // Carte des zones : Plans (react-native-maps) sur iOS, Mapbox sur Android
    // (cf. src/components/ZoneMap.tsx). Chacun n'est lié que là où il sert —
    // Google Maps aurait exigé un compte de facturation Google Cloud.
    'react-native-maps': { platforms: { android: null } },
    '@rnmapbox/maps': { platforms: { ios: null } },
    // Barre d'onglets native : iOS seulement (Liquid Glass). Android garde la
    // barre JS de React Navigation — non lié, le binaire Android ne change pas,
    // et le thème Material 3 que demanderait le module n'est pas nécessaire.
    'react-native-bottom-tabs': { platforms: { android: null } },
  },
};
