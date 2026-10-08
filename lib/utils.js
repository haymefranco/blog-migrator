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

  // Try native parse first (handles ISO, RFC 822, most common formats)
  let d = new Date(raw);

  // If native parse failed, try a few explicit patterns
  if (isNaN(d)) {
    const patterns = [
      // MM/DD/YYYY or M/D/YYYY
      { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, fn: (m) => [m[3], m[1], m[2]] },
      // YYYY-MM-DD
      { re: /^(\d{4})-(\d{1,2})-(\d{1,2})/, fn: (m) => [m[1], m[2], m[3]] },
      // Month DD, YYYY (e.g. "October 8, 2026")
      { re: /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/, fn: (m) => [m[3], m[1], m[2]] },
      // DD Month YYYY (e.g. "8 October 2026")
      { re: /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/, fn: (m) => [m[3], m[2], m[1]] },
    ];
    for (const { re, fn } of patterns) {
      const m = raw.trim().match(re);
      if (m) {
        const [y, mo, day] = fn(m);
        const parsed = new Date(`${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`);
        if (!isNaN(parsed)) { d = parsed; break; }
      }
    }
  }

  if (isNaN(d)) return '';   // give up cleanly instead of dumping garbage

  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  return `${mm}/${dd}/${yyyy}`;
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
