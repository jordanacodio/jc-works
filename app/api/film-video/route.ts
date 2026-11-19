const SOURCES = {
  make: 'https://jc-works-film-analysis-demo.jordanacodio.chatgpt.site/assets/video-1.m4v',
  miss: 'https://jc-works-film-analysis-demo.jordanacodio.chatgpt.site/assets/video-2.m4v',
};

export async function GET(request: Request) {
  const clip = new URL(request.url).searchParams.get('clip') === 'miss' ? 'miss' : 'make';
  const range = request.headers.get('range');
  const upstream = await fetch(SOURCES[clip], { headers: range ? { Range: range } : undefined });
  const headers = new Headers();
  headers.set('Content-Type', 'video/mp4');
  headers.set('Cache-Control', 'public, max-age=86400');
  for (const name of ['accept-ranges', 'content-length', 'content-range', 'etag']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
