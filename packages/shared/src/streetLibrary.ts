import { Library } from './types';
import { htmlToText } from './html';

/**
 * Client for the Street Library WordPress endpoint. The Novel Route server uses it to fill its
 * cache; the app only uses it directly when no API URL is configured (development).
 * Works anywhere with fetch + FormData (React Native, Cloudflare Workers, Node 18+).
 */

const API_URL = 'https://streetlibrary.org.au/wp-admin/admin-ajax.php';
const REQUEST_TIMEOUT_MS = 15000;
const REQUEST_HEADERS = {
  Accept: 'application/json',
  Referer: 'https://streetlibrary.org.au/find/',
};

export const STREET_LIBRARY_ID_PREFIX = 'sl:';

async function postForm(form: FormData): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: form,
      headers: REQUEST_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Street Library request failed: HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function getNonce(): Promise<string> {
  const form = new FormData();
  form.append('action', 'library_locator_get_nonce');

  const json = await postForm(form);
  if (json.success && json.data) {
    const nonce = typeof json.data === 'string' ? json.data : json.data.nonce;
    if (typeof nonce === 'string') return nonce;
  }
  throw new Error('Failed to get nonce');
}

export function normalizeLibrary(item: any): Library | null {
  const latitude = parseFloat(item.latitude);
  const longitude = parseFloat(item.longitude);
  const rawId = item.id ?? item.ID;
  if (rawId == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const excerpt = typeof item.excerpt === 'string' ? htmlToText(item.excerpt) : '';
  const title = typeof item.title === 'string' ? htmlToText(item.title) : '';

  return {
    id: STREET_LIBRARY_ID_PREFIX + String(rawId),
    title: title || 'Unnamed library',
    latitude,
    longitude,
    excerpt: excerpt || undefined,
    permalink: item.permalink || undefined,
  };
}

export async function fetchLibrariesForPoint({
  lat,
  lng,
  nonce,
}: {
  lat: number;
  lng: number;
  nonce: string;
}): Promise<{ libraries: Library[]; nonceExpired: boolean }> {
  const form = new FormData();
  form.append('action', 'library_locator_fetch_libraries');
  form.append('lat', String(lat));
  form.append('lng', String(lng));
  form.append('nonce', nonce);

  const json = await postForm(form);

  if (json.success) {
    const raw: any[] = Array.isArray(json.data)
      ? json.data
      : json.data?.libraries ?? [];

    const libraries = raw
      .map(normalizeLibrary)
      .filter((lib): lib is Library => lib !== null);

    return { libraries, nonceExpired: false };
  }

  // The endpoint only serves Australia and New Zealand; elsewhere there are simply no libraries.
  if (typeof json.data === 'string' && json.data.includes('within Australia')) {
    return { libraries: [], nonceExpired: false };
  }

  // Check for nonce expiry
  if (
    json.data === 'nonce_expired' ||
    json.data?.nonce_expired ||
    (typeof json.data?.message === 'string' &&
      json.data.message.toLowerCase().includes('nonce'))
  ) {
    return { libraries: [], nonceExpired: true };
  }

  const message = typeof json?.data === 'string' ? json.data : json?.data?.message;
  throw new Error(message ?? `API request failed: ${JSON.stringify(json).slice(0, 160)}`);
}

export async function fetchLibrariesWithAutoNonce({
  lat,
  lng,
  cachedNonce,
}: {
  lat: number;
  lng: number;
  cachedNonce?: string;
}): Promise<{ libraries: Library[]; nonce: string }> {
  let nonce = cachedNonce ?? (await getNonce());

  const result = await fetchLibrariesForPoint({ lat, lng, nonce });

  if (result.nonceExpired) {
    // Refresh nonce and retry once
    nonce = await getNonce();
    const retry = await fetchLibrariesForPoint({ lat, lng, nonce });
    if (retry.nonceExpired) {
      throw new Error('Nonce expired after refresh');
    }
    return { libraries: retry.libraries, nonce };
  }

  return { libraries: result.libraries, nonce };
}
