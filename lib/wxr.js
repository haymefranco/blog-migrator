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
