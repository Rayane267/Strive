module.exports = {
  project: {
    ios: {},
    android: {},
  },
  assets: ['./node_modules/react-native-vector-icons/Fonts/'],
  dependencies: {
    // Carte des zones : iOS d'abord. Sur Android, react-native-maps passe par
    // Google Maps et demande une clé que l'app n'a pas encore — non lié, le
    // binaire Android ne change pas. Cf. `MapScreen` dans TabNavigator.
    'react-native-maps': { platforms: { android: null } },
    // Barre d'onglets native : iOS seulement (Liquid Glass). Android garde la
    // barre JS de React Navigation — non lié, le binaire Android ne change pas,
    // et le thème Material 3 que demanderait le module n'est pas nécessaire.
    'react-native-bottom-tabs': { platforms: { android: null } },
  },
};
