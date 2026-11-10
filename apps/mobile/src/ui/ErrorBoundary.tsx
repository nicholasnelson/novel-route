import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { reportError } from '../monitoring/sentry';
import { makeStyles } from './theme';

type State = { error: Error | null };

/** Catches render errors so a crash shows a recoverable screen instead of closing the app. */
export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
    reportError(error, info.componentStack ?? undefined);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorScreen onRetry={() => this.setState({ error: null })} />;
  }
}

function ErrorScreen({ onRetry }: { onRetry(): void }) {
  const styles = useStyles();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>Your visit history is saved on this device.</Text>
      <TouchableOpacity style={styles.button} onPress={onRetry} accessibilityRole="button">
        <Text style={styles.buttonText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.paper,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    color: colors.ink,
  },
  body: {
    fontSize: 15,
    color: colors.inkSoft,
    marginBottom: 20,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.green,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  buttonText: {
    color: colors.onGreen,
    fontSize: 16,
    fontWeight: '600',
  },
}));
