/**
 * novelroute.app: static site (public/) served by Workers static assets.
 * The script only runs to send www.novelroute.app to the bare domain.
 */
interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === 'www.novelroute.app') {
      url.hostname = 'novelroute.app';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
