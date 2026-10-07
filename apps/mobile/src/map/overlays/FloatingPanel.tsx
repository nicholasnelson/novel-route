import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow } from '../../ui/theme';

/** Margin of map left visible around the panel, so it reads as floating over the map. */
const MARGIN = 16;
const MAX_WIDTH = 560;

/**
 * A panel floating over the map (library details, map key). It sizes to its content, up to the
 * screen minus a margin, and closes on the back gesture or a tap on the visible map around it.
 */
export default function FloatingPanel({ visible, onClose, children }: {
  visible: boolean;
  onClose(): void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View
        style={[
          styles.root,
          {
            paddingTop: insets.top + MARGIN,
            paddingBottom: insets.bottom + MARGIN,
            paddingLeft: insets.left + MARGIN,
            paddingRight: insets.right + MARGIN,
          },
        ]}
      >
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={styles.panel}>{children}</View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
  },
  panel: {
    maxHeight: '100%',
    width: '100%',
    maxWidth: MAX_WIDTH,
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.panel,
    overflow: 'hidden',
    ...shadow,
  },
});
