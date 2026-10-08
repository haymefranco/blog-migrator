import { NextResponse } from 'next/server';
import { scrapePost } from '@/lib/scraper';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const { url, baseUrl } = await req.json();
    const post = await scrapePost(url, baseUrl);
    return NextResponse.json({ post });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}