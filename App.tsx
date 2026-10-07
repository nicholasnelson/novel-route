import { StatusBar } from 'expo-status-bar';
import MapScreen from './src/map/MapScreen';
import ErrorBoundary from './src/ui/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary>
      <StatusBar style="auto" />
      <MapScreen />
    </ErrorBoundary>
  );
}
