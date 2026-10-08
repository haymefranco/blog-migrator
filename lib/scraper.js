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

  // Prefer the site's dedicated post-title element.
// The selector list is tried in order; first match wins.
const TITLE_SELECTORS = [
  '.blog__post-title',
  'h1.blog__post-title',
  '[class*="post-title"]',
  'h1.entry-title',
  'h1.post-title',
  'article h1',
  'h1',
];

let rawTitle = '';
for (const sel of TITLE_SELECTORS) {
  const el = $(sel).first();
  if (el.length) {
    const t = el.text().replace(/\s+/g, ' ').trim();
    if (t) { rawTitle = t; break; }
  }
}
if (!rawTitle) {
  rawTitle = $('head title').first().text().trim();
}

const headingTitle = rawTitle;
const pageTitle = rawTitle;

  let link = $('link[rel="canonical"]').attr('href');
  try {
    link = link ? new URL(link, url).toString() : url;
  } catch {
    link = url;
  }

  const metaDesc = ($('meta[name="description"]').attr('content') || '').trim();

  let pubDateRaw = '';

// 1. Prefer the site's dedicated creation-date element
const DATE_SELECTORS = [
  '.blog__post-creation-date',
  '[class*="post-creation-date"]',
  '[class*="post-date"]',
  '[class*="published"]',
  'time[datetime]',
  'time',
];

for (const sel of DATE_SELECTORS) {
  const el = $(sel).first();
  if (!el.length) continue;

  // Prefer machine-readable datetime attr
  const dt = el.attr('datetime');
  const raw = (dt || el.text() || '').trim();

  // Strip common prefixes like "Posted on", "Published:", etc.
  const cleaned = raw
    .replace(/^\s*(posted|published|created|date)\s*(on|:)?\s*/i, '')
    .trim();

  if (cleaned) { pubDateRaw = cleaned; break; }
}

// 2. Fall back to <meta> tags
if (!pubDateRaw) {
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
}

// 3. Fall back to JSON-LD
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
      '.blog__post-content',
      '[class*="post-content"]',
      '[class*="post__content"]',
      '[class*="post-body"]',
      '[class*="entry-content"]',
      'article [itemprop="articleBody"]',
      '[itemprop="articleBody"]',
      'article',
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

// --- strip non-content elements ---
$clone
  .find(
    [
      'script',
      'style',
      'noscript',
      'iframe',
      'form',
      'nav',
      'footer',
      'aside',
      '.sidebar',
      '.comments',
      '#comments',
      '.blog__post-share',
      '.blog__post-tags',
      '.blog__post-nav',
      '.blog__post-meta',
      '.social-share',
      '.related-posts',
      '.newsletter',
      '.advertisement',
      '.ad',
    ].join(',')
  )
  .remove();
  $clone.find('*').removeAttr('class');

// --- strip tracking pixels and 1x1 images ---
$clone.find('img').each((_, el) => {
  const w = parseInt($(el).attr('width') || '0', 10);
  const h = parseInt($(el).attr('height') || '0', 10);
  const src = $(el).attr('src') || '';
  if ((w && w <= 2) || (h && h <= 2)) $(el).remove();
  else if (/pixel|tracker|analytics|beacon/i.test(src)) $(el).remove();
});

// --- remove empty paragraphs / divs ---
$clone.find('p, div').each((_, el) => {
  const $el = $(el);
  if ($el.children().length === 0 && !$el.text().trim() && !$el.find('img').length) {
    $el.remove();
  }
});

// --- absolutize links ---
$clone.find('a[href]').each((_, el) => {
  const h = $(el).attr('href');
  if (!h) return;
  try { $(el).attr('href', new URL(h, url).toString()); } catch {}
});

// --- collect image URLs before rewriting ---
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

// --- rewrite images to absolute + drop lazy-load attrs ---
$clone.find('img').each((_, el) => {
  const $img = $(el);
  const src =
    $img.attr('src') ||
    $img.attr('data-src') ||
    $img.attr('data-lazy-src') ||
    $img.attr('data-original');
  if (src) {
    try { $img.attr('src', new URL(src, url).toString()); } catch {}
  }
  // Webflow-friendly: keep alt, drop everything else lazy-related
  $img.removeAttr('srcset');
  $img.removeAttr('sizes');
  $img.removeAttr('loading');
  $img.removeAttr('data-src');
  $img.removeAttr('data-lazy-src');
  $img.removeAttr('data-original');
  $img.removeAttr('data-srcset');
  // Ensure alt exists (accessibility + Webflow prefers it)
  if (!$img.attr('alt')) $img.attr('alt', '');
});

const contentHtml = $clone.html() || '';
const uniqueImages = [...new Set(images)];

// --- plain text version (still used for Summary fallback only) ---
const $textClone = $clone.clone();
$textClone.find('br').replaceWith('\n');
$textClone
  .find('p, div, h1, h2, h3, h4, h5, h6, li, blockquote, tr, section, article')
  .each((_, el) => { $(el).append('\n\n'); });
const contentText = $textClone
  .text()
  .replace(/\u00a0/g, ' ')
  .replace(/[ \t]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

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
    contentText,          // <-- new
    images: uniqueImages,
    featuredImage,
    categories,
    tags,
    author,
  };
}
