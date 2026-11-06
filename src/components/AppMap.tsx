import React, { useEffect } from 'react';
import { Platform, View, Text, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import RNMapView, { Marker as RNMarker, type Region } from 'react-native-maps';
import Mapbox, { MapView as MBXMapView, Camera, PointAnnotation, UserLocation } from '@rnmapbox/maps';

// iOS -> Apple Maps (react-native-maps default, no key).
// Android -> Mapbox (@rnmapbox/maps). Needs public token at runtime
// (EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN / extra.mapboxPublicToken) and
// RNMAPBOX_MAPS_DOWNLOAD_TOKEN secret at build time.
const MAPBOX_TOKEN =
  (Constants.expoConfig?.extra as any)?.mapboxPublicToken ??
  process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN ??
  '';

if (Platform.OS === 'android' && MAPBOX_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_TOKEN);
}

const INITIAL = { latitude: 41.0082, longitude: 28.9784, zoom: 12 };

export function AppMap({ region, markers, style, onPress }: {
  region?: Region;
  markers?: { id: string; coordinate: { latitude: number; longitude: number }; title?: string }[];
  style?: any;
  onPress?: (e: any) => void;
}) {
  if (Platform.OS === 'android') {
    if (!MAPBOX_TOKEN) {
      return (
        <View style={[styles.fallback, style]}>
          <Text style={styles.fallbackText}>Harita için Mapbox token gerekli</Text>
        </View>
      );
    }
    return (
      <MBXMapView style={style} onPress={onPress} logoEnabled={false} attributionEnabled>
        <Camera
          zoomLevel={region ? undefined : INITIAL.zoom}
          centerCoordinate={region ? [region.longitude, region.latitude] : [INITIAL.longitude, INITIAL.latitude]}
        />
        <UserLocation visible />
        {markers?.map((m) => (
          <PointAnnotation key={m.id} id={m.id} coordinate={[m.coordinate.longitude, m.coordinate.latitude]} title={m.title}>
            <View />
          </PointAnnotation>
        ))}
      </MBXMapView>
    );
  }
  return (
    <RNMapView
      style={style}
      initialRegion={region ?? { ...INITIAL, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      onPress={onPress}
      showsUserLocation
      showsMyLocationButton
    >
      {markers?.map((m) => (
        <RNMarker key={m.id} coordinate={m.coordinate} title={m.title} />
      ))}
    </RNMapView>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: '#1A120B', alignItems: 'center', justifyContent: 'center' },
  fallbackText: { color: '#B8A888', fontSize: 13 },
});
