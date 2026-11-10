import { requireOptionalNativeModule } from 'expo';

/** Android only (modules/test-lab/android); elsewhere, and if anything goes wrong, false. */
const TestLab = requireOptionalNativeModule<{ isTestLab(): boolean }>('TestLab');

/** True on Google Play's pre-launch test devices (Firebase Test Lab). */
export function isTestLab(): boolean {
  try {
    return TestLab?.isTestLab() ?? false;
  } catch {
    return false;
  }
}
