import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Ellipse, G, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

// Aqua sky, a big drop hanging from the top that keeps releasing droplets, a pine forest and a lake.
// Pure vector art (no image files), so it stays sharp on every screen size.

const NATIVE = Platform.OS !== 'web';
const VB_W = 400;
const VB_H = 800;

/** Small seeded random so the forest looks the same on every render. */
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function pine(x, y, h, w) {
  const p = (dx, dy) => `${(x + dx * w).toFixed(1)},${(y - dy * h).toFixed(1)}`;
  return `M${p(0, 1)} L${p(0.22, 0.72)} L${p(0.1, 0.72)} L${p(0.36, 0.42)} L${p(0.18, 0.42)} L${p(0.5, 0.1)} `
    + `L${p(0.06, 0.1)} L${p(0.06, 0)} L${p(-0.06, 0)} L${p(-0.06, 0.1)} L${p(-0.5, 0.1)} L${p(-0.18, 0.42)} `
    + `L${p(-0.36, 0.42)} L${p(-0.1, 0.72)} L${p(-0.22, 0.72)} Z`;
}

function forestLayer(seed, baseY, minH, maxH, spacing) {
  const rand = seeded(seed);
  let d = '';
  for (let x = -20; x < VB_W + 20; x += spacing * (0.7 + rand() * 0.6)) {
    const h = minH + rand() * (maxH - minH);
    d += pine(x, baseY + rand() * 6, h, h * (0.42 + rand() * 0.12));
  }
  return d;
}

const DROP_PATH = 'M12 0 C12 0 0 14 0 22 A12 12 0 0 0 24 22 C24 14 12 0 12 0 Z';

function FallingDrop({ x, startY = 0, delay, duration, size, fallTo, animate }) {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!animate) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(t, { toValue: 1, duration, easing: Easing.in(Easing.quad), useNativeDriver: NATIVE }),
      Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: NATIVE }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [animate, delay, duration, t]);
  if (!animate) return null;
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, fallTo] });
  const opacity = t.interpolate({ inputRange: [0, 0.08, 0.9, 1], outputRange: [0, 0.95, 0.9, 0] });
  const ripple = t.interpolate({ inputRange: [0, 0.9, 1], outputRange: [0, 0, 1] });
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.abs, { left: x - size / 2, top: startY, opacity, transform: [{ translateY }] }]}>
        <Svg width={size} height={size * 1.4} viewBox="0 0 24 34">
          <Defs>
            <LinearGradient id="dropFill" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#E0FBFF" />
              <Stop offset="1" stopColor="#48CAE4" />
            </LinearGradient>
          </Defs>
          <Path d={DROP_PATH} fill="url(#dropFill)" opacity={0.9} />
          <Ellipse cx="8" cy="22" rx="2.5" ry="4" fill="#FFFFFF" opacity={0.7} />
        </Svg>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[styles.abs, styles.ripple, {
          left: x - 24, top: startY + fallTo + size * 1.4 - 6,
          opacity: ripple.interpolate({ inputRange: [0, 0.01, 1], outputRange: [0, 0.8, 0] }),
          transform: [{ scaleX: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1.6] }) },
            { scaleY: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1.2] }) }],
        }]}
      />
    </>
  );
}

export default function AquaScene() {
  const { width, height } = useWindowDimensions();
  const [animate, setAnimate] = useState(false);
  const [swell] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((reduce) => { if (mounted) setAnimate(!reduce); })
      .catch(() => { if (mounted) setAnimate(true); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!animate) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(swell, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
      Animated.timing(swell, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [animate, swell]);

  const forest = useMemo(() => ({
    far: forestLayer(7, 712, 70, 120, 26),
    mid: forestLayer(21, 742, 90, 150, 30),
    near: forestLayer(43, 780, 110, 190, 38),
  }), []);

  // Drops land on the lake near the bottom of the screen.
  const lake = height * 0.955;
  const drops = useMemo(() => {
    const rand = seeded(99);
    const list = [{ x: width / 2, startY: 58, delay: 600, duration: 2200, size: 16 }]; // released by the big drop
    for (let i = 0; i < 7; i += 1) {
      list.push({ x: 20 + rand() * (width - 40), delay: Math.round(rand() * 3500), duration: 2400 + Math.round(rand() * 1800), size: 7 + rand() * 7 });
    }
    return list;
  }, [width]);

  const bigDropScale = swell.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMax slice">
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#012A4A" />
            <Stop offset="0.35" stopColor="#01497C" />
            <Stop offset="0.62" stopColor="#0A7EA4" />
            <Stop offset="0.82" stopColor="#48CAE4" />
            <Stop offset="1" stopColor="#ADE8F4" />
          </LinearGradient>
          <LinearGradient id="ray" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#CAF0F8" stopOpacity="0.35" />
            <Stop offset="1" stopColor="#CAF0F8" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="lake" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#48CAE4" />
            <Stop offset="1" stopColor="#0077B6" />
          </LinearGradient>
          <RadialGradient id="glow" cx="0.5" cy="0" r="0.6">
            <Stop offset="0" stopColor="#90E0EF" stopOpacity="0.45" />
            <Stop offset="1" stopColor="#90E0EF" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width={VB_W} height={VB_H} fill="url(#sky)" />
        <Rect x="0" y="0" width={VB_W} height={VB_H * 0.6} fill="url(#glow)" />
        <G>
          <Polygon points="170,0 230,0 330,620 70,620" fill="url(#ray)" />
          <Polygon points="120,0 150,0 40,560 -40,560" fill="url(#ray)" opacity={0.6} />
          <Polygon points="250,0 280,0 440,560 360,560" fill="url(#ray)" opacity={0.6} />
        </G>
        <Path d={forest.far} fill="#2A9D8F" opacity={0.55} />
        <Rect x="0" y="708" width={VB_W} height="40" fill="#2A9D8F" opacity={0.55} />
        <Path d={forest.mid} fill="#1B6E5A" opacity={0.85} />
        <Rect x="0" y="738" width={VB_W} height="40" fill="#1B6E5A" opacity={0.85} />
        <Path d={forest.near} fill="#0B3D2E" />
        <Rect x="0" y="776" width={VB_W} height="24" fill="url(#lake)" />
        <Rect x="0" y="776" width={VB_W} height="2" fill="#CAF0F8" opacity={0.6} />
      </Svg>

      {/* The big drop hanging from the top edge, gently swelling before it lets go. */}
      <Animated.View style={[styles.abs, { left: width / 2 - 34, top: -26, transform: [{ scale: bigDropScale }] }]}>
        <Svg width={68} height={96} viewBox="0 0 24 34">
          <Defs>
            <LinearGradient id="bigDrop" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#CAF0F8" stopOpacity="0.95" />
              <Stop offset="0.6" stopColor="#48CAE4" stopOpacity="0.9" />
              <Stop offset="1" stopColor="#0096C7" stopOpacity="0.95" />
            </LinearGradient>
          </Defs>
          <Path d={DROP_PATH} fill="url(#bigDrop)" />
          <Ellipse cx="7.5" cy="21" rx="2.6" ry="5" fill="#FFFFFF" opacity={0.75} />
          <Ellipse cx="16" cy="27" rx="2" ry="1.2" fill="#FFFFFF" opacity={0.35} />
        </Svg>
      </Animated.View>

      {drops.map((d, i) => (
        <FallingDrop key={i} {...d} fallTo={lake - (d.startY ?? 0) - d.size * 1.4} animate={animate} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  ripple: { width: 48, height: 12, borderRadius: 24, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)' },
});
