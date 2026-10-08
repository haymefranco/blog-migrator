import { NextResponse } from 'next/server';
import { getPostUrlsFromSitemap } from '@/lib/scraper';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const { baseUrl } = await req.json();
    const urls = await getPostUrlsFromSitemap(baseUrl);
    return NextResponse.json({ urls });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}