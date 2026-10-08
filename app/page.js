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
  const [useSitemap, setUseSitemap] = useState(true);
  const [includeImagesInZip, setIncludeImagesInZip] = useState(true);

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

  async function run() {
    setRunning(true);
    setPosts([]);
    setLogs([]);
    setZipProgress(null);
    abortRef.current = false;

    try {
      /* ---------- 1. discover post URLs ---------- */
      let urls = [];

      if (useSitemap) {
        setProgress({ phase: 'Reading sitemap…', done: 0, total: 0 });
        log('→ Fetching sitemap.xml…');
        try {
          const { urls: found } = await post('/api/sitemap', { baseUrl });
          if (found?.length) {
            urls = found;
            log(`✓ Sitemap yielded ${urls.length} post URLs.`);
          } else {
            log('• Sitemap empty — falling back to paginated crawl.');
          }
        } catch (e) {
          log(`• Sitemap failed (${e.message}) — falling back to crawl.`);
        }
      }

      if (!urls.length) {
        log(`→ Crawling index pages ${startPage}–${endPage}…`);
        const collected = [];
        const root = baseUrl.replace(/\/+$/, '');
        for (let p = startPage; p <= endPage; p++) {
          if (abortRef.current) throw new Error('Aborted by user');
          const pageUrl = p === 1 ? root : `${root}/page/${p}`;
          setProgress({ phase: `Index page ${p}`, done: 0, total: 0 });
          try {
            const { urls: pageUrls } = await post('/api/scrape-index', {
              indexUrl: pageUrl,
              baseUrl,
            });
            if (!pageUrls?.length) {
              log(`  page ${p}: no posts — stopping.`);
              break;
            }
            for (const u of pageUrls) if (!collected.includes(u)) collected.push(u);
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

      /* ---------- 2. scrape each post ---------- */
      let ok = 0;
      let fail = 0;
      const results = await pMap(
        urls,
        async (u) => {
          if (abortRef.current) throw new Error('Aborted');
          const { post: p } = await post('/api/scrape-post', { url: u, baseUrl });
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
        else { fail++; log(`  ✗ ${r?.url || 'unknown'}: ${r?.error}`); }
      }

      /* ---------- 3. RSS guid map ---------- */
      let guidMap = {};
      try {
        const { map } = await post('/api/rss', { baseUrl });
        guidMap = map || {};
        log(`✓ RSS guid map: ${Object.keys(guidMap).length} entries.`);
      } catch {
        log('• RSS unavailable — falling back to URL as guid.');
      }

      /* ---------- 4. enrich + store ---------- */
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

  /* ---------- downloads ---------- */
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
    downloadBlob(buildCsv(posts, manifest), 'blog_export.csv', 'text/csv;charset=utf-8');
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
        OctoberCMS → CSV + WXR (WordPress) + images · powered by Axios + Cheerio
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
            <label>Discovery</label>
            <div className="row" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={useSitemap}
                onChange={(e) => setUseSitemap(e.target.checked)}
                disabled={running}
              />
              Prefer sitemap.xml
            </div>
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

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
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
                  : 'Download ZIP (CSV + WXR + images)'}
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