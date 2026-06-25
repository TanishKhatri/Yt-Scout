'use strict';

/* ── CONSTANTS ────────────────────────────────────────────────────────── */
const YT = 'https://www.googleapis.com/youtube/v3';

const CATEGORIES = {
  '1':'Film & Animation', '2':'Autos & Vehicles', '10':'Music',
  '15':'Pets & Animals',  '17':'Sports',           '18':'Short Movies',
  '19':'Travel & Events', '20':'Gaming',           '21':'Videoblogging',
  '22':'People & Blogs',  '23':'Comedy',           '24':'Entertainment',
  '25':'News & Politics', '26':'Howto & Style',    '27':'Education',
  '28':'Science & Technology', '29':'Nonprofits & Activism'
};

/* ── STATE ────────────────────────────────────────────────────────────── */
let apiKey = '';
let currentResults = [];
let isSearching = false;

/* ── INIT ─────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // Restore saved API key
  try {
    const stored = await chrome.storage.local.get('yt_api_key');
    if (stored.yt_api_key) {
      apiKey = stored.yt_api_key;
      document.getElementById('api-key-input').value = apiKey;
      setKeyStatus('✓ API key loaded', 'ok');
    } else {
      // Open settings automatically if no key set
      document.getElementById('settings-panel').classList.add('open');
    }
  } catch (e) {
    // Storage not available in some contexts
  }

  // Wire up controls
  document.getElementById('settings-toggle').addEventListener('click', () =>
    document.getElementById('settings-panel').classList.toggle('open'));

  document.getElementById('show-hide-btn').addEventListener('click', toggleKeyVisibility);
  document.getElementById('save-key-btn').addEventListener('click', saveApiKey);
  document.getElementById('clear-key-btn').addEventListener('click', clearApiKey);
  document.getElementById('search-btn').addEventListener('click', handleSearch);
  document.getElementById('export-btn').addEventListener('click', doExport);
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSearch();
  });
});

/* ── SETTINGS ─────────────────────────────────────────────────────────── */
function toggleKeyVisibility() {
  const input = document.getElementById('api-key-input');
  const btn   = document.getElementById('show-hide-btn');
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.textContent = isHidden ? '🙈' : '👁';
}

async function saveApiKey() {
  const val = document.getElementById('api-key-input').value.trim();
  if (!val) { setKeyStatus('⚠ Enter a key first', 'error'); return; }
  apiKey = val;
  try {
    await chrome.storage.local.set({ yt_api_key: val });
    setKeyStatus('✓ Saved successfully', 'ok');
  } catch (e) {
    apiKey = val; // still use in-memory
    setKeyStatus('✓ Key set (storage unavailable — resets on close)', 'ok');
  }
}

async function clearApiKey() {
  apiKey = '';
  document.getElementById('api-key-input').value = '';
  try { await chrome.storage.local.remove('yt_api_key'); } catch (e) {}
  setKeyStatus('Key cleared', '');
}

function setKeyStatus(msg, type) {
  const el = document.getElementById('key-status');
  el.textContent = msg;
  el.className = 'key-status ' + type;
}

/* ── SEARCH ───────────────────────────────────────────────────────────── */
async function handleSearch() {
  if (isSearching) return;
  const query = document.getElementById('search-input').value.trim();
  const count = parseInt(document.getElementById('result-count').value, 10);

  if (!apiKey) {
    showError('Open ⚙ Settings and save your YouTube API key first.');
    document.getElementById('settings-panel').classList.add('open');
    return;
  }
  if (!query) {
    showError('Enter a keyword to search.');
    return;
  }

  isSearching = true;
  document.getElementById('search-btn').disabled = true;
  showLoading(query);

  try {
    const results = await fetchResults(query, count);
    currentResults = results;
    renderResults(results, query);
  } catch (err) {
    showError(err.message);
  } finally {
    isSearching = false;
    document.getElementById('search-btn').disabled = false;
  }
}

/* ── API CALLS ────────────────────────────────────────────────────────── */
async function ytFetch(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${YT}/${path}${sep}key=${apiKey}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.error) throw new Error(`YouTube API: ${data.error.message}`);
  return data;
}

async function fetchResults(query, count) {
  // 1. Search for videos
  const searchData = await ytFetch(
    `search?part=snippet&q=${encodeURIComponent(query)}&maxResults=${count}&type=video&order=relevance&safeSearch=none`
  );

  if (!searchData.items?.length) throw new Error('No results found for that keyword.');

  const videoIds   = searchData.items.map(i => i.id.videoId);
  const channelIds = [...new Set(searchData.items.map(i => i.snippet.channelId))];

  // 2. Fetch video details + channel details in parallel
  const [videoData, channelData] = await Promise.all([
    ytFetch(`videos?part=snippet,statistics,contentDetails&id=${videoIds.join(',')}`),
    ytFetch(`channels?part=snippet,statistics&id=${channelIds.join(',')}`)
  ]);

  // Build lookup maps
  const videoMap   = Object.fromEntries(videoData.items.map(v => [v.id, v]));
  const channelMap = Object.fromEntries(channelData.items.map(c => [c.id, c]));

  // Merge in search-rank order, skip any missing
  return searchData.items
    .map(item => ({
      video:   videoMap[item.id.videoId],
      channel: channelMap[item.snippet.channelId] || null
    }))
    .filter(r => r.video);
}

/* ── HELPERS ──────────────────────────────────────────────────────────── */
function fmtNum(n) {
  if (n == null || n === '') return '—';
  const x = parseInt(n, 10);
  if (isNaN(x)) return '—';
  if (x >= 1e9) return (x / 1e9).toFixed(1) + 'B';
  if (x >= 1e6) return (x / 1e6).toFixed(1) + 'M';
  if (x >= 1e3) return (x / 1e3).toFixed(1) + 'K';
  return x.toLocaleString();
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

function parseDur(iso) {
  if (!iso) return '—';
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return iso;
  const h = +(m[1] || 0), min = +(m[2] || 0), s = +(m[3] || 0);
  return h
    ? `${h}:${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${min}:${String(s).padStart(2,'0')}`;
}

function calcEngagement(stats) {
  const v = +(stats.viewCount    || 0);
  const l = +(stats.likeCount    || 0);
  const c = +(stats.commentCount || 0);
  if (!v) return 0;
  return (l + c) / v * 100;
}

function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── RENDER: STATES ───────────────────────────────────────────────────── */
function showLoading(query) {
  document.getElementById('results-header').textContent = '';
  document.getElementById('export-btn').classList.remove('visible');
  document.getElementById('results-container').innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <span>Fetching results for "<strong>${escHtml(query)}</strong>"…</span>
    </div>`;
}

function showError(msg) {
  document.getElementById('results-header').textContent = '';
  document.getElementById('export-btn').classList.remove('visible');
  document.getElementById('results-container').innerHTML = `
    <div class="error-msg">
      <span class="err-icon">⚠</span>
      <span>${escHtml(msg)}</span>
    </div>`;
}

/* ── RENDER: RESULTS ──────────────────────────────────────────────────── */
function renderResults(results, query) {
  const count = results.length;
  document.getElementById('results-header').textContent =
    `${count} result${count !== 1 ? 's' : ''} · "${query}"`;
  document.getElementById('export-btn').classList.add('visible');

  // Build HTML
  const container = document.getElementById('results-container');
  container.innerHTML = results.map((r, i) => buildCard(r, i)).join('');

  // Apply dynamic styles (bypasses inline-style CSP concerns)
  results.forEach(({ video }, i) => {
    const vst = video.statistics || {};
    const eng      = calcEngagement(vst);
    const engFill  = Math.min(eng * 10, 100);
    const engColor = eng >= 4 ? '#22D37C' : eng >= 1.5 ? '#F59E0B' : '#FF6060';

    const fill = document.getElementById(`ef-${i}`);
    const pct  = document.getElementById(`ep-${i}`);
    if (fill) { fill.style.width = `${engFill}%`; fill.style.background = engColor; }
    if (pct)  { pct.style.color = engColor; }
  });

  // Accordion toggles
  container.querySelectorAll('[data-expand]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.expand);
      if (!target) return;
      const isOpen = target.classList.toggle('open');
      btn.querySelector('.chevron').textContent = isOpen ? '▲' : '▼';
    });
  });

  // Copy-tags buttons
  container.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copy).then(() => {
        btn.textContent = '✓ Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy all tags';
          btn.classList.remove('copied');
        }, 1600);
      });
    });
  });
}

/* ── RENDER: CARD ─────────────────────────────────────────────────────── */
function buildCard({ video, channel }, idx) {
  const vs  = video.snippet          || {};
  const vst = video.statistics       || {};
  const vcd = video.contentDetails   || {};
  const cs  = channel?.snippet       || {};
  const cst = channel?.statistics    || {};

  const tags        = vs.tags || [];
  const tagHtml     = tags.length
    ? tags.slice(0, 30).map(t => `<span class="tag">${escHtml(t)}</span>`).join('')
    : '<span class="no-data">No tags set on this video</span>';
  const tagsStr     = tags.join(', ');

  const thumb       = vs.thumbnails?.medium?.url
                   || vs.thumbnails?.high?.url
                   || vs.thumbnails?.default?.url || '';
  const category    = CATEGORIES[vs.categoryId] || (vs.categoryId ? `Cat. ${vs.categoryId}` : '—');
  const lang        = vs.defaultAudioLanguage || vs.defaultLanguage || '—';
  const definition  = (vcd.definition || '').toUpperCase() || '—';
  const captions    = vcd.caption === 'true' ? 'Yes' : 'No';

  const vsId = `vs-${idx}`;  // video section accordion
  const csId = `cs-${idx}`;  // channel section accordion

  const likeVal = vst.likeCount != null ? fmtNum(vst.likeCount) : '<span style="font-size:10px;color:var(--text3)">Hidden</span>';

  return `
<div class="card">
  <div class="card-top">

    <!-- Thumbnail -->
    <a class="thumb-wrap" href="https://youtube.com/watch?v=${video.id}" target="_blank" title="Open on YouTube">
      ${thumb
        ? `<img class="thumb" src="${escHtml(thumb)}" alt="" loading="lazy">`
        : '<div class="thumb" style="background:var(--bg4)"></div>'}
      <span class="card-rank">${idx + 1}</span>
      <span class="dur-badge">${parseDur(vcd.duration)}</span>
    </a>

    <!-- Info -->
    <div class="card-body">
      <a class="vtitle" href="https://youtube.com/watch?v=${video.id}" target="_blank">${escHtml(vs.title)}</a>
      <div class="vsubtitle">
        <a href="https://youtube.com/channel/${vs.channelId}" target="_blank" class="ch-link">${escHtml(vs.channelTitle)}</a>
        <span class="dot">·</span>
        <span>${fmtDate(vs.publishedAt)}</span>
        <span class="dot">·</span>
        <span class="cat-badge">${escHtml(category)}</span>
      </div>

      <!-- Stats row -->
      <div class="stats-row">
        <div class="stat">
          <span class="stat-val views-color">${fmtNum(vst.viewCount)}</span>
          <span class="stat-lbl">Views</span>
        </div>
        <div class="stat">
          <span class="stat-val likes-color">${likeVal}</span>
          <span class="stat-lbl">Likes</span>
        </div>
        <div class="stat">
          <span class="stat-val comments-color">${fmtNum(vst.commentCount)}</span>
          <span class="stat-lbl">Comments</span>
        </div>
        <div class="stat">
          <span class="stat-val subs-color">${fmtNum(cst.subscriberCount)}</span>
          <span class="stat-lbl">Subs</span>
        </div>
      </div>

      <!-- Engagement bar -->
      <div class="eng-row">
        <span class="eng-lbl">Engagement</span>
        <div class="eng-track"><div class="eng-fill" id="ef-${idx}"></div></div>
        <span class="eng-pct" id="ep-${idx}">—</span>
      </div>
    </div>
  </div>

  <!-- ── VIDEO DETAILS ACCORDION ──────────────────────── -->
  <div class="accordion">
    <button class="acc-toggle" data-expand="${vsId}">
      <span class="label"><span class="acc-icon">🎬</span> Video Details &amp; Tags</span>
      <span class="chevron">▼</span>
    </button>
    <div class="acc-body" id="${vsId}">
      <div class="detail-grid">
        <div class="d-item"><span class="d-lbl">Duration</span><span class="d-val">${parseDur(vcd.duration)}</span></div>
        <div class="d-item"><span class="d-lbl">Category</span><span class="d-val">${escHtml(category)}</span></div>
        <div class="d-item"><span class="d-lbl">Definition</span><span class="d-val">${definition}</span></div>
        <div class="d-item"><span class="d-lbl">Captions</span><span class="d-val">${captions}</span></div>
        <div class="d-item"><span class="d-lbl">Language</span><span class="d-val">${escHtml(lang)}</span></div>
        <div class="d-item"><span class="d-lbl">Video ID</span><span class="d-val mono">${escHtml(video.id)}</span></div>
      </div>

      ${vs.description ? `
      <div class="desc-block">
        <span class="d-lbl">Description</span>
        <div class="desc-text">${escHtml(vs.description.slice(0, 500))}${vs.description.length > 500 ? '\n…' : ''}</div>
      </div>` : ''}

      <div class="tags-block">
        <div class="tags-hdr">
          <span class="d-lbl">Tags <span class="tag-count">(${tags.length})</span></span>
          ${tags.length ? `<button class="copy-btn" data-copy="${escHtml(tagsStr)}">Copy all tags</button>` : ''}
        </div>
        <div class="tags-list">${tagHtml}</div>
      </div>
    </div>
  </div>

  <!-- ── CHANNEL ANALYTICS ACCORDION ─────────────────── -->
  <div class="accordion">
    <button class="acc-toggle" data-expand="${csId}">
      <span class="label"><span class="acc-icon">📊</span> Channel Analytics</span>
      <span class="chevron">▼</span>
    </button>
    <div class="acc-body" id="${csId}">
      ${channel ? `
      <div class="ch-profile">
        ${cs.thumbnails?.default?.url
          ? `<img class="ch-avatar" src="${escHtml(cs.thumbnails.default.url)}" alt="">`
          : '<div class="ch-avatar" style="background:var(--bg4)"></div>'}
        <div>
          <a href="https://youtube.com/channel/${channel.id}" target="_blank" class="ch-name">${escHtml(cs.title || '—')}</a>
          <div class="ch-meta">
            ${cs.country ? `<span>📍 ${escHtml(cs.country)}</span><span>·</span>` : ''}
            <span>Since ${fmtDate(cs.publishedAt)}</span>
          </div>
        </div>
      </div>
      <div class="detail-grid">
        <div class="d-item"><span class="d-lbl">Subscribers</span><span class="d-val subs-color">${fmtNum(cst.subscriberCount)}</span></div>
        <div class="d-item"><span class="d-lbl">Total Views</span><span class="d-val subs-color">${fmtNum(cst.viewCount)}</span></div>
        <div class="d-item"><span class="d-lbl">Videos</span><span class="d-val">${fmtNum(cst.videoCount)}</span></div>
        <div class="d-item"><span class="d-lbl">Channel Since</span><span class="d-val">${fmtDate(cs.publishedAt)}</span></div>
        <div class="d-item"><span class="d-lbl">Country</span><span class="d-val">${escHtml(cs.country || '—')}</span></div>
        <div class="d-item"><span class="d-lbl">Channel ID</span><span class="d-val mono">${escHtml(channel.id)}</span></div>
      </div>
      ${cs.description ? `
      <div class="desc-block">
        <span class="d-lbl">Channel Description</span>
        <div class="desc-text">${escHtml(cs.description.slice(0, 350))}${cs.description.length > 350 ? '\n…' : ''}</div>
      </div>` : ''}
      ` : '<p class="no-data" style="padding:12px 0">Channel data unavailable</p>'}
    </div>
  </div>
</div>`;
}

/* ── CSV EXPORT ───────────────────────────────────────────────────────── */
function doExport() {
  if (!currentResults.length) return;

  const esc = v => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

  const headers = [
    'Rank', 'Video Title', 'Video ID', 'Video URL',
    'Published Date', 'Duration', 'Category', 'Language', 'Definition', 'Captions',
    'Views', 'Likes', 'Comments', 'Engagement %',
    'Tags (semicolon-separated)', 'Tag Count',
    'Description (first 400 chars)',
    'Channel Name', 'Channel ID', 'Channel URL', 'Channel Country', 'Channel Since',
    'Channel Subscribers', 'Channel Total Views', 'Channel Video Count'
  ];

  const rows = currentResults.map(({ video, channel }, i) => {
    const vs  = video.snippet          || {};
    const vst = video.statistics       || {};
    const vcd = video.contentDetails   || {};
    const cs  = channel?.snippet       || {};
    const cst = channel?.statistics    || {};
    const tags = vs.tags || [];
    const eng  = calcEngagement(vst);
    const lang = vs.defaultAudioLanguage || vs.defaultLanguage || '';

    return [
      i + 1,
      esc(vs.title),
      video.id,
      `https://youtube.com/watch?v=${video.id}`,
      vs.publishedAt || '',
      parseDur(vcd.duration),
      esc(CATEGORIES[vs.categoryId] || vs.categoryId || ''),
      esc(lang),
      (vcd.definition || '').toUpperCase(),
      vcd.caption || '',
      vst.viewCount    || '',
      vst.likeCount    || '',
      vst.commentCount || '',
      eng.toFixed(2),
      esc(tags.join('; ')),
      tags.length,
      esc((vs.description || '').slice(0, 400)),
      esc(cs.title),
      channel?.id || '',
      channel ? `https://youtube.com/channel/${channel.id}` : '',
      esc(cs.country || ''),
      cs.publishedAt || '',
      cst.subscriberCount || '',
      cst.viewCount       || '',
      cst.videoCount      || ''
    ].join(',');
  });

  const csv  = [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const ts   = new Date().toISOString().slice(0, 10);

  const a = document.createElement('a');
  a.href     = url;
  a.download = `yt-keyword-scout-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}