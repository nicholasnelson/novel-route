import React from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import FloatingPanel from './FloatingPanel';
import { MarkerIcon } from './cards';
import { FRESHNESS_LABELS } from '../../store/freshness';
import { Freshness } from '../../types';
import { colors } from '../../ui/theme';

const STATES: Freshness[] = ['never', 'fresh', 'recent', 'old'];

export const PRIVACY_POLICY_URL = 'https://novelroute.app/privacy';
export const REGISTER_LIBRARY_URL = 'https://streetlibrary.org.au/';

/** Map legend plus a few lines on what the app does. */
export default function MapKey({ visible, onClose }: { visible: boolean; onClose(): void }) {
  return (
    <FloatingPanel visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.title}>Map key</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={22} color={colors.ink} />
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Text style={styles.lead}>
          Doors open when you visit a library, and slowly close over the months as it&apos;s time to go back.
        </Text>
        {STATES.map((state) => (
          <View key={state} style={styles.row}>
            <MarkerIcon freshness={state} size={36} />
            <Text style={styles.label}>{FRESHNESS_LABELS[state]}</Text>
          </View>
        ))}
        <View style={styles.row}>
          <View style={styles.clusterGroup}>
            <View style={[styles.cluster, { borderColor: colors.amber }]}><Text style={styles.clusterText}>12</Text></View>
            <View style={[styles.cluster, { borderColor: colors.green }]}><Text style={styles.clusterText}>4</Text></View>
          </View>
          <Text style={styles.label}>Groups of libraries. Amber means at least one you haven&apos;t visited. Tap to zoom in.</Text>
        </View>

        <Text style={styles.heading}>Using Novel Route</Text>
        <Text style={styles.paragraph}>• Tap a library to see what&apos;s there, get directions or log a visit.</Text>
        <Text style={styles.paragraph}>
          • The card at the bottom points you to the nearest library you&apos;re due to visit. A solid green arrow
          points the way you&apos;re facing; a pale one points relative to the map (north is up).
        </Text>
        <Text style={styles.paragraph}>• When you&apos;re standing at one, log your visit in one tap.</Text>
        <Text style={styles.paragraph}>• Your visit history stays on this phone.</Text>

        <Text style={styles.heading}>About</Text>
        <Text style={styles.paragraph}>
          Library locations come from Street Library Australia. Novel Route is an independent project and isn&apos;t
          affiliated with Street Library Australia. Look after a library that isn&apos;t on the map?{' '}
          <Text style={styles.link} onPress={() => Linking.openURL(REGISTER_LIBRARY_URL)}>Register it with them</Text>.
        </Text>
        <Text style={[styles.paragraph, styles.link]} onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
          Privacy policy
        </Text>
      </ScrollView>
    </FloatingPanel>
  );
}

const serif = Platform.select({ ios: 'Georgia', android: 'serif' });

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: serif,
    color: colors.ink,
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.greenTint,
  },
  scroll: {
    flexGrow: 0,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  lead: {
    fontSize: 15,
    color: colors.inkSoft,
    lineHeight: 22,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 8,
  },
  label: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
  },
  clusterGroup: {
    width: 36,
    alignItems: 'center',
    gap: 4,
  },
  cluster: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.ink,
  },
  heading: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: serif,
    color: colors.ink,
    marginTop: 20,
    marginBottom: 6,
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
    marginBottom: 6,
  },
  link: {
    color: colors.green,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
