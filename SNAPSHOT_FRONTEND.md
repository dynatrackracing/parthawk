# DARKHAWK FRONTEND — 2026-04-01

## FILE: service/public/attack-list.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0a0a0a">
<meta name="mobile-web-app-capable" content="yes">
<link rel="manifest" href="/admin/manifest.json">
<link rel="apple-touch-icon" href="/admin/icon-192.png">
<title>DarkHawk — DAILY FEED</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0a; --surface: #141414; --surface2: #1a1a1a;
    --border: #2a2a2a; --red: #DC2626; --red-dim: #7f1d1d;
    --yellow: #eab308; --yellow-dim: #713f12; --green: #22c55e;
    --gray: #9ca3af; --text: #F0F0F0; --text-mid: #d1d5db;
    --text-muted: #9CA3AF; --text-faint: #6B7280;
    --font: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
  }
  body { font-family: var(--font); background: var(--bg); color: var(--text); min-height: 100vh; -webkit-tap-highlight-color: transparent; }

  /* Header */
  header {
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 14px 16px; position: sticky; top: 0; z-index: 100;
    display: flex; align-items: center; justify-content: space-between;
  }
  .header-left h1 { font-size: 18px; font-weight: 700; letter-spacing: -0.03em; }
  .header-left p { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
  .header-actions { display: flex; gap: 8px; }
  .icon-btn {
    width: 40px; height: 40px; border-radius: 10px;
    background: var(--surface2); border: 1px solid var(--border);
    color: var(--text-mid); font-size: 18px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .icon-btn:active { opacity: 0.7; }

  /* Tabs */
  .tabs {
    display: flex; background: var(--surface); border-bottom: 1px solid var(--border);
    overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    padding: 11px 16px; font-size: 12px; font-weight: 600;
    color: var(--text-muted); cursor: pointer; white-space: nowrap;
    border-bottom: 2px solid transparent; flex-shrink: 0;
  }
  .tab.active { color: var(--text); border-bottom-color: var(--red); }

  /* Status bar */
  .status-bar {
    padding: 6px 16px; background: var(--surface); border-bottom: 1px solid var(--border);
    font-size: 11px; color: var(--text-muted); display: flex; justify-content: space-between;
  }

  /* Vehicle list */
  .vehicle-list { padding: 0; }
  .vehicle-row {
    border-bottom: 1px solid var(--border); background: var(--surface2);
  }
  .vehicle-row:active { background: var(--surface); }

  /* Collapsed view — 48px min height per spec */
  .v-collapsed {
    display: flex; align-items: center; padding: 10px 14px; gap: 10px;
    min-height: 48px; cursor: pointer; user-select: none;
  }
  .v-score {
    width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 800;
  }
  .v-score.green { background: #064e3b; color: #22c55e; }
  .v-score.yellow { background: #713f12; color: #eab308; }
  .v-score.orange { background: #7c2d12; color: #f97316; }
  .v-score.red { background: #7f1d1d; color: #ef4444; }
  .v-score.gray { background: #1f2937; color: #6B7280; }
  .v-info { flex: 1; min-width: 0; }
  .v-title { font-size: 14px; font-weight: 600; }
  .v-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; display: flex; gap: 8px; flex-wrap: wrap; }
  .v-chips { display: flex; gap: 4px; margin-top: 5px; flex-wrap: wrap; }
  .chip {
    font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
    letter-spacing: 0.03em; text-transform: uppercase;
  }
  .chip-green { background: #064e3b; color: #22c55e; }
  .chip-yellow { background: #713f12; color: #eab308; }
  .chip-orange { background: #7c2d12; color: #f97316; }
  .chip-red { background: #7f1d1d; color: #ef4444; }
  .chip-gray { background: #1f2937; color: #6B7280; }
  .chip-age { font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 3px; margin-left: 4px; }
  .age-today { background: #064e3b; color: #22c55e; }
  .age-recent { background: #713f12; color: #eab308; }
  .age-old { background: #1f2937; color: #6B7280; }
  .alert-badge { font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px; cursor: pointer; }
  .alert-badge-mark { background: #eab308; color: #78350f; }
  .alert-badge-mark.claimed { background: #064e3b; color: #22c55e; }
  .alert-badge-stream { background: #1e3a5f; color: #3b82f6; font-size: 8px; }
  .alert-badge-stream.claimed { background: #064e3b; color: #22c55e; }
  .vehicle-stale { opacity: 0.45; }
  .vehicle-gone .v-score { border: 1px dashed var(--border); }
  .v-right { text-align: right; flex-shrink: 0; }
  .v-value { font-size: 13px; font-weight: 700; color: var(--green); }
  .v-row { font-size: 10px; color: var(--text-muted); margin-top: 1px; }
  .v-parts-count { font-size: 10px; color: var(--text-muted); margin-top: 1px; }
  /* Retention toggle */
  .toggle-bar { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 16px; background: var(--surface); border-bottom: 1px solid var(--border); font-size: 12px; color: var(--text-muted); }
  .toggle-btn { padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface2); color: var(--text-muted); font-size: 11px; font-weight: 600; cursor: pointer; }
  .toggle-btn.active { background: #064e3b; color: #22c55e; border-color: #bbf7d0; }

  /* Expanded view */
  .v-expanded {
    display: none; padding: 0 14px 14px; background: var(--surface);
    border-top: 1px solid var(--border);
  }
  .v-expanded.open { display: block; }

  /* Part detail rows in expanded view */
  .part-detail {
    padding: 12px 0; border-bottom: 1px solid var(--border);
  }
  .part-detail:last-child { border-bottom: none; }
  .pd-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .pd-title { font-size: 13px; font-weight: 600; flex: 1; min-width: 0; }
  .pd-verdict {
    font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 5px; flex-shrink: 0; margin-left: 8px;
  }
  .verdict-great { background: #064e3b; color: #22c55e; }
  .verdict-good { background: #713f12; color: #eab308; }
  .verdict-fair { background: #7c2d12; color: #f97316; }
  .verdict-poor { background: #7f1d1d; color: #ef4444; }
  .pd-stats { display: flex; gap: 12px; font-size: 11px; color: var(--text-muted); flex-wrap: wrap; }
  .pd-reason { font-size: 11px; color: var(--text-muted); font-style: italic; margin-top: 4px; }
  .pd-actions { display: flex; gap: 6px; margin-top: 6px; }
  .btn-pull { padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 6px; border: 1px solid #22c55e; background: transparent; color: #22c55e; cursor: pointer; font-family: var(--font); }
  .btn-pull:active { opacity: 0.7; }
  .btn-skip { padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-family: var(--font); }
  .btn-note { padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-family: var(--font); }
  .skip-dropdown { display: none; }
  .note-input { display: none; }

  /* Skip dropdown */
  .skip-dropdown {
    display: none; margin-top: 6px; background: var(--surface2);
    border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
  }
  .skip-dropdown.open { display: block; }
  .skip-option {
    padding: 10px 12px; font-size: 12px; color: var(--text-mid);
    cursor: pointer; border-bottom: 1px solid var(--border);
  }
  .skip-option:last-child { border-bottom: none; }
  .skip-option:active { background: var(--border); }

  /* Note input */
  .note-input {
    display: none; margin-top: 6px;
  }
  .note-input.open { display: flex; gap: 6px; }
  .note-input input {
    flex: 1; padding: 8px 10px; background: var(--surface2); border: 1px solid var(--border);
    border-radius: 6px; color: var(--text); font-size: 12px; outline: none;
  }
  .note-input input:focus { border-color: var(--red); }
  .note-input button { padding: 8px 12px; }

  /* Location section */
  .loc-section {
    margin-top: 10px; padding: 10px; background: var(--surface2);
    border: 1px solid var(--border); border-radius: 6px;
  }
  .loc-header { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 5px; }
  .loc-text { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
  .loc-steps { list-style: decimal; padding-left: 16px; font-size: 12px; color: var(--text-mid); line-height: 1.5; }
  .loc-meta { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; font-size: 10px; color: var(--text-muted); }
  .loc-hazard { margin-top: 5px; font-size: 11px; color: var(--yellow); background: var(--yellow-dim); padding: 5px 7px; border-radius: 4px; }
  .loc-badge { font-size: 9px; font-weight: 700; padding: 2px 5px; border-radius: 3px; text-transform: uppercase; }
  .badge-high { background: #064e3b; color: #22c55e; }
  .badge-field { background: #713f12; color: #eab308; }
  .badge-res { background: #1f2937; color: #6B7280; }
  .loc-actions { display: flex; gap: 6px; margin-top: 8px; }
  .loc-actions button { font-size: 10px; font-weight: 600; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text-muted); cursor: pointer; }

  /* Empty / loading states */
  .loading { text-align: center; padding: 60px 20px; color: var(--text-muted); }
  .spinner { width: 28px; height: 28px; border: 2px solid #333; border-top-color: #DC2626; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 12px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .empty-state { padding: 40px 20px; text-align: center; color: var(--text-muted); }
  .empty-state h3 { font-size: 15px; font-weight: 600; margin-bottom: 6px; color: var(--text); }
  .empty-state p { font-size: 12px; line-height: 1.5; }
  .btn-primary { margin-top: 12px; padding: 10px 20px; background: var(--red); border: none; border-radius: 8px; color: white; font-size: 13px; font-weight: 600; cursor: pointer; }

  /* VIN scanner modal — lightweight inline */
  .vin-modal { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:200; overflow-y:auto; }
  .vin-modal.open { display:block; }
  .vin-inner { max-width:480px; margin:0 auto; padding:16px; padding-top:50px; }
  .vin-close { position:fixed; top:12px; right:16px; z-index:201; background:var(--surface2); border:1px solid var(--border); color:var(--text-muted); font-size:14px; width:36px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
  .vin-card { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:14px; margin-bottom:10px; }
  .vin-input { width:100%; padding:12px; border:1px solid var(--border); border-radius:8px; font-size:18px; font-family:monospace; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; outline:none; background:var(--surface2); color:var(--text); }
  .vin-input:focus { border-color:var(--red); }

  /* Manual set list modal */
  .manual-modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 200; align-items: flex-start; justify-content: center; padding: 20px; padding-top: 60px; }
  .manual-modal.open { display: flex; }
  .manual-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; width: 100%; max-width: 480px; }
  .manual-card h3 { font-size: 16px; margin-bottom: 4px; }
  .manual-card .subtitle { font-size: 11px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.4; }
  .manual-textarea {
    width: 100%; min-height: 200px; max-height: 50vh; padding: 12px; font-family: monospace;
    font-size: 13px; line-height: 1.5; background: var(--surface2); border: 1px solid var(--border);
    border-radius: 8px; color: var(--text); resize: vertical; outline: none;
  }
  .manual-textarea:focus { border-color: var(--red); }
  .manual-textarea::placeholder { color: var(--text-faint); }
  .manual-actions { display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; }
  .manual-actions button { padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
  .btn-run { background: var(--red); color: white; }
  .btn-run:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-cancel { background: var(--surface2); color: var(--text-muted); border: 1px solid var(--border) !important; }
  .manual-banner {
    padding: 8px 14px; background: linear-gradient(90deg, #7f1d1d, #1a1a1a); border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
  }
  .manual-banner span { font-size: 12px; font-weight: 700; color: #ef4444; letter-spacing: 0.05em; }
  .manual-banner button { font-size: 11px; padding: 4px 10px; border-radius: 5px; background: var(--surface2); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
</style>
</head>
<body>

<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('feed')</script>
<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 14px;background:#0a0a0a;border-bottom:1px solid #2a2a2a;">
  <p id="headerSub" style="font-size:11px;color:#6b7280;">Loading...</p>
  <div class="header-actions">
    <button class="icon-btn" onclick="openManualModal()" title="Paste Set List">📋</button>
    <button class="icon-btn" onclick="openVinModal()" title="Scan VIN">📷</button>
    <button class="icon-btn" id="scrapeBtn" onclick="triggerScrapeAll(this)" title="Refresh inventory from LKQ">🔄</button>
  </div>
</div>

<div class="tabs" id="tabBar">
  <div class="tab active" onclick="showTab('all')" id="tab-all">All</div>
  <div class="tab" onclick="showTab('yard:LKQ Raleigh')" id="tab-yard:LKQ Raleigh">Raleigh</div>
  <div class="tab" onclick="showTab('yard:LKQ Durham')" id="tab-yard:LKQ Durham">Durham</div>
  <div class="tab" onclick="showTab('yard:LKQ Greensboro')" id="tab-yard:LKQ Greensboro">Greensboro</div>
  <div class="tab" onclick="showTab('yard:LKQ East NC')" id="tab-yard:LKQ East NC">East NC</div>
  <div class="tab" onclick="showTab('florida')" id="tab-florida" style="border-left:1px solid var(--border);margin-left:4px;padding-left:12px">Florida</div>
  <div class="tab" onclick="showTab('yard:LKQ Tampa')" id="tab-yard:LKQ Tampa">Tampa</div>
  <div class="tab" onclick="showTab('yard:LKQ Largo')" id="tab-yard:LKQ Largo">Largo</div>
  <div class="tab" onclick="showTab('yard:LKQ Clearwater')" id="tab-yard:LKQ Clearwater">Clearwater</div>
  <div class="tab" id="tab-manual" onclick="showTab('manual')" style="display:none;border-left:1px solid var(--border);margin-left:4px;padding-left:12px;color:#ef4444;font-weight:700;">MANUAL</div>
</div>

<div class="status-bar">
  <span id="statusLeft">—</span>
  <span id="statusRight">—</span>
</div>

<div class="toggle-bar">
  <button class="toggle-btn active" id="filt-today" onclick="setDateFilter('today')">Today</button>
  <button class="toggle-btn" id="filt-3d" onclick="setDateFilter('3d')">3 Days</button>
  <button class="toggle-btn" id="filt-7d" onclick="setDateFilter('7d')">7 Days</button>
  <button class="toggle-btn" id="filt-30d" onclick="setDateFilter('30d')">30 Days</button>
  <button class="toggle-btn" id="filt-60d" onclick="setDateFilter('60d')">60 Days</button>
  <button class="toggle-btn" id="filt-all" onclick="setDateFilter('all')">All</button>
</div>

<div id="mainContent">
  <div class="loading"><div class="spinner"></div><div>Building attack list...</div></div>
</div>

<!-- Manual Set List Modal -->
<div class="manual-modal" id="manualModal">
  <div class="manual-card">
    <h3>📋 Paste Set List</h3>
    <div class="subtitle">Paste vehicles from any junkyard — website, Facebook, text, whatever. One per line. Any format works.</div>
    <textarea class="manual-textarea" id="manualText" placeholder="2009 Dodge Ram 1500 Silver Row C3&#10;09 RAM 1500&#10;2011 Ford F-150 3.5L EcoBoost&#10;2018 Chevy Silverado 4WD White&#10;Honda Civic 2016 Blue"></textarea>
    <div class="manual-actions">
      <button class="btn-cancel" onclick="closeManualModal()">Cancel</button>
      <button class="btn-run" id="manualRunBtn" onclick="runManualList()">Run It</button>
    </div>
    <div id="manualError" style="margin-top:8px;font-size:11px;color:#ef4444;display:none;"></div>
  </div>
</div>

<!-- VIN Scanner Modal — inline, no page navigation -->
<div class="vin-modal" id="vinModal">
  <button class="vin-close" onclick="closeVinModal()">X</button>
  <div class="vin-inner">
    <div class="vin-card">
      <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Scan or Enter VIN</div>
      <input type="text" class="vin-input" id="vinInput" maxlength="17" placeholder="17-character VIN" autocomplete="off" spellcheck="false">
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="icon-btn" style="font-size:20px;width:48px;height:44px;" id="vinCamBtn">📷</button>
        <button class="btn-primary" style="flex:1;padding:12px;font-size:14px;" id="vinDecBtn" onclick="vinDecode()">Decode</button>
      </div>
      <div id="vinStatus" style="font-size:11px;color:var(--text-muted);margin-top:6px"></div>
    </div>
    <div id="vinResults"></div>
  </div>
</div>

<script>
  let allData = null;
  let currentTab = 'all';
  let dateFilter = 'today'; // 'today', '3d', '7d', '30d', 'all'
  const activeSessions = {};
  const dataCache = {}; // keyed by filter mode

  // Eastern time helpers
  function easternDateStr(d) {
    if (!d) return null;
    return new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  function easternSinceDateISO(daysAgo) {
    const now = new Date();
    const past = new Date(now);
    past.setDate(past.getDate() - daysAgo);
    const dateStr = past.toLocaleDateString('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
    // 5am UTC = midnight EST (safe floor — in EDT this is 1am, still captures full day)
    return dateStr + 'T05:00:00.000Z';
  }

  function filterSinceParam() {
    if (dateFilter === 'today') return easternSinceDateISO(0);
    if (dateFilter === '3d') return easternSinceDateISO(3);
    if (dateFilter === '7d') return easternSinceDateISO(7);
    if (dateFilter === '30d') return easternSinceDateISO(30);
    if (dateFilter === '60d') return easternSinceDateISO(60);
    return null; // 'all' = no filter
  }

  async function setDateFilter(mode) {
    dateFilter = mode;
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('filt-' + mode).classList.add('active');
    if (dataCache[mode]) {
      allData = dataCache[mode];
      renderData();
    } else {
      await loadData();
    }
  }

  function getLastSeenDaysAgo(v) {
    // How many calendar days ago (Eastern) was this vehicle last confirmed on the yard
    const d = v.last_seen || v.scraped_at;
    if (!d) return 999;
    const todayET = easternDateStr(new Date());
    const seenET = easternDateStr(d);
    if (!todayET || !seenET) return 999;
    const todayMs = new Date(todayET + 'T00:00:00').getTime();
    const seenMs = new Date(seenET + 'T00:00:00').getTime();
    return Math.round((todayMs - seenMs) / 86400000);
  }

  function getSetDaysAgo(v) {
    // How many calendar days ago (Eastern) was this vehicle set at the yard?
    // Uses date_added (LKQ's "Available" date) because createdAt reflects scraper
    // run time (often 10pm ET = previous day in Eastern), not the actual set date.
    // Clamp future dates to today (Clearwater sometimes reports 1 day ahead).
    const d = v.date_added || v.createdAt;
    if (!d) return 999;
    const todayET = easternDateStr(new Date());
    const addedET = easternDateStr(d);
    if (!todayET || !addedET) return 999;
    const todayMs = new Date(todayET + 'T00:00:00').getTime();
    const addedMs = new Date(addedET + 'T00:00:00').getTime();
    const days = Math.round((todayMs - addedMs) / 86400000);
    return Math.max(0, days); // clamp: future dates show as "today"
  }

  function ageBadge(v) {
    const days = getSetDaysAgo(v);
    if (days < 0) return '<span class="chip chip-age age-today">NEW ' + Math.abs(days) + 'd</span>';
    if (days === 0) return '<span class="chip chip-age age-today">Today</span>';
    if (days <= 2) return '<span class="chip chip-age age-recent">' + days + 'd ago</span>';
    if (days <= 7) return '<span class="chip chip-age age-old">' + days + 'd ago</span>';
    if (days <= 30) return '<span class="chip chip-age age-old">' + days + 'd</span>';
    return '<span class="chip chip-age age-old">' + days + 'd</span>';
  }

  function vehicleRowClass(v) {
    if (!v.is_active) return 'vehicle-stale vehicle-gone';
    const days = getSetDaysAgo(v);
    if (days > 30) return 'vehicle-stale';
    return '';
  }

  // Strip LKQ platform/body codes from display
  // Strips letter+digit codes (DS1, DS6, WK2, LA1, RT1) and known platform-only letter codes (JK, JL, JT, WK, XK, MK, KJ, KL, DJ, DT, DH, BK, WJ, ZJ, TJ, ND, WD, PF, UF, FK)
  // Preserves real trims: LX, SXT, SRT, GT, SE, LE, XLE, LTZ, etc.
  const LKQ_PLATFORM_CODES = new Set(['JK','JL','JT','WK','XK','MK','KJ','KL','DJ','DT','DH','BK','WJ','ZJ','TJ','ND','WD','PF','UF','FK','FF','AN','EN','GS','JS','KA','RU','ZH','WH','RE','PT','LA','LD','BR','BE','AB','AY','PM','PG','DR','SA']);
  // Clean model name: strip LKQ codes, NHTSA trim junk, duplicate words
  function cleanModel(text, make) {
    if (!text) return text;
    var cleaned = stripLKQCodes(text, make);
    // Suburban 1500/2500 → Suburban, Yukon XL 1500 → Yukon XL, Avalanche 1500 → Avalanche
    cleaned = cleaned.replace(/\bSUBURBAN\s+1500\b/gi, 'Suburban');
    cleaned = cleaned.replace(/\bSUBURBAN\s+2500\b/gi, 'Suburban');
    cleaned = cleaned.replace(/\bYUKON\s+XL\s+1500\b/gi, 'Yukon XL');
    cleaned = cleaned.replace(/\bAVALANCHE\s+1500\b/gi, 'Avalanche');
    // Mazda: LKQ stores "3" but should display "Mazda3"
    if (/mazda/i.test(make || '')) {
      cleaned = cleaned.replace(/^3$/i, 'Mazda3');
      cleaned = cleaned.replace(/^6$/i, 'Mazda6');
      cleaned = cleaned.replace(/^5$/i, 'Mazda5');
    }
    // Strip NHTSA trim lists stuffed into model names ("CAMRY LE/SE/XLE" → "CAMRY")
    cleaned = cleaned.replace(/\s+(LE|SE|XLE|XSE|LX|EX|LT|LS|SL|SV|SR|DX|SXT|SLT|XLT|SEL|Limited|Sport|Base|Premium|Luxury|Touring)(\/[A-Za-z]+)*\s*$/i, '');
    cleaned = cleaned.replace(/\s+[A-Z]{1,4}(\/[A-Z]{1,4}){2,}\s*$/i, '');
    cleaned = cleaned.replace(/\b(NFA|NFB|NFC)\b/gi, '');
    // Remove duplicate consecutive words (case-insensitive): "350 350" → "350"
    cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, '$1');
    return cleaned.trim();
  }

  function stripLKQCodes(text, make) {
    if (!text) return text;
    var clean = text;
    // Only strip LKQ body codes (DS1, DS6, WK2, LA1) on Stellantis vehicles where they actually appear
    if (/dodge|ram|chrysler|jeep/i.test(make || '')) {
      clean = clean.replace(/\b[A-Z]{2}\d\b/g, '');  // Exactly 2 letters + 1 digit: DS1, DS6, WK2
    }
    return clean
      .replace(/\b([A-Z]{2})\b/g, (m, code) => LKQ_PLATFORM_CODES.has(code) ? '' : m) // known 2-letter platform codes
      .replace(/,\s*,/g, ',')
      .replace(/[, ]+,/g, ',')
      .replace(/,\s*$/, '')
      .replace(/^\s*,\s*/, '')
      .replace(/\s*,\s*(\d+\.\d+L)/g, ' $1') // comma before engine size
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  let scrapeHealth = {}; // keyed by yard name

  async function loadData() {
    document.getElementById('mainContent').innerHTML = '<div class="loading"><div class="spinner"></div><div>Scoring vehicles...</div></div>';
    try {
      const since = filterSinceParam();
      const url = since ? '/attack-list?since=' + encodeURIComponent(since) : '/attack-list';
      // Fetch attack list and scrape health in parallel
      const [res, healthRes] = await Promise.all([
        fetch(url),
        fetch('/yards/scrape-health').catch(() => null),
      ]);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      // Parse scrape health
      if (healthRes && healthRes.ok) {
        try {
          const h = await healthRes.json();
          scrapeHealth = {};
          if (h.yards) h.yards.forEach(y => { scrapeHealth[y.name] = y; });
          scrapeHealth._summary = h.summary;
        } catch (e) { scrapeHealth = {}; }
      }

      allData = data;
      dataCache[dateFilter] = data;
      renderData();
      const ts = new Date(data.generated_at);
      document.getElementById('statusLeft').textContent = 'Updated ' + ts.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      document.getElementById('headerSub').textContent = data.yards.length + ' yards scored';

      // Pre-fetch 3d in background after today renders
      if (dateFilter === 'today' && !dataCache['3d']) {
        const since3d = easternSinceDateISO(3);
        fetch('/attack-list?since=' + encodeURIComponent(since3d))
          .then(r => r.json())
          .then(d => { if (d.success) dataCache['3d'] = d; })
          .catch(() => {});
      }
    } catch (err) {
      document.getElementById('mainContent').innerHTML = `<div class="empty-state"><h3>Could not load</h3><p>${err.message}</p><button class="btn-primary" onclick="loadData()">Retry</button></div>`;
    }
  }

  function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    if (tab === 'manual' && manualResults) {
      showingManual = true;
      renderManualResults();
    } else {
      showingManual = false;
      renderData();
    }
  }

  function renderData() {
    if (!allData) return;
    pendingLazy = []; // Reset lazy sections
    if (lazyObserver) lazyObserver.disconnect();
    let yards = allData.yards;

    if (currentTab.startsWith('yard:')) {
      const yardName = currentTab.slice(5);
      yards = yards.filter(y => y.yard.name === yardName);
    } else if (currentTab === 'florida') {
      yards = yards.filter(y => ['LKQ Tampa','LKQ Largo','LKQ Clearwater'].includes(y.yard.name));
    }

    if (!yards.length || !yards.some(y => y.total_vehicles > 0)) {
      document.getElementById('mainContent').innerHTML = `<div class="empty-state"><h3>No vehicles found</h3><p>LKQ scrapes run at 2am nightly.</p><button class="btn-primary" onclick="triggerScrape(this)">Refresh Inventory Now</button></div>`;
      return;
    }

    // Count totals for status bar (server already filtered by last_seen)
    let totalV = 0, hotV = 0;
    yards.forEach(y => {
      const fv = y.vehicles || [];
      totalV += fv.length;
      hotV += fv.filter(v => v.color_code === 'green' || v.color_code === 'yellow').length;
    });
    document.getElementById('statusRight').textContent = `${totalV} vehicles · ${hotV} flagged`;

    let html = '';

    // Scrape health summary on All tab — only show when problems exist
    if (currentTab === 'all' && scrapeHealth._summary) {
      const s = scrapeHealth._summary;
      const problems = s.warning + s.stale + s.critical;
      if (problems > 0) {
        const color = s.critical > 0 ? '#fca5a5' : '#fbbf24';
        const bg = s.critical > 0 ? '#7f1d1d' : '#713f12';
        html += `<div style="padding:8px 14px;background:${bg};border-bottom:1px solid var(--border);font-size:12px;color:${color};font-weight:600;">
          Scrape health: ${s.healthy}/${s.total} yards healthy · ${problems} yard${problems > 1 ? 's' : ''} need attention
        </div>`;
      }
    }

    for (const yd of yards) {
      if (yd.total_vehicles === 0) continue;

      const vehicles = yd.vehicles || yd.top_vehicles || [];
      // Yard priority based on highest est_value vehicle
      const topValue = yd.est_total_value > 0 ? Math.max(...(yd.vehicles||[]).map(v=>v.est_value||0)) : 0;
      const priority = topValue >= 800 ? 'GO' : topValue >= 500 ? 'GOOD' : topValue >= 250 ? 'OK' : '—';
      const prioClass = topValue >= 800 ? 'chip-green' : topValue >= 500 ? 'chip-yellow' : topValue >= 250 ? 'chip-orange' : 'chip-gray';
      const lastScraped = yd.yard.last_scraped ? timeAgo(yd.yard.last_scraped) : 'never';

      // Vehicles already filtered server-side by last_seen
      const filtered = vehicles;
      if (filtered.length === 0) continue;

      html += `<div class="yard-group">
        <div style="padding:10px 14px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-size:14px;font-weight:700;">${yd.yard.name}</span>
            <span style="font-size:11px;color:#9CA3AF;margin-left:8px;">${filtered.length} vehicles · ${lastScraped}</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <span class="chip ${prioClass}">${priority}</span>
            <button class="icon-btn" style="width:28px;height:28px;font-size:12px;" onclick="scrapeYard('${yd.yard.id}',this)" title="Refresh ${yd.yard.name}">🔄</button>
          </div>
        </div>
        <div class="vehicle-list">`;

      // Scrape health indicator
      const yHealth = scrapeHealth[yd.yard.name];
      if (yHealth) {
        const hrs = yHealth.hours_since_scrape;
        const newV = yHealth.new_vehicles_last_scrape;
        if (yHealth.status === 'critical') {
          html += `<div style="padding:6px 14px;background:#7f1d1d;border-bottom:1px solid var(--border);font-size:11px;color:#fca5a5;display:flex;justify-content:space-between;align-items:center;animation:pulse 2s infinite;">
            <span>No scrape in ${Math.round(hrs)}h — CHECK SCRAPER IMMEDIATELY</span>
            <button class="icon-btn" style="width:24px;height:24px;font-size:11px;background:transparent;border:1px solid #fca5a5;color:#fca5a5;" onclick="scrapeYard('${yd.yard.id}',this)">🔄</button>
          </div>`;
        } else if (yHealth.status === 'stale') {
          html += `<div style="padding:6px 14px;background:#7f1d1d;border-bottom:1px solid var(--border);font-size:11px;color:#fca5a5;display:flex;justify-content:space-between;align-items:center;">
            <span>No scrape in ${Math.round(hrs)}h — scraper may not have run</span>
            <button class="icon-btn" style="width:24px;height:24px;font-size:11px;background:transparent;border:1px solid #fca5a5;color:#fca5a5;" onclick="scrapeYard('${yd.yard.id}',this)">🔄</button>
          </div>`;
        } else if (yHealth.status === 'warning') {
          html += `<div style="padding:6px 14px;background:#713f12;border-bottom:1px solid var(--border);font-size:11px;color:#fbbf24;display:flex;justify-content:space-between;align-items:center;">
            <span>Last scrape found 0 new vehicles — data may be stale</span>
            <button class="icon-btn" style="width:24px;height:24px;font-size:11px;background:transparent;border:1px solid #fbbf24;color:#fbbf24;" onclick="scrapeYard('${yd.yard.id}',this)">🔄</button>
          </div>`;
        }
      }

      // Group by date section
      const sections = [
        { label: 'SET TODAY', vehicles: filtered.filter(v => getSetDaysAgo(v) <= 0) },
        { label: 'LAST 3 DAYS', vehicles: filtered.filter(v => { const d = getSetDaysAgo(v); return d >= 1 && d <= 3; }) },
        { label: 'THIS WEEK', vehicles: filtered.filter(v => { const d = getSetDaysAgo(v); return d >= 4 && d <= 7; }) },
        { label: 'OLDER', vehicles: filtered.filter(v => getSetDaysAgo(v) > 7) },
      ];

      for (const sec of sections) {
        if (sec.vehicles.length === 0) continue;
        html += `<div style="padding:6px 14px;background:#1a1a1a;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.05em;display:flex;justify-content:space-between;">`
          + `<span>${sec.label}</span><span>${sec.vehicles.length}</span></div>`;
        // Render first BATCH_SIZE immediately, rest via lazy loading
        const BATCH = 30;
        for (let i = 0; i < Math.min(BATCH, sec.vehicles.length); i++) {
          html += renderVehicle(sec.vehicles[i]);
        }
        if (sec.vehicles.length > BATCH) {
          const sectionId = 'lazy-' + yd.yard.id + '-' + sec.label.replace(/\s+/g, '');
          pendingLazy.push({ id: sectionId, vehicles: sec.vehicles.slice(BATCH) });
          html += `<div id="${sectionId}" style="padding:12px 14px;text-align:center;color:#6B7280;font-size:11px;cursor:pointer;" onclick="loadLazySection('${sectionId}')">Show ${sec.vehicles.length - BATCH} more...</div>`;
        }
      }
      html += '</div></div>';
    }
    document.getElementById('mainContent').innerHTML = html;
    // Auto-load lazy sections as user scrolls near them
    setupLazyObserver();
  }

  let pendingLazy = [];
  let lazyObserver = null;

  function setupLazyObserver() {
    if (lazyObserver) lazyObserver.disconnect();
    if (pendingLazy.length === 0) return;
    lazyObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          loadLazySection(entry.target.id);
          lazyObserver.unobserve(entry.target);
        }
      }
    }, { rootMargin: '200px' });
    for (const p of pendingLazy) {
      const el = document.getElementById(p.id);
      if (el) lazyObserver.observe(el);
    }
  }

  function loadLazySection(sectionId) {
    const idx = pendingLazy.findIndex(p => p.id === sectionId);
    if (idx === -1) return;
    const section = pendingLazy[idx];
    pendingLazy.splice(idx, 1);
    const el = document.getElementById(sectionId);
    if (!el) return;
    let html = '';
    for (const v of section.vehicles) html += renderVehicle(v);
    el.outerHTML = html;
  }

  function renderVehicle(v) {
    const sc = v.color_code;
    // Use part_chips (slim mode) or parts (full/manual mode) for chip display
    const chipSource = v.part_chips || (v.parts || []).slice(0, 4).map(p => ({ partType: p.partType || p.category, price: p.price }));
    const chipTypes = new Set();
    const chips = chipSource.filter(p => {
      const t = p.partType || '?';
      if (chipTypes.has(t)) return false;
      chipTypes.add(t);
      return true;
    }).sort((a, b) => (b.price || 0) - (a.price || 0)).slice(0, 4).map(p => {
      const price = p.price || 0;
      const cc = price >= 250 ? 'chip-green' : price >= 150 ? 'chip-yellow' : price >= 100 ? 'chip-orange' : price > 0 ? 'chip-red' : 'chip-gray';
      return `<span class="chip ${cc}">${p.partType || '?'}</span>`;
    }).join('');

    const rowClass = vehicleRowClass(v);
    const aBadge = ageBadge(v);
    const goneLabel = v.is_active === false ? '<span class="chip chip-age age-old">GONE</span>' : '';

    // Don't pre-render expanded parts — load on demand when tapped
    const hasPartsPreloaded = v.parts && v.parts.length > 0;

    return `<div class="vehicle-row ${rowClass}" id="vrow-${v.id}">
      <div class="v-collapsed" onclick="toggleV('${v.id}')">
        <div class="v-score ${sc}">${v.score}</div>
        <div class="v-info">
          <div class="v-title"><strong style="color:#fff">${v.year} ${cleanModel(v.make, '')} ${cleanModel(v.model, v.make)}</strong>${v.engine ? ` <span style="font-size:13px;color:#b0b0b0;font-weight:600">${v.engine}</span>` : ''}${v.trimBadge ? ` <span class="chip" style="font-size:9px;font-weight:${v.trimBadge.color === 'gray' ? '500' : '700'};padding:1px 6px;background:${v.trimBadge.color === 'green' ? '#22c55e' : v.trimBadge.color === 'blue' ? '#3b82f6' : v.trimBadge.color === 'gray' ? '#374151' : '#f59e0b'};color:${v.trimBadge.color === 'gray' ? '#9ca3af' : '#000'}">${v.trimBadge.decodedTrim || v.trimBadge.label}</span>` : ''}${v.cult ? ' <span class="chip" style="font-size:9px;font-weight:700;padding:1px 6px;background:#d946ef;color:#000">CULT</span>' : ''}${v.diesel ? ' <span class="chip" style="font-size:9px;font-weight:700;padding:1px 6px;background:#3b82f6;color:#000">DIESEL</span>' : ''}${(() => { const dt = (v.decoded_drivetrain || v.drivetrain || '').toUpperCase(); if (/4WD|4X4|AWD/i.test(dt)) return ' <span class="chip" style="font-size:9px;font-weight:700;padding:1px 6px;background:#16a34a;color:#000">' + (/AWD/i.test(dt) ? 'AWD' : '4WD') + '</span>'; if (/FWD/i.test(dt)) return ' <span class="chip" style="font-size:9px;font-weight:500;padding:1px 6px;background:#374151;color:#9ca3af">FWD</span>'; return ''; })()}${v.decoded_transmission ? (/manual/i.test(v.decoded_transmission) && v.decoded_transmission !== 'CHECK_MT' ? ' <span class="chip" style="font-size:9px;font-weight:700;padding:1px 6px;background:#06b6d4;color:#000">MANUAL</span>' : v.decoded_transmission === 'CHECK_MT' ? ' <span class="chip" style="font-size:9px;font-weight:700;padding:1px 6px;background:#06b6d4;color:#000;opacity:0.6">CHECK MT</span>' : /cvt/i.test(v.decoded_transmission) ? ' <span class="chip" style="font-size:9px;font-weight:500;padding:1px 6px;background:#374151;color:#9ca3af">CVT</span>' : '') : ''}${(() => { const dt = (v.decoded_drivetrain || v.drivetrain || '').toUpperCase(); const is4x4 = /4WD|4X4|AWD/i.test(dt); const isMT = v.decoded_transmission && (/manual/i.test(v.decoded_transmission) || v.decoded_transmission === 'CHECK_MT'); return is4x4 && isMT ? ' <span class="chip" style="font-size:9px;font-weight:700;padding:1px 6px;background:#3b82f6;color:#000">4\u00d74+MT</span>' : ''; })()} ${aBadge}${goneLabel}</div>
          ${renderAlertBadges(v)}
          <div class="v-meta">
            ${v.row_number ? `<span>Row ${v.row_number}</span>` : ''}
            ${v.color ? `<span style="font-weight:600">${v.color}</span>` : ''}
            ${v.engine_type && v.engine_type !== 'Gas' ? `<span class="chip chip-age ${v.engine_type === 'Hybrid' ? 'age-recent' : 'age-today'}" style="font-size:9px;font-weight:700">${v.engine_type.toUpperCase()}</span>` : ''}
            ${(v.date_added || v.createdAt) ? `<span>${timeAgo(v.date_added || v.createdAt)}</span>` : ''}
          </div>
          <div class="v-chips">${chips || '<span class="chip chip-gray">No data</span>'}</div>
        </div>
        <div class="v-right">
          ${v.est_value > 0 ? `<div class="v-value">$${v.est_value}</div>` : ''}
          ${v.matched_parts > 0 ? `<div class="v-parts-count">${v.matched_parts} parts</div>` : ''}
        </div>
      </div>
      <div class="v-expanded" id="vexp-${v.id}">
        ${hasPartsPreloaded ? renderExpandedParts(v) : (v.parts && v.parts.length === 0 ? '<div style="padding:12px 0;color:#6B7280;font-size:12px;">No parts matched for this vehicle</div>' : '<div style="padding:12px 0;color:#9CA3AF;font-size:12px;">Tap to load parts...</div>')}
      </div>
    </div>`;
  }

  function renderExpandedParts(v) {
    const parts = v.parts || [];
    const rebuildParts = v.rebuild_parts || [];
    if (parts.length === 0 && rebuildParts.length === 0) {
      return '<div style="padding:12px 0;color:#9CA3AF;font-size:12px;">No matching inventory parts found.</div>';
    }

    let html = '';

    // Show validated trim suggestions (sellable parts only, with avg prices)
    if (v.validated_suggestions && v.validated_suggestions.length > 0) {
      const lines = [];
      const baseNeeded = {}; // part_type_key → base_avg_price (deduplicated)

      for (const s of v.validated_suggestions) {
        const price = s.premium_avg ? Math.round(s.premium_avg) : null;

        if (s.verdict === 'CONFIRMED' || s.verdict === 'WORTH_IT') {
          const color = price >= 100 ? '#22c55e' : '#eab308';
          lines.push(`<span style="color:${color};font-weight:600">\u2705 ${s.suggestion} — $${price}</span>`);
        } else if (s.verdict === 'NO_PREMIUM') {
          if (price && price >= 100) {
            lines.push(`<span style="color:#9CA3AF">${s.suggestion} — $${price}</span>`);
          }
        } else if (s.verdict === 'MARGINAL') {
          if (price && price >= 100) {
            lines.push(`<span style="color:#9CA3AF">${s.suggestion} — $${price}</span>`);
          }
        } else if (s.verdict === 'INSUFFICIENT') {
          if (price && price >= 100) {
            lines.push(`<span style="color:#9CA3AF">${s.suggestion} — $${price}</span>`);
          }
        } else {
          // UNVALIDATED
          lines.push(`<span style="color:#4b5563">? ${s.suggestion}</span>`);
        }

        // Track base lines needed (deduplicated per part_type)
        if (s.show_base && s.part_type_key && !baseNeeded[s.part_type_key]) {
          baseNeeded[s.part_type_key] = Math.round(s.base_avg_price);
        }
      }

      // Append base lines at the end, one per part_type
      const baseLabels = { amp: 'Amp', nav_radio: 'Radio', '360_camera': 'Camera', digital_cluster: 'Cluster', backup_camera: 'Camera' };
      for (const [pt, basePrice] of Object.entries(baseNeeded)) {
        if (basePrice >= 100) {
          const label = baseLabels[pt] || pt;
          lines.push(`<span style="color:#22c55e;font-weight:600">\u2705 ${label} (base) — $${basePrice}</span>`);
        }
      }

      if (lines.length > 0) {
        const suggestionsHtml = lines.join('<br>');
        html += `<div style="margin:6px 0 8px 0;padding:6px 8px;background:#1a1a2e;border-radius:6px;border:1px solid #333">
          <span style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Validated Trim Parts</span>
          ${v.audio_brand ? `<span style="color:#d946ef;font-size:10px;margin-left:8px;font-weight:600">\uD83D\uDD0A ${v.audio_brand}</span>` : ''}
          <div style="font-size:12px;margin-top:3px;line-height:1.6">${suggestionsHtml}</div>
        </div>`;
      }
    } else if (v.expected_parts) {
      // Fallback: show raw expected_parts if no validated suggestions
      html += `<div style="margin:6px 0 8px 0;padding:6px 8px;background:#1a1a2e;border-radius:6px;border:1px solid #333">
        <span style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Expected on this trim</span>
        ${v.audio_brand ? `<span style="color:#d946ef;font-size:10px;margin-left:8px;font-weight:600">\uD83D\uDD0A ${v.audio_brand}</span>` : ''}
        <div style="color:#ccc;font-size:12px;margin-top:3px">${v.expected_parts}</div>
      </div>`;
    }

    if (v.platform_siblings && v.platform_siblings.length > 0) {
      html += `<div style="padding:8px 0;font-size:11px;color:#9CA3AF;border-bottom:1px solid var(--border);">
        <span style="color:var(--yellow);font-weight:600;">PLATFORM:</span> Also fits ${v.platform_siblings.join(', ')}
      </div>`;
    }

    // Sort parts: our sold data first, then market data, then price descending
    parts.sort((a, b) => {
      // Parts we've sold are always most trustworthy
      const soldA = (a.sold_90d || 0) > 0 ? 1 : (a.marketMedian > 0 ? 2 : 3);
      const soldB = (b.sold_90d || 0) > 0 ? 1 : (b.marketMedian > 0 ? 2 : 3);
      if (soldA !== soldB) return soldA - soldB;
      // Then by primary price descending (our price if we've sold, market otherwise)
      const pA = (a.sold_90d > 0 && a.price > 0) ? a.price : (a.marketMedian > 0 ? a.marketMedian : a.price || 0);
      const pB = (b.sold_90d > 0 && b.price > 0) ? b.price : (b.marketMedian > 0 ? b.marketMedian : b.price || 0);
      return pB - pA;
    });

    // Pullable parts
    for (const p of parts) {
      if (!p) continue;
      const pid = p.itemId || ('s' + Math.random().toString(36).slice(2, 8));
      // OUR sold price is primary when we have recent sales; market data fills gaps
      const hasOurSales = (p.sold_90d || 0) > 0 && p.price > 0;
      const isEst = p.priceSource === 'estimate';
      const displayPrice = hasOurSales ? p.price : (p.marketMedian > 0 ? p.marketMedian : (p.price != null ? p.price : 0));
      const badgeVerdict = isEst ? 'EST' : displayPrice >= 250 ? 'GREAT' : displayPrice >= 150 ? 'GOOD' : displayPrice >= 100 ? 'FAIR' : 'POOR';
      const vc = badgeVerdict === 'EST' ? 'verdict-poor' : badgeVerdict === 'GREAT' ? 'verdict-great' : badgeVerdict === 'GOOD' ? 'verdict-good' : badgeVerdict === 'FAIR' ? 'verdict-fair' : 'verdict-poor';
      const price = displayPrice;
      const pricePrefix = isEst ? '~$' : '$';
      const inStock = p.in_stock != null ? p.in_stock : 0;
      const sold90d = p.sold_90d != null ? p.sold_90d : 0;
      // Price freshness indicator
      let freshness = '❓';
      if (hasOurSales) {
        // Our own sales — freshness based on last sold date
        if (p.lastSoldDate) {
          const daysAgo = Math.floor((Date.now() - new Date(p.lastSoldDate).getTime()) / 86400000);
          freshness = daysAgo <= 30 ? '✅' : daysAgo <= 60 ? '⚠️' : '❌';
        } else {
          freshness = '✅'; // We have sold_90d > 0 so it's recent
        }
      } else if (p.marketCheckedAt) {
        const daysAgo = Math.floor((Date.now() - new Date(p.marketCheckedAt).getTime()) / 86400000);
        freshness = daysAgo <= 60 ? '✅' : daysAgo <= 90 ? '⚠️' : '❌';
      } else if (p.marketMedian > 0) {
        freshness = '✅';
      }
      html += `<div class="part-detail" id="pd-${v.id}-${pid}">
        <div class="pd-header">
          <div class="pd-title">${p.isMarked ? '<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;background:#f59e0b;color:#000;margin-right:4px" title="On your restock watch list">MARKED</span>' : ''}${p.partType ? `[${p.partType}] ` : ''}${p.title || p.category || 'Part'}</div>
          <div class="pd-verdict ${vc}">${badgeVerdict} ${pricePrefix}${price} ${freshness}</div>
        </div>
        <div class="pd-stats">
          <span>${inStock} in stock</span>
          <span>${sold90d} sold/90d</span>
          ${p.partNumber ? `<span>${p.partNumber}</span>` : ''}
          ${isEst ? '<span style="color:#6B7280;font-size:9px" title="Conservative estimate — no market data available">est</span>' : ''}
        </div>
        <div class="pd-reason">${p.reason || ''}${p.trimMultiplier !== undefined && p.trimMultiplier < 1.0 ? (p.trimMultiplier === 0 ? ' <span style="color:#ef4444;font-weight:600">· Not expected on this trim</span>' : ' <span style="color:#f59e0b;font-weight:600">· ⚠️ Verify on vehicle</span>') : ''}</div>
        ${p.marketMedian > 0 ? `<div style="font-size:11px;margin-top:2px;display:flex;gap:8px;align-items:center">
          <span style="color:#9CA3AF">${hasOurSales ? 'Market ref' : 'Market'}</span>
          <span style="color:${hasOurSales ? '#6B7280' : (Math.abs(displayPrice - p.marketMedian) / p.marketMedian > 0.2 ? (displayPrice > p.marketMedian ? '#ef4444' : '#eab308') : '#10B981')};font-weight:600">$${p.marketMedian} med</span>
          <span style="color:#6B7280">${p.marketCount || 0} sold</span>
          ${p.marketVelocity ? `<span style="color:#6B7280">${p.marketVelocity.toFixed(1)}/wk</span>` : ''}
        </div>` : ''}
        ${p.deadWarning && p.deadWarning.failureReason && p.deadWarning.failureReason !== 'unknown' ? `<div style="margin-top:4px;padding:4px 8px;background:#fee2e2;border-radius:4px;font-size:10px;color:#dc2626;font-weight:600;">${p.deadWarning.failureReason === 'overpriced' ? 'Sat unsold — was overpriced vs market' : p.deadWarning.failureReason === 'low_demand' ? 'Sat unsold — low demand for this part' : p.deadWarning.failureReason}</div>` : ''}
        <div class="pd-actions">
          <button class="btn-pull" onclick="markPulled('${v.id}','${pid}',event)">Pull</button>
          <button class="btn-skip" onclick="toggleSkip('${v.id}','${pid}')">Skip</button>
          <button class="btn-note" onclick="toggleNote('${v.id}','${pid}')">Note</button>
        </div>
        <div class="skip-dropdown" id="skip-${v.id}-${pid}">
          <div style="padding:6px 10px;font-size:11px;cursor:pointer;border-bottom:1px solid var(--border)" onclick="logSkip('${v.id}','${pid}','already_have')">Already have</div>
          <div style="padding:6px 10px;font-size:11px;cursor:pointer;border-bottom:1px solid var(--border)" onclick="logSkip('${v.id}','${pid}','too_low_value')">Too low value</div>
          <div style="padding:6px 10px;font-size:11px;cursor:pointer;border-bottom:1px solid var(--border)" onclick="logSkip('${v.id}','${pid}','hard_to_pull')">Hard to pull</div>
          <div style="padding:6px 10px;font-size:11px;cursor:pointer" onclick="logSkip('${v.id}','${pid}','other')">Other</div>
        </div>
        <div class="note-input" id="note-${v.id}-${pid}">
          <input type="text" id="noteval-${v.id}-${pid}" placeholder="Add note..." style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface2);color:var(--text);font-size:12px;font-family:var(--font);outline:none;">
          <button onclick="saveNote('${v.id}','${pid}')" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:11px;font-weight:700;cursor:pointer;font-family:var(--font)">Save</button>
        </div>
      </div>`;
    }

    // Rebuild reference — grouped by part type, one line each
    if (rebuildParts.length > 0) {
      html += `<div style="margin-top:10px;padding-top:8px;border-top:2px dashed var(--border);">
        <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Rebuild Reference (not included in pull value)</div>`;
      for (const p of rebuildParts) {
        const priceDisplay = p.priceRange || ('$' + p.price);
        const countDisplay = p.count > 1 ? ` (${p.count} listings)` : '';
        html += `<div style="padding:4px 0;opacity:0.6;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;">
          <span>[REBUILD] ${p.seller || 'pro-rebuild'} — ${p.partType || 'Part'}</span>
          <span style="font-weight:600;">${priceDisplay}${countDisplay}</span>
        </div>`;
      }
      html += '</div>';
    }

    // Trim + Location sections — only for 2016+ vehicles (rolling 10-year window)
    const vYear = parseInt(v.year) || 0;
    if (vYear >= 2016) {
      if (v.trim) {
        html += `<div class="loc-section" id="trim-${v.id}" style="margin-top:10px;">
          <div class="loc-header">Trim Parts</div>
          <div style="font-size:11px;color:#9CA3AF;font-style:italic;">Loading...</div>
        </div>`;
      }
      html += `<div class="loc-section" id="loc-${v.id}">
        <div class="loc-header">Part Location</div>
        <div style="font-size:11px;color:#9CA3AF;font-style:italic;">Tap to load</div>
      </div>`;
    }

    return html;
  }

  function findVehicleById(id) {
    // Search yards data
    if (allData && allData.yards) {
      for (const yd of allData.yards) {
        const vList = yd.vehicles || yd.top_vehicles || [];
        const v = vList.find(v => v.id === id);
        if (v) return v;
      }
    }
    // Search manual results
    if (manualResults && manualResults.vehicles) {
      const v = manualResults.vehicles.find(v => v.id === id);
      if (v) return v;
    }
    return null;
  }

  async function toggleV(id) {
    const exp = document.getElementById('vexp-' + id);
    if (!exp) return;
    const wasOpen = exp.classList.contains('open');
    exp.classList.toggle('open');
    if (!wasOpen && !exp.dataset.loaded) {
      exp.dataset.loaded = '1';
      const vehicle = findVehicleById(id);

      // Load parts on-demand if not already present (slim mode)
      if (vehicle && !vehicle.parts) {
        exp.innerHTML = '<div style="padding:12px 0;color:#9CA3AF;font-size:12px;text-align:center;"><div class="spinner" style="display:inline-block;"></div> Loading parts...</div>';
        try {
          const res = await fetch('/attack-list/vehicle/' + id + '/parts');
          const data = await res.json();
          if (data.success) {
            vehicle.parts = data.parts || [];
            vehicle.rebuild_parts = data.rebuild_parts || null;
            vehicle.platform_siblings = data.platform_siblings || null;
          }
        } catch (e) { /* use empty parts */ }
        exp.innerHTML = renderExpandedParts(vehicle || { parts: [] });
      }

      loadLocation(id);
      if (vehicle && vehicle.trim) loadTrimIntel(vehicle);
    }
  }

  // === Part actions ===

  function markPulled(vid, itemId, evt) {
    evt.stopPropagation();
    const el = document.getElementById('pd-' + vid + '-' + itemId);
    if (el) {
      el.style.opacity = '0.4';
      el.querySelector('.btn-pull').textContent = '✓ Logged';
      el.querySelector('.btn-pull').disabled = true;
    }
    // Log to pull_session via API (best effort)
    fetch('/attack-list/log-pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleId: vid, itemId }),
    }).catch(() => {});
  }

  function toggleSkip(vid, itemId) {
    const dd = document.getElementById('skip-' + vid + '-' + itemId);
    dd.classList.toggle('open');
  }

  function logSkip(vid, itemId, reason) {
    const dd = document.getElementById('skip-' + vid + '-' + itemId);
    dd.classList.remove('open');
    const el = document.getElementById('pd-' + vid + '-' + itemId);
    if (el) {
      el.style.opacity = '0.3';
      const btn = el.querySelector('.btn-skip');
      btn.textContent = '✗ ' + reason.replace('_', ' ');
    }
  }

  function toggleNote(vid, itemId) {
    const ni = document.getElementById('note-' + vid + '-' + itemId);
    ni.classList.toggle('open');
    if (ni.classList.contains('open')) {
      ni.querySelector('input').focus();
    }
  }

  function saveNote(vid, itemId) {
    const input = document.getElementById('noteval-' + vid + '-' + itemId);
    const note = input.value.trim();
    if (!note) return;
    input.value = '';
    document.getElementById('note-' + vid + '-' + itemId).classList.remove('open');
    // Show confirmation
    const el = document.getElementById('pd-' + vid + '-' + itemId);
    const noteEl = document.createElement('div');
    noteEl.style.cssText = 'font-size:11px;color:var(--yellow);margin-top:4px;';
    noteEl.textContent = '📝 ' + note;
    el.appendChild(noteEl);
  }

  // === Location loading ===

  const RESEARCH_PARTS = ['ECM','PCM','BCM','TIPM','FUSE BOX','TCM','ABS','AMPLIFIER','TRANSFER CASE MODULE','HVAC MODULE','AIRBAG MODULE','PARKING SENSOR MODULE','BLIND SPOT MODULE','CAMERA MODULE','LIFTGATE MODULE','STEERING MODULE'];

  async function loadLocation(vid) {
    const vehicle = findVehicleById(vid);
    if (!vehicle) return;

    const locDiv = document.getElementById('loc-' + vid);
    const year = parseInt(vehicle.year) || 0;
    const make = encodeURIComponent(vehicle.make || '');
    const model = encodeURIComponent(vehicle.model || '');
    const trim = vehicle.trim ? '&trim=' + encodeURIComponent(vehicle.trim) : '';

    // Detect part type from first matched part
    let partType = 'ECM';
    for (const p of (vehicle.parts || [])) {
      if (p.partType) { partType = p.partType; break; }
    }

    if (year < 2014) {
      locDiv.innerHTML = '<div class="loc-header">📍 Part Location</div><div style="font-size:11px;color:var(--text-faint);">Add location — no auto-research for pre-2014</div>';
      return;
    }

    locDiv.innerHTML = '<div class="loc-header">📍 Part Location — ' + partType + '</div><div style="font-size:11px;color:#9CA3AF;font-style:italic;">Researching...</div>';

    try {
      const res = await fetch('/part-location/' + encodeURIComponent(partType) + '/' + make + '/' + model + '/' + year + '?' + trim);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      if (!data.found) {
        locDiv.innerHTML = '<div class="loc-header">📍 Part Location — ' + partType + '</div><div style="font-size:11px;color:var(--text-faint);">' + (data.eligible ? 'No data found' : 'Add location') + '</div>';
        return;
      }
      renderLoc(locDiv, data.location, partType);
    } catch (err) {
      locDiv.innerHTML = '<div class="loc-header">📍 Part Location</div><div style="font-size:11px;color:#9CA3AF;">Could not load</div>';
    }
  }

  function renderLoc(el, loc, pt) {
    const steps = Array.isArray(loc.removal_steps) ? loc.removal_steps : [];
    const stepsHtml = steps.length ? '<ol class="loc-steps">' + steps.map(s => '<li>' + s + '</li>').join('') + '</ol>' : '';
    const bc = loc.confidence === 'high_confidence' ? 'badge-high' : loc.confidence === 'field_confirmed' ? 'badge-field' : 'badge-res';
    const bl = loc.confidence === 'high_confidence' ? 'Confirmed' : loc.confidence === 'field_confirmed' ? 'Field' : 'Researched';

    el.innerHTML = `<div class="loc-header">📍 ${pt} <span class="loc-badge ${bc}">${bl}</span></div>
      ${loc.location_text ? '<div class="loc-text">' + loc.location_text + '</div>' : ''}
      ${stepsHtml}
      <div class="loc-meta">
        ${loc.tools ? '<span>🔧 ' + loc.tools + '</span>' : ''}
        ${loc.avg_pull_minutes ? '<span>⏱ ~' + loc.avg_pull_minutes + ' min</span>' : ''}
      </div>
      ${loc.hazards ? '<div class="loc-hazard">⚠️ ' + loc.hazards + '</div>' : ''}
      <div class="loc-actions">
        <button onclick="confirmLoc('${loc.id}')">✓ Confirm</button>
        <button onclick="flagLoc('${loc.id}')">✗ Wrong</button>
      </div>`;
  }

  async function confirmLoc(id) { fetch('/part-location/confirm', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id}) }).catch(()=>{}); }
  async function flagLoc(id) { fetch('/part-location/flag-wrong', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id}) }).catch(()=>{}); }

  // === Utility ===
  async function triggerScrape(btn) {
    btn.textContent = 'Scraping...'; btn.disabled = true;
    try {
      await fetch('/yards/scrape/lkq', { method: 'POST' });
      pollScrapeStatus(btn);
    } catch (e) { btn.textContent = 'Failed'; btn.disabled = false; }
  }

  async function triggerScrapeAll(btn) {
    btn.disabled = true; btn.title = 'Scraping all yards...';
    btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;margin:0;border-width:2px;"></div>';
    document.getElementById('statusLeft').textContent = 'Scraping LKQ...';
    try {
      const res = await fetch('/yards/scrape/lkq', { method: 'POST' });
      const data = await res.json();
      if (data.already_running) {
        document.getElementById('statusLeft').textContent = 'Scrape already running...';
      }
      pollScrapeStatus(btn);
    } catch (e) {
      btn.textContent = '🔄'; btn.disabled = false; btn.title = 'Refresh inventory from LKQ';
      document.getElementById('statusLeft').textContent = 'Scrape failed to start';
    }
  }

  function pollScrapeStatus(btn) {
    const poll = setInterval(async () => {
      try {
        const res = await fetch('/yards/scrape/status');
        const status = await res.json();
        if (!status.running) {
          clearInterval(poll);
          btn.textContent = '🔄'; btn.disabled = false; btn.title = 'Refresh inventory from LKQ';
          if (status.error) {
            document.getElementById('statusLeft').textContent = 'Scrape error: ' + status.error;
          } else {
            document.getElementById('statusLeft').textContent = 'Scrape complete — reloading...';
            loadData();
          }
        }
      } catch (e) {
        clearInterval(poll);
        btn.textContent = '🔄'; btn.disabled = false;
      }
    }, 5000);
  }

  async function scrapeYard(yardId, btn) {
    const orig = btn.textContent;
    btn.textContent = '⏳'; btn.disabled = true;
    try {
      await fetch('/yards/scrape/' + yardId, { method: 'POST' });
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; loadData(); }, 60000);
    } catch (e) { btn.textContent = '✗'; btn.disabled = false; }
  }

  // Load trim intelligence for a vehicle (triggered on expand)
  async function loadTrimIntel(vehicle) {
    if (!vehicle.trim || !vehicle.make || !vehicle.model || !vehicle.year) return;
    try {
      const url = `/trim-intelligence/${vehicle.year}/${encodeURIComponent(vehicle.make)}/${encodeURIComponent(vehicle.model)}/${encodeURIComponent(vehicle.trim)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && data.found && data.intelligence?.expected_parts?.length > 0) {
        const el = document.getElementById('trim-' + vehicle.id);
        if (el) {
          const parts = data.intelligence.expected_parts;
          let html = '<div class="loc-header">✨ Trim Parts (' + vehicle.trim + ')</div>';
          html += parts.map(p => `<div style="font-size:11px;color:var(--text-mid);padding:2px 0;">• ${p.part_type}: ${p.description} <span style="color:${p.value_premium === 'high' ? 'var(--green)' : 'var(--yellow)'}">(${p.value_premium})</span></div>`).join('');
          el.innerHTML = html;
        }
      }
    } catch (e) { /* ignore */ }
  }

  function timeAgo(ds) {
    const d = new Date(ds); const diff = Date.now() - d.getTime();
    const h = Math.floor(diff / 3600000); const dd = Math.floor(h / 24);
    if (dd > 0) return dd + 'd ago'; if (h > 0) return h + 'h ago'; return 'now';
  }

  function renderAlertBadges(v) {
    if (!v.alertBadges || v.alertBadges.length === 0) return '';
    let html = '<div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap;align-items:center">';
    for (const ab of v.alertBadges) {
      if (ab.source === 'PERCH') {
        // Gold star badge — Mark signal (highest priority)
        const conf = ab.confidence === 'high' ? '★' : '☆';
        html += `<span class="alert-badge alert-badge-mark" onclick="event.stopPropagation();claimAlertFromFeed(${ab.id},this)" title="${ab.title || 'Marked part'}">${conf} MARKED</span>`;
      } else {
        // Blue badge — Scour Stream signal
        html += `<span class="alert-badge alert-badge-stream" onclick="event.stopPropagation();claimAlertFromFeed(${ab.id},this)" title="${ab.title || 'Restock'}">Restock</span>`;
      }
    }
    html += '</div>';
    return html;
  }

  function claimAlertFromFeed(alertId, el) {
    el.classList.add('claimed');
    el.innerHTML = '✓ Got it';
    fetch('/scout-alerts/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: alertId, claimed: true }),
    }).catch(() => {});
  }

  // === Manual Set List ===
  let manualResults = null;
  let showingManual = false;

  function openManualModal() {
    document.getElementById('manualModal').classList.add('open');
    document.getElementById('manualText').value = '';
    document.getElementById('manualError').style.display = 'none';
    document.getElementById('manualRunBtn').disabled = false;
    document.getElementById('manualRunBtn').textContent = 'Run It';
    setTimeout(() => document.getElementById('manualText').focus(), 100);
  }

  function closeManualModal() {
    document.getElementById('manualModal').classList.remove('open');
  }

  async function runManualList() {
    const text = document.getElementById('manualText').value.trim();
    if (!text) return;

    const btn = document.getElementById('manualRunBtn');
    const errEl = document.getElementById('manualError');
    btn.disabled = true;
    btn.textContent = 'Scoring...';
    errEl.style.display = 'none';

    try {
      const res = await fetch('/attack-list/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      manualResults = data;
      showingManual = true;
      closeManualModal();
      renderManualResults();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Run It';
    }
  }

  function clearManualResults() {
    manualResults = null;
    showingManual = false;
    document.getElementById('tab-manual').style.display = 'none';
    currentTab = 'all';
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-all').classList.add('active');
    renderData();
    if (allData) {
      document.getElementById('headerSub').textContent = allData.yards.length + ' yards scored';
      const ts = new Date(allData.generated_at);
      document.getElementById('statusLeft').textContent = 'Updated ' + ts.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    }
  }

  function renderManualResults() {
    if (!manualResults) return;

    // Show and activate the MANUAL tab
    const manualTab = document.getElementById('tab-manual');
    manualTab.style.display = '';
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    manualTab.classList.add('active');
    currentTab = 'manual';

    const vehicles = manualResults.vehicles || [];
    document.getElementById('headerSub').textContent = 'MANUAL LIST — ' + vehicles.length + ' scored';
    document.getElementById('statusLeft').textContent = 'Manual list · ' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});

    const hotV = vehicles.filter(v => v.color_code === 'green' || v.color_code === 'yellow').length;
    document.getElementById('statusRight').textContent = vehicles.length + ' vehicles · ' + hotV + ' flagged';

    let html = '';

    // Banner
    html += `<div class="manual-banner">
      <span>MANUAL SET LIST — ${manualResults.parsed_count} vehicles${manualResults.skipped_count > 0 ? ' (' + manualResults.skipped_count + ' skipped)' : ''}</span>
      <button onclick="clearManualResults()">Back to Yards</button>
    </div>`;

    if (vehicles.length === 0) {
      html += '<div class="empty-state"><h3>No scoreable vehicles</h3><p>None of the parsed vehicles matched parts in the database.</p></div>';
      document.getElementById('mainContent').innerHTML = html;
      return;
    }

    // Group by date section (all manual are "today" — group by score tier instead)
    const sections = [
      { label: 'PULL', vehicles: vehicles.filter(v => v.vehicle_verdict === 'PULL'), cls: 'chip-green' },
      { label: 'WATCH', vehicles: vehicles.filter(v => v.vehicle_verdict === 'WATCH'), cls: 'chip-yellow' },
      { label: 'CONSIDER', vehicles: vehicles.filter(v => v.vehicle_verdict === 'CONSIDER'), cls: 'chip-orange' },
      { label: 'SKIP', vehicles: vehicles.filter(v => v.vehicle_verdict === 'SKIP'), cls: 'chip-gray' },
    ];

    html += '<div class="vehicle-list">';
    for (const sec of sections) {
      if (sec.vehicles.length === 0) continue;
      html += `<div style="padding:6px 14px;background:#1a1a1a;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.05em;display:flex;justify-content:space-between;">
        <span>${sec.label}</span><span>${sec.vehicles.length}</span></div>`;
      for (const v of sec.vehicles) {
        html += renderVehicle(v);
      }
    }
    html += '</div>';

    document.getElementById('mainContent').innerHTML = html;
  }

  // === Inline VIN Scanner (no page navigation = no memory crash) ===
  function openVinModal() {
    document.getElementById('vinModal').classList.add('open');
    document.getElementById('vinResults').innerHTML = '';
    document.getElementById('vinStatus').textContent = '';
    var vi = document.getElementById('vinInput');
    vi.value = '';
    setTimeout(function(){ vi.focus(); }, 100);
  }
  function closeVinModal() {
    document.getElementById('vinModal').classList.remove('open');
  }

  // Camera photo processing — Image+canvas, resize aggressively for mobile memory
  async function processVinPhoto(file) {
    try {
      var url = URL.createObjectURL(file);
      var img = new Image();
      await new Promise(function(resolve, reject) { img.onload = resolve; img.onerror = function() { reject(new Error('Failed to load image')); }; img.src = url; });
      var MAX_DIM = 1280;
      var w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w > h) { h = Math.round(h * (MAX_DIM / w)); w = MAX_DIM; }
        else { w = Math.round(w * (MAX_DIM / h)); h = MAX_DIM; }
      }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url); img.src = '';
      var b64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
      if (b64.length > 1500000) {
        canvas.width = Math.round(w * 0.5); canvas.height = Math.round(h * 0.5);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        b64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 1; canvas.height = 1;
      return b64;
    } catch(err) {
      throw new Error('Could not process photo: ' + err.message);
    }
  }

  document.getElementById('vinCamBtn').onclick = function() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
    inp.onchange = async function(e) {
      var file = e.target.files[0]; if (!file) return;
      document.getElementById('vinStatus').textContent = 'Reading VIN from photo...';
      document.getElementById('vinResults').innerHTML = '<div class="vin-card" style="text-align:center"><div class="spinner"></div><div style="margin-top:6px;color:var(--text-muted);font-size:12px">Processing...</div></div>';
      try {
        var b64 = await processVinPhoto(file);
        var r = await fetch('/vin/decode-photo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({image:b64})}).then(function(r){ return r.json(); });
        b64 = null;
        if (r.vin && r.vin !== 'UNREADABLE' && r.vin.length >= 11) {
          document.getElementById('vinInput').value = r.vin;
          document.getElementById('vinStatus').textContent = 'VIN read: ' + r.vin;
          vinDecode('camera');
        } else {
          document.getElementById('vinStatus').textContent = 'Could not read VIN. Try closer.';
          document.getElementById('vinResults').innerHTML = '<div class="vin-card" style="text-align:center;color:var(--red);font-weight:600">Could not read VIN<div style="color:var(--text-muted);font-size:12px;font-weight:400;margin-top:4px">Avoid glare, try door jamb sticker.</div></div>';
        }
      } catch(err) {
        document.getElementById('vinStatus').textContent = 'Error: ' + err.message;
        document.getElementById('vinResults').innerHTML = '<div class="vin-card" style="color:var(--red)">Error: ' + err.message + '</div>';
      }
    };
    inp.click();
  };

  function vinDecode(src) {
    var vin = document.getElementById('vinInput').value.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
    if (vin.length < 11) { document.getElementById('vinResults').innerHTML = '<div class="vin-card" style="color:var(--red);font-size:13px">Enter at least 11 characters</div>'; return; }
    var btn = document.getElementById('vinDecBtn');
    btn.disabled = true; btn.innerHTML = '<div class="spinner" style="margin:0 auto"></div>';
    document.getElementById('vinResults').innerHTML = '<div class="vin-card" style="text-align:center"><div class="spinner"></div><div style="margin-top:6px;color:var(--text-muted);font-size:12px">Decoding...</div></div>';
    fetch('/vin/scan', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({vin:vin, source:src||'manual'}) })
    .then(function(r){ return r.json(); })
    .then(function(data) {
      if (!data.success) throw new Error(data.error);
      vinRender(data);
    })
    .catch(function(err) {
      document.getElementById('vinResults').innerHTML = '<div class="vin-card" style="color:var(--red)">Error: ' + err.message + '</div>';
    })
    .finally(function() { btn.disabled = false; btn.textContent = 'Decode'; });
  }

  function vinRender(data) {
    var d = data.decoded || {}, sh = data.salesHistory || [], cs = data.currentStock || [], mr = data.marketRef || [];
    var h = '';
    // Vehicle header
    var hl = [d.year, d.make, data.baseModel || d.model].filter(Boolean).join(' ');
    var sp = [d.engine, d.engineType && d.engineType !== 'Gas' ? d.engineType : null, d.drivetrain, d.trim].filter(Boolean).join(' · ');
    h += '<div class="vin-card"><div style="font-size:20px;font-weight:900;letter-spacing:-0.03em">' + hl + '</div>';
    if (sp) h += '<div style="font-size:12px;font-weight:600;color:var(--text-mid);margin-top:2px">' + sp + '</div>';
    h += '<div style="font-family:monospace;font-size:13px;color:var(--green);font-weight:700;margin-top:4px">' + data.vin + '</div></div>';

    // Build unified parts
    var pm = {};
    sh.forEach(function(s) { if (s.partType) pm[s.partType] = { pt:s.partType, sold:s.sold, avg:s.avgPrice, last:s.lastSoldDate, title:s.sampleTitle, stk:0, mp:0 }; });
    cs.forEach(function(c) { if (!c.partType) return; if (pm[c.partType]) pm[c.partType].stk = c.inStock; else pm[c.partType] = { pt:c.partType, sold:0, avg:0, last:null, title:null, stk:c.inStock, mp:c.avgPrice }; });
    mr.filter(function(m) { return !m.isRebuild && m.partType; }).forEach(function(m) {
      if (pm[m.partType]) { pm[m.partType].mp = m.avgPrice; if (!pm[m.partType].stk) pm[m.partType].stk = m.inStock || 0; }
      else pm[m.partType] = { pt:m.partType, sold:m.yourSold||0, avg:m.yourAvg||m.avgPrice, last:null, title:null, stk:m.inStock||0, mp:m.avgPrice };
    });
    var parts = [];
    for (var k in pm) { var p = pm[k]; if (p.pt && p.pt !== 'OTHER' && p.pt !== 'null' && (p.avg > 0 || p.mp > 0 || p.sold > 0)) parts.push(p); }
    parts.sort(function(a, b) { return (b.avg || b.mp) - (a.avg || a.mp); });
    var tot = 0;

    h += '<div class="vin-card"><div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Parts Intelligence</div>';
    if (parts.length > 0) {
      parts.forEach(function(p) {
        var price = p.avg || p.mp || 0; tot += price;
        var vd = price >= 250 ? 'GREAT' : price >= 150 ? 'GOOD' : price >= 100 ? 'FAIR' : 'POOR';
        var cls = vd === 'GREAT' ? 'chip-green' : vd === 'GOOD' ? 'chip-yellow' : vd === 'FAIR' ? 'chip-orange' : 'chip-red';
        var badge = '';
        if (p.stk === 0 && p.sold >= 2) badge = '<span class="chip chip-green" style="font-size:9px">PULL THIS</span> ';
        else if (p.stk === 0 && p.sold >= 1) badge = '<span class="chip chip-yellow" style="font-size:9px">NEED</span> ';
        else if (p.stk > 0) badge = '<span class="chip chip-gray" style="font-size:9px">' + p.stk + ' stk</span> ';
        h += '<div style="padding:8px 0;border-bottom:1px solid var(--border)">';
        h += '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">' + badge + '<span class="chip ' + cls + '">' + vd + ' $' + price + '</span> <span style="font-size:13px;font-weight:700">[' + p.pt + ']</span></div>';
        if (p.title) h += '<div style="font-size:11px;color:var(--text-mid);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (p.title || '').substring(0, 60) + '</div>';
        h += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' + p.stk + ' in stock · ' + p.sold + 'x sold</div>';
        h += '</div>';
      });
    } else {
      h += '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:8px 0">No parts data for this vehicle yet</div>';
    }
    h += '</div>';

    // Est. Haul Value
    if (tot > 0) {
      var vc = tot >= 800 ? 'var(--green)' : tot >= 500 ? '#eab308' : tot >= 250 ? '#f97316' : '#ef4444';
      h += '<div class="vin-card" style="text-align:center"><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em">Est. Haul Value</div>';
      h += '<div style="font-size:28px;font-weight:800;color:' + vc + ';margin-top:2px">$' + tot + '</div>';
      var pc = parts.filter(function(p) { return p.stk === 0 && p.sold >= 2; }).length;
      if (pc > 0) h += '<div style="font-size:11px;color:var(--green);margin-top:2px">' + pc + ' part' + (pc > 1 ? 's' : '') + ' we need</div>';
      h += '</div>';
    }

    // Scan Another
    h += '<div style="padding:4px 0"><button class="btn-primary" style="width:100%;padding:12px;font-size:14px;" onclick="document.getElementById(\'vinInput\').value=\'\';document.getElementById(\'vinInput\').focus();document.getElementById(\'vinResults\').innerHTML=\'\';">Scan Another</button></div>';
    document.getElementById('vinResults').innerHTML = h;
  }

  document.getElementById('vinInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') vinDecode(); });

  // Boot
  loadData();

  // PWA service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/admin/sw.js').catch(() => {});
  }
</script>
</body>
</html>
```
---
## FILE: service/public/hunters-perch.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk — HUNTERS PERCH</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh}
header{background:#141414;border-bottom:1px solid #2a2a2a;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}
nav{display:flex;gap:6px;padding:6px 14px;background:#0a0a0a;border-bottom:1px solid #2a2a2a;overflow-x:auto;scrollbar-width:none;font-size:11px}
nav::-webkit-scrollbar{display:none}
nav a{color:#9CA3AF;text-decoration:none;padding:4px 8px;border-radius:4px;white-space:nowrap;background:#1a1a1a}
nav a.active{color:#DC2626;font-weight:700}
.container{padding:12px;max-width:800px;margin:0 auto}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:10px}
.add-row{display:flex;gap:8px}
.add-input{flex:1;padding:10px;border:1px solid #333;border-radius:8px;font-size:13px;background:#141414;color:#F0F0F0;outline:none}
.add-input:focus{border-color:#dc2626}
.btn{padding:8px 14px;border-radius:6px;border:none;font-size:12px;font-weight:700;cursor:pointer}
.btn-red{background:#dc2626;color:#fff}
.btn-sm{padding:6px 10px;font-size:11px;border-radius:4px;border:1px solid #333;background:#1a1a1a;color:#d1d5db;cursor:pointer}
.btn-sm:disabled{opacity:.3}
.seller-card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;margin-bottom:12px;overflow:hidden}
.seller-header{padding:12px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #2a2a2a;cursor:pointer}
.seller-name{font-size:14px;font-weight:700}
.seller-stats{font-size:10px;color:#6B7280}
.seller-body{padding:0}
.item-row{padding:8px 14px;border-bottom:1px solid #1f1f1f;display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.item-row:last-child{border-bottom:none}
.item-title{font-size:12px;font-weight:600;flex:1;line-height:1.3}
.item-price{font-size:13px;font-weight:700;color:#22c55e;white-space:nowrap}
.item-meta{font-size:10px;color:#6B7280;margin-top:2px}
.badge{font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;text-transform:uppercase}
.b-hot{background:#7f1d1d;color:#dc2626}
.b-good{background:#064e3b;color:#22c55e}
.spinner{width:16px;height:16px;border:2px solid #333;border-top-color:#dc2626;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;color:#6B7280;padding:30px;font-size:13px}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('perch')</script>
<div class="container">
  <div id="scrapeAlerts" style="display:none"></div>
  <div class="card" id="gapCard" style="border-color:#dc2626;margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div>
        <div style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.06em">NEW INTEL - Parts We've Never Stocked</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px">Parts competitors sell that are not in our database</div>
      </div>
      <button class="btn-sm" onclick="loadGapIntel()" id="gapRefresh">Refresh</button>
    </div>
    <div id="sellerFilterRow" style="display:flex;gap:6px;margin-bottom:8px">
      <select id="sellerFilter" onchange="applySellerFilter()" style="flex:1;padding:6px 8px;border:1px solid #333;border-radius:6px;font-size:11px;background:#1a1a1a;color:#F0F0F0;outline:none">
        <option value="">All sellers</option>
      </select>
    </div>
    <div id="gapLoading" style="text-align:center;padding:16px"><div class="spinner"></div></div>
    <div id="gapResults" style="display:none"></div>
  </div>
  <div class="card" id="emergingCard" style="border-color:#f59e0b;margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div>
        <div style="font-size:10px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.06em">EMERGING - New & Accelerating Parts</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px">Parts appearing for the first time or gaining momentum</div>
      </div>
    </div>
    <div id="emergingLoading" style="text-align:center;padding:16px"><div class="spinner"></div></div>
    <div id="emergingResults" style="display:none"></div>
  </div>
  <div class="card">
    <div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Track a Competitor</div>
    <div class="add-row">
      <input type="text" class="add-input" id="addInput" placeholder="eBay seller ID (e.g. instrumentclusterstore)" autocomplete="off">
      <button class="btn btn-red" id="addBtn" onclick="addSeller()">Track</button>
    </div>
    <div style="font-size:10px;color:#6B7280;margin-top:8px">Only items $100+ are stored. Data auto-purges after 90 days (importapart & pro-rebuild are permanent).</div>
    <div style="margin-top:8px"><button class="btn-sm" id="scrapeAllBtn" onclick="scrapeAll(this)">Scrape All Sellers</button></div>
  </div>
  <div id="loading" style="text-align:center;padding:30px"><div class="spinner"></div></div>
  <div id="sellers"></div>
</div>
<script>
var sellersData = [];
var currentSellerFilter = '';

function populateSellerFilter(sellers) {
  var sel = document.getElementById('sellerFilter');
  if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  sellers.forEach(function(s) {
    if (s.soldItemCount > 0) {
      var opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.name + ' (' + s.soldItemCount + ')';
      sel.appendChild(opt);
    }
  });
}

function applySellerFilter() {
  currentSellerFilter = document.getElementById('sellerFilter').value;
  loadGapIntel();
  loadEmerging();
}

function showScrapeAlerts(alerts) {
  var el = document.getElementById('scrapeAlerts');
  if (!alerts || alerts.length === 0) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  var h = '';
  alerts.forEach(function(a) {
    h += '<div class="card" style="border-color:#dc2626;padding:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">';
    h += '<div style="font-size:12px;color:#dc2626"><strong>' + esc(a.seller) + '</strong>: ' + esc(a.message) + '</div>';
    h += '<button class="btn-sm" style="font-size:9px;color:#6B7280" onclick="this.closest(\'.card\').remove()">✕</button>';
    h += '</div>';
  });
  el.innerHTML = h;
}

function loadEmerging() {
  var results = document.getElementById('emergingResults');
  var loading = document.getElementById('emergingLoading');
  loading.style.display = 'block';
  results.style.display = 'none';
  fetch('/competitors/emerging?days=90&limit=30' + (currentSellerFilter ? '&seller=' + encodeURIComponent(currentSellerFilter) : ''))
    .then(function(r) { return r.json(); })
    .then(function(d) {
      loading.style.display = 'none';
      results.style.display = 'block';
      if (!d.success || !d.emerging || d.emerging.length === 0) {
        results.innerHTML = '<div class="empty">No emerging parts detected yet. Run a scrape to populate competitor data.</div>';
        return;
      }
      var h = '<div style="padding:6px 0;font-size:10px;color:#6B7280;border-bottom:1px solid #2a2a2a;margin-bottom:6px">' + d.newCount + ' new on scene · ' + d.accelCount + ' accelerating</div>';
      d.emerging.forEach(function(item) {
        var signalBadge = item.signal === 'NEW' ? '<span class="badge" style="background:#1e3a5f;color:#3b82f6">NEW</span> ' : '<span class="badge" style="background:#422006;color:#f59e0b">ACCEL ' + item.recentCount + 'x</span> ';
        var pn = item.partNumber ? '<span style="font-family:monospace;font-size:11px;color:#f59e0b;background:#422006;padding:1px 5px;border-radius:3px;margin-right:4px">' + esc(item.partNumber) + '</span>' : '';
        var ptBadge = item.partType ? '<span style="font-size:9px;font-weight:700;color:#a78bfa;background:#2e1065;padding:1px 5px;border-radius:3px;margin-right:4px">' + esc(item.partType) + '</span>' : '';
        var sellerList = item.sellers.slice(0, 3).join(', ');
        var searchUrl = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent((item.title || '').substring(0, 60)) + '&_sacat=6030&LH_Sold=1&LH_Complete=1';
        h += '<div class="item-row" style="align-items:center">';
        h += '<div style="min-width:36px;text-align:center"><div style="font-size:16px;font-weight:800;color:#f59e0b;background:#422006;border-radius:6px;padding:4px 6px">' + item.signalStrength + '</div></div>';
        h += '<div style="flex:1;min-width:0;padding-left:8px"><div class="item-title">' + signalBadge + '<a href="' + searchUrl + '" target="_blank" rel="noopener" style="color:#F0F0F0;text-decoration:none">' + esc(item.title || '') + '</a></div>';
        h += '<div class="item-meta">' + ptBadge + pn + item.totalCount + 'x sold by ' + esc(sellerList) + ' · $' + item.medianPrice + ' median · $' + item.totalRevenue.toLocaleString() + ' rev</div></div>';
        h += '<div style="text-align:right"><div class="item-price">$' + item.medianPrice + '<div style="font-size:9px;color:#6B7280;font-weight:400">median</div></div>';
        h += '<button class="btn-sm" style="font-size:9px;padding:2px 6px;margin-top:3px;color:#22c55e;border-color:#22c55e" onclick="markItem(\'' + esc(item.title).replace(/\'/g, "\\'") + '\',\'' + esc(item.partNumber || '').replace(/\'/g, "\\'") + '\',\'' + esc(item.partType || '').replace(/\'/g, "\\'") + '\',' + (item.medianPrice || 0) + ',\'emerging\',' + JSON.stringify(item.sellers) + ',' + item.signalStrength + ',this)">+ Mark</button>';
        h += '<button class="btn-sm" style="font-size:9px;padding:2px 6px;margin-top:3px;color:#6B7280" onclick="dismissIntel(\'' + esc(item.title).replace(/\'/g, "\\'") + '\',this)">✕</button></div>';
        h += '</div>';
      });
      results.innerHTML = h;
    })
    .catch(function(err) {
      loading.style.display = 'none';
      results.style.display = 'block';
      results.innerHTML = '<div class="empty" style="color:#dc2626">Error: ' + err.message + '</div>';
    });
}

function loadGapIntel() {
  var gapResults = document.getElementById('gapResults');
  var gapLoading = document.getElementById('gapLoading');
  gapLoading.style.display = 'block';
  gapResults.style.display = 'none';

  fetch('/competitors/gap-intel?days=90&limit=30' + (currentSellerFilter ? '&seller=' + encodeURIComponent(currentSellerFilter) : ''))
    .then(function(r) { return r.json(); })
    .then(function(d) {
      gapLoading.style.display = 'none';
      gapResults.style.display = 'block';

      if (!d.success || !d.gaps || d.gaps.length === 0) {
        gapResults.innerHTML = '<div class="empty">No competitor data yet — run a scrape to populate.</div>';
        return;
      }

      var h = '<div style="padding:6px 0;font-size:10px;color:#6B7280;border-bottom:1px solid #2a2a2a;margin-bottom:6px">' + d.totalGaps + ' parts found that we have never stocked or sold</div>';

      d.gaps.forEach(function(gap) {
        var scoreColor = gap.score >= 70 ? '#22c55e' : gap.score >= 40 ? '#eab308' : '#6B7280';
        var scoreBg = gap.score >= 70 ? '#064e3b' : gap.score >= 40 ? '#422006' : '#1a1a1a';
        var badge = gap.soldCount >= 3 ? '<span class="badge b-hot">HOT ' + gap.soldCount + 'x</span> ' : '';
        var confluenceBadge = gap.confluence ? '<span class="badge" style="background:#1e3a5f;color:#60a5fa">' + gap.sellerCount + ' SELLERS</span> ' : '';
        var sellerList = gap.sellers.slice(0, 4).join(', ');
        var searchUrl = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent((gap.title || '').substring(0, 60)) + '&_sacat=6030&LH_Sold=1&LH_Complete=1';
        var pn = gap.partNumber ? '<span style="font-family:monospace;font-size:11px;color:#f59e0b;background:#422006;padding:1px 5px;border-radius:3px;margin-right:4px">' + esc(gap.partNumber) + '</span>' : '';
        var ptBadge = gap.partType ? '<span style="font-size:9px;font-weight:700;color:#a78bfa;background:#2e1065;padding:1px 5px;border-radius:3px;margin-right:4px">' + esc(gap.partType) + '</span>' : '';

        h += '<div class="item-row" style="align-items:center' + (gap.confluence ? ';border-left:3px solid #3b82f6' : '') + '">';
        h += '<div style="min-width:36px;text-align:center"><div style="font-size:16px;font-weight:800;color:' + scoreColor + ';background:' + scoreBg + ';border-radius:6px;padding:4px 6px;font-variant-numeric:tabular-nums">' + gap.score + '</div></div>';
        h += '<div style="flex:1;min-width:0;padding-left:8px"><div class="item-title">' + confluenceBadge + badge + '<a href="' + searchUrl + '" target="_blank" rel="noopener" style="color:#F0F0F0;text-decoration:none">' + esc(gap.title || '') + '</a></div>';
        var yardIcon = gap.yardMatch ? '<span title="Vehicle make in local yard" style="margin-right:4px">📍</span>' : '';
        h += '<div class="item-meta">' + yardIcon + ptBadge + pn + gap.soldCount + 'x sold by ' + esc(sellerList) + ' · $' + gap.medianPrice + ' median · $' + gap.totalRevenue.toLocaleString() + ' rev</div></div>';
        h += '<div style="text-align:right"><div class="item-price">$' + gap.medianPrice + '<div style="font-size:9px;color:#6B7280;font-weight:400">median</div></div>';
        h += '<button class="btn-sm" style="font-size:9px;padding:2px 6px;margin-top:3px;color:#22c55e;border-color:#22c55e" onclick="markItem(\'' + esc(gap.title).replace(/\'/g, "\\'") + '\',\'' + esc(gap.partNumber || '').replace(/\'/g, "\\'") + '\',\'' + esc(gap.partType || '').replace(/\'/g, "\\'") + '\',' + (gap.medianPrice || 0) + ',\'gap-intel\',' + JSON.stringify(gap.sellers) + ',' + gap.score + ',this)">+ Mark</button>';
        h += '<button class="btn-sm" style="font-size:9px;padding:2px 6px;margin-top:3px;color:#6B7280" onclick="dismissIntel(\'' + esc(gap.title).replace(/\'/g, "\\'") + '\',this)">✕</button></div>';
        h += '</div>';
      });

      gapResults.innerHTML = h;
    })
    .catch(function(err) {
      gapLoading.style.display = 'none';
      gapResults.style.display = 'block';
      gapResults.innerHTML = '<div class="empty" style="color:#dc2626">Error: ' + err.message + '</div>';
    });
}

function load() {
  fetch('/competitors/sellers')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      document.getElementById('loading').style.display = 'none';
      if (!d.success || !d.sellers) { document.getElementById('sellers').innerHTML = '<div class="empty">Could not load sellers</div>'; return; }
      sellersData = d.sellers;
      populateSellerFilter(d.sellers);
      if (d.scrapeAlerts) showScrapeAlerts(d.scrapeAlerts);
      renderSellers();
    })
    .catch(function(err) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('sellers').innerHTML = '<div class="empty">Error: ' + err.message + '</div>';
    });
}

function renderSellers() {
  if (sellersData.length === 0) {
    document.getElementById('sellers').innerHTML = '<div class="empty">No competitors tracked yet. Add one above.</div>';
    return;
  }
  var h = '';
  sellersData.forEach(function(s) {
    h += '<div class="seller-card" id="seller-' + esc(s.name) + '">';
    h += '<div class="seller-header" onclick="toggleSeller(\'' + esc(s.name) + '\')">';
    h += '<div><div class="seller-name">' + esc(s.name) + '</div>';
    var healthColor = '#6B7280';
    if (s.lastScrapedAt) {
      var hoursAgo = Math.floor((Date.now() - new Date(s.lastScrapedAt).getTime()) / 3600000);
      if (hoursAgo > 48) healthColor = '#dc2626';
      else if (hoursAgo > 24) healthColor = '#eab308';
      else healthColor = '#22c55e';
    }
    h += '<div class="seller-stats"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + healthColor + ';margin-right:4px"></span>' + (s.soldItemCount || 0) + ' items tracked';
    if (s.lastScrapedAt) {
      var d = Math.floor((Date.now() - new Date(s.lastScrapedAt).getTime()) / 3600000);
      h += ' · scraped ' + (d < 1 ? 'just now' : d < 24 ? d + 'h ago' : Math.floor(d/24) + 'd ago');
    }
    h += '</div></div>';
    h += '<div style="display:flex;gap:6px">';
    h += '<a href="https://www.ebay.com/sch/i.html?_ssn=' + encodeURIComponent(s.name) + '&LH_Sold=1&LH_Complete=1&_ipg=240" target="_blank" rel="noopener" class="btn-sm" style="text-decoration:none;display:flex;align-items:center" onclick="event.stopPropagation()">Store ↗</a>';
    h += '<button class="btn-sm" onclick="event.stopPropagation();scrapeSeller(\'' + esc(s.name) + '\',this)">Scrape</button>';
    h += '<button class="btn-sm" style="color:#dc2626;border-color:#dc2626" onclick="event.stopPropagation();removeSeller(\'' + esc(s.name) + '\',this)">✕</button>';
    h += '</div></div>';
    h += '<div class="seller-body" id="body-' + esc(s.name) + '" style="display:none"></div>';
    h += '</div>';
  });
  document.getElementById('sellers').innerHTML = h;
}

function toggleSeller(name) {
  var body = document.getElementById('body-' + name);
  if (body.style.display === 'none') {
    body.style.display = 'block';
    if (!body.dataset.loaded) {
      body.innerHTML = '<div style="padding:12px;text-align:center"><div class="spinner"></div></div>';
      loadBestSellers(name);
    }
  } else {
    body.style.display = 'none';
  }
}

function loadBestSellers(name) {
  fetch('/competitors/' + encodeURIComponent(name) + '/best-sellers?days=90')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var body = document.getElementById('body-' + name);
      body.dataset.loaded = '1';
      if (!d.success || !d.bestSellers || d.bestSellers.length === 0) {
        body.innerHTML = '<div style="padding:12px;color:#6B7280;font-size:12px;text-align:center">No sold items. Scrape this seller first.</div>';
        return;
      }
      var h = '<div style="padding:8px 14px;font-size:10px;color:#6B7280;border-bottom:1px solid #2a2a2a">' + d.totalSold + ' sold · $' + d.totalRevenue.toLocaleString() + ' revenue · ' + d.uniqueProducts + ' products (90d)</div>';
      d.bestSellers.slice(0, 30).forEach(function(item) {
        var hot = item.soldCount >= 3 ? '<span class="badge b-hot">HOT ' + item.soldCount + 'x</span> ' : '';
        // Clean title for search — remove mileage specifics
        var searchTitle = (item.title || '').replace(/\d{1,3},?\d{3}\s*miles?/gi, '').replace(/\s+/g, ' ').trim();
        // Build eBay URL with seller filter (_ssn) + full title
        var searchUrl = 'https://www.ebay.com/sch/i.html?_ssn=' + encodeURIComponent(name) + '&_nkw=' + encodeURIComponent(searchTitle) + '&LH_Sold=1&LH_Complete=1&_ipg=240';
        // Direct item link if we have eBay item ID
        var itemUrl = item.ebayItemId ? 'https://www.ebay.com/itm/' + item.ebayItemId : searchUrl;
        h += '<div class="item-row">';
        h += '<div style="flex:1;min-width:0"><div class="item-title"><a href="' + itemUrl + '" target="_blank" rel="noopener" style="color:#F0F0F0;text-decoration:none">' + hot + esc(item.title || '') + '</a></div>';
        h += '<div class="item-meta">$' + item.avgPrice + ' avg · ' + item.soldCount + 'x sold · $' + item.totalRevenue.toLocaleString() + ' rev · ' + item.velocity + '/wk · <a href="' + searchUrl + '" target="_blank" rel="noopener" style="color:#3b82f6;font-size:9px">eBay ↗</a></div></div>';
        h += '<div class="item-price">$' + item.avgPrice + '<div style="font-size:9px;color:#6B7280;font-weight:400">avg</div></div>';
        h += '</div>';
      });
      body.innerHTML = h;
    })
    .catch(function() {
      document.getElementById('body-' + name).innerHTML = '<div style="padding:12px;color:#dc2626;font-size:12px">Failed to load</div>';
    });
}

function scrapeSeller(name, btn) {
  btn.disabled = true; btn.textContent = 'Scraping...';
  fetch('/competitors/' + encodeURIComponent(name) + '/scrape', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function() {
      btn.textContent = 'Scraping eBay...';
      // Poll every 10s for up to 2 minutes until new data appears
      var attempts = 0;
      var poll = setInterval(function() {
        attempts++;
        fetch('/competitors/' + encodeURIComponent(name) + '/best-sellers?days=90')
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.totalSold > 0 || attempts >= 12) {
              clearInterval(poll);
              btn.disabled = false; btn.textContent = 'Scrape';
              // Refresh seller data and auto-expand
              var body = document.getElementById('body-' + name);
              if (body) { body.dataset.loaded = ''; body.style.display = 'block'; loadBestSellers(name); }
              load(); // refresh seller list for updated counts
            }
          }).catch(function() {});
      }, 10000);
    })
    .catch(function() { btn.disabled = false; btn.textContent = 'Scrape'; });
}

function removeSeller(name, btn) {
  if (!confirm('Remove ' + name + ' from tracking?\n\nClick OK to keep their data for gap intel.\nTheir sold history will remain in the database.')) return;
  btn.disabled = true; btn.textContent = '...';
  fetch('/competitors/' + encodeURIComponent(name), { method: 'DELETE' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success) {
        sellersData = sellersData.filter(function(s) { return s.name !== name; });
        renderSellers();
      } else {
        btn.disabled = false; btn.textContent = '✕';
      }
    })
    .catch(function() { btn.disabled = false; btn.textContent = '✕'; });
}

function addSeller() {
  var inp = document.getElementById('addInput');
  var name = inp.value.trim().toLowerCase();
  if (!name) return;
  var btn = document.getElementById('addBtn');
  btn.disabled = true; btn.textContent = '...';
  fetch('/competitors/' + encodeURIComponent(name) + '/scrape', { method: 'POST' })
    .then(function() {
      inp.value = '';
      btn.disabled = false; btn.textContent = 'Track';
      // Add to SoldItemSeller table
      return fetch('/competitors/sellers');
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success) { sellersData = d.sellers; renderSellers(); }
    })
    .catch(function() { btn.disabled = false; btn.textContent = 'Track'; });
}

function scrapeAll(btn) {
  btn.disabled = true;
  btn.textContent = 'Scraping all...';
  fetch('/competitors/auto-scrape', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      btn.disabled = false;
      btn.textContent = 'Scrape All Sellers';
      if (d.success) {
        var summary = (d.results || []).map(function(r) { return r.seller + ': ' + (r.scraped || 0) + ' scraped'; }).join(', ');
        alert('Scrape complete! ' + summary);
        load();
        loadGapIntel();
        loadEmerging();
      }
    })
    .catch(function() { btn.disabled = false; btn.textContent = 'Scrape All Sellers'; });
}

function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function markItem(title, partNumber, partType, medianPrice, sourceSignal, sellers, score, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  fetch('/competitors/mark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: title,
      partNumber: partNumber || null,
      partType: partType || null,
      medianPrice: medianPrice || null,
      sourceSignal: sourceSignal || 'gap-intel',
      sourceSellers: sellers || null,
      score: score || null,
    }),
  })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success) {
        // Remove the card from DOM — marked items are filtered from gap-intel
        var row = btn.closest('.item-row');
        if (row) {
          row.style.transition = 'opacity 0.3s';
          row.style.opacity = '0';
          setTimeout(function() { row.remove(); }, 300);
        } else {
          btn.textContent = '✓';
          btn.style.color = '#22c55e';
          btn.style.borderColor = '#22c55e';
          btn.disabled = true;
        }
      } else { btn.disabled = false; btn.textContent = '+ Mark'; }
    })
    .catch(function() { btn.disabled = false; btn.textContent = '+ Mark'; });
}

function dismissIntel(title, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  fetch('/competitors/dismiss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title }),
  })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success) {
        var row = btn.closest('.item-row');
        if (row) { row.style.transition = 'opacity 0.3s'; row.style.opacity = '0'; setTimeout(function() { row.remove(); }, 300); }
      } else { btn.disabled = false; btn.textContent = '✕'; }
    })
    .catch(function() { btn.disabled = false; btn.textContent = '✕'; });
}

load();
loadGapIntel();
loadEmerging();
</script>
</body>
</html>
```
---
## FILE: service/public/scout-alerts.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk — SCOUT ALERTS</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh}
header{background:#141414;border-bottom:1px solid #2a2a2a;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}
nav{display:flex;gap:6px;padding:6px 14px;background:#0a0a0a;border-bottom:1px solid #2a2a2a;overflow-x:auto;scrollbar-width:none;font-size:11px}
nav::-webkit-scrollbar{display:none}
nav a{color:#9CA3AF;text-decoration:none;padding:4px 8px;border-radius:4px;white-space:nowrap;background:#1a1a1a}
nav a.active{color:#DC2626;font-weight:700}
.tabs{display:flex;background:#141414;border-bottom:1px solid #2a2a2a;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.tabs::-webkit-scrollbar{display:none}
.tab{padding:11px 16px;font-size:12px;font-weight:600;color:#9CA3AF;cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;flex-shrink:0}
.tab.active{color:#F0F0F0;border-bottom-color:#DC2626}
.pill-bar{display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 16px;background:#0a0a0a;border-bottom:1px solid #2a2a2a;font-size:11px;overflow-x:auto;scrollbar-width:none}
.pill-bar::-webkit-scrollbar{display:none}
.pill{padding:4px 10px;border-radius:4px;border:1px solid #333;background:#1a1a1a;color:#9CA3AF;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
.pill.active{background:#dc2626;color:#fff;border-color:#dc2626}
.container{padding:12px;max-width:700px;margin:0 auto}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:10px}
.badge{font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;text-transform:uppercase;white-space:nowrap}
.b-high{background:#064e3b;color:#22c55e}
.b-med{background:#713f12;color:#eab308}
.b-low{background:#7c2d12;color:#ea580c}
.b-bone{background:#dc2626;color:#fff;font-size:8px;letter-spacing:0.05em}
.b-perch{background:#ea580c;color:#fff;font-size:8px;letter-spacing:0.05em}
.b-mark{background:#eab308;color:#78350f;font-size:8px;letter-spacing:0.05em;font-weight:800}
.b-sold{background:#16a34a;color:#fff;font-size:8px;letter-spacing:0.05em}
.b-overstock{background:#F59E0B;color:#78350F;font-size:8px;letter-spacing:0.05em;font-weight:800}
.yard-header{padding:10px 0;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #dc2626;margin-bottom:8px}
.yard-name{font-size:15px;font-weight:800;color:#F0F0F0}
.yard-count{font-size:11px;color:#9CA3AF}
.alert-row{padding:10px 0;border-bottom:1px solid #1f1f1f;display:flex;align-items:flex-start;gap:8px}
.alert-row:last-child{border-bottom:none}
.alert-row.claimed{opacity:0.45}
.alert-info{flex:1;min-width:0}
.claim-check{width:32px;height:32px;border-radius:6px;border:2px solid #333;background:#1a1a1a;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;transition:all 0.15s}
.claim-check:active{transform:scale(0.9)}
.claim-check.checked{background:#064e3b;border-color:#22c55e}
.claim-check svg{width:18px;height:18px}
.alert-part{font-size:13px;font-weight:600;line-height:1.3}
.alert-vehicle{font-size:12px;color:#22c55e;font-weight:600;margin-top:3px}
.alert-meta{font-size:10px;color:#9CA3AF;margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.alert-notes{font-size:10px;color:#eab308;margin-top:2px;font-style:italic}
.btn-refresh{padding:8px 14px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#d1d5db;font-size:11px;font-weight:600;cursor:pointer}
.btn-refresh:active{opacity:.5}
.btn-refresh:disabled{opacity:.3}
.spinner{width:18px;height:18px;border:2px solid #333;border-top-color:#dc2626;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;color:#6B7280;padding:30px 10px;font-size:13px}
.pg-row{display:flex;justify-content:center;gap:8px;padding:12px 0}
.pg-btn{padding:8px 16px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#d1d5db;font-size:12px;font-weight:600;cursor:pointer}
.pg-btn.active{background:#dc2626;color:#fff;border-color:#dc2626}
.summary-bar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.summary-card{flex:1;min-width:70px;background:#141414;border:1px solid #2a2a2a;border-radius:8px;padding:8px 10px;text-align:center}
.summary-num{font-size:20px;font-weight:800;color:#F0F0F0}
.summary-label{font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:0.05em;margin-top:1px}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('alerts')</script>
<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 14px;background:#0a0a0a;border-bottom:1px solid #2a2a2a;">
  <div style="font-size:10px;color:#6B7280">SCOUT ALERTS <span id="alertCount" style="color:#dc2626;font-weight:700"></span></div>
  <div style="display:flex;align-items:center;gap:8px">
    <div id="lastUpdated" style="font-size:9px;color:#6B7280;text-align:right"></div>
    <button class="btn-refresh" id="refreshBtn" onclick="refreshAlerts()">Refresh</button>
  </div>
</div>
</nav>
<!-- Yard Tabs -->
<div class="tabs" id="yardTabs">
  <div class="tab active" onclick="setYard('all',this)">All</div>
  <div class="tab" onclick="setYard('Raleigh',this)">Raleigh</div>
  <div class="tab" onclick="setYard('Durham',this)">Durham</div>
  <div class="tab" onclick="setYard('Greensboro',this)">Greensboro</div>
  <div class="tab" onclick="setYard('East NC',this)">East NC</div>
  <div class="tab" onclick="setYard('Tampa',this)">Tampa</div>
  <div class="tab" onclick="setYard('Largo',this)">Largo</div>
  <div class="tab" onclick="setYard('Clearwater',this)">Clearwater</div>
</div>
<!-- Time Filter Pills -->
<div class="pill-bar">
  <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280">Set:</span>
  <button class="pill" onclick="setDays(0,this)">Today</button>
  <button class="pill" onclick="setDays(3,this)">3d</button>
  <button class="pill active" onclick="setDays(7,this)">7d</button>
  <button class="pill" onclick="setDays(30,this)">30d</button>
  <button class="pill" onclick="setDays(60,this)">60d</button>
  <button class="pill" onclick="setDays(90,this)">90d</button>
  <button class="pill" onclick="setDays(-1,this)">All</button>
</div>
<div style="display:flex;align-items:center;justify-content:flex-end;padding:6px 14px;background:#0a0a0a;font-size:11px">
  <label style="display:flex;align-items:center;gap:6px;color:#6B7280;cursor:pointer;user-select:none">
    <input type="checkbox" id="hidePulled" onchange="toggleHidePulled()" style="accent-color:#dc2626"> Hide pulled
  </label>
</div>
<div class="container">
  <div id="loading" style="text-align:center;padding:40px"><div class="spinner"></div><div style="margin-top:8px;color:#6B7280;font-size:12px">Loading alerts...</div></div>
  <div id="summary"></div>
  <div id="list"></div>
  <div id="pagination" class="pg-row"></div>
</div>
<script>
var currentPage = 1;
var currentYard = 'all';
var currentDays = 7;
var hidePulled = false;

function setYard(yard, el) {
  currentYard = yard;
  document.querySelectorAll('.tabs .tab').forEach(function(t) { t.classList.remove('active'); });
  el.classList.add('active');
  load(1);
}

function setDays(days, el) {
  currentDays = days === -1 ? 0 : (days === 0 ? 1 : days); // 0=today(1d), -1=all(0)
  if (days === -1) currentDays = 0;
  else if (days === 0) currentDays = 1;
  else currentDays = days;
  document.querySelectorAll('.pill-bar .pill').forEach(function(p) { p.classList.remove('active'); });
  el.classList.add('active');
  load(1);
}

function toggleHidePulled() {
  hidePulled = document.getElementById('hidePulled').checked;
  load(1);
}

function claimAlert(id, claimed) {
  if (!claimed && !confirm('Unmark this as pulled?')) return;
  fetch('/scout-alerts/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, claimed: claimed }) })
    .then(function(r) { return r.json(); })
    .then(function(d) { if (d.success) load(currentPage); })
    .catch(function(err) { alert('Error: ' + err.message); });
}

function load(page) {
  currentPage = page || 1;
  var url = '/scout-alerts/list?page=' + currentPage;
  if (currentYard !== 'all') url += '&yard=' + encodeURIComponent(currentYard);
  if (currentDays > 0) url += '&days=' + currentDays;
  if (hidePulled) url += '&hideClaimed=1';

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      document.getElementById('loading').style.display = 'none';
      if (!d.success) { document.getElementById('list').innerHTML = '<div class="empty">Error loading alerts</div>'; return; }

      document.getElementById('alertCount').textContent = d.total > 0 ? '(' + d.total + ')' : '';
      if (d.lastGenerated) {
        var mins = Math.floor((Date.now() - new Date(d.lastGenerated).getTime()) / 60000);
        var ts = mins < 1 ? 'just now' : mins < 60 ? mins + 'm ago' : Math.floor(mins / 60) + 'h ago';
        document.getElementById('lastUpdated').textContent = 'Updated ' + ts;
      }

      // Summary cards — filtered counts
      var sh = '<div class="summary-bar">';
      sh += '<div class="summary-card"><div class="summary-num" style="color:#eab308">' + (d.markCount || 0) + '</div><div class="summary-label">★ MARK</div></div>';
      sh += '<div class="summary-card"><div class="summary-num" style="color:#dc2626">' + (d.boneCount || 0) + '</div><div class="summary-label">QUARRY</div></div>';
      sh += '<div class="summary-card"><div class="summary-num" style="color:#ea580c">' + (d.perchCount || 0) + '</div><div class="summary-label">STREAM</div></div>';
      sh += '<div class="summary-card"><div class="summary-num" style="color:#F59E0B">' + (d.overstockCount || 0) + '</div><div class="summary-label">OVERSTOCK</div></div>';
      sh += '<div class="summary-card"><div class="summary-num" style="color:#22c55e">' + (d.justSoldCount || 0) + '</div><div class="summary-label">JUST SOLD</div></div>';
      sh += '<div class="summary-card"><div class="summary-num">' + (d.yardCounts ? d.yardCounts.length : 0) + '</div><div class="summary-label">YARDS</div></div>';
      sh += '</div>';
      document.getElementById('summary').innerHTML = d.total > 0 ? sh : '';

      if (d.total === 0) {
        document.getElementById('list').innerHTML = '<div class="empty">No alerts for this filter.<br>Try a wider time range or different yard.</div>';
        document.getElementById('pagination').innerHTML = '';
        return;
      }

      var h = '';
      var yardOrder = d.yardCounts.map(function(y) { return y.yard; });
      yardOrder.forEach(function(yardName) {
        var alerts = d.alerts[yardName];
        if (!alerts || alerts.length === 0) return;

        h += '<div class="card">';
        h += '<div class="yard-header"><span class="yard-name">' + esc(yardName) + '</span><span class="yard-count">' + alerts.length + ' alert' + (alerts.length > 1 ? 's' : '') + '</span></div>';

        alerts.forEach(function(a) {
          var bc = a.confidence === 'high' ? 'b-high' : a.confidence === 'medium' ? 'b-med' : 'b-low';
          var srcClass = a.source === 'PERCH' ? 'b-mark' : a.source === 'OVERSTOCK' ? 'b-overstock' : a.source === 'bone_pile' ? 'b-bone' : 'b-perch';
          var srcLabel = a.source === 'PERCH' ? '★ MARK' : a.source === 'OVERSTOCK' ? 'OVERSTOCK' : a.source === 'bone_pile' ? 'QUARRY' : 'STREAM';
          var soldTag = a.justSold ? '<span class="badge b-sold">SOLD ' + a.justSold.toUpperCase() + '</span>' : '';
          var priceStr = a.part_value ? '$' + a.part_value : '';
          var setStr = '';
          if (a.vehicle_set_date) {
            var days = Math.floor((Date.now() - new Date(a.vehicle_set_date).getTime()) / 86400000);
            setStr = 'set ' + (days <= 0 ? 'today' : days + 'd ago');
          }

          var isClaimed = a.claimed;
          var checkSvg = isClaimed
            ? '<svg viewBox="0 0 24 24" fill="#22c55e" stroke="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';

          h += '<div class="alert-row' + (isClaimed ? ' claimed' : '') + '">';
          h += '<div class="claim-check' + (isClaimed ? ' checked' : '') + '" onclick="claimAlert(' + a.id + ',' + !isClaimed + ')">' + checkSvg + '</div>';
          h += '<div class="alert-info">';
          if (a.source === 'OVERSTOCK') {
            h += '<div class="alert-part">' + esc(a.source_title) + '</div>';
            h += '<div class="alert-vehicle" style="color:#F59E0B">Low Stock Alert</div>';
          } else {
            h += '<div class="alert-part">' + esc(a.source_title) + '</div>';
            h += '<div class="alert-vehicle">' + esc([a.vehicle_year, a.vehicle_make, a.vehicle_model].filter(Boolean).join(' '));
            if (a.vehicle_color) h += ' <span style="color:#6B7280;font-weight:400">(' + esc(a.vehicle_color) + ')</span>';
            h += '</div>';
          }
          h += '<div class="alert-meta">';
          if (isClaimed) h += '<span class="badge" style="background:#064e3b;color:#22c55e">PULLED</span>';
          h += '<span class="badge ' + srcClass + '">' + srcLabel + '</span>';
          if (a.source !== 'OVERSTOCK') h += '<span class="badge ' + bc + '">' + (a.confidence || '').toUpperCase() + '</span>';
          if (soldTag) h += soldTag;
          if (a.source === 'OVERSTOCK' && priceStr) {
            h += '<span style="font-weight:700;color:#22c55e">Sells for ' + priceStr + '</span>';
          } else if (priceStr) {
            h += '<span style="font-weight:700;color:#22c55e">' + priceStr + '</span>';
          }
          if (a.row) h += '<span>Row ' + esc(a.row) + '</span>';
          if (setStr) h += '<span>' + setStr + '</span>';
          h += '</div>';
          if (a.notes) h += '<div class="alert-notes">' + esc(a.notes) + '</div>';
          h += '</div></div>';
        });
        h += '</div>';
      });

      document.getElementById('list').innerHTML = h;

      if (d.totalPages <= 1) { document.getElementById('pagination').innerHTML = ''; return; }
      var ph = '';
      for (var i = 1; i <= d.totalPages; i++) {
        ph += '<button class="pg-btn' + (i === currentPage ? ' active' : '') + '" onclick="load(' + i + ')">' + i + '</button>';
      }
      document.getElementById('pagination').innerHTML = ph;
    })
    .catch(function(err) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('list').innerHTML = '<div class="empty">Error: ' + err.message + '</div>';
    });
}

function refreshAlerts() {
  var btn = document.getElementById('refreshBtn');
  btn.disabled = true; btn.textContent = 'Generating...';
  document.getElementById('list').innerHTML = '<div style="text-align:center;padding:30px"><div class="spinner"></div><div style="margin-top:8px;color:#6B7280;font-size:12px">Matching parts against yard vehicles...</div></div>';

  fetch('/scout-alerts/refresh', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      btn.disabled = false; btn.textContent = 'Refresh';
      if (d.success) load(1);
      else document.getElementById('list').innerHTML = '<div class="empty">Error: ' + (d.error || 'Unknown') + '</div>';
    })
    .catch(function(err) {
      btn.disabled = false; btn.textContent = 'Refresh';
      document.getElementById('list').innerHTML = '<div class="empty">Error: ' + err.message + '</div>';
    });
}

function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

load(1);
</script>
</body>
</html>
```
---
## FILE: service/public/phoenix.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk - THE PHOENIX</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh;padding-bottom:40px}
.container{padding:12px;max-width:800px;margin:0 auto}
header{background:#141414;border-bottom:1px solid #2a2a2a;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}
.h-title{font-size:18px;font-weight:700;letter-spacing:-0.03em}
.h-sub{font-size:11px;color:#9CA3AF;margin-top:1px}
.controls{display:flex;gap:8px;align-items:center;padding:10px 12px;background:#141414;border-bottom:1px solid #2a2a2a;flex-wrap:wrap}
.pill{padding:6px 12px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#9CA3AF;font-size:11px;font-weight:600;cursor:pointer}
.pill.active{background:#7f1d1d;color:#dc2626;border-color:#dc2626}
select{padding:6px 10px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#d1d5db;font-size:11px;outline:none;appearance:none;-webkit-appearance:none;cursor:pointer}
.stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px 12px}
.stat-box{background:#141414;border:1px solid #2a2a2a;border-radius:8px;padding:10px;text-align:center}
.stat-val{font-size:16px;font-weight:700;color:#F0F0F0}
.stat-label{font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;margin-top:2px}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:10px}
.ph-card{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-bottom:1px solid #1f1f1f}
.ph-card:last-child{border-bottom:none}
.ph-thumb{width:44px;height:44px;border-radius:8px;background:#1f2937;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;overflow:hidden}
.ph-thumb img{width:100%;height:100%;object-fit:cover}
.ph-score{width:36px;height:36px;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;font-weight:800;line-height:1}
.ph-score .lbl{font-size:7px;font-weight:600;letter-spacing:.04em;margin-top:1px}
.sc-prime{background:#064e3b;color:#22c55e}
.sc-solid{background:#713f12;color:#eab308}
.sc-watch{background:#7c2d12;color:#f97316}
.sc-low{background:#7f1d1d;color:#ef4444}
.ph-info{flex:1;min-width:0}
.ph-top{display:flex;justify-content:space-between;align-items:flex-start}
.ph-type{font-size:13px;font-weight:700}
.ph-year{font-size:11px;color:#6B7280}
.ph-stats{font-size:11px;color:#9CA3AF;margin-top:2px}
.ph-range{font-size:10px;color:#6B7280;margin-top:1px}
.ph-sellers{font-size:10px;color:#4B5563;margin-top:2px}
.ph-sample{font-size:10px;color:#374151;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.manage-toggle{padding:8px 14px;font-size:11px;font-weight:600;color:#6B7280;cursor:pointer;border:none;background:none;width:100%;text-align:left}
.manage-panel{display:none;padding:0 12px 12px}
.manage-panel.open{display:block}
.seller-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1f1f1f;font-size:12px}
.seller-row:last-child{border-bottom:none}
.add-row{display:flex;gap:8px;margin-top:8px}
.add-input{flex:1;padding:8px 10px;border:1px solid #333;border-radius:6px;font-size:12px;background:#0a0a0a;color:#F0F0F0;outline:none}
.add-input:focus{border-color:#dc2626}
.btn{padding:8px 14px;border-radius:6px;border:none;font-size:12px;font-weight:700;cursor:pointer}
.btn-red{background:#dc2626;color:#fff}
.btn-sm{padding:5px 8px;font-size:10px;border-radius:4px;border:1px solid #333;background:#1a1a1a;color:#d1d5db;cursor:pointer}
.btn-sm:disabled{opacity:.3}
.spinner{width:14px;height:14px;border:2px solid #333;border-top-color:#dc2626;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;color:#6B7280;padding:30px;font-size:13px;line-height:1.6}
.count-header{font-size:11px;color:#6B7280;padding:6px 12px;font-weight:600}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#141414;border:1px solid #2a2a2a;color:#F0F0F0;padding:8px 16px;border-radius:8px;font-size:12px;z-index:300}
@media(max-width:500px){.stats-row{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=3"></script><script>dhNav('phoenix')</script>

<header>
  <div>
    <div class="h-title">THE PHOENIX</div>
    <div class="h-sub">Rebuild Candidate Intelligence</div>
  </div>
</header>

<div class="controls" id="controls">
  <button class="pill" data-days="90" onclick="setDays(90)">90d</button>
  <button class="pill active" data-days="180" onclick="setDays(180)">180d</button>
  <button class="pill" data-days="365" onclick="setDays(365)">365d</button>
  <button class="pill" data-days="9999" onclick="setDays(9999)">All</button>
  <select id="sellerFilter" onchange="loadData()"><option value="">All Sellers</option></select>
</div>

<div class="stats-row" id="statsRow">
  <div class="stat-box"><div class="stat-val" id="statCatalog">-</div><div class="stat-label">Catalog Parts</div></div>
  <div class="stat-box"><div class="stat-val" id="statPNs">-</div><div class="stat-label">Part Numbers</div></div>
  <div class="stat-box"><div class="stat-val" id="statFitment">-</div><div class="stat-label">With Fitment</div></div>
  <div class="stat-box"><div class="stat-val" id="statSales">-</div><div class="stat-label">Sold Items</div></div>
</div>

<div class="container">
  <!-- Seller Management -->
  <div class="card" style="padding:0;margin-bottom:12px">
    <button class="manage-toggle" id="manageBtn" onclick="toggleManage()">Manage Sellers ▼</button>
    <div class="manage-panel" id="managePanel">
      <div id="sellerList"></div>
      <div class="add-row">
        <input class="add-input" id="newSeller" placeholder="eBay seller name..." />
        <button class="btn btn-red" id="addBtn" onclick="addSeller()">Add</button>
      </div>
    </div>
  </div>

  <div id="listContent"><div class="empty"><div class="spinner"></div><br>Loading Phoenix data...</div></div>
</div>

<script>
var currentDays = 180;
var allSellers = [];

function setDays(d) {
  currentDays = d;
  document.querySelectorAll('.pill').forEach(function(b) { b.classList.toggle('active', parseInt(b.dataset.days) === d); });
  loadData();
}

function toggleManage() {
  var p = document.getElementById('managePanel');
  var b = document.getElementById('manageBtn');
  var open = p.classList.toggle('open');
  b.textContent = open ? 'Manage Sellers ▲' : 'Manage Sellers ▼';
}

function toast(msg) {
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function() { el.remove(); }, 3000);
}

async function loadSellers() {
  try {
    var res = await fetch('/phoenix/sellers');
    var data = await res.json();
    allSellers = data.sellers || [];
    renderSellers();
    var sel = document.getElementById('sellerFilter');
    sel.innerHTML = '<option value="">All Sellers</option>';
    allSellers.filter(function(s) { return s.enabled; }).forEach(function(s) {
      sel.innerHTML += '<option value="' + s.name + '">' + s.name + '</option>';
    });
  } catch (e) { /* silent */ }
}

function renderSellers() {
  var el = document.getElementById('sellerList');
  if (allSellers.length === 0) { el.innerHTML = '<div class="empty" style="padding:12px">No rebuild sellers configured.</div>'; return; }
  var h = '';
  allSellers.forEach(function(s) {
    var scraped = s.lastScrapedAt ? new Date(s.lastScrapedAt).toLocaleDateString() : 'Never';
    h += '<div class="seller-row">';
    h += '<span style="font-weight:600">' + s.name + '</span>';
    h += '<span style="color:#6B7280;font-size:10px">' + (s.itemsScraped || 0) + ' items · ' + scraped + '</span>';
    h += '<span>';
    h += '<button class="btn-sm" onclick="scrapeSeller(\'' + s.name + '\',this)">Scrape</button> ';
    h += '<button class="btn-sm" style="color:#ef4444" onclick="removeSeller(\'' + s.name + '\')">Remove</button>';
    h += '</span></div>';
  });
  el.innerHTML = h;
}

async function addSeller() {
  var input = document.getElementById('newSeller');
  var name = input.value.trim();
  if (!name) return;
  var btn = document.getElementById('addBtn');
  btn.disabled = true;
  try {
    var res = await fetch('/phoenix/sellers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) });
    var data = await res.json();
    if (data.success) { input.value = ''; toast('Added ' + name); await loadSellers(); loadData(); }
    else toast(data.message || 'Failed');
  } catch (e) { toast('Error adding seller'); }
  btn.disabled = false;
}

async function removeSeller(name) {
  if (!confirm('Remove ' + name + ' from rebuild sellers?')) return;
  try {
    await fetch('/phoenix/sellers/' + name, { method: 'DELETE' });
    toast('Removed ' + name);
    await loadSellers();
    loadData();
  } catch (e) { toast('Error removing seller'); }
}

async function scrapeSeller(name, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  try {
    var res = await fetch('/phoenix/sellers/' + name + '/scrape', { method: 'POST' });
    var data = await res.json();
    toast(data.success ? 'Scrape complete for ' + name : (data.error || 'Scrape failed'));
    await loadSellers();
    loadData();
  } catch (e) { toast('Scrape error'); }
  if (btn) { btn.disabled = false; btn.textContent = 'Scrape'; }
}

async function loadData() {
  var seller = document.getElementById('sellerFilter').value;
  var params = 'days=' + currentDays + '&limit=100' + (seller ? '&seller=' + seller : '');

  // Stats
  try {
    var sr = await fetch('/phoenix/stats?' + params);
    var sd = await sr.json();
    if (sd.success) {
      var st = sd.stats;
      document.getElementById('statCatalog').textContent = st.catalogItems || 0;
      document.getElementById('statPNs').textContent = st.itemsWithPartNumber || 0;
      document.getElementById('statFitment').textContent = st.itemsWithFitment || 0;
      document.getElementById('statSales').textContent = st.totalSales || 0;
    }
  } catch (e) { /* silent */ }

  // List
  var el = document.getElementById('listContent');
  try {
    var res = await fetch('/phoenix?' + params);
    var data = await res.json();
    if (!data.success) { el.innerHTML = '<div class="empty">Error: ' + (data.error || 'unknown') + '</div>'; return; }
    var items = data.data || [];
    // statParts removed — stats come from /stats endpoint

    if (items.length === 0) {
      if (allSellers.length === 0) { el.innerHTML = '<div class="empty">No rebuild sellers configured. Expand "Manage Sellers" to add one.</div>'; }
      else { el.innerHTML = '<div class="empty">No sold data found. Scrape your rebuild sellers to populate the list.</div>'; }
      return;
    }

    var sellerLabel = seller ? 'from ' + seller : '';
    var h = '<div class="count-header">Showing ' + items.length + ' rebuild candidates ' + sellerLabel + '</div>';
    h += '<div class="card" style="padding:0">';
    items.forEach(function(it) {
      var sc = it.phoenixScore >= 75 ? 'sc-prime' : it.phoenixScore >= 50 ? 'sc-solid' : it.phoenixScore >= 25 ? 'sc-watch' : 'sc-low';
      var lbl = it.phoenixScore >= 75 ? 'PRIME' : it.phoenixScore >= 50 ? 'SOLID' : it.phoenixScore >= 25 ? 'WATCH' : 'LOW';
      var thumb = it.catalogImage ? '<img src="' + it.catalogImage + '" alt="">' : '🔥';
      var pnDisplay = it.partNumberBase ? it.partNumberBase : '';

      h += '<div class="ph-card">';
      h += '<div class="ph-thumb">' + thumb + '</div>';
      h += '<div class="ph-score ' + sc + '">' + it.phoenixScore + '<span class="lbl">' + lbl + '</span></div>';
      h += '<div class="ph-info">';

      // Line 1: Part type + PN
      h += '<div class="ph-top"><div><span class="ph-type">' + esc(it.partType) + '</span>';
      if (pnDisplay) h += ' <span style="color:#6B7280;font-size:11px">' + esc(pnDisplay) + '</span>';
      if (it.salesCount === 0 && it.catalogCount > 0) h += ' <span style="background:#1f2937;color:#6B7280;font-size:8px;padding:1px 4px;border-radius:3px">CATALOG</span>';
      h += '</div><span class="ph-year">' + (it.yearRange || '') + '</span></div>';

      // Line 2: Fitment (from AIC)
      if (it.fitmentSummary) {
        h += '<div style="font-size:12px;color:#d1d5db;margin-top:1px">' + esc(it.fitmentSummary);
        if (it.fitment && it.fitment[0] && it.fitment[0].engine) h += ' · ' + esc(it.fitment[0].engine);
        h += '</div>';
      }

      // Line 3: Market data
      if (it.marketAvgPrice || it.marketSold90d) {
        h += '<div style="font-size:11px;color:#06b6d4;margin-top:2px">Market $' + (it.marketAvgPrice || '?') + ' avg · ' + (it.marketSold90d || 0) + ' sold/90d';
        if (it.marketScore) h += ' · Score ' + it.marketScore;
        h += '</div>';
      }

      // Line 4: Sales velocity
      if (it.salesCount > 0) {
        h += '<div class="ph-stats">Sold ' + it.salesCount + 'x @ avg $' + it.avgSoldPrice + ' · $' + it.totalRevenue + ' revenue';
        if (it.lastSoldDate) h += ' · Last ' + new Date(it.lastSoldDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        h += '</div>';
      } else {
        h += '<div style="font-size:10px;color:#4B5563;margin-top:2px">No sales data yet</div>';
      }

      // Line 5: Seller breakdown
      if (it.soldSellers && it.soldSellers.length > 1) {
        h += '<div class="ph-sellers">' + it.soldSellers.map(function(s) { return s + ' (' + (it.sellerBreakdown[s] || 0) + ')'; }).join(' · ') + '</div>';
      }

      // Line 6: Sample title
      if (it.sampleTitles && it.sampleTitles[0]) {
        var sample = it.sampleTitles[0];
        h += '<div class="ph-sample">' + esc(sample.length > 80 ? sample.substring(0, 80) + '...' : sample) + '</div>';
      }

      h += '</div></div>';
    });
    h += '</div>';
    el.innerHTML = h;
  } catch (e) {
    el.innerHTML = '<div class="empty" style="color:#ef4444">Failed to load data: ' + e.message + '</div>';
  }
}

function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Init
loadSellers().then(function() { loadData(); });
</script>
</body>
</html>
```
---
## FILE: service/public/flyway.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk - THE FLYWAY</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0a0a0a; --surface: #141414; --surface2: #1a1a1a;
  --border: #2a2a2a; --red: #DC2626; --red-dim: #7f1d1d;
  --yellow: #eab308; --yellow-dim: #713f12; --green: #22c55e;
  --gray: #9ca3af; --text: #F0F0F0; --text-mid: #d1d5db;
  --text-muted: #9CA3AF; --text-faint: #6B7280;
  --teal: #06b6d4; --teal-bg: #164e63; --orange: #f97316; --orange-bg: #7c2d12;
  --font: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
}
body { font-family: var(--font); background: var(--bg); color: var(--text); min-height: 100vh; -webkit-tap-highlight-color: transparent; padding-bottom: 60px; }

/* Header */
header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; }
.header-left h1 { font-size: 18px; font-weight: 700; letter-spacing: -0.03em; }
.header-left p { font-size: 11px; color: var(--text-muted); margin-top: 1px; }

/* View Tabs */
.view-tabs { display: flex; background: var(--surface); border-bottom: 1px solid var(--border); }
.view-tab { flex: 1; padding: 11px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); cursor: pointer; text-align: center; border-bottom: 2px solid transparent; }
.view-tab.active { color: var(--text); border-bottom-color: var(--red); }

/* Yard Tabs */
.yard-tabs { display: flex; background: var(--surface); border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.yard-tabs::-webkit-scrollbar { display: none; }
.yard-tab { padding: 11px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); cursor: pointer; white-space: nowrap; border-bottom: 2px solid transparent; flex-shrink: 0; }
.yard-tab.active { color: var(--text); border-bottom-color: var(--red); }

/* Status Bar */
.status-bar { padding: 6px 16px; background: var(--surface); border-bottom: 1px solid var(--border); font-size: 11px; color: var(--text-muted); display: flex; justify-content: space-between; }

/* Toggle Bar */
.toggle-bar { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; background: var(--surface); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.toggle-btn { padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface2); color: var(--text-muted); font-size: 11px; font-weight: 600; cursor: pointer; }
.toggle-btn.active { background: #064e3b; color: #22c55e; border-color: #22c55e; }

/* Cards */
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin: 8px 12px; }

/* Spinner */
.loading { text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: 12px; }
.spinner { width: 28px; height: 28px; border: 2px solid #333; border-top-color: #DC2626; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 12px; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Form */
.form-group { margin-bottom: 12px; }
.form-label { font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
.form-input, .form-textarea, .form-date { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface2); color: var(--text); font-size: 14px; font-family: var(--font); outline: none; }
.form-input:focus, .form-textarea:focus, .form-date:focus { border-color: var(--red); }
.form-input::placeholder, .form-textarea::placeholder { color: var(--text-faint); }
.form-textarea { min-height: 60px; resize: vertical; font-size: 13px; }
.form-date { color-scheme: dark; }
.form-date:disabled { opacity: 0.4; }
.form-row { display: flex; gap: 8px; }
.form-row .form-group { flex: 1; }

/* Buttons */
.btn { padding: 10px 16px; border-radius: 8px; border: none; font-size: 13px; font-weight: 700; cursor: pointer; font-family: var(--font); }
.btn-red { background: var(--red); color: #fff; }
.btn-red:active { opacity: 0.8; }
.btn-green { background: var(--green); color: #000; }
.btn-gray { background: var(--surface2); color: var(--text-muted); border: 1px solid var(--border); }
.btn-sm { padding: 6px 10px; font-size: 11px; border-radius: 6px; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Trip Type Toggle */
.trip-type-toggle { display: flex; gap: 0; margin-bottom: 12px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
.trip-type-btn { flex: 1; padding: 10px 16px; font-size: 12px; font-weight: 700; cursor: pointer; text-align: center; background: var(--surface2); color: var(--text-faint); border: none; font-family: var(--font); letter-spacing: 0.04em; }
.trip-type-btn.active-day { background: var(--teal); color: #fff; }
.trip-type-btn.active-road { background: var(--orange); color: #fff; }

/* Trip Type Badge */
.badge-day { background: var(--teal-bg); color: var(--teal); font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; display: inline-block; vertical-align: middle; }
.badge-road { background: var(--orange-bg); color: var(--orange); font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; display: inline-block; vertical-align: middle; }

/* Trip Picker */
.trip-picker { padding: 20px 12px; }
.trip-picker-title { text-align: center; font-size: 14px; font-weight: 700; color: var(--text-muted); margin-bottom: 16px; }
.trip-pick-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 10px; cursor: pointer; }
.trip-pick-card:active { opacity: 0.8; }
.trip-pick-card .pick-name { font-size: 15px; font-weight: 700; }
.trip-pick-card .pick-dates { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.trip-pick-card .pick-meta { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.trip-pick-card .pick-tap { font-size: 10px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.1em; margin-top: 10px; text-align: center; }

/* Yard Selector */
.yard-group { margin: 8px 12px; }
.yard-group-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 0 4px; }
.yard-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 4px; cursor: pointer; }
.yard-item.selected { border-color: var(--green); background: #064e3b22; }
.yard-item.flagged { opacity: 0.4; cursor: not-allowed; }
.yard-check { width: 20px; height: 20px; border: 2px solid var(--border); border-radius: 4px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; }
.yard-item.selected .yard-check { border-color: var(--green); background: var(--green); color: #000; }
.yard-info { flex: 1; min-width: 0; }
.yard-name { font-size: 13px; font-weight: 600; }
.yard-meta { font-size: 10px; color: var(--text-muted); margin-top: 1px; }
.yard-dist { font-size: 12px; font-weight: 700; color: var(--text-muted); flex-shrink: 0; }

/* Chip */
.chip { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; letter-spacing: 0.03em; text-transform: uppercase; display: inline-block; }
.chip-green { background: #064e3b; color: #22c55e; }
.chip-yellow { background: #713f12; color: #eab308; }
.chip-orange { background: #7c2d12; color: #f97316; }
.chip-red { background: #7f1d1d; color: #ef4444; }
.chip-gray { background: #1f2937; color: #6B7280; }
.chip-blue { background: #1e3a5f; color: #3b82f6; }
.chip-cyan { background: #164e63; color: #06b6d4; }
.chip-magenta { background: #701a75; color: #d946ef; }

/* Trip Cards */
.trip-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin: 8px 12px; }
.trip-card-header { display: flex; justify-content: space-between; align-items: flex-start; }
.trip-name { font-size: 15px; font-weight: 700; }
.trip-dates { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.trip-actions { display: flex; gap: 6px; margin-top: 10px; }

/* Vehicle Cards */
.vehicle-row { border-bottom: 1px solid #1a1a1a; }
.vehicle-row:last-child { border-bottom: none; }
.v-collapsed { display: flex; align-items: center; padding: 10px 14px; gap: 10px; min-height: 48px; cursor: pointer; user-select: none; }
.v-score { width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; }
.v-score.green { background: #064e3b; color: #22c55e; }
.v-score.yellow { background: #713f12; color: #eab308; }
.v-score.orange { background: #7c2d12; color: #f97316; }
.v-score.red { background: #7f1d1d; color: #ef4444; }
.v-score.gray { background: #1f2937; color: #6B7280; }
.v-info { flex: 1; min-width: 0; }
.v-title { font-size: 14px; font-weight: 600; }
.v-badges { display: flex; gap: 4px; margin-top: 3px; flex-wrap: wrap; align-items: center; }
.v-highvalue { margin-top: 3px; font-size: 11px; color: #eab308; font-weight: 600; }
.v-chips { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.v-right { text-align: right; flex-shrink: 0; }
.v-value { font-size: 13px; font-weight: 700; color: var(--green); }
.v-parts-count { font-size: 10px; color: var(--text-muted); margin-top: 1px; }
.v-decay { font-size: 10px; margin-top: 1px; }
.v-expanded { display: none; padding: 0 14px 14px; }
.v-expanded.open { display: block; }

/* Expanded Part List */
.part-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #1a1a1a; font-size: 12px; }
.part-row:last-child { border-bottom: none; }
.part-type { font-weight: 600; }
.part-price { font-weight: 700; }
.part-meta { font-size: 10px; color: var(--text-muted); }

/* Trip Header */
.trip-header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 16px; }
.trip-header-name { font-size: 16px; font-weight: 700; }
.trip-header-dates { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.trip-countdown { font-size: 11px; font-weight: 700; margin-top: 4px; }

/* Empty State */
.empty { text-align: center; padding: 40px 20px; color: var(--text-faint); font-size: 13px; line-height: 1.6; }

/* Confirm Dialog */
.confirm-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 200; display: none; align-items: center; justify-content: center; padding: 20px; }
.confirm-overlay.open { display: flex; }
.confirm-box { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; max-width: 320px; width: 100%; }
.confirm-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
.confirm-body { font-size: 12px; color: var(--text-muted); margin-bottom: 16px; }
.confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.pulse { animation: pulse 1.5s ease-in-out infinite; }
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=3"></script><script>dhNav('flyway')</script>

<header>
  <div class="header-left">
    <h1>THE FLYWAY</h1>
    <p id="headerSub">Road Trip Intelligence</p>
  </div>
</header>

<div class="view-tabs">
  <div class="view-tab active" id="vtab-plan" onclick="switchView('plan')">PLAN</div>
  <div class="view-tab" id="vtab-active" onclick="switchView('active')">ACTIVE</div>
  <div class="view-tab" id="vtab-history" onclick="switchView('history')">HISTORY</div>
</div>

<div id="view-plan" style="display:block">
  <!-- Trip Creation -->
  <div class="card" style="margin-top:8px">
    <div class="form-label" style="margin-bottom:8px;color:var(--red)">New Trip</div>
    <div class="trip-type-toggle">
      <button class="trip-type-btn" id="btnDayTrip" onclick="setTripType('day_trip')">DAY TRIP</button>
      <button class="trip-type-btn active-road" id="btnRoadTrip" onclick="setTripType('road_trip')">ROAD TRIP</button>
    </div>
    <div class="form-group">
      <input class="form-input" id="tripName" placeholder="Charlotte Run, GA/FL Sweep..." autocomplete="off">
    </div>
    <div class="form-row">
      <div class="form-group"><div class="form-label">Start</div><input type="date" class="form-date" id="tripStart" onchange="onStartDateChange()"></div>
      <div class="form-group"><div class="form-label">End</div><input type="date" class="form-date" id="tripEnd"></div>
    </div>
    <div class="form-group">
      <textarea class="form-textarea" id="tripNotes" placeholder="Budget, route notes, priorities..."></textarea>
    </div>
    <button class="btn btn-red" style="width:100%" onclick="handleCreateTrip()">Create Trip</button>
  </div>

  <!-- Planning Trips -->
  <div id="planningTrips"></div>

  <!-- Yard Selector (shown after selecting a trip) -->
  <div id="yardSelectorWrap" style="display:none">
    <div style="padding:8px 16px;display:flex;justify-content:space-between;align-items:center">
      <div class="form-label" style="color:var(--yellow);margin:0">Select Yards</div>
      <div id="yardCount" style="font-size:11px;color:var(--text-muted)">0 selected</div>
    </div>
    <div id="yardSelector"></div>
  </div>
</div>

<div id="view-active" style="display:none">
  <div id="activeContent">
    <div class="empty">No active trip. Go to Plan tab to create and activate one.</div>
  </div>
</div>

<div id="view-history" style="display:none">
  <div id="historyContent">
    <div class="loading"><div class="spinner"></div><div>Loading...</div></div>
  </div>
</div>

<!-- Confirm Dialog -->
<div class="confirm-overlay" id="confirmOverlay">
  <div class="confirm-box">
    <div class="confirm-title" id="confirmTitle"></div>
    <div class="confirm-body" id="confirmBody"></div>
    <div class="confirm-actions">
      <button class="btn btn-gray btn-sm" onclick="closeConfirm()">Cancel</button>
      <button class="btn btn-red btn-sm" id="confirmBtn" onclick="doConfirm()">Confirm</button>
    </div>
  </div>
</div>

<script>
// ═══ STATE ═══
var currentView = 'plan';
var allTrips = [];
var activeTrip = null;
var activeTripData = null;
var editingTripId = null;
var editingTripType = null;
var availableYards = [];
var selectedYardIds = new Set();
var activeYardFilter = 'all';
var sortMode = 'score';
var filterPremium = false;
var filterHighValue = false;
var confirmCallback = null;
var refreshTimer = null;
var newTripType = 'road_trip';
var multipleActiveTrips = [];

// ═══ HELPERS ═══
function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function timeAgo(ds) { var d = new Date(ds); var diff = Date.now() - d.getTime(); var h = Math.floor(diff / 3600000); var dd = Math.floor(h / 24); if (dd > 0) return dd + 'd ago'; if (h > 0) return h + 'h ago'; return 'now'; }
function fmtDate(d) { if (!d) return ''; return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtDateRange(s, e) { if (s === e) return fmtDate(s); return fmtDate(s) + ' - ' + fmtDate(e); }
function daysUntil(d) { return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000); }
function tripTypeBadge(t) { var tt = t.trip_type || 'road_trip'; return tt === 'day_trip' ? '<span class="badge-day">DAY TRIP</span>' : '<span class="badge-road">ROAD TRIP</span>'; }
function tripTypeAccent(t) { return (t.trip_type || 'road_trip') === 'day_trip' ? 'var(--teal)' : 'var(--orange)'; }

var LKQ_CODES = new Set(['JK','JL','JT','WK','XK','MK','KJ','KL','DJ','DT','DH','BK','WJ','ZJ','TJ','ND','WD','PF','UF','FK','FF','AN','EN','GS','JS','KA','RU','ZH','WH','RE','PT','LA','LD','BR','BE','AB','AY','PM','PG','DR','SA']);
function cleanModel(text, make) {
  if (!text) return text;
  var c = text;
  if (/dodge|ram|chrysler|jeep/i.test(make || '')) c = c.replace(/\b[A-Z]{2}\d\b/g, '');
  c = c.replace(/\b([A-Z]{2})\b/g, function(m, code) { return LKQ_CODES.has(code) ? '' : m; });
  c = c.replace(/\bSUBURBAN\s+1500\b/gi, 'Suburban').replace(/\bYUKON\s+XL\s+1500\b/gi, 'Yukon XL').replace(/\bAVALANCHE\s+1500\b/gi, 'Avalanche');
  if (/mazda/i.test(make || '')) { c = c.replace(/^3$/i, 'Mazda3').replace(/^6$/i, 'Mazda6').replace(/^5$/i, 'Mazda5'); }
  c = c.replace(/\s+(LE|SE|XLE|XSE|LX|EX|LT|LS|SL|SV|SR|DX|SXT|SLT|XLT|SEL|Limited|Sport|Base|Premium|Luxury|Touring)(\/[A-Za-z]+)*\s*$/i, '');
  c = c.replace(/\b(NFA|NFB|NFC)\b/gi, '');
  c = c.replace(/\b(\w+)\s+\1\b/gi, '$1');
  return c.replace(/\s{2,}/g, ' ').trim();
}

// ═══ API ═══
async function api(url, opts) {
  var res = await fetch(url, opts);
  return res.json();
}

// ═══ TRIP TYPE TOGGLE ═══
function setTripType(type) {
  newTripType = type;
  var dayBtn = document.getElementById('btnDayTrip');
  var roadBtn = document.getElementById('btnRoadTrip');
  dayBtn.className = 'trip-type-btn' + (type === 'day_trip' ? ' active-day' : '');
  roadBtn.className = 'trip-type-btn' + (type === 'road_trip' ? ' active-road' : '');

  var nameInput = document.getElementById('tripName');
  var endInput = document.getElementById('tripEnd');
  if (type === 'day_trip') {
    nameInput.placeholder = 'Foss Run, Charlotte Day Trip...';
    endInput.disabled = true;
    var startVal = document.getElementById('tripStart').value;
    if (startVal) endInput.value = startVal;
  } else {
    nameInput.placeholder = 'Charlotte Run, GA/FL Sweep...';
    endInput.disabled = false;
  }

  // Re-render yard selector if open
  if (editingTripId) renderYardSelector();
}

function onStartDateChange() {
  if (newTripType === 'day_trip') {
    document.getElementById('tripEnd').value = document.getElementById('tripStart').value;
  }
}

// ═══ VIEW SWITCHING ═══
function switchView(view) {
  currentView = view;
  ['plan','active','history'].forEach(function(v) {
    document.getElementById('view-' + v).style.display = v === view ? 'block' : 'none';
    document.getElementById('vtab-' + v).classList.toggle('active', v === view);
  });
  if (view === 'plan') loadPlanView();
  if (view === 'active') loadActiveView();
  if (view === 'history') loadHistoryView();
  location.hash = view;
}

// ═══ PLAN VIEW ═══
async function loadPlanView() {
  var data = await api('/flyway/trips');
  allTrips = data.trips || [];
  var planning = allTrips.filter(function(t) { return t.status === 'planning'; });
  renderPlanningTrips(planning);
}

function renderPlanningTrips(trips) {
  var el = document.getElementById('planningTrips');
  if (trips.length === 0) { el.innerHTML = ''; return; }
  var h = '<div style="padding:12px 16px 4px"><div class="form-label" style="color:var(--text-muted)">Planning Trips</div></div>';
  trips.forEach(function(t) {
    var yardNames = (t.yards || []).map(function(y) { return esc(y.name); }).join(', ') || 'No yards';
    var badge = tripTypeBadge(t);
    var dateDisplay = (t.trip_type === 'day_trip' || t.start_date === t.end_date) ? fmtDate(t.start_date) : fmtDateRange(t.start_date, t.end_date);
    h += '<div class="trip-card">';
    h += '<div class="trip-card-header"><div><div class="trip-name">' + esc(t.name) + ' ' + badge + '</div>';
    h += '<div class="trip-dates">' + dateDisplay + '</div>';
    h += '<div style="font-size:10px;color:var(--text-faint);margin-top:2px">' + (t.yards || []).length + ' yards: ' + yardNames + '</div>';
    h += '</div><span class="chip chip-blue">PLANNING</span></div>';
    h += '<div class="trip-actions">';
    h += '<button class="btn btn-green btn-sm" onclick="confirmActivate(' + t.id + ')" ' + ((t.yards || []).length === 0 ? 'disabled title="Add yards first"' : '') + '>ACTIVATE</button>';
    h += '<button class="btn btn-gray btn-sm" onclick="editTripYards(' + t.id + ')">YARDS</button>';
    h += '<button class="btn btn-gray btn-sm" onclick="confirmDelete(' + t.id + ')">DELETE</button>';
    h += '</div></div>';
  });
  el.innerHTML = h;
}

async function handleCreateTrip() {
  var name = document.getElementById('tripName').value.trim();
  var start = document.getElementById('tripStart').value;
  var end = newTripType === 'day_trip' ? start : document.getElementById('tripEnd').value;
  var notes = document.getElementById('tripNotes').value.trim();
  if (!name || !start || !end) return;
  var data = await api('/flyway/trips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, start_date: start, end_date: end, notes: notes || null, trip_type: newTripType }) });
  if (data.success) {
    document.getElementById('tripName').value = '';
    document.getElementById('tripStart').value = '';
    document.getElementById('tripEnd').value = '';
    document.getElementById('tripNotes').value = '';
    editTripYards(data.id);
    loadPlanView();
  }
}

// ═══ YARD SELECTOR ═══
async function editTripYards(tripId) {
  editingTripId = tripId;
  // Determine trip type for this specific trip
  var trip = allTrips.find(function(t) { return t.id === tripId; });
  editingTripType = (trip && trip.trip_type) || newTripType;
  document.getElementById('yardSelectorWrap').style.display = 'block';

  if (availableYards.length === 0) {
    var data = await api('/flyway/available-yards');
    availableYards = data.yards || [];
  }

  selectedYardIds = new Set((trip && trip.yards || []).map(function(y) { return y.id; }));
  renderYardSelector();
}

function renderYardSelector() {
  var isDayTrip = editingTripType === 'day_trip';
  var tiers = isDayTrip ? [
    { label: 'Local', min: 0, max: 60, color: '#22c55e' },
    { label: 'Nearby', min: 60, max: 120, color: '#eab308' },
  ] : [
    { label: 'Local', min: 0, max: 60, color: '#22c55e' },
    { label: 'Day Trip', min: 60, max: 150, color: '#eab308' },
    { label: 'Road Trip', min: 150, max: 500, color: '#f97316' },
    { label: 'Expedition', min: 500, max: 99999, color: '#ef4444' },
  ];
  var h = '';
  tiers.forEach(function(tier) {
    var yards = availableYards.filter(function(y) {
      var d = parseFloat(y.distance_from_base) || 0;
      return d >= tier.min && d < tier.max && !y.flagged;
    });
    if (yards.length === 0) return;
    h += '<div class="yard-group">';
    h += '<div class="yard-group-label" style="color:' + tier.color + '">' + tier.label + ' (' + tier.min + '-' + tier.max + 'mi)</div>';
    yards.forEach(function(y) {
      var sel = selectedYardIds.has(y.id);
      var scrapeIcon = y.scrape_method === 'automated' || y.scrape_method === 'lkq' ? '\u26A1' : y.scrape_method === 'on_demand' || y.scrape_method === 'pullapart' ? '\u{1F447}' : '\u270F';
      h += '<div class="yard-item' + (sel ? ' selected' : '') + '" onclick="toggleYard(\'' + y.id + '\')" style="border-left:3px solid ' + tier.color + '">';
      h += '<div class="yard-check">' + (sel ? '\u2713' : '') + '</div>';
      h += '<div class="yard-info"><div class="yard-name">' + esc(y.name) + ' <span class="chip chip-gray" style="font-size:8px">' + esc(y.chain || '?') + '</span></div>';
      h += '<div class="yard-meta">' + scrapeIcon + ' ' + (y.scrape_method || 'none') + (y.last_scraped ? ' \u00B7 scraped ' + timeAgo(y.last_scraped) : '') + '</div></div>';
      h += '<div class="yard-dist">' + Math.round(y.distance_from_base) + 'mi</div>';
      h += '</div>';
    });
    h += '</div>';
  });
  // Show flagged yards dimmed (not for day trips — keep it clean)
  if (!isDayTrip) {
    var flagged = availableYards.filter(function(y) { return y.flagged; });
    if (flagged.length > 0) {
      h += '<div class="yard-group"><div class="yard-group-label" style="color:#ef4444">Flagged (unavailable)</div>';
      flagged.forEach(function(y) {
        h += '<div class="yard-item flagged"><div class="yard-check"></div><div class="yard-info"><div class="yard-name" style="color:var(--text-faint)">' + esc(y.name) + '</div><div class="yard-meta" style="color:#ef4444">' + esc(y.flag_reason || 'Flagged') + '</div></div></div>';
      });
      h += '</div>';
    }
  }
  document.getElementById('yardSelector').innerHTML = h;
  document.getElementById('yardCount').textContent = selectedYardIds.size + ' selected';
}

async function toggleYard(yardId) {
  if (!editingTripId) return;
  if (selectedYardIds.has(yardId)) {
    await api('/flyway/trips/' + editingTripId + '/yards/' + yardId, { method: 'DELETE' });
    selectedYardIds.delete(yardId);
  } else {
    await api('/flyway/trips/' + editingTripId + '/yards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ yard_id: yardId }) });
    selectedYardIds.add(yardId);
  }
  renderYardSelector();
  loadPlanView();
}

// ═══ CONFIRM DIALOGS ═══
function showConfirm(title, body, callback) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmBody').textContent = body;
  confirmCallback = callback;
  document.getElementById('confirmOverlay').classList.add('open');
}
function closeConfirm() { document.getElementById('confirmOverlay').classList.remove('open'); confirmCallback = null; }
function doConfirm() { if (confirmCallback) confirmCallback(); closeConfirm(); }

function confirmActivate(tripId) {
  showConfirm('Activate Trip', 'This will mark the trip as active and enable scraping for selected yards. Continue?', async function() {
    await api('/flyway/trips/' + tripId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) });
    switchView('active');
  });
}

function confirmDelete(tripId) {
  showConfirm('Delete Trip', 'This will permanently delete this trip and remove all yard associations. Continue?', async function() {
    await api('/flyway/trips/' + tripId, { method: 'DELETE' });
    loadPlanView();
  });
}

// ═══ ACTIVE VIEW ═══
async function loadActiveView() {
  var el = document.getElementById('activeContent');
  el.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading active trip...</div></div>';

  var data = await api('/flyway/trips?status=active');
  var trips = data.trips || [];
  if (trips.length === 0) {
    el.innerHTML = '<div class="empty">No active trip. Go to Plan tab to create and activate one.</div>';
    return;
  }

  multipleActiveTrips = trips;

  // Multiple active trips: show picker
  if (trips.length > 1 && !activeTrip) {
    renderTripPicker(trips);
    return;
  }

  // Single active trip or already selected
  if (!activeTrip) activeTrip = trips[0];
  el.innerHTML = '<div class="loading"><div class="spinner"></div><div>Scoring vehicles...</div></div>';

  activeTripData = await api('/flyway/trips/' + activeTrip.id + '/attack-list');
  renderActiveTrip();

  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(function() { if (currentView === 'active') refreshActiveTrip(); }, 300000);
}

function renderTripPicker(trips) {
  var el = document.getElementById('activeContent');
  var h = '<div class="trip-picker">';
  h += '<div class="trip-picker-title">Which trip are you on?</div>';
  trips.forEach(function(t) {
    var badge = tripTypeBadge(t);
    var dateDisplay = (t.trip_type === 'day_trip' || t.start_date === t.end_date) ? fmtDate(t.start_date) : fmtDateRange(t.start_date, t.end_date);
    var accentColor = tripTypeAccent(t);
    h += '<div class="trip-pick-card" onclick="selectActiveTrip(' + t.id + ')" style="border-left:3px solid ' + accentColor + '">';
    h += '<div class="pick-name">' + esc(t.name) + '</div>';
    h += '<div class="pick-dates">' + dateDisplay + '</div>';
    h += '<div class="pick-meta">' + badge + ' <span style="font-size:11px;color:var(--text-muted)">' + (t.yards || []).length + ' yards</span></div>';
    h += '<div class="pick-tap">TAP TO LOAD</div>';
    h += '</div>';
  });
  h += '</div>';
  el.innerHTML = h;
}

function selectActiveTrip(tripId) {
  activeTrip = multipleActiveTrips.find(function(t) { return t.id === tripId; });
  loadActiveView();
}

function switchTrip() {
  activeTrip = null;
  activeTripData = null;
  loadActiveView();
}

async function refreshActiveTrip() {
  if (!activeTrip) return;
  activeTripData = await api('/flyway/trips/' + activeTrip.id + '/attack-list');
  renderActiveTrip();
}

function renderActiveTrip() {
  if (!activeTrip || !activeTripData) return;
  var el = document.getElementById('activeContent');
  var trip = activeTripData.trip || activeTrip;
  var yards = activeTripData.yards || [];
  var accentColor = tripTypeAccent(trip);
  var badge = tripTypeBadge(trip);

  // Trip header
  var daysLeft = daysUntil(trip.end_date);
  var countdownText, countdownColor;
  if (daysLeft <= 0) { countdownText = 'ENDS TODAY'; countdownColor = '#ef4444'; }
  else if (daysLeft === 1) { countdownText = 'LAST DAY'; countdownColor = '#ef4444'; }
  else { countdownText = daysLeft + ' DAYS LEFT'; countdownColor = daysLeft <= 3 ? '#eab308' : '#22c55e'; }

  var dateDisplay = (trip.trip_type === 'day_trip' || trip.start_date === trip.end_date) ? fmtDate(trip.start_date) : fmtDateRange(trip.start_date, trip.end_date);

  var h = '<div class="trip-header" style="border-left:3px solid ' + accentColor + '">';
  h += '<div style="display:flex;justify-content:space-between;align-items:flex-start">';
  h += '<div><div class="trip-header-name">' + esc(trip.name) + ' ' + badge + '</div>';
  h += '<div class="trip-header-dates">' + dateDisplay + '</div>';
  h += '<div class="trip-countdown' + (daysLeft <= 0 ? ' pulse' : '') + '" style="color:' + countdownColor + '">' + countdownText + '</div>';
  h += '</div>';
  h += '<div style="display:flex;flex-direction:column;gap:4px">';
  if (multipleActiveTrips.length > 1) {
    h += '<button class="btn btn-gray btn-sm" onclick="switchTrip()" style="font-weight:700;letter-spacing:0.03em">\u21C4 SWITCH</button>';
  }
  h += '<button class="btn btn-gray btn-sm" id="scrapeBtn" onclick="triggerFlywayScrape(' + trip.id + ')">SCRAPE</button>';
  h += '<button class="btn btn-gray btn-sm" onclick="confirmComplete()">Complete</button>';
  h += '</div></div></div>';

  // Build vehicle count map from scored yards
  var yardVehicleCounts = {};
  yards.forEach(function(y) { yardVehicleCounts[y.yard.id] = y.total_vehicles || 0; });

  // Yard tabs — built from trip.yards (always complete, even with 0 vehicles)
  var tripYards = (trip.yards || []).filter(function(y) { return y.scrape_enabled !== false; });
  h += '<div class="yard-tabs">';
  h += '<div class="yard-tab' + (activeYardFilter === 'all' ? ' active' : '') + '" onclick="setYardFilter(\'all\')">ALL</div>';
  tripYards.forEach(function(y) {
    var yid = y.id;
    var count = yardVehicleCounts[yid] || 0;
    h += '<div class="yard-tab' + (activeYardFilter === yid ? ' active' : '') + '" onclick="setYardFilter(\'' + yid + '\')">' + esc(y.name.replace(/^LKQ |^Pull-A-Part /, '')) + ' <span style="color:var(--text-faint)">' + count + '</span></div>';
  });
  h += '</div>';

  // Sort/filter controls
  h += '<div class="toggle-bar">';
  h += '<button class="toggle-btn' + (sortMode === 'score' ? ' active' : '') + '" onclick="setSort(\'score\')">Score</button>';
  h += '<button class="toggle-btn' + (sortMode === 'age' ? ' active' : '') + '" onclick="setSort(\'age\')">Newest</button>';
  h += '<button class="toggle-btn' + (sortMode === 'value' ? ' active' : '') + '" onclick="setSort(\'value\')">Value</button>';
  h += '<button class="toggle-btn' + (sortMode === 'row' ? ' active' : '') + '" onclick="setSort(\'row\')" style="' + (sortMode === 'row' ? '' : '') + '">Row</button>';
  h += '<span style="color:#333">|</span>';
  h += '<button class="toggle-btn' + (filterPremium ? ' active' : '') + '" onclick="toggleFilter(\'premium\')">Premium</button>';
  h += '<button class="toggle-btn' + (filterHighValue ? ' active' : '') + '" onclick="toggleFilter(\'highvalue\')">$500+</button>';
  h += '</div>';

  // Collect all vehicles (or filter by yard)
  var allVehicles = [];
  yards.forEach(function(y) {
    (y.vehicles || []).forEach(function(v) {
      v._yardName = y.yard.name;
      v._yardId = y.yard.id;
      allVehicles.push(v);
    });
  });

  var filtered = allVehicles;
  if (activeYardFilter !== 'all') {
    filtered = filtered.filter(function(v) { return v._yardId === activeYardFilter; });
  }
  if (filterPremium) filtered = filtered.filter(function(v) { return (v.premiumFlags || []).length > 0; });
  if (filterHighValue) filtered = filtered.filter(function(v) { return (v.est_value || 0) >= 500; });

  // Sort
  if (sortMode === 'score') filtered.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
  else if (sortMode === 'age') filtered.sort(function(a, b) { return (a.daysInYard || 0) - (b.daysInYard || 0); });
  else if (sortMode === 'value') filtered.sort(function(a, b) { return (b.est_value || 0) - (a.est_value || 0); });
  else if (sortMode === 'row') filtered.sort(function(a, b) {
    var aRow = a.row_number != null ? parseInt(a.row_number, 10) : Infinity;
    var bRow = b.row_number != null ? parseInt(b.row_number, 10) : Infinity;
    if (isNaN(aRow)) aRow = Infinity;
    if (isNaN(bRow)) bRow = Infinity;
    return aRow - bRow;
  });

  // Split into top vehicles and guaranteed (rare finds)
  var topVehicles = filtered.filter(function(v) { return !v.isGuaranteedInclusion; });
  var rareFinds = filtered.filter(function(v) { return v.isGuaranteedInclusion; });

  // Status bar
  var countText = topVehicles.length + ' vehicles';
  if (rareFinds.length > 0) countText += ' + ' + rareFinds.length + ' rare finds';
  h += '<div class="status-bar"><span>' + countText + '</span>';
  h += '<span>Updated ' + (activeTripData.generated_at ? new Date(activeTripData.generated_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : 'now') + '</span></div>';

  // Vehicle list
  if (filtered.length === 0) {
    // If filtering by a specific yard, show yard metadata
    var emptyYard = activeYardFilter !== 'all' ? tripYards.find(function(y) { return y.id === activeYardFilter; }) : null;
    if (emptyYard) {
      var methodMap = { lkq: 'Local scrape (nightly)', pullapart: 'Server scrape (daily 6am UTC)', on_demand: 'Server scrape (daily 6am UTC)', carolina: 'Server scrape (daily 6am UTC)', chesterfield: 'Server scrape (daily 6am UTC)', upullandsave: 'Server scrape (daily 6am UTC)', pickapartva: 'Server scrape (daily 6am UTC)', manual: 'Manual paste only' };
      var methodDisplay = methodMap[(emptyYard.scrape_method || '').toLowerCase()] || (emptyYard.scrape_method || 'unknown');
      var lastScraped = emptyYard.last_scraped ? timeAgo(emptyYard.last_scraped) : 'Never';
      var dist = Math.round(parseFloat(emptyYard.distance_from_base) || 0);
      h += '<div class="card" style="margin-top:8px">';
      h += '<div style="font-size:15px;font-weight:700;margin-bottom:8px">' + esc(emptyYard.name) + '</div>';
      h += '<div style="font-size:12px;color:var(--text-muted);line-height:1.8">';
      h += 'Chain: ' + esc(emptyYard.chain || '?') + '<br>';
      h += 'Method: ' + esc(methodDisplay) + '<br>';
      h += 'Last scraped: ' + esc(lastScraped) + '<br>';
      h += 'Distance: ' + dist + 'mi</div>';
      h += '<div style="margin-top:12px;font-size:12px;color:var(--text-faint);line-height:1.6">No vehicles scored for this yard yet.<br>';
      h += 'Tap SCRAPE to trigger a manual scrape for non-LKQ yards.</div>';
      h += '</div>';
    } else {
      h += '<div class="empty">No vehicles above threshold. Top 50 per yard shown plus rare finds (manual, diesel, 4x4, premium, performance, cult). Road trip floor: $1,000+. Day trip floor: $600+.</div>';
    }
  } else {
    h += '<div style="margin:0 12px">';
    topVehicles.forEach(function(v) { h += renderVehicleCard(v); });
    if (rareFinds.length > 0) {
      h += '<div style="text-align:center;padding:16px 0 8px;border-top:1px solid #2a2a2a;margin-top:8px"><span style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#eab308;text-transform:uppercase">Rare Finds</span></div>';
      rareFinds.forEach(function(v) { h += renderVehicleCard(v); });
    }
    h += '</div>';
  }

  el.innerHTML = h;
}

function renderVehicleCard(v) {
  var sc = v.color_code || 'gray';
  var make = cleanModel(v.make || '', '');
  var model = cleanModel(v.model || '', v.make || '');
  var engine = v.engine ? ' <span style="font-size:12px;color:#b0b0b0;font-weight:600">' + esc(v.engine) + '</span>' : '';

  var trimBadge = '';
  if (v.trimBadge) {
    var tbColor = v.trimBadge.color === 'green' ? '#22c55e' : v.trimBadge.color === 'blue' ? '#3b82f6' : v.trimBadge.color === 'gray' ? '#374151' : '#f59e0b';
    var tbText = v.trimBadge.color === 'gray' ? '#9ca3af' : '#000';
    trimBadge = ' <span class="chip" style="font-size:9px;padding:1px 6px;background:' + tbColor + ';color:' + tbText + ';font-weight:' + (v.trimBadge.color === 'gray' ? '500' : '700') + '">' + esc(v.trimBadge.decodedTrim || v.trimBadge.label) + '</span>';
  }

  var rowNum = v.row_number ? '<span style="font-size:11px;color:var(--text-faint);float:right">Row ' + esc(v.row_number) + '</span>' : '';

  // Premium flag badges
  var badges = '';
  var pf = v.premiumFlags || [];
  pf.forEach(function(f) {
    if (f === 'PERFORMANCE') badges += '<span class="chip" style="font-size:9px;padding:1px 6px;background:#f97316;color:#000;font-weight:700">PERFORMANCE</span> ';
    if (f === 'PREMIUM') badges += '<span class="chip" style="font-size:9px;padding:1px 6px;background:#eab308;color:#000;font-weight:700">PREMIUM</span> ';
    if (f === 'CULT') badges += '<span class="chip" style="font-size:9px;padding:1px 6px;background:#d946ef;color:#000;font-weight:700">CULT</span> ';
    if (f === 'MANUAL') badges += '<span class="chip" style="font-size:9px;padding:1px 6px;background:#06b6d4;color:#000;font-weight:700">MANUAL</span> ';
    if (f === 'DIESEL') badges += '<span class="chip" style="font-size:9px;padding:1px 6px;background:#166534;color:#22c55e;font-weight:700">DIESEL</span> ';
    if (f === '4WD') badges += '<span class="chip" style="font-size:9px;padding:1px 6px;background:#16a34a;color:#000;font-weight:700">4WD</span> ';
    if (f === 'AWD') badges += '<span class="chip" style="font-size:9px;padding:1px 6px;background:#16a34a;color:#000;font-weight:700">AWD</span> ';
  });
  if (v.isGuaranteedInclusion && v.guaranteedReason) {
    badges += '<span class="chip" style="font-size:8px;padding:1px 5px;background:#78350f;color:#fbbf24;font-weight:600;letter-spacing:0.05em">RARE: ' + esc(v.guaranteedReason) + '</span> ';
  }

  // Days in yard badge
  var diy = v.daysInYard || 0;
  if (diy > 0) {
    var ageColor = diy <= 3 ? '#22c55e' : diy <= 7 ? '#eab308' : diy <= 14 ? '#f97316' : '#6B7280';
    badges += '<span style="font-size:10px;color:' + ageColor + '">' + diy + 'd</span>';
  }

  // Part type chips — names only, no dollar amounts (matches Daily Feed)
  var chipSource = v.part_chips || [];
  var chipTypes = {};
  var chips = '';
  chipSource.filter(function(p) {
    var t = p.partType || '?';
    if (chipTypes[t]) return false;
    chipTypes[t] = true;
    return true;
  }).sort(function(a, b) { return (b.price || 0) - (a.price || 0); }).slice(0, 4).forEach(function(p) {
    var price = p.price || 0;
    var cc = price >= 250 ? 'chip-green' : price >= 150 ? 'chip-yellow' : price >= 100 ? 'chip-orange' : price > 0 ? 'chip-red' : 'chip-gray';
    chips += '<span class="chip ' + cc + '">' + esc(p.partType || '?') + '</span> ';
  });

  var yardLabel = activeYardFilter === 'all' && v._yardName ? '<span style="font-size:9px;color:var(--text-faint)">' + esc(v._yardName.replace(/^LKQ |^Pull-A-Part /, '')) + '</span> ' : '';

  var h = '<div class="vehicle-row" id="vrow-' + v.id + '">';
  h += '<div class="v-collapsed" onclick="toggleV(\'' + v.id + '\')">';
  h += '<div class="v-score ' + sc + '">' + (v.score || 0) + '</div>';
  h += '<div class="v-info">';
  h += '<div class="v-title"><strong style="color:#fff">' + esc(v.year) + ' ' + esc(make) + ' ' + esc(model) + '</strong>' + engine + trimBadge + ' ' + rowNum + '</div>';
  if (badges) h += '<div class="v-badges">' + yardLabel + badges + '</div>';
  h += '<div class="v-chips">' + (chips || '<span class="chip chip-gray">No data</span>') + '</div>';
  h += '</div>';
  h += '<div class="v-right">';
  if (v.est_value > 0) h += '<div class="v-value">$' + v.est_value + '</div>';
  if (v.matched_parts > 0) h += '<div class="v-parts-count">' + v.matched_parts + ' parts</div>';
  h += '</div></div>';

  // Expanded view — loaded on demand via API
  h += '<div class="v-expanded" id="vexp-' + v.id + '">';
  h += '<div style="padding:12px 0;color:#9CA3AF;font-size:12px;">Tap to load parts...</div>';
  h += '</div>';
  h += '</div>';
  return h;
}

async function toggleV(id) {
  var exp = document.getElementById('vexp-' + id);
  if (!exp) return;

  if (exp.classList.contains('open')) {
    exp.classList.remove('open');
    return;
  }

  // Load parts on-demand via API — same as Daily Feed
  if (exp.dataset.loaded !== 'true') {
    exp.innerHTML = '<div style="padding:12px 0;color:#9CA3AF;font-size:12px;">Loading parts...</div>';
    exp.classList.add('open');

    try {
      var res = await fetch('/flyway/vehicle/' + id + '/parts');
      var data = await res.json();
      if (data.success) {
        exp.innerHTML = renderExpandedParts(id, data);
        exp.dataset.loaded = 'true';
      } else {
        exp.innerHTML = '<div style="padding:12px 0;color:#ef4444;font-size:12px;">Failed to load parts</div>';
      }
    } catch (e) {
      exp.innerHTML = '<div style="padding:12px 0;color:#ef4444;font-size:12px;">Failed to load parts</div>';
    }
  } else {
    exp.classList.add('open');
  }
}

function renderExpandedParts(vehicleId, data) {
  var parts = data.parts || [];
  if (parts.length === 0) return '<div style="padding:10px 0;color:var(--text-faint);font-size:12px">No matching parts found.</div>';

  var h = '';

  // Sort: sold first, then market, then estimates — then by display price DESC
  parts.sort(function(a, b) {
    var soldA = (a.sold_90d || 0) > 0 ? 1 : (a.marketMedian > 0 ? 2 : 3);
    var soldB = (b.sold_90d || 0) > 0 ? 1 : (b.marketMedian > 0 ? 2 : 3);
    if (soldA !== soldB) return soldA - soldB;
    var pA = (a.sold_90d > 0 && a.price > 0) ? a.price : (a.marketMedian > 0 ? a.marketMedian : a.price || 0);
    var pB = (b.sold_90d > 0 && b.price > 0) ? b.price : (b.marketMedian > 0 ? b.marketMedian : b.price || 0);
    return pB - pA;
  });

  parts.forEach(function(p) {
    var hasOurSales = (p.sold_90d || 0) > 0 && p.price > 0;
    var isEst = p.priceSource === 'estimate';
    var displayPrice = hasOurSales ? p.price : (p.marketMedian > 0 ? p.marketMedian : (p.price != null ? p.price : 0));
    var badgeVerdict = isEst && !hasOurSales && !p.marketMedian ? 'EST' : displayPrice >= 250 ? 'GREAT' : displayPrice >= 150 ? 'GOOD' : displayPrice >= 100 ? 'FAIR' : 'POOR';
    var vc = badgeVerdict === 'EST' ? 'chip-gray' : badgeVerdict === 'GREAT' ? 'chip-green' : badgeVerdict === 'GOOD' ? 'chip-cyan' : badgeVerdict === 'FAIR' ? 'chip-yellow' : 'chip-gray';
    var pricePrefix = isEst && !hasOurSales && !p.marketMedian ? '~$' : '$';

    var freshness = '';
    if (hasOurSales) {
      if (p.lastSoldDate) {
        var daysAgo = Math.floor((Date.now() - new Date(p.lastSoldDate).getTime()) / 86400000);
        freshness = daysAgo <= 30 ? '\u2705' : daysAgo <= 60 ? '\u26A0\uFE0F' : '\u274C';
      } else {
        freshness = '\u2705';
      }
    } else if (p.marketCheckedAt) {
      var daysSince = Math.floor((Date.now() - new Date(p.marketCheckedAt).getTime()) / 86400000);
      freshness = daysSince <= 60 ? '\u2705' : daysSince <= 90 ? '\u26A0\uFE0F' : '\u274C';
    } else if (p.marketMedian > 0) {
      freshness = '\u2705';
    } else {
      freshness = '\u2753';
    }

    h += '<div class="part-row" style="flex-direction:column;align-items:stretch;padding:10px 0">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center">';
    h += '<div style="font-size:13px;font-weight:600">' + (p.isMarked ? '<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;background:#f59e0b;color:#000;margin-right:4px">MARKED</span>' : '') + (p.partType ? '[' + esc(p.partType) + '] ' : '') + esc(p.title || p.category || 'Part') + '</div>';
    h += '<div><span class="chip ' + vc + '" style="font-size:10px">' + badgeVerdict + ' ' + pricePrefix + displayPrice + ' ' + freshness + '</span></div>';
    h += '</div>';
    h += '<div style="font-size:11px;color:var(--text-muted);margin-top:3px;display:flex;gap:12px;flex-wrap:wrap">';
    h += '<span>' + (p.in_stock || 0) + ' in stock</span>';
    h += '<span>' + (p.sold_90d || 0) + ' sold/90d</span>';
    if (p.partNumber) h += '<span>' + esc(p.partNumber) + '</span>';
    if (isEst && !hasOurSales && !p.marketMedian) h += '<span style="color:#6B7280">est</span>';
    h += '</div>';
    if (p.reason) h += '<div style="font-size:11px;color:var(--text-muted);font-style:italic;margin-top:3px">' + esc(p.reason) + '</div>';
    if (p.marketMedian > 0) {
      var mColor = hasOurSales ? '#6B7280' : (Math.abs(displayPrice - p.marketMedian) / p.marketMedian > 0.2 ? (displayPrice > p.marketMedian ? '#ef4444' : '#eab308') : '#10B981');
      h += '<div style="font-size:11px;margin-top:3px;display:flex;gap:8px;color:#6B7280">';
      h += '<span>' + (hasOurSales ? 'Market ref' : 'Market') + '</span>';
      h += '<span style="color:' + mColor + ';font-weight:600">$' + p.marketMedian + ' med</span>';
      h += '<span>' + (p.marketCount || 0) + ' sold</span>';
      if (p.marketVelocity) h += '<span>' + p.marketVelocity.toFixed(1) + '/wk</span>';
      h += '</div>';
    }
    if (p.deadWarning && p.deadWarning.failureReason && p.deadWarning.failureReason !== 'unknown') {
      var dwText = p.deadWarning.failureReason === 'overpriced' ? 'Sat unsold \u2014 was overpriced vs market' : p.deadWarning.failureReason === 'low_demand' ? 'Sat unsold \u2014 low demand for this part' : esc(p.deadWarning.failureReason);
      h += '<div style="margin-top:4px;padding:4px 8px;background:#fee2e2;border-radius:4px;font-size:10px;color:#dc2626;font-weight:600;">' + dwText + '</div>';
    }
    h += '</div>';
  });

  // Rebuild reference
  var rebuildParts = data.rebuild_parts || [];
  if (rebuildParts.length > 0) {
    h += '<div style="margin-top:10px;padding-top:8px;border-top:2px dashed var(--border)">';
    h += '<div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Rebuild Reference</div>';
    rebuildParts.forEach(function(p) {
      var pd = p.priceRange || ('$' + p.price);
      h += '<div style="padding:4px 0;opacity:0.6;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af">';
      h += '<span>[REBUILD] ' + esc(p.seller || 'pro-rebuild') + ' \u2014 ' + esc(p.partType || 'Part') + '</span>';
      h += '<span style="font-weight:600">' + pd + '</span>';
      h += '</div>';
    });
    h += '</div>';
  }

  return h;
}

function setYardFilter(yardId) {
  activeYardFilter = yardId;
  renderActiveTrip();
}

function setSort(mode) {
  sortMode = mode;
  renderActiveTrip();
}

function toggleFilter(which) {
  if (which === 'premium') filterPremium = !filterPremium;
  if (which === 'highvalue') filterHighValue = !filterHighValue;
  renderActiveTrip();
}

// ═══ SCRAPE ═══
async function triggerFlywayScrape(tripId) {
  var btn = document.getElementById('scrapeBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Scraping...'; }
  try {
    var data = await api('/flyway/trips/' + tripId + '/scrape', { method: 'POST' });
    if (data.success) {
      showToast('Scrape started. Non-LKQ yards will update in a few minutes. LKQ yards update via nightly local scrape.');
      setTimeout(function() { loadScrapeStatus(tripId); }, 30000);
    } else {
      showToast(data.error || 'Scrape failed');
    }
  } catch (err) {
    showToast('Scrape request failed');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'SCRAPE'; }
  }
}

async function loadScrapeStatus(tripId) {
  try {
    var data = await api('/flyway/trips/' + tripId + '/scrape-status');
    if (data.success && data.status) {
      data.status.forEach(function(y) {
        var scraped = y.last_scraped ? timeAgo(y.last_scraped) : 'never';
        var badge = y.scrape_type === 'local' ? 'LOCAL' : y.scrape_type === 'manual' ? 'PASTE' : 'AUTO';
        console.log('[Flyway] ' + y.name + ': ' + badge + ' | ' + scraped + ' | ' + y.vehicle_count + ' vehicles');
      });
    }
  } catch (err) { /* silent */ }
}

function showToast(msg) {
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#141414;border:1px solid #2a2a2a;color:#F0F0F0;padding:10px 16px;border-radius:8px;font-size:12px;z-index:300;max-width:90vw;text-align:center';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function() { el.remove(); }, 5000);
}

function confirmComplete() {
  if (!activeTrip) return;
  showConfirm('Complete Trip', 'Vehicle data will be kept for 24 hours. You can reinstate the trip during that window if you complete it by accident.', async function() {
    await api('/flyway/trips/' + activeTrip.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'complete' }) });
    activeTrip = null;
    activeTripData = null;
    switchView('history');
  });
}

// ═══ REINSTATE ═══
async function reinstateTrip(tripId) {
  var btn = document.querySelector('[data-reinstate="' + tripId + '"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Reinstating...'; }
  try {
    var data = await api('/flyway/trips/' + tripId + '/reinstate', { method: 'POST' });
    if (data.success) {
      showToast('Trip reinstated! Switching to Active view.');
      activeTrip = null;
      activeTripData = null;
      switchView('active');
    } else {
      showToast(data.error || 'Failed to reinstate trip');
      loadHistoryView();
    }
  } catch (err) {
    showToast('Failed to reinstate trip');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'REINSTATE TRIP'; }
  }
}

// ═══ HISTORY VIEW ═══
async function loadHistoryView() {
  var el = document.getElementById('historyContent');
  el.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading...</div></div>';
  var data = await api('/flyway/trips?status=complete');
  var trips = data.trips || [];

  if (trips.length === 0) {
    el.innerHTML = '<div class="empty">No completed trips yet.</div>';
    return;
  }

  var h = '';
  trips.forEach(function(t) {
    var yardNames = (t.yards || []).map(function(y) { return esc(y.name); }).join(', ') || 'No yards';
    var badge = tripTypeBadge(t);
    var dateDisplay = (t.trip_type === 'day_trip' || t.start_date === t.end_date) ? fmtDate(t.start_date) : fmtDateRange(t.start_date, t.end_date);
    h += '<div class="trip-card">';
    h += '<div class="trip-card-header"><div><div class="trip-name">' + esc(t.name) + ' ' + badge + '</div>';
    h += '<div class="trip-dates">' + dateDisplay + '</div>';
    h += '<div style="font-size:10px;color:var(--text-faint);margin-top:2px">' + (t.yards || []).length + ' yards: ' + yardNames + '</div>';
    if (t.canReinstate && t.gracePeriodRemaining > 0) {
      var hoursAgo = Math.round((24 - t.gracePeriodRemaining) * 10) / 10;
      h += '<div style="font-size:11px;color:#eab308;margin-top:6px">Completed ' + hoursAgo + 'h ago \u2014 ' + t.gracePeriodRemaining + 'h remaining</div>';
    }
    h += '</div><span class="chip chip-gray">COMPLETE</span></div>';
    if (t.canReinstate) {
      h += '<div class="trip-actions"><button class="btn btn-green btn-sm" data-reinstate="' + t.id + '" onclick="reinstateTrip(' + t.id + ')">REINSTATE TRIP</button></div>';
    }
    h += '</div>';
  });
  el.innerHTML = h;
}

// ═══ INIT ═══
async function init() {
  var hash = location.hash.replace('#', '') || '';

  var data = await api('/flyway/trips');
  allTrips = data.trips || [];
  var active = allTrips.filter(function(t) { return t.status === 'active'; });

  if (active.length > 0 && hash !== 'plan' && hash !== 'history') {
    switchView('active');
  } else if (hash === 'history') {
    switchView('history');
  } else {
    switchView('plan');
  }
}

init();
</script>
</body>
</html>
```
---
## FILE: service/public/gate.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk - NEST PROTECTOR</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{--bg:#0a0a0a;--s:#141414;--s2:#1a1a1a;--b:#2a2a2a;--r:#DC2626;--rd:#7f1d1d;--y:#eab308;--yd:#713f12;--g:#22c55e;--gd:#064e3b;--t:#F0F0F0;--tm:#d1d5db;--tf:#6b7280}
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--t);min-height:100vh;padding-bottom:60px;-webkit-tap-highlight-color:transparent}

  /* Header + Nav (matches all other admin pages) */
  .top-header{background:var(--s);border-bottom:1px solid var(--b);padding:10px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100}
  .top-header img{height:40px;border-radius:6px;filter:drop-shadow(0 0 6px rgba(220,38,38,0.4))}
  .top-header .brand{font-size:16px;font-weight:900;letter-spacing:2px}
  .top-header .brand span{color:var(--r)}
  .top-header .sub{font-size:10px;color:var(--tf);margin-top:1px}
  nav{display:flex;gap:6px;padding:6px 14px;background:var(--bg);border-bottom:1px solid var(--b);overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;font-size:11px}
  nav::-webkit-scrollbar{display:none}
  nav a{color:var(--tf);text-decoration:none;padding:4px 8px;border-radius:4px;white-space:nowrap;background:var(--s2)}
  nav a.active{color:var(--r);font-weight:700}

  .c{padding:12px;max-width:520px;margin:0 auto}
  .card{background:var(--s);border:1px solid var(--b);border-radius:10px;padding:14px;margin-bottom:10px}
  .card-title{font-size:10px;font-weight:700;color:var(--tf);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
  select{width:100%;padding:10px;background:var(--s2);border:1px solid var(--b);border-radius:8px;color:var(--t);font-size:15px;appearance:none}
  select:focus{outline:none;border-color:var(--r)}

  /* Hero summary */
  .hero{text-align:center;padding:16px 12px;border-radius:10px;margin-bottom:4px}
  .hero.green{background:var(--gd)} .hero.yellow{background:var(--yd)} .hero.red{background:var(--rd)}
  .hero .mv{font-size:13px;color:var(--tf);margin-bottom:2px}
  .hero .mv b{color:var(--tm);font-size:15px}
  .hero .target-label{font-size:11px;font-weight:600;color:var(--tm);text-transform:uppercase;letter-spacing:.05em;margin-top:8px}
  .hero .target-amount{font-size:48px;font-weight:800;letter-spacing:-.04em}
  .hero.green .target-amount{color:var(--g)} .hero.yellow .target-amount{color:var(--y)} .hero.red .target-amount{color:var(--r)}
  .hero .ceiling{font-size:13px;color:var(--tf);margin-top:4px}
  .hero .ceiling b{color:var(--y)}
  .hero .blended{font-size:13px;margin-top:6px;font-weight:700}
  .bar{height:6px;background:var(--s2);border-radius:3px;margin:8px 0 4px;overflow:hidden}
  .bar-fill{height:100%;border-radius:3px;transition:width .3s}
  .bar-labels{display:flex;justify-content:space-between;font-size:9px;color:var(--tf)}

  /* Part rows - desktop: single line. Mobile: two lines */
  .part{background:var(--s2);border:1px solid var(--b);border-radius:8px;padding:12px;margin-bottom:8px}
  .part-top{display:flex;align-items:center;gap:8px}
  .part-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}
  .part-dot.green{background:var(--g)} .part-dot.yellow{background:var(--y)} .part-dot.red{background:var(--r)}
  .part-name{font-size:14px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .part-mv{font-size:12px;color:var(--tf);flex-shrink:0}
  .part-rm{width:28px;height:28px;border:1px solid var(--b);border-radius:6px;background:var(--s);color:var(--r);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .part-bottom{display:flex;align-items:center;gap:10px;margin-top:8px;padding-top:8px;border-top:1px solid #222}
  .cogs-label{font-size:11px;color:var(--tf);flex-shrink:0}
  .cogs-input{width:70px;text-align:center;padding:10px 6px;background:var(--bg);border:2px solid var(--b);border-radius:8px;color:var(--t);font-size:18px;font-weight:700;flex-shrink:0}
  .cogs-input:focus{border-color:var(--r);outline:none}
  .part-pct{font-size:14px;font-weight:700;flex-shrink:0;margin-left:auto}
  .part-pct.green{color:var(--g)} .part-pct.yellow{color:var(--y)} .part-pct.red{color:var(--r)}
  .part-select{font-size:13px;padding:6px 8px;background:var(--s);border:1px solid var(--b);border-radius:6px;color:var(--t);flex:1;min-width:0;appearance:none}

  .add-btn{width:100%;padding:12px;background:var(--s2);border:1px dashed var(--b);border-radius:8px;color:var(--tf);font-size:13px;font-weight:600;cursor:pointer;margin-top:4px}

  /* Check Stock */
  .section-header{font-size:11px;font-weight:800;color:var(--tf);text-transform:uppercase;letter-spacing:.1em;padding:10px 14px 6px;background:var(--bg)}
  .stock-input{flex:1;padding:12px;background:var(--s2);border:1px solid var(--b);border-radius:8px;color:var(--t);font-size:16px;font-weight:600;letter-spacing:.05em}
  .stock-input:focus{outline:none;border-color:var(--r)}
  .stock-input::placeholder{color:var(--tf);font-weight:400;letter-spacing:0}
  .stock-btn{padding:12px 16px;border-radius:8px;border:none;font-size:13px;font-weight:700;cursor:pointer}
  .stock-btn:disabled{opacity:.4}
  .stock-btn.search{background:var(--r);color:#fff}
  .stock-btn.clear{background:var(--s2);color:var(--tf);border:1px solid var(--b)}
  .stock-result{margin-top:10px;border-radius:8px;padding:10px 12px}
  .stock-result.exact{background:var(--gd);border:1px solid #166534}
  .stock-result.variant{background:var(--yd);border:1px solid #854d0e}
  .stock-result.none{background:var(--s2);border:1px solid var(--b)}
  .stock-result-header{font-size:12px;font-weight:700;margin-bottom:6px}
  .stock-item{padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.08);font-size:12px}
  .stock-item:last-child{border-bottom:none}
  .stock-item .si-title{font-weight:600;color:var(--t);line-height:1.3}
  .stock-item .si-meta{color:var(--tf);margin-top:2px;font-size:11px;display:flex;gap:8px}
  .stock-overstock{margin-top:6px;padding:6px 8px;background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);border-radius:6px;font-size:11px;color:var(--y)}

  /* Breakdown */
  .brow{display:flex;justify-content:space-between;padding:7px 0;font-size:12px;border-bottom:1px solid #1f1f1f}
  .brow:last-child{border:none}
  .brow .bl{color:var(--tf)} .brow .bv{font-weight:600}

  /* Mobile: stack the bottom row items */
  @media(max-width:500px){
    .part-mv{font-size:11px}
    .hero .target-amount{font-size:42px}
  }
</style>
</head>
<body>

<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('gate')</script>

<div class="c">
  <div class="section-header">CHECK STOCK</div>
  <div class="card">
    <div style="display:flex;gap:8px">
      <input type="text" class="stock-input" id="stockPN" placeholder="Enter part number to check stock..." autocomplete="off">
      <button class="stock-btn search" id="stockSearchBtn" onclick="checkStock()">Search</button>
      <button class="stock-btn clear" onclick="clearStock()">Clear</button>
    </div>
    <div id="stockResults"></div>
  </div>

  <div class="section-header">COGS CALCULATOR</div>
  <div class="card">
    <div class="card-title">Yard</div>
    <select id="yardSel" onchange="onYardChange()"><option value="">Loading yards...</option></select>
  </div>

  <div class="card" id="summaryCard" style="display:none">
    <div class="hero" id="hero">
      <div class="mv">Total Market Value: <b id="totalMV">$0</b></div>
      <div class="target-label">Max Parts Spend (Target)</div>
      <div class="target-amount" id="targetAmt">$0</div>
      <div class="ceiling">Absolute max: <b id="ceilingAmt">$0</b> (35% ceiling)</div>
      <div class="blended" id="blendedPct">0% COGS</div>
    </div>
    <div class="bar"><div class="bar-fill" id="barFill" style="width:0"></div></div>
    <div class="bar-labels"><span>0%</span><span style="color:var(--g)">25%</span><span style="color:var(--y)">35%</span><span>100%</span></div>
  </div>

  <div class="card">
    <div class="card-title">Parts at Register</div>
    <div id="partsList"></div>
    <button class="add-btn" onclick="addPart()">+ Add Part</button>
  </div>

  <div class="card" id="breakdownCard" style="display:none">
    <div class="card-title">Breakdown</div>
    <div id="breakdown"></div>
  </div>
</div>

<script>
let yards = [];
let yardProfile = null;
let partIdCounter = 0;

async function loadYards() {
  try {
    const r = await fetch('/cogs/yards');
    const d = await r.json();
    yards = d.yards || [];
    const sel = document.getElementById('yardSel');
    sel.innerHTML = '<option value="">Select a yard...</option>' +
      '<option value="custom">-- Custom Junkyard --</option>' +
      yards.map(y => '<option value="' + y.id + '">' + y.name + ' ($' + y.entry_fee + ' gate)</option>').join('');
  } catch(e) {
    document.getElementById('yardSel').innerHTML = '<option value="">Error loading yards</option>';
  }
}

async function onYardChange() {
  const id = document.getElementById('yardSel').value;
  if (!id) { yardProfile = null; document.getElementById('summaryCard').style.display = 'none'; document.getElementById('breakdownCard').style.display = 'none'; hideCustomYardInput(); return; }

  if (id === 'custom') {
    showCustomYardInput();
    yardProfile = {
      id: 'custom',
      name: 'Custom Junkyard',
      chain: 'custom',
      entryFee: 0,
      fixedOverhead: 0,
      cogsReference: getDefaultCogsReference(),
      defaultMarketValues: getDefaultMarketValues(),
    };
    document.getElementById('summaryCard').style.display = 'block';
    document.getElementById('breakdownCard').style.display = 'block';
    document.getElementById('partsList').innerHTML = '';
    partIdCounter = 0;
    addPart('ECM');
    addPart('BCM');
    return;
  }

  hideCustomYardInput();
  const r = await fetch('/cogs/yard-profile/' + id);
  const d = await r.json();
  if (!d.success) return;
  yardProfile = d;

  document.getElementById('summaryCard').style.display = 'block';
  document.getElementById('breakdownCard').style.display = 'block';

  document.getElementById('partsList').innerHTML = '';
  partIdCounter = 0;
  addPart('ECM');
  addPart('BCM');
}

function showCustomYardInput() {
  let el = document.getElementById('customYardWrap');
  if (!el) {
    el = document.createElement('div');
    el.id = 'customYardWrap';
    el.style.cssText = 'margin-top:10px';
    el.innerHTML = '<label style="font-size:11px;color:var(--tf);display:block;margin-bottom:4px">Yard Name (optional)</label>' +
      '<input type="text" id="customYardName" placeholder="e.g. Pull-A-Part Tampa" style="width:100%;padding:10px;background:var(--s2);border:1px solid var(--b);border-radius:8px;color:var(--t);font-size:14px" oninput="if(yardProfile)yardProfile.name=this.value||\'Custom Junkyard\'" />';
    document.getElementById('yardSel').parentNode.appendChild(el);
  }
  el.style.display = 'block';
}

function hideCustomYardInput() {
  const el = document.getElementById('customYardWrap');
  if (el) el.style.display = 'none';
}

function getDefaultCogsReference() {
  return {
    ECM: { label: 'ECM / Engine Computer', cogs: 0 },
    BCM: { label: 'BCM / Body Control', cogs: 0 },
    TCM: { label: 'TCM / Transmission Computer', cogs: 0 },
    ABS: { label: 'ABS Module', cogs: 0 },
    CLUSTER: { label: 'Instrument Cluster', cogs: 0 },
    RADIO: { label: 'Radio / Head Unit', cogs: 0 },
    AMPLIFIER: { label: 'Amplifier', cogs: 0 },
    HVAC: { label: 'HVAC Control Module', cogs: 0 },
    TPMS: { label: 'TPMS Module', cogs: 0 },
    SAS: { label: 'Steering Angle Sensor', cogs: 0 },
    OTHER: { label: 'Other Module', cogs: 0 },
  };
}

function getDefaultMarketValues() {
  return { ECM: 80, BCM: 60, TCM: 80, ABS: 50, CLUSTER: 60, RADIO: 50, AMPLIFIER: 40, HVAC: 30, TPMS: 30, SAS: 25, OTHER: 50 };
}

function getPartTypes() {
  if (!yardProfile) return [];
  return Object.entries(yardProfile.cogsReference).map(([key, val]) => ({
    type: key, label: val.label, cogs: val.cogs,
    marketValue: yardProfile.defaultMarketValues[key] || 50,
  }));
}

function addPart(defaultType) {
  partIdCounter++;
  const id = partIdCounter;
  const types = getPartTypes();
  const sel = defaultType ? types.find(t => t.type === defaultType) : types[0];
  if (!sel) return;

  const div = document.createElement('div');
  div.className = 'part';
  div.id = 'p' + id;
  div.innerHTML =
    '<div class="part-top">' +
      '<div class="part-dot green" id="dot' + id + '"></div>' +
      '<select class="part-select" id="type' + id + '" onchange="onTypeChange(' + id + ')">' +
        types.map(t => '<option value="' + t.type + '"' + (t.type === sel.type ? ' selected' : '') + ' data-cogs="' + t.cogs + '" data-mv="' + t.marketValue + '">' + t.label + '</option>').join('') +
      '</select>' +
      '<button class="part-rm" onclick="rmPart(' + id + ')">x</button>' +
    '</div>' +
    '<div class="part-bottom">' +
      '<span class="cogs-label">Market $</span>' +
      '<input type="number" class="cogs-input" id="mv' + id + '" value="' + sel.marketValue + '" min="0" step="5" inputmode="numeric" oninput="recalc()" />' +
      '<span class="cogs-label">COGS $</span>' +
      '<input type="number" class="cogs-input" id="cogs' + id + '" value="' + sel.cogs + '" min="0" step="1" inputmode="numeric" oninput="recalc()" />' +
      '<span class="part-pct green" id="pct' + id + '">0%</span>' +
    '</div>';

  document.getElementById('partsList').appendChild(div);
  recalc();
}

function onTypeChange(id) {
  const s = document.getElementById('type' + id);
  const opt = s.options[s.selectedIndex];
  document.getElementById('cogs' + id).value = opt.dataset.cogs;
  document.getElementById('mv' + id).value = opt.dataset.mv;
  recalc();
}

function rmPart(id) {
  document.getElementById('p' + id)?.remove();
  recalc();
}

function recalc() {
  if (!yardProfile) return;

  let totalMV = 0, totalCogs = 0;
  document.querySelectorAll('.part').forEach(p => {
    const id = p.id.replace('p', '');
    const mvEl = document.getElementById('mv' + id);
    const cogsEl = document.getElementById('cogs' + id);
    const pctEl = document.getElementById('pct' + id);
    const dotEl = document.getElementById('dot' + id);
    if (!mvEl || !cogsEl) return;

    const mv = parseFloat(mvEl.value) || 0;
    const cogs = parseFloat(cogsEl.value) || 0;
    totalMV += mv;
    totalCogs += cogs;

    const pct = mv > 0 ? (cogs / mv) * 100 : 0;
    pctEl.textContent = Math.round(pct) + '%';
    const c = pct <= 25 ? 'green' : pct <= 35 ? 'yellow' : 'red';
    pctEl.className = 'part-pct ' + c;
    dotEl.className = 'part-dot ' + c;
  });

  const overhead = yardProfile.fixedOverhead;
  const currentTotal = totalCogs + overhead;
  const blended = totalMV > 0 ? (currentTotal / totalMV) * 100 : 0;
  const target = Math.max(0, Math.round(totalMV * 0.30 - overhead));
  const ceiling = Math.max(0, Math.round(totalMV * 0.35 - overhead));
  const color = blended <= 25 ? 'green' : blended <= 35 ? 'yellow' : 'red';

  document.getElementById('totalMV').textContent = '$' + Math.round(totalMV);
  document.getElementById('targetAmt').textContent = ceiling <= 0 ? 'SKIP' : '$' + target;
  document.getElementById('ceilingAmt').textContent = '$' + ceiling;
  document.getElementById('blendedPct').textContent = blended.toFixed(1) + '% COGS';
  document.getElementById('blendedPct').style.color = color === 'green' ? 'var(--g)' : color === 'yellow' ? 'var(--y)' : 'var(--r)';
  document.getElementById('hero').className = 'hero ' + color;

  const fill = document.getElementById('barFill');
  fill.style.width = Math.min(100, blended) + '%';
  fill.style.background = color === 'green' ? 'var(--g)' : color === 'yellow' ? 'var(--y)' : 'var(--r)';

  document.getElementById('breakdown').innerHTML =
    '<div class="brow"><span class="bl">Gate fee</span><span class="bv">$' + yardProfile.entryFee + '</span></div>' +
    '<div class="brow"><span class="bl">Parts at register</span><span class="bv">$' + Math.round(totalCogs) + '</span></div>' +
    '<div class="brow" style="border-top:1px solid var(--b);padding-top:8px;margin-top:2px"><span class="bl" style="font-weight:600">Target (30%)</span><span class="bv" style="color:var(--g)">$' + target + '</span></div>' +
    '<div class="brow"><span class="bl" style="font-weight:600">Absolute max (35%)</span><span class="bv" style="color:var(--y)">$' + ceiling + '</span></div>' +
    '<div class="brow"><span class="bl" style="font-weight:600">Blended COGS</span><span class="bv" style="color:' + (color === 'green' ? 'var(--g)' : color === 'yellow' ? 'var(--y)' : 'var(--r)') + '">' + blended.toFixed(1) + '%</span></div>';
}

// ── CHECK STOCK ─────────────────────────────────────────────
document.getElementById('stockPN').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') checkStock();
});

function checkStock() {
  var pn = document.getElementById('stockPN').value.trim();
  if (!pn || pn.length < 4) {
    document.getElementById('stockResults').innerHTML = '<div class="stock-result none"><div style="font-size:11px;color:var(--tf)">Enter at least 4 characters</div></div>';
    return;
  }
  var btn = document.getElementById('stockSearchBtn');
  btn.disabled = true; btn.textContent = 'Checking...';
  document.getElementById('stockResults').innerHTML = '';

  fetch('/cogs/check-stock?pn=' + encodeURIComponent(pn))
    .then(function(r) {
      if (!r.ok) throw new Error('Server error');
      return r.json();
    })
    .then(function(d) {
      btn.disabled = false; btn.textContent = 'Search';
      var h = '';

      if (d.totalExact > 0) {
        h += '<div class="stock-result exact">';
        h += '<div class="stock-result-header" style="color:var(--g)">\u2713 IN STOCK \u2014 ' + d.totalExact + ' exact match' + (d.totalExact > 1 ? 'es' : '') + '</div>';
        d.exact.forEach(function(item) {
          h += '<div class="stock-item">';
          h += '<div class="si-title">' + esc(item.title) + '</div>';
          h += '<div class="si-meta">';
          if (item.currentPrice) h += '<span style="color:var(--g);font-weight:700">$' + item.currentPrice.toFixed(2) + '</span>';
          h += '<span>Qty: ' + item.quantity + '</span>';
          h += '<a href="https://www.ebay.com/itm/' + esc(item.ebayItemId) + '" target="_blank" style="color:var(--tf);text-decoration:none">#' + esc(item.ebayItemId) + '</a>';
          h += '</div></div>';
        });
        h += '</div>';
      }

      if (d.totalVariants > 0) {
        h += '<div class="stock-result variant">';
        h += '<div class="stock-result-header" style="color:var(--y)">\u26A0 VARIANT' + (d.totalExact > 0 ? 'S' : ' FOUND') + ' \u2014 ' + d.totalVariants + ' similar part number' + (d.totalVariants > 1 ? 's' : '') + '</div>';
        d.variants.forEach(function(item) {
          h += '<div class="stock-item">';
          h += '<div class="si-title">' + esc(item.title) + '</div>';
          h += '<div class="si-meta">';
          if (item.currentPrice) h += '<span style="color:var(--g);font-weight:700">$' + item.currentPrice.toFixed(2) + '</span>';
          h += '<span>Qty: ' + item.quantity + '</span>';
          h += '</div>';
          if (item.variantNote) h += '<div style="font-size:10px;color:var(--y);margin-top:2px">' + esc(item.variantNote) + '</div>';
          h += '</div>';
        });
        h += '</div>';
      }

      if (d.totalExact === 0 && d.totalVariants === 0) {
        h += '<div class="stock-result none">';
        h += '<div style="font-size:13px;color:var(--tf)">No stock found for <b style="color:var(--t)">' + esc(d.searchPN) + '</b></div>';
        h += '<div style="font-size:11px;color:var(--tf);margin-top:4px">This part is not in our inventory. Safe to buy.</div>';
        h += '</div>';
      }

      if (d.overstock) {
        h += '<div class="stock-overstock">Tracked in Overstock Watch \u2014 ' + d.overstock.groupName + ' \u2014 ' + d.overstock.currentStock + ' in stock, restock at ' + d.overstock.restockTarget + '</div>';
      }

      document.getElementById('stockResults').innerHTML = h;
    })
    .catch(function(err) {
      btn.disabled = false; btn.textContent = 'Search';
      document.getElementById('stockResults').innerHTML = '<div class="stock-result none"><div style="color:var(--r);font-size:12px">Error: ' + (err.message || 'Failed') + '</div></div>';
    });
}

function clearStock() {
  document.getElementById('stockPN').value = '';
  document.getElementById('stockResults').innerHTML = '';
  document.getElementById('stockPN').focus();
}

function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

loadYards();
</script>
</body>
</html>
```
---
## FILE: service/public/vin-scanner.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk — HAWK EYE</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh}
.container{padding:12px;max-width:600px;margin:0 auto}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:10px}
.card-title{font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px}
.vin-input{width:100%;padding:12px;border:1px solid #333;border-radius:8px;font-size:18px;font-family:monospace;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;outline:none;background:#141414;color:#F0F0F0}
.vin-input:focus{border-color:#dc2626}
.vin-input::placeholder{color:#6B7280;font-size:13px;letter-spacing:0;font-weight:400}
.btn-row{display:flex;gap:8px;margin-top:10px}
.btn{padding:12px 16px;border-radius:8px;border:none;font-size:14px;font-weight:700;cursor:pointer}
.btn-red{background:#dc2626;color:#fff;flex:1}
.btn-red:disabled{opacity:.4}
.btn-cam{background:#1a1a1a;border:1px solid #333;font-size:20px;color:#d1d5db;padding:12px 16px}
.spinner{width:18px;height:18px;border:2px solid #333;border-top-color:#dc2626;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.b{font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;text-transform:uppercase}
.b-gr{background:#064e3b;color:#16a34a}.b-yl{background:#713f12;color:#a16207}.b-or{background:#7c2d12;color:#c2410c}.b-rd{background:#7f1d1d;color:#dc2626}.b-gy{background:#1a1a1a;color:#9CA3AF}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:5px 6px;color:#6B7280;font-size:9px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #2a2a2a}
td{padding:6px;border-bottom:1px solid #1f1f1f}
.pg{color:#16a34a;font-weight:700}.py{color:#ca8a04;font-weight:700}.po{color:#ea580c;font-weight:700}.pr{color:#dc2626;font-weight:700}
.section-empty{color:#6B7280;font-size:12px;padding:10px 0;text-align:center}
.hist-link{display:block;text-align:center;padding:10px;font-size:11px;color:#6B7280;cursor:pointer;text-decoration:underline}
.h-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1f1f1f;cursor:pointer}
.h-vin{font-family:monospace;font-size:11px;font-weight:700}
.h-veh{font-size:10px;color:#9CA3AF}
.h-time{font-size:10px;color:#6B7280}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('vin')</script>
<div class="container">
  <div class="card">
    <div class="card-title">Enter or Scan VIN</div>
    <input type="text" class="vin-input" id="vinInput" maxlength="17" placeholder="17-character VIN" autocomplete="off" spellcheck="false">
    <div class="btn-row">
      <button class="btn btn-cam" id="camBtn">📷</button>
      <button class="btn btn-red" id="decBtn" onclick="doScan()">Decode</button>
    </div>
    <div style="font-size:10px;color:#6B7280;margin-top:6px">Tip: check door jamb sticker if dash has glare</div>
    <div id="status" style="font-size:11px;color:#9CA3AF;margin-top:4px"></div>
  </div>
  <div id="results"></div>
  <div id="instantResearch" style="display:none">
    <div class="card" style="border-color:#dc2626;border-width:2px">
      <button onclick="runInstantResearch()" id="researchBtn" class="btn btn-red" style="width:100%;padding:14px;font-size:15px">Instant Research — What to Pull</button>
      <div id="researchResults"></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Standalone Research</div>
    <input type="text" class="vin-input" id="researchInput" placeholder="2011 Toyota Sequoia 5.7L" style="font-size:14px;letter-spacing:0">
    <div class="btn-row">
      <button class="btn btn-red" id="standaloneBtn" onclick="runStandaloneResearch()" style="flex:1">Research Vehicle</button>
    </div>
    <div id="standaloneResults"></div>
  </div>
  <div id="histArea"><span class="hist-link" onclick="loadHistory(this)">Show Recent Scans</span></div>
</div>
<script>
function esc(s){if(!s)return '';var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
var V=document.getElementById('vinInput');
V.focus();
V.addEventListener('keydown',function(e){if(e.key==='Enter')doScan()});

// Camera photo processing — Image+canvas, resize aggressively for mobile memory
async function processVinPhoto(file) {
  try {
    var url = URL.createObjectURL(file);
    var img = new Image();
    await new Promise(function(resolve, reject) { img.onload = resolve; img.onerror = function() { reject(new Error('Failed to load image')); }; img.src = url; });
    // Resize to max 1280px on longest side — enough for VIN reading
    var MAX_DIM = 1280;
    var w = img.naturalWidth, h = img.naturalHeight;
    if (w > MAX_DIM || h > MAX_DIM) {
      if (w > h) { h = Math.round(h * (MAX_DIM / w)); w = MAX_DIM; }
      else { w = Math.round(w * (MAX_DIM / h)); h = MAX_DIM; }
    }
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url); img.src = '';
    var b64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
    // If still too large (>1.5MB base64), reduce further
    if (b64.length > 1500000) {
      canvas.width = Math.round(w * 0.5); canvas.height = Math.round(h * 0.5);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      b64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 1; canvas.height = 1;
    return b64;
  } catch(err) {
    throw new Error('Could not process photo: ' + err.message);
  }
}

document.getElementById('camBtn').onclick=function(){
  var inp=document.createElement('input');
  inp.type='file';inp.accept='image/*';inp.capture='environment';
  inp.onchange=async function(e){
    var file=e.target.files[0];if(!file)return;
    document.getElementById('status').textContent='Reading VIN from photo...';
    document.getElementById('results').innerHTML='<div class="card" style="text-align:center;padding:16px"><div class="spinner"></div><div style="margin-top:6px;color:#6B7280;font-size:12px">Processing...</div></div>';
    try{
      var b64=await processVinPhoto(file);
      var r=await fetch('/vin/decode-photo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:b64})}).then(function(r){return r.json()});
      b64=null;
      if(r.vin&&r.vin!=='UNREADABLE'&&r.vin.length>=11){
        V.value=r.vin;document.getElementById('status').textContent='VIN read: '+r.vin;doScan('camera');
      }else{
        document.getElementById('status').textContent='Could not read VIN. Try closer.';
        document.getElementById('results').innerHTML='<div class="card" style="text-align:center;color:#dc2626;font-weight:600">Could not read VIN<div style="color:#9CA3AF;font-size:12px;font-weight:400;margin-top:4px">Avoid glare, get closer, or try door jamb sticker.</div></div>';
      }
    }catch(err){
      document.getElementById('status').textContent='Error: '+err.message;
      document.getElementById('results').innerHTML='<div class="card" style="color:#dc2626">Error: '+err.message+'</div>';
    }
  };
  inp.click();
};

function doScan(src){
  var vin=V.value.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,'');
  if(vin.length<11){document.getElementById('results').innerHTML='<div class="card" style="color:#dc2626;font-size:13px">Enter at least 11 characters</div>';return;}
  var btn=document.getElementById('decBtn');btn.disabled=true;btn.innerHTML='<div class="spinner" style="margin:0 auto"></div>';
  document.getElementById('results').innerHTML='<div class="card" style="text-align:center;padding:16px"><div class="spinner"></div><div style="margin-top:6px;color:#6B7280;font-size:12px">Decoding...</div></div>';
  fetch('/vin/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vin:vin,source:src||'manual'})})
  .then(function(r){return r.json()})
  .then(function(data){if(!data.success)throw new Error(data.error);render(data);})
  .catch(function(err){document.getElementById('results').innerHTML='<div class="card" style="color:#dc2626">Error: '+err.message+'</div>';})
  .finally(function(){btn.disabled=false;btn.textContent='Decode';});
}

function vd(v){return v>=250?'GREAT':v>=150?'GOOD':v>=100?'FAIR':'POOR'}
function vc(v){return v==='GREAT'?'b-gr':v==='GOOD'?'b-yl':v==='FAIR'?'b-or':'b-rd'}
function pc(v){return v>=250?'pg':v>=150?'py':v>=100?'po':'pr'}
function ta(ds){if(!ds)return'-';var m=Math.floor((Date.now()-new Date(ds).getTime())/60000);if(m<1)return'now';if(m<60)return m+'m';var h=Math.floor(m/60);if(h<24)return h+'h';return Math.floor(h/24)+'d'}

function render(data){
  var d=data.decoded||{},sh=data.salesHistory||[],cs=data.currentStock||[],mr=data.marketRef||[];
  var h='';
  // Vehicle header
  var hl=[d.year,d.make,data.baseModel||d.model].filter(Boolean).join(' ');
  var sp=[d.engine,d.engineType&&d.engineType!=='Gas'?d.engineType:null,d.drivetrain,d.trim].filter(Boolean).join(' · ');
  h+='<div class="card"><div style="font-size:20px;font-weight:900;letter-spacing:-0.03em">'+hl+'</div>';
  if(sp)h+='<div style="font-size:12px;font-weight:600;color:#d1d5db;margin-top:2px">'+sp+'</div>';
  h+='<div style="font-family:monospace;font-size:13px;color:#16a34a;font-weight:700;margin-top:4px">'+data.vin+'</div></div>';

  // Build unified parts list
  var pm={};
  sh.forEach(function(s){if(s.partType)pm[s.partType]={pt:s.partType,sold:s.sold,avg:s.avgPrice,last:s.lastSoldDate,title:s.sampleTitle,stk:0,mprice:0};});
  cs.forEach(function(c){if(!c.partType)return;if(pm[c.partType])pm[c.partType].stk=c.inStock;else pm[c.partType]={pt:c.partType,sold:0,avg:0,last:null,title:null,stk:c.inStock,mprice:c.avgPrice};});
  mr.filter(function(m){return!m.isRebuild&&m.partType}).forEach(function(m){
    if(pm[m.partType]){pm[m.partType].mprice=m.avgPrice;if(!pm[m.partType].stk)pm[m.partType].stk=m.inStock||0;}
    else pm[m.partType]={pt:m.partType,sold:m.yourSold||0,avg:m.yourAvg||m.avgPrice,last:null,title:null,stk:m.inStock||0,mprice:m.avgPrice};
  });

  var parts=[];
  for(var k in pm){var p=pm[k];if(p.pt&&p.pt!=='OTHER'&&p.pt!=='null'&&(p.avg>0||p.mprice>0||p.sold>0))parts.push(p);}
  parts.sort(function(a,b){return(b.avg||b.mprice)-(a.avg||a.mprice)});
  var tot=0;

  h+='<div class="card"><div class="card-title">Parts Intelligence</div>';
  if(parts.length>0){
    parts.forEach(function(p){
      var price=p.avg||p.mprice||0;var v=vd(price);tot+=price;
      var badge='';
      if(p.stk===0&&p.sold>=2)badge='<span class="b b-gr" style="font-size:9px">PULL THIS</span> ';
      else if(p.stk===0&&p.sold>=1)badge='<span class="b b-yl" style="font-size:9px">NEED</span> ';
      else if(p.stk>0)badge='<span class="b b-gy" style="font-size:9px">'+p.stk+' stk</span> ';
      var fresh='';if(p.last){var da=Math.floor((Date.now()-new Date(p.last).getTime())/86400000);fresh=da<=60?'✅':da<=90?'⚠️':'❌';}
      h+='<div style="padding:8px 0;border-bottom:1px solid #1f1f1f">';
      h+='<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">'+badge+'<span class="b '+vc(v)+'">'+v+' $'+price+'</span> '+fresh+' <span style="font-size:13px;font-weight:700">['+p.pt+']</span></div>';
      if(p.title)h+='<div style="font-size:11px;color:#d1d5db;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(p.title||'').substring(0,65)+'</div>';
      h+='<div style="font-size:10px;color:#9CA3AF;margin-top:2px">'+p.stk+' in stock · '+p.sold+'x sold · Last '+ta(p.last)+'</div>';
      h+='</div>';
    });
  }else{h+='<div class="section-empty">No parts data for this vehicle yet</div>';}
  h+='</div>';

  // Est. Haul Value
  if(tot>0){
    var vc2=tot>=800?'#16a34a':tot>=500?'#ca8a04':tot>=250?'#ea580c':'#dc2626';
    h+='<div class="card" style="text-align:center"><div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em">Est. Haul Value</div><div style="font-size:28px;font-weight:800;color:'+vc2+';margin-top:2px">$'+tot+'</div>';
    var pc2=parts.filter(function(p){return p.stk===0&&p.sold>=2}).length;
    if(pc2>0)h+='<div style="font-size:11px;color:#16a34a;margin-top:2px">'+pc2+' part'+(pc2>1?'s':'')+' we need</div>';
    h+='</div>';
  }

  // Rebuild reference
  var rb=mr.filter(function(m){return m.isRebuild&&m.partType});
  if(rb.length>0){
    h+='<div class="card" style="opacity:0.5"><div class="card-title">Rebuild Reference</div>';
    rb.forEach(function(p){h+='<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px;color:#6B7280"><span>[REBUILD] '+(p.sellers||[]).join(', ')+' — '+p.partType+'</span><span>'+(p.priceRange||'$'+p.avgPrice)+'</span></div>';});
    h+='</div>';
  }

  // Sales history — collapsed
  var vsh=sh.filter(function(p){return p.partType&&p.partType!=='OTHER'});
  if(vsh.length>0){
    h+='<div class="card"><details><summary style="cursor:pointer;font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em">Sales History ('+vsh.reduce(function(s,p){return s+p.sold},0)+' sold)</summary>';
    h+='<table style="margin-top:8px"><tr><th>Part</th><th>Sold</th><th>Avg $</th><th>Last</th></tr>';
    vsh.forEach(function(p){h+='<tr><td style="font-weight:600">'+p.partType+'</td><td>'+p.sold+'x</td><td class="'+pc(p.avgPrice)+'">$'+p.avgPrice+'</td><td style="font-size:10px;color:#9CA3AF">'+ta(p.lastSoldDate)+'</td></tr>';});
    h+='</table></details></div>';
  }

  // Scan Another
  h+='<div style="padding:0 0 12px"><button class="btn btn-red" style="width:100%;padding:12px;font-size:14px;" onclick="V.value=\'\';V.focus();document.getElementById(\'results\').innerHTML=\'\';document.getElementById(\'instantResearch\').style.display=\'none\';">Scan Another</button></div>';
  document.getElementById('results').innerHTML=h;

  // Auto-run instant research — show our data immediately
  var veh=[d.year,d.make,data.baseModel||d.model].filter(Boolean).join(' ');
  window._lastVehicle=veh;
  window._lastYear=d.year;window._lastMake=d.make;window._lastModel=data.baseModel||d.model;
  window._lastEngine=d.engine||null;
  window._lastDrivetrain=d.drivetrain||null;
  window._lastVin=data.vin||null;
  document.getElementById('instantResearch').style.display='block';
  document.getElementById('researchResults').innerHTML='';
  // Auto-trigger research
  runInstantResearch();
}

var _lastVehicle=null;
var _lastYear=null;var _lastMake=null;var _lastModel=null;
var _lastEngine=null;
var _lastDrivetrain=null;
var _lastVin=null;
async function runInstantResearch(){
  if(!_lastVehicle)return;
  var btn=document.getElementById('researchBtn');
  var out=document.getElementById('researchResults');
  btn.disabled=true;btn.textContent='Researching parts...';
  out.innerHTML='<div style="text-align:center;padding:16px"><div class="spinner"></div><div style="margin-top:6px;color:#6B7280;font-size:12px">Looking up parts for '+esc(_lastVehicle)+(_lastEngine?' '+esc(_lastEngine):'')+'...</div></div>';
  try{
    var url='/api/instant-research?vehicle='+encodeURIComponent(_lastVehicle+(_lastEngine?' '+_lastEngine:''));
    if(_lastDrivetrain)url+='&drivetrain='+encodeURIComponent(_lastDrivetrain);
    var r=await fetch(url).then(function(r){return r.json()});
    if(!r.parts||r.parts.length===0){
      out.innerHTML='<div style="color:#6B7280;font-size:12px;padding:10px;text-align:center">No parts data found for this vehicle</div>';
    }else{
      var h='<div style="margin-top:10px">';
      h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em">Parts Intelligence'+(r.cached?' (cached)':'')+'</div>';
      if(r.totalEstimatedValue)h+='<div style="font-size:12px;font-weight:700;color:#22c55e">Est. $'+Math.round(r.totalEstimatedValue)+'</div>';
      h+='</div>';
      r.parts.forEach(function(p){
        var bc=p.badge==='GREAT'?'b-gr':p.badge==='GOOD'?'b-yl':p.badge==='FAIR'?'b-or':'b-rd';
        var bestPrice=p.market&&p.market.source==='cache'?p.market.avgPrice:p.yourDemand&&p.yourDemand.avgPrice>0?p.yourDemand.avgPrice:p.referencePrice||0;
        var yrLabel=p.yearRange?(p.yearRange.min===p.yearRange.max?p.yearRange.min:p.yearRange.min+'-'+p.yearRange.max):'';
        h+='<div style="padding:8px 0;border-bottom:1px solid #1f1f1f">';
        h+='<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">';
        if(p.isMarked)h+='<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;background:#f59e0b;color:#000">MARKED</span>';
        h+='<span class="b '+bc+'">'+p.badge+(bestPrice>0?' $'+Math.round(bestPrice):'')+'</span>';
        h+='<span style="font-size:13px;font-weight:700">['+esc(p.partType)+']</span>';
        if(yrLabel)h+='<span style="font-size:10px;color:#6B7280">('+yrLabel+')</span>';
        h+='</div>';
        var demandStr=p.yourDemand&&p.yourDemand.salesCount>0?'Sold '+p.yourDemand.salesCount+'x @ avg $'+p.yourDemand.avgPrice+(p.yourDemand.lastSoldDate?' (last: '+ta(p.yourDemand.lastSoldDate)+')':''):'<span style="color:#6B7280">Never sold by us</span>';
        h+='<div style="font-size:10px;margin-top:2px">'+demandStr+'</div>';
        var stockStr=p.yourStock&&p.yourStock.count>0?p.yourStock.count+' in stock'+(p.yourStock.prices.length>0?' @ $'+p.yourStock.prices[0]:''):'<span style="color:#ef4444">Out of stock</span>';
        h+='<div style="font-size:10px;margin-top:1px">'+stockStr+'</div>';
        if(p.market&&p.market.source==='cache')h+='<div style="font-size:10px;margin-top:1px;color:#22c55e">Market avg $'+Math.round(p.market.avgPrice)+' ('+p.market.soldCount90d+' sold/90d)</div>';
        else h+='<div style="font-size:10px;margin-top:1px;color:#6B7280;font-style:italic">No market data available</div>';
        if(p.partNumberBase)h+='<div style="font-size:9px;color:#6B7280;margin-top:1px;font-family:monospace">'+esc(p.partNumberBase)+'</div>';
        h+='</div>';
      });
      h+='</div>';
      // Check if results are thin — show prominent "Research on eBay" button
      var richParts=r.parts?r.parts.filter(function(p){return p.yourDemand&&p.yourDemand.salesCount>0}):[];
      var isThin=!r.parts||r.parts.length<3||richParts.length===0;
      h+='<div id="apifyResearchArea" style="margin-top:8px;text-align:center">';
      if(isThin){
        h+='<div style="color:#eab308;font-size:11px;font-weight:600;margin-bottom:6px">Our data is thin for this vehicle — '+(r.parts?r.parts.length:0)+' parts found</div>';
        h+='<button onclick="runApifyResearch(\'VIN\')" id="apifyBtn" style="width:100%;padding:14px;border-radius:8px;border:2px solid #eab308;background:#422006;color:#eab308;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">🔍 Research on eBay (Apify)</button>';
      }else{
        h+='<button onclick="runApifyResearch(\'VIN\')" id="apifyBtn" style="padding:10px 16px;border-radius:8px;border:1px solid #333;background:#1a1a1a;color:#9CA3AF;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">🔍 Deeper eBay Research</button>';
      }
      h+='<div id="apifyResults"></div></div>';
      out.innerHTML=h;
    }
  }catch(err){
    out.innerHTML='<div style="color:#dc2626;font-size:12px;padding:10px">Research failed: '+err.message+'</div>';
  }
  btn.disabled=false;btn.textContent='Instant Research — What to Pull';
}

async function runStandaloneResearch(){
  var inp=document.getElementById('researchInput');
  var v=inp.value.trim();if(!v)return;
  // Parse year/make/model from input
  var vm=v.match(/^(\d{4})\s+(\S+)\s+(.+?)(?:\s+(\d+\.\d+L?.*))?$/);
  if(vm){_lastYear=parseInt(vm[1]);_lastMake=vm[2];_lastModel=vm[3].trim();_lastEngine=vm[4]||null;}
  _lastVehicle=v;_lastVin=null;
  var btn=document.getElementById('standaloneBtn');
  var out=document.getElementById('standaloneResults');
  btn.disabled=true;btn.textContent='Checking our data...';
  out.innerHTML='<div style="text-align:center;padding:16px"><div class="spinner"></div><div style="margin-top:6px;color:#6B7280;font-size:12px">Looking up '+esc(v)+' in our database...</div></div>';
  try{
    var r=await fetch('/api/instant-research?vehicle='+encodeURIComponent(v)).then(function(r){return r.json()});
    if(r.error){out.innerHTML='<div style="color:#dc2626;padding:10px;font-size:12px">'+esc(r.error)+'</div>';return;}
    var h='';
    var hasParts=r.parts&&r.parts.length>0;
    var richParts=hasParts?r.parts.filter(function(p){return p.yourDemand&&p.yourDemand.salesCount>0}):[];
    var isThin=!hasParts||r.parts.length<3||richParts.length===0;
    if(hasParts){
      h+='<div style="margin-top:10px">';
      if(r.totalValue)h+='<div style="display:flex;gap:10px;margin-bottom:8px;flex-wrap:wrap"><div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:6px 10px;flex:1;text-align:center"><div style="font-size:9px;color:#6B7280;text-transform:uppercase">Total Value</div><div style="font-size:18px;font-weight:800;color:#22c55e">$'+r.totalValue+'</div></div><div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:6px 10px;flex:1;text-align:center"><div style="font-size:9px;color:#6B7280;text-transform:uppercase">Est. Profit</div><div style="font-size:18px;font-weight:800;color:#22c55e">$'+r.totalProfit+'</div></div><div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:6px 10px;flex:1;text-align:center"><div style="font-size:9px;color:#6B7280;text-transform:uppercase">Parts to Pull</div><div style="font-size:18px;font-weight:800;color:#dc2626">'+(r.pullCount||0)+'</div></div></div>';
      r.parts.forEach(function(p){
        var bc=p.badge==='GREAT'?'b-gr':p.badge==='GOOD'?'b-yl':p.badge==='FAIR'?'b-or':'b-rd';
        h+='<div style="padding:8px 0;border-bottom:1px solid #1f1f1f;display:flex;align-items:flex-start;gap:8px">';
        h+='<div style="font-size:16px;flex-shrink:0">'+(p.verdictIcon||'')+'</div>';
        h+='<div style="flex:1"><div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap"><span class="b '+bc+'">'+p.badge+' $'+p.avgPrice+'</span><span style="font-size:13px;font-weight:700">['+esc(p.partType)+']</span></div>';
        h+='<div style="font-size:10px;color:#9CA3AF;margin-top:2px">'+p.soldCount+'x sold · $'+p.estProfit+' profit · ~$'+p.cogs+' cost · '+p.velocity+'</div>';
        if(p.partNumbers&&p.partNumbers.length>0)h+='<div style="font-size:9px;color:#6B7280;margin-top:1px;font-family:monospace">'+p.partNumbers.slice(0,3).join(', ')+'</div>';
        h+='</div><div style="font-weight:800;color:'+(p.verdict==='PULL'?'#22c55e':p.verdict==='RARE'?'#a855f7':'#9CA3AF')+';font-size:11px;white-space:nowrap">'+p.verdict+'</div></div>';
      });
      h+='</div>';
    }else{
      h+='<div style="color:#6B7280;padding:10px;font-size:12px;text-align:center">No parts data in our database for this vehicle'+(r.cached?' (cached)':'')+'</div>';
    }
    // Always show Apify button — prominent when thin, subtle when rich
    h+='<div style="margin-top:10px;text-align:center">';
    if(isThin){
      h+='<div style="color:#eab308;font-size:11px;font-weight:600;margin-bottom:6px">'+(hasParts?'Our data is thin — only '+r.parts.length+' parts found':'No data in our database — try eBay')+'</div>';
      h+='<button onclick="runApifyResearch(\'STANDALONE\')" style="width:100%;padding:14px;border-radius:8px;border:2px solid #eab308;background:#422006;color:#eab308;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">🔍 Research on eBay (Apify)</button>';
    }else{
      h+='<button onclick="runApifyResearch(\'STANDALONE\')" style="padding:10px 16px;border-radius:8px;border:1px solid #333;background:#1a1a1a;color:#9CA3AF;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">🔍 Deeper eBay Research (Apify)</button>';
    }
    h+='<div id="standaloneApifyResults"></div></div>';
    out.innerHTML=h;
  }catch(err){out.innerHTML='<div style="color:#dc2626;font-size:12px;padding:10px">Error: '+err.message+'</div>';}
  btn.disabled=false;btn.textContent='Research Vehicle';
}
document.getElementById('researchInput').addEventListener('keydown',function(e){if(e.key==='Enter')runStandaloneResearch()});

async function runApifyResearch(source) {
  if (!_lastYear || !_lastMake || !_lastModel) {
    alert('No vehicle data — decode a VIN or enter a vehicle first');
    return;
  }
  var outId = source === 'VIN' ? 'apifyResults' : 'standaloneApifyResults';
  var out = document.getElementById(outId);
  if (!out) return;
  out.innerHTML = '<div style="text-align:center;padding:16px"><div class="spinner"></div><div style="margin-top:6px;color:#eab308;font-size:12px;font-weight:600">Researching on eBay via Apify...</div><div style="color:#6B7280;font-size:10px;margin-top:2px">This takes 30-60 seconds</div></div>';

  try {
    var r = await fetch('/api/instant-research/apify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year: _lastYear, make: _lastMake, model: _lastModel,
        engine: _lastEngine || null, trim: null,
        source: source, vin: _lastVin || null,
      }),
    }).then(function(r) { return r.json(); });

    if (!r.success) {
      out.innerHTML = '<div style="color:#dc2626;padding:10px;font-size:12px">' + esc(r.error || 'Research failed') + '</div>';
      return;
    }

    if (r.cached) {
      out.innerHTML = '<div style="color:#6B7280;font-size:10px;margin-bottom:6px">Cached results (researched within 7 days)</div>';
    } else {
      out.innerHTML = '';
    }

    var parts = r.parts || [];
    if (parts.length === 0) {
      out.innerHTML += '<div style="color:#6B7280;padding:10px;font-size:12px;text-align:center">No sellable parts found on eBay</div>';
      return;
    }

    var h = '<div style="margin-top:6px">';
    // Summary
    var s = r.summary || {};
    if (s.totalEstimatedValue) {
      var vc2 = s.totalEstimatedValue >= 800 ? '#22c55e' : s.totalEstimatedValue >= 400 ? '#eab308' : '#9CA3AF';
      h += '<div style="display:flex;gap:8px;margin-bottom:8px">';
      h += '<div style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:6px 8px;text-align:center"><div style="font-size:9px;color:#6B7280;text-transform:uppercase">Est. Value</div><div style="font-size:16px;font-weight:800;color:' + vc2 + '">$' + Math.round(s.totalEstimatedValue) + '</div></div>';
      h += '<div style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:6px 8px;text-align:center"><div style="font-size:9px;color:#6B7280;text-transform:uppercase">Parts</div><div style="font-size:16px;font-weight:800">' + s.partsFoundCount + '</div></div>';
      h += '<div style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:6px 8px;text-align:center"><div style="font-size:9px;color:#6B7280;text-transform:uppercase">High Value</div><div style="font-size:16px;font-weight:800;color:#22c55e">' + (s.highValueCount || 0) + '</div></div>';
      h += '</div>';
    }

    // Parts list
    parts.forEach(function(p) {
      var tierColor = p.valueTier === 'HIGH' ? '#22c55e' : p.valueTier === 'MEDIUM' ? '#eab308' : '#6B7280';
      var tierBg = p.valueTier === 'HIGH' ? '#064e3b' : p.valueTier === 'MEDIUM' ? '#422006' : '#1f2937';
      h += '<div style="padding:8px 0;border-bottom:1px solid #1f1f1f">';
      h += '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">';
      h += '<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;background:' + tierBg + ';color:' + tierColor + '">' + p.valueTier + ' $' + p.avgSoldPrice + '</span>';
      h += '<span style="font-size:13px;font-weight:700">[' + esc(p.partType) + ']</span>';
      h += '</div>';
      h += '<div style="font-size:10px;color:#9CA3AF;margin-top:2px">' + p.soldCount + 'x sold · $' + p.minPrice + '-$' + p.maxPrice + ' range</div>';
      if (p.partNumbers && p.partNumbers.length > 0) h += '<div style="font-size:9px;color:#6B7280;margin-top:1px;font-family:monospace">' + p.partNumbers.slice(0, 3).join(', ') + '</div>';
      h += '</div>';
    });

    h += '</div>';
    // Sky Watch save status
    h += '<div style="text-align:center;padding:8px;font-size:11px;margin-top:4px">';
    if (s.highValueCount >= 1 || s.partsFoundCount >= 3) {
      h += '<span style="color:#22c55e;font-weight:600">✓ Saved to Sky Watch</span> · <a href="/admin/opportunities" style="color:#eab308;text-decoration:none">View →</a>';
    } else {
      h += '<span style="color:#6B7280">Results too thin to save (' + s.partsFoundCount + ' parts found)</span>';
    }
    h += ' · Enriched market_demand_cache with ' + parts.reduce(function(n, p) { return n + (p.partNumbers ? p.partNumbers.length : 0); }, 0) + ' PNs';
    h += '</div>';
    out.innerHTML += h;
  } catch (err) {
    out.innerHTML = '<div style="color:#dc2626;padding:10px;font-size:12px">Apify research failed: ' + esc(err.message) + '</div>';
  }
}

function loadHistory(el){
  if(el)el.textContent='Loading...';
  fetch('/vin/history?limit=10').then(function(r){return r.json()}).then(function(d){
    if(!d.success||!d.scans||!d.scans.length){document.getElementById('histArea').innerHTML='<div class="section-empty">No scans yet</div>';return;}
    var h='<div class="card"><div class="card-title">Recent Scans</div>';
    d.scans.forEach(function(s){
      var v=[s.year,s.make,s.model].filter(Boolean).join(' ');
      var eng=s.engine?' · '+s.engine:'';
      var dt=s.drivetrain?' · '+s.drivetrain:'';
      h+='<div class="h-row" onclick="V.value=\''+s.vin+'\';doScan()"><div><div class="h-vin">'+s.vin+'</div><div class="h-veh">'+(v||'Unknown')+'<span style="color:#6B7280;font-weight:400">'+eng+dt+'</span></div></div><div><div class="h-time">'+ta(s.scanned_at)+'</div></div></div>';
    });
    h+='</div>';
    document.getElementById('histArea').innerHTML=h;
  }).catch(function(){document.getElementById('histArea').innerHTML='<div class="section-empty">Could not load history</div>';});
}
</script>
</body>
</html>
```
---
