import { NextResponse } from 'next/server';
import { getPostUrlsFromIndex } from '@/lib/scraper';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const { indexUrl, baseUrl, postRegex } = await req.json();
    const urls = await getPostUrlsFromIndex(indexUrl, baseUrl, postRegex);
    return NextResponse.json({ urls });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
