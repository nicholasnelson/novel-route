import { Platform } from 'react-native';
import { feedbackUrl, FEEDBACK_EMAIL } from '../feedback';

// Hoisted above the imports by Jest.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.2.0', android: { versionCode: 7 } } },
}));

describe('feedbackUrl', () => {
  it('addresses us, with the version in the subject and the build and device in the body', () => {
    const url = feedbackUrl();
    expect(url.startsWith(`mailto:${FEEDBACK_EMAIL}?`)).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('subject')).toBe('Novel Route feedback (1.2.0)');
    const body = params.get('body')!;
    expect(body).toContain('Novel Route 1.2.0 (7)');
    expect(body).toContain(`${Platform.OS}`.replace('android', 'Android'));
  });

  it('never includes anything that looks like a location', () => {
    expect(decodeURIComponent(feedbackUrl())).not.toMatch(/-?\d{1,3}\.\d{3,}/);
  });
});
