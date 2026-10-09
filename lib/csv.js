import { filenameFor } from './utils';

function esc(v) {
  const s = v == null ? '' : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}

const CSV_HEADERS = [
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
  const map = {};
  const used = [];
  for (const p of posts) {
    for (const u of p.images || []) {
      if (!map[u]) {
        map[u] = filenameFor(u, used);
      }
    }
  }
  return map;
}

export function buildCsv(posts, manifest) {
  const lines = [CSV_HEADERS.map(esc).join(',')];
  for (const p of posts) {
    const localPaths = (p.images || [])
      .map((u) => 'images/' + (manifest[u] || ''))
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