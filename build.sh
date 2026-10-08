#!/usr/bin/env bash
set -euo pipefail

ROOT="blog-migrator"
rm -rf "$ROOT" "$ROOT.zip"
mkdir -p "$ROOT/app/api/sitemap"
mkdir -p "$ROOT/app/api/rss"
mkdir -p "$ROOT/app/api/scrape-index"
mkdir -p "$ROOT/app/api/scrape-post"
mkdir -p "$ROOT/app/api/image"
mkdir -p "$ROOT/lib"

# ------------------------------------------------------------------
# package.json
# ------------------------------------------------------------------
cat > "$ROOT/package.json" <<'EOF'
{
  "name": "blog-migrator",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "axios": "^1.7.7",
    "cheerio": "^1.0.0",
    "jszip": "^3.10.1",
    "next": "^14.2.18",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }
}
EOF

# ------------------------------------------------------------------
# next.config.js
# ------------------------------------------------------------------
cat > "$ROOT/next.config.js" <<'EOF'
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['cheerio'],
  },
};

module.exports = nextConfig;
EOF

# ------------------------------------------------------------------
# .gitignore
# ------------------------------------------------------------------
cat > "$ROOT/.gitignore" <<'EOF'
node_modules
.next
.vercel
*.log
.DS_Store
EOF

# ------------------------------------------------------------------
# lib/utils.js
# ------------------------------------------------------------------
cat > "$ROOT/lib/utils.js" <<'EOF'
export function pMap(items, mapper, concurrency = 4, onProgress) {
  return new Promise((resolve) => {
    const results = new Array(items.length);
    let index = 0;
    let done = 0;

    async function worker() {
      while (true) {
        const i = index++;
        if (i >= items.length) return;
        try {
          results[i] = await mapper(items[i], i);
        } catch (e) {
          results[i] = { error: e.message, url: items[i] };
        }
        done++;
        onProgress?.(done, items.length);
      }
    }

    const n = Math.min(concurrency, items.length) || 0;
    if (n === 0) return resolve([]);
    Promise.all(Array.from({ length: n }, worker)).then(() => resolve(results));
  });
}

export function formatFriendlyDate(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d)) return String(raw);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function toRfc822(raw) {
  const d = raw ? new Date(raw) : new Date();
  if (isNaN(d)) return new Date().toUTCString();
  return d.toUTCString();
}

export function slugFromUrl(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.replace(/\/+$/, '').split('/').pop();
    return (seg || 'post').toLowerCase();
  } catch {
    return 'post';
  }
}

export function filenameFor(url, used = new Set()) {
  let base;
  try {
    const u = new URL(url);
    base = decodeURIComponent(u.pathname.split('/').pop() || 'image');
  } catch {
    base = 'image';
  }
  base = base.replace(/[^\w\-.]/g, '_') || 'image';
  if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += '.jpg';

  let name = base;
  let i = 1;
  while (used.has(name)) {
    const dot = base.lastIndexOf('.');
    name = base.slice(0, dot) + `_${i}` + base.slice(dot);
    i++;
  }
  used.add(name);
  return name;
}
EOF

# ------------------------------------------------------------------
# lib/scraper.js
# ------------------------------------------------------------------
cat > "$ROOT/lib/scraper.js" <<'EOF'
import axios from 'axios';
import * as cheerio from 'cheerio';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export const DEFAULT_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,' +
    'image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export async function fetchText(url) {
  const { data } = await axios.get(url, {
    headers: DEFAULT_HEADERS,
    timeout: 25000,
    maxRedirects: 5,
    responseType: 'text',
    transformResponse: [(d) => d],
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return data;
}

const RESERVED = new Set([
  'page', 'pages', 'category', 'categories', 'tag', 'tags', 'author', 'authors',
  'search', 'feed', 'rss', 'rss.xml', 'sitemap', 'sitemap.xml', 'archive',
  'archives', 'comment', 'comments', 'login', 'register', 'wp-admin',
]);

function isPostUrl(absUrl, baseUrl, customRegex) {
  try {
    const u = new URL(absUrl);
    const b = new URL(baseUrl);
    if (u.origin !== b.origin) return false;

    if (customRegex) {
      const re = new RegExp(customRegex);
      return re.test(u.pathname);
    }

    const blogPath = b.pathname.replace(/\/+$/, '');
    const path = u.pathname.replace(/\/+$/, '');
    if (!path.startsWith(blogPath + '/')) return false;
    const rest = path.slice(blogPath.length + 1);
    if (!rest || rest.includes('/')) return false;
    if (RESERVED.has(rest.toLowerCase())) return false;
    if (/\.(xml|json|rss|atom|jpg|jpeg|png|gif|webp|svg|css|js|pdf|ico)$/i.test(rest))
      return false;
    return true;
  } catch {
    return false;
  }
}

export async function getPostUrlsFromIndex(indexUrl, baseUrl, customRegex) {
  const html = await fetchText(indexUrl);
  const $ = cheerio.load(html);
  const out = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (/^(#|mailto:|tel:|javascript:)/i.test(href.trim())) return;
    let abs;
    try {
      abs = new URL(href, indexUrl).toString();
    } catch {
      return;
    }
    if (isPostUrl(abs, baseUrl, customRegex)) {
      const u = new URL(abs);
      out.add(`${u.origin}${u.pathname.replace(/\/+$/, '')}`);
    }
  });

  return [...out];
}

export async function getPostUrlsFromSitemap(baseUrl, customRegex) {
  const b = new URL(baseUrl);
  const seen = new Set();
  const posts = new Set();

  const candidates = [
    `${b.origin}/sitemap.xml`,
    `${b.origin}/sitemap_index.xml`,
    `${b.origin}/sitemap-index.xml`,
    `${baseUrl.replace(/\/+$/, '')}/sitemap.xml`,
  ];

  async function walk(url, depth = 0) {
    if (depth > 2 || seen.has(url)) return;
    seen.add(url);
    let xml;
    try {
      xml = await fetchText(url);
    } catch {
      return;
    }
    const $ = cheerio.load(xml, { xmlMode: true });

    const sitemapLocs = $('sitemap > loc')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    if (sitemapLocs.length) {
      const matched = sitemapLocs.filter((l) => /post|blog|article/i.test(l));
      const list = matched.length ? matched : sitemapLocs;
      for (const loc of list) await walk(loc, depth + 1);
    }

    const urlLocs = $('url > loc')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    for (const u of urlLocs) {
      if (isPostUrl(u, baseUrl, customRegex)) {
        try {
          const p = new URL(u);
          posts.add(`${p.origin}${p.pathname.replace(/\/+$/, '')}`);
        } catch {}
      }
    }
  }

  for (const c of candidates) {
    await walk(c);
    if (posts.size > 0) break;
  }
  return [...posts];
}

export async function getRssGuidMap(baseUrl) {
  const b = new URL(baseUrl);
  const candidates = [
    `${baseUrl.replace(/\/+$/, '')}/rss.xml`,
    `${b.origin}/rss.xml`,
    `${b.origin}/feed`,
    `${b.origin}/rss`,
  ];
  for (const c of candidates) {
    try {
      const xml = await fetchText(c);
      const $ = cheerio.load(xml, { xmlMode: true });
      const map = {};
      $('item').each((_, el) => {
        const link = $(el).find('link').first().text().trim();
        const guid = $(el).find('guid').first().text().trim();
        if (link) map[link.replace(/\/+$/, '')] = guid || link;
      });
      if (Object.keys(map).length) return map;
    } catch {}
  }
  return {};
}

export async function scrapePost(url, baseUrl, contentSelector) {
  const html = await fetchText(url);
  const $ = cheerio.load(html);

  const headingTitle = $('h1').first().text().trim() || '';
  const pageTitle = $('head title').first().text().trim() || headingTitle;

  let link = $('link[rel="canonical"]').attr('href');
  try {
    link = link ? new URL(link, url).toString() : url;
  } catch {
    link = url;
  }

  const metaDesc = ($('meta[name="description"]').attr('content') || '').trim();

  let pubDateRaw = '';
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[name="publish-date"]',
    'meta[name="pubdate"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]',
  ];
  for (const sel of metaSelectors) {
    const v = $(sel).attr('content');
    if (v) { pubDateRaw = v; break; }
  }
  if (!pubDateRaw) {
    const t =
      $('time[datetime]').first().attr('datetime') ||
      $('time').first().text().trim();
    if (t) pubDateRaw = t;
  }
  if (!pubDateRaw) {
    $('script[type="application/ld+json"]').each((_, el) => {
      if (pubDateRaw) return;
      try {
        const parsed = JSON.parse($(el).text());
        const roots = Array.isArray(parsed) ? parsed : [parsed];
        for (const r of roots) {
          const graph = r && r['@graph'] ? r['@graph'] : [r];
          for (const g of graph) {
            if (g && g.datePublished) { pubDateRaw = g.datePublished; return; }
          }
        }
      } catch {}
    });
  }

  let $content = null;
  if (contentSelector) {
    const el = $(contentSelector).first();
    if (el.length) $content = el;
  }
  if (!$content) {
    const contentSelectors = [
      'article',
      '[itemprop="articleBody"]',
      '.blog-post-content',
      '.post-content',
      '.entry-content',
      '.blog-content',
      '.article-content',
      'main article',
      'main',
    ];
    for (const sel of contentSelectors) {
      const el = $(sel).first();
      if (el.length && el.text().trim().length > 200) { $content = el; break; }
    }
  }
  if (!$content) $content = $('body');

  const $clone = $content.clone();
  $clone.find('script, style, noscript, iframe, form').remove();
  $clone.find('nav, footer, aside, .sidebar, .comments, #comments').remove();

  $clone.find('a[href]').each((_, el) => {
    const h = $(el).attr('href');
    try { $(el).attr('href', new URL(h, url).toString()); } catch {}
  });

  const images = [];
  $content.find('img').each((_, el) => {
    let src =
      $(el).attr('src') ||
      $(el).attr('data-src') ||
      $(el).attr('data-lazy-src') ||
      $(el).attr('data-original');
    if (!src) {
      const ss = $(el).attr('srcset') || $(el).attr('data-srcset');
      if (ss) src = ss.split(',')[0].trim().split(/\s+/)[0];
    }
    if (!src) return;
    try { images.push(new URL(src, url).toString()); } catch {}
  });

  $clone.find('img').each((_, el) => {
    const src =
      $(el).attr('src') ||
      $(el).attr('data-src') ||
      $(el).attr('data-lazy-src') ||
      $(el).attr('data-original');
    if (src) {
      try { $(el).attr('src', new URL(src, url).toString()); } catch {}
    }
    $(el).removeAttr('srcset');
    $(el).removeAttr('data-src');
    $(el).removeAttr('data-lazy-src');
    $(el).removeAttr('data-original');
    $(el).removeAttr('data-srcset');
  });

  const contentHtml = $clone.html() || '';
  const uniqueImages = [...new Set(images)];

  let summary = '';
  const $firstP = $content.find('p').first();
  if ($firstP.length) summary = $firstP.text().replace(/\s+/g, ' ').trim();
  if (!summary)
    summary = $content.text().replace(/\s+/g, ' ').trim().slice(0, 300);

  let featuredImage = $('meta[property="og:image"]').attr('content') || '';
  if (featuredImage) {
    try { featuredImage = new URL(featuredImage, url).toString(); } catch {}
  }
  if (!featuredImage && uniqueImages.length) featuredImage = uniqueImages[0];

  const categories = [];
  const tags = [];
  $('a[href*="/category/"], a[href*="/categories/"]').each((_, el) => {
    const t = $(el).text().trim();
    if (t && !categories.includes(t)) categories.push(t);
  });
  $('a[href*="/tag/"], a[href*="/tags/"]').each((_, el) => {
    const t = $(el).text().trim();
    if (t && !tags.includes(t)) tags.push(t);
  });

  let author = $('meta[name="author"]').attr('content') || '';
  if (!author) {
    const a = $('[rel="author"], .author, .byline, .post-author').first();
    if (a.length) author = a.text().replace(/\s+/g, ' ').trim();
  }

  return {
    headingTitle,
    pageTitle,
    link,
    description: metaDesc || summary.slice(0, 160),
    pubDateRaw,
    summary,
    contentHtml,
    images: uniqueImages,
    featuredImage,
    categories,
    tags,
    author,
  };
}
EOF

# ------------------------------------------------------------------
# lib/csv.js
# ------------------------------------------------------------------
cat > "$ROOT/lib/csv.js" <<'EOF'
import { filenameFor } from './utils';

function esc(v) {
  const s = v == null ? '' : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}

export const CSV_HEADERS = [
  'Heading Title',
  'Page Title',
  'Link',
  'Description',
  'pubDate',
  'guid',
  'Summary',
  'Content',
  'Image URLs',
  'Featured Image',
  'Local Image Paths',
  'Categories',
  'Tags',
  'Author',
];

export function buildImageManifest(posts) {
  const map = new Map();
  const used = new Set();
  for (const p of posts) {
    for (const u of p.images || []) {
      if (!map.has(u)) map.set(u, filenameFor(u, used));
    }
  }
  return map;
}

export function buildCsv(posts, manifest) {
  const lines = [CSV_HEADERS.map(esc).join(',')];
  for (const p of posts) {
    const localPaths = (p.images || [])
      .map((u) => `images/${manifest.get(u) || ''}`)
      .join(' | ');

    const row = {
      'Heading Title': p.headingTitle,
      'Page Title': p.pageTitle,
      Link: p.link,
      Description: p.description,
      pubDate: p.pubDate,
      guid: p.guid,
      Summary: p.summary,
      Content: p.contentHtml,
      'Image URLs': (p.images || []).join(' | '),
      'Featured Image': p.featuredImage,
      'Local Image Paths': localPaths,
      Categories: (p.categories || []).join(', '),
      Tags: (p.tags || []).join(', '),
      Author: p.author,
    };
    lines.push(CSV_HEADERS.map((h) => esc(row[h])).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}
EOF

# ------------------------------------------------------------------
# lib/wxr.js
# ------------------------------------------------------------------
cat > "$ROOT/lib/wxr.js" <<'EOF'
import { slugFromUrl, toRfc822 } from './utils';

function x(s) {
  return String(s ?? '').replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])
  );
}

function cdata(s) {
  return `<![CDATA[${String(s ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

export function buildWxr(posts, baseUrl) {
  const origin = new URL(baseUrl).origin;

  const items = posts
    .map((p) => {
      const cats = [
        ...(p.categories || []).map(
          (c) => `<category domain="category">${cdata(c)}</category>`
        ),
        ...(p.tags || []).map(
          (t) => `<category domain="post_tag">${cdata(t)}</category>`
        ),
      ].join('\n    ');

      const pub = toRfc822(p.pubDateRaw);
      const iso = p.pubDateRaw || new Date().toISOString();

      return `  <item>
    <title>${x(p.headingTitle)}</title>
    <link>${x(p.link)}</link>
    <pubDate>${pub}</pubDate>
    <dc:creator>${cdata(p.author || 'admin')}</dc:creator>
    <guid isPermaLink="false">${x(p.guid || p.link)}</guid>
    <description></description>
    <content:encoded>${cdata(p.contentHtml)}</content:encoded>
    <excerpt:encoded>${cdata(p.summary)}</excerpt:encoded>
    ${cats}
    <wp:post_id>0</wp:post_id>
    <wp:post_date>${cdata(iso)}</wp:post_date>
    <wp:post_date_gmt>${cdata(iso)}</wp:post_date_gmt>
    <wp:comment_status>${cdata('closed')}</wp:comment_status>
    <wp:ping_status>${cdata('closed')}</wp:ping_status>
    <wp:post_name>${cdata(slugFromUrl(p.link))}</wp:post_name>
    <wp:status>${cdata('publish')}</wp:status>
    <wp:post_parent>0</wp:post_parent>
    <wp:menu_order>0</wp:menu_order>
    <wp:post_type>${cdata('post')}</wp:post_type>
    <wp:post_password>${cdata('')}</wp:post_password>
    <wp:is_sticky>0</wp:is_sticky>
  </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wfw="http://wellformedweb.org/CommentAPI/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
  <title>Blog Export</title>
  <link>${x(baseUrl)}</link>
  <description>Migrated blog content</description>
  <pubDate>${new Date().toUTCString()}</pubDate>
  <language>en-US</language>
  <wp:wxr_version>1.2</wp:wxr_version>
  <wp:base_site_url>${x(origin)}</wp:base_site_url>
  <wp:base_blog_url>${x(baseUrl)}</wp:base_blog_url>
${items}
</channel>
</rss>`;
}
EOF

# ------------------------------------------------------------------
# app/layout.js
# ------------------------------------------------------------------
cat > "$ROOT/app/layout.js" <<'EOF'
import './globals.css';

export const metadata = {
  title: 'Blog Migrator',
  description: 'Scrape a blog to CSV + WXR (+ images)',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
EOF

# ------------------------------------------------------------------
# app/globals.css
# ------------------------------------------------------------------
cat > "$ROOT/app/globals.css" <<'EOF'
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: #0b0d12; color: #e6e9ef;
}
.wrap { max-width: 1180px; margin: 0 auto; padding: 32px 20px 80px; }
h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.4px; }
.sub { color: #8b93a7; font-size: 13px; margin-bottom: 24px; }
.card {
  background: #14171f; border: 1px solid #222734;
  border-radius: 12px; padding: 20px; margin-bottom: 16px;
}
label { display: block; font-size: 12px; color: #8b93a7; margin-bottom: 6px; }
input[type=text], input[type=number], select, textarea {
  width: 100%; background: #0b0d12; border: 1px solid #2a3040;
  color: #e6e9ef; padding: 9px 11px; border-radius: 8px;
  font-size: 13px; font-family: inherit; outline: none;
}
input:focus, select:focus, textarea:focus { border-color: #2563eb; }
.grid { display: grid; gap: 14px; }
.g2 { grid-template-columns: 2fr 1fr; }
.g4 { grid-template-columns: repeat(4, 1fr); }
@media (max-width: 720px) { .g2, .g4 { grid-template-columns: 1fr; } }
.row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #c3c9d6; }
button {
  background: #2563eb; color: #fff; border: 0; padding: 10px 18px;
  border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  font-family: inherit;
}
button:disabled { opacity: .45; cursor: not-allowed; }
button.ghost { background: #1c2130; color: #c3c9d6; border: 1px solid #2a3040; }
.bar { height: 6px; background: #1c2130; border-radius: 99px; overflow: hidden; margin-top: 10px; }
.bar > i { display: block; height: 100%; background: #2563eb; transition: width .2s; }
.log {
  background: #0b0d12; border: 1px solid #222734; border-radius: 8px;
  padding: 12px; height: 220px; overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px; line-height: 1.7; color: #9aa4b8; white-space: pre-wrap;
}
table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #222734; }
th { color: #8b93a7; font-weight: 600; }
td { color: #c3c9d6; }
.stat { font-size: 12px; color: #8b93a7; }
.stat b { color: #e6e9ef; font-size: 15px; }
EOF

# ------------------------------------------------------------------
# app/page.js
# ------------------------------------------------------------------
cat > "$ROOT/app/page.js" <<'EOF'
'use client';

import { useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { pMap, formatFriendlyDate } from '@/lib/utils';
import { buildCsv, buildImageManifest } from '@/lib/csv';
import { buildWxr } from '@/lib/wxr';

export default function Home() {
  const [baseUrl, setBaseUrl] = useState(
    'https://www.midtownrichmonddentistry.com/blog'
  );
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(35);
  const [concurrency, setConcurrency] = useState(4);
  const [includeImagesInZip, setIncludeImagesInZip] = useState(true);

  const [discoveryMode, setDiscoveryMode] = useState('auto');
  const [paginationMode, setPaginationMode] = useState('path');
  const [paginationPattern, setPaginationPattern] = useState('/page/{page}');
  const [postRegex, setPostRegex] = useState('');
  const [contentSelector, setContentSelector] = useState('');
  const [manualUrls, setManualUrls] = useState('');

  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [posts, setPosts] = useState([]);
  const [progress, setProgress] = useState({ phase: '', done: 0, total: 0 });
  const [zipProgress, setZipProgress] = useState(null);
  const abortRef = useRef(false);

  const manifest = useMemo(() => buildImageManifest(posts), [posts]);

  function log(msg) {
    setLogs((l) => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function buildPageUrl(root, page) {
    if (page === 1) return root;
    if (paginationPattern.includes('{page}')) {
      return root + paginationPattern.replace('{page}', String(page));
    }
    return `${root}${paginationPattern}${page}`;
  }

  async function run() {
    setRunning(true);
    setPosts([]);
    setLogs([]);
    setZipProgress(null);
    abortRef.current = false;

    try {
      let urls = [];

      if (discoveryMode === 'manual') {
        urls = manualUrls
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        log(`• Manual mode: ${urls.length} URLs loaded.`);
      }

      const wantSitemap =
        discoveryMode === 'auto' || discoveryMode === 'sitemap';
      const wantCrawl =
        discoveryMode === 'auto' || discoveryMode === 'crawl';

      if (!urls.length && wantSitemap) {
        setProgress({ phase: 'Reading sitemap…', done: 0, total: 0 });
        log('→ Fetching sitemap.xml…');
        try {
          const { urls: found } = await post('/api/sitemap', {
            baseUrl,
            postRegex: postRegex || undefined,
          });
          if (found?.length) {
            urls = found;
            log(`✓ Sitemap yielded ${urls.length} post URLs.`);
          } else {
            log('• Sitemap empty — falling back to crawl.');
          }
        } catch (e) {
          log(`• Sitemap failed (${e.message}) — falling back to crawl.`);
        }
      }

      if (!urls.length && wantCrawl) {
        log(`→ Crawling index pages ${startPage}–${endPage}…`);
        const collected = [];
        const root = baseUrl.replace(/\/+$/, '');
        for (let p = startPage; p <= endPage; p++) {
          if (abortRef.current) throw new Error('Aborted by user');
          const pageUrl = buildPageUrl(root, p);
          setProgress({ phase: `Index page ${p}`, done: 0, total: 0 });
          try {
            const { urls: pageUrls } = await post('/api/scrape-index', {
              indexUrl: pageUrl,
              baseUrl,
              postRegex: postRegex || undefined,
            });
            if (!pageUrls?.length) {
              log(`  page ${p}: no posts — stopping.`);
              break;
            }
            for (const u of pageUrls)
              if (!collected.includes(u)) collected.push(u);
            log(`  page ${p}: +${pageUrls.length} (total ${collected.length})`);
          } catch (e) {
            log(`  page ${p}: ${e.message}`);
            break;
          }
        }
        urls = collected;
      }

      urls = [...new Set(urls)];
      if (!urls.length) throw new Error('No post URLs discovered.');
      log(`→ Scraping ${urls.length} posts (concurrency ${concurrency})…`);

      let ok = 0;
      let fail = 0;
      const results = await pMap(
        urls,
        async (u) => {
          if (abortRef.current) throw new Error('Aborted');
          const { post: p } = await post('/api/scrape-post', {
            url: u,
            baseUrl,
            contentSelector: contentSelector || undefined,
          });
          ok++;
          return p;
        },
        concurrency,
        (done, total) => {
          setProgress({ phase: 'Scraping posts', done, total });
          if (done % 10 === 0 || done === total)
            log(`  ${done}/${total} (ok ${ok}, fail ${fail})`);
        }
      );

      const good = [];
      for (const r of results) {
        if (r && !r.error) good.push(r);
        else {
          fail++;
          log(`  ✗ ${r?.url || 'unknown'}: ${r?.error}`);
        }
      }

      let guidMap = {};
      try {
        const { map } = await post('/api/rss', { baseUrl });
        guidMap = map || {};
        log(`✓ RSS guid map: ${Object.keys(guidMap).length} entries.`);
      } catch {
        log('• RSS unavailable — falling back to URL as guid.');
      }

      const enriched = good.map((p) => ({
        ...p,
        guid: guidMap[p.link.replace(/\/+$/, '')] || p.link,
        pubDate: formatFriendlyDate(p.pubDateRaw),
      }));

      setPosts(enriched);
      log(`✓ Done. ${enriched.length} posts ready.`);
    } catch (e) {
      log(`✗ ERROR: ${e.message}`);
    } finally {
      setRunning(false);
      setProgress({ phase: '', done: 0, total: 0 });
    }
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  function downloadCsv() {
    downloadBlob(
      buildCsv(posts, manifest),
      'blog_export.csv',
      'text/csv;charset=utf-8'
    );
  }

  function downloadWxr() {
    downloadBlob(buildWxr(posts, baseUrl), 'blog_export.wxr', 'application/xml');
  }

  async function downloadZip() {
    if (!posts.length) return;
    setZipProgress({ done: 0, total: manifest.size });
    const zip = new JSZip();
    const imgFolder = includeImagesInZip ? zip.folder('images') : null;

    if (includeImagesInZip) {
      let done = 0;
      for (const [url, name] of manifest.entries()) {
        if (abortRef.current) break;
        try {
          const res = await fetch(`/api/image?url=${encodeURIComponent(url)}`);
          if (res.ok) imgFolder.file(name, await res.blob());
        } catch {}
        done++;
        setZipProgress({ done, total: manifest.size });
      }
    }

    zip.file('blog_export.csv', buildCsv(posts, manifest));
    zip.file('blog_export.wxr', buildWxr(posts, baseUrl));

    const blob = await zip.generateAsync({ type: 'blob' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'blog_migration.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
    setZipProgress(null);
  }

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="wrap">
      <h1>Blog Migrator</h1>
      <div className="sub">
        Any blog → CSV + WXR (WordPress) + images · Axios + Cheerio
      </div>

      <div className="card">
        <div className="grid g2">
          <div>
            <label>Blog base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={running}
              placeholder="https://example.com/blog"
            />
          </div>
          <div>
            <label>Concurrency</label>
            <input
              type="number"
              min={1}
              max={10}
              value={concurrency}
              onChange={(e) => setConcurrency(+e.target.value)}
              disabled={running}
            />
          </div>
        </div>

        <div className="grid g4" style={{ marginTop: 14 }}>
          <div>
            <label>Start page</label>
            <input
              type="number"
              min={1}
              value={startPage}
              onChange={(e) => setStartPage(+e.target.value)}
              disabled={running}
            />
          </div>
          <div>
            <label>End page</label>
            <input
              type="number"
              min={1}
              value={endPage}
              onChange={(e) => setEndPage(+e.target.value)}
              disabled={running}
            />
          </div>
          <div>
            <label>ZIP options</label>
            <div className="row" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={includeImagesInZip}
                onChange={(e) => setIncludeImagesInZip(e.target.checked)}
                disabled={running}
              />
              Include images
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <label>Site profile</label>
        <div className="grid g4">
          <div>
            <label style={{ marginTop: 8 }}>Discovery</label>
            <select
              value={discoveryMode}
              onChange={(e) => setDiscoveryMode(e.target.value)}
              disabled={running}
            >
              <option value="auto">Auto (sitemap → crawl)</option>
              <option value="sitemap">Sitemap only</option>
              <option value="crawl">Paginated crawl</option>
              <option value="manual">Manual URL list</option>
            </select>
          </div>
          <div>
            <label style={{ marginTop: 8 }}>Pagination mode</label>
            <select
              value={paginationMode}
              onChange={(e) => {
                const mode = e.target.value;
                setPaginationMode(mode);
                if (mode === 'path') setPaginationPattern('/page/{page}');
                if (mode === 'query') setPaginationPattern('?page={page}');
              }}
              disabled={running || discoveryMode !== 'crawl'}
            >
              <option value="path">Path — /page/{'{page}'}</option>
              <option value="query">Query — ?page={'{page}'}</option>
              <option value="custom">Custom pattern</option>
            </select>
          </div>
          <div>
            <label style={{ marginTop: 8 }}>Pagination pattern</label>
            <input
              type="text"
              value={paginationPattern}
              onChange={(e) => setPaginationPattern(e.target.value)}
              disabled={running || discoveryMode !== 'crawl'}
              placeholder="/page/{page}"
            />
          </div>
          <div>
            <label style={{ marginTop: 8 }}>Content selector</label>
            <input
              type="text"
              value={contentSelector}
              onChange={(e) => setContentSelector(e.target.value)}
              disabled={running}
              placeholder="article, .post-content"
            />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label>Post URL regex (optional — blank = auto)</label>
          <input
            type="text"
            value={postRegex}
            onChange={(e) => setPostRegex(e.target.value)}
            disabled={running}
            placeholder="^/blog/[a-z0-9-]+/?$"
          />
        </div>

        {discoveryMode === 'manual' && (
          <div style={{ marginTop: 14 }}>
            <label>Manual URLs (one per line)</label>
            <textarea
              value={manualUrls}
              onChange={(e) => setManualUrls(e.target.value)}
              disabled={running}
              rows={6}
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            />
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={run} disabled={running}>
            {running ? 'Working…' : 'Start migration'}
          </button>
          <button
            className="ghost"
            onClick={() => (abortRef.current = true)}
            disabled={!running}
          >
            Abort
          </button>
        </div>

        {progress.phase && (
          <>
            <div className="stat" style={{ marginTop: 14 }}>
              {progress.phase}
              {progress.total > 0 && ` — ${progress.done}/${progress.total}`}
            </div>
            <div className="bar">
              <i style={{ width: `${pct}%` }} />
            </div>
          </>
        )}
      </div>

      {(logs.length > 0 || running) && (
        <div className="card">
          <label>Log</label>
          <div className="log">{logs.join('\n')}</div>
        </div>
      )}

      {posts.length > 0 && (
        <div className="card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <div className="stat">
              <b>{posts.length}</b> posts · <b>{manifest.size}</b> unique images
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="ghost" onClick={downloadCsv}>CSV</button>
              <button className="ghost" onClick={downloadWxr}>WXR</button>
              <button onClick={downloadZip} disabled={!!zipProgress}>
                {zipProgress
                  ? `Zipping ${zipProgress.done}/${zipProgress.total}…`
                  : 'Download ZIP'}
              </button>
            </div>
          </div>

          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Heading Title</th>
                  <th>pubDate</th>
                  <th>Images</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {posts.slice(0, 300).map((p, i) => (
                  <tr key={i}>
                    <td>{p.headingTitle}</td>
                    <td>{p.pubDate}</td>
                    <td>{p.images?.length || 0}</td>
                    <td>
                      <a
                        href={p.link}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#60a5fa' }}
                      >
                        {p.link.replace(/^https?:\/\/[^/]+/, '')}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {posts.length > 300 && (
              <div className="stat" style={{ padding: 10 }}>
                Showing first 300 of {posts.length}. All rows are in the CSV/ZIP.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
EOF

# ------------------------------------------------------------------
# app/api/sitemap/route.js
# ------------------------------------------------------------------
cat > "$ROOT/app/api/sitemap/route.js" <<'EOF'
import { NextResponse } from 'next/server';
import { getPostUrlsFromSitemap } from '@/lib/scraper';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const { baseUrl, postRegex } = await req.json();
    const urls = await getPostUrlsFromSitemap(baseUrl, postRegex);
    return NextResponse.json({ urls });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
EOF

# ------------------------------------------------------------------
# app/api/rss/route.js
# ------------------------------------------------------------------
cat > "$ROOT/app/api/rss/route.js" <<'EOF'
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
EOF

# ------------------------------------------------------------------
# app/api/scrape-index/route.js
# ------------------------------------------------------------------
cat > "$ROOT/app/api/scrape-index/route.js" <<'EOF'
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
EOF

# ------------------------------------------------------------------
# app/api/scrape-post/route.js
# ------------------------------------------------------------------
cat > "$ROOT/app/api/scrape-post/route.js" <<'EOF'
import { NextResponse } from 'next/server';
import { scrapePost } from '@/lib/scraper';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const { url, baseUrl, contentSelector } = await req.json();
    const post = await scrapePost(url, baseUrl, contentSelector);
    return NextResponse.json({ post });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
EOF

# ------------------------------------------------------------------
# app/api/image/route.js
# ------------------------------------------------------------------
cat > "$ROOT/app/api/image/route.js" <<'EOF'
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
EOF

# ------------------------------------------------------------------
# README.md
# ------------------------------------------------------------------
cat > "$ROOT/README.md" <<'EOF'
# Blog Migrator

Scrape any blog → CSV + WordPress WXR + images, powered by Next.js,
Axios, and Cheerio. Deployable to Vercel.

## Quick start

    npm install
    npm run dev
    # http://localhost:3000

## Deploy

    vercel --prod

Or push to GitHub and import at https://vercel.com/new.

## Column layout (CSV)

- Heading Title
- Page Title
- Link
- Description
- pubDate           (Month DD, YYYY)
- guid              (RSS guid if available, else canonical URL)
- Summary           (plain text)
- Content           (full HTML)
- Image URLs        (remote, pipe-separated)
- Featured Image
- Local Image Paths (images/<filename>, pipe-separated — matches ZIP)
- Categories
- Tags
- Author

## Site profile options

- Discovery: Auto (sitemap → crawl), Sitemap only, Crawl only, Manual URLs
- Pagination: Path /page/{page}, Query ?page={page}, or custom pattern
- Post URL regex: override auto-detection
- Content selector: CSS selector if auto-detection picks the wrong element

## Known caveats

- JS-rendered SPAs (empty HTML in view-source) need Puppeteer instead.
- Login-gated blogs: add cookies to DEFAULT_HEADERS in lib/scraper.js.
- Cloudflare "Under Attack" will 403 Vercel IPs. Run locally instead.
- Vercel Hobby timeouts: keep concurrency ≤ 4.
- Large ZIPs (300+ posts with images) may take minutes to build in-browser.

## License

Use only on sites you own or have written permission to migrate.
EOF

# ------------------------------------------------------------------
# Zip it
# ------------------------------------------------------------------
zip -r -q "$ROOT.zip" "$ROOT" -x "*/node_modules/*" "*/.next/*" "*/.git/*"

echo ""
echo "✓ Built $ROOT.zip"
echo ""
echo "Next steps:"
echo "  unzip $ROOT.zip"
echo "  cd $ROOT"
echo "  npm install"
echo "  npm run dev"
echo ""
echo "Deploy:"
echo "  vercel --prod"