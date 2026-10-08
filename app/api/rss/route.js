import { NextResponse } from 'next/server';
import { getRssGuidMap } from '@/lib/scraper';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const { baseUrl } = await req.json();
    const map = await getRssGuidMap(baseUrl);
    return NextResponse.json({ map });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
