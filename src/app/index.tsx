import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet, Dimensions } from 'react-native';
import { Redirect } from 'expo-router';
import { useAppStore } from '../stores/appStore';
import { useTheme } from '../theme/ThemeContext';

const { width: W, height: H } = Dimensions.get('window');

// Short modern boot animation — no logo. Plays until session state resolves
// (minimum ~1.3s), then routes straight to feed/login.
export default function Index() {
  const session = useAppStore((s) => s.session);
  const loaded = useAppStore((s) => s.sessionLoaded);
  const theme = useTheme();
  const [minDone, setMinDone] = useState(false);
  const t0 = useRef(Date.now());

  useEffect(() => {
    const remain = 1300 - (Date.now() - t0.current);
    const t = setTimeout(() => setMinDone(true), Math.max(0, remain));
    return () => clearTimeout(t);
  }, []);

  if (!(loaded && minDone)) return <LaunchAnimation accent={theme.colors.accent} />;
  return <Redirect href={session ? '/chats' : '/(auth)/login'} />;
}

function LaunchAnimation({ accent }: { accent: string }) {
  const g1 = useRef(new Animated.Value(0)).current;
  const g2 = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const drift = (v: Animated.Value, dx: number, dy: number, dur = 2600) =>
      Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();
    drift(g1, 90, -60);
    drift(g2, -90, 80);
    Animated.loop(Animated.sequence([
      Animated.timing(ring, { toValue: 1, duration: 1500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(ring, { toValue: 0, duration: 0, useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.timing(bar, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true })).start();
    dots.forEach((d, i) => {
      Animated.loop(Animated.sequence([
        Animated.delay(i * 180),
        Animated.timing(d, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.timing(d, { toValue: 0, duration: 350, useNativeDriver: true }),
        Animated.delay(900 - i * 180),
      ])).start();
    });
    return () => { g1.stopAnimation(); g2.stopAnimation(); ring.stopAnimation(); bar.stopAnimation(); dots.forEach((d) => d.stopAnimation()); };
  }, []);

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.5] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.55, 0.28, 0] });
  const barX = bar.interpolate({ inputRange: [0, 1], outputRange: [-W * 0.7, W * 0.7] });

  return (
    <View style={styles.root}>
      {/* drifting accent glows */}
      <Animated.View style={[styles.glow, { backgroundColor: accent, opacity: 0.16, transform: [
        { translateX: g1.interpolate({ inputRange: [0, 1], outputRange: [-30, 30] }) },
        { translateY: g1.interpolate({ inputRange: [0, 1], outputRange: [20, -20] }) },
        { scale: g1.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) },
      ]}]} />
      <Animated.View style={[styles.glow2, { backgroundColor: '#E85D75', opacity: 0.10, transform: [
        { translateX: g2.interpolate({ inputRange: [0, 1], outputRange: [40, -40] }) },
        { translateY: g2.interpolate({ inputRange: [0, 1], outputRange: [-30, 30] }) },
      ]}]} />

      {/* expanding ring */}
      <Animated.View style={[styles.ring, { borderColor: accent, transform: [{ scale: ringScale }], opacity: ringOpacity }]} />

      {/* sweeping accent line */}
      <Animated.View style={[styles.bar, { backgroundColor: accent, transform: [{ translateX: barX }, { rotate: '18deg' }] }]} />

      {/* three pulsing dots */}
      <View style={styles.dots}>
        {dots.map((d, i) => (
          <Animated.View key={i} style={[styles.dot, {
            backgroundColor: i === 1 ? accent : '#8A8A99',
            opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
            transform: [{ scale: d.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.25] }) }],
          }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B0F', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  glow: { position: 'absolute', width: W * 0.9, height: W * 0.9, borderRadius: W * 0.45, top: H * 0.18, alignSelf: 'center' },
  glow2: { position: 'absolute', width: W * 0.7, height: W * 0.7, borderRadius: W * 0.35, bottom: H * 0.12, alignSelf: 'center' },
  ring: { position: 'absolute', width: 190, height: 190, borderRadius: 95, borderWidth: 2 },
  bar: { position: 'absolute', width: W * 1.4, height: 1.5, opacity: 0.5 },
  dots: { flexDirection: 'row', gap: 10, marginTop: 240 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
