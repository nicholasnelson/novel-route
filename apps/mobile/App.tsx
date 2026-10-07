import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MapScreen from './src/map/MapScreen';
import ErrorBoundary from './src/ui/ErrorBoundary';

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <StatusBar style="dark" />
        <MapScreen />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
