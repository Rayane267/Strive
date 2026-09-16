// Mocks des modules natifs non disponibles côté Jest.
// La preset `react-native` couvre déjà les modules core ; on complète
// avec les dépendances qui utilisent TurboModuleRegistry.getEnforcing.

jest.mock('react-native-bootsplash', () => ({
  hide: jest.fn().mockResolvedValue(undefined),
  show: jest.fn().mockResolvedValue(undefined),
  getVisibilityStatus: jest.fn().mockResolvedValue('hidden'),
}));

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  reactNavigationIntegration: jest.fn(() => ({
    name: 'ReactNavigation',
    registerNavigationContainer: jest.fn(),
  })),
  wrap: (comp) => comp,
  ErrorBoundary: ({ children }) => children,
}));

jest.mock('@react-native-firebase/messaging', () => () => ({
  hasPermission: jest.fn().mockResolvedValue(1),
  requestPermission: jest.fn().mockResolvedValue(1),
  getToken: jest.fn().mockResolvedValue('test-token'),
  onMessage: jest.fn(() => () => {}),
  onNotificationOpenedApp: jest.fn(() => () => {}),
  getInitialNotification: jest.fn().mockResolvedValue(null),
  subscribeToTopic: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn(),
    signOut: jest.fn(),
    isSignedIn: jest.fn().mockResolvedValue(false),
  },
  statusCodes: {},
}));

jest.mock('@invertase/react-native-apple-authentication', () => ({
  appleAuth: {
    performRequest: jest.fn(),
    Operation: { LOGIN: 'login' },
    Scope: { EMAIL: 'email', FULL_NAME: 'name' },
  },
}));

jest.mock('react-native-purchases', () => ({
  configure: jest.fn(),
  getOfferings: jest.fn().mockResolvedValue({ current: null }),
  purchasePackage: jest.fn(),
  restorePurchases: jest.fn(),
  getCustomerInfo: jest.fn().mockResolvedValue({ entitlements: { active: {} } }),
  logIn: jest.fn(),
  logOut: jest.fn(),
  setLogLevel: jest.fn(),
  LOG_LEVEL: { DEBUG: 'DEBUG', INFO: 'INFO' },
}));

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => () => {}),
  fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@react-native-community/blur', () => ({
  BlurView: 'BlurView',
}));

jest.mock('react-native-linear-gradient', () => 'LinearGradient');

// react-native-device-info : mock officiel fourni par la lib (valeurs synchrones
// déterministes pour getVersion/getBuildNumber utilisés par src/config/appInfo).
jest.mock('react-native-device-info', () =>
  require('react-native-device-info/jest/react-native-device-info-mock'),
);

// ScanBridge n'existe qu'en natif — fournit une façade vide pour les tests
const { NativeModules } = require('react-native');
NativeModules.ScanBridge = {
  startScanner: jest.fn(),
  stopScanner: jest.fn(),
  isScannerRunning: jest.fn().mockResolvedValue(false),
  checkPermissions: jest.fn().mockResolvedValue({
    overlay: false, accessibility: false, needsMediaProjection: false, mediaProjectionGranted: false,
  }),
  openOverlaySettings: jest.fn(),
  openOverlayPermissionSettings: jest.fn(),
  openAccessibilitySettings: jest.fn(),
  requestMediaProjectionPermission: jest.fn().mockResolvedValue(undefined),
  showVerdict: jest.fn(),
  updateDuration: jest.fn(),
  updateMetrics: jest.fn(),
  finalizeScan: jest.fn(),
  setGeminiConfig: jest.fn(),
  setSupabaseUserJwt: jest.fn(),
  setParserConfig: jest.fn(),
  setPreferences: jest.fn(),
  setThresholds: jest.fn(),
  setTomTomApiKey: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
