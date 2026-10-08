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

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
};

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