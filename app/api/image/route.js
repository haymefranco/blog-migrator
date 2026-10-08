import axios from 'axios';
import { DEFAULT_HEADERS } from '@/lib/scraper';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  if (!url) return new Response('Missing url', { status: 400 });

  try {
    const res = await axios.get(url, {
      headers: DEFAULT_HEADERS,
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
    });
    return new Response(res.data, {
      headers: {
        'Content-Type': res.headers['content-type'] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('Fetch failed', { status: 502 });
  }
}