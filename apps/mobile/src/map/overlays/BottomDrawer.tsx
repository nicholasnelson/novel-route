import React, { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, GestureResponderEvent, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, shadow } from '../../ui/theme';

const MAX_WIDTH = 560;
/** Space left above the drawer when it's pulled all the way up. */
const TOP_GAP = 56;
/** A drag further than this (or a quick flick) moves to the next height. */
const DRAG_THRESHOLD = 60;
const FLICK_VELOCITY = 0.6;

/**
 * A drawer over the bottom of the map, not covering it (docs/ux.md "Library drawer"). It opens
 * showing its header and the first `peek` points of its content, and can be dragged up by the
 * header to show the rest (the content also scrolls). Dragging down, or the back gesture, closes
 * it. On wide screens it stops at MAX_WIDTH, centred.
 *
 * `resetKey` identifies what it shows: a new key opens it at the peek height again.
 */
export default function BottomDrawer({ header, children, peek, resetKey, onClose, onHeightChange }: {
  /** The draggable top part (title, close button). */
  header: React.ReactNode;
  children: React.ReactNode;
  /** Height of the content to show when it opens (null until measured: then it shows it all). */
  peek: number | null;
  resetKey: string;
  onClose(): void;
  /** The height it settles at, for keeping the map clear of it. */
  onHeightChange?(height: number): void;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [headerHeight, setHeaderHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [height] = useState(() => new Animated.Value(0));
  const currentRef = useRef(0);

  const maxHeight = Math.max(200, window.height - insets.top - TOP_GAP);
  const fullHeight = Math.min(headerHeight + contentHeight, maxHeight);
  const peekHeight = peek === null ? fullHeight : Math.min(headerHeight + peek + insets.bottom, fullHeight);
  const canExpand = fullHeight - peekHeight > 24;
  const measured = headerHeight > 0 && contentHeight > 0;
  const target = !measured ? 0 : expandedKey === resetKey || !canExpand ? fullHeight : peekHeight;

  const animateTo = (value: number, then?: () => void) => {
    currentRef.current = value;
    Animated.spring(height, { toValue: value, useNativeDriver: false, bounciness: 0, speed: 18 }).start(() => then?.());
  };

  useEffect(() => {
    if (target <= 0) return;
    animateTo(target);
    onHeightChange?.(target);
    // animateTo only reads refs and the animated value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  // Drags start on the header only, so scrolling the content still works; a tap on one of the
  // header's buttons stays a tap unless the finger moves.
  const dragRef = useRef<{ startY: number; startHeight: number; lastY: number; lastTime: number; velocity: number } | null>(null);
  const touchYRef = useRef(0);
  const dragHandlers = {
    onTouchStart: (e: GestureResponderEvent) => { touchYRef.current = e.nativeEvent.pageY; },
    onMoveShouldSetResponderCapture: (e: GestureResponderEvent) => Math.abs(e.nativeEvent.pageY - touchYRef.current) > 6,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      height.stopAnimation();
      const y = e.nativeEvent.pageY;
      dragRef.current = { startY: touchYRef.current, startHeight: currentRef.current, lastY: y, lastTime: Date.now(), velocity: 0 };
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const y = e.nativeEvent.pageY;
      const t = Date.now();
      drag.velocity = (y - drag.lastY) / Math.max(1, t - drag.lastTime);
      drag.lastY = y;
      drag.lastTime = t;
      const value = Math.max(0, Math.min(fullHeight, drag.startHeight - (y - drag.startY)));
      currentRef.current = value;
      height.setValue(value);
    },
    onResponderRelease: () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      const dy = drag.lastY - drag.startY;
      const down = dy > DRAG_THRESHOLD || drag.velocity > FLICK_VELOCITY;
      const up = dy < -DRAG_THRESHOLD || drag.velocity < -FLICK_VELOCITY;
      const wasExpanded = canExpand && drag.startHeight > peekHeight + 1;
      if (down && !wasExpanded) {
        animateTo(0, onClose);
      } else if (down) {
        setExpandedKey(null);
        animateTo(peekHeight);
      } else if (up && canExpand) {
        setExpandedKey(resetKey);
        animateTo(fullHeight);
      } else {
        animateTo(wasExpanded ? fullHeight : peekHeight);
      }
    },
    onResponderTerminate: () => {
      dragRef.current = null;
      animateTo(target);
    },
  };

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.drawer,
          { height, marginLeft: insets.left, marginRight: insets.right },
        ]}
      >
        <View {...dragHandlers} onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
          <View style={styles.grab} />
          {header}
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          onContentSizeChange={(_, h) => setContentHeight(h)}
          // Scrolling to the end of a peeking drawer pulls it up, so the rest is easy to find.
          onScrollEndDrag={(e) => { if (canExpand && e.nativeEvent.contentOffset.y > 0) setExpandedKey(resetKey); }}
        >
          {children}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  drawer: {
    width: '100%',
    maxWidth: MAX_WIDTH,
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    ...shadow,
  },
  grab: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#d3ccbd',
    marginTop: 8,
  },
  scroll: {
    flex: 1,
  },
});
