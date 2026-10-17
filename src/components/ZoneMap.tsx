/**
 * Fond de carte des zones. iOS : react-native-maps, donc Plans d'Apple, sans
 * clé ni compte. Android : Mapbox (ZoneMap.android.tsx), qui expose la même
 * interface — MapView, Polygon, Marker, Overlay — pour que MapScreen ignore
 * lequel tourne. Google Maps aurait exigé un compte de facturation Google Cloud.
 */
export { default, Marker, Overlay, Polygon } from 'react-native-maps';
