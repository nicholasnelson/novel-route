/**
 * novelroute.app: static site (public/) served by Workers static assets.
 * The script sends www.novelroute.app to the bare domain and adds security headers.
 */
interface Env {
  ASSETS: Fetcher;
}

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Nothing on the site is meant to be shown inside another site's frame.
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === 'www.novelroute.app') {
      url.hostname = 'novelroute.app';
      return Response.redirect(url.toString(), 301);
    }
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
    return response;
  },
};
