/**
 * Fond de carte des zones sur Android : Mapbox, derrière la même interface que
 * react-native-maps sur iOS (cf. ZoneMap.tsx). Seul ce que MapScreen emploie
 * est traduit ; les props propres à Plans ou à Google Maps (mapType,
 * customMapStyle, appleLogoInsets…) sont ignorées.
 *
 * Google Maps aurait demandé un compte de facturation Google Cloud, et son
 * prépaiement : Mapbox lit un jeton public (`MAPBOX_APIKEY`), rien d'autre.
 */
import React, { forwardRef, useId, useImperativeHandle, useMemo, useRef } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Mapbox, {
  Camera,
  FillLayer,
  LineLayer,
  MapView as MapboxMapView,
  MarkerView,
  ShapeSource,
  UserLocation,
  type MapState,
} from '@rnmapbox/maps';
import { MAPBOX_APIKEY } from '@env';

Mapbox.setAccessToken(MAPBOX_APIKEY ?? null).catch(() => {});
// La carte n'affiche pas la position : rien à remonter à Mapbox.
Mapbox.setTelemetryEnabled(false);

/** Plan sombre : il porte les zones au lieu de leur disputer l'attention, comme
 *  le `mutedStandard` sombre de Plans sur iOS. */
const STYLE_URL = 'mapbox://styles/mapbox/dark-v11';

/** Calque vide posé avant tout le reste. Les cases (zIndex < 3) passent
 *  toujours SOUS lui, le halo de sélection au-dessus : une case qui entre dans
 *  le champ après coup ne recouvre jamais le halo. Mapbox empile ses calques
 *  dans l'ordre d'ajout et n'a pas de zIndex. */
const ANCHOR_LAYER = 'zonemap-anchor';
const GLOW_Z = 3;

type LatLng = { latitude: number; longitude: number };
type Region = LatLng & { latitudeDelta: number; longitudeDelta: number };
type EdgePadding = { top: number; right: number; bottom: number; left: number };

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Identifiant de source/calque stable et sans caractères exotiques. */
function useLayerId(): string {
  const raw = useId();
  return useMemo(() => `zm${raw.replace(/[^a-zA-Z0-9]/g, '')}`, [raw]);
}

/** La région VUE : le milieu des bornes, pas le centre de la caméra, que le
 *  rembourrage d'un `fitBounds` décale. */
function toRegion(state: MapState): Region {
  const { ne, sw } = state.properties.bounds;
  return {
    latitude: (ne[1] + sw[1]) / 2,
    longitude: (ne[0] + sw[0]) / 2,
    latitudeDelta: Math.abs(ne[1] - sw[1]),
    longitudeDelta: Math.abs(ne[0] - sw[0]),
  };
}

type MapViewProps = {
  style?: StyleProp<ViewStyle>;
  initialRegion: Region;
  onMapReady?: () => void;
  onRegionChangeComplete?: (region: Region) => void;
  /** Le logo Mapbox et l'attribution se calent sur le bas de ces marges. */
  legalLabelInsets?: EdgePadding;
  showsUserLocation?: boolean;
  onUserLocationChange?: (e: { nativeEvent: { coordinate?: LatLng } }) => void;
  children?: React.ReactNode;
};

export type ZoneMapHandle = {
  fitToCoordinates: (coords: LatLng[], opts?: { edgePadding?: EdgePadding; animated?: boolean }) => void;
  animateCamera: (camera: { center?: LatLng }, opts?: { duration?: number }) => void;
};

const MapView = forwardRef<ZoneMapHandle, MapViewProps>(function ZoneMapView(
  {
    style,
    initialRegion,
    onMapReady,
    onRegionChangeComplete,
    legalLabelInsets,
    showsUserLocation,
    onUserLocationChange,
    children,
  },
  ref,
) {
  const camera = useRef<Camera>(null);

  useImperativeHandle(
    ref,
    () => ({
      fitToCoordinates(coords, opts) {
        if (coords.length === 0) return;
        const lats = coords.map(c => c.latitude);
        const lons = coords.map(c => c.longitude);
        const p = opts?.edgePadding;
        camera.current?.fitBounds(
          [Math.max(...lons), Math.max(...lats)],
          [Math.min(...lons), Math.min(...lats)],
          p ? [p.top, p.right, p.bottom, p.left] : 0,
          opts?.animated === false ? 0 : 400,
        );
      },
      animateCamera(target, opts) {
        if (!target.center) return;
        const duration = opts?.duration ?? 400;
        camera.current?.setCamera({
          centerCoordinate: [target.center.longitude, target.center.latitude],
          // Le rembourrage d'un `fitBounds` reste acquis chez Mapbox : remis à
          // zéro, le centre demandé tombe au milieu de l'écran, comme sur iOS.
          padding: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 },
          animationDuration: duration,
          animationMode: duration > 0 ? 'easeTo' : 'none',
        });
      },
    }),
    [],
  );

  const { latitude, longitude, latitudeDelta, longitudeDelta } = initialRegion;
  const defaultSettings = useMemo(
    () => ({
      bounds: {
        ne: [longitude + longitudeDelta / 2, latitude + latitudeDelta / 2],
        sw: [longitude - longitudeDelta / 2, latitude - latitudeDelta / 2],
      },
    }),
    [latitude, longitude, latitudeDelta, longitudeDelta],
  );

  const ornamentBottom = legalLabelInsets?.bottom ?? 8;

  return (
    <MapboxMapView
      style={style}
      styleURL={STYLE_URL}
      localizeLabels={{ locale: 'current' }}
      onDidFinishLoadingMap={onMapReady}
      onMapIdle={state => onRegionChangeComplete?.(toRegion(state))}
      pitchEnabled={false}
      rotateEnabled={false}
      compassEnabled={false}
      scaleBarEnabled={false}
      logoPosition={{ bottom: ornamentBottom, left: 8 }}
      attributionPosition={{ bottom: ornamentBottom, left: 92 }}
    >
      <Camera ref={camera} defaultSettings={defaultSettings} />
      <ShapeSource id={`${ANCHOR_LAYER}-src`} shape={EMPTY}>
        <LineLayer id={ANCHOR_LAYER} />
      </ShapeSource>
      {showsUserLocation && (
        <UserLocation
          visible
          onUpdate={loc =>
            onUserLocationChange?.({
              nativeEvent: { coordinate: { latitude: loc.coords.latitude, longitude: loc.coords.longitude } },
            })
          }
        />
      )}
      {children}
    </MapboxMapView>
  );
});

export default MapView;

type PolygonProps = {
  coordinates: LatLng[];
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  zIndex?: number;
  tappable?: boolean;
  onPress?: () => void;
};

const isTransparent = (c?: string) => !c || c === 'transparent' || /^rgba\([^)]*,\s*0\)$/.test(c.replace(/\s/g, ''));

export function Polygon({ coordinates, fillColor, strokeColor, strokeWidth = 1, zIndex = 0, onPress }: PolygonProps) {
  const id = useLayerId();
  const shape = useMemo<GeoJSON.Feature<GeoJSON.Polygon>>(() => {
    const ring = coordinates.map(c => [c.longitude, c.latitude]);
    // GeoJSON exige un anneau fermé ; react-native-maps le fermait seul.
    if (ring.length > 0) ring.push(ring[0]);
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
  }, [coordinates]);
  const lineStyle = useMemo(
    () => ({ lineColor: strokeColor, lineWidth: strokeWidth, lineJoin: 'round' as const }),
    [strokeColor, strokeWidth],
  );
  const placement = zIndex < GLOW_Z ? { belowLayerID: ANCHOR_LAYER } : {};

  const layers: React.ReactElement[] = [];
  if (!isTransparent(fillColor)) {
    layers.push(<FillLayer key="fill" id={`${id}-fill`} {...placement} style={{ fillColor }} />);
  }
  if (!isTransparent(strokeColor)) {
    layers.push(<LineLayer key="line" id={`${id}-line`} {...placement} style={lineStyle} />);
  }
  if (layers.length === 0) return null;

  return (
    <ShapeSource id={id} shape={shape} onPress={onPress ? () => onPress() : undefined}>
      {layers}
    </ShapeSource>
  );
}

type MarkerProps = {
  coordinate: LatLng;
  anchor?: { x: number; y: number };
  onPress?: () => void;
  children?: React.ReactNode;
};

export function Marker({ coordinate, anchor, onPress, children }: MarkerProps) {
  return (
    <MarkerView
      coordinate={[coordinate.longitude, coordinate.latitude]}
      // Ancre par défaut de react-native-maps : le bas, au centre.
      anchor={anchor ?? { x: 0.5, y: 1 }}
      allowOverlap
    >
      <Pressable onPress={onPress} disabled={!onPress}>
        {children}
      </Pressable>
    </MarkerView>
  );
}

/**
 * Pas encore portée : la nappe de chaleur du direct est coupée
 * (`LIVE_MAP_ENABLED` dans MapScreen). Mapbox charge une ImageSource par URL ;
 * le PNG en `data:` de renderHeatField devra d'abord passer par un fichier.
 */
export function Overlay(_props: { image: { uri: string }; bounds: [number, number][] }) {
  return null;
}
