import { Library } from '../types';

const API_URL = 'https://streetlibrary.org.au/wp-admin/admin-ajax.php';
const REFERER = 'https://streetlibrary.org.au/find/';

export async function getNonce(): Promise<string> {
  const form = new FormData();
  form.append('action', 'library_locator_get_nonce');

  const res = await fetch(API_URL, {
    method: 'POST',
    body: form,
    headers: {
      Accept: 'application/json',
      Referer: REFERER,
    },
  });

  const json = await res.json();
  if (json.success && json.data) {
    return typeof json.data === 'string' ? json.data : json.data.nonce ?? json.data;
  }
  throw new Error('Failed to get nonce');
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

  const res = await fetch(API_URL, {
    method: 'POST',
    body: form,
    headers: {
      Accept: 'application/json',
      Referer: REFERER,
    },
  });

  const json = await res.json();

  if (json.success) {
    const raw: any[] = Array.isArray(json.data)
      ? json.data
      : json.data?.libraries ?? [];

    const libraries: Library[] = raw.map((item: any) => ({
      id: String(item.id ?? item.ID ?? `${item.latitude}_${item.longitude}`),
      title: item.title ?? 'Unknown Library',
      latitude: parseFloat(item.latitude),
      longitude: parseFloat(item.longitude),
      excerpt: item.excerpt || undefined,
      permalink: item.permalink || undefined,
    }));

    return { libraries, nonceExpired: false };
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

  throw new Error(json.data?.message ?? 'API request failed');
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
