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
  const pageTitle = headingTitle;

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

// --- plain text version for CSV ---
const $textClone = $clone.clone();
$textClone.find('br').replaceWith('\n');
$textClone
  .find('p, div, h1, h2, h3, h4, h5, h6, li, blockquote, tr, section, article')
  .each((_, el) => {
    $(el).append('\n\n');
  });
const contentText = $textClone
  .text()
  .replace(/\u00a0/g, ' ')       // non-breaking spaces → normal
  .replace(/[ \t]+/g, ' ')       // collapse horizontal whitespace
  .replace(/ *\n */g, '\n')      // trim around newlines
  .replace(/\n{3,}/g, '\n\n')    // max one blank line between blocks
  .trim();

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
    contentText,          // <-- new
    images: uniqueImages,
    featuredImage,
    categories,
    tags,
    author,
  };
}
