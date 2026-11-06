import React from 'react';
import { Platform, View, Text, StyleSheet } from 'react-native';
import RNMapView, { Marker as RNMarker, type Region } from 'react-native-maps';

// iOS -> Apple Maps only. (@rnmapbox/maps is excluded from iOS builds.)
const INITIAL = { latitude: 41.0082, longitude: 28.9784, latitudeDelta: 0.05, longitudeDelta: 0.05 };

export function AppMap({ region, markers, style, onPress }: {
  region?: Region;
  markers?: { id: string; coordinate: { latitude: number; longitude: number }; title?: string }[];
  style?: any;
  onPress?: (e: any) => void;
}) {
  return (
    <RNMapView
      style={style}
      initialRegion={region ?? INITIAL}
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
