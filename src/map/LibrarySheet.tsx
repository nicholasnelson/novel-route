import React, { useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Library, Visit, VisitSummary } from '../types';
import { describeVisits } from '../store/freshness';

type Props = {
  library: Library | null;
  summary: VisitSummary | undefined;
  visits: Visit[];
  now: number;
  onLogVisit(): void;
  onDeleteVisit(visit: Visit): void;
  onUndoDelete(visit: Visit): void;
  onClearHistory(): void;
  onNavigate(): void;
  onClose(): void;
};

const SOURCE_LABELS: Record<Visit['source'], string> = {
  manual: '',
  nearby_prompt: 'logged when nearby',
  migrated: 'from an earlier version, date unknown',
};

function formatVisitDate(visit: Visit): string {
  if (visit.source === 'migrated') return 'Visited';
  return new Date(visit.visitedAt).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function LibrarySheet({
  library,
  summary,
  visits,
  now,
  onLogVisit,
  onDeleteVisit,
  onUndoDelete,
  onClearHistory,
  onNavigate,
  onClose,
}: Props) {
  const [lastDeleted, setLastDeleted] = useState<Visit | null>(null);

  const handleClose = () => {
    setLastDeleted(null);
    onClose();
  };

  const handleDelete = (visit: Visit) => {
    onDeleteVisit(visit);
    setLastDeleted(visit);
  };

  const handleUndo = () => {
    if (lastDeleted) onUndoDelete(lastDeleted);
    setLastDeleted(null);
  };

  const confirmClear = () => {
    Alert.alert(
      'Clear visit history?',
      'This removes every logged visit to this library. It will show as never visited.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear history',
          style: 'destructive',
          onPress: () => {
            setLastDeleted(null);
            onClearHistory();
          },
        },
      ]
    );
  };

  return (
    <Modal visible={library !== null} transparent animationType="slide" onRequestClose={handleClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={handleClose}>
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          {library && (
            <>
              <Text style={styles.title}>{library.title}</Text>
              {library.excerpt ? (
                <Text style={styles.excerpt} numberOfLines={6}>{library.excerpt}</Text>
              ) : null}

              <Text style={styles.status}>{describeVisits(summary, now)}</Text>

              <TouchableOpacity
                style={[styles.button, styles.buttonPrimary]}
                onPress={onLogVisit}
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>Log visit</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.buttonNavigate]}
                onPress={onNavigate}
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>Navigate to library</Text>
              </TouchableOpacity>

              {lastDeleted && (
                <View style={styles.undoBar}>
                  <Text style={styles.undoText}>Visit deleted</Text>
                  <TouchableOpacity onPress={handleUndo} accessibilityRole="button">
                    <Text style={styles.undoAction}>Undo</Text>
                  </TouchableOpacity>
                </View>
              )}

              {visits.length > 0 && (
                <>
                  <Text style={styles.sectionHeading}>Visit history</Text>
                  <ScrollView style={styles.history}>
                    {visits.map((visit) => (
                      <View key={visit.id} style={styles.visitRow}>
                        <View style={styles.visitInfo}>
                          <Text style={styles.visitDate}>{formatVisitDate(visit)}</Text>
                          {SOURCE_LABELS[visit.source] ? (
                            <Text style={styles.visitSource}>{SOURCE_LABELS[visit.source]}</Text>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          onPress={() => handleDelete(visit)}
                          accessibilityRole="button"
                          accessibilityLabel={`Delete visit ${formatVisitDate(visit)}`}
                          hitSlop={8}
                        >
                          <Text style={styles.deleteText}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                  <TouchableOpacity onPress={confirmClear} accessibilityRole="button">
                    <Text style={styles.clearText}>Clear history</Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity style={[styles.button, styles.buttonClose]} onPress={handleClose}>
                <Text style={[styles.buttonText, styles.buttonCloseText]}>Close</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  excerpt: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  status: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
    color: '#444',
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonPrimary: {
    backgroundColor: '#16a34a',
  },
  buttonNavigate: {
    backgroundColor: '#3b82f6',
  },
  buttonClose: {
    backgroundColor: '#e5e7eb',
    marginTop: 6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonCloseText: {
    color: '#333',
  },
  undoBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1f2937',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
  },
  undoText: {
    color: '#fff',
  },
  undoAction: {
    color: '#93c5fd',
    fontWeight: '700',
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: '#444',
    marginTop: 6,
    marginBottom: 4,
  },
  history: {
    maxHeight: 180,
  },
  visitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  visitInfo: {
    flex: 1,
  },
  visitDate: {
    fontSize: 14,
    color: '#111',
  },
  visitSource: {
    fontSize: 12,
    color: '#6b7280',
  },
  deleteText: {
    color: '#dc2626',
    fontSize: 14,
  },
  clearText: {
    color: '#dc2626',
    fontSize: 14,
    paddingVertical: 10,
    textAlign: 'center',
  },
});
