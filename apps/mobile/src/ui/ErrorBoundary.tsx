import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { reportError } from '../monitoring/sentry';

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
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>Your visit history is saved on this device.</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => this.setState({ error: null })}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    color: '#555',
    marginBottom: 20,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
