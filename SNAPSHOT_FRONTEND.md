# DARKHAWK FRONTEND — 2026-04-04

## FILE: service/public/alerts.html
```html
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"><meta name="theme-color" content="#0a0a0a"><title>DarkHawk - SCOUT ALERTS</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh}.placeholder{text-align:center;padding:80px 20px}.placeholder h2{font-size:24px;font-weight:800;margin-bottom:8px}.placeholder p{color:#6b7280;font-size:14px}</style></head><body>
<div id="dh-nav"></div>
<div class="placeholder"><h2>SCOUT ALERTS</h2><p>Notifications - new yard vehicles, urgent restocks, price alerts.</p><p style="margin-top:20px;color:#DC2626;font-weight:600">Coming soon</p></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('alerts')</script>
</body></html>

```

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
  <div class="tab active" onclick="showTab('yard:LKQ Raleigh')" id="tab-yard:LKQ Raleigh">Raleigh</div>
  <div class="tab" onclick="showTab('yard:LKQ Durham')" id="tab-yard:LKQ Durham">Durham</div>
  <div class="tab" onclick="showTab('yard:LKQ Greensboro')" id="tab-yard:LKQ Greensboro">Greensboro</div>
  <div class="tab" onclick="showTab('yard:LKQ East NC')" id="tab-yard:LKQ East NC">East NC</div>
  <div class="tab" onclick="showTab('yard:LKQ Tampa')" id="tab-yard:LKQ Tampa" style="border-left:1px solid var(--border);margin-left:4px;padding-left:12px">Tampa</div>
  <div class="tab" onclick="showTab('yard:LKQ Largo')" id="tab-yard:LKQ Largo">Largo</div>
  <div class="tab" onclick="showTab('yard:LKQ Clearwater')" id="tab-yard:LKQ Clearwater">Clearwater</div>
  <div class="tab" id="tab-manual" onclick="showTab('manual')" style="display:none;border-left:1px solid var(--border);margin-left:4px;padding-left:12px;color:#ef4444;font-weight:700;">MANUAL</div>
</div>

<div class="status-bar">
  <span id="statusLeft">—</span>
  <span id="statusRight">—</span>
</div>

<div class="toggle-bar">
  <button class="toggle-btn active" id="filt-newest" onclick="setDateFilter('newest')">Newest</button>
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
  let currentTab = 'yard:LKQ Raleigh';
  let dateFilter = 'newest';
  const VEHICLE_CAPS = { newest: 25, '3d': 75, '7d': 150, '30d': 250, '60d': 400, '90d': 500, all: 500 };
  const activeSessions = {};
  let _currentNewestDate = null; // set per-yard during render

  // Parse date-only strings as local time, timestamps normally
  function parseLocalDate(d) {
    if (!d) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return new Date(parseInt(d.slice(0,4)), parseInt(d.slice(5,7)) - 1, parseInt(d.slice(8,10)));
    }
    return new Date(d);
  }

  // Find the newest date_added across vehicles (date-only, stripped of time)
  function getNewestDate(vehicles) {
    let newest = null;
    for (const v of vehicles) {
      const d = parseLocalDate(v.date_added || v.createdAt);
      if (d && (!newest || d > newest)) newest = d;
    }
    return newest;
  }

  // Days between a vehicle's date and the newest date in the dataset
  function getDaysFromNewest(v, newestDate) {
    if (!newestDate) return 999;
    const d = parseLocalDate(v.date_added || v.createdAt);
    if (!d) return 999;
    const vDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const nDay = new Date(newestDate.getFullYear(), newestDate.getMonth(), newestDate.getDate());
    const diff = Math.round((nDay - vDay) / 86400000);
    return Math.max(0, diff);
  }

  async function setDateFilter(mode) {
    dateFilter = mode;
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('filt-' + mode).classList.add('active');
    if (allData) {
      renderData();
    } else {
      await loadData();
    }
  }

  function ageBadge(v) {
    const days = getDaysFromNewest(v, _currentNewestDate);
    if (days === 0) return '<span class="chip chip-age age-today">NEW</span>';
    if (days <= 2) return '<span class="chip chip-age age-recent">' + days + 'D AGO</span>';
    if (days <= 7) return '<span class="chip chip-age age-old">' + days + 'D AGO</span>';
    if (days <= 30) return '<span class="chip chip-age age-old">' + days + 'D</span>';
    return '<span class="chip chip-age age-old">' + days + 'D</span>';
  }

  function vehicleRowClass(v) {
    if (!v.is_active) return 'vehicle-stale vehicle-gone';
    const days = getDaysFromNewest(v, _currentNewestDate);
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

  async function loadData() {
    document.getElementById('mainContent').innerHTML = '<div class="loading"><div class="spinner"></div><div>Scoring vehicles...</div></div>';
    try {
      const res = await fetch('/attack-list');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      allData = data;
      renderData();
      const ts = new Date(data.generated_at);
      document.getElementById('statusLeft').textContent = 'Updated ' + ts.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      document.getElementById('headerSub').textContent = data.yards.length + ' yards scored';
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

      // Clean last-scraped timestamp
      const scrapedAgo = yd.yard.last_scraped ? timeAgo(yd.yard.last_scraped) : 'unknown';
      html += `<div style="padding:4px 14px;font-size:10px;color:#6B7280;">Last scraped: ${scrapedAgo}</div>`;

      // Compute newest date_added for this yard's vehicles
      const newestDate = getNewestDate(filtered);
      _currentNewestDate = newestDate;

      // How many days back does the active pill look?
      const pillDays = dateFilter === 'newest' ? 0
        : dateFilter === '3d' ? 3
        : dateFilter === '7d' ? 7
        : dateFilter === '30d' ? 30
        : dateFilter === '60d' ? 60
        : 999;

      let sections;
      if (pillDays >= 999) {
        // "All" — group by age relative to newest date, skip empty
        sections = [
          { label: 'NEWEST', vehicles: filtered.filter(v => getDaysFromNewest(v, newestDate) === 0), isFresh: true },
          { label: '1-3 DAYS', vehicles: filtered.filter(v => { const d = getDaysFromNewest(v, newestDate); return d >= 1 && d <= 3; }) },
          { label: '4-7 DAYS', vehicles: filtered.filter(v => { const d = getDaysFromNewest(v, newestDate); return d >= 4 && d <= 7; }) },
          { label: '8-30 DAYS', vehicles: filtered.filter(v => { const d = getDaysFromNewest(v, newestDate); return d >= 8 && d <= 30; }) },
          { label: '30+ DAYS', vehicles: filtered.filter(v => getDaysFromNewest(v, newestDate) > 30) },
        ].filter(s => s.vehicles.length > 0);
      } else {
        const highlighted = filtered.filter(v => getDaysFromNewest(v, newestDate) <= pillDays);
        const rest = filtered.filter(v => getDaysFromNewest(v, newestDate) > pillDays);
        const pillLabel = pillDays === 0 ? 'NEWEST ARRIVALS' : 'LAST ' + pillDays + ' DAYS';
        sections = [];
        if (highlighted.length > 0) sections.push({ label: pillLabel, vehicles: highlighted, isFresh: true });
        // Sub-group the rest by age tiers
        const restTiers = [
          { label: '1-3 DAYS', test: v => { const d = getDaysFromNewest(v, newestDate); return d >= 1 && d <= 3; } },
          { label: '4-7 DAYS', test: v => { const d = getDaysFromNewest(v, newestDate); return d >= 4 && d <= 7; } },
          { label: '8-30 DAYS', test: v => { const d = getDaysFromNewest(v, newestDate); return d >= 8 && d <= 30; } },
          { label: '30+ DAYS', test: v => getDaysFromNewest(v, newestDate) > 30 },
        ];
        for (const tier of restTiers) {
          const tv = rest.filter(tier.test);
          if (tv.length > 0) sections.push({ label: tier.label, vehicles: tv });
        }
      }

      const yardCap = VEHICLE_CAPS[dateFilter] || 500;
      let yardRendered = 0;

      for (const sec of sections) {
        // Fresh sections always render fully; others respect the cap
        const remaining = yardCap - yardRendered;
        const vehiclesToRender = sec.isFresh ? sec.vehicles : sec.vehicles.slice(0, Math.max(0, remaining));
        const hiddenCount = sec.vehicles.length - vehiclesToRender.length;

        if (vehiclesToRender.length === 0 && hiddenCount > 0) {
          // Entire section capped — show collapsed hint
          html += `<div style="padding:6px 14px;background:#1a1a1a;border-bottom:1px solid var(--border);font-size:10px;color:#4B5563;display:flex;justify-content:space-between;">`
            + `<span>${sec.label}</span><span>${sec.vehicles.length} hidden</span></div>`;
          continue;
        }

        const sectionStyle = sec.isFresh ? 'border-left:3px solid #22c55e;padding-left:11px;' : '';
        html += `<div style="padding:6px 14px;background:#1a1a1a;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.05em;display:flex;justify-content:space-between;${sectionStyle}">`
          + `<span>${sec.label}</span><span>${sec.vehicles.length}</span></div>`;
        const BATCH = 30;
        for (let i = 0; i < Math.min(BATCH, vehiclesToRender.length); i++) {
          html += renderVehicle(vehiclesToRender[i]);
        }
        if (vehiclesToRender.length > BATCH) {
          const sectionId = 'lazy-' + yd.yard.id + '-' + sec.label.replace(/\s+/g, '');
          pendingLazy.push({ id: sectionId, vehicles: vehiclesToRender.slice(BATCH) });
          html += `<div id="${sectionId}" style="padding:12px 14px;text-align:center;color:#6B7280;font-size:11px;cursor:pointer;" onclick="loadLazySection('${sectionId}')">Show ${vehiclesToRender.length - BATCH} more...</div>`;
        }
        if (hiddenCount > 0) {
          html += `<div style="padding:8px 14px;text-align:center;font-size:11px;color:#6B7280;">+ ${hiddenCount} more vehicles \u2014 switch to a wider filter to see them</div>`;
        }
        yardRendered += vehiclesToRender.length;
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
      const markIcon = p.isMarked ? '\uD83C\uDFAF ' : '';
      return `<span class="chip ${cc}">${markIcon}${p.partType || '?'}</span>`;
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
            ${(v.date_added || v.createdAt) ? `<span>${timeAgo(parseLocalDate(v.date_added || v.createdAt))}</span>` : ''}
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

    // Scout alert matches
    if (v.alertBadges && v.alertBadges.length > 0) {
      html += '<div style="padding:8px 12px;background:#2e1065;border-radius:6px;margin-bottom:8px;">';
      html += '<div style="font-size:10px;font-weight:700;color:#c4b5fd;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">\u26A1 SCOUT ALERTS</div>';
      for (const a of v.alertBadges) {
        const srcLabel = a.source === 'PERCH' ? '\uD83C\uDFAF MARK' : a.source === 'OVERSTOCK' ? 'OVERSTOCK' : a.source === 'bone_pile' ? 'QUARRY' : 'STREAM';
        const valueStr = a.value ? ' \u2014 $' + a.value : '';
        html += `<div style="font-size:12px;color:#e9d5ff;padding:2px 0;">${srcLabel}: ${a.title || 'Match'}${valueStr}</div>`;
      }
      html += '</div>';
    }

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
          <div class="pd-title">${p.alertMatch ? `<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;background:${p.alertMatch.source === 'PERCH' ? '#422006' : p.alertMatch.source === 'bone_pile' ? '#7c2d12' : p.alertMatch.source === 'hunters_perch' ? '#1e3a5f' : '#7f1d1d'};color:${p.alertMatch.source === 'PERCH' ? '#f59e0b' : p.alertMatch.source === 'bone_pile' ? '#f97316' : p.alertMatch.source === 'hunters_perch' ? '#3b82f6' : '#ef4444'};margin-right:6px;display:inline-block">${p.alertMatch.source === 'PERCH' ? '\uD83C\uDFAF MARK' : p.alertMatch.source === 'bone_pile' ? '\u26A1 QUARRY' : p.alertMatch.source === 'hunters_perch' ? '\u26A1 PERCH' : '\u26A0 OVER'}</span>` : ''}${p.isMarked && !p.alertMatch ? '<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;background:#f59e0b;color:#000;margin-right:4px" title="On your restock watch list">MARKED</span>' : ''}${p.partType ? `[${p.partType}] ` : ''}${p.title || p.category || 'Part'}</div>
          <div class="pd-verdict ${vc}">${badgeVerdict} ${pricePrefix}${price} ${freshness}</div>
        </div>
        <div class="pd-stats">
          <span>${inStock} in stock</span>
          <span>${sold90d} sold/90d</span>
          ${p.partNumber ? `<span>${p.partNumber}</span>` : ''}
          ${isEst ? '<span style="color:#6B7280;font-size:9px" title="Conservative estimate — no market data available">est</span>' : ''}
        </div>
        ${p.alertMatch && p.alertMatch.value ? `<div style="font-size:10px;color:#6B7280;margin-top:2px">Alert value: $${p.alertMatch.value}</div>` : ''}
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
    const btn = el ? el.querySelector('.btn-pull') : null;
    if (!btn) return;

    // Find vehicle and part data for cache claim
    const v = findVehicleById(vid);
    const p = v && v.parts ? v.parts.find(pp => (pp.itemId || pp.partType) === itemId) : null;

    btn.disabled = true; btn.textContent = 'Caching...';
    fetch('/cache/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partType: p ? p.partType : null,
        partDescription: p ? (p.title || p.category) : null,
        partNumber: p ? (p.partNumberBase || p.partNumber) : null,
        vehicle: {
          year: v ? v.year : null,
          make: v ? v.make : null,
          model: v ? v.model : null,
          trim: v ? (v.decoded_trim || v.trim) : null,
          vin: v ? v.vin : null,
        },
        yard: {
          name: v ? v.yard_name : null,
          row: v ? v.row_number : null,
        },
        estimatedValue: p ? p.price : null,
        priceSource: p ? p.priceSource : null,
        source: 'daily_feed',
        sourceId: vid,
      }),
    }).then(r => r.json()).then(data => {
      if (data.success) {
        el.style.opacity = '0.4';
        btn.textContent = 'Cached ✓';
        btn.style.background = '#064e3b';
        btn.style.color = '#22c55e';
        btn.style.borderColor = '#065f46';
      } else {
        btn.disabled = false; btn.textContent = 'Pull';
      }
    }).catch(() => {
      btn.disabled = false; btn.textContent = 'Pull';
    });
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
    const count = v.alertBadges.length;
    let html = '<div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap;align-items:center">';
    html += `<span class="chip" style="font-size:9px;padding:1px 6px;background:#7c3aed;color:#fff;font-weight:700">\u26A1 ${count} ALERT${count > 1 ? 'S' : ''}</span>`;
    for (const ab of v.alertBadges) {
      if (ab.source === 'PERCH') {
        const conf = ab.confidence === 'high' ? '\u2605' : '\u2606';
        html += `<span class="alert-badge alert-badge-mark" onclick="event.stopPropagation();claimAlertFromFeed(${ab.id},this)" title="${ab.title || 'Marked part'}">${conf} MARKED</span>`;
      } else {
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
    currentTab = 'yard:LKQ Raleigh';
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-yard:LKQ Raleigh').classList.add('active');
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

## FILE: service/public/cache.html
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
<title>DarkHawk — THE CACHE</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0a;--s:#141414;--s2:#1a1a1a;--b:#2a2a2a;--r:#DC2626;--rd:#7f1d1d;--y:#eab308;--yd:#713f12;--g:#22c55e;--gd:#064e3b;--t:#F0F0F0;--tm:#d1d5db;--tf:#6b7280}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--t);min-height:100vh;padding-bottom:80px;-webkit-tap-highlight-color:transparent}

/* Stats bar */
.stats-bar{padding:8px 16px;background:var(--s);border-bottom:1px solid var(--b);font-size:11px;color:var(--tf);display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.stats-bar .stat-val{color:var(--tm);font-weight:700}
.stats-bar .dot{color:#444;margin:0 2px}

/* Tabs */
.tabs{display:flex;background:var(--s);border-bottom:1px solid var(--b);overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.tabs::-webkit-scrollbar{display:none}
.tab{padding:11px 16px;font-size:12px;font-weight:600;color:#9CA3AF;cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;flex-shrink:0}
.tab.active{color:var(--t);border-bottom-color:var(--r)}

/* Container */
.c{padding:12px;max-width:600px;margin:0 auto}

/* Cards */
.card{background:var(--s);border:1px solid var(--b);border-radius:10px;padding:14px;margin-bottom:10px}
.card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.card-part{font-size:15px;font-weight:700;line-height:1.3}
.card-vehicle{font-size:13px;color:var(--g);font-weight:600;margin-top:3px}
.card-meta{font-size:11px;color:var(--tf);margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.card-meta span{display:inline-flex;align-items:center;gap:3px}
.card-pn{font-size:11px;color:var(--tm);font-family:SFMono-Regular,Menlo,monospace;margin-top:4px}
.card-value{font-size:14px;font-weight:700;color:var(--g);margin-top:6px}
.card-value .price-src{font-size:10px;color:var(--tf);font-weight:400;margin-left:4px}

/* Source badges */
.src-badge{font-size:8px;font-weight:800;padding:2px 7px;border-radius:4px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
.src-daily_feed{background:var(--rd);color:#ef4444}
.src-scout_alert{background:#7c2d12;color:#f97316}
.src-hawk_eye{background:#134e4a;color:#0d9488}
.src-flyway{background:#1e3a5f;color:#3b82f6}
.src-manual{background:#1f2937;color:#6B7280}

/* Action buttons */
.card-actions{display:flex;gap:6px;margin-top:10px}
.act-btn{padding:10px 14px;border-radius:8px;border:1px solid var(--b);font-size:12px;font-weight:600;cursor:pointer;min-height:44px;min-width:44px;display:flex;align-items:center;justify-content:center;flex:1}
.act-btn:active{opacity:.7}
.act-return{background:var(--s2);color:var(--y);border-color:#854d0e}
.act-listed{background:var(--gd);color:var(--g);border-color:#166534}
.act-delete{background:var(--s2);color:#6B7280;border-color:var(--b)}

/* History */
.hist-row{display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid #1f1f1f}
.hist-row:last-child{border-bottom:none}
.hist-icon{width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
.hist-icon.listed{background:var(--gd);color:var(--g)}
.hist-icon.returned{background:var(--yd);color:var(--y)}
.hist-icon.deleted{background:var(--rd);color:#ef4444;opacity:.6}
.hist-info{flex:1;min-width:0}
.hist-part{font-size:13px;font-weight:600}
.hist-detail{font-size:11px;color:var(--tf);margin-top:2px}
.hist-time{font-size:10px;color:#444;margin-top:2px}

/* Form styles */
.form-group{margin-bottom:12px}
.form-label{font-size:10px;font-weight:700;color:var(--tf);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;display:block}
.form-input{width:100%;padding:12px;background:var(--s2);border:1px solid var(--b);border-radius:8px;color:var(--t);font-size:15px}
.form-input:focus{outline:none;border-color:var(--r)}
.form-input::placeholder{color:var(--tf)}
.form-input.mono{font-family:SFMono-Regular,Menlo,monospace;font-size:20px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.form-select{width:100%;padding:12px;background:var(--s2);border:1px solid var(--b);border-radius:8px;color:var(--t);font-size:15px;appearance:none}
.form-select:focus{outline:none;border-color:var(--r)}
textarea.form-input{resize:vertical;min-height:60px;font-family:inherit}
.form-row{display:flex;gap:8px}
.form-row>*{flex:1}

/* Mode toggle */
.mode-toggle{display:flex;background:var(--s2);border:1px solid var(--b);border-radius:8px;overflow:hidden;margin-bottom:14px}
.mode-btn{flex:1;padding:10px;text-align:center;font-size:12px;font-weight:600;color:var(--tf);cursor:pointer;border:none;background:transparent;min-height:44px}
.mode-btn.active{background:var(--r);color:#fff}

/* Primary button */
.btn-primary{width:100%;padding:14px;border-radius:8px;border:none;background:var(--r);color:#fff;font-size:14px;font-weight:700;cursor:pointer;min-height:48px}
.btn-primary:active{opacity:.8}
.btn-primary:disabled{opacity:.4;cursor:default}
.btn-secondary{width:100%;padding:14px;border-radius:8px;border:1px solid var(--b);background:var(--s2);color:var(--tm);font-size:14px;font-weight:600;cursor:pointer;min-height:48px;margin-bottom:8px}
.btn-secondary:active{opacity:.8}
.btn-secondary:disabled{opacity:.4;cursor:default}

/* Stock results */
.stock-results{margin-top:10px;border-radius:8px;padding:10px 12px}
.stock-results.found{background:var(--gd);border:1px solid #166534}
.stock-results.none{background:var(--s2);border:1px solid var(--b)}
.stock-results .sr-title{font-size:12px;font-weight:700;margin-bottom:6px}
.stock-results .sr-item{font-size:12px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.08)}
.stock-results .sr-item:last-child{border-bottom:none}

/* Return modal */
.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:200;display:flex;align-items:flex-end;justify-content:center}
.modal-sheet{background:var(--s);border-top-left-radius:16px;border-top-right-radius:16px;padding:20px 16px 30px;width:100%;max-width:500px}
.modal-title{font-size:14px;font-weight:700;margin-bottom:14px}
.modal-quick{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.modal-quick-btn{padding:12px;border-radius:8px;border:1px solid var(--b);background:var(--s2);color:var(--tm);font-size:13px;font-weight:500;cursor:pointer;text-align:left;min-height:44px}
.modal-quick-btn:active{background:var(--b)}
.modal-cancel{width:100%;padding:12px;border-radius:8px;border:1px solid var(--b);background:transparent;color:var(--tf);font-size:13px;font-weight:600;cursor:pointer;margin-top:8px;min-height:44px}

/* Toast */
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--gd);color:var(--g);border:1px solid #166534;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:300;opacity:0;transition:opacity .3s;pointer-events:none}
.toast.show{opacity:1}

/* Spinner */
.spinner{width:18px;height:18px;border:2px solid #333;border-top-color:var(--r);border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;color:var(--tf);padding:40px 10px;font-size:13px}
.loading{text-align:center;padding:40px}
.loading .lbl{margin-top:8px;color:var(--tf);font-size:12px}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=3"></script><script>dhNav('cache')</script>

<!-- Stats bar -->
<div class="stats-bar" id="statsBar">
  <span>Active: <span class="stat-val" id="statActive">-</span></span>
  <span class="dot">&middot;</span>
  <span>Avg <span class="stat-val" id="statAvgDays">-</span> to list</span>
  <span class="dot">&middot;</span>
  <span><span class="stat-val" id="statListed">-</span> listed this week</span>
  <span class="dot">&middot;</span>
  <span><span class="stat-val" id="statReturned">-</span> returned</span>
</div>

<!-- Tabs -->
<div class="tabs" id="mainTabs">
  <div class="tab active" onclick="switchTab('active',this)">Active</div>
  <div class="tab" onclick="switchTab('history',this)">History</div>
  <div class="tab" onclick="switchTab('add',this)">Add Part</div>
</div>

<!-- Active tab -->
<div id="tab-active" class="c">
  <div id="activeLoading" class="loading"><div class="spinner"></div><div class="lbl">Loading cache...</div></div>
  <div id="activeList"></div>
</div>

<!-- History tab -->
<div id="tab-history" class="c" style="display:none">
  <div id="histLoading" class="loading"><div class="spinner"></div><div class="lbl">Loading history...</div></div>
  <div id="histList"></div>
</div>

<!-- Add Part tab -->
<div id="tab-add" class="c" style="display:none">
  <div class="card">
    <div class="mode-toggle">
      <div class="mode-btn active" id="modePN" onclick="setMode('pn')">By Part Number</div>
      <div class="mode-btn" id="modeVeh" onclick="setMode('vehicle')">By Vehicle</div>
    </div>

    <!-- PN mode -->
    <div id="form-pn">
      <div class="form-group">
        <label class="form-label">Part Number</label>
        <input type="text" class="form-input mono" id="addPN" placeholder="e.g. 68225314AA" autocapitalize="characters" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Description (optional)</label>
        <textarea class="form-input" id="addPNDesc" rows="2" placeholder="What is this part?"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Notes (optional)</label>
        <textarea class="form-input" id="addPNNotes" rows="2" placeholder="Yard, condition, etc."></textarea>
      </div>
    </div>

    <!-- Vehicle mode -->
    <div id="form-vehicle" style="display:none">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Year</label>
          <input type="number" class="form-input" id="addYear" placeholder="2018" inputmode="numeric">
        </div>
        <div class="form-group">
          <label class="form-label">Make</label>
          <input type="text" class="form-input" id="addMake" placeholder="Dodge" autocomplete="off">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Model</label>
        <input type="text" class="form-input" id="addModel" placeholder="Grand Caravan" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Part Type</label>
        <select class="form-select" id="addPartType">
          <option value="">Select part type...</option>
          <option>ECM</option><option>BCM</option><option>ABS</option><option>TCM</option>
          <option>TIPM</option><option>AMP</option><option>RADIO</option><option>CLUSTER</option>
          <option>CAMERA</option><option>THROTTLE</option><option>STEERING</option><option>MIRROR</option>
          <option>ALTERNATOR</option><option>STARTER</option><option>HVAC</option><option>BLOWER</option>
          <option>OTHER</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-input" id="addVehDesc" rows="2" placeholder="Part description"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Part Number (optional)</label>
          <input type="text" class="form-input" id="addVehPN" placeholder="PN" autocapitalize="characters" autocomplete="off" style="text-transform:uppercase;font-family:SFMono-Regular,Menlo,monospace">
        </div>
        <div class="form-group">
          <label class="form-label">Yard + Row (optional)</label>
          <input type="text" class="form-input" id="addVehYard" placeholder="Raleigh R12" autocomplete="off">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes (optional)</label>
        <textarea class="form-input" id="addVehNotes" rows="2" placeholder="Condition, other details..."></textarea>
      </div>
    </div>

    <div id="stockResults"></div>

    <button class="btn-secondary" onclick="checkStock()" id="checkStockBtn">Check Stock</button>
    <button class="btn-primary" onclick="addToCache()" id="addCacheBtn">Add to Cache</button>
  </div>
</div>

<!-- Return reason modal (hidden) -->
<div id="returnModal" class="modal-overlay" style="display:none" onclick="closeReturnModal(event)">
  <div class="modal-sheet" onclick="event.stopPropagation()">
    <div class="modal-title">Why are you returning this?</div>
    <div class="modal-quick">
      <button class="modal-quick-btn" onclick="submitReturn('couldn\'t find it')">Couldn't find it</button>
      <button class="modal-quick-btn" onclick="submitReturn('wrong part')">Wrong part</button>
      <button class="modal-quick-btn" onclick="submitReturn('changed mind')">Changed mind</button>
    </div>
    <div class="form-group">
      <input type="text" class="form-input" id="returnCustom" placeholder="Other reason..." style="font-size:14px">
    </div>
    <button class="btn-primary" onclick="submitReturn(document.getElementById('returnCustom').value)" style="background:var(--y);color:#78350f">Return Part</button>
    <button class="modal-cancel" onclick="closeReturnModal()">Cancel</button>
  </div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<script>
var currentTab = 'active';
var currentMode = 'pn';
var returnId = null;

/* ---- Helpers ---- */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  var now = Date.now();
  var then = new Date(dateStr).getTime();
  var diff = Math.max(0, now - then);
  var mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs / 24);
  return days + 'd ago';
}

function esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(s));
  return d.innerHTML;
}

function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2200);
}

/* ---- Tabs ---- */
function switchTab(name, el) {
  currentTab = name;
  document.querySelectorAll('#mainTabs .tab').forEach(function(t) { t.classList.remove('active'); });
  if (el) el.classList.add('active');
  document.getElementById('tab-active').style.display = name === 'active' ? '' : 'none';
  document.getElementById('tab-history').style.display = name === 'history' ? '' : 'none';
  document.getElementById('tab-add').style.display = name === 'add' ? '' : 'none';
  if (name === 'active') loadActive();
  if (name === 'history') loadHistory();
}

/* ---- Mode toggle ---- */
function setMode(m) {
  currentMode = m;
  document.getElementById('modePN').classList.toggle('active', m === 'pn');
  document.getElementById('modeVeh').classList.toggle('active', m === 'vehicle');
  document.getElementById('form-pn').style.display = m === 'pn' ? '' : 'none';
  document.getElementById('form-vehicle').style.display = m === 'vehicle' ? '' : 'none';
  document.getElementById('stockResults').innerHTML = '';
}

/* ---- Stats ---- */
function loadStats() {
  fetch('/cache/stats').then(function(r) { return r.json(); }).then(function(d) {
    document.getElementById('statActive').textContent = d.active || 0;
    document.getElementById('statAvgDays').textContent = (d.avg_days_to_list != null ? d.avg_days_to_list.toFixed(1) + 'd' : '-');
    document.getElementById('statListed').textContent = d.listed_this_week || 0;
    document.getElementById('statReturned').textContent = d.returned || 0;
  }).catch(function() {});
}

/* ---- Active tab ---- */
function loadActive() {
  var list = document.getElementById('activeList');
  var loading = document.getElementById('activeLoading');
  loading.style.display = '';
  list.innerHTML = '';
  fetch('/cache/active').then(function(r) { return r.json(); }).then(function(data) {
    loading.style.display = 'none';
    var items = data.claims || data || [];
    if (!items.length) {
      list.innerHTML = '<div class="empty">Cache is empty. Go pull some parts.</div>';
      return;
    }
    var html = '';
    items.forEach(function(it) {
      var veh = '';
      if (it.vehicle_year || it.vehicle_make || it.vehicle_model) {
        veh = esc([it.vehicle_year, it.vehicle_make, it.vehicle_model].filter(Boolean).join(' '));
      }
      var srcClass = 'src-' + (it.source || 'manual');
      var hasContent = it.part_type || it.part_number || veh || it.part_description;
      html += '<div class="card" id="card-' + it.id + '">';
      html += '<div class="card-top"><div>';
      if (it.part_type) html += '<div class="card-part">' + esc(it.part_type) + '</div>';
      else if (!it.part_number && !veh) html += '<div class="card-part" style="color:#6B7280">Manual entry</div>';
      if (veh) html += '<div class="card-vehicle">' + veh + '</div>';
      if (it.part_number) html += '<div class="card-pn">' + esc(it.part_number) + '</div>';
      if (it.part_description) html += '<div style="font-size:11px;color:#9CA3AF;margin-top:2px">' + esc(it.part_description) + '</div>';
      html += '</div>';
      html += '<span class="src-badge ' + srcClass + '">' + esc((it.source || 'manual').replace('_', ' ')) + '</span>';
      html += '</div>';
      html += '<div class="card-meta">';
      if (it.yard_name) {
        var loc = esc(it.yard_name);
        if (it.row_number) loc += ' · ' + esc(it.row_number);
        html += '<span>' + loc + '</span>';
      }
      if (it.claimed_by) html += '<span>' + esc(it.claimed_by) + '</span>';
      html += '<span>' + timeAgo(it.claimed_at || it.created_at) + '</span>';
      html += '</div>';
      if (it.estimated_value) {
        html += '<div class="card-value">$' + Number(it.estimated_value).toFixed(0);
        if (it.price_source) html += '<span class="price-src">' + esc(it.price_source) + '</span>';
        html += '</div>';
      }
      if (it.notes) html += '<div style="font-size:10px;color:#eab308;margin-top:4px;font-style:italic">' + esc(it.notes) + '</div>';
      html += '<div class="card-actions">';
      html += '<button class="act-btn act-return" onclick="returnPart(\'' + it.id + '\')">Return</button>';
      html += '<button class="act-btn act-listed" onclick="listPart(\'' + it.id + '\')">Listed</button>';
      html += '<button class="act-btn act-delete" onclick="deletePart(\'' + it.id + '\')">Delete</button>';
      html += '</div>';
      html += '</div>';
    });
    list.innerHTML = html;
  }).catch(function() {
    loading.style.display = 'none';
    list.innerHTML = '<div class="empty">Failed to load. Pull to retry.</div>';
  });
}

/* ---- Actions ---- */
function returnPart(id) {
  returnId = id;
  document.getElementById('returnCustom').value = '';
  document.getElementById('returnModal').style.display = '';
}

function closeReturnModal(e) {
  if (e && e.target !== document.getElementById('returnModal')) return;
  document.getElementById('returnModal').style.display = 'none';
  returnId = null;
}

function submitReturn(reason) {
  if (!reason || !reason.trim()) return;
  var id = returnId;
  document.getElementById('returnModal').style.display = 'none';
  returnId = null;
  fetch('/cache/' + id + '/return', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason.trim() })
  }).then(function(r) {
    if (r.ok) {
      removeCard(id);
      showToast('Part returned');
      loadStats();
    } else { showToast('Error returning part'); }
  }).catch(function() { showToast('Network error'); });
}

function listPart(id) {
  var ebayId = prompt('eBay item ID (optional — leave blank to skip):');
  var body = {};
  if (ebayId && ebayId.trim()) body.ebay_item_id = ebayId.trim();
  fetch('/cache/' + id + '/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(r) {
    if (r.ok) {
      removeCard(id);
      showToast('Marked as listed');
      loadStats();
    } else { showToast('Error marking listed'); }
  }).catch(function() { showToast('Network error'); });
}

function deletePart(id) {
  if (!confirm('Delete this claim? Mistakes only.')) return;
  fetch('/cache/' + id, {
    method: 'DELETE'
  }).then(function(r) {
    if (r.ok) {
      removeCard(id);
      showToast('Claim deleted');
      loadStats();
    } else { showToast('Error deleting'); }
  }).catch(function() { showToast('Network error'); });
}

function removeCard(id) {
  var el = document.getElementById('card-' + id);
  if (el) {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(40px)';
    setTimeout(function() { el.remove(); }, 260);
  }
}

/* ---- History tab ---- */
function loadHistory() {
  var list = document.getElementById('histList');
  var loading = document.getElementById('histLoading');
  loading.style.display = '';
  list.innerHTML = '';
  fetch('/cache/history').then(function(r) { return r.json(); }).then(function(items) {
    loading.style.display = 'none';
    if (!items || !items.length) {
      list.innerHTML = '<div class="empty">No history yet.</div>';
      return;
    }
    var html = '';
    items.forEach(function(it) {
      var status = it.status || 'listed';
      var iconClass = status === 'listed' ? 'listed' : status === 'returned' ? 'returned' : 'deleted';
      var icon = status === 'listed' ? '&#10003;' : status === 'returned' ? '&#8617;' : '&#10005;';
      var color = status === 'listed' ? 'var(--g)' : status === 'returned' ? 'var(--y)' : '#7f1d1d';
      var part = esc(it.part_type || it.part_number || 'Part');
      var veh = '';
      if (it.year || it.make || it.model) veh = esc([it.year, it.make, it.model].filter(Boolean).join(' '));

      html += '<div class="hist-row">';
      html += '<div class="hist-icon ' + iconClass + '">' + icon + '</div>';
      html += '<div class="hist-info">';
      html += '<div class="hist-part" style="color:' + color + '">' + part + '</div>';
      if (veh) html += '<div class="hist-detail">' + veh + '</div>';
      if (it.part_number) html += '<div class="hist-detail" style="font-family:SFMono-Regular,Menlo,monospace">' + esc(it.part_number) + '</div>';
      if (it.reason) html += '<div class="hist-detail" style="color:var(--y);font-style:italic">' + esc(it.reason) + '</div>';
      if (it.ebay_item_id) html += '<div class="hist-detail" style="color:var(--g)">eBay: ' + esc(it.ebay_item_id) + '</div>';
      html += '<div class="hist-time">' + timeAgo(it.resolved_at || it.updated_at) + '</div>';
      html += '</div></div>';
    });
    list.innerHTML = html;
  }).catch(function() {
    loading.style.display = 'none';
    list.innerHTML = '<div class="empty">Failed to load history.</div>';
  });
}

/* ---- Check Stock ---- */
function checkStock() {
  var btn = document.getElementById('checkStockBtn');
  var container = document.getElementById('stockResults');
  var pn = '';
  var cacheParams = {};
  if (currentMode === 'pn') {
    pn = document.getElementById('addPN').value.trim().toUpperCase();
    if (!pn) { showToast('Enter a part number'); return; }
    cacheParams.pn = pn;
  } else {
    var year = document.getElementById('addYear').value.trim();
    var make = document.getElementById('addMake').value.trim();
    var model = document.getElementById('addModel').value.trim();
    var partType = document.getElementById('addPartType').value;
    pn = (document.getElementById('addVehPN').value || '').trim().toUpperCase();
    if (!partType && !pn) { showToast('Select part type or enter PN'); return; }
    if (pn) cacheParams.pn = pn;
    if (make) cacheParams.make = make;
    if (model) cacheParams.model = model;
    if (year) cacheParams.year = year;
    if (partType) cacheParams.partType = partType;
  }

  btn.disabled = true;
  btn.textContent = 'Checking...';
  container.innerHTML = '<div class="loading" style="padding:12px"><div class="spinner"></div></div>';

  var results = { cache: null, stock: null };
  var done = 0;

  function render() {
    if (done < 2) return;
    btn.disabled = false;
    btn.textContent = 'Check Stock';
    var html = '';

    // Cache results
    var cacheHits = results.cache && results.cache.length;
    if (cacheHits) {
      html += '<div class="stock-results found" style="margin-bottom:8px"><div class="sr-title" style="color:var(--y)">\u26A1 Already in Cache (' + results.cache.length + ')</div>';
      results.cache.forEach(function(it) {
        html += '<div class="sr-item">' + esc(it.partType || it.partNumber || 'Part');
        if (it.vehicle) html += ' \u2014 ' + esc(it.vehicle);
        html += ' \u00b7 ' + esc(it.claimedBy || '?') + ' \u00b7 ' + timeAgo(it.claimedAt) + ' \u00b7 via ' + esc(it.source || '') + '</div>';
      });
      html += '</div>';
    }

    // eBay inventory results (from /cogs/check-stock)
    var exactHits = results.stock && results.stock.exact && results.stock.exact.length;
    var variantHits = results.stock && results.stock.variants && results.stock.variants.length;
    if (exactHits) {
      html += '<div class="stock-results found" style="margin-bottom:8px"><div class="sr-title" style="color:var(--g)">\u2713 In eBay Inventory (' + results.stock.exact.length + ' exact)</div>';
      results.stock.exact.forEach(function(it) {
        var storeBadge = it.store === 'autolumen' ? ' [AUTOLUMEN]' : '';
        html += '<div class="sr-item">' + esc(it.title) + storeBadge;
        if (it.currentPrice) html += ' \u2014 $' + it.currentPrice.toFixed(2);
        html += ' \u00b7 Qty: ' + (it.quantity || 1) + '</div>';
      });
      html += '</div>';
    }
    if (variantHits) {
      html += '<div class="stock-results found" style="margin-bottom:8px;border-color:var(--yd)"><div class="sr-title" style="color:var(--y)">\u26A0 Variants (' + results.stock.variants.length + ')</div>';
      results.stock.variants.forEach(function(it) {
        html += '<div class="sr-item">' + esc(it.title);
        if (it.currentPrice) html += ' \u2014 $' + it.currentPrice.toFixed(2);
        if (it.variantNote) html += ' <span style="color:var(--tf);font-size:10px">(' + esc(it.variantNote) + ')</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    if (!cacheHits && !exactHits && !variantHits) {
      html += '<div class="stock-results none"><div class="sr-title" style="color:var(--tf)">No matches found</div><div style="font-size:11px;color:var(--tf);margin-top:2px">Safe to add.</div></div>';
    }
    container.innerHTML = html;
  }

  // Build query strings using correct param names for each endpoint
  var cacheQs = Object.keys(cacheParams).map(function(k) { return k + '=' + encodeURIComponent(cacheParams[k]); }).join('&');

  // Cache check — uses pn, make, model, year, partType params
  fetch('/cache/check-stock?' + cacheQs).then(function(r) { return r.json(); }).then(function(d) {
    results.cache = d.cached || [];
  }).catch(function() { results.cache = []; }).then(function() { done++; render(); });

  // eBay stock check — uses pn param only (same as Nest Protector)
  if (pn) {
    fetch('/cogs/check-stock?pn=' + encodeURIComponent(pn)).then(function(r) { return r.json(); }).then(function(d) {
      results.stock = { exact: d.exact || [], variants: d.variants || [] };
    }).catch(function() { results.stock = { exact: [], variants: [] }; }).then(function() { done++; render(); });
  } else {
    results.stock = { exact: [], variants: [] };
    done++;
  }
}

/* ---- Add to Cache ---- */
function addToCache() {
  var btn = document.getElementById('addCacheBtn');
  var payload = { source: 'manual' };

  if (currentMode === 'pn') {
    var pn = document.getElementById('addPN').value.trim().toUpperCase();
    if (!pn) { showToast('Enter a part number'); return; }
    payload.partNumber = pn;
    payload.partDescription = document.getElementById('addPNDesc').value.trim() || undefined;
    payload.notes = document.getElementById('addPNNotes').value.trim() || undefined;
  } else {
    var year = document.getElementById('addYear').value.trim();
    var make = document.getElementById('addMake').value.trim();
    var model = document.getElementById('addModel').value.trim();
    var partType = document.getElementById('addPartType').value;
    if (!partType) { showToast('Select a part type'); return; }
    payload.partType = partType;
    payload.partDescription = document.getElementById('addVehDesc').value.trim() || undefined;
    payload.partNumber = (document.getElementById('addVehPN').value || '').trim().toUpperCase() || undefined;
    if (year || make || model) {
      payload.vehicle = {};
      if (year) payload.vehicle.year = year;
      if (make) payload.vehicle.make = make;
      if (model) payload.vehicle.model = model;
    }
    var yardRow = document.getElementById('addVehYard').value.trim();
    if (yardRow) {
      var parts = yardRow.split(/\s+/);
      payload.yard = {};
      if (parts[0]) payload.yard.name = parts[0];
      if (parts.length > 1) payload.yard.row = parts.slice(1).join(' ');
    }
    payload.notes = document.getElementById('addVehNotes').value.trim() || undefined;
  }

  btn.disabled = true;
  btn.textContent = 'Adding...';
  fetch('/cache/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(r) {
    btn.disabled = false;
    btn.textContent = 'Add to Cache';
    if (r.ok) {
      showToast('Added to Cache');
      clearAddForm();
      loadStats();
    } else {
      r.json().then(function(d) { showToast(d.error || 'Error adding'); }).catch(function() { showToast('Error adding'); });
    }
  }).catch(function() {
    btn.disabled = false;
    btn.textContent = 'Add to Cache';
    showToast('Network error');
  });
}

function clearAddForm() {
  document.getElementById('addPN').value = '';
  document.getElementById('addPNDesc').value = '';
  document.getElementById('addPNNotes').value = '';
  document.getElementById('addYear').value = '';
  document.getElementById('addMake').value = '';
  document.getElementById('addModel').value = '';
  document.getElementById('addPartType').value = '';
  document.getElementById('addVehDesc').value = '';
  document.getElementById('addVehPN').value = '';
  document.getElementById('addVehYard').value = '';
  document.getElementById('addVehNotes').value = '';
  document.getElementById('stockResults').innerHTML = '';
}

/* ---- Init ---- */
loadStats();
loadActive();
</script>
</body>
</html>

```

## FILE: service/public/competitors.html
```html
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"><meta name="theme-color" content="#0a0a0a"><title>DarkHawk - HUNTERS PERCH</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh}.placeholder{text-align:center;padding:80px 20px}.placeholder h2{font-size:24px;font-weight:800;margin-bottom:8px}.placeholder p{color:#6b7280;font-size:14px}</style></head><body>
<div id="dh-nav"></div>
<div class="placeholder"><h2>HUNTERS PERCH</h2><p>Competition monitoring - seller performance, pricing intelligence.</p><p style="margin-top:20px;color:#DC2626;font-weight:600">Coming soon</p></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('perch')</script>
</body></html>

```

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
var _flywayVehicles = {};
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

function pullFromFlyway(vehicleId, partType, partNumber, price, priceSource, btn) {
  btn.disabled = true; btn.textContent = 'Caching...';
  var v = _flywayVehicles[vehicleId] || {};
  fetch('/cache/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    partType: partType || null,
    partDescription: (partType || 'Part') + ' \u2014 ' + [v.year, v.make, v.model].filter(Boolean).join(' '),
    partNumber: partNumber || null,
    vehicle: { year: v.year || null, make: v.make || null, model: v.model || null, trim: v.decoded_trim || v.trim || null, vin: v.vin || null },
    yard: { name: v._yardName || null, row: v.row_number || null },
    estimatedValue: price || null,
    priceSource: priceSource || null,
    source: 'flyway',
    sourceId: vehicleId,
  }) }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.success) { btn.textContent = 'Cached \u2713'; btn.style.background = '#064e3b'; btn.style.color = '#22c55e'; btn.style.borderColor = '#065f46'; }
    else { btn.disabled = false; btn.textContent = 'Pull'; }
  }).catch(function() { btn.disabled = false; btn.textContent = 'Pull'; });
}

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
    var scraped = y.last_scraped ? timeAgo(y.last_scraped) : '<span style="color:#ef4444">Never</span>';
    h += '<div class="yard-tab' + (activeYardFilter === yid ? ' active' : '') + '" onclick="setYardFilter(\'' + yid + '\')">' + esc(y.name.replace(/^LKQ |^Pull-A-Part /, '')) + ' <span style="color:var(--text-faint)">' + count + '</span><div style="font-size:8px;color:var(--text-faint);margin-top:1px">' + scraped + '</div></div>';
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
      _flywayVehicles[v.id] = v;
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

  // Scout alert badges
  if (v.alertBadges && v.alertBadges.length > 0) {
    v.alertBadges.slice(0, 2).forEach(function(ab) {
      if (ab.source === 'PERCH') badges += '<span class="chip" style="font-size:9px;padding:2px 6px;background:#422006;color:#f59e0b;font-weight:700">\uD83C\uDFAF MARK</span> ';
      else if (ab.source === 'bone_pile') badges += '<span class="chip" style="font-size:9px;padding:2px 6px;background:#7c2d12;color:#f97316;font-weight:700">\u26A1 QUARRY</span> ';
      else if (ab.source === 'hunters_perch') badges += '<span class="chip" style="font-size:9px;padding:2px 6px;background:#1e3a5f;color:#3b82f6;font-weight:700">\u26A1 PERCH</span> ';
      else if (ab.source === 'OVERSTOCK') badges += '<span class="chip" style="font-size:9px;padding:2px 6px;background:#7f1d1d;color:#ef4444;font-weight:700">\u26A0 OVERSTOCK</span> ';
    });
  }

  // Age badge (data-driven relative)
  var diy = v.daysInYard || 0;
  if (diy === 0) {
    badges += '<span class="chip" style="font-size:9px;padding:1px 5px;background:#064e3b;color:#22c55e;font-weight:700">NEW</span> ';
  } else if (diy <= 3) {
    badges += '<span class="chip" style="font-size:9px;padding:1px 5px;background:#713f12;color:#eab308;font-weight:700">' + diy + 'D</span> ';
  } else if (diy <= 7) {
    badges += '<span class="chip" style="font-size:9px;padding:1px 5px;background:#1f2937;color:#6B7280;font-weight:600">' + diy + 'D</span> ';
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
    var markIcon = p.isMarked ? '\uD83C\uDFAF ' : '';
    chips += '<span class="chip ' + cc + '">' + markIcon + esc(p.partType || '?') + '</span> ';
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
  if (v.est_value > 0) {
    var allEst = chipSource.length > 0 && chipSource.every(function(p) { return p.priceSource === 'estimate'; });
    if (allEst) h += '<div class="v-value" style="color:#6B7280">~$' + v.est_value + ' <span style="font-size:9px">EST</span></div>';
    else h += '<div class="v-value">$' + v.est_value + '</div>';
  }
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
    var alertTag = '';
    if (p.alertMatch) {
      var as = p.alertMatch.source;
      if (as === 'PERCH') alertTag = '<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;background:#422006;color:#f59e0b;margin-right:6px;display:inline-block">\uD83C\uDFAF MARK</span>';
      else if (as === 'bone_pile') alertTag = '<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;background:#7c2d12;color:#f97316;margin-right:6px;display:inline-block">\u26A1 QUARRY</span>';
      else if (as === 'hunters_perch') alertTag = '<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;background:#1e3a5f;color:#3b82f6;margin-right:6px;display:inline-block">\u26A1 PERCH</span>';
      else if (as === 'OVERSTOCK') alertTag = '<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;background:#7f1d1d;color:#ef4444;margin-right:6px;display:inline-block">\u26A0 OVER</span>';
    }
    h += '<div style="font-size:13px;font-weight:600">' + alertTag + (p.isMarked && !alertTag ? '<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;background:#f59e0b;color:#000;margin-right:4px">MARKED</span>' : '') + (p.partType ? '[' + esc(p.partType) + '] ' : '') + esc(p.title || p.category || 'Part') + '</div>';
    h += '<div><span class="chip ' + vc + '" style="font-size:10px">' + badgeVerdict + ' ' + pricePrefix + displayPrice + ' ' + freshness + '</span></div>';
    h += '</div>';
    h += '<div style="font-size:11px;color:var(--text-muted);margin-top:3px;display:flex;gap:12px;flex-wrap:wrap">';
    h += '<span>' + (p.in_stock || 0) + ' in stock</span>';
    h += '<span>' + (p.sold_90d || 0) + ' sold/90d</span>';
    if (p.partNumber) h += '<span>' + esc(p.partNumber) + '</span>';
    if (isEst && !hasOurSales && !p.marketMedian) h += '<span style="color:#6B7280">est</span>';
    h += '</div>';
    if (p.alertMatch && p.alertMatch.value) h += '<div style="font-size:10px;color:var(--text-faint);margin-top:3px">Alert value: $' + p.alertMatch.value + '</div>';
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
    h += '<div style="margin-top:6px"><button onclick="pullFromFlyway(\'' + vehicleId + '\',\'' + esc(p.partType || '') + '\',\'' + esc(p.partNumber || '') + '\',' + (displayPrice || 0) + ',\'' + esc(p.priceSource || '') + '\',this)" style="padding:5px 14px;border-radius:6px;border:1px solid var(--b,#2a2a2a);background:var(--s2,#1a1a1a);color:var(--tm,#d1d5db);font-size:11px;font-weight:700;cursor:pointer;min-height:32px">Pull</button></div>';
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
          var storeBadge = item.store === 'autolumen'
            ? '<span style="background:#713f12;color:#eab308;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;margin-left:6px">AUTOLUMEN</span>'
            : '<span style="background:#064e3b;color:#22c55e;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;margin-left:6px">DYNATRACK</span>';
          h += '<div class="stock-item">';
          h += '<div class="si-title">' + esc(item.title) + storeBadge + '</div>';
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
          var storeBadge = item.store === 'autolumen'
            ? '<span style="background:#713f12;color:#eab308;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;margin-left:6px">AUTOLUMEN</span>'
            : '<span style="background:#064e3b;color:#22c55e;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;margin-left:6px">DYNATRACK</span>';
          h += '<div class="stock-item">';
          h += '<div class="si-title">' + esc(item.title) + storeBadge + '</div>';
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

      if (d.totalCached > 0) {
        h += '<div class="stock-result" style="border-color:#92400e">';
        h += '<div class="stock-result-header" style="color:#eab308">\u26A1 IN THE CACHE \u2014 ' + d.totalCached + ' claimed</div>';
        d.cachedClaims.forEach(function(c) {
          h += '<div class="stock-item">';
          h += '<div class="si-title" style="color:#fbbf24">' + esc(c.partType || 'Part');
          if (c.vehicle) h += ' \u2014 ' + esc(c.vehicle);
          h += '</div>';
          h += '<div class="si-meta">';
          h += '<span>Claimed by ' + esc(c.claimedBy || '?') + '</span>';
          h += '<span>via ' + esc(c.source) + '</span>';
          h += '<span>' + timeAgo(new Date(c.claimedAt)) + '</span>';
          h += '</div></div>';
        });
        h += '</div>';
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
function timeAgo(date) { var diff = Math.floor((Date.now() - date.getTime()) / 1000); if (diff < 60) return 'just now'; if (diff < 3600) return Math.floor(diff / 60) + 'm ago'; if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'; return Math.floor(diff / 86400) + 'd ago'; }

loadYards();
</script>
</body>
</html>

```

## FILE: service/public/home.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0a;--s:#141414;--s2:#1a1a1a;--b:#2a2a2a;--r:#DC2626;--rd:#7f1d1d;--y:#eab308;--yd:#713f12;--g:#22c55e;--gd:#064e3b;--t:#F0F0F0;--tm:#d1d5db;--tf:#6b7280}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--t);min-height:100vh;padding-bottom:60px;-webkit-tap-highlight-color:transparent}
.c{padding:12px;max-width:520px;margin:0 auto}
.section-title{font-size:9px;font-weight:700;color:var(--tf);text-transform:uppercase;letter-spacing:.12em;padding:14px 0 6px}
.link-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.link-card{display:block;background:var(--s);border:1px solid var(--b);border-radius:10px;padding:14px 12px;text-decoration:none;color:var(--t);transition:border-color .15s}
.link-card:active{border-color:var(--r)}
.link-card .lc-name{font-size:13px;font-weight:700;letter-spacing:.02em}
.link-card .lc-desc{font-size:10px;color:var(--tf);margin-top:3px;line-height:1.3}
.link-card.accent-red .lc-name{color:var(--r)}
.link-card.accent-yellow .lc-name{color:var(--y)}
.link-card.accent-green .lc-name{color:var(--g)}
.link-card.accent-cyan .lc-name{color:#06b6d4}
.card{background:var(--s);border:1px solid var(--b);border-radius:10px;padding:14px;margin-bottom:10px}
.section-header{font-size:11px;font-weight:800;color:var(--tf);text-transform:uppercase;letter-spacing:.1em;padding:10px 0 6px}
select,input[type="file"]{font-size:12px;color:var(--tf)}
.stock-btn{padding:8px 14px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer}
.stock-btn.search{background:var(--r);color:#fff}
</style>
</head>
<body>

<div style="text-align:center;padding:24px 16px 12px;background:var(--bg)">
  <img src="/admin/darkhawk-logo-sm.png" style="height:60px;border-radius:8px;filter:drop-shadow(0 0 8px rgba(220,38,38,0.5))" alt="DH">
  <div style="font-size:24px;font-weight:900;letter-spacing:3px;margin-top:8px">DARK<span style="color:var(--r)">HAWK</span></div>
</div>

<div class="c">

  <div class="section-title">IN THE FIELD</div>
  <div class="link-grid">
    <a href="/admin/pull" class="link-card accent-red"><div class="lc-name">DAILY FEED</div><div class="lc-desc">Attack list — yard vehicles scored by value</div></a>
    <a href="/admin/scout-alerts" class="link-card accent-red"><div class="lc-name">SCOUT ALERTS</div><div class="lc-desc">Parts matching want lists at yards</div></a>
    <a href="/admin/the-cache" class="link-card accent-red"><div class="lc-name">THE CACHE</div><div class="lc-desc">Claimed parts holding area</div></a>
    <a href="/admin/vin" class="link-card accent-red"><div class="lc-name">HAWK EYE</div><div class="lc-desc">VIN scanner — decode + parts intel</div></a>
    <a href="/admin/gate" class="link-card accent-red"><div class="lc-name">NEST PROTECTOR</div><div class="lc-desc">Stock check + COGS calculator</div></a>
    <a href="/admin/flyway" class="link-card accent-red"><div class="lc-name">THE FLYWAY</div><div class="lc-desc">Road trip planner + yard scoring</div></a>
  </div>

  <div class="section-title">OFFICE INTEL</div>
  <div class="link-grid">
    <a href="/admin/hunters-perch" class="link-card accent-yellow"><div class="lc-name">HUNTERS PERCH</div><div class="lc-desc">Competitor gap intel</div></a>
    <a href="/admin/phoenix" class="link-card accent-yellow"><div class="lc-name">PHOENIX</div><div class="lc-desc">Dead inventory revival</div></a>
    <a href="/admin/restock-list" class="link-card accent-yellow"><div class="lc-name">SCOUR STREAM</div><div class="lc-desc">Restock opportunities live feed</div></a>
    <a href="/admin/restock" class="link-card accent-yellow"><div class="lc-name">THE QUARRY</div><div class="lc-desc">Restock want list builder</div></a>
    <a href="/admin/opportunities" class="link-card accent-yellow"><div class="lc-name">SKY WATCH</div><div class="lc-desc">Market opportunity scanner</div></a>
    <a href="/admin/the-mark" class="link-card accent-yellow"><div class="lc-name">THE MARK</div><div class="lc-desc">High-value target tracker</div></a>
  </div>

  <div class="section-title">INVENTORY</div>
  <div class="link-grid">
    <a href="/admin/velocity" class="link-card accent-green"><div class="lc-name">VELOCITY</div><div class="lc-desc">Sales velocity + turn rates</div></a>
    <a href="/admin/instincts" class="link-card accent-green"><div class="lc-name">INSTINCTS</div><div class="lc-desc">Pricing intelligence</div></a>
    <a href="/admin/prey-cycle" class="link-card accent-green"><div class="lc-name">PREY-CYCLE</div><div class="lc-desc">Lifecycle tracking</div></a>
    <a href="/admin/carcass" class="link-card accent-green"><div class="lc-name">CARCASS</div><div class="lc-desc">Stale inventory automation</div></a>
    <a href="/admin/sales" class="link-card accent-green"><div class="lc-name">SALES</div><div class="lc-desc">Sales history dashboard</div></a>
    <a href="/admin/competitors" class="link-card accent-green"><div class="lc-name">COMPETITORS</div><div class="lc-desc">Competitor monitoring</div></a>
  </div>

  <div class="section-title">TOOLS</div>
  <div class="link-grid">
    <a href="/admin/listing-tool-v2" class="link-card accent-cyan"><div class="lc-name">LISTING TOOL</div><div class="lc-desc">eBay listing generator</div></a>
    <a href="/admin/import" class="link-card accent-cyan"><div class="lc-name">CSV IMPORT</div><div class="lc-desc">Bulk data import</div></a>
  </div>

  <!-- Autolumen Sync -->
  <div class="section-header" id="autolumenHeader" style="cursor:pointer;display:flex;align-items:center;gap:6px;margin-top:8px" onclick="toggleAutolumen()">
    <span id="autolumenArrow">&#9654;</span> AUTOLUMEN SYNC <span id="autolumenSummary" style="font-weight:400;color:var(--tf);font-size:10px;margin-left:4px">loading...</span>
  </div>
  <div class="card" id="autolumenCard" style="display:none">
    <div id="autolumenStats" style="font-size:12px;color:var(--tm);margin-bottom:12px"></div>

    <div style="font-size:10px;font-weight:700;color:var(--tf);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">ACTIVE LISTINGS</div>
    <div style="display:flex;gap:8px;align-items:center">
      <input type="file" id="autolumenListingFile" accept=".csv" style="flex:1;font-size:12px;color:var(--tf)">
      <button class="stock-btn search" id="autolumenListingBtn" onclick="uploadAutolumenListings()" style="font-size:12px;padding:8px 14px">Upload</button>
    </div>
    <div style="font-size:10px;color:var(--tf);margin-top:4px">Replaces current Autolumen inventory</div>
    <div id="autolumenListingResult" style="margin-top:6px;font-size:12px"></div>

    <div style="border-top:1px solid var(--b);margin:12px 0"></div>

    <div style="font-size:10px;font-weight:700;color:var(--tf);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">SALES HISTORY</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="file" id="autolumenSalesFile" accept=".csv" style="flex:1;min-width:120px;font-size:12px;color:var(--tf)">
      <label style="font-size:10px;color:var(--tf);display:flex;align-items:center;gap:4px"><input type="radio" name="salesFormat" value="orders" checked style="margin:0"> Orders Report</label>
      <label style="font-size:10px;color:var(--tf);display:flex;align-items:center;gap:4px"><input type="radio" name="salesFormat" value="transactions" style="margin:0"> Transaction Report</label>
      <button class="stock-btn search" id="autolumenSalesBtn" onclick="uploadAutolumenSales()" style="font-size:12px;padding:8px 14px">Upload</button>
    </div>
    <div style="font-size:10px;color:var(--tf);margin-top:4px">Safe to re-upload — duplicates handled</div>
    <div id="autolumenSalesResult" style="margin-top:6px;font-size:12px"></div>
  </div>

</div>

<script>
function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function timeAgo(date) {
  var diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

var autolumenOpen = false;
function toggleAutolumen() {
  autolumenOpen = !autolumenOpen;
  document.getElementById('autolumenCard').style.display = autolumenOpen ? 'block' : 'none';
  document.getElementById('autolumenArrow').innerHTML = autolumenOpen ? '&#9660;' : '&#9654;';
}

function loadAutolumenStats() {
  fetch('/autolumen/stats')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.success || (!d.stats.activeListings && !d.stats.totalSales)) {
        document.getElementById('autolumenSummary').textContent = 'No Autolumen data yet';
        document.getElementById('autolumenStats').innerHTML = '<span style="color:var(--tf)">No Autolumen data imported yet. Upload a CSV to get started.</span>';
        return;
      }
      var s = d.stats;
      var ago = s.lastImport ? timeAgo(new Date(s.lastImport)) : 'never';
      document.getElementById('autolumenSummary').textContent = s.activeListings + ' active \u00b7 ' + s.totalSales + ' sold \u00b7 last import: ' + ago;
      document.getElementById('autolumenStats').innerHTML =
        'Active: <b>' + s.activeListings + '</b> \u00b7 Sales (90d): <b>' + s.sales90d + '</b> \u00b7 Revenue (90d): <b>$' + s.revenue90d.toLocaleString() + '</b>';
    })
    .catch(function() {
      document.getElementById('autolumenSummary').textContent = 'No Autolumen data yet';
    });
}

async function uploadAutolumenListings() {
  var fileInput = document.getElementById('autolumenListingFile');
  if (!fileInput.files[0]) return;
  var btn = document.getElementById('autolumenListingBtn');
  btn.disabled = true; btn.textContent = 'Uploading...';
  var formData = new FormData();
  formData.append('csv', fileInput.files[0]);
  try {
    var resp = await fetch('/autolumen/import/listings', { method: 'POST', body: formData });
    var data = await resp.json();
    document.getElementById('autolumenListingResult').innerHTML = data.success
      ? '<span style="color:#22c55e">\u2705 Imported ' + data.inserted + ' listings (deactivated ' + data.deactivated + ' old)</span>'
      : '<span style="color:#ef4444">Error: ' + esc(data.error || 'Unknown') + '</span>';
    loadAutolumenStats();
  } catch (err) {
    document.getElementById('autolumenListingResult').innerHTML = '<span style="color:#ef4444">Upload failed: ' + esc(err.message) + '</span>';
  }
  btn.disabled = false; btn.textContent = 'Upload';
}

async function uploadAutolumenSales() {
  var fileInput = document.getElementById('autolumenSalesFile');
  if (!fileInput.files[0]) return;
  var btn = document.getElementById('autolumenSalesBtn');
  btn.disabled = true; btn.textContent = 'Uploading...';
  var format = document.querySelector('input[name="salesFormat"]:checked').value;
  var endpoint = format === 'transactions' ? '/autolumen/import/transactions' : '/autolumen/import/sales';
  var formData = new FormData();
  formData.append('csv', fileInput.files[0]);
  try {
    var resp = await fetch(endpoint, { method: 'POST', body: formData });
    var data = await resp.json();
    document.getElementById('autolumenSalesResult').innerHTML = data.success
      ? '<span style="color:#22c55e">\u2705 Imported ' + data.synced + ' sales (' + data.skipped + ' skipped, ' + data.errors + ' errors)</span>'
      : '<span style="color:#ef4444">Error: ' + esc(data.error || 'Unknown') + '</span>';
    loadAutolumenStats();
  } catch (err) {
    document.getElementById('autolumenSalesResult').innerHTML = '<span style="color:#ef4444">Upload failed: ' + esc(err.message) + '</span>';
  }
  btn.disabled = false; btn.textContent = 'Upload';
}

loadAutolumenStats();
</script>
</body>
</html>

```

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

## FILE: service/public/import.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DarkHawk — eBay CSV Import</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; min-height: 100vh; padding: 40px 20px; }
    .container { max-width: 600px; margin: 0 auto; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 6px; color: #fff; }
    .subtitle { color: #888; margin-bottom: 40px; font-size: 14px; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 28px; margin-bottom: 20px; }
    .card h2 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #fff; }
    label { display: block; font-size: 13px; color: #999; margin-bottom: 6px; }
    select, input[type="file"] { width: 100%; padding: 10px 12px; background: #0f0f0f; border: 1px solid #333; border-radius: 8px; color: #e0e0e0; font-size: 14px; margin-bottom: 16px; }
    button { width: 100%; padding: 12px; background: #7c3aed; border: none; border-radius: 8px; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #6d28d9; }
    button:disabled { background: #333; cursor: not-allowed; }
    .result { margin-top: 20px; padding: 16px; border-radius: 8px; font-size: 14px; display: none; }
    .result.success { background: #052e16; border: 1px solid #166534; color: #4ade80; }
    .result.error { background: #2d0a0a; border: 1px solid #7f1d1d; color: #f87171; }
    .stat { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #1a3a2a; }
    .stat:last-child { border-bottom: none; }
    .stat-label { color: #86efac; }
    .stat-value { font-weight: 700; color: #fff; }
    .loading { text-align: center; color: #888; padding: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>DarkHawk</h1>
    <p class="subtitle">eBay Sales History Import — backfill your database from CSV exports</p>

    <div class="card">
      <h2>Import eBay Orders CSV</h2>

      <label>Store</label>
      <select id="store">
        <option value="dynatrack">Dynatrack Racing (primary store)</option>
        <option value="autolumen">Autolumen (second store)</option>
      </select>

      <label>eBay Orders CSV File</label>
      <input type="file" id="csvFile" accept=".csv" />

      <button id="importBtn" onclick="importCSV()">Import Orders</button>

      <div class="result" id="result"></div>
    </div>

    <div class="card">
      <h2>Active Inventory CSV</h2>
      <p style="color:#888;font-size:12px;margin-bottom:16px">Upload eBay Seller Hub "Active Listings" CSV to sync inventory for any store. Use this for Autolumen or any store without API credentials.</p>

      <label>Store</label>
      <select id="listingStore">
        <option value="autolumen">Autolumen (second store)</option>
        <option value="dynatrack">Dynatrack Racing (primary store)</option>
      </select>

      <label>Active Listings CSV File</label>
      <input type="file" id="listingCsvFile" accept=".csv" onchange="parseListingCSV()" />

      <div id="listingPreview" style="display:none">
        <div id="listingCount" style="display:inline-block;background:#7c3aed;color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:4px;margin-bottom:12px"></div>
        <div style="overflow-x:auto;margin-bottom:16px">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr id="listingPreviewHead" style="color:#999;border-bottom:1px solid #333"></tr></thead>
            <tbody id="listingPreviewBody"></tbody>
          </table>
        </div>
      </div>

      <button id="listingImportBtn" onclick="importListingCSV()" disabled>Import Listings</button>
      <div class="result" id="listingResult"></div>
    </div>

    <div class="card">
      <h2>How to export from eBay</h2>
      <ol style="padding-left: 20px; color: #999; font-size: 13px; line-height: 2;">
        <li>Go to eBay Seller Hub</li>
        <li>Click Orders → select date range (max)</li>
        <li>Click Export → Download CSV</li>
        <li>Repeat for both stores</li>
        <li>Import Dynatrack first, then Autolumen</li>
      </ol>
    </div>
  </div>

  <script>
    async function importCSV() {
      const file = document.getElementById('csvFile').files[0];
      const store = document.getElementById('store').value;
      const btn = document.getElementById('importBtn');
      const result = document.getElementById('result');

      if (!file) {
        showResult('error', 'Please select a CSV file first.');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Importing... this may take a minute';
      result.style.display = 'none';

      const csvData = await file.text();

      try {
        const response = await fetch('/api/parts/import/csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csvData, store }),
        });

        const data = await response.json();

        if (data.success) {
          showResult('success', `
            <div class="stat"><span class="stat-label">Store</span><span class="stat-value">${data.store}</span></div>
            <div class="stat"><span class="stat-label">Imported</span><span class="stat-value">${data.imported.toLocaleString()}</span></div>
            <div class="stat"><span class="stat-label">Skipped (duplicates)</span><span class="stat-value">${data.skipped.toLocaleString()}</span></div>
            <div class="stat"><span class="stat-label">Errors</span><span class="stat-value">${data.errors}</span></div>
            <div class="stat"><span class="stat-label">Total records</span><span class="stat-value">${data.total.toLocaleString()}</span></div>
          `);
        } else {
          showResult('error', data.error || 'Import failed');
        }
      } catch (err) {
        showResult('error', 'Request failed: ' + err.message);
      }

      btn.disabled = false;
      btn.textContent = 'Import Orders';
    }

    function showResult(type, html) {
      const result = document.getElementById('result');
      result.className = `result ${type}`;
      result.innerHTML = html;
      result.style.display = 'block';
    }

    // ── Active Inventory CSV ──────────────────────────────

    // Flexible column name mapping
    const COL_MAP = {
      ebayItemId: ['item number', 'item id', 'itemid', 'item_number', 'listing id'],
      title: ['title', 'item title', 'listing title'],
      sku: ['custom label', 'sku', 'custom_label'],
      quantityAvailable: ['available quantity', 'quantity available', 'quantity', 'qty'],
      currentPrice: ['current price', 'price', 'start price', 'buy it now price'],
      startTime: ['start date', 'listed date', 'start time', 'date listed'],
      viewItemUrl: ['item url', 'view item url', 'url', 'link'],
    };

    let parsedListings = [];

    function findCol(headers, aliases) {
      const lower = headers.map(h => h.toLowerCase().trim());
      for (const alias of aliases) {
        const idx = lower.indexOf(alias);
        if (idx !== -1) return idx;
      }
      return -1;
    }

    function parsePrice(val) {
      if (!val) return null;
      return parseFloat(String(val).replace(/[$,]/g, '')) || null;
    }

    function parseDate(val) {
      if (!val) return null;
      // eBay format: "Mar-17-26" or "Mar-17-2026" or ISO
      const ebayMatch = String(val).match(/^([A-Za-z]{3})-(\d{1,2})-(\d{2,4})$/);
      if (ebayMatch) {
        const [, mon, day, yr] = ebayMatch;
        const year = yr.length === 2 ? '20' + yr : yr;
        return new Date(mon + ' ' + day + ', ' + year).toISOString();
      }
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }

    async function parseListingCSV() {
      const file = document.getElementById('listingCsvFile').files[0];
      if (!file) return;

      const text = await file.text();
      // Strip BOM
      const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
      const lines = clean.split(/\r?\n/);
      if (lines.length < 2) { showListingResult('error', 'CSV has no data rows'); return; }

      const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());

      // Map columns
      const colIdx = {};
      for (const [field, aliases] of Object.entries(COL_MAP)) {
        colIdx[field] = findCol(headers, aliases);
      }

      if (colIdx.ebayItemId === -1) {
        showListingResult('error', 'Could not find Item Number column. Found: ' + headers.slice(0, 8).join(', '));
        return;
      }

      // Parse rows (simple CSV split — handles most eBay exports)
      parsedListings = [];
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        // Handle quoted fields with commas
        const row = [];
        let inQuote = false, field = '';
        for (const ch of lines[i]) {
          if (ch === '"') { inQuote = !inQuote; }
          else if (ch === ',' && !inQuote) { row.push(field.trim()); field = ''; }
          else { field += ch; }
        }
        row.push(field.trim());

        const itemId = colIdx.ebayItemId >= 0 ? row[colIdx.ebayItemId] : null;
        if (!itemId || !/^\d+$/.test(itemId)) continue;

        parsedListings.push({
          ebayItemId: itemId,
          title: colIdx.title >= 0 ? row[colIdx.title] : null,
          sku: colIdx.sku >= 0 ? row[colIdx.sku] : null,
          quantityAvailable: colIdx.quantityAvailable >= 0 ? parseInt(row[colIdx.quantityAvailable]) || 1 : 1,
          currentPrice: colIdx.currentPrice >= 0 ? parsePrice(row[colIdx.currentPrice]) : null,
          startTime: colIdx.startTime >= 0 ? parseDate(row[colIdx.startTime]) : null,
          viewItemUrl: colIdx.viewItemUrl >= 0 ? row[colIdx.viewItemUrl] : null,
          listingStatus: 'Active',
        });
      }

      // Show preview
      const preview = document.getElementById('listingPreview');
      const countEl = document.getElementById('listingCount');
      const headEl = document.getElementById('listingPreviewHead');
      const bodyEl = document.getElementById('listingPreviewBody');

      if (parsedListings.length === 0) {
        preview.style.display = 'none';
        showListingResult('error', 'No valid listings found in CSV');
        document.getElementById('listingImportBtn').disabled = true;
        return;
      }

      countEl.textContent = parsedListings.length + ' listings found';
      headEl.innerHTML = '<th style="padding:6px 8px;text-align:left">Item #</th><th style="padding:6px 8px;text-align:left">Title</th><th style="padding:6px 8px;text-align:left">SKU</th><th style="padding:6px 8px;text-align:right">Price</th><th style="padding:6px 8px;text-align:right">Qty</th>';

      let rows = '';
      parsedListings.slice(0, 5).forEach(function(r) {
        rows += '<tr style="border-bottom:1px solid #222">';
        rows += '<td style="padding:4px 8px;font-family:monospace;font-size:10px;color:#9CA3AF">' + (r.ebayItemId || '') + '</td>';
        rows += '<td style="padding:4px 8px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (r.title || '').substring(0, 50) + '</td>';
        rows += '<td style="padding:4px 8px;font-size:10px;color:#9CA3AF">' + (r.sku || '-') + '</td>';
        rows += '<td style="padding:4px 8px;text-align:right">' + (r.currentPrice ? '$' + r.currentPrice.toFixed(2) : '-') + '</td>';
        rows += '<td style="padding:4px 8px;text-align:right">' + (r.quantityAvailable || 1) + '</td>';
        rows += '</tr>';
      });
      if (parsedListings.length > 5) {
        rows += '<tr><td colspan="5" style="padding:4px 8px;color:#666;font-size:11px">... and ' + (parsedListings.length - 5) + ' more</td></tr>';
      }
      bodyEl.innerHTML = rows;
      preview.style.display = 'block';
      document.getElementById('listingImportBtn').disabled = false;
      document.getElementById('listingResult').style.display = 'none';
    }

    async function importListingCSV() {
      if (parsedListings.length === 0) return;
      const store = document.getElementById('listingStore').value;
      const btn = document.getElementById('listingImportBtn');

      btn.disabled = true;
      btn.textContent = 'Importing ' + parsedListings.length + ' listings...';

      // Add store to each record
      const records = parsedListings.map(function(r) {
        return Object.assign({}, r, { store: store });
      });

      try {
        const response = await fetch('/sync/import-listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: records }),
        });
        const data = await response.json();

        if (data.success) {
          showListingResult('success',
            '<div class="stat"><span class="stat-label">Store</span><span class="stat-value">' + store + '</span></div>' +
            '<div class="stat"><span class="stat-label">New listings</span><span class="stat-value">' + (data.imported || 0) + '</span></div>' +
            '<div class="stat"><span class="stat-label">Updated</span><span class="stat-value">' + (data.updated || 0) + '</span></div>' +
            '<div class="stat"><span class="stat-label">Errors</span><span class="stat-value">' + (data.errors || 0) + '</span></div>' +
            '<div class="stat"><span class="stat-label">Total</span><span class="stat-value">' + (data.total || records.length) + '</span></div>'
          );
        } else {
          showListingResult('error', data.error || 'Import failed');
        }
      } catch (err) {
        showListingResult('error', 'Request failed: ' + err.message);
      }

      btn.disabled = false;
      btn.textContent = 'Import Listings';
    }

    function showListingResult(type, html) {
      const el = document.getElementById('listingResult');
      el.className = 'result ' + type;
      el.innerHTML = html;
      el.style.display = 'block';
    }
  </script>
</body>
</html>

```

## FILE: service/public/instincts.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk — INSTINCTS</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0a;--s:#141414;--s2:#1a1a1a;--b:#2a2a2a;--r:#DC2626;--y:#eab308;--g:#22c55e;--o:#f59e0b;--t:#F0F0F0;--tm:#d1d5db;--tf:#6b7280;--purple:#a78bfa}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--t);min-height:100vh;padding-bottom:40px}
.container{padding:12px;max-width:900px;margin:0 auto}
.card{background:var(--s);border:1px solid var(--b);border-radius:10px;padding:14px;margin-bottom:10px}
.section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px}
.spinner{width:16px;height:16px;border:2px solid #333;border-top-color:var(--purple);border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;color:var(--tf);padding:20px;font-size:13px}
.item-row{padding:8px 0;border-bottom:1px solid #1f1f1f;font-size:12px}
.item-row:last-child{border-bottom:none}
.badge{font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;margin-right:4px}
.stat-row{display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.stat-box{flex:1;min-width:100px;background:var(--s2);border-radius:8px;padding:12px;text-align:center}
.stat-value{font-size:20px;font-weight:800}
.stat-label{font-size:10px;color:var(--tf);margin-top:2px}

/* Return Intelligence styles */
.ri-divider{border:none;border-top:2px solid var(--r);margin:24px 0 16px;opacity:0.4}
.ri-header{font-size:16px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:var(--r);margin-bottom:16px;text-align:center}
.ri-sub{font-size:10px;color:var(--tf);text-align:center;margin-top:-12px;margin-bottom:16px}
.ri-card{background:var(--s);border:1px solid var(--b);border-radius:10px;padding:14px;margin-bottom:10px}
.ri-card.accent{border-color:#7f1d1d}
.ri-section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px}
.ri-table{width:100%;border-collapse:collapse;font-size:11px}
.ri-table th{text-align:left;padding:6px 8px;color:var(--tf);font-size:9px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--b);font-weight:700}
.ri-table td{padding:6px 8px;border-bottom:1px solid #1a1a1a;white-space:nowrap}
.ri-table tr:last-child td{border-bottom:none}
.ri-table tr:hover{background:var(--s2)}
.ri-table .num{text-align:right;font-variant-numeric:tabular-nums}
.rate-badge{font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;display:inline-block}
.rate-green{background:#064e3b;color:var(--g)}
.rate-yellow{background:#713f12;color:var(--y)}
.rate-orange{background:#7c2d12;color:var(--o)}
.rate-red{background:#7f1d1d;color:var(--r)}
.count-red{color:var(--r);font-weight:700}
.count-orange{color:var(--o);font-weight:700}
.count-yellow{color:var(--y);font-weight:700}
.alert-row{background:#1a0a0a !important}
.ri-loading{text-align:center;padding:16px;color:var(--tf);font-size:12px}
.ri-error{text-align:center;padding:12px;color:var(--r);font-size:11px}
.chart-wrap{position:relative;height:220px;margin-bottom:12px}
.rip-off-tag{font-size:8px;background:var(--r);color:#fff;padding:1px 4px;border-radius:2px;font-weight:700;margin-left:4px}
.seasonal-flag{color:var(--r)}

/* Responsive table scroll */
.table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.table-scroll::-webkit-scrollbar{height:4px}
.table-scroll::-webkit-scrollbar-thumb{background:#333;border-radius:2px}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('instincts')</script>
<div class="container">
  <div id="loading" style="text-align:center;padding:30px"><div class="spinner"></div></div>
  <div id="content" style="display:none">
    <div class="card" style="border-color:#ef4444">
      <div class="section-title" style="color:#ef4444">Dead Inventory Patterns</div>
      <div style="font-size:11px;color:#6B7280;margin-bottom:8px">Parts that have died 2+ times — avoid unless market data supports</div>
      <div id="deadPatterns"></div>
    </div>
  </div>

  <!-- ═══════════════════════════════════════════════════════════ -->
  <!-- RETURN INTELLIGENCE                                         -->
  <!-- ═══════════════════════════════════════════════════════════ -->
  <hr class="ri-divider" id="ri-top">
  <div class="ri-header">RETURN INTELLIGENCE</div>
  <div class="ri-sub">Transaction-level return analysis across all eBay stores</div>

  <!-- 1. Header Cards -->
  <div id="ri-summary">
    <div class="ri-loading"><div class="spinner"></div> Loading summary...</div>
  </div>

  <!-- 2. Return Rate by Part Type -->
  <div class="ri-card" id="ri-part-type-card">
    <div class="ri-section-title" style="color:var(--o)">Return Rate by Part Type</div>
    <div id="ri-part-type"><div class="ri-loading"><div class="spinner"></div></div></div>
  </div>

  <!-- 3. Monthly Trend -->
  <div class="ri-card" id="ri-trend-card">
    <div class="ri-section-title" style="color:var(--purple)">Monthly Return Trend</div>
    <div id="ri-trend"><div class="ri-loading"><div class="spinner"></div></div></div>
  </div>

  <!-- 4. Make Heat Map -->
  <div class="ri-card" id="ri-make-card">
    <div class="ri-section-title" style="color:#38bdf8">Returns by Vehicle Make</div>
    <div id="ri-make"><div class="ri-loading"><div class="spinner"></div></div></div>
  </div>

  <!-- 5. Repeat Returners -->
  <div class="ri-card" id="ri-returners-card">
    <div class="ri-section-title" style="color:var(--r)">Repeat Returners</div>
    <div id="ri-returners"><div class="ri-loading"><div class="spinner"></div></div></div>
  </div>

  <!-- 6. INAD Fee Tracker -->
  <div class="ri-card" id="ri-inad-card">
    <div class="ri-section-title" style="color:var(--y)">INAD Fee Tracker</div>
    <div id="ri-inad"><div class="ri-loading"><div class="spinner"></div></div></div>
  </div>

  <!-- 7. High-Value Alerts -->
  <div class="ri-card accent" id="ri-alerts-card">
    <div class="ri-section-title" style="color:var(--r)">High-Value / High-Frequency Alerts</div>
    <div style="font-size:10px;color:var(--tf);margin-bottom:8px">Part+make combos that are expensive AND frequently returned — these hurt the most</div>
    <div id="ri-alerts"><div class="ri-loading"><div class="spinner"></div></div></div>
  </div>

  <!-- 8. Problem Parts -->
  <div class="ri-card" id="ri-problems-card">
    <div class="ri-section-title" style="color:var(--o)">Problem Parts (3+ Returns)</div>
    <div id="ri-problems"><div class="ri-loading"><div class="spinner"></div></div></div>
  </div>
</div>

<script>
// ═══ Original Instincts load ═══
function load() {
  fetch('/intelligence/learnings')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('content').style.display = 'block';
      if (!d.success) { document.getElementById('content').innerHTML = '<div class="empty">Error loading</div>'; return; }

      // Dead patterns
      var dp = d.deadPatterns || [];
      var dpEl = document.getElementById('deadPatterns');
      if (dp.length === 0) {
        dpEl.innerHTML = '<div class="empty">No repeat deaths yet — good sign.</div>';
      } else {
        var h = '';
        dp.forEach(function(p) {
          var reasons = (p.reasons || []).map(function(r) {
            var color = r === 'overpriced' ? '#ef4444' : r === 'low_demand' ? '#f59e0b' : '#6B7280';
            return '<span class="badge" style="background:' + color + '22;color:' + color + '">' + (r || 'unknown') + '</span>';
          }).join('');
          // Vehicle line: "2014-2018 Ford Transit" or "unknown"
          var vehText = '';
          if (p.make && p.model) {
            var yearStr = p.yearStart ? (p.yearStart === p.yearEnd ? '' + p.yearStart : p.yearStart + '-' + p.yearEnd) : '';
            vehText = (yearStr ? yearStr + ' ' : '') + p.make + ' ' + p.model;
          }
          // Part name line
          var partNameLine = p.partName ? '<div style="margin-top:2px;font-size:11px;color:#d1d5db">' + esc(p.partName) + '</div>' : '';
          var vehicleLine = vehText ? '<div style="margin-top:1px;font-size:11px;color:#9CA3AF">' + esc(vehText) + '</div>' : '';
          h += '<div class="item-row"><div style="font-weight:600">' + esc(p.partNumberBase || '') + ' <span style="color:#ef4444;font-size:11px">(' + p.deathCount + 'x died)</span></div>' + partNameLine + vehicleLine + '<div style="margin-top:2px">' + reasons + '</div></div>';
        });
        dpEl.innerHTML = h;
      }

    })
    .catch(function(err) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('content').style.display = 'block';
      document.getElementById('content').innerHTML = '<div class="empty" style="color:#ef4444">Error: ' + err.message + '</div>';
    });
}

function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

load();

// ═══════════════════════════════════════════════════════════════
// RETURN INTELLIGENCE
// ═══════════════════════════════════════════════════════════════

function $(x) { return document.getElementById(x); }
function fmt$(n) { if (n == null || isNaN(n)) return '$0'; return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function fmtPct(n) { if (n == null) return '—'; return n.toFixed(1) + '%'; }
function fmtNum(n) { return Number(n || 0).toLocaleString('en-US'); }
function rateCls(pct) {
  if (pct == null) return 'rate-green';
  if (pct >= 25) return 'rate-red';
  if (pct >= 15) return 'rate-orange';
  if (pct >= 10) return 'rate-yellow';
  return 'rate-green';
}
function countCls(n) {
  if (n >= 10) return 'count-red';
  if (n >= 5) return 'count-orange';
  if (n >= 3) return 'count-yellow';
  return '';
}

function riErr(el, msg) {
  el.innerHTML = '<div class="ri-error">' + esc(msg) + '</div>';
}

function riLoad(url, el, renderFn) {
  fetch(url).then(function(r) { return r.json(); }).then(function(d) {
    if (!d.success) throw new Error(d.error || 'Unknown error');
    renderFn(d, el);
  }).catch(function(err) { riErr(el, 'Failed: ' + err.message); });
}

// ─── 1. Summary Header Cards ───
riLoad('/return-intelligence/summary', $('ri-summary'), function(d, el) {
  el.innerHTML = '<div class="stat-row">' +
    '<div class="stat-box"><div class="stat-value">' + fmtNum(d.all_time.count) + '</div><div class="stat-label">Total Returns</div></div>' +
    '<div class="stat-box"><div class="stat-value" style="color:var(--r)">' + fmt$(d.all_time.dollars) + '</div><div class="stat-label">Total Refunded</div></div>' +
    '<div class="stat-box"><div class="stat-value" style="color:var(--y)">' + fmt$(d.inad.fees) + '</div><div class="stat-label">INAD Fees Paid</div></div>' +
    '<div class="stat-box"><div class="stat-value">' + fmt$(d.all_time.avg) + '</div><div class="stat-label">Avg Return</div></div>' +
    '</div>' +
    '<div class="stat-row">' +
    '<div class="stat-box"><div class="stat-value" style="font-size:16px">' + fmtNum(d.last_12_months.count) + '</div><div class="stat-label">Last 12 Months</div></div>' +
    '<div class="stat-box"><div class="stat-value" style="font-size:16px;color:var(--r)">' + fmt$(d.last_12_months.dollars) + '</div><div class="stat-label">12mo Refunded</div></div>' +
    '<div class="stat-box"><div class="stat-value" style="font-size:16px">' + fmtNum(d.last_90_days.count) + '</div><div class="stat-label">Last 90 Days</div></div>' +
    '<div class="stat-box"><div class="stat-value" style="font-size:16px;color:var(--r)">' + fmt$(d.last_90_days.dollars) + '</div><div class="stat-label">90d Refunded</div></div>' +
    '</div>';
});

// ─── 2. Return Rate by Part Type ───
riLoad('/return-intelligence/by-part-type', $('ri-part-type'), function(d, el) {
  var rows = d.data || [];
  if (!rows.length) { el.innerHTML = '<div class="empty">No data</div>'; return; }
  var h = '<div class="table-scroll"><table class="ri-table"><thead><tr>' +
    '<th>Part Type</th><th class="num">Returns</th><th class="num">Sales</th><th class="num">Rate</th><th class="num">$ Returned</th>' +
    '</tr></thead><tbody>';
  rows.forEach(function(r) {
    var cls = rateCls(r.return_rate_pct);
    h += '<tr><td style="font-weight:600">' + esc(r.part_type) + '</td>' +
      '<td class="num">' + fmtNum(r.return_count) + '</td>' +
      '<td class="num" style="color:var(--tf)">' + fmtNum(r.sale_count) + '</td>' +
      '<td class="num"><span class="rate-badge ' + cls + '">' + fmtPct(r.return_rate_pct) + '</span></td>' +
      '<td class="num" style="color:var(--r)">' + fmt$(r.return_dollars) + '</td></tr>';
  });
  h += '</tbody></table></div>';
  el.innerHTML = h;
});

// ─── 3. Monthly Trend ───
riLoad('/return-intelligence/monthly-trend', $('ri-trend'), function(d, el) {
  var monthly = d.monthly || [];
  var seasonal = d.seasonal || [];
  if (!monthly.length) { el.innerHTML = '<div class="empty">No data</div>'; return; }

  // Build chart
  var labels = monthly.map(function(m) { return m.month; });
  var values = monthly.map(function(m) { return m.return_count; });
  var ripOffMonths = ['01','02','11','12'];
  var colors = monthly.map(function(m) {
    var mm = m.month.split('-')[1];
    return ripOffMonths.indexOf(mm) >= 0 ? '#DC2626' : '#a78bfa';
  });

  var h = '<div class="chart-wrap"><canvas id="ri-trend-chart"></canvas></div>';

  // Seasonal averages table
  if (seasonal.length) {
    h += '<div style="font-size:10px;font-weight:700;color:var(--tf);text-transform:uppercase;letter-spacing:.05em;margin:8px 0 6px">Seasonal Averages</div>';
    h += '<div class="table-scroll"><table class="ri-table"><thead><tr><th>Month</th><th class="num">Avg Returns</th><th class="num">Avg $</th><th></th></tr></thead><tbody>';
    seasonal.forEach(function(s) {
      var flag = s.is_rip_off_season ? '<span class="rip-off-tag">RIP-OFF SZN</span>' : '';
      var cls = s.is_rip_off_season ? ' class="seasonal-flag"' : '';
      h += '<tr><td' + cls + ' style="font-weight:600">' + esc(s.month) + flag + '</td>' +
        '<td class="num">' + s.avg_monthly_returns + '</td>' +
        '<td class="num">' + fmt$(s.avg_monthly_dollars) + '</td>' +
        '<td></td></tr>';
    });
    h += '</tbody></table></div>';
  }

  el.innerHTML = h;

  // Render chart
  var ctx = document.getElementById('ri-trend-chart').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderRadius: 3,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) { return ctx.parsed.y + ' returns'; }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#6b7280', font: { size: 9 }, maxRotation: 45 }, grid: { display: false } },
        y: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: '#1a1a1a' } }
      }
    }
  });
});

// ─── 4. Make Heat Map ───
riLoad('/return-intelligence/by-make', $('ri-make'), function(d, el) {
  var rows = d.data || [];
  if (!rows.length) { el.innerHTML = '<div class="empty">No data</div>'; return; }
  var h = '<div class="table-scroll"><table class="ri-table"><thead><tr>' +
    '<th>Make</th><th class="num">Returns</th><th class="num">$ Returned</th><th class="num">Sales</th><th class="num">Rate</th>' +
    '</tr></thead><tbody>';
  rows.forEach(function(r) {
    var cls = rateCls(r.return_rate_pct);
    h += '<tr><td style="font-weight:600">' + esc(r.make) + '</td>' +
      '<td class="num">' + fmtNum(r.return_count) + '</td>' +
      '<td class="num" style="color:var(--r)">' + fmt$(r.return_dollars) + '</td>' +
      '<td class="num" style="color:var(--tf)">' + fmtNum(r.sale_count) + '</td>' +
      '<td class="num"><span class="rate-badge ' + cls + '">' + fmtPct(r.return_rate_pct) + '</span></td></tr>';
  });
  h += '</tbody></table></div>';
  el.innerHTML = h;
});

// ─── 5. Repeat Returners ───
riLoad('/return-intelligence/repeat-returners', $('ri-returners'), function(d, el) {
  var rows = d.data || [];
  if (!rows.length) { el.innerHTML = '<div class="empty">No repeat returners (3+ returns) found.</div>'; return; }
  var h = '<div class="table-scroll"><table class="ri-table"><thead><tr>' +
    '<th>Buyer</th><th class="num">Returns</th><th class="num">$ Refunded</th><th class="num">Avg $</th><th>Top Types</th><th>Date Range</th>' +
    '</tr></thead><tbody>';
  rows.forEach(function(r) {
    var cls = countCls(r.return_count);
    var types = (r.top_part_types || []).join(', ');
    var range = (r.first_return || '?').substring(0, 10) + ' — ' + (r.last_return || '?').substring(0, 10);
    h += '<tr><td style="font-weight:600">' + esc(r.buyer_username) + '</td>' +
      '<td class="num ' + cls + '">' + r.return_count + '</td>' +
      '<td class="num" style="color:var(--r)">' + fmt$(r.total_refunded) + '</td>' +
      '<td class="num">' + fmt$(r.avg_return) + '</td>' +
      '<td style="color:var(--tf);font-size:10px">' + esc(types) + '</td>' +
      '<td style="color:var(--tf);font-size:10px">' + range + '</td></tr>';
  });
  h += '</tbody></table></div>';
  el.innerHTML = h;
});

// ─── 6. INAD Fee Tracker ───
riLoad('/return-intelligence/inad', $('ri-inad'), function(d, el) {
  // Overview stats
  var h = '<div class="stat-row">' +
    '<div class="stat-box"><div class="stat-value">' + fmtNum(d.total_returns) + '</div><div class="stat-label">Total Returns</div></div>' +
    '<div class="stat-box"><div class="stat-value" style="color:var(--y)">' + fmtNum(d.inad_count) + '</div><div class="stat-label">INAD Flagged</div></div>' +
    '<div class="stat-box"><div class="stat-value" style="color:var(--o)">' + fmtPct(d.inad_rate_pct) + '</div><div class="stat-label">INAD Rate</div></div>' +
    '<div class="stat-box"><div class="stat-value" style="color:var(--r)">' + fmt$(d.total_inad_fees) + '</div><div class="stat-label">Total INAD Fees</div></div>' +
    '</div>';

  // Quarterly trend
  var q = d.quarterly || [];
  if (q.length) {
    h += '<div style="font-size:10px;font-weight:700;color:var(--tf);text-transform:uppercase;letter-spacing:.05em;margin:8px 0 6px">Quarterly Trend</div>';
    h += '<div class="table-scroll"><table class="ri-table"><thead><tr><th>Quarter</th><th class="num">Returns</th><th class="num">INAD</th><th class="num">INAD Rate</th><th class="num">INAD Fees</th></tr></thead><tbody>';
    q.forEach(function(r) {
      h += '<tr><td style="font-weight:600">' + esc(r.quarter) + '</td>' +
        '<td class="num">' + fmtNum(r.total_returns) + '</td>' +
        '<td class="num" style="color:var(--y)">' + fmtNum(r.inad_count) + '</td>' +
        '<td class="num">' + fmtPct(r.inad_rate_pct) + '</td>' +
        '<td class="num" style="color:var(--r)">' + fmt$(r.inad_fees) + '</td></tr>';
    });
    h += '</tbody></table></div>';
  }

  // By part type
  var bp = d.by_part_type || [];
  if (bp.length) {
    h += '<div style="font-size:10px;font-weight:700;color:var(--tf);text-transform:uppercase;letter-spacing:.05em;margin:12px 0 6px">INAD by Part Type</div>';
    h += '<div class="table-scroll"><table class="ri-table"><thead><tr><th>Part Type</th><th class="num">INAD Count</th><th class="num">INAD Fees</th></tr></thead><tbody>';
    bp.forEach(function(r) {
      h += '<tr><td style="font-weight:600">' + esc(r.part_type) + '</td>' +
        '<td class="num" style="color:var(--y)">' + fmtNum(r.inad_count) + '</td>' +
        '<td class="num" style="color:var(--r)">' + fmt$(r.inad_fees) + '</td></tr>';
    });
    h += '</tbody></table></div>';
  }

  el.innerHTML = h;
});

// ─── 7. High-Value Alerts ───
riLoad('/return-intelligence/high-value-alerts', $('ri-alerts'), function(d, el) {
  var rows = d.data || [];
  if (!rows.length) { el.innerHTML = '<div class="empty">No high-value / high-frequency combos found.</div>'; return; }
  var h = '<div class="table-scroll"><table class="ri-table"><thead><tr>' +
    '<th>Part Type</th><th>Make</th><th class="num">Returns</th><th class="num">Avg $</th><th class="num">Total $</th>' +
    '</tr></thead><tbody>';
  rows.forEach(function(r) {
    h += '<tr class="alert-row"><td style="font-weight:700;color:var(--r)">' + esc(r.part_type) + '</td>' +
      '<td style="font-weight:600">' + esc(r.make) + '</td>' +
      '<td class="num count-red">' + r.return_count + '</td>' +
      '<td class="num" style="color:var(--o)">' + fmt$(r.avg_return) + '</td>' +
      '<td class="num" style="color:var(--r);font-weight:700">' + fmt$(r.return_dollars) + '</td></tr>';
  });
  h += '</tbody></table></div>';
  el.innerHTML = h;
});

// ─── 8. Problem Parts ───
riLoad('/return-intelligence/problem-parts', $('ri-problems'), function(d, el) {
  var rows = d.data || [];
  if (!rows.length) { el.innerHTML = '<div class="empty">No problem parts (3+ returns on same title) found.</div>'; return; }
  var h = '<div class="table-scroll"><table class="ri-table"><thead><tr>' +
    '<th>Title</th><th>Type</th><th>Make</th><th class="num">Returns</th><th class="num">$ Returned</th><th>Date Range</th>' +
    '</tr></thead><tbody>';
  rows.forEach(function(r) {
    var title = r.title || '';
    if (title.length > 60) title = title.substring(0, 58) + '...';
    var range = (r.first_return || '?').substring(0, 10) + ' — ' + (r.last_return || '?').substring(0, 10);
    var cls = countCls(r.return_count);
    h += '<tr><td style="font-weight:600;white-space:normal;min-width:180px" title="' + esc(r.title) + '">' + esc(title) + '</td>' +
      '<td style="color:var(--tf)">' + esc(r.part_type) + '</td>' +
      '<td style="color:var(--tf)">' + esc(r.make) + '</td>' +
      '<td class="num ' + cls + '">' + r.return_count + '</td>' +
      '<td class="num" style="color:var(--r)">' + fmt$(r.return_dollars) + '</td>' +
      '<td style="color:var(--tf);font-size:10px">' + range + '</td></tr>';
  });
  h += '</tbody></table></div>';
  el.innerHTML = h;
});
</script>
</body>
</html>

```

## FILE: service/public/listing-tool-v2.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dynatrack Racing - Listing Generator v2</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --red: #B91C1C;
    --red-dark: #7F1D1D;
    --red-light: #FEE2E2;
    --red-mid: #DC2626;
    --bg: #F9FAFB;
    --surface: #FFFFFF;
    --border: #E5E7EB;
    --border-strong: #D1D5DB;
    --text: #111827;
    --text-mid: #374151;
    --text-muted: #6B7280;
    --text-faint: #9CA3AF;
    --green: #15803D;
    --green-light: #DCFCE7;
    --radius: 10px;
    --radius-sm: 6px;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    padding: 0;
  }

  header {
    background: var(--red-dark);
    padding: 1rem 1.5rem;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .header-icon {
    width: 32px;
    height: 32px;
    background: rgba(255,255,255,0.15);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .header-icon svg { width: 18px; height: 18px; fill: white; }

  header h1 {
    font-size: 15px;
    font-weight: 600;
    color: white;
    letter-spacing: -0.01em;
  }

  header p {
    font-size: 12px;
    color: rgba(255,255,255,0.6);
    margin-top: 1px;
  }

  .container {
    max-width: 700px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    margin-bottom: 1.25rem;
  }

  .card-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 1rem;
  }

  .field-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 12px;
  }

  .field-row.two { grid-template-columns: 1fr 1fr; }
  .field-row.three { grid-template-columns: 1fr 1fr 1fr; }
  .field-row.solo { grid-template-columns: 1fr; }

  .field label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-mid);
    margin-bottom: 5px;
  }

  .field label .req {
    color: var(--red-mid);
    margin-left: 2px;
  }

  input[type="text"], select {
    width: 100%;
    padding: 8px 10px;
    font-size: 14px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
    appearance: none;
    -webkit-appearance: none;
  }

  input[type="text"]:focus, select:focus {
    border-color: var(--red-mid);
    box-shadow: 0 0 0 3px rgba(220,38,38,0.12);
  }

  input::placeholder { color: var(--text-faint); }

  select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236B7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 28px;
    cursor: pointer;
  }

  .divider {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1.25rem 0;
  }

  .generate-btn {
    width: 100%;
    padding: 11px;
    background: var(--red-dark);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
    letter-spacing: 0.01em;
  }

  .generate-btn:hover { background: var(--red-mid); }
  .generate-btn:disabled { opacity: 0.5; cursor: not-allowed; background: var(--red-dark); }

  .thinking {
    display: none;
    align-items: center;
    gap: 8px;
    padding: 10px 0 0;
    font-size: 13px;
    color: var(--text-muted);
  }

  .thinking.visible { display: flex; }

  .dots { display: flex; gap: 4px; }
  .dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    background: var(--text-faint);
    animation: blink 1.2s ease-in-out infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%,80%,100%{opacity:0.2} 40%{opacity:1} }

  .output-card { display: none; }
  .output-card.visible { display: block; }

  .output-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 10px;
  }

  .output-text {
    background: #F9FAFB;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1rem;
    font-size: 16px;
    line-height: 1.85;
    color: var(--text);
    white-space: pre-wrap;
    font-family: inherit;
  }

  .action-row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .action-btn {
    flex: 1;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 500;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text-mid);
    cursor: pointer;
    transition: background 0.12s;
  }

  .action-btn:hover { background: var(--bg); }

  .action-btn.copied {
    background: var(--green-light);
    border-color: #86EFAC;
    color: var(--green);
  }

  .status {
    font-size: 13px;
    color: var(--red-mid);
    margin-top: 8px;
    min-height: 18px;
  }

  .api-section {
    background: #FFFBEB;
    border: 1px solid #FDE68A;
    border-radius: var(--radius);
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.25rem;
  }

  .api-section h3 {
    font-size: 13px;
    font-weight: 600;
    color: #92400E;
    margin-bottom: 6px;
  }

  .api-section p {
    font-size: 13px;
    color: #78350F;
    line-height: 1.6;
    margin-bottom: 10px;
  }

  .api-section input {
    border-color: #FCD34D;
  }

  .api-section input:focus {
    border-color: #F59E0B;
    box-shadow: 0 0 0 3px rgba(245,158,11,0.15);
  }

  .api-key-row {
    display: flex;
    gap: 8px;
  }

  .api-key-row input { flex: 1; }

  .save-btn {
    padding: 8px 14px;
    background: #92400E;
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .save-btn:hover { background: #78350F; }

  .key-saved {
    display: none;
    font-size: 12px;
    color: var(--green);
    margin-top: 6px;
    align-items: center;
    gap: 4px;
  }

  .key-saved.visible { display: flex; }

  .info-box {
    background: #EFF6FF;
    border: 1px solid #BFDBFE;
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    font-size: 13px;
    color: #1E40AF;
    margin-bottom: 10px;
    line-height: 1.5;
  }

  footer {
    text-align: center;
    padding: 2rem;
    font-size: 12px;
    color: var(--text-faint);
  }

  @media (max-width: 500px) {
    .field-row.three { grid-template-columns: 1fr 1fr; }
    .container { padding: 1.25rem 1rem; }
  }
</style>
</head>
<body>

<header>
  <div class="header-icon">
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
    </svg>
  </div>
  <div>
    <h1>Dynatrack Racing</h1>
    <p>eBay Listing Description Generator</p>
  </div>
</header>

<div class="container">

  <div class="api-section" id="apiSection">
    <h3>One-time setup - Anthropic API key</h3>
    <p>This tool uses Claude AI to generate descriptions. Enter your Anthropic API key below. It's saved in your browser only and never sent anywhere except Anthropic's servers.</p>
    <div class="api-key-row">
      <input type="text" id="apiKeyInput" placeholder="sk-ant-api03-..." autocomplete="off" />
      <button class="save-btn" onclick="saveKey()">Save key</button>
    </div>
    <div class="key-saved" id="keySaved">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#15803D"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      API key saved
    </div>
  </div>

  <div class="card">
    <div class="card-title">Part information</div>
    <div class="field-row two">
      <div class="field">
        <label>OEM part number <span class="req">*</span></label>
        <div style="display:flex; gap:8px; align-items:center;">
          <input type="text" id="partNum" placeholder="e.g. 22030-65010" style="flex:1;" onblur="checkDarkHawkFitment(this.value)" />
          <button id="lookupBtn" onclick="lookupPartNumber()" title="Look up fitment by part number" style="white-space:nowrap; padding:8px 14px; font-size:12px; font-weight:600; border-radius:var(--radius-sm); border:none; background:var(--gold); color:#1a1a1a; cursor:pointer; transition:opacity 0.12s; flex-shrink:0;">
            🔍 Look up
          </button>
        </div>
        <div id="lookupStatus" style="font-size:11px; color:var(--text-muted); margin-top:5px; min-height:16px;"></div>
        <div id="ebayRefRow" style="display:none; margin-top:8px; display:none;">
          <div style="font-size:11px; color:#b45309; font-weight:500; margin-bottom:4px;">⚠ Lookup couldn't confirm fitment - paste a reference eBay listing URL to extract details:</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="text" id="ebayRefUrl" placeholder="https://www.ebay.com/itm/..." style="flex:1; font-size:12px;" />
            <button onclick="lookupFromEbay()" style="white-space:nowrap; padding:8px 12px; font-size:12px; font-weight:600; border-radius:var(--radius-sm); border:none; background:#1a5276; color:#fff; cursor:pointer; flex-shrink:0;">Use listing</button>
          </div>
        </div>
      </div>
      <div class="field">
        <label>Part name <span style="font-weight:400;color:var(--text-faint)">(auto-filled or enter manually)</span></label>
        <input type="text" id="partName" placeholder="e.g. Throttle Body" />
      </div>
    </div>
    <div class="field-row three">
      <div class="field">
        <label>Donor year</label>
        <input type="text" id="donorYear" placeholder="e.g. 1993" maxlength="4" />
      </div>
      <div class="field">
        <label>Donor make / model</label>
        <input type="text" id="donorVehicle" placeholder="e.g. Toyota 4Runner" />
      </div>
      <div class="field">
        <label>Engine</label>
        <input type="text" id="donorEngine" placeholder="e.g. 3.0L V6" />
      </div>
    </div>

    <div class="field" id="doesNotFitField" style="margin-top:12px; display:none;">
      <label style="color:#b91c1c; font-weight:600;">⚠ Does NOT fit <span style="font-weight:400; color:var(--text-faint)">(auto-filled by Look up - edit or clear if needed)</span></label>
      <input type="text" id="doesNotFit" placeholder="e.g. 2WD models, manual transmission" style="border-color:#fca5a5;" />
      <div style="font-size:11px; color:#b91c1c; margin-top:4px;">This will appear in the listing. Clear the field to omit it.</div>
    </div>

    <hr class="divider">
    <div class="card-title">Sale type &amp; programming</div>

    <div class="field-row solo" style="margin-bottom:10px;">
      <div class="field">
        <label>What is being sold?</label>
        <select id="saleType" onchange="updateSaleUI()">
          <option value="part">Part only - standard listing</option>
          <option value="chrysler_programmed">Chrysler / Jeep / Dodge - programmed by Dynatrack (JTEC / NGC / GPEC)</option>
          <option value="combo_ign">ECU Combo - ECU + Ignition Switch (plug and play set)</option>
          <option value="combo_ign_bcm">ECU Combo - ECU + Ignition Switch + BCM (full plug and play set)</option>
          <option value="honda_key">Honda ECU + Immobilizer + Key blank (plug and play)</option>
          <option value="needs_programming">Computer - requires buyer programming (not serviced by Dynatrack)</option>
          <option value="tested">Tested item - include test results in listing and title</option>
        </select>
      </div>
    </div>

    <div id="chryslerNote" class="info-box" style="display:none;">
      <strong>Chrysler programmed unit.</strong> The AI will note this is programmed by Dynatrack and plug and play for the listed vehicle. Confirm the donor year/make/model/engine above matches the programmed VIN.
    </div>

    <div id="comboNote" class="info-box" style="display:none;">
      <strong>Combo set.</strong> The AI will list all included components and explain that the set must be installed together for plug and play operation.
    </div>

    <div id="hondaNote" class="info-box" style="display:none;">
      <strong>Honda plug and play set.</strong> The AI will explain the immobilizer/key blank setup and that the key must be cut to the buyer's vehicle.
    </div>

    <div id="testedNote" class="info-box" style="display:none;">
      <strong>Tested item.</strong> Test results will be included in the listing description and title automatically.
    </div>
    <div id="testedFields" style="display:none; margin-top:10px;">
      <div class="field-row two">
        <div class="field">
          <label>Tested speed (MPH) <span style="font-weight:400;color:var(--text-faint)">(clusters)</span></label>
          <input type="text" id="testedSpeed" placeholder="e.g. 120" />
        </div>
        <div class="field">
          <label>Mileage at test <span style="font-weight:400;color:var(--text-faint)">(e.g. 105K)</span></label>
          <input type="text" id="testedMileage" placeholder="e.g. 105K" />
        </div>
      </div>
      <div class="field" style="margin-top:8px;">
        <label>Test notes <span style="font-weight:400;color:var(--text-faint)">(optional - e.g. all gauges functional, no warning lights)</span></label>
        <input type="text" id="testedNotes" placeholder="e.g. All gauges functional, no warning lights" />
      </div>
    </div>

    <hr class="divider">
    <div class="card-title">Condition</div>

    <div class="field-row two">
      <div class="field">
        <label>Visual condition</label>
        <select id="condition">
          <option value="good">Good - no visible damage</option>
          <option value="minor">Minor cosmetic wear</option>
          <option value="damage">Damage noted</option>
        </select>
      </div>
      <div class="field">
        <label>Damage / notes <span style="font-weight:400;color:var(--text-faint)">(if any)</span></label>
        <input type="text" id="notes" placeholder="e.g. cracked bracket" />
      </div>
    </div>

    <div class="field" id="programmingNoteField" style="margin-top:12px; display:none;">
      <label>Programming note <span style="font-weight:400;color:var(--text-faint)">(auto-filled by Look up - edit if needed)</span></label>
      <input type="text" id="programmingNote" placeholder="e.g. Direct replacement - no programming required." />
      <div style="font-size:11px; color:var(--text-muted); margin-top:4px;" id="programmingNoteSource"></div>
    </div>

    <!-- DarkHawk Intelligence Panel -->
    <div id="intelPanel" style="display:none; margin-top:16px; padding:14px; background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px;">
      <div style="font-size:11px; font-weight:600; color:#15803D; text-transform:uppercase; letter-spacing:0.07em; margin-bottom:8px;">DarkHawk Intelligence</div>
      <div id="intelProgramming" style="display:none; margin-bottom:6px; font-size:13px;"></div>
      <div id="intelTrimTier" style="display:none; margin-bottom:6px; font-size:13px;"></div>
      <div id="intelFitment" style="display:none; margin-bottom:6px; font-size:13px;"></div>
      <div id="intelSales" style="display:none; font-size:12px; color:#374151;"></div>
    </div>

    <button class="generate-btn" id="generateBtn" onclick="generate()">Generate listing description</button>

    <div class="thinking" id="thinking">
      <div class="dots">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
      <span id="thinkingText">Researching part number...</span>
    </div>
    <div class="status" id="status"></div>
  </div>

  <div class="card output-card" id="outputCard">
    <div id="verifyBanner" style="display:none; align-items:flex-start; gap:10px; background:#FEF2F2; border:1px solid #FECACA; border-radius:6px; padding:10px 12px; margin-bottom:12px;">
      <span style="font-size:16px; line-height:1;">⚠️</span>
      <div>
        <div style="font-size:13px; font-weight:600; color:#991B1B; margin-bottom:2px;">Fields require verification before publishing</div>
        <div style="font-size:12px; color:#B91C1C;">Lines marked in red could not be confirmed across multiple sources. Research those fields before this listing goes live.</div>
      </div>
    </div>
    <div class="output-label">eBay listing title - copy and paste into the title field</div>
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:18px;">
      <div id="titleText" style="flex:1; font-size:15px; font-weight:600; background:var(--bg); border:1.5px solid var(--border); border-radius:6px; padding:10px 12px; min-height:2.4em; line-height:1.4; word-break:break-word;"></div>
      <button class="action-btn" id="copyTitleBtn" onclick="copyTitle()" style="white-space:nowrap; flex-shrink:0;">Copy title</button>
    </div>
    <div style="font-size:11px; color:var(--text-muted); margin-top:-12px; margin-bottom:16px;" id="titleCharCount"></div>
    <div class="output-label">Generated description - review, then copy and paste into eBay</div>
    <div class="output-text" id="outputText"></div>
    <div class="action-row">
      <button class="action-btn" id="copyBtn" onclick="copyText()">Copy description</button>
      <button class="action-btn" onclick="clearOutput()">Clear and start over</button>
    </div>
  </div>

</div>

<footer>Dynatrack Racing internal tool &nbsp;·&nbsp; Powered by Claude AI</footer>

<script>
  const DARKHAWK_API = window.location.hostname.includes('railway.app')
    ? ''
    : 'https://parthawk-production.up.railway.app';

  const API_KEY_STORAGE = 'dt_anthropic_key';

  const PROGRAMMED_SALE_TYPES = ['chrysler_programmed', 'combo_ign', 'combo_ign_bcm', 'honda_key'];

  function updateSaleUI() {
    const val = document.getElementById('saleType').value;
    document.getElementById('chryslerNote').style.display = val === 'chrysler_programmed' ? 'block' : 'none';
    document.getElementById('comboNote').style.display = (val === 'combo_ign' || val === 'combo_ign_bcm') ? 'block' : 'none';
    document.getElementById('hondaNote').style.display = val === 'honda_key' ? 'block' : 'none';
    document.getElementById('testedNote').style.display = val === 'tested' ? 'block' : 'none';
    document.getElementById('testedFields').style.display = val === 'tested' ? 'block' : 'none';

    // Hide programming note for pre-programmed sale types - DynaTrack provides programming
    if (PROGRAMMED_SALE_TYPES.includes(val)) {
      document.getElementById('programmingNoteField').style.display = 'none';
      document.getElementById('programmingNote').value = '';
    }
  }

  // ── OEM Catalog lookup ───────────────────────────────────────────
  const catalogs = [
    {
      name: 'Mopar (Chrysler/Jeep/Dodge/Ram)',
      color: '#7F1D1D',
      detect: p => /^(04|05|0[0-9][0-9][0-9][0-9][0-9][0-9][0-9])/i.test(p) || /^[0-9]{8}[A-Z]{2}$/i.test(p),
      url: p => `https://store.mopar.com/search#q=${encodeURIComponent(p)}&t=All`,
      hint: 'Mopar eStore - official Chrysler/Jeep/Dodge/Ram catalog'
    },
    {
      name: 'Toyota / Lexus',
      color: '#1E3A5F',
      detect: p => /^\d{5}-\d{5}$/i.test(p) || /^\d{8}$/i.test(p) && /^9/.test(p),
      url: p => `https://parts.toyota.com/search?q=${encodeURIComponent(p)}`,
      hint: 'Toyota Parts - official OEM catalog'
    },
    {
      name: 'Ford / Lincoln / Motorcraft',
      color: '#003087',
      detect: p => /^[A-Z]{1,3}[0-9]{1,2}[A-Z]-/i.test(p) || /^[0-9][A-Z][0-9]{1,2}[A-Z]-/i.test(p) || /^[A-Z]{2}[0-9]{2}-/i.test(p),
      url: p => `https://www.fordparts.com/en/search?searchterm=${encodeURIComponent(p)}`,
      hint: 'Ford Parts - official OEM catalog'
    },
    {
      name: 'GM / Chevy / GMC / Buick / Cadillac',
      color: '#003087',
      detect: p => /^\d{8}$/.test(p) && !/^9/.test(p) || /^\d{5}[A-Z]{2}$/.test(p),
      url: p => `https://www.gmpartsdirect.com/search?q=${encodeURIComponent(p)}`,
      hint: 'GM Parts Direct - official GM catalog'
    },
    {
      name: 'Honda / Acura',
      color: '#CC0000',
      detect: p => /^\d{5}-[A-Z0-9]{3,5}-[A-Z0-9]{2,4}$/i.test(p),
      url: p => `https://parts.honda.com/#/parts/search?q=${encodeURIComponent(p)}`,
      hint: 'Honda Parts - official OEM catalog'
    },
    {
      name: 'Nissan / Infiniti',
      color: '#C3002F',
      detect: p => /^\d{5}-[A-Z0-9]{5}$/i.test(p) || /^[A-Z]{2}\d{3}-[A-Z0-9]{5}$/i.test(p),
      url: p => `https://www.nissanparts.cc/search?keywords=${encodeURIComponent(p)}`,
      hint: 'Nissan Parts - OEM catalog'
    },
    {
      name: 'BMW',
      color: '#1C69D4',
      detect: p => /^\d{2}\s?\d{2}\s?\d{1,2}\s?\d{3}\s?\d{3}$/i.test(p.replace(/[-\s]/g,'')),
      url: p => `https://www.realoem.com/bmw/enUS/showparts?q=${encodeURIComponent(p)}`,
      hint: 'RealOEM - BMW parts catalog'
    },
    {
      name: 'Mercedes-Benz',
      color: '#222222',
      detect: p => /^[A-Z]\s?\d{3}\s?\d{3}\s?\d{2,3}\s?\d{2,3}$/i.test(p.replace(/[-\s]/g,'')),
      url: p => `https://www.mbusa.com/en/owner/parts?partNumber=${encodeURIComponent(p)}`,
      hint: 'Mercedes-Benz - OEM parts'
    },
    {
      name: 'Subaru',
      color: '#003087',
      detect: p => /^\d{5}[A-Z]{2}\d{3}$/i.test(p) || /^\d{4}[A-Z]\d{4}$/i.test(p),
      url: p => `https://parts.subaru.com/search?q=${encodeURIComponent(p)}`,
      hint: 'Subaru Parts - official OEM catalog'
    },
    {
      name: 'Hyundai',
      color: '#002C5F',
      detect: p => /^\d{5}-[A-Z0-9]{5}$/i.test(p) && /^[^9]/.test(p),
      url: p => `https://www.hyundaipartsdeal.com/genuine/hyundai-${p.toLowerCase()}.html`,
      hint: 'Hyundai Parts Deal - OEM catalog'
    },
    {
      name: 'Kia',
      color: '#BB162B',
      detect: p => /^\d{5}-[A-Z0-9]{5}$/i.test(p) && /^[9]/.test(p),
      url: p => `https://www.kiapartsnow.com/genuine/kia-${p.toLowerCase()}.html`,
      hint: 'Kia Parts Now - OEM catalog'
    }
  ];

  // Fallback: RockAuto search works for almost everything
  const rockAutoUrl = p => `https://www.rockauto.com/en/partsearch/?romsite=1&q=${encodeURIComponent(p)}`;

  function detectCatalog(partNum) {
    const p = (partNum || '').trim();
    if (!p) return null;
    // Also check donor vehicle for make hints
    const donor = (document.getElementById('donorVehicle')?.value || '').toLowerCase();
    if (donor.includes('jeep') || donor.includes('dodge') || donor.includes('chrysler') || donor.includes('ram')) {
      return catalogs[0]; // Mopar
    }
    if (donor.includes('toyota') || donor.includes('lexus') || donor.includes('4runner') || donor.includes('tacoma') || donor.includes('tundra')) {
      return catalogs[1]; // Toyota
    }
    if (donor.includes('ford') || donor.includes('lincoln') || donor.includes('mustang') || donor.includes('f-150') || donor.includes('f150') || donor.includes('explorer')) {
      return catalogs[2]; // Ford
    }
    if (donor.includes('chevy') || donor.includes('chevrolet') || donor.includes('gmc') || donor.includes('buick') || donor.includes('cadillac') || donor.includes('silverado')) {
      return catalogs[3]; // GM
    }
    if (donor.includes('honda') || donor.includes('acura')) return catalogs[4];
    if (donor.includes('nissan') || donor.includes('infiniti')) return catalogs[5];
    if (donor.includes('bmw')) return catalogs[6];
    if (donor.includes('mercedes') || donor.includes('benz')) return catalogs[7];
    if (donor.includes('subaru')) return catalogs[8];
    if (donor.includes('hyundai')) return catalogs[9];
    if (donor.includes('kia')) return catalogs[10];
    // Fall back to part number pattern detection
    for (const cat of catalogs) {
      if (cat.detect(p)) return cat;
    }
    return null; // Will use RockAuto
  }

  async function lookupPartNumber() {
    const partNum = document.getElementById('partNum').value.trim();
    const apiKey = localStorage.getItem('dt_anthropic_key') || document.getElementById('apiKeyInput').value.trim();
    const statusEl = document.getElementById('lookupStatus');
    const btn = document.getElementById('lookupBtn');

    if (!partNum) {
      statusEl.innerHTML = '<span style="color:#b91c1c;">Enter a part number first.</span>';
      return;
    }
    if (!apiKey) {
      statusEl.innerHTML = '<span style="color:#b91c1c;">Save your API key first.</span>';
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ Looking up...';
    statusEl.innerHTML = '<span style="color:var(--text-muted);">Checking DarkHawk fitment database...</span>';

    // ── STEP 0: Check DarkHawk fitment intelligence (free, instant) ───
    try {
      const fitmentUrl = `${DARKHAWK_API}/api/fitment/lookup?partNumber=${encodeURIComponent(partNum)}`;
      const fitmentRes = await fetch(fitmentUrl, { signal: AbortSignal.timeout(5000) });
      if (fitmentRes.ok) {
        const fitment = await fitmentRes.json();
        if (fitment && fitment.confidence && fitment.confidence !== 'none') {
          // Auto-populate doesNotFit from DarkHawk
          const doesNotFitField = document.getElementById('doesNotFitField');
          const doesNotFitInput = document.getElementById('doesNotFit');
          if (fitment.negationText) {
            doesNotFitField.style.display = 'block';
            doesNotFitInput.value = fitment.negationText;
          }
          // If high confidence, populate vehicle fields too and skip Claude
          if (fitment.confidence === 'high' && fitment.fits) {
            const engines = fitment.fits.engines || [];
            const trims = fitment.fits.trims || [];
            if (engines.length) document.getElementById('donorEngine').value = engines.join(', ');
            statusEl.innerHTML = '<span style="color:#15803d; font-weight:500;">✓ Fitment loaded from DarkHawk - high confidence</span>';
            btn.disabled = false;
            btn.textContent = '🔍 Look up';
            return; // Skip Claude web search entirely
          }
          // Medium confidence - continue to Claude for full lookup but keep DarkHawk data
          statusEl.innerHTML = '<span style="color:var(--text-muted);">DarkHawk data found - verifying with web search...</span>';
        }
      }
    } catch (e) {
      // DarkHawk unavailable - fall through silently to Claude web search
    }

    statusEl.innerHTML = '<span style="color:var(--text-muted);">Identifying part...</span>';

    // Helper: run one agentic search loop, return parsed JSON or null
    async function runAgentic(userMsg, headers, statusText) {
      statusEl.innerHTML = `<span style="color:var(--text-muted);">${statusText}</span>`;
      let messages = [userMsg];
      let fullText = '';

      const deadline = Date.now() + 18000; // 18 second hard timeout per step
      for (let i = 0; i < 1; i++) { // single search only - keeps token usage low
        if (Date.now() > deadline) break;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), deadline - Date.now());
        let res, data;
        try {
          res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 400,
              tools: [{ type: 'web_search_20250305', name: 'web_search' }],
              messages
            })
          });
          data = await res.json();
        } catch (fetchErr) {
          break; // timeout or network - exit loop with whatever we have
        } finally {
          clearTimeout(timer);
        }
        if (data.error) throw new Error(data.error.message);

        const texts = data.content.filter(b => b.type === 'text').map(b => b.text);
        if (texts.length) fullText += texts.join('');
        if (data.stop_reason !== 'tool_use') break;

        const toolResults = data.content
          .filter(b => b.type === 'tool_use')
          .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: b.input ? JSON.stringify(b.input) : 'done' }));
        messages = [...messages, { role: 'assistant', content: data.content }, { role: 'user', content: toolResults }];
      }

      // If no text yet, force a final no-tools call
      if (!fullText.trim()) {
        const finalRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            messages: [...messages, { role: 'user', content: 'Return the JSON now based on your search results. Use null for unknown fields.' }]
          })
        });
        const fd = await finalRes.json();
        if (!fd.error) fullText = fd.content.filter(b => b.type === 'text').map(b => b.text).join('');
      }

      // Parse JSON from response
      const cleaned = fullText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const matches = [...cleaned.matchAll(/\{[\s\S]*\}/g)];
      if (!matches.length) return null;
      const raw = matches[matches.length - 1][0];
      try {
        return JSON.parse(raw);
      } catch {
        const fixed = raw.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/:\s*undefined/g, ': null');
        return JSON.parse(fixed);
      }
    }

    try {
      const apiHeaders = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      };

      const searchPartNum = partNum.replace(/-[A-Z]{2}$/, '') || partNum;

      // ── STEP 1: Identify the part ───────────────────────────────────
      const step1 = await runAgentic({
        role: 'user',
        content: `Search the web for OEM part number "${partNum}" or "${searchPartNum}".

Your ONLY job: confirm what this part is and what vehicle it fits.

Rules:
- Use the part name exactly as shown in search results. Do NOT guess from the part number pattern.
- North American vehicles only (US/Canada sold). Use Ford Escape not Ford Kuga. Use Chevy not Holden.
- If results are ambiguous or part not found, set confidence to "low" and use null for unknown fields.

For the "category" field, pick exactly one word from this list based on what the part is:
ECU (engine control module/PCM/ECM), BCM (body control module), TCM (transmission control module),
TIPM (totally integrated power module/fuse box/junction box), ABS (ABS module/pump),
CLUSTER (instrument cluster/gauge cluster), RADIO (radio/head unit/infotainment),
THROTTLE (throttle body), MECHANICAL (mechanical part with no electronics), OTHER (anything else)

Return ONLY valid JSON - no markdown, no explanation:
{
  "partName": null,
  "category": null,
  "year": null,
  "make": null,
  "model": null,
  "confidence": null
}
Replace null with confirmed values.`
      }, apiHeaders, 'Identifying part...');

      if (!step1 || !step1.partName || step1.confidence === 'low') {
        statusEl.innerHTML = '';
        document.getElementById('ebayRefRow').style.display = 'block';
        btn.disabled = false;
        btn.textContent = '🔍 Look up';
        return;
      }

      const category = (step1.category || 'OTHER').toUpperCase();
      const needsProgrammingResearch = ['ECU','BCM','TCM','TIPM','ABS','CLUSTER','RADIO'].includes(category);
      const needsIncompatibilityResearch = ['ECU','BCM','TCM','TIPM','ABS','CLUSTER','RADIO','THROTTLE'].includes(category);

      // ── STEP 1.5: DarkHawk Intelligence (now we have year/make/model/category) ───
      const categoryToPartType = {
        'ECU': 'ecu', 'BCM': 'bcm', 'TCM': 'tcm', 'TIPM': 'tipm',
        'ABS': 'abs', 'CLUSTER': 'cluster', 'RADIO': 'radio',
        'THROTTLE': 'throttle', 'MECHANICAL': 'mechanical', 'OTHER': 'generic'
      };
      const detectedPartType = categoryToPartType[category] || 'generic';
      statusEl.innerHTML = '<span style="color:var(--text-muted);">Checking DarkHawk intelligence...</span>';
      try {
        const intel = await fetchIntelligence(
          partNum,
          step1.year || document.getElementById('donorYear').value.trim(),
          step1.make || '',
          step1.model || '',
          document.getElementById('donorEngine').value.trim(),
          detectedPartType
        );
        if (intel) {
          renderIntelPanel(intel);
          if (intel.fitment) {
            const f = intel.fitment;
            if (f.year && !step1.year) step1.year = f.year;
            if (f.make && !step1.make) step1.make = f.make;
            if (f.model && !step1.model) step1.model = f.model;
            if (f.engine && !document.getElementById('donorEngine').value) document.getElementById('donorEngine').value = f.engine;
            if (f.partName && !document.getElementById('partName').value) document.getElementById('partName').value = f.partName;
            if (f.doesNotFit) {
              document.getElementById('doesNotFit').value = f.doesNotFit;
              document.getElementById('doesNotFitField').style.display = 'block';
            }
          }
        }
      } catch (e) { /* intelligence unavailable */ }

      // Small delay between steps to avoid token rate limit burst
      await new Promise(r => setTimeout(r, 600));

      // ── STEP 2: Research fitment specifics ─────────────────────────
      const categoryInstructions = {
        ECU:       'Confirm exact engine size and transmission type. Research what engine/transmission configs it does NOT fit.',
        BCM:       'Confirm trim level. Research which trims it does NOT fit.',
        TCM:       'Confirm exact transmission type/code. Research what it does NOT fit.',
        TIPM:      'Confirm exact year/model. Research any year or sub-model exclusions.',
        ABS:       'CRITICAL: Is this 2WD/FWD or AWD/4WD specific? ABS modules almost always differ by drivetrain. Confirm which drivetrain it fits and which it does NOT fit. For ABS modules: Research whether this specific ABS unit requires any programming, calibration, or initialization after installation. Many 2015+ ABS modules require dealer calibration. Be specific - do not guess.',
        CLUSTER:   'Confirm trim and display type. Research exclusions. Does this German vehicle cluster require coding?',
        RADIO:     'Confirm trim and option package. Research which packages it does NOT fit.',
        THROTTLE:  'Confirm exact engine size/code. Research what engines it does NOT fit.',
        MECHANICAL:'Confirm year/make/model. Note any relevant exclusions.',
        OTHER:     'Confirm year/make/model fitment range.'
      };

      const progJsonFields = needsProgrammingResearch
        ? `"programmingRequired": "yes or no or unknown",
  "programmingNote": "one definitive sentence, or null if unknown"`
        : `"programmingRequired": null,
  "programmingNote": null`;

      const step2 = await runAgentic({
        role: 'user',
        content: `Part confirmed: "${step1.partName}" - Category: ${category}
Vehicle: ${step1.year} ${step1.make} ${step1.model}
Part number: ${partNum}

Task: ${categoryInstructions[category] || categoryInstructions.OTHER}
${needsProgrammingResearch ? 'Also confirm: Does this specific part require programming to the vehicle, or is it plug-and-play? Search for a definitive answer - do not guess.' : ''}

Rules: North American market only. Only report confirmed facts from search results. Use JSON null (not the string "null") for anything not confirmed.

Return ONLY valid JSON - no markdown fences, no explanation:
{
  "engine": null,
  "drivetrain": null,
  "trim": null,
  "doesNotFit": null,
  ${progJsonFields}
}
Replace null values with confirmed data where found. Keep null where unconfirmed.`
      }, apiHeaders, 'Researching fitment details...');

      // ── Populate fields ─────────────────────────────────────────────
      document.getElementById('partName').value = step1.partName;
      if (step1.year) document.getElementById('donorYear').value = String(step1.year).split('-')[0];

      let vehicleStr = [step1.make, step1.model].filter(Boolean).join(' ');
      if (step2?.drivetrain && step2.drivetrain !== 'All Drivetrains') vehicleStr += ` - ${step2.drivetrain}`;
      if (step2?.trim) vehicleStr += ` (${step2.trim})`;
      if (vehicleStr) document.getElementById('donorVehicle').value = vehicleStr;
      if (step2?.engine) document.getElementById('donorEngine').value = step2.engine;

      // Does NOT fit
      const doesNotFitField = document.getElementById('doesNotFitField');
      const doesNotFitInput = document.getElementById('doesNotFit');
      if (step2?.doesNotFit) {
        doesNotFitField.style.display = 'block';
        doesNotFitInput.value = step2.doesNotFit;
      } else {
        doesNotFitField.style.display = 'none';
        doesNotFitInput.value = '';
      }

      // Programming note - skip entirely for pre-programmed sale types
      const currentSaleType = document.getElementById('saleType').value;
      const skipProgramming = PROGRAMMED_SALE_TYPES.includes(currentSaleType);

      // Priority: 1) skip if pre-programmed 2) programming_db.json 3) Claude research 4) ABS default
      const progField = document.getElementById('programmingNoteField');
      const progInput = document.getElementById('programmingNote');
      const progSource = document.getElementById('programmingNoteSource');

      if (skipProgramming) {
        // Pre-programmed sale type - DynaTrack provides programming, hide field
        progField.style.display = 'none';
        progInput.value = '';
      } else if (needsProgrammingResearch) {
        // Priority 1: Check programming_db.json
        const make = step1.make || '';
        const year = step1.year || '';
        const dbLookup = lookupProgramming(make, year, category.toLowerCase());

        if (dbLookup.found) {
          progField.style.display = 'block';
          progInput.value = dbLookup.notes;
          const isRequired = dbLookup.required === 'YES' || dbLookup.required === 'VERIFY';
          const color = dbLookup.required === 'YES' ? '#b91c1c' : dbLookup.required === 'VERIFY' ? '#b45309' : '#15803d';
          const label = dbLookup.required === 'YES' ? '⚠ Programming required' : dbLookup.required === 'VERIFY' ? '⚠ Verify programming' : '✓ No programming required';
          progSource.innerHTML = `<span style="color:${color}; font-weight:500;">${label} - from programming database</span>`;
        } else if (step2?.programmingNote && step2?.programmingRequired !== 'unknown') {
          // Priority 2: Claude research result
          progField.style.display = 'block';
          progInput.value = step2.programmingNote;
          const isYes = step2.programmingRequired === 'yes';
          progSource.innerHTML = `<span style="color:${isYes ? '#b45309' : '#15803d'}; font-weight:500;">${isYes ? '⚠ Programming required - confirmed by search' : '✓ No programming required - confirmed by search'}</span>`;
        } else if (category === 'ABS') {
          // Priority 3: ABS default when no data
          progField.style.display = 'block';
          progInput.value = 'May require ABS module initialization or calibration after installation. Consult a qualified technician.';
          progSource.innerHTML = '<span style="color:#b45309; font-weight:500;">⚠ ABS programming unknown - using default caution</span>';
        } else {
          progField.style.display = 'none';
          progInput.value = '';
        }
      } else {
        // Non-programmable part types - hide programming note entirely
        progField.style.display = 'none';
        progInput.value = '';
      }

      // Confidence indicator
      document.getElementById('ebayRefRow').style.display = 'none';
      document.getElementById('ebayRefUrl').value = '';
      const conf = step1.confidence;
      const confColor = conf === 'high' ? '#15803d' : conf === 'medium' ? '#b45309' : '#b91c1c';
      const confText = conf === 'high' ? '✓ Fitment confirmed' : conf === 'medium' ? '⚠ Verify fitment before listing' : '✗ Could not confirm - fill in manually';
      statusEl.innerHTML = `<span style="color:${confColor}; font-weight:500;">${confText}</span>`;

    } catch (err) {
      statusEl.innerHTML = `<span style="color:#b91c1c;">Lookup failed: ${err.message}</span>`;
      document.getElementById('ebayRefRow').style.display = 'block';
      console.error(err);
    }

    btn.disabled = false;
    btn.textContent = '🔍 Look up';
  }

  function loadKey() {
    const key = localStorage.getItem(API_KEY_STORAGE);
    if (key) {
      document.getElementById('apiKeyInput').value = key;
      document.getElementById('keySaved').classList.add('visible');
    }
  }

  function saveKey() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) return;
    localStorage.setItem(API_KEY_STORAGE, key);
    document.getElementById('keySaved').classList.add('visible');
    document.getElementById('status').textContent = '';
  }

  function getKey() {
    return localStorage.getItem(API_KEY_STORAGE) || document.getElementById('apiKeyInput').value.trim();
  }

  async function generate() {
    const apiKey = getKey();
    if (!apiKey) {
      document.getElementById('status').textContent = 'Please enter your Anthropic API key above first.';
      document.getElementById('apiKeyInput').focus();
      return;
    }

    const partNum = document.getElementById('partNum').value.trim();
    if (!partNum) {
      document.getElementById('status').textContent = 'Part number is required.';
      document.getElementById('partNum').focus();
      return;
    }

    const partName = document.getElementById('partName').value.trim();
    const donorYear = document.getElementById('donorYear').value.trim();
    const donorVehicle = document.getElementById('donorVehicle').value.trim();
    const donorEngine = document.getElementById('donorEngine').value.trim();
    const condition = document.getElementById('condition').value;
    const notes = document.getElementById('notes').value.trim();
    const donorInfo = [donorYear, donorVehicle, donorEngine].filter(Boolean).join(' ');
    const saleType = document.getElementById('saleType').value;
    const isChrysler = saleType === 'chrysler_programmed';
    const isTested = saleType === 'tested';
    const testedSpeed = document.getElementById('testedSpeed').value.trim();
    const testedMileage = document.getElementById('testedMileage').value.trim();
    const testedNotes = document.getElementById('testedNotes').value.trim();
    const testedSuffix = [testedSpeed ? `Tested ${testedSpeed}MPH` : '', testedMileage ? testedMileage : '', testedNotes].filter(Boolean).join(' - ');

    const conditionLine = condition === 'good'
      ? 'Cleaned and visually inspected. Removed from a running donor vehicle.'
      : condition === 'minor'
      ? 'Cleaned and visually inspected. Minor cosmetic wear consistent with normal use. Removed from a running donor vehicle.'
      : `Cleaned and visually inspected. Damage noted${notes ? ': ' + notes : ''}. Removed from a running donor vehicle.`;

    const saleTypeInstructions = {
      part: `Standard used part. Use the programming note field if it was pre-filled from the database. If the programming note field is empty, omit the Programming Note bullet entirely.`,
      chrysler_programmed: `Chrysler/Jeep/Dodge ECM/PCM programmed by Dynatrack Racing (JTEC, NGC, GPEC only - no diesel/Cummins). Use Chrysler template.`,
      combo_ign: `ECU + Ignition Switch plug and play set. Part name: "[MAKE] ECU + IGNITION SWITCH COMBO - PLUG AND PLAY SET". Add: "• What's Included: ECU/ECM + Matching Ignition Switch". Programming Note: "Plug and play set - must be installed together. No additional programming required."`,
      combo_ign_bcm: `ECU + Ignition Switch + BCM full set. Part name: "[MAKE] ECU + IGNITION SWITCH + BCM COMBO - PLUG AND PLAY SET". Add: "• What's Included: ECU/ECM + Matching Ignition Switch + Body Control Module (BCM)". Programming Note: "Plug and play set - all three components must be installed together. No additional programming required."`,
      honda_key: `Honda ECU + immobilizer + key blank set. Part name: "HONDA ECU + IMMOBILIZER + KEY BLANK - PLUG AND PLAY SET". Add: "• What's Included: Honda ECU + Immobilizer Unit + Key Blank(s)". Programming Note: "Plug and play set - key blank must be cut to buyer's ignition. No dealer programming required once key is cut and full set is installed."`,
      needs_programming: `Computer requiring buyer programming - Dynatrack does NOT program this. Programming Note: "Requires VIN-specific programming before use. Not included - take to dealer or qualified shop after purchase."`,
      tested: `This item has been tested and confirmed working. Include a "• Tested:" bullet in Item Specifics after the Fits line with the test results. Keep it factual and concise e.g. "Tested: All gauges functional - 120MPH - 105K miles" or "Tested: Unit powers on, all functions verified". Do not use Programming Note for tested items unless the part separately requires programming.`
    };

    const chryslerTemplate = `Programmed ECU ECM PCM [YEAR RANGE] [MAKE] [MODEL] [ENGINE]

Item Specifics
• Part Number: ${partNum}
• Fits: [year range make model engine/trim - confirmed fitment only]
[DOES NOT FIT LINE - only if exclusions are explicitly confirmed from search results, otherwise omit entirely]
• Condition: Inspected for Damage
• Warranty: 30-Day Hassle-Free Returns
• Shipping: Ships within 1 Business Day (North Carolina, USA)

CUSTOM PROGRAMMING INCLUDED - To ensure a seamless "Plug & Play" experience, we require your VIN and Mileage during checkout.
Note: Providing this info immediately prevents shipping delays and ensures 100% compatibility with your vehicle.


About Dynatrack Racing
We are dismantlers based in North Carolina, specializing in high-quality OEM components.
• Support: Available Mon-Fri for any questions.
• Shipping: Fast domestic shipping. (Hawaii/Alaska residents: please message for a quote prior to purchase).`;

    const standardTemplate = `[PART NAME IN ALL CAPS - e.g. Kia Sportage 2010-2014 Fuse Box Junction Relay Interior OEM]

Item Specifics
• Part Number: ${partNum}
• Fits: [year range make model - confirmed fitment only, e.g. 2010-2014 Kia Sportage]
[DOES NOT FIT LINE - only if exclusions are explicitly confirmed from search results, otherwise omit entirely]
[WHATS INCLUDED LINE - only if sale type requires it, otherwise omit]
[PROGRAMMING NOTE LINE - only if programming note field is filled, otherwise omit entirely]
• Condition: ${conditionLine}
• Warranty: 30-Day Hassle-Free Returns
• Shipping: Ships within 1 Business Day (North Carolina, USA)

About Dynatrack Racing
We are dismantlers based in North Carolina, specializing in high-quality OEM components.
• Support: Available Mon-Fri for any questions.
• Shipping: Fast domestic shipping. (Hawaii/Alaska residents: please message for a quote prior to purchase).

IMPORTANT FORMATTING RULES:
- Your FIRST LINE must be the eBay title prefixed with "TITLE:"
- Title word order is STRICT: [Make] [Model] [Year Range] [Part Name + most relevant keywords] [Part Number] [optional end notes]
- Examples from our store:
    TITLE: Mercedes-Benz ML350 GL-Class R-Class 2006-2012 Rear SAM Control Module A 164 900 54 01
    TITLE: Infiniti G35 G37 2007-2008 Body Control Module BCM OEM 284B1-JK600
    TITLE: Chevrolet Express Van 1500 2500 3500 2008-2009 Engine Fuse Box 25888289
    TITLE: Ford Escape 1.6L 2013-2016 Coolant Level Sensor Pipe Assembly GV61-8C045-AB
    TITLE: Toyota Sienna 3.5L 2011-2016 Engine Fuse Box Junction Relay OEM
    TITLE: Volkswagen Jetta Sedan Wagon 2011-2014 ABS Anti Lock Brake Pump 1K0 614 517 DL
    TITLE: Lincoln MKX Ford Edge 2011-2013 ABS Anti Lock Brake Pump Assembly CT43-2C405-BB
    TITLE: Mazda 3 2.3L 2007-2009 Transmission Control Module TCU TCM OEM L34T 18 9E1A
    TITLE: Ford Mustang V6 1998 Instrument Gauge Cluster Speedometer Tested 120MPH 105K
    TITLE: Dodge Ram 1500 5.9L 1997 Programmed ECU ECM PCM Engine Control 56040440AC
- Part number always goes at the end before any condition/mileage/test notes
- End notes only when relevant: "Programmed" for pre-programmed ECUs, drivetrain if specific (AWD/2WD)
- BRAND NAMES IN TITLE: Use ONLY the vehicle brand, never the parent company. Lexus is "Lexus" not "Toyota Lexus". Acura is "Acura" not "Honda Acura". Infiniti is "Infiniti" not "Nissan Infiniti". Lincoln is "Lincoln" not "Ford Lincoln". Mini is "Mini" not "BMW Mini". Scion is "Scion" not "Toyota Scion".
- Exception: For DRIVETRAIN parts that genuinely fit both brands (e.g., ECU fits both Toyota Camry and Lexus ES), list both brands separately: "Toyota Camry Lexus ES 2012-2017 ECM PCM..."
${isTested && testedSuffix ? `- This is a TESTED item - append the following at the very end of the title: ${testedSuffix}` : ''}
- Title must be 80 characters or under - cut filler words to fit, never exceed 80
- After the TITLE: line, leave one blank line then output the listing body exactly as templated
- Do NOT include a "Removed From" bullet - omit it entirely
- Keep each bullet to one line
- No extra blank lines between bullets
- Do not add any fields not shown in the template above
- The About section must be EXACTLY as templated - do not add a "Returns:" bullet to the About section (returns are in the Warranty bullet)
- Do not merge "About Dynatrack Racing" with the description on the same line
- Do not add any bullets, lines, or sections not shown in the template`;

    // ── Part type detection ──────────────────────────────────────────
    // Infer from partName field first, fall back to saleType context
    const partNameLower = (partName || '').toLowerCase();
    const donorLower = (donorVehicle || '').toLowerCase();

    function detectPartType() {
      if (/\b(ecu|ecm|pcm|engine control)\b/.test(partNameLower)) return 'ecu';
      if (/\b(bcm|body control)\b/.test(partNameLower)) return 'bcm';
      if (/\b(tipm|totally integrated|fuse box|fuse relay|junction box)\b/.test(partNameLower)) return 'tipm';
      if (/\b(tcm|tcu|transmission control)\b/.test(partNameLower)) return 'tcm';
      if (/\b(abs|anti.?lock|brake pump|brake module)\b/.test(partNameLower)) return 'abs';
      if (/\b(amp|amplifier)\b/.test(partNameLower)) return 'amplifier';
      if (/\b(cluster|speedometer|gauge|instrument panel)\b/.test(partNameLower)) return 'cluster';
      if (/\b(throttle body|throttle)\b/.test(partNameLower)) return 'throttle';
      if (/\b(radio|audio|infotainment|receiver|head unit)\b/.test(partNameLower)) return 'radio';
      if (/\b(idm|injector driver)\b/.test(partNameLower)) return 'idm';
      if (/\b(multiair|vvt|valve actuator|camshaft)\b/.test(partNameLower)) return 'mechanical';
      if (saleType === 'chrysler_programmed' || isChrysler) return 'ecu';
      return 'generic';
    }

    const partType = detectPartType();

    // ── Per-part-type rules: fitment specificity + programming ───────
    const partTypeRules = {
      ecu: {
        query: `"${partNum}" ECM PCM engine control module fitment application`,
        fitmentFields: 'MUST include exact engine size and code (e.g. 2.4L 4-cyl, 3.5L V6). ECUs are engine AND transmission specific - include trans type if confirmed (auto/manual). Year range must be exact.',
        programmingRule: 'ECUs ALWAYS require VIN-specific programming. Write exactly: "Requires VIN-specific programming - must be programmed to your vehicle before use."',
      },
      bcm: {
        query: `"${partNum}" body control module BCM compatibility fitment`,
        fitmentFields: 'Year/make/model/trim. BCMs are often trim-specific - include trim level if confirmed. Engine is usually NOT relevant for BCMs.',
        programmingRule: 'BCMs require programming to VIN. Write exactly: "Requires VIN-specific programming - must be paired to your vehicle."',
      },
      tipm: {
        query: `"${partNum}" TIPM fuse box integrated power module fitment`,
        fitmentFields: 'Exact year/make/model. Engine is sometimes relevant on TIPMs - include if confirmed. TIPMs are highly specific.',
        programmingRule: 'TIPMs require programming. Write exactly: "VIN-specific - requires dealer or professional programming before use."',
      },
      tcm: {
        query: `"${partNum}" transmission control module TCM fitment application`,
        fitmentFields: 'Year/make/model AND transmission type (e.g. 6-speed automatic, 5-speed manual). TCMs are transmission-specific - this is the most important field.',
        programmingRule: 'TCMs require programming. Write exactly: "Requires VIN-specific programming - must be programmed to your vehicle and transmission."',
      },
      abs: {
        query: `"${partNum}" ABS pump module anti-lock brake fitment`,
        fitmentFields: 'Year/make/model. CRITICAL: check if part is 2WD or 4WD specific - many ABS units differ. If it fits all drivetrains, write "All Drivetrains". Engine is NOT relevant for ABS.',
        programmingRule: null, // Determined by programming_db.json lookup or Claude research
      },
      amplifier: {
        query: `"${partNum}" amplifier OEM audio fitment application`,
        fitmentFields: 'Year/make/model and audio package (e.g. Bose, Harman Kardon, Mark Levinson, Alpine, Bang & Olufsen, JBL, Infinity, Rockford Fosgate, premium audio). Engine and drivetrain are NOT relevant for amplifiers. IMPORTANT: If the part name includes an audio brand (Mark Levinson, Bose, etc.), include that brand name in BOTH the title and the Fits line. Example: "Fits: 2007-2011 Lexus GS350 with Mark Levinson audio system".',
        programmingRule: 'Amplifiers are direct replacement. Omit programming note entirely.',
      },
      cluster: {
        query: `"${partNum}" instrument cluster speedometer fitment`,
        fitmentFields: 'Year/make/model/trim. Note if analog vs digital display. Engine may matter on clusters - include if confirmed. Trim level often determines cluster type.',
        programmingRule: 'Clusters are direct replacement. Write exactly: "Direct replacement - no programming required."',
      },
      throttle: {
        query: `"${partNum}" throttle body fitment engine application`,
        fitmentFields: 'Year/make/model AND exact engine (e.g. 2.4L 4-cyl, 3.5L V6). Throttle bodies are engine-specific - engine is the most critical field. Drivetrain is NOT relevant.',
      },
      radio: {
        query: `"${partNum}" radio head unit OEM fitment application`,
        fitmentFields: 'Year/make/model and trim/option package. Engine and drivetrain are NOT relevant for radios. If trim data shows a specific audio brand, mention it. Distinguish between base radio and navigation unit if possible.',
        programmingRule: 'Radios are direct replacement. Omit programming note entirely.',
      },
      idm: {
        query: `"${partNum}" IDM injector driver module diesel fitment`,
        fitmentFields: 'Year/make/model/engine. IDMs are engine and calibration specific - include exact diesel engine code.',
        programmingRule: 'IDMs are direct replacement. Write exactly: "Direct replacement - no programming required."',
      },
      mechanical: {
        query: `"${partNum}" OEM part fitment application`,
        fitmentFields: 'Year/make/model. Include engine only if the part is engine-specific. Drivetrain only if relevant.',
      },
      generic: {
        query: `"${partNum}" OEM part fitment application vehicle`,
        fitmentFields: 'Year/make/model. Include engine and drivetrain only if the search results show the part is specific to them.',
      }
    };

    const strategy = partTypeRules[partType];

    // Catalog-aware search
    const detectedCat = detectCatalog(partNum);
    const catalogHint = detectedCat ? `Search ${detectedCat.name.split('/')[0]} OEM catalog for this part.` : 'Search RockAuto or manufacturer catalog for this part.';
    const enrichedQuery = detectedCat
      ? `${strategy.query} ${detectedCat.name.split('/')[0]}`
      : strategy.query;

    // Cross-brand fitment: drivetrain parts can span Toyota/Lexus, Honda/Acura, etc.
    const CROSS_BRAND_ALLOWED = ['ecu', 'ecm', 'pcm', 'tcm', 'abs', 'throttle', 'tipm', 'idm', 'mechanical', 'generic'];
    const allowsCrossBrand = CROSS_BRAND_ALLOWED.includes(partType);

    const confirmedProgrammingNote = document.getElementById('programmingNote').value.trim();
    const programmingNoteFieldVisible = document.getElementById('programmingNoteField').style.display !== 'none';
    const confirmedDoesNotFit = document.getElementById('doesNotFit').value.trim();

    const prompt = `You are an eBay listing writer for Dynatrack Racing, a used OEM auto parts dismantler in North Carolina. They offer 30-day hassle-free returns. All parts are sourced from North American vehicles and sold to North American buyers.

IMPORTANT: Use North American vehicle names only. If search results show both a North American model and a foreign-market equivalent (e.g. Ford Escape vs Ford Kuga, Chevy Cruze vs Holden Cruze), always use the North American name in the listing.

PART TYPE: ${partType.toUpperCase()}
DETECTED MAKE: ${detectedCat ? detectedCat.name : 'Unknown - use RockAuto'}

Do ONE web search using this query: ${enrichedQuery}
${catalogHint}

═══ FITMENT RULES ═══
${strategy.fitmentFields}

- Write the Fits line with ONLY fields confirmed by search results.
- If engine/drivetrain is NOT relevant to this part type, do NOT include it in the Fits line.
- If engine/drivetrain IS relevant but you cannot confirm it, write ⚠️ VERIFY FITMENT BEFORE LISTING.
- Never invent or guess fitment data.

═══ DOES NOT FIT ═══
${confirmedDoesNotFit
  ? `CONFIRMED EXCLUSION - include this line exactly: "• Does NOT fit: ${confirmedDoesNotFit}"`
  : 'No confirmed exclusions - omit the Does NOT fit line entirely. Do not guess or invent exclusions.'
}

═══ PROGRAMMING NOTE ═══
PROGRAMMING NOTE RULES:
- ONLY include a "Programming Note:" bullet for these part types: ECU, BCM, TCM, TIPM, ABS, Radio, Cluster, Immobilizer
- For amplifiers, throttle bodies, mechanical parts, and all other part types: do NOT include any programming note bullet at all. Omit it entirely.
- Never write "Direct replacement - no programming required" for parts that obviously don't need programming. Buyers know an amplifier doesn't need programming.
${confirmedProgrammingNote
  ? `USE THIS EXACT PROGRAMMING NOTE - do not change it: "${confirmedProgrammingNote}"`
  : programmingNoteFieldVisible
    ? 'Programming note field was shown but left blank - omit the Programming Note bullet entirely.'
    : 'This part type does not require a programming note - omit the Programming Note bullet entirely.'
}

${lastIntelligence && lastIntelligence.trimTier ? `
═══ TRIM INTELLIGENCE (from DarkHawk database) ═══
Vehicle trim tier: ${lastIntelligence.trimTier.tier}
${lastIntelligence.trimTier.audioBrand ? 'Audio system: ' + lastIntelligence.trimTier.audioBrand : ''}
${lastIntelligence.trimTier.expectedParts ? 'Expected parts for this trim: ' + lastIntelligence.trimTier.expectedParts : ''}
${lastIntelligence.trimTier.cultFlag ? 'Cult vehicle: Yes - note desirability if relevant' : ''}

Use this trim data to enrich the listing where relevant:
- For amplifiers: mention the specific audio brand
- For radios: mention if this is a base or navigation unit based on trim
- For BCMs: note trim-specific features this BCM controls
` : ''}
${lastIntelligence && lastIntelligence.fitment && lastIntelligence.fitment.allVehicles ? `
═══ CONFIRMED FITMENT (from DynaTrack database - ${lastIntelligence.fitment.allVehicles.length} vehicles matched) ═══
${lastIntelligence.fitment.allVehicles.map(v => (v.year || '') + ' ' + (v.make || '') + ' ' + (v.model || '') + ' ' + (v.engine || '')).join(', ')}
Does not fit: ${lastIntelligence.fitment.doesNotFit || 'No confirmed exclusions'}

CRITICAL: This fitment is from our verified database. The Fits line MUST include these vehicles.
${allowsCrossBrand
  ? 'This is a DRIVETRAIN part (' + partType + '). Cross-brand fitment IS expected - for example, a Lexus and Toyota may share this part if they use the same engine/transmission platform. Include all confirmed vehicles from both the database and web search, across brands.'
  : 'This is a BODY/INTERIOR ELECTRONICS part (' + partType + '). Cross-brand fitment is NOT expected. A Lexus amplifier does NOT fit a Toyota even if they share a platform. An Acura radio does NOT fit a Honda. ONLY include vehicles that match the SAME BRAND as shown in the database. Ignore cross-brand results from web search entirely.'}
` : ''}
FORMATTING RULE: Never use em dashes (the long dash character) anywhere in the output. Use regular hyphens/dashes (-) only. This is a hard requirement.

SALE TYPE OVERRIDE: When the sale type is chrysler_programmed, combo_ign, combo_ign_bcm, or honda_key, do NOT include any "Programming Note:" bullet. DynaTrack provides the programming for these listings. The template already includes the correct buyer-facing language.

═══ SALE TYPE ═══
${saleTypeInstructions[saleType]}
${partName ? 'Part name hint: ' + partName : ''}
${donorInfo ? 'Donor vehicle: ' + donorInfo : ''}

OUTPUT only the completed listing - no preamble, no explanation:

${isChrysler ? chryslerTemplate : standardTemplate}`;

    document.getElementById('generateBtn').disabled = true;
    document.getElementById('thinking').classList.add('visible');
    document.getElementById('thinkingText').textContent = `Searching ${detectedCat ? detectedCat.name.split('/')[0] : 'RockAuto'} for ${partType === 'generic' ? 'part' : partType.toUpperCase()} fitment...`;
    document.getElementById('status').textContent = '';
    document.getElementById('outputCard').classList.remove('visible');

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await response.json();

      if (data.error) {
        document.getElementById('status').textContent = 'API error: ' + (data.error.message || 'Unknown error. Check your API key.');
        document.getElementById('generateBtn').disabled = false;
        document.getElementById('thinking').classList.remove('visible');
        return;
      }

      document.getElementById('thinkingText').textContent = 'Writing listing...';

      let finalText = '';

      if (data.stop_reason === 'tool_use') {
        const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
        const toolResults = toolUseBlocks.map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: 'Search completed - use the results already retrieved to write the listing now.'
        }));

        const followUp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1500,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            tool_choice: { type: 'none' },
            messages: [
              { role: 'user', content: prompt },
              { role: 'assistant', content: data.content },
              { role: 'user', content: toolResults }
            ]
          })
        });

        const followData = await followUp.json();
        finalText = followData.content?.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      } else {
        finalText = data.content?.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      }

      if (finalText) {
        const outputEl = document.getElementById('outputText');
        outputEl.innerHTML = '';

        // Extract TITLE: line and strip from body
        let titleValue = '';
        let bodyText = finalText;
        const titleMatch = finalText.match(/^TITLE:\s*(.+)/m);
        if (titleMatch) {
          titleValue = titleMatch[1].trim();
          bodyText = finalText.replace(/^TITLE:\s*.+\n?/m, '').replace(/^\n/, '');
        }
        const titleEl = document.getElementById('titleText');
        titleEl.textContent = titleValue;
        const charCount = titleValue.length;
        const countEl = document.getElementById('titleCharCount');
        countEl.textContent = charCount + ' / 80 characters';
        countEl.style.color = charCount > 80 ? '#b91c1c' : charCount > 70 ? '#b45309' : '#6b7280';

        const lines = bodyText.split('\n');
        let skipNext = false;
        lines.forEach((line, idx) => {
          if (skipNext) { skipNext = false; return; }
          const lineEl = document.createElement('div');
          lineEl.style.minHeight = '1.2em';

          if (line.includes('⚠️ VERIFY')) {
            lineEl.style.color = '#DC2626';
            lineEl.style.fontWeight = '600';
            lineEl.style.background = '#FEE2E2';
            lineEl.style.padding = '2px 6px';
            lineEl.style.borderRadius = '4px';
            lineEl.style.margin = '2px 0';
            lineEl.textContent = line;
          } else if (idx === 0 && line.trim() !== '') {
            // Title line - bold
            lineEl.style.fontWeight = '700';
            lineEl.style.fontSize = '17px';
            lineEl.textContent = line;
          } else if (line === 'About Dynatrack Racing' || line === 'About Dynatrack') {
            // Insert a visual divider before the About section
            const hr = document.createElement('hr');
            hr.style.cssText = 'border:none; border-top:2px solid #e5e7eb; margin:10px 0 8px 0;';
            outputEl.appendChild(hr);
            // Bold header + dash + next line description inline
            const nextLine = lines[idx + 1] || '';
            const bold = document.createElement('strong');
            bold.textContent = 'About Dynatrack Racing';
            lineEl.appendChild(bold);
            if (nextLine && !nextLine.startsWith('•')) {
              lineEl.appendChild(document.createTextNode(' - ' + nextLine));
              skipNext = true;
            }
          } else if (line === 'Item Specifics') {
            // Section headers - bold
            lineEl.style.fontWeight = '700';
            lineEl.textContent = line;
          } else if (line.startsWith('•')) {
            // Bullet lines - bold the label (text before first colon)
            const colonIdx = line.indexOf(':');
            if (colonIdx !== -1) {
              const label = line.substring(0, colonIdx + 1); // "• Part Number:"
              const value = line.substring(colonIdx + 1);    // " 91950-3W010"
              const bold = document.createElement('strong');
              bold.textContent = label;
              lineEl.appendChild(bold);
              lineEl.appendChild(document.createTextNode(value));
            } else {
              lineEl.textContent = line;
            }
          } else {
            lineEl.textContent = line;
          }

          outputEl.appendChild(lineEl);
        });

        const hasWarnings = finalText.includes('⚠️ VERIFY');
        document.getElementById('verifyBanner').style.display = hasWarnings ? 'flex' : 'none';
        document.getElementById('outputCard').classList.add('visible');
        document.getElementById('outputCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Fire-and-forget write-back to DarkHawk
        saveFitmentToDarkHawk();
      } else {
        document.getElementById('status').textContent = 'No response received. Please try again.';
      }

    } catch (err) {
      document.getElementById('status').textContent = 'Connection error. Check your internet and try again.';
    }

    document.getElementById('generateBtn').disabled = false;
    document.getElementById('thinking').classList.remove('visible');
  }

  function copyText() {
    const el = document.getElementById('outputText');
    const lines = Array.from(el.children).map(d => d.textContent);
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('copyBtn');
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy description';
        btn.classList.remove('copied');
      }, 2000);
    });
  }

  function copyTitle() {
    const text = document.getElementById('titleText').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('copyTitleBtn');
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy title';
        btn.classList.remove('copied');
      }, 2000);
    });
  }

  async function lookupFromEbay() {
    const url = document.getElementById('ebayRefUrl').value.trim();
    const statusEl = document.getElementById('lookupStatus');
    if (!url) { statusEl.innerHTML = '<span style="color:#b91c1c;">Paste an eBay URL first.</span>'; return; }
    if (!url.includes('ebay.com/itm/')) { statusEl.innerHTML = '<span style="color:#b91c1c;">Must be an eBay item URL (ebay.com/itm/...)</span>'; return; }

    statusEl.innerHTML = '<span style="color:var(--text-muted);">Fetching listing data...</span>';

    try {
      const res = await fetch(`${DARKHAWK_API}/api/listing-tool/ebay-lookup?url=${encodeURIComponent(url)}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Lookup failed');
      const r = json.data;

      // Part name from title
      if (r.title) document.getElementById('partName').value = extractPartNameFromTitle(r.title);

      // Part number
      if (r.partNumber && !document.getElementById('partNum').value) {
        document.getElementById('partNum').value = r.partNumber;
      }

      // Year/make/model from compatibility table or item specifics
      if (r.compatibility && r.compatibility.length > 0) {
        const first = r.compatibility[0];
        document.getElementById('donorYear').value = first.year || '';
        document.getElementById('donorVehicle').value = [first.make, first.model].filter(Boolean).join(' ');
        if (first.engine) document.getElementById('donorEngine').value = first.engine;
      } else if (r.title) {
        const yearMatch = r.title.match(/\b((?:19|20)\d{2})\b/);
        if (yearMatch) document.getElementById('donorYear').value = yearMatch[0];
      }

      // Donor vehicle from item specifics
      const specMake = r.itemSpecifics?.['Brand'] || '';
      const specModel = r.itemSpecifics?.['Fitment Type'] || '';
      const donorVehicle = r.itemSpecifics?.['Donor Vehicle'];
      if (donorVehicle && !document.getElementById('donorVehicle').value) {
        document.getElementById('donorVehicle').value = donorVehicle;
      }

      const sellerNote = r.seller ? ` (from ${r.seller}'s listing)` : '';
      document.getElementById('ebayRefRow').style.display = 'none';
      statusEl.innerHTML = `<span style="color:#15803d; font-weight:500;">✓ Fields populated from eBay listing${sellerNote} - verify before generating</span>`;

    } catch (err) {
      statusEl.innerHTML = `<span style="color:#b91c1c;">Failed: ${err.message} - fill in fields manually.</span>`;
    }
  }

  function extractPartNameFromTitle(title) {
    return title
      .replace(/\bOEM\b/gi, '')
      .replace(/\bNEW\b/gi, '')
      .replace(/\bGENUINE\b/gi, '')
      .replace(/\bTESTED\b/gi, '')
      .replace(/\bWORKING\b/gi, '')
      .replace(/\bPROGRAMMED\b/gi, '')
      .replace(/\bFAST SHIP\w*/gi, '')
      .replace(/\bFREE SHIP\w*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function clearOutput() {
    // Output card
    document.getElementById('outputCard').classList.remove('visible');
    document.getElementById('titleText').textContent = '';
    document.getElementById('titleCharCount').textContent = '';

    // Input fields
    document.getElementById('partNum').value = '';
    document.getElementById('partName').value = '';
    document.getElementById('donorYear').value = '';
    document.getElementById('donorVehicle').value = '';
    document.getElementById('donorEngine').value = '';
    document.getElementById('notes').value = '';
    document.getElementById('condition').selectedIndex = 0;
    document.getElementById('saleType').selectedIndex = 0;

    // Tested fields
    document.getElementById('testedSpeed').value = '';
    document.getElementById('testedMileage').value = '';
    document.getElementById('testedNotes').value = '';
    document.getElementById('testedFields').style.display = 'none';
    document.getElementById('testedNote').style.display = 'none';

    // Does NOT fit
    document.getElementById('doesNotFit').value = '';
    document.getElementById('doesNotFitField').style.display = 'none';

    // Programming note
    document.getElementById('programmingNote').value = '';
    document.getElementById('programmingNoteField').style.display = 'none';
    document.getElementById('programmingNoteSource').innerHTML = '';

    // DarkHawk Intelligence panel
    document.getElementById('intelPanel').style.display = 'none';
    document.getElementById('intelProgramming').style.display = 'none';
    document.getElementById('intelTrimTier').style.display = 'none';
    document.getElementById('intelFitment').style.display = 'none';
    document.getElementById('intelSales').style.display = 'none';
    lastIntelligence = null;

    // eBay reference row
    document.getElementById('ebayRefRow').style.display = 'none';
    document.getElementById('ebayRefUrl').value = '';

    // Status and lookup
    document.getElementById('status').textContent = '';
    document.getElementById('lookupStatus').innerHTML = '';

    // Sale type UI reset
    document.getElementById('chryslerNote').style.display = 'none';
    document.getElementById('comboNote').style.display = 'none';
    document.getElementById('hondaNote').style.display = 'none';

    // Focus back to part number
    document.getElementById('partNum').focus();
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') generate();
  });

  loadKey();

  // ── Programming DB ─────────────────────────────────────────
  let programmingDB = null;
  fetch(`${DARKHAWK_API}/admin/programming_db.json`)
    .then(r => r.json())
    .then(data => { programmingDB = data.rules || data; console.log('Programming DB loaded:', Object.keys(programmingDB).length, 'entries'); })
    .catch(() => { console.log('Programming DB not available'); });

  // ── DarkHawk Intelligence state ─────────────────────────────
  let lastIntelligence = null;

  async function fetchIntelligence(partNumber, year, make, model, engine, partType) {
    try {
      const params = new URLSearchParams({ partNumber });
      if (year) params.set('year', year);
      if (make) params.set('make', make);
      if (model) params.set('model', model);
      if (engine) params.set('engine', engine);
      if (partType) params.set('partType', partType);
      const res = await fetch(`${DARKHAWK_API}/api/listing-tool/intelligence?` + params.toString(), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.success) return null;
      lastIntelligence = data;
      return data;
    } catch (e) { return null; }
  }

  function renderIntelPanel(intel) {
    const panel = document.getElementById('intelPanel');
    if (!intel || (!intel.programming && !intel.trimTier && !intel.fitment && !intel.salesHistory)) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';

    // Programming
    const progEl = document.getElementById('intelProgramming');
    if (intel.programming) {
      const p = intel.programming;
      const badge = p.source === 'database'
        ? '<span style="background:#DCFCE7;color:#15803D;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;">FROM DATABASE</span>'
        : '<span style="background:#FEF3C7;color:#92400E;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;">FROM SEARCH</span>';
      const reqColor = p.programmingRequired === 'YES' ? '#B91C1C' : p.programmingRequired === 'NO' ? '#15803D' : '#B45309';
      progEl.innerHTML = badge + ' <strong style="color:' + reqColor + '">Programming: ' + p.programmingRequired + '</strong>' + (p.notes ? ' - ' + p.notes : '');
      progEl.style.display = 'block';

      // Auto-fill programming note from DB
      const progField = document.getElementById('programmingNoteField');
      const progInput = document.getElementById('programmingNote');
      const progSource = document.getElementById('programmingNoteSource');
      if (p.programmingRequired === 'YES') {
        progField.style.display = 'block';
        progInput.value = 'Requires VIN-specific programming. Professional installation recommended.';
        progSource.innerHTML = '<span style="color:#15803d; font-weight:500;">FROM DATABASE</span>'
          + (p.notes ? '<br><span style="font-size:11px; color:#6B7280;">Tech note: ' + p.notes + '</span>' : '');
      } else if (p.programmingRequired === 'NO') {
        progField.style.display = 'block';
        progInput.value = 'Direct replacement - no programming required.';
        progSource.innerHTML = '<span style="color:#15803d; font-weight:500;">FROM DATABASE</span>';
      } else if (p.programmingRequired === 'VERIFY') {
        progField.style.display = 'block';
        progInput.value = 'May require programming. Verify with your installer before purchase.';
        progSource.innerHTML = '<span style="color:#b45309; font-weight:500;">VERIFY</span>'
          + (p.notes ? '<br><span style="font-size:11px; color:#6B7280;">Tech note: ' + p.notes + '</span>' : '');
      }
    } else { progEl.style.display = 'none'; }

    // Trim tier
    const trimEl = document.getElementById('intelTrimTier');
    if (intel.trimTier) {
      const t = intel.trimTier;
      const tierColors = { PERFORMANCE: '#F97316', PREMIUM: '#EAB308', CHECK: '#6B7280', BASE: '#374151' };
      const tierColor = tierColors[t.tier] || '#6B7280';
      let html = '<span style="background:' + tierColor + ';color:#fff;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;">' + t.tier + '</span>';
      if (t.audioBrand) html += ' <strong>' + t.audioBrand + ' Audio</strong>';
      if (t.expectedParts) html += ' - Expected: ' + t.expectedParts;
      if (t.cultFlag) html += ' <span style="background:#D946EF;color:#fff;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;">CULT</span>';
      trimEl.innerHTML = html;
      trimEl.style.display = 'block';
    } else { trimEl.style.display = 'none'; }

    // Fitment
    const fitEl = document.getElementById('intelFitment');
    if (intel.fitment) {
      const f = intel.fitment;
      const src = intel.fitmentSource === 'cache' ? 'DarkHawk cache' : intel.fitmentSource === 'item_aic' ? 'DynaTrack database' : 'search';
      const vehicleCount = f.allVehicles ? f.allVehicles.length : 1;
      fitEl.innerHTML = '<span style="color:#15803D; font-weight:500;">Fitment found in ' + src + '</span>' + (vehicleCount > 1 ? ' (' + vehicleCount + ' vehicles)' : '');
      fitEl.style.display = 'block';
    } else { fitEl.style.display = 'none'; }

    // Sales
    const salesEl = document.getElementById('intelSales');
    if (intel.salesHistory) {
      const s = intel.salesHistory;
      const lastDate = s.lastSoldDate ? new Date(s.lastSoldDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      salesEl.innerHTML = 'Your Sales: ' + s.count + ' sold - Avg $' + s.avgPrice.toFixed(2) + (lastDate ? ' - Last sold ' + lastDate : '');
      salesEl.style.display = 'block';
    } else { salesEl.style.display = 'none'; }
  }

  function lookupProgramming(brand, year, moduleType) {
    if (!programmingDB) return { found: false };
    const typeMap = { 'ecu': 'ECM', 'bcm': 'BCM', 'tcm': 'TCM', 'tipm': 'TIPM', 'abs': 'ABS', 'radio': 'Radio', 'cluster': 'Cluster', 'idm': 'IDM' };
    const dbType = typeMap[moduleType] || moduleType.toUpperCase();
    // Brand normalization
    const brandMap = {
      'ford': 'Ford', 'toyota': 'Toyota', 'honda': 'Honda', 'dodge': 'Chrysler', 'chrysler': 'Chrysler',
      'jeep': 'Chrysler', 'ram': 'Chrysler', 'chevrolet': 'GM', 'gmc': 'GM', 'buick': 'GM', 'cadillac': 'GM',
      'pontiac': 'GM', 'saturn': 'GM', 'nissan': 'Nissan', 'infiniti': 'Nissan', 'bmw': 'BMW',
      'mercedes': 'Mercedes', 'mazda': 'Mazda', 'kia': 'Hyundai/Kia', 'hyundai': 'Hyundai/Kia',
      'subaru': 'Subaru', 'volkswagen': 'VW/Audi', 'audi': 'VW/Audi', 'volvo': 'Volvo',
      'lexus': 'Toyota', 'acura': 'Honda', 'lincoln': 'Ford', 'mercury': 'Ford',
    };
    const brandGroup = brandMap[(brand || '').toLowerCase()] || brand;
    const key = brandGroup + '|' + dbType + '|' + parseInt(year);
    const match = programmingDB[key];
    if (match) return { found: true, required: match.r, notes: match.n };
    return { found: false };
  }

  // ── DarkHawk fitment check (on part number blur) ─────────────
  async function checkDarkHawkFitment(partNumber) {
    if (!partNumber || partNumber.length < 5) return;
    try {
      const res = await fetch(`${DARKHAWK_API}/api/listing-tool/parts-lookup?partNumber=${encodeURIComponent(partNumber)}`);
      const json = await res.json();
      if (!json.success || !json.data) return;

      const statusEl = document.getElementById('lookupStatus');

      if (json.source === 'cache') {
        const d = json.data;
        if (d.part_name) document.getElementById('partName').value = d.part_name;
        if (d.year) document.getElementById('donorYear').value = d.year;
        if (d.make || d.model) document.getElementById('donorVehicle').value = [d.make, d.model].filter(Boolean).join(' ');
        if (d.engine) document.getElementById('donorEngine').value = d.engine;
        if (d.does_not_fit) {
          document.getElementById('doesNotFit').value = d.does_not_fit;
          document.getElementById('doesNotFitField').style.display = 'block';
        }
        if (d.programming_note) {
          document.getElementById('programmingNote').value = d.programming_note;
          document.getElementById('programmingNoteField').style.display = 'block';
          document.getElementById('programmingNoteSource').innerHTML = '<span style="color:#15803d; font-weight:500;">From DarkHawk cache (lister-confirmed)</span>';
        }
        statusEl.innerHTML = '<span style="color:#15803d; font-weight:500;">✓ Fitment loaded from DarkHawk - verify before generating</span>';
        return;
      }

      if (json.source === 'database' && json.data.compatibility?.length > 0) {
        const c = json.data.compatibility[0];
        if (c.year) document.getElementById('donorYear').value = c.year;
        if (c.make || c.model) document.getElementById('donorVehicle').value = [c.make, c.model].filter(Boolean).join(' ');
        if (c.engine) document.getElementById('donorEngine').value = c.engine;
        statusEl.innerHTML = '<span style="color:#15803d;">✓ Partial fitment from database - generate to save complete data</span>';
      }
    } catch (e) { /* DarkHawk unavailable - silent */ }
  }

  // ── Write fitment + intelligence back to DarkHawk (fire-and-forget after generate) ──
  async function saveFitmentToDarkHawk() {
    const partNumber = document.getElementById('partNum').value.trim();
    if (!partNumber || partNumber.length < 5) return;

    const vehicleStr = document.getElementById('donorVehicle').value.trim();
    const parts = vehicleStr.split(/\s+/);
    const make = parts[0] || '';
    const model = parts.slice(1).join(' ').split(' - ')[0].split(' (')[0].trim();
    if (!make) return;

    try {
      await fetch(`${DARKHAWK_API}/api/listing-tool/save-fitment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partNumber,
          partName: document.getElementById('partName').value.trim() || null,
          partType: detectPartType() || null,
          year: document.getElementById('donorYear').value.trim() || null,
          make, model: model || null,
          engine: document.getElementById('donorEngine').value.trim() || null,
          doesNotFit: document.getElementById('doesNotFit').value.trim() || null,
          programmingRequired: document.getElementById('programmingNote').value ? 'yes' : null,
          programmingNote: document.getElementById('programmingNote').value.trim() || null,
        }),
      });
    } catch (e) { /* non-blocking */ }

    // Also save via intelligence endpoint for richer data
    try {
      await fetch(`${DARKHAWK_API}/api/listing-tool/save-listing-intel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partNumber,
          partName: document.getElementById('partName').value.trim() || null,
          partType: detectPartType() || null,
          year: document.getElementById('donorYear').value.trim() || null,
          make, model: model || null,
          engine: document.getElementById('donorEngine').value.trim() || null,
          doesNotFit: document.getElementById('doesNotFit').value.trim() || null,
          programmingRequired: document.getElementById('programmingNote').value ? 'yes' : null,
          programmingNote: document.getElementById('programmingNote').value.trim() || null,
        }),
      });
    } catch (e) { /* non-blocking */ }
  }
</script>
</body>
</html>

```

## FILE: service/public/listing-tool.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dynatrack Racing - Listing Generator</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --red: #B91C1C;
    --red-dark: #7F1D1D;
    --red-light: #FEE2E2;
    --red-mid: #DC2626;
    --bg: #F9FAFB;
    --surface: #FFFFFF;
    --border: #E5E7EB;
    --border-strong: #D1D5DB;
    --text: #111827;
    --text-mid: #374151;
    --text-muted: #6B7280;
    --text-faint: #9CA3AF;
    --green: #15803D;
    --green-light: #DCFCE7;
    --radius: 10px;
    --radius-sm: 6px;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    padding: 0;
  }

  header {
    background: var(--red-dark);
    padding: 1rem 1.5rem;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .header-icon {
    width: 32px;
    height: 32px;
    background: rgba(255,255,255,0.15);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .header-icon svg { width: 18px; height: 18px; fill: white; }

  header h1 {
    font-size: 15px;
    font-weight: 600;
    color: white;
    letter-spacing: -0.01em;
  }

  header p {
    font-size: 12px;
    color: rgba(255,255,255,0.6);
    margin-top: 1px;
  }

  .container {
    max-width: 700px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    margin-bottom: 1.25rem;
  }

  .card-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 1rem;
  }

  .field-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 12px;
  }

  .field-row.two { grid-template-columns: 1fr 1fr; }
  .field-row.three { grid-template-columns: 1fr 1fr 1fr; }
  .field-row.solo { grid-template-columns: 1fr; }

  .field label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-mid);
    margin-bottom: 5px;
  }

  .field label .req {
    color: var(--red-mid);
    margin-left: 2px;
  }

  input[type="text"], select {
    width: 100%;
    padding: 8px 10px;
    font-size: 14px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
    appearance: none;
    -webkit-appearance: none;
  }

  input[type="text"]:focus, select:focus {
    border-color: var(--red-mid);
    box-shadow: 0 0 0 3px rgba(220,38,38,0.12);
  }

  input::placeholder { color: var(--text-faint); }

  select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236B7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 28px;
    cursor: pointer;
  }

  .divider {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1.25rem 0;
  }

  .generate-btn {
    width: 100%;
    padding: 11px;
    background: var(--red-dark);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
    letter-spacing: 0.01em;
  }

  .generate-btn:hover { background: var(--red-mid); }
  .generate-btn:disabled { opacity: 0.5; cursor: not-allowed; background: var(--red-dark); }

  .thinking {
    display: none;
    align-items: center;
    gap: 8px;
    padding: 10px 0 0;
    font-size: 13px;
    color: var(--text-muted);
  }

  .thinking.visible { display: flex; }

  .dots { display: flex; gap: 4px; }
  .dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    background: var(--text-faint);
    animation: blink 1.2s ease-in-out infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%,80%,100%{opacity:0.2} 40%{opacity:1} }

  .output-card { display: none; }
  .output-card.visible { display: block; }

  .output-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 10px;
  }

  .output-text {
    background: #F9FAFB;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1rem;
    font-size: 16px;
    line-height: 1.85;
    color: var(--text);
    white-space: pre-wrap;
    font-family: inherit;
  }

  .action-row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .action-btn {
    flex: 1;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 500;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text-mid);
    cursor: pointer;
    transition: background 0.12s;
  }

  .action-btn:hover { background: var(--bg); }

  .action-btn.copied {
    background: var(--green-light);
    border-color: #86EFAC;
    color: var(--green);
  }

  .status {
    font-size: 13px;
    color: var(--red-mid);
    margin-top: 8px;
    min-height: 18px;
  }

  .api-section {
    background: #FFFBEB;
    border: 1px solid #FDE68A;
    border-radius: var(--radius);
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.25rem;
  }

  .api-section h3 {
    font-size: 13px;
    font-weight: 600;
    color: #92400E;
    margin-bottom: 6px;
  }

  .api-section p {
    font-size: 13px;
    color: #78350F;
    line-height: 1.6;
    margin-bottom: 10px;
  }

  .api-section input {
    border-color: #FCD34D;
  }

  .api-section input:focus {
    border-color: #F59E0B;
    box-shadow: 0 0 0 3px rgba(245,158,11,0.15);
  }

  .api-key-row {
    display: flex;
    gap: 8px;
  }

  .api-key-row input { flex: 1; }

  .save-btn {
    padding: 8px 14px;
    background: #92400E;
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .save-btn:hover { background: #78350F; }

  .key-saved {
    display: none;
    font-size: 12px;
    color: var(--green);
    margin-top: 6px;
    align-items: center;
    gap: 4px;
  }

  .key-saved.visible { display: flex; }

  .info-box {
    background: #EFF6FF;
    border: 1px solid #BFDBFE;
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    font-size: 13px;
    color: #1E40AF;
    margin-bottom: 10px;
    line-height: 1.5;
  }

  footer {
    text-align: center;
    padding: 2rem;
    font-size: 12px;
    color: var(--text-faint);
  }

  @media (max-width: 500px) {
    .field-row.three { grid-template-columns: 1fr 1fr; }
    .container { padding: 1.25rem 1rem; }
  }
</style>
</head>
<body>

<header>
  <div class="header-icon">
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
    </svg>
  </div>
  <div>
    <h1>Dynatrack Racing</h1>
    <p>eBay Listing Description Generator</p>
  </div>
</header>

<div class="container">

  <div class="api-section" id="apiSection">
    <h3>One-time setup - Anthropic API key</h3>
    <p>This tool uses Claude AI to generate descriptions. Enter your Anthropic API key below. It's saved in your browser only and never sent anywhere except Anthropic's servers.</p>
    <div class="api-key-row">
      <input type="text" id="apiKeyInput" placeholder="sk-ant-api03-..." autocomplete="off" />
      <button class="save-btn" onclick="saveKey()">Save key</button>
    </div>
    <div class="key-saved" id="keySaved">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#15803D"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      API key saved
    </div>
  </div>

  <div class="card">
    <div class="card-title">Part information</div>
    <div class="field-row two">
      <div class="field">
        <label>OEM part number <span class="req">*</span></label>
        <div style="display:flex; gap:8px; align-items:center;">
          <input type="text" id="partNum" placeholder="e.g. 22030-65010" style="flex:1;" onblur="checkDarkHawkFitment(this.value)" />
          <button id="lookupBtn" onclick="lookupPartNumber()" title="Look up fitment by part number" style="white-space:nowrap; padding:8px 14px; font-size:12px; font-weight:600; border-radius:var(--radius-sm); border:none; background:var(--gold); color:#1a1a1a; cursor:pointer; transition:opacity 0.12s; flex-shrink:0;">
            🔍 Look up
          </button>
        </div>
        <div id="lookupStatus" style="font-size:11px; color:var(--text-muted); margin-top:5px; min-height:16px;"></div>
        <div id="ebayRefRow" style="display:none; margin-top:8px; display:none;">
          <div style="font-size:11px; color:#b45309; font-weight:500; margin-bottom:4px;">⚠ Lookup couldn't confirm fitment - paste a reference eBay listing URL to extract details:</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="text" id="ebayRefUrl" placeholder="https://www.ebay.com/itm/..." style="flex:1; font-size:12px;" />
            <button onclick="lookupFromEbay()" style="white-space:nowrap; padding:8px 12px; font-size:12px; font-weight:600; border-radius:var(--radius-sm); border:none; background:#1a5276; color:#fff; cursor:pointer; flex-shrink:0;">Use listing</button>
          </div>
        </div>
      </div>
      <div class="field">
        <label>Part name <span style="font-weight:400;color:var(--text-faint)">(auto-filled or enter manually)</span></label>
        <input type="text" id="partName" placeholder="e.g. Throttle Body" />
      </div>
    </div>
    <div class="field-row three">
      <div class="field">
        <label>Donor year</label>
        <input type="text" id="donorYear" placeholder="e.g. 1993" maxlength="4" />
      </div>
      <div class="field">
        <label>Donor make / model</label>
        <input type="text" id="donorVehicle" placeholder="e.g. Toyota 4Runner" />
      </div>
      <div class="field">
        <label>Engine</label>
        <input type="text" id="donorEngine" placeholder="e.g. 3.0L V6" />
      </div>
    </div>

    <div class="field" id="doesNotFitField" style="margin-top:12px; display:none;">
      <label style="color:#b91c1c; font-weight:600;">⚠ Does NOT fit <span style="font-weight:400; color:var(--text-faint)">(auto-filled by Look up - edit or clear if needed)</span></label>
      <input type="text" id="doesNotFit" placeholder="e.g. 2WD models, manual transmission" style="border-color:#fca5a5;" />
      <div style="font-size:11px; color:#b91c1c; margin-top:4px;">This will appear in the listing. Clear the field to omit it.</div>
    </div>

    <div class="field" id="partNumberWarningField" style="margin-top:12px; display:none;">
      <label style="color:#b45309; font-weight:600;">⚠ Part Number Match Required <span style="font-weight:400; color:var(--text-faint)">(auto-filled - edit if needed)</span></label>
      <input type="text" id="partNumberWarning" placeholder="" style="border-color:#fcd34d;" />
      <div style="font-size:11px; color:#b45309; margin-top:4px;" id="partNumberWarningSource"></div>
    </div>

    <hr class="divider">
    <div class="card-title">Sale type &amp; programming</div>

    <div class="field-row solo" style="margin-bottom:10px;">
      <div class="field">
        <label>What is being sold?</label>
        <select id="saleType" onchange="updateSaleUI()">
          <option value="part">Part only - standard listing</option>
          <option value="chrysler_programmed">Chrysler / Jeep / Dodge - programmed by Dynatrack (JTEC / NGC / GPEC)</option>
          <option value="combo_ign">ECU Combo - ECU + Ignition Switch (plug and play set)</option>
          <option value="combo_ign_bcm">ECU Combo - ECU + Ignition Switch + BCM (full plug and play set)</option>
          <option value="honda_key">Honda ECU + Immobilizer + Key blank (plug and play)</option>
          <option value="needs_programming">Computer - requires buyer programming (not serviced by Dynatrack)</option>
          <option value="tested">Tested item - include test results in listing and title</option>
        </select>
      </div>
    </div>

    <div id="chryslerNote" class="info-box" style="display:none;">
      <strong>Chrysler programmed unit.</strong> The AI will note this is programmed by Dynatrack and plug and play for the listed vehicle. Confirm the donor year/make/model/engine above matches the programmed VIN.
    </div>

    <div id="comboNote" class="info-box" style="display:none;">
      <strong>Combo set.</strong> The AI will list all included components and explain that the set must be installed together for plug and play operation.
    </div>

    <div id="hondaNote" class="info-box" style="display:none;">
      <strong>Honda plug and play set.</strong> The AI will explain the immobilizer/key blank setup and that the key must be cut to the buyer's vehicle.
    </div>

    <div id="testedNote" class="info-box" style="display:none;">
      <strong>Tested item.</strong> Test results will be included in the listing description and title automatically.
    </div>
    <div id="testedFields" style="display:none; margin-top:10px;">
      <div class="field-row two">
        <div class="field">
          <label>Tested speed (MPH) <span style="font-weight:400;color:var(--text-faint)">(clusters)</span></label>
          <input type="text" id="testedSpeed" placeholder="e.g. 120" />
        </div>
        <div class="field">
          <label>Mileage at test <span style="font-weight:400;color:var(--text-faint)">(e.g. 105K)</span></label>
          <input type="text" id="testedMileage" placeholder="e.g. 105K" />
        </div>
      </div>
      <div class="field" style="margin-top:8px;">
        <label>Test notes <span style="font-weight:400;color:var(--text-faint)">(optional - e.g. all gauges functional, no warning lights)</span></label>
        <input type="text" id="testedNotes" placeholder="e.g. All gauges functional, no warning lights" />
      </div>
    </div>

    <hr class="divider">
    <div class="card-title">Condition</div>

    <div class="field-row two">
      <div class="field">
        <label>Visual condition</label>
        <select id="condition">
          <option value="good">Good - no visible damage</option>
          <option value="minor">Minor cosmetic wear</option>
          <option value="damage">Damage noted</option>
        </select>
      </div>
      <div class="field">
        <label>Damage / notes <span style="font-weight:400;color:var(--text-faint)">(if any)</span></label>
        <input type="text" id="notes" placeholder="e.g. cracked bracket" />
      </div>
    </div>

    <div class="field" id="programmingNoteField" style="margin-top:12px; display:none;">
      <label>Programming note <span style="font-weight:400;color:var(--text-faint)">(auto-filled by Look up - edit if needed)</span></label>
      <input type="text" id="programmingNote" placeholder="e.g. Direct replacement - no programming required." />
      <div style="font-size:11px; color:var(--text-muted); margin-top:4px;" id="programmingNoteSource"></div>
    </div>

    <button class="generate-btn" id="generateBtn" onclick="generate()">Generate listing description</button>

    <div class="thinking" id="thinking">
      <div class="dots">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
      <span id="thinkingText">Researching part number...</span>
    </div>
    <div class="status" id="status"></div>
  </div>

  <div class="card output-card" id="outputCard">
    <div id="verifyBanner" style="display:none; align-items:flex-start; gap:10px; background:#FEF2F2; border:1px solid #FECACA; border-radius:6px; padding:10px 12px; margin-bottom:12px;">
      <span style="font-size:16px; line-height:1;">⚠️</span>
      <div>
        <div style="font-size:13px; font-weight:600; color:#991B1B; margin-bottom:2px;">Fields require verification before publishing</div>
        <div style="font-size:12px; color:#B91C1C;">Lines marked in red could not be confirmed across multiple sources. Research those fields before this listing goes live.</div>
      </div>
    </div>
    <div class="output-label">eBay listing title - copy and paste into the title field</div>
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:18px;">
      <div id="titleText" style="flex:1; font-size:15px; font-weight:600; background:var(--bg); border:1.5px solid var(--border); border-radius:6px; padding:10px 12px; min-height:2.4em; line-height:1.4; word-break:break-word;"></div>
      <button class="action-btn" id="copyTitleBtn" onclick="copyTitle()" style="white-space:nowrap; flex-shrink:0;">Copy title</button>
    </div>
    <div style="font-size:11px; color:var(--text-muted); margin-top:-12px; margin-bottom:16px;" id="titleCharCount"></div>
    <div class="output-label">Generated description - review, then copy and paste into eBay</div>
    <div class="output-text" id="outputText"></div>
    <div class="action-row">
      <button class="action-btn" id="copyBtn" onclick="copyText()">Copy description</button>
      <button class="action-btn" onclick="clearOutput()">Clear and start over</button>
    </div>
  </div>

</div>

<footer>Dynatrack Racing internal tool &nbsp;·&nbsp; Powered by Claude AI</footer>

<script>
  const API_KEY_STORAGE = 'dt_anthropic_key';

  const PROGRAMMED_SALE_TYPES = ['chrysler_programmed', 'combo_ign', 'combo_ign_bcm', 'honda_key'];

  function updateSaleUI() {
    const val = document.getElementById('saleType').value;
    document.getElementById('chryslerNote').style.display = val === 'chrysler_programmed' ? 'block' : 'none';
    document.getElementById('comboNote').style.display = (val === 'combo_ign' || val === 'combo_ign_bcm') ? 'block' : 'none';
    document.getElementById('hondaNote').style.display = val === 'honda_key' ? 'block' : 'none';
    document.getElementById('testedNote').style.display = val === 'tested' ? 'block' : 'none';
    document.getElementById('testedFields').style.display = val === 'tested' ? 'block' : 'none';

    // Hide programming note for pre-programmed sale types - DynaTrack provides programming
    if (PROGRAMMED_SALE_TYPES.includes(val)) {
      document.getElementById('programmingNoteField').style.display = 'none';
      document.getElementById('programmingNote').value = '';
    }
  }

  // ── OEM Catalog lookup ───────────────────────────────────────────
  const catalogs = [
    {
      name: 'Mopar (Chrysler/Jeep/Dodge/Ram)',
      color: '#7F1D1D',
      detect: p => /^(04|05|0[0-9][0-9][0-9][0-9][0-9][0-9][0-9])/i.test(p) || /^[0-9]{8}[A-Z]{2}$/i.test(p),
      url: p => `https://store.mopar.com/search#q=${encodeURIComponent(p)}&t=All`,
      hint: 'Mopar eStore - official Chrysler/Jeep/Dodge/Ram catalog'
    },
    {
      name: 'Toyota / Lexus',
      color: '#1E3A5F',
      detect: p => /^\d{5}-\d{5}$/i.test(p) || /^\d{8}$/i.test(p) && /^9/.test(p),
      url: p => `https://parts.toyota.com/search?q=${encodeURIComponent(p)}`,
      hint: 'Toyota Parts - official OEM catalog'
    },
    {
      name: 'Ford / Lincoln / Motorcraft',
      color: '#003087',
      detect: p => /^[A-Z]{1,3}[0-9]{1,2}[A-Z]-/i.test(p) || /^[0-9][A-Z][0-9]{1,2}[A-Z]-/i.test(p) || /^[A-Z]{2}[0-9]{2}-/i.test(p),
      url: p => `https://www.fordparts.com/en/search?searchterm=${encodeURIComponent(p)}`,
      hint: 'Ford Parts - official OEM catalog'
    },
    {
      name: 'GM / Chevy / GMC / Buick / Cadillac',
      color: '#003087',
      detect: p => /^\d{8}$/.test(p) && !/^9/.test(p) || /^\d{5}[A-Z]{2}$/.test(p),
      url: p => `https://www.gmpartsdirect.com/search?q=${encodeURIComponent(p)}`,
      hint: 'GM Parts Direct - official GM catalog'
    },
    {
      name: 'Honda / Acura',
      color: '#CC0000',
      detect: p => /^\d{5}-[A-Z0-9]{3,5}-[A-Z0-9]{2,4}$/i.test(p),
      url: p => `https://parts.honda.com/#/parts/search?q=${encodeURIComponent(p)}`,
      hint: 'Honda Parts - official OEM catalog'
    },
    {
      name: 'Nissan / Infiniti',
      color: '#C3002F',
      detect: p => /^\d{5}-[A-Z0-9]{5}$/i.test(p) || /^[A-Z]{2}\d{3}-[A-Z0-9]{5}$/i.test(p),
      url: p => `https://www.nissanparts.cc/search?keywords=${encodeURIComponent(p)}`,
      hint: 'Nissan Parts - OEM catalog'
    },
    {
      name: 'BMW',
      color: '#1C69D4',
      detect: p => /^\d{2}\s?\d{2}\s?\d{1,2}\s?\d{3}\s?\d{3}$/i.test(p.replace(/[-\s]/g,'')),
      url: p => `https://www.realoem.com/bmw/enUS/showparts?q=${encodeURIComponent(p)}`,
      hint: 'RealOEM - BMW parts catalog'
    },
    {
      name: 'Mercedes-Benz',
      color: '#222222',
      detect: p => /^[A-Z]\s?\d{3}\s?\d{3}\s?\d{2,3}\s?\d{2,3}$/i.test(p.replace(/[-\s]/g,'')),
      url: p => `https://www.mbusa.com/en/owner/parts?partNumber=${encodeURIComponent(p)}`,
      hint: 'Mercedes-Benz - OEM parts'
    },
    {
      name: 'Subaru',
      color: '#003087',
      detect: p => /^\d{5}[A-Z]{2}\d{3}$/i.test(p) || /^\d{4}[A-Z]\d{4}$/i.test(p),
      url: p => `https://parts.subaru.com/search?q=${encodeURIComponent(p)}`,
      hint: 'Subaru Parts - official OEM catalog'
    },
    {
      name: 'Hyundai',
      color: '#002C5F',
      detect: p => /^\d{5}-[A-Z0-9]{5}$/i.test(p) && /^[^9]/.test(p),
      url: p => `https://www.hyundaipartsdeal.com/genuine/hyundai-${p.toLowerCase()}.html`,
      hint: 'Hyundai Parts Deal - OEM catalog'
    },
    {
      name: 'Kia',
      color: '#BB162B',
      detect: p => /^\d{5}-[A-Z0-9]{5}$/i.test(p) && /^[9]/.test(p),
      url: p => `https://www.kiapartsnow.com/genuine/kia-${p.toLowerCase()}.html`,
      hint: 'Kia Parts Now - OEM catalog'
    }
  ];

  // Fallback: RockAuto search works for almost everything
  const rockAutoUrl = p => `https://www.rockauto.com/en/partsearch/?romsite=1&q=${encodeURIComponent(p)}`;

  function detectCatalog(partNum) {
    const p = (partNum || '').trim();
    if (!p) return null;
    // Also check donor vehicle for make hints
    const donor = (document.getElementById('donorVehicle')?.value || '').toLowerCase();
    if (donor.includes('jeep') || donor.includes('dodge') || donor.includes('chrysler') || donor.includes('ram')) {
      return catalogs[0]; // Mopar
    }
    if (donor.includes('toyota') || donor.includes('lexus') || donor.includes('4runner') || donor.includes('tacoma') || donor.includes('tundra')) {
      return catalogs[1]; // Toyota
    }
    if (donor.includes('ford') || donor.includes('lincoln') || donor.includes('mustang') || donor.includes('f-150') || donor.includes('f150') || donor.includes('explorer')) {
      return catalogs[2]; // Ford
    }
    if (donor.includes('chevy') || donor.includes('chevrolet') || donor.includes('gmc') || donor.includes('buick') || donor.includes('cadillac') || donor.includes('silverado')) {
      return catalogs[3]; // GM
    }
    if (donor.includes('honda') || donor.includes('acura')) return catalogs[4];
    if (donor.includes('nissan') || donor.includes('infiniti')) return catalogs[5];
    if (donor.includes('bmw')) return catalogs[6];
    if (donor.includes('mercedes') || donor.includes('benz')) return catalogs[7];
    if (donor.includes('subaru')) return catalogs[8];
    if (donor.includes('hyundai')) return catalogs[9];
    if (donor.includes('kia')) return catalogs[10];
    // Fall back to part number pattern detection
    for (const cat of catalogs) {
      if (cat.detect(p)) return cat;
    }
    return null; // Will use RockAuto
  }

  async function lookupPartNumber() {
    const partNum = document.getElementById('partNum').value.trim();
    const apiKey = localStorage.getItem('dt_anthropic_key') || document.getElementById('apiKeyInput').value.trim();
    const statusEl = document.getElementById('lookupStatus');
    const btn = document.getElementById('lookupBtn');

    if (!partNum) {
      statusEl.innerHTML = '<span style="color:#b91c1c;">Enter a part number first.</span>';
      return;
    }
    if (!apiKey) {
      statusEl.innerHTML = '<span style="color:#b91c1c;">Save your API key first.</span>';
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ Looking up...';
    statusEl.innerHTML = '<span style="color:var(--text-muted);">Checking DarkHawk fitment database...</span>';

    // ── STEP 0: Check DarkHawk fitment intelligence (free, instant) ───
    try {
      const fitmentUrl = `/api/fitment/lookup?partNumber=${encodeURIComponent(partNum)}`;
      const fitmentRes = await fetch(fitmentUrl, { signal: AbortSignal.timeout(5000) });
      if (fitmentRes.ok) {
        const fitment = await fitmentRes.json();
        if (fitment && fitment.confidence && fitment.confidence !== 'none') {
          // Auto-populate doesNotFit from DarkHawk
          const doesNotFitField = document.getElementById('doesNotFitField');
          const doesNotFitInput = document.getElementById('doesNotFit');
          if (fitment.negationText) {
            doesNotFitField.style.display = 'block';
            doesNotFitInput.value = fitment.negationText;
          }
          // Auto-populate part number warning
          const pnWarnField = document.getElementById('partNumberWarningField');
          const pnWarnInput = document.getElementById('partNumberWarning');
          const pnWarnSource = document.getElementById('partNumberWarningSource');
          if (fitment.partNumberWarning) {
            pnWarnField.style.display = 'block';
            pnWarnInput.value = fitment.partNumberWarning;
            pnWarnSource.innerHTML = '<span style="color:#15803d; font-weight:500;">✓ From DarkHawk fitment intelligence</span>';
          } else {
            pnWarnField.style.display = 'none';
            pnWarnInput.value = '';
          }
          // If high confidence, populate vehicle fields too and skip Claude
          if (fitment.confidence === 'high' && fitment.fits) {
            const engines = fitment.fits.engines || [];
            const trims = fitment.fits.trims || [];
            if (engines.length) document.getElementById('donorEngine').value = engines.join(', ');
            statusEl.innerHTML = '<span style="color:#15803d; font-weight:500;">✓ Fitment loaded from DarkHawk - high confidence</span>';
            btn.disabled = false;
            btn.textContent = '🔍 Look up';
            return; // Skip Claude web search entirely
          }
          // Medium confidence - continue to Claude for full lookup but keep DarkHawk data
          statusEl.innerHTML = '<span style="color:var(--text-muted);">DarkHawk data found - verifying with web search...</span>';
        }
      }
    } catch (e) {
      // DarkHawk unavailable - fall through silently to Claude web search
    }

    statusEl.innerHTML = '<span style="color:var(--text-muted);">Identifying part...</span>';

    // Helper: run one agentic search loop, return parsed JSON or null
    async function runAgentic(userMsg, headers, statusText) {
      statusEl.innerHTML = `<span style="color:var(--text-muted);">${statusText}</span>`;
      let messages = [userMsg];
      let fullText = '';

      const deadline = Date.now() + 18000; // 18 second hard timeout per step
      for (let i = 0; i < 1; i++) { // single search only - keeps token usage low
        if (Date.now() > deadline) break;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), deadline - Date.now());
        let res, data;
        try {
          res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 400,
              tools: [{ type: 'web_search_20250305', name: 'web_search' }],
              messages
            })
          });
          data = await res.json();
        } catch (fetchErr) {
          break; // timeout or network - exit loop with whatever we have
        } finally {
          clearTimeout(timer);
        }
        if (data.error) throw new Error(data.error.message);

        const texts = data.content.filter(b => b.type === 'text').map(b => b.text);
        if (texts.length) fullText += texts.join('');
        if (data.stop_reason !== 'tool_use') break;

        const toolResults = data.content
          .filter(b => b.type === 'tool_use')
          .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: b.input ? JSON.stringify(b.input) : 'done' }));
        messages = [...messages, { role: 'assistant', content: data.content }, { role: 'user', content: toolResults }];
      }

      // If no text yet, force a final no-tools call
      if (!fullText.trim()) {
        const finalRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            messages: [...messages, { role: 'user', content: 'Return the JSON now based on your search results. Use null for unknown fields.' }]
          })
        });
        const fd = await finalRes.json();
        if (!fd.error) fullText = fd.content.filter(b => b.type === 'text').map(b => b.text).join('');
      }

      // Parse JSON from response
      const cleaned = fullText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const matches = [...cleaned.matchAll(/\{[\s\S]*\}/g)];
      if (!matches.length) return null;
      const raw = matches[matches.length - 1][0];
      try {
        return JSON.parse(raw);
      } catch {
        const fixed = raw.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/:\s*undefined/g, ': null');
        return JSON.parse(fixed);
      }
    }

    try {
      const apiHeaders = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      };

      const searchPartNum = partNum.replace(/-[A-Z]{2}$/, '') || partNum;

      // ── STEP 1: Identify the part ───────────────────────────────────
      const step1 = await runAgentic({
        role: 'user',
        content: `Search the web for OEM part number "${partNum}" or "${searchPartNum}".

Your ONLY job: confirm what this part is and what vehicle it fits.

Rules:
- Use the part name exactly as shown in search results. Do NOT guess from the part number pattern.
- North American vehicles only (US/Canada sold). Use Ford Escape not Ford Kuga. Use Chevy not Holden.
- If results are ambiguous or part not found, set confidence to "low" and use null for unknown fields.

For the "category" field, pick exactly one word from this list based on what the part is:
ECU (engine control module/PCM/ECM), BCM (body control module), TCM (transmission control module),
TIPM (totally integrated power module/fuse box/junction box), ABS (ABS module/pump),
CLUSTER (instrument cluster/gauge cluster), RADIO (radio/head unit/infotainment),
THROTTLE (throttle body), MECHANICAL (mechanical part with no electronics), OTHER (anything else)

Return ONLY valid JSON - no markdown, no explanation:
{
  "partName": null,
  "category": null,
  "year": null,
  "make": null,
  "model": null,
  "confidence": null
}
Replace null with confirmed values.`
      }, apiHeaders, 'Identifying part...');

      if (!step1 || !step1.partName || step1.confidence === 'low') {
        statusEl.innerHTML = '';
        document.getElementById('ebayRefRow').style.display = 'block';
        btn.disabled = false;
        btn.textContent = '🔍 Look up';
        return;
      }

      const category = (step1.category || 'OTHER').toUpperCase();
      const needsProgrammingResearch = ['ECU','BCM','TCM','TIPM','ABS','CLUSTER','RADIO'].includes(category);
      const needsIncompatibilityResearch = ['ECU','BCM','TCM','TIPM','ABS','CLUSTER','RADIO','THROTTLE'].includes(category);

      // Small delay between steps to avoid token rate limit burst
      await new Promise(r => setTimeout(r, 600));

      // ── STEP 2: Research fitment specifics ─────────────────────────
      const categoryInstructions = {
        ECU:       'Confirm exact engine size and transmission type. Research what engine/transmission configs it does NOT fit.',
        BCM:       'Confirm trim level. Research which trims it does NOT fit.',
        TCM:       'Confirm exact transmission type/code. Research what it does NOT fit.',
        TIPM:      'Confirm exact year/model. Research any year or sub-model exclusions.',
        ABS:       'CRITICAL: Is this 2WD/FWD or AWD/4WD specific? ABS modules almost always differ by drivetrain. Confirm which drivetrain it fits and which it does NOT fit. For ABS modules: Research whether this specific ABS unit requires any programming, calibration, or initialization after installation. Many 2015+ ABS modules require dealer calibration. Be specific - do not guess.',
        CLUSTER:   'Confirm trim and display type. Research exclusions. Does this German vehicle cluster require coding?',
        RADIO:     'Confirm trim and option package. Research which packages it does NOT fit.',
        THROTTLE:  'Confirm exact engine size/code. Research what engines it does NOT fit.',
        MECHANICAL:'Confirm year/make/model. Note any relevant exclusions.',
        OTHER:     'Confirm year/make/model fitment range.'
      };

      const progJsonFields = needsProgrammingResearch
        ? `"programmingRequired": "yes or no or unknown",
  "programmingNote": "one definitive sentence, or null if unknown"`
        : `"programmingRequired": null,
  "programmingNote": null`;

      const step2 = await runAgentic({
        role: 'user',
        content: `Part confirmed: "${step1.partName}" - Category: ${category}
Vehicle: ${step1.year} ${step1.make} ${step1.model}
Part number: ${partNum}

Task: ${categoryInstructions[category] || categoryInstructions.OTHER}
${needsProgrammingResearch ? 'Also confirm: Does this specific part require programming to the vehicle, or is it plug-and-play? Search for a definitive answer - do not guess.' : ''}

Rules: North American market only. Only report confirmed facts from search results. Use JSON null (not the string "null") for anything not confirmed.

Return ONLY valid JSON - no markdown fences, no explanation:
{
  "engine": null,
  "drivetrain": null,
  "trim": null,
  "doesNotFit": null,
  ${progJsonFields}
}
Replace null values with confirmed data where found. Keep null where unconfirmed.`
      }, apiHeaders, 'Researching fitment details...');

      // ── Populate fields ─────────────────────────────────────────────
      document.getElementById('partName').value = step1.partName;
      if (step1.year) document.getElementById('donorYear').value = String(step1.year).split('-')[0];

      let vehicleStr = [step1.make, step1.model].filter(Boolean).join(' ');
      if (step2?.drivetrain && step2.drivetrain !== 'All Drivetrains') vehicleStr += ` - ${step2.drivetrain}`;
      if (step2?.trim) vehicleStr += ` (${step2.trim})`;
      if (vehicleStr) document.getElementById('donorVehicle').value = vehicleStr;
      if (step2?.engine) document.getElementById('donorEngine').value = step2.engine;

      // Does NOT fit
      const doesNotFitField = document.getElementById('doesNotFitField');
      const doesNotFitInput = document.getElementById('doesNotFit');
      if (step2?.doesNotFit) {
        doesNotFitField.style.display = 'block';
        doesNotFitInput.value = step2.doesNotFit;
      } else {
        doesNotFitField.style.display = 'none';
        doesNotFitInput.value = '';
      }

      // Programming note - skip entirely for pre-programmed sale types
      const currentSaleType = document.getElementById('saleType').value;
      const skipProgramming = PROGRAMMED_SALE_TYPES.includes(currentSaleType);

      // Priority: 1) skip if pre-programmed 2) programming_db.json 3) Claude research 4) ABS default
      const progField = document.getElementById('programmingNoteField');
      const progInput = document.getElementById('programmingNote');
      const progSource = document.getElementById('programmingNoteSource');

      if (skipProgramming) {
        // Pre-programmed sale type - DynaTrack provides programming, hide field
        progField.style.display = 'none';
        progInput.value = '';
      } else if (needsProgrammingResearch) {
        // Priority 1: Check programming_db.json
        const make = step1.make || '';
        const year = step1.year || '';
        const dbLookup = lookupProgramming(make, year, category.toLowerCase());

        if (dbLookup.found) {
          progField.style.display = 'block';
          progInput.value = dbLookup.notes;
          const isRequired = dbLookup.required === 'YES' || dbLookup.required === 'VERIFY';
          const color = dbLookup.required === 'YES' ? '#b91c1c' : dbLookup.required === 'VERIFY' ? '#b45309' : '#15803d';
          const label = dbLookup.required === 'YES' ? '⚠ Programming required' : dbLookup.required === 'VERIFY' ? '⚠ Verify programming' : '✓ No programming required';
          progSource.innerHTML = `<span style="color:${color}; font-weight:500;">${label} - from programming database</span>`;
        } else if (step2?.programmingNote && step2?.programmingRequired !== 'unknown') {
          // Priority 2: Claude research result
          progField.style.display = 'block';
          progInput.value = step2.programmingNote;
          const isYes = step2.programmingRequired === 'yes';
          progSource.innerHTML = `<span style="color:${isYes ? '#b45309' : '#15803d'}; font-weight:500;">${isYes ? '⚠ Programming required - confirmed by search' : '✓ No programming required - confirmed by search'}</span>`;
        } else if (category === 'ABS') {
          // Priority 3: ABS default when no data
          progField.style.display = 'block';
          progInput.value = 'May require ABS module initialization or calibration after installation. Consult a qualified technician.';
          progSource.innerHTML = '<span style="color:#b45309; font-weight:500;">⚠ ABS programming unknown - using default caution</span>';
        } else {
          progField.style.display = 'none';
          progInput.value = '';
        }
      } else {
        // Non-programmable part types - hide programming note entirely
        progField.style.display = 'none';
        progInput.value = '';
      }

      // Confidence indicator
      document.getElementById('ebayRefRow').style.display = 'none';
      document.getElementById('ebayRefUrl').value = '';
      const conf = step1.confidence;
      const confColor = conf === 'high' ? '#15803d' : conf === 'medium' ? '#b45309' : '#b91c1c';
      const confText = conf === 'high' ? '✓ Fitment confirmed' : conf === 'medium' ? '⚠ Verify fitment before listing' : '✗ Could not confirm - fill in manually';
      statusEl.innerHTML = `<span style="color:${confColor}; font-weight:500;">${confText}</span>`;

    } catch (err) {
      statusEl.innerHTML = `<span style="color:#b91c1c;">Lookup failed: ${err.message}</span>`;
      document.getElementById('ebayRefRow').style.display = 'block';
      console.error(err);
    }

    btn.disabled = false;
    btn.textContent = '🔍 Look up';
  }

  function loadKey() {
    const key = localStorage.getItem(API_KEY_STORAGE);
    if (key) {
      document.getElementById('apiKeyInput').value = key;
      document.getElementById('keySaved').classList.add('visible');
    }
  }

  function saveKey() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) return;
    localStorage.setItem(API_KEY_STORAGE, key);
    document.getElementById('keySaved').classList.add('visible');
    document.getElementById('status').textContent = '';
  }

  function getKey() {
    return localStorage.getItem(API_KEY_STORAGE) || document.getElementById('apiKeyInput').value.trim();
  }

  async function generate() {
    const apiKey = getKey();
    if (!apiKey) {
      document.getElementById('status').textContent = 'Please enter your Anthropic API key above first.';
      document.getElementById('apiKeyInput').focus();
      return;
    }

    const partNum = document.getElementById('partNum').value.trim();
    if (!partNum) {
      document.getElementById('status').textContent = 'Part number is required.';
      document.getElementById('partNum').focus();
      return;
    }

    const partName = document.getElementById('partName').value.trim();
    const donorYear = document.getElementById('donorYear').value.trim();
    const donorVehicle = document.getElementById('donorVehicle').value.trim();
    const donorEngine = document.getElementById('donorEngine').value.trim();
    const condition = document.getElementById('condition').value;
    const notes = document.getElementById('notes').value.trim();
    const donorInfo = [donorYear, donorVehicle, donorEngine].filter(Boolean).join(' ');
    const saleType = document.getElementById('saleType').value;
    const isChrysler = saleType === 'chrysler_programmed';
    const isTested = saleType === 'tested';
    const testedSpeed = document.getElementById('testedSpeed').value.trim();
    const testedMileage = document.getElementById('testedMileage').value.trim();
    const testedNotes = document.getElementById('testedNotes').value.trim();
    const testedSuffix = [testedSpeed ? `Tested ${testedSpeed}MPH` : '', testedMileage ? testedMileage : '', testedNotes].filter(Boolean).join(' - ');

    const conditionLine = condition === 'good'
      ? 'Cleaned and visually inspected. Removed from a running donor vehicle.'
      : condition === 'minor'
      ? 'Cleaned and visually inspected. Minor cosmetic wear consistent with normal use. Removed from a running donor vehicle.'
      : `Cleaned and visually inspected. Damage noted${notes ? ': ' + notes : ''}. Removed from a running donor vehicle.`;

    const saleTypeInstructions = {
      part: `Standard used part. Programming Note: if ECU/ECM/BCM/TCM or programmable module write "May require VIN-specific programming. Professional installation recommended." For non-programmable parts write "Direct replacement - no programming required."`,
      chrysler_programmed: `Chrysler/Jeep/Dodge ECM/PCM programmed by Dynatrack Racing (JTEC, NGC, GPEC only - no diesel/Cummins). Use Chrysler template.`,
      combo_ign: `ECU + Ignition Switch plug and play set. Part name: "[MAKE] ECU + IGNITION SWITCH COMBO - PLUG AND PLAY SET". Add: "• What's Included: ECU/ECM + Matching Ignition Switch". Programming Note: "Plug and play set - must be installed together. No additional programming required."`,
      combo_ign_bcm: `ECU + Ignition Switch + BCM full set. Part name: "[MAKE] ECU + IGNITION SWITCH + BCM COMBO - PLUG AND PLAY SET". Add: "• What's Included: ECU/ECM + Matching Ignition Switch + Body Control Module (BCM)". Programming Note: "Plug and play set - all three components must be installed together. No additional programming required."`,
      honda_key: `Honda ECU + immobilizer + key blank set. Part name: "HONDA ECU + IMMOBILIZER + KEY BLANK - PLUG AND PLAY SET". Add: "• What's Included: Honda ECU + Immobilizer Unit + Key Blank(s)". Programming Note: "Plug and play set - key blank must be cut to buyer's ignition. No dealer programming required once key is cut and full set is installed."`,
      needs_programming: `Computer requiring buyer programming - Dynatrack does NOT program this. Programming Note: "Requires VIN-specific programming before use. Not included - take to dealer or qualified shop after purchase."`,
      tested: `This item has been tested and confirmed working. Include a "• Tested:" bullet in Item Specifics after the Fits line with the test results. Keep it factual and concise e.g. "Tested: All gauges functional - 120MPH - 105K miles" or "Tested: Unit powers on, all functions verified". Do not use Programming Note for tested items unless the part separately requires programming.`
    };

    const chryslerTemplate = `Programmed ECU ECM PCM [YEAR RANGE] [MAKE] [MODEL] [ENGINE]

Item Specifics
• Part Number: ${partNum}
• Fits: [year range make model engine/trim - confirmed fitment only]
[DOES NOT FIT LINE - only if exclusions are explicitly confirmed from search results, otherwise omit entirely]
[PART NUMBER WARNING LINE - only if part number warning is provided above, otherwise omit entirely]
• Condition: Inspected for Damage
• Shipping: Ships within 1 Business Day (North Carolina, USA). Hawaii/Alaska residents - please message for a quote prior to purchase.

CUSTOM PROGRAMMING INCLUDED - To ensure a seamless "Plug & Play" experience, we require your VIN and Mileage during checkout.
Note: Providing this info immediately prevents shipping delays and ensures 100% compatibility with your vehicle.


About Dynatrack Racing
We are dismantlers based in North Carolina, specializing in high-quality OEM components.
• Support: Available Mon-Fri for any questions.
• Returns: 30-Day Hassle-Free.`;

    const standardTemplate = `[PART NAME IN ALL CAPS - e.g. Kia Sportage 2010-2014 Fuse Box Junction Relay Interior OEM]

Item Specifics
• Part Number: ${partNum}
• Fits: [year range make model - confirmed fitment only, e.g. 2010-2014 Kia Sportage]
[DOES NOT FIT LINE - only if exclusions are explicitly confirmed from search results, otherwise omit entirely]
[PART NUMBER WARNING LINE - only if part number warning is provided above, otherwise omit entirely]
[WHATS INCLUDED LINE - only if sale type requires it, otherwise omit]
• Programming Note: [per sale type instructions - one short sentence]
• Condition: ${conditionLine}
• Shipping: Ships within 1 Business Day (North Carolina, USA). Hawaii/Alaska residents - please message for a quote prior to purchase.

About Dynatrack Racing
We are dismantlers based in North Carolina, specializing in high-quality OEM components.
• Support: Available Mon-Fri for any questions.
• Returns: 30-Day Hassle-Free.

IMPORTANT FORMATTING RULES:
- Your FIRST LINE must be the eBay title prefixed with "TITLE:"
- Title word order is STRICT: [Make] [Model] [Year Range] [Part Name + most relevant keywords] [Part Number] [optional end notes]
- Examples from our store:
    TITLE: Mercedes-Benz ML350 GL-Class R-Class 2006-2012 Rear SAM Control Module A 164 900 54 01
    TITLE: Infiniti G35 G37 2007-2008 Body Control Module BCM OEM 284B1-JK600
    TITLE: Chevrolet Express Van 1500 2500 3500 2008-2009 Engine Fuse Box 25888289
    TITLE: Ford Escape 1.6L 2013-2016 Coolant Level Sensor Pipe Assembly GV61-8C045-AB
    TITLE: Toyota Sienna 3.5L 2011-2016 Engine Fuse Box Junction Relay OEM
    TITLE: Volkswagen Jetta Sedan Wagon 2011-2014 ABS Anti Lock Brake Pump 1K0 614 517 DL
    TITLE: Lincoln MKX Ford Edge 2011-2013 ABS Anti Lock Brake Pump Assembly CT43-2C405-BB
    TITLE: Mazda 3 2.3L 2007-2009 Transmission Control Module TCU TCM OEM L34T 18 9E1A
    TITLE: Ford Mustang V6 1998 Instrument Gauge Cluster Speedometer Tested 120MPH 105K
    TITLE: Dodge Ram 1500 5.9L 1997 Programmed ECU ECM PCM Engine Control 56040440AC
- Part number always goes at the end before any condition/mileage/test notes
- End notes only when relevant: "Programmed" for pre-programmed ECUs, drivetrain if specific (AWD/2WD)
${isTested && testedSuffix ? `- This is a TESTED item - append the following at the very end of the title: ${testedSuffix}` : ''}
- Title must be 80 characters or under - cut filler words to fit, never exceed 80
- After the TITLE: line, leave one blank line then output the listing body exactly as templated
- Do NOT include a "Removed From" bullet - omit it entirely
- Keep each bullet to one line
- No extra blank lines between bullets
- Do not add any fields not shown in the template above`;

    // ── Part type detection ──────────────────────────────────────────
    // Infer from partName field first, fall back to saleType context
    const partNameLower = (partName || '').toLowerCase();
    const donorLower = (donorVehicle || '').toLowerCase();

    function detectPartType() {
      if (/\b(ecu|ecm|pcm|engine control)\b/.test(partNameLower)) return 'ecu';
      if (/\b(bcm|body control)\b/.test(partNameLower)) return 'bcm';
      if (/\b(tipm|totally integrated|fuse box|fuse relay|junction box)\b/.test(partNameLower)) return 'tipm';
      if (/\b(tcm|tcu|transmission control)\b/.test(partNameLower)) return 'tcm';
      if (/\b(abs|anti.?lock|brake pump|brake module)\b/.test(partNameLower)) return 'abs';
      if (/\b(amp|amplifier)\b/.test(partNameLower)) return 'amplifier';
      if (/\b(cluster|speedometer|gauge|instrument panel)\b/.test(partNameLower)) return 'cluster';
      if (/\b(throttle body|throttle)\b/.test(partNameLower)) return 'throttle';
      if (/\b(radio|audio|infotainment|receiver|head unit)\b/.test(partNameLower)) return 'radio';
      if (/\b(idm|injector driver)\b/.test(partNameLower)) return 'idm';
      if (/\b(multiair|vvt|valve actuator|camshaft)\b/.test(partNameLower)) return 'mechanical';
      if (saleType === 'chrysler_programmed' || isChrysler) return 'ecu';
      return 'generic';
    }

    const partType = detectPartType();

    // ── Per-part-type rules: fitment specificity + programming ───────
    const partTypeRules = {
      ecu: {
        query: `"${partNum}" ECM PCM engine control module fitment application`,
        fitmentFields: 'MUST include exact engine size and code (e.g. 2.4L 4-cyl, 3.5L V6). ECUs are engine AND transmission specific - include trans type if confirmed (auto/manual). Year range must be exact.',
        programmingRule: 'ECUs ALWAYS require VIN-specific programming. Write exactly: "Requires VIN-specific programming - must be programmed to your vehicle before use."',
      },
      bcm: {
        query: `"${partNum}" body control module BCM compatibility fitment`,
        fitmentFields: 'Year/make/model/trim. BCMs are often trim-specific - include trim level if confirmed. Engine is usually NOT relevant for BCMs.',
        programmingRule: 'BCMs require programming to VIN. Write exactly: "Requires VIN-specific programming - must be paired to your vehicle."',
      },
      tipm: {
        query: `"${partNum}" TIPM fuse box integrated power module fitment`,
        fitmentFields: 'Exact year/make/model. Engine is sometimes relevant on TIPMs - include if confirmed. TIPMs are highly specific.',
        programmingRule: 'TIPMs require programming. Write exactly: "VIN-specific - requires dealer or professional programming before use."',
      },
      tcm: {
        query: `"${partNum}" transmission control module TCM fitment application`,
        fitmentFields: 'Year/make/model AND transmission type (e.g. 6-speed automatic, 5-speed manual). TCMs are transmission-specific - this is the most important field.',
        programmingRule: 'TCMs require programming. Write exactly: "Requires VIN-specific programming - must be programmed to your vehicle and transmission."',
      },
      abs: {
        query: `"${partNum}" ABS pump module anti-lock brake fitment`,
        fitmentFields: 'Year/make/model. CRITICAL: check if part is 2WD or 4WD specific - many ABS units differ. If it fits all drivetrains, write "All Drivetrains". Engine is NOT relevant for ABS.',
        programmingRule: null, // Determined by programming_db.json lookup or Claude research
      },
      amplifier: {
        query: `"${partNum}" amplifier OEM audio fitment application`,
        fitmentFields: 'Year/make/model and audio package (e.g. Bose, Harman Kardon, premium audio). Engine and drivetrain are NOT relevant for amplifiers.',
      },
      cluster: {
        query: `"${partNum}" instrument cluster speedometer fitment`,
        fitmentFields: 'Year/make/model/trim. Note if analog vs digital display. Engine may matter on clusters - include if confirmed. Trim level often determines cluster type.',
        programmingRule: 'Clusters are direct replacement. Write exactly: "Direct replacement - no programming required."',
      },
      throttle: {
        query: `"${partNum}" throttle body fitment engine application`,
        fitmentFields: 'Year/make/model AND exact engine (e.g. 2.4L 4-cyl, 3.5L V6). Throttle bodies are engine-specific - engine is the most critical field. Drivetrain is NOT relevant.',
      },
      radio: {
        query: `"${partNum}" radio head unit OEM fitment application`,
        fitmentFields: 'Year/make/model and trim/option package. Engine and drivetrain are NOT relevant for radios.',
        programmingRule: 'Radios are direct replacement. Write exactly: "Direct replacement - no programming required."',
      },
      idm: {
        query: `"${partNum}" IDM injector driver module diesel fitment`,
        fitmentFields: 'Year/make/model/engine. IDMs are engine and calibration specific - include exact diesel engine code.',
        programmingRule: 'IDMs are direct replacement. Write exactly: "Direct replacement - no programming required."',
      },
      mechanical: {
        query: `"${partNum}" OEM part fitment application`,
        fitmentFields: 'Year/make/model. Include engine only if the part is engine-specific. Drivetrain only if relevant.',
      },
      generic: {
        query: `"${partNum}" OEM part fitment application vehicle`,
        fitmentFields: 'Year/make/model. Include engine and drivetrain only if the search results show the part is specific to them.',
      }
    };

    const strategy = partTypeRules[partType];

    // Catalog-aware search
    const detectedCat = detectCatalog(partNum);
    const catalogHint = detectedCat ? `Search ${detectedCat.name.split('/')[0]} OEM catalog for this part.` : 'Search RockAuto or manufacturer catalog for this part.';
    const enrichedQuery = detectedCat
      ? `${strategy.query} ${detectedCat.name.split('/')[0]}`
      : strategy.query;

    const confirmedProgrammingNote = document.getElementById('programmingNote').value.trim();
    const programmingNoteFieldVisible = document.getElementById('programmingNoteField').style.display !== 'none';
    const confirmedDoesNotFit = document.getElementById('doesNotFit').value.trim();
    const confirmedPartNumberWarning = document.getElementById('partNumberWarning').value.trim();

    const prompt = `You are an eBay listing writer for Dynatrack Racing, a used OEM auto parts dismantler in North Carolina. They offer 30-day hassle-free returns. All parts are sourced from North American vehicles and sold to North American buyers.

IMPORTANT: Use North American vehicle names only. If search results show both a North American model and a foreign-market equivalent (e.g. Ford Escape vs Ford Kuga, Chevy Cruze vs Holden Cruze), always use the North American name in the listing.

PART TYPE: ${partType.toUpperCase()}
DETECTED MAKE: ${detectedCat ? detectedCat.name : 'Unknown - use RockAuto'}

Do ONE web search using this query: ${enrichedQuery}
${catalogHint}

═══ FITMENT RULES ═══
${strategy.fitmentFields}

- Write the Fits line with ONLY fields confirmed by search results.
- If engine/drivetrain is NOT relevant to this part type, do NOT include it in the Fits line.
- If engine/drivetrain IS relevant but you cannot confirm it, write ⚠️ VERIFY FITMENT BEFORE LISTING.
- Never invent or guess fitment data.

═══ DOES NOT FIT ═══
${confirmedDoesNotFit
  ? `CONFIRMED EXCLUSION - include this line exactly: "• Does NOT fit: ${confirmedDoesNotFit}"`
  : 'No confirmed exclusions - omit the Does NOT fit line entirely. Do not guess or invent exclusions.'
}

═══ PART NUMBER WARNING ═══
${confirmedPartNumberWarning
  ? `INCLUDE THIS LINE after the Does NOT fit line (or after Fits if no exclusions): "• ⚠ IMPORTANT: ${confirmedPartNumberWarning}"`
  : 'No part number warning needed - omit entirely.'
}

═══ PROGRAMMING NOTE ═══
PROGRAMMING NOTE RULES:
- ONLY include a "Programming Note:" bullet for these part types: ECU, BCM, TCM, TIPM, ABS, Radio, Cluster, Immobilizer
- For amplifiers, throttle bodies, mechanical parts, and all other part types: do NOT include any programming note bullet at all. Omit it entirely.
- Never write "Direct replacement - no programming required" for parts that obviously don't need programming. Buyers know an amplifier doesn't need programming.
${confirmedProgrammingNote
  ? `USE THIS EXACT PROGRAMMING NOTE - do not change it: "${confirmedProgrammingNote}"`
  : programmingNoteFieldVisible
    ? 'Programming note field was shown but left blank - omit the Programming Note bullet entirely.'
    : 'This part type does not require a programming note - omit the Programming Note bullet entirely.'
}

FORMATTING RULE: Never use em dashes (the long dash character) anywhere in the output. Use regular hyphens/dashes (-) only. This is a hard requirement.

SALE TYPE OVERRIDE: When the sale type is chrysler_programmed, combo_ign, combo_ign_bcm, or honda_key, do NOT include any "Programming Note:" bullet. DynaTrack provides the programming for these listings. The template already includes the correct buyer-facing language.

═══ SALE TYPE ═══
${saleTypeInstructions[saleType]}
${partName ? 'Part name hint: ' + partName : ''}
${donorInfo ? 'Donor vehicle: ' + donorInfo : ''}

OUTPUT only the completed listing - no preamble, no explanation:

${isChrysler ? chryslerTemplate : standardTemplate}`;

    document.getElementById('generateBtn').disabled = true;
    document.getElementById('thinking').classList.add('visible');
    document.getElementById('thinkingText').textContent = `Searching ${detectedCat ? detectedCat.name.split('/')[0] : 'RockAuto'} for ${partType === 'generic' ? 'part' : partType.toUpperCase()} fitment...`;
    document.getElementById('status').textContent = '';
    document.getElementById('outputCard').classList.remove('visible');

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await response.json();

      if (data.error) {
        document.getElementById('status').textContent = 'API error: ' + (data.error.message || 'Unknown error. Check your API key.');
        document.getElementById('generateBtn').disabled = false;
        document.getElementById('thinking').classList.remove('visible');
        return;
      }

      document.getElementById('thinkingText').textContent = 'Writing listing...';

      let finalText = '';

      if (data.stop_reason === 'tool_use') {
        const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
        const toolResults = toolUseBlocks.map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: 'Search completed - use the results already retrieved to write the listing now.'
        }));

        const followUp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1500,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            tool_choice: { type: 'none' },
            messages: [
              { role: 'user', content: prompt },
              { role: 'assistant', content: data.content },
              { role: 'user', content: toolResults }
            ]
          })
        });

        const followData = await followUp.json();
        finalText = followData.content?.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      } else {
        finalText = data.content?.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      }

      if (finalText) {
        const outputEl = document.getElementById('outputText');
        outputEl.innerHTML = '';

        // Extract TITLE: line and strip from body
        let titleValue = '';
        let bodyText = finalText;
        const titleMatch = finalText.match(/^TITLE:\s*(.+)/m);
        if (titleMatch) {
          titleValue = titleMatch[1].trim();
          bodyText = finalText.replace(/^TITLE:\s*.+\n?/m, '').replace(/^\n/, '');
        }
        const titleEl = document.getElementById('titleText');
        titleEl.textContent = titleValue;
        const charCount = titleValue.length;
        const countEl = document.getElementById('titleCharCount');
        countEl.textContent = charCount + ' / 80 characters';
        countEl.style.color = charCount > 80 ? '#b91c1c' : charCount > 70 ? '#b45309' : '#6b7280';

        const lines = bodyText.split('\n');
        let skipNext = false;
        lines.forEach((line, idx) => {
          if (skipNext) { skipNext = false; return; }
          const lineEl = document.createElement('div');
          lineEl.style.minHeight = '1.2em';

          if (line.includes('⚠️ VERIFY')) {
            lineEl.style.color = '#DC2626';
            lineEl.style.fontWeight = '600';
            lineEl.style.background = '#FEE2E2';
            lineEl.style.padding = '2px 6px';
            lineEl.style.borderRadius = '4px';
            lineEl.style.margin = '2px 0';
            lineEl.textContent = line;
          } else if (idx === 0 && line.trim() !== '') {
            // Title line - bold
            lineEl.style.fontWeight = '700';
            lineEl.style.fontSize = '17px';
            lineEl.textContent = line;
          } else if (line === 'About Dynatrack Racing' || line === 'About Dynatrack') {
            // Insert a visual divider before the About section
            const hr = document.createElement('hr');
            hr.style.cssText = 'border:none; border-top:2px solid #e5e7eb; margin:10px 0 8px 0;';
            outputEl.appendChild(hr);
            // Bold header + dash + next line description inline
            const nextLine = lines[idx + 1] || '';
            const bold = document.createElement('strong');
            bold.textContent = 'About Dynatrack Racing';
            lineEl.appendChild(bold);
            if (nextLine && !nextLine.startsWith('•')) {
              lineEl.appendChild(document.createTextNode(' - ' + nextLine));
              skipNext = true;
            }
          } else if (line === 'Item Specifics') {
            // Section headers - bold
            lineEl.style.fontWeight = '700';
            lineEl.textContent = line;
          } else if (line.startsWith('•')) {
            // Bullet lines - bold the label (text before first colon)
            const colonIdx = line.indexOf(':');
            if (colonIdx !== -1) {
              const label = line.substring(0, colonIdx + 1); // "• Part Number:"
              const value = line.substring(colonIdx + 1);    // " 91950-3W010"
              const bold = document.createElement('strong');
              bold.textContent = label;
              lineEl.appendChild(bold);
              lineEl.appendChild(document.createTextNode(value));
            } else {
              lineEl.textContent = line;
            }
          } else {
            lineEl.textContent = line;
          }

          outputEl.appendChild(lineEl);
        });

        const hasWarnings = finalText.includes('⚠️ VERIFY');
        document.getElementById('verifyBanner').style.display = hasWarnings ? 'flex' : 'none';
        document.getElementById('outputCard').classList.add('visible');
        document.getElementById('outputCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Fire-and-forget write-back to DarkHawk
        saveFitmentToDarkHawk();
      } else {
        document.getElementById('status').textContent = 'No response received. Please try again.';
      }

    } catch (err) {
      document.getElementById('status').textContent = 'Connection error. Check your internet and try again.';
    }

    document.getElementById('generateBtn').disabled = false;
    document.getElementById('thinking').classList.remove('visible');
  }

  function copyText() {
    const el = document.getElementById('outputText');
    const lines = Array.from(el.children).map(d => d.textContent);
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('copyBtn');
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy description';
        btn.classList.remove('copied');
      }, 2000);
    });
  }

  function copyTitle() {
    const text = document.getElementById('titleText').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('copyTitleBtn');
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy title';
        btn.classList.remove('copied');
      }, 2000);
    });
  }

  async function lookupFromEbay() {
    const url = document.getElementById('ebayRefUrl').value.trim();
    const statusEl = document.getElementById('lookupStatus');
    if (!url) { statusEl.innerHTML = '<span style="color:#b91c1c;">Paste an eBay URL first.</span>'; return; }
    if (!url.includes('ebay.com/itm/')) { statusEl.innerHTML = '<span style="color:#b91c1c;">Must be an eBay item URL (ebay.com/itm/...)</span>'; return; }

    statusEl.innerHTML = '<span style="color:var(--text-muted);">Fetching listing data...</span>';

    try {
      const res = await fetch(`/api/listing-tool/ebay-lookup?url=${encodeURIComponent(url)}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Lookup failed');
      const r = json.data;

      // Part name from title
      if (r.title) document.getElementById('partName').value = extractPartNameFromTitle(r.title);

      // Part number
      if (r.partNumber && !document.getElementById('partNum').value) {
        document.getElementById('partNum').value = r.partNumber;
      }

      // Year/make/model from compatibility table or item specifics
      if (r.compatibility && r.compatibility.length > 0) {
        const first = r.compatibility[0];
        document.getElementById('donorYear').value = first.year || '';
        document.getElementById('donorVehicle').value = [first.make, first.model].filter(Boolean).join(' ');
        if (first.engine) document.getElementById('donorEngine').value = first.engine;
      } else if (r.title) {
        const yearMatch = r.title.match(/\b((?:19|20)\d{2})\b/);
        if (yearMatch) document.getElementById('donorYear').value = yearMatch[0];
      }

      // Donor vehicle from item specifics
      const specMake = r.itemSpecifics?.['Brand'] || '';
      const specModel = r.itemSpecifics?.['Fitment Type'] || '';
      const donorVehicle = r.itemSpecifics?.['Donor Vehicle'];
      if (donorVehicle && !document.getElementById('donorVehicle').value) {
        document.getElementById('donorVehicle').value = donorVehicle;
      }

      const sellerNote = r.seller ? ` (from ${r.seller}'s listing)` : '';
      document.getElementById('ebayRefRow').style.display = 'none';
      statusEl.innerHTML = `<span style="color:#15803d; font-weight:500;">✓ Fields populated from eBay listing${sellerNote} - verify before generating</span>`;

    } catch (err) {
      statusEl.innerHTML = `<span style="color:#b91c1c;">Failed: ${err.message} - fill in fields manually.</span>`;
    }
  }

  function extractPartNameFromTitle(title) {
    return title
      .replace(/\bOEM\b/gi, '')
      .replace(/\bNEW\b/gi, '')
      .replace(/\bGENUINE\b/gi, '')
      .replace(/\bTESTED\b/gi, '')
      .replace(/\bWORKING\b/gi, '')
      .replace(/\bPROGRAMMED\b/gi, '')
      .replace(/\bFAST SHIP\w*/gi, '')
      .replace(/\bFREE SHIP\w*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

    function clearOutput() {
    document.getElementById('outputCard').classList.remove('visible');
    document.getElementById('titleText').textContent = '';
    document.getElementById('titleCharCount').textContent = '';
    document.getElementById('ebayRefRow').style.display = 'none';
    document.getElementById('ebayRefUrl').value = '';
    document.getElementById('partNum').value = '';
    document.getElementById('partName').value = '';
    document.getElementById('donorYear').value = '';
    document.getElementById('donorVehicle').value = '';
    document.getElementById('donorEngine').value = '';
    document.getElementById('notes').value = '';
    document.getElementById('condition').selectedIndex = 0;
    document.getElementById('saleType').selectedIndex = 0;
    document.getElementById('partNumberWarningField').style.display = 'none';
    document.getElementById('partNumberWarning').value = '';
    document.getElementById('testedSpeed').value = '';
    document.getElementById('testedMileage').value = '';
    document.getElementById('testedNotes').value = '';
    document.getElementById('testedFields').style.display = 'none';
    document.getElementById('testedNote').style.display = 'none';
    document.getElementById('status').textContent = '';
    document.getElementById('partNum').focus();
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') generate();
  });

  loadKey();

  // ── Programming DB ─────────────────────────────────────────
  let programmingDB = null;
  fetch('/admin/programming_db.json')
    .then(r => r.json())
    .then(data => { programmingDB = data.rules || data; console.log('Programming DB loaded:', Object.keys(programmingDB).length, 'entries'); })
    .catch(() => { console.log('Programming DB not available'); });

  function lookupProgramming(brand, year, moduleType) {
    if (!programmingDB) return { found: false };
    const typeMap = { 'ecu': 'ECM', 'bcm': 'BCM', 'tcm': 'TCM', 'tipm': 'TIPM', 'abs': 'ABS', 'radio': 'Radio', 'cluster': 'Cluster', 'idm': 'IDM' };
    const dbType = typeMap[moduleType] || moduleType.toUpperCase();
    // Brand normalization
    const brandMap = {
      'ford': 'Ford', 'toyota': 'Toyota', 'honda': 'Honda', 'dodge': 'Chrysler', 'chrysler': 'Chrysler',
      'jeep': 'Chrysler', 'ram': 'Chrysler', 'chevrolet': 'GM', 'gmc': 'GM', 'buick': 'GM', 'cadillac': 'GM',
      'pontiac': 'GM', 'saturn': 'GM', 'nissan': 'Nissan', 'infiniti': 'Nissan', 'bmw': 'BMW',
      'mercedes': 'Mercedes', 'mazda': 'Mazda', 'kia': 'Hyundai/Kia', 'hyundai': 'Hyundai/Kia',
      'subaru': 'Subaru', 'volkswagen': 'VW/Audi', 'audi': 'VW/Audi', 'volvo': 'Volvo',
      'lexus': 'Toyota', 'acura': 'Honda', 'lincoln': 'Ford', 'mercury': 'Ford',
    };
    const brandGroup = brandMap[(brand || '').toLowerCase()] || brand;
    const key = brandGroup + '|' + dbType + '|' + parseInt(year);
    const match = programmingDB[key];
    if (match) return { found: true, required: match.r, notes: match.n };
    return { found: false };
  }

  // ── DarkHawk fitment check (on part number blur) ─────────────
  async function checkDarkHawkFitment(partNumber) {
    if (!partNumber || partNumber.length < 5) return;
    try {
      const res = await fetch(`/api/listing-tool/parts-lookup?partNumber=${encodeURIComponent(partNumber)}`);
      const json = await res.json();
      if (!json.success || !json.data) return;

      const statusEl = document.getElementById('lookupStatus');

      if (json.source === 'cache') {
        const d = json.data;
        if (d.part_name) document.getElementById('partName').value = d.part_name;
        if (d.year) document.getElementById('donorYear').value = d.year;
        if (d.make || d.model) document.getElementById('donorVehicle').value = [d.make, d.model].filter(Boolean).join(' ');
        if (d.engine) document.getElementById('donorEngine').value = d.engine;
        if (d.does_not_fit) {
          document.getElementById('doesNotFit').value = d.does_not_fit;
          document.getElementById('doesNotFitField').style.display = 'block';
        }
        if (d.programming_note) {
          document.getElementById('programmingNote').value = d.programming_note;
          document.getElementById('programmingNoteField').style.display = 'block';
          document.getElementById('programmingNoteSource').innerHTML = '<span style="color:#15803d; font-weight:500;">From DarkHawk cache (lister-confirmed)</span>';
        }
        statusEl.innerHTML = '<span style="color:#15803d; font-weight:500;">✓ Fitment loaded from DarkHawk - verify before generating</span>';
        return;
      }

      if (json.source === 'database' && json.data.compatibility?.length > 0) {
        const c = json.data.compatibility[0];
        if (c.year) document.getElementById('donorYear').value = c.year;
        if (c.make || c.model) document.getElementById('donorVehicle').value = [c.make, c.model].filter(Boolean).join(' ');
        if (c.engine) document.getElementById('donorEngine').value = c.engine;
        statusEl.innerHTML = '<span style="color:#15803d;">✓ Partial fitment from database - generate to save complete data</span>';
      }
    } catch (e) { /* DarkHawk unavailable - silent */ }
  }

  // ── Write fitment back to DarkHawk (fire-and-forget after generate) ──
  async function saveFitmentToDarkHawk() {
    const partNumber = document.getElementById('partNum').value.trim();
    if (!partNumber || partNumber.length < 5) return;

    const vehicleStr = document.getElementById('donorVehicle').value.trim();
    const parts = vehicleStr.split(/\s+/);
    const make = parts[0] || '';
    const model = parts.slice(1).join(' ').split(' - ')[0].split(' (')[0].trim();
    if (!make) return;

    try {
      await fetch('/api/listing-tool/save-fitment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partNumber,
          partName: document.getElementById('partName').value.trim() || null,
          partType: detectPartType() || null,
          year: document.getElementById('donorYear').value.trim() || null,
          make, model: model || null,
          engine: document.getElementById('donorEngine').value.trim() || null,
          doesNotFit: document.getElementById('doesNotFit').value.trim() || null,
          programmingRequired: document.getElementById('programmingNote').value ? 'yes' : null,
          programmingNote: document.getElementById('programmingNote').value.trim() || null,
        }),
      });
    } catch (e) { /* non-blocking */ }
  }
</script>
</body>
</html>

```

## FILE: service/public/login.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk — Login</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.login-card{background:#141414;border:1px solid #2a2a2a;border-radius:16px;padding:32px 28px;width:100%;max-width:360px}
.logo{text-align:center;margin-bottom:28px}
.logo-text{font-size:26px;font-weight:900;letter-spacing:3px;color:#F0F0F0}
.logo-text span{color:#DC2626}
.logo-sub{font-size:10px;color:#6B7280;margin-top:6px;letter-spacing:.15em;text-transform:uppercase}
.form-input{width:100%;padding:14px 16px;border:1px solid #2a2a2a;border-radius:10px;font-size:15px;background:#1a1a1a;color:#F0F0F0;outline:none;transition:border-color .15s}
.form-input:focus{border-color:#DC2626}
.form-input::placeholder{color:#6B7280}
.btn-login{width:100%;padding:14px;border-radius:10px;border:none;background:#DC2626;color:#fff;font-size:15px;font-weight:700;cursor:pointer;margin-top:16px;letter-spacing:.05em;transition:opacity .15s}
.btn-login:hover{opacity:.9}
.btn-login:active{opacity:.7}
.btn-login:disabled{opacity:.4;cursor:default}
.error{color:#DC2626;font-size:12px;margin-top:10px;text-align:center;display:none}
.lock{text-align:center;margin-bottom:16px;font-size:28px;opacity:.3}
</style>
</head>
<body>
<div class="login-card">
  <div class="logo">
    <div class="lock">&#128274;</div>
    <div class="logo-text">DARK<span>HAWK</span></div>
    <div class="logo-sub">Pull Intelligence Platform</div>
  </div>
  <input type="password" class="form-input" id="pwd" placeholder="Enter password" autofocus autocomplete="current-password">
  <button class="btn-login" id="loginBtn" onclick="doLogin()">ACCESS</button>
  <div class="error" id="error"></div>
</div>

<script>
function doLogin() {
  var pwd = document.getElementById('pwd').value;
  var err = document.getElementById('error');
  var btn = document.getElementById('loginBtn');
  if (!pwd) { err.textContent = 'Enter password'; err.style.display = 'block'; return; }
  err.style.display = 'none';
  btn.disabled = true;
  btn.textContent = '...';
  fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pwd })
  }).then(function(r) {
    btn.disabled = false;
    btn.textContent = 'ACCESS';
    if (r.ok) { window.location.href = '/admin/home'; }
    else { err.textContent = 'Access denied'; err.style.display = 'block'; document.getElementById('pwd').select(); }
  }).catch(function() {
    btn.disabled = false;
    btn.textContent = 'ACCESS';
    err.textContent = 'Connection error'; err.style.display = 'block';
  });
}
document.getElementById('pwd').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') doLogin();
});
</script>
</body>
</html>

```

## FILE: service/public/opportunities.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk - SKY WATCH</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0a; --surface: #141414; --surface2: #1a1a1a;
    --border: #2a2a2a; --red: #DC2626; --red-dim: #7f1d1d;
    --yellow: #eab308; --yellow-dim: #713f12; --green: #22c55e;
    --gray: #9ca3af; --text: #F0F0F0; --text-mid: #d1d5db;
    --text-muted: #9CA3AF; --text-faint: #6B7280;
    --font: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
    --gold: #eab308; --gold-bg: #713f12; --gold-border: #eab30844;
    --blue: #3b82f6; --blue-bg: #1e3a5f;
  }
  body { font-family: var(--font); background: var(--bg); color: var(--text); min-height: 100vh; }

  /* Status filter bar */
  .filter-bar {
    display: flex; gap: 6px; padding: 10px 16px;
    background: var(--surface); border-bottom: 1px solid var(--border);
    overflow-x: auto; align-items: center;
  }
  .filter-tab {
    padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--surface2); color: var(--text-muted); font-size: 11px;
    font-weight: 600; cursor: pointer; white-space: nowrap;
    display: flex; align-items: center; gap: 5px;
  }
  .filter-tab.active { background: #064e3b; color: #22c55e; border-color: #22c55e44; }
  .filter-tab .badge {
    background: #1f2937; color: var(--text-faint); font-size: 10px;
    padding: 1px 5px; border-radius: 4px; font-weight: 700;
  }
  .filter-tab.active .badge { background: #065f46; color: #34d399; }

  /* Cards container */
  .card-list { padding: 8px; max-width: 700px; margin: 0 auto; }

  /* Vehicle research card */
  .r-card {
    background: var(--surface2); border: 1px solid var(--border); border-radius: 10px;
    margin-bottom: 8px; overflow: hidden; transition: opacity 0.3s, transform 0.3s;
  }
  .r-card.fade-out { opacity: 0; transform: translateX(-40px); }

  .r-card-header {
    padding: 12px 14px; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
  }
  .r-card-vehicle { flex: 1; min-width: 0; }
  .r-card-title { font-size: 15px; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .r-card-engine { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

  .r-card-badges { display: flex; gap: 5px; align-items: center; flex-shrink: 0; }
  .badge-source {
    font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 4px;
    letter-spacing: 0.05em; text-transform: uppercase;
  }
  .badge-source.vin { background: var(--blue-bg); color: var(--blue); }
  .badge-source.research { background: #1f2937; color: var(--text-muted); }

  .badge-status {
    font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 4px;
    letter-spacing: 0.05em; text-transform: uppercase;
  }
  .badge-status.new { background: #064e3b; color: #22c55e; animation: pulse-green 2s infinite; }
  .badge-status.reviewed { background: #1f2937; color: var(--text-muted); }
  .badge-status.marked { background: var(--gold-bg); color: var(--gold); }
  .badge-status.dismissed { background: #1f2937; color: var(--text-faint); opacity: 0.6; }

  @keyframes pulse-green {
    0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.4); }
    50% { box-shadow: 0 0 0 4px rgba(34,197,94,0); }
  }

  .r-card-summary {
    padding: 0 14px 10px; font-size: 12px; color: var(--text-muted);
  }
  .r-card-summary strong { color: var(--green); font-weight: 700; }

  /* Parts breakdown */
  .r-card-parts-toggle {
    padding: 8px 14px; font-size: 11px; font-weight: 600; color: var(--text-muted);
    cursor: pointer; border-top: 1px solid var(--border); display: flex;
    align-items: center; justify-content: space-between;
    user-select: none; -webkit-user-select: none;
  }
  .r-card-parts-toggle:active { background: var(--surface); }
  .r-card-parts-toggle .arrow { transition: transform 0.2s; font-size: 10px; }
  .r-card-parts-toggle.open .arrow { transform: rotate(180deg); }

  .r-card-parts { display: none; border-top: 1px solid var(--border); }
  .r-card-parts.open { display: block; }

  .part-row {
    padding: 8px 14px; display: flex; align-items: center; gap: 8px;
    border-bottom: 1px solid #1f1f1f; font-size: 12px;
  }
  .part-row:last-child { border-bottom: none; }
  .part-type { font-weight: 600; color: var(--text-mid); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .part-stats { color: var(--text-muted); font-size: 11px; white-space: nowrap; }
  .part-tier {
    font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 3px;
    text-transform: uppercase; letter-spacing: 0.03em; flex-shrink: 0;
  }
  .part-tier.high { background: #064e3b; color: #22c55e; }
  .part-tier.medium { background: var(--gold-bg); color: var(--gold); }
  .part-tier.low { background: #1f2937; color: var(--text-faint); }

  .part-mark-btn {
    background: none; border: 1px solid var(--border); color: var(--text-faint);
    font-size: 11px; padding: 2px 6px; border-radius: 4px; cursor: pointer;
    flex-shrink: 0;
  }
  .part-mark-btn:active { background: var(--gold-bg); color: var(--gold); border-color: var(--gold); }
  .part-mark-btn.marked { background: var(--gold-bg); color: var(--gold); border-color: var(--gold); pointer-events: none; }

  /* Card actions */
  .r-card-actions {
    padding: 8px 14px 12px; display: flex; gap: 6px; flex-wrap: wrap;
    border-top: 1px solid var(--border);
  }
  .action-btn {
    padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 600;
    border: 1px solid var(--border); cursor: pointer; white-space: nowrap;
  }
  .action-btn:disabled { opacity: 0.4; pointer-events: none; }
  .action-btn.mark-all { background: var(--gold-bg); color: var(--gold); border-color: var(--gold-border); }
  .action-btn.mark-all:active { background: #854d0e; }
  .action-btn.review { background: #1f2937; color: var(--text-muted); }
  .action-btn.review:active { background: #374151; }
  .action-btn.review.done { background: #064e3b; color: #22c55e; border-color: #22c55e44; pointer-events: none; }
  .action-btn.dismiss { background: var(--surface); color: var(--text-faint); }
  .action-btn.dismiss:active { background: #1f2937; }
  .action-btn.delete { background: var(--surface); color: #ef444480; }
  .action-btn.delete:active { background: var(--red-dim); color: #ef4444; }

  .loading { text-align: center; padding: 60px 20px; color: var(--text-muted); font-size: 14px; }
  .empty { text-align: center; padding: 60px 20px; color: var(--text-faint); font-size: 13px; line-height: 1.6; }
</style>
</head>
<body>

<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('sky')</script>

<div class="filter-bar" id="filterBar">
  <button class="filter-tab active" data-status="">All <span class="badge" id="cnt-all">0</span></button>
  <button class="filter-tab" data-status="new">New <span class="badge" id="cnt-new">0</span></button>
  <button class="filter-tab" data-status="reviewed">Reviewed <span class="badge" id="cnt-reviewed">0</span></button>
  <button class="filter-tab" data-status="marked">Marked <span class="badge" id="cnt-marked">0</span></button>
  <button class="filter-tab" data-status="dismissed">Dismissed <span class="badge" id="cnt-dismissed">0</span></button>
</div>

<div class="card-list" id="cardList">
  <div class="loading" id="loadingMsg">Loading research results...</div>
</div>

<script>
var items = [];
var currentStatus = '';

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function valueTier(avgPrice, soldCount) {
  if (avgPrice >= 150 && soldCount >= 3) return 'high';
  if (avgPrice >= 75 || soldCount >= 2) return 'medium';
  return 'low';
}

function tierLabel(t) {
  if (t === 'high') return 'HIGH';
  if (t === 'medium') return 'MED';
  return 'LOW';
}

function statusBadge(status) {
  var s = (status || 'new').toLowerCase();
  return '<span class="badge-status ' + s + '">' + s.toUpperCase() + '</span>';
}

function sourceBadge(source) {
  var s = (source || 'research').toLowerCase();
  if (s === 'vin') return '<span class="badge-source vin">VIN</span>';
  return '<span class="badge-source research">RESEARCH</span>';
}

function countParts(r) {
  var parts = r.parts || [];
  var total = parts.length;
  var highCount = 0;
  var estValue = 0;
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var avg = p.avgPrice || 0;
    var sold = p.soldCount || 0;
    estValue += avg;
    if (valueTier(avg, sold) === 'high') highCount++;
  }
  return { total: total, high: highCount, est: Math.round(estValue) };
}

function renderCard(r, idx) {
  var year = r.year || '';
  var make = r.make || '';
  var model = r.model || '';
  var title = [year, make, model].filter(Boolean).join(' ') || 'Unknown Vehicle';
  var engine = r.engine || '';
  var status = (r.status || 'new').toLowerCase();
  var source = r.source || 'research';
  var parts = r.parts || [];
  var counts = countParts(r);
  var id = r.id;

  var html = '<div class="r-card" id="rcard-' + id + '">';

  // Header
  html += '<div class="r-card-header">';
  html += '<div class="r-card-vehicle">';
  html += '<div class="r-card-title">' + esc(title) + '</div>';
  if (engine) html += '<div class="r-card-engine">' + esc(engine) + '</div>';
  html += '</div>';
  html += '<div class="r-card-badges">' + sourceBadge(source) + statusBadge(status) + '</div>';
  html += '</div>';

  // Value summary
  html += '<div class="r-card-summary">Est. <strong>$' + counts.est + '</strong> &middot; ' + counts.total + ' parts found &middot; ' + counts.high + ' high value</div>';

  // Parts toggle
  if (parts.length > 0) {
    html += '<div class="r-card-parts-toggle" onclick="toggleParts(this,' + id + ')">';
    html += '<span>Parts breakdown (' + parts.length + ')</span>';
    html += '<span class="arrow">&#9660;</span>';
    html += '</div>';

    html += '<div class="r-card-parts" id="parts-' + id + '">';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var avg = p.avgPrice || 0;
      var sold = p.soldCount || 0;
      var tier = valueTier(avg, sold);
      var partTitle = p.title || p.partType || 'Part';
      var partType = p.partType || 'Part';
      var isMarked = p.marked ? ' marked' : '';

      html += '<div class="part-row">';
      html += '<span class="part-type">' + esc(partType) + '</span>';
      html += '<span class="part-stats">$' + Math.round(avg) + ' &middot; ' + sold + ' sold</span>';
      html += '<span class="part-tier ' + tier + '">' + tierLabel(tier) + '</span>';
      html += '<button class="part-mark-btn' + isMarked + '" onclick="markPart(' + id + ',' + i + ',this)" title="Mark part">' + (p.marked ? '&#9733;' : '&#9734;') + '</button>';
      html += '</div>';
    }
    html += '</div>';
  }

  // Actions
  html += '<div class="r-card-actions">';
  var hasHigh = counts.high > 0;
  html += '<button class="action-btn mark-all"' + (hasHigh ? '' : ' disabled') + ' onclick="markAllHigh(' + id + ',this)">&#9733; Mark All High</button>';
  html += '<button class="action-btn review' + (status === 'reviewed' ? ' done' : '') + '" onclick="reviewCard(' + id + ',this)">' + (status === 'reviewed' ? 'Reviewed &#10003;' : 'Reviewed &#10003;') + '</button>';
  html += '<button class="action-btn dismiss" onclick="dismissCard(' + id + ',this)">Dismiss</button>';
  html += '<button class="action-btn delete" onclick="deleteCard(' + id + ')">Delete</button>';
  html += '</div>';

  html += '</div>';
  return html;
}

function render() {
  var list = document.getElementById('cardList');
  if (items.length === 0) {
    list.innerHTML = '<div class="empty">No research results yet.<br>Use Hawk Eye to research unfamiliar vehicles.</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < items.length; i++) {
    html += renderCard(items[i], i);
  }
  list.innerHTML = html;
}

function updateCounts(data) {
  var all = data.counts || {};
  document.getElementById('cnt-all').textContent = all.all || 0;
  document.getElementById('cnt-new').textContent = all.new || 0;
  document.getElementById('cnt-reviewed').textContent = all.reviewed || 0;
  document.getElementById('cnt-marked').textContent = all.marked || 0;
  document.getElementById('cnt-dismissed').textContent = all.dismissed || 0;
}

async function load(status) {
  if (status === undefined) status = currentStatus;
  currentStatus = status;

  // Update active tab
  var tabs = document.querySelectorAll('.filter-tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].getAttribute('data-status') === status);
  }

  var list = document.getElementById('cardList');
  list.innerHTML = '<div class="loading">Loading research results...</div>';

  try {
    var url = '/opportunities/research';
    if (status) url += '?status=' + status;
    var res = await fetch(url);
    var data = await res.json();
    if (!data.success && !Array.isArray(data)) throw new Error(data.error || 'Failed to load');
    items = data.results || data.research || data || [];
    if (Array.isArray(data)) items = data;
    if (data.counts) updateCounts(data);
    render();
  } catch(e) {
    list.innerHTML = '<div class="empty">Error loading research: ' + esc(e.message) + '</div>';
  }
}

function toggleParts(el, id) {
  el.classList.toggle('open');
  var parts = document.getElementById('parts-' + id);
  if (parts) parts.classList.toggle('open');
}

async function markPart(cardId, partIdx, btn) {
  var r = items.find(function(x) { return x.id === cardId; });
  if (!r || !r.parts || !r.parts[partIdx]) return;
  var p = r.parts[partIdx];

  try {
    var res = await fetch('/opportunities/research/' + cardId + '/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partType: p.partType, title: p.title || p.partType, avgPrice: p.avgPrice })
    });
    var data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed');
    btn.classList.add('marked');
    btn.innerHTML = '&#9733;';
    p.marked = true;
  } catch(e) {
    alert('Mark failed: ' + e.message);
  }
}

async function markAllHigh(cardId, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  try {
    var res = await fetch('/opportunities/research/' + cardId + '/mark-all-high', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    var data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed');
    btn.textContent = 'Marked!';
    setTimeout(function() { load(); }, 500);
  } catch(e) {
    btn.disabled = false;
    btn.innerHTML = '&#9733; Mark All High';
    alert('Failed: ' + e.message);
  }
}

async function reviewCard(cardId, btn) {
  btn.disabled = true;
  try {
    var res = await fetch('/opportunities/research/' + cardId + '/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    var data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed');
    btn.classList.add('done');
    btn.innerHTML = 'Reviewed &#10003;';
  } catch(e) {
    btn.disabled = false;
    alert('Failed: ' + e.message);
  }
}

async function dismissCard(cardId, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  try {
    var res = await fetch('/opportunities/research/' + cardId + '/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    var data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed');
    var card = document.getElementById('rcard-' + cardId);
    if (card) {
      card.classList.add('fade-out');
      setTimeout(function() { load(); }, 350);
    }
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Dismiss';
    alert('Failed: ' + e.message);
  }
}

async function deleteCard(cardId) {
  if (!confirm('Delete this research entry?')) return;
  try {
    var res = await fetch('/opportunities/research/' + cardId, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });
    var data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed');
    var card = document.getElementById('rcard-' + cardId);
    if (card) {
      card.classList.add('fade-out');
      setTimeout(function() { load(); }, 350);
    }
  } catch(e) {
    alert('Delete failed: ' + e.message);
  }
}

// Filter tab clicks
document.querySelectorAll('.filter-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    load(tab.getAttribute('data-status'));
  });
});

load('');
</script>
</body>
</html>

```

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

## FILE: service/public/prey-cycle.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk — PREY-CYCLE</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh}
.container{padding:12px;max-width:900px;margin:0 auto}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:10px}
.stat-row{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.stat-box{flex:1;min-width:80px;background:#1a1a1a;border-radius:8px;padding:10px;text-align:center}
.stat-value{font-size:20px;font-weight:800}
.stat-label{font-size:9px;color:#6B7280;margin-top:2px;text-transform:uppercase}
.tabs{display:flex;gap:4px;margin-bottom:10px}
.tab{padding:8px 16px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#6B7280;font-size:12px;font-weight:700;cursor:pointer}
.tab.active{color:#a78bfa;border-color:#a78bfa}
.toggle-bar{display:flex;gap:4px;margin-bottom:10px}
.toggle-btn{padding:5px 10px;border:1px solid #333;border-radius:4px;background:#1a1a1a;color:#6B7280;font-size:11px;cursor:pointer}
.toggle-btn.active{color:#a78bfa;border-color:#a78bfa}
.spinner{width:16px;height:16px;border:2px solid #333;border-top-color:#a78bfa;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;color:#6B7280;padding:20px;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:11px}
th{text-align:left;padding:6px 8px;color:#6B7280;font-size:9px;text-transform:uppercase;border-bottom:1px solid #2a2a2a;cursor:pointer}
th:hover{color:#a78bfa}
td{padding:6px 8px;border-bottom:1px solid #1f1f1f}
.bar-chart{display:flex;align-items:flex-end;gap:3px;height:100px;padding:8px 0}
.bar{background:#a78bfa;border-radius:3px 3px 0 0;min-width:14px;flex:1;position:relative}
.bar-label{position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);font-size:7px;color:#6B7280;white-space:nowrap}
.insight{padding:6px 10px;background:#1a1a1a;border-radius:6px;font-size:11px;margin-bottom:6px;border-left:3px solid #a78bfa}
.vel-fast{color:#22c55e}.vel-normal{color:#eab308}.vel-slow{color:#ef4444}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('prey-cycle')</script>
<div class="container">
  <div class="card" style="border-color:#a78bfa">
    <div style="font-size:10px;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:0.06em">PREY-CYCLE & SEASONAL</div>
    <div style="font-size:11px;color:#6B7280;margin-top:2px">Part performance, timing patterns, and sales intelligence</div>
  </div>
  <div class="tabs">
    <div class="tab active" onclick="showTab('lifecycle')">PREY-CYCLE</div>
    <div class="tab" onclick="showTab('seasonal')">SEASONAL</div>
  </div>
  <div id="lifecycleTab">
    <div class="toggle-bar">
      <button class="toggle-btn" onclick="loadLifecycle(90)">90d</button>
      <button class="toggle-btn" onclick="loadLifecycle(180)">180d</button>
      <button class="toggle-btn active" onclick="loadLifecycle(365)">1 Year</button>
      <button class="toggle-btn" onclick="loadLifecycle(9999)">All</button>
    </div>
    <div id="lcLoading" style="text-align:center;padding:20px"><div class="spinner"></div></div>
    <div id="lcContent" style="display:none"></div>
  </div>
  <div id="seasonalTab" style="display:none">
    <div id="snLoading" style="text-align:center;padding:20px"><div class="spinner"></div></div>
    <div id="snContent" style="display:none"></div>
  </div>
</div>
<script>
var lcData=null,snData=null,sortCol='totalRevenue',sortDir=-1;

function showTab(t){
  document.querySelectorAll('.tab').forEach(function(el){el.classList.remove('active')});
  event.target.classList.add('active');
  document.getElementById('lifecycleTab').style.display=t==='lifecycle'?'block':'none';
  document.getElementById('seasonalTab').style.display=t==='seasonal'?'block':'none';
  if(t==='seasonal'&&!snData)loadSeasonal();
}

function loadLifecycle(days){
  document.querySelectorAll('.toggle-btn').forEach(function(b){b.classList.remove('active')});
  if(event&&event.target)event.target.classList.add('active');
  document.getElementById('lcLoading').style.display='block';
  document.getElementById('lcContent').style.display='none';
  fetch('/intelligence/lifecycle?days='+days).then(function(r){return r.json()}).then(function(d){
    document.getElementById('lcLoading').style.display='none';
    document.getElementById('lcContent').style.display='block';
    if(!d.success){document.getElementById('lcContent').innerHTML='<div class="empty">Error</div>';return;}
    lcData=d;renderLifecycle();
  }).catch(function(e){document.getElementById('lcLoading').style.display='none';document.getElementById('lcContent').innerHTML='<div class="empty">Error: '+e.message+'</div>';});
}

function renderLifecycle(){
  if(!lcData)return;
  var t=lcData.totals||{},pts=lcData.partTypes||[];
  var h='';
  // Summary
  h+='<div class="stat-row"><div class="stat-box"><div class="stat-value" style="color:#22c55e">$'+((t.totalRevenue||0)/1000).toFixed(1)+'k</div><div class="stat-label">Revenue</div></div>';
  h+='<div class="stat-box"><div class="stat-value">'+(t.totalSales||0)+'</div><div class="stat-label">Sales</div></div>';
  h+='<div class="stat-box"><div class="stat-value">'+(t.avgDaysToSell||'—')+'d</div><div class="stat-label">Avg Days to Sell</div></div></div>';
  // Insights
  var fast=pts.filter(function(p){return p.velocity==='fast'}).slice(0,3);
  var highRet=pts.filter(function(p){return p.returnRate>5}).slice(0,2);
  if(fast.length>0)h+='<div class="insight">Fastest sellers: '+fast.map(function(p){return'<strong>'+p.partType+'</strong> ('+p.medianDaysToSell+'d median)'}).join(', ')+'</div>';
  if(highRet.length>0)h+='<div class="insight" style="border-color:#ef4444">High return rate: '+highRet.map(function(p){return'<strong>'+p.partType+'</strong> ('+p.returnRate+'%)'}).join(', ')+' — check condition grading</div>';
  if(pts.length>0)h+='<div class="insight" style="border-color:#22c55e">Top revenue: '+pts.slice(0,3).map(function(p){return'<strong>'+p.partType+'</strong> ($'+p.totalRevenue.toLocaleString()+')'}).join(', ')+'</div>';
  // Table
  h+='<div class="card"><table><thead><tr>';
  var cols=[['partType','Part'],['salesCount','Sales'],['totalRevenue','Revenue'],['avgPrice','Avg $'],['medianDaysToSell','Days'],['avgDecayPercent','Decay %'],['returnRate','Return %']];
  cols.forEach(function(c){h+='<th onclick="sortLC(\''+c[0]+'\')">'+c[1]+(sortCol===c[0]?(sortDir>0?' ▲':' ▼'):'')+'</th>'});
  h+='</tr></thead><tbody>';
  pts.sort(function(a,b){var va=a[sortCol],vb=b[sortCol];if(va==null)va=-999;if(vb==null)vb=-999;return(va-vb)*sortDir});
  pts.forEach(function(p){
    var vc=p.velocity==='fast'?'vel-fast':p.velocity==='slow'?'vel-slow':'vel-normal';
    h+='<tr><td><strong>'+p.partType+'</strong> <span class="'+vc+'" style="font-size:9px">'+(p.velocity||'')+'</span></td>';
    h+='<td>'+p.salesCount+'</td><td style="color:#22c55e">$'+p.totalRevenue.toLocaleString()+'</td>';
    h+='<td>$'+p.avgPrice+'</td><td>'+(p.medianDaysToSell!=null?p.medianDaysToSell+'d':'—')+'</td>';
    h+='<td>'+(p.avgDecayPercent||0)+'%</td>';
    h+='<td style="color:'+(p.returnRate>5?'#ef4444':'inherit')+'">'+(p.returnRate||0)+'%'+(p.returnRate>5?' ⚠':'')+'</td></tr>';
  });
  h+='</tbody></table></div>';
  document.getElementById('lcContent').innerHTML=h;
}

function sortLC(col){if(sortCol===col)sortDir*=-1;else{sortCol=col;sortDir=-1;}renderLifecycle();}

function loadSeasonal(){
  document.getElementById('snLoading').style.display='block';
  document.getElementById('snContent').style.display='none';
  fetch('/intelligence/seasonal').then(function(r){return r.json()}).then(function(d){
    document.getElementById('snLoading').style.display='none';
    document.getElementById('snContent').style.display='block';
    if(!d.success){document.getElementById('snContent').innerHTML='<div class="empty">Error</div>';return;}
    snData=d;renderSeasonal();
  }).catch(function(e){document.getElementById('snLoading').style.display='none';document.getElementById('snContent').innerHTML='<div class="empty">Error: '+e.message+'</div>';});
}

function renderSeasonal(){
  if(!snData)return;
  var h='';
  // Monthly chart
  var months=snData.monthly||[];
  var maxS=Math.max.apply(null,months.map(function(m){return m.avgSales}))||1;
  h+='<div class="card"><div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;margin-bottom:4px">Monthly Sales Volume</div>';
  h+='<div class="bar-chart">';
  months.forEach(function(m){
    var pct=Math.max(4,(m.avgSales/maxS)*100);
    var op=0.4+0.6*(m.avgSales/maxS);
    h+='<div class="bar" style="height:'+pct+'%;opacity:'+op+'" title="'+m.name+': '+m.avgSales+' avg sales, $'+m.avgRevenue+' rev"><div class="bar-label">'+m.name.substring(0,3)+'</div></div>';
  });
  h+='</div></div>';
  // Part type seasons
  var pts=snData.partTypeSeasons||[];
  if(pts.length>0){
    h+='<div class="card"><div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;margin-bottom:6px">Part Type Seasons</div>';
    pts.forEach(function(p){
      h+='<div style="padding:4px 0;border-bottom:1px solid #1f1f1f;font-size:11px"><strong>'+p.partType+'</strong> peaks in <span style="color:#22c55e">'+p.peakMonth+' ('+p.peakVsAvg+')</span>, slows in <span style="color:#ef4444">'+p.slowMonth+' ('+p.slowVsAvg+')</span></div>';
    });
    h+='</div>';
  }
  // Day of week
  var days=snData.dayOfWeek||[];
  var maxD=Math.max.apply(null,days.map(function(d){return d.avgSales}))||1;
  h+='<div class="card"><div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;margin-bottom:4px">Sales by Day of Week</div>';
  h+='<div class="bar-chart" style="height:80px">';
  days.forEach(function(d){
    var pct=Math.max(4,(d.avgSales/maxD)*100);
    h+='<div class="bar" style="height:'+pct+'%;background:#3b82f6" title="'+d.name+': '+d.avgSales+' avg/week"><div class="bar-label">'+d.name.substring(0,3)+'</div></div>';
  });
  h+='</div></div>';
  // Quarterly
  var qtrs=snData.quarterly||[];
  if(qtrs.length>0){
    h+='<div class="card"><div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;margin-bottom:6px">Quarterly Trends</div>';
    h+='<table><thead><tr><th>Quarter</th><th>Sales</th><th>Revenue</th><th>vs Last Q</th><th>vs Last Y</th></tr></thead><tbody>';
    qtrs.forEach(function(q){
      var qc=q.vsLastQuarter.startsWith('+')?'color:#22c55e':q.vsLastQuarter.startsWith('-')?'color:#ef4444':'';
      var yc=q.vsLastYear.startsWith('+')?'color:#22c55e':q.vsLastYear.startsWith('-')?'color:#ef4444':'';
      h+='<tr><td><strong>'+q.quarter+'</strong></td><td>'+q.sales+'</td><td style="color:#22c55e">$'+q.revenue.toLocaleString()+'</td>';
      h+='<td style="'+qc+'">'+q.vsLastQuarter+'</td><td style="'+yc+'">'+q.vsLastYear+'</td></tr>';
    });
    h+='</tbody></table></div>';
  }
  document.getElementById('snContent').innerHTML=h;
}

loadLifecycle(365);
</script>
</body>
</html>

```

## FILE: service/public/restock-list.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk — SCOUR STREAM</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh}
header{background:#141414;border-bottom:1px solid #2a2a2a;padding:14px 16px;position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between}
nav{display:flex;gap:6px;padding:6px 14px;background:#0a0a0a;border-bottom:1px solid #2a2a2a;overflow-x:auto;scrollbar-width:none;font-size:11px}
nav::-webkit-scrollbar{display:none}
nav a{color:#9CA3AF;text-decoration:none;padding:4px 8px;border-radius:4px;white-space:nowrap;background:#1a1a1a}
nav a.active{color:#DC2626;font-weight:700}
.container{padding:12px;max-width:700px;margin:0 auto}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:10px}
.add-row{display:flex;gap:8px}
.add-input{flex:1;padding:12px;border:1px solid #333;border-radius:8px;font-size:14px;background:#141414;color:#F0F0F0;outline:none}
.add-input:focus{border-color:#dc2626}
.add-input::placeholder{color:#6B7280}
.btn-add{padding:12px 20px;border-radius:8px;border:none;background:#dc2626;color:#fff;font-size:14px;font-weight:700;cursor:pointer}
.btn-add:disabled{opacity:.4}
.badge{font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;text-transform:uppercase;white-space:nowrap}
.b-out{background:#7f1d1d;color:#dc2626}
.b-low{background:#713f12;color:#eab308}
.b-ok{background:#064e3b;color:#22c55e}
.b-pulled{background:#064e3b;color:#22c55e}
.part-row{padding:10px 0;border-bottom:1px solid #1f1f1f;display:flex;align-items:flex-start;gap:8px}
.part-row:last-child{border-bottom:none}
.part-info{flex:1;min-width:0}
.part-title{font-size:13px;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.part-meta{font-size:10px;color:#9CA3AF;margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.part-notes{font-size:10px;color:#eab308;margin-top:2px;font-style:italic}
.part-actions{display:flex;flex-direction:column;gap:4px;flex-shrink:0}
.del-btn{width:32px;height:32px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#dc2626;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.del-btn:active{opacity:.5}
.find-btn{width:32px;height:32px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#9CA3AF;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.find-btn:active{opacity:.5}
.find-btn.has-results{color:#22c55e;border-color:#064e3b}
.pull-check{width:36px;height:36px;border-radius:8px;border:2px solid #333;background:#1a1a1a;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;transition:all 0.15s}
.pull-check:active{transform:scale(0.9)}
.pull-check.checked{background:#064e3b;border-color:#22c55e}
.pull-check svg{width:20px;height:20px}
.yard-results{margin-top:6px;padding:8px;background:#0a0a0a;border-radius:6px;border:1px solid #2a2a2a;font-size:11px}
.yard-row{padding:4px 0;border-bottom:1px solid #1a1a1a;color:#d1d5db}
.yard-row:last-child{border-bottom:none}
.yard-name{color:#22c55e;font-weight:600}
.yard-loc{color:#9CA3AF}
.yard-age{color:#6B7280;font-size:10px}
.spinner{width:18px;height:18px;border:2px solid #333;border-top-color:#dc2626;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;color:#6B7280;padding:30px 10px;font-size:13px}
.pg-row{display:flex;justify-content:center;gap:8px;padding:12px 0}
.pg-btn{padding:8px 16px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#d1d5db;font-size:12px;font-weight:600;cursor:pointer}
.pg-btn.active{background:#dc2626;color:#fff;border-color:#dc2626}
.pg-btn:disabled{opacity:.3;cursor:default}
.count{font-size:11px;color:#6B7280;margin-top:2px}
@keyframes overstock-pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.4)}50%{box-shadow:0 0 0 8px rgba(239,68,68,0)}}
.overstock-triggered{animation:overstock-pulse 2s infinite;border-left:3px solid #EF4444}
.overstock-card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:10px;position:relative}
.overstock-card .status-badge{position:absolute;top:10px;right:10px;font-size:9px;font-weight:700;padding:3px 8px;border-radius:4px;text-transform:uppercase}
.overstock-card .actions-row{display:flex;gap:8px;margin-top:10px}
.overstock-card .actions-row button{padding:8px 14px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#d1d5db;font-size:11px;font-weight:600;cursor:pointer}
.overstock-card .actions-row button:active{opacity:.5}
.overstock-card .actions-row .btn-ack{border-color:#EF4444;color:#EF4444}
.overstock-card .actions-row .btn-rewatch{border-color:#22c55e;color:#22c55e}
.overstock-card .actions-row .btn-del{border-color:#6B7280;color:#6B7280}
.overstock-error{color:#EF4444;font-size:11px;margin-top:6px}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('scour')</script>
<div style="padding:4px 16px;background:#0a0a0a;font-size:10px;color:#6B7280;border-bottom:1px solid #2a2a2a">SCOUR STREAM <span id="totalCount" class="count"></span></div>
</nav>
<div style="display:flex;background:#141414;border-bottom:1px solid #2a2a2a;overflow-x:auto;scrollbar-width:none">
  <div class="stream-tab active" onclick="switchTab('watchlist')" id="tab-watchlist" style="padding:10px 16px;font-size:12px;font-weight:600;color:#F0F0F0;cursor:pointer;border-bottom:2px solid #dc2626;white-space:nowrap">WATCHLIST</div>
  <div class="stream-tab" onclick="switchTab('wantlist')" id="tab-wantlist" style="padding:10px 16px;font-size:12px;font-weight:600;color:#6B7280;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap">WANT LIST</div>
  <div class="stream-tab" onclick="switchTab('overstock')" id="tab-overstock" style="padding:10px 16px;font-size:12px;font-weight:600;color:#6B7280;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap">OVERSTOCK</div>
</div>

<div class="container" id="watchlistView">
  <div id="justSold"></div>
  <div class="card">
    <div class="add-row">
      <input type="text" class="add-input" id="watchInput" placeholder="Add PN to watchlist (e.g. 56044691)" autocomplete="off">
      <input type="text" class="add-input" id="watchDesc" placeholder="Description (optional)" autocomplete="off" style="flex:.8">
      <button class="btn-add" onclick="addToWatchlist()">Add</button>
    </div>
  </div>
  <div id="watchLoading" style="text-align:center;padding:30px"><div class="spinner"></div><div style="margin-top:8px;color:#6B7280;font-size:12px">Loading watchlist...</div></div>
  <div id="watchList"></div>
</div>

<div class="container" id="wantlistView" style="display:none">
  <div class="card">
    <div class="add-row">
      <input type="text" class="add-input" id="addInput" placeholder="Add part (e.g. 2010-2015 Toyota Prius ABS Pump)" autocomplete="off">
      <button class="btn-add" id="addBtn" onclick="addPart()">Add</button>
    </div>
  </div>
  <div id="loading" style="text-align:center;padding:30px"><div class="spinner"></div><div style="margin-top:8px;color:#6B7280;font-size:12px">Loading want list...</div></div>
  <div id="list"></div>
  <div id="pagination" class="pg-row"></div>
</div>

<div class="container" id="overstockView" style="display:none">
  <div class="card">
    <div style="font-size:10px;color:#6B7280;margin-bottom:3px">Paste eBay Item Numbers</div>
    <textarea class="add-input" id="overstockIdsInput" rows="4" placeholder="Paste eBay item numbers, one per line or separated by commas/spaces" style="resize:vertical;font-size:13px;line-height:1.5"></textarea>
    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:flex-end">
      <div style="width:80px">
        <div style="font-size:10px;color:#6B7280;margin-bottom:3px">Restock At</div>
        <input type="number" class="add-input" id="overstockTargetInput" value="1" min="0" max="99" style="text-align:center">
      </div>
      <div style="flex:1;min-width:100px">
        <div style="font-size:10px;color:#6B7280;margin-bottom:3px">Group Name</div>
        <input type="text" class="add-input" id="overstockNameInput" placeholder="Auto-generated from first item" autocomplete="off">
      </div>
      <div style="flex:.6;min-width:80px">
        <div style="font-size:10px;color:#6B7280;margin-bottom:3px">Notes</div>
        <input type="text" class="add-input" id="overstockNotesInput" placeholder="Notes (optional)" autocomplete="off">
      </div>
      <button class="btn-add" onclick="addOverstockGroup()">Track Group</button>
    </div>
    <div style="font-size:9px;color:#6B7280;margin-top:6px">0 = slow mover (sell out first) · 1 = keep one on hand · 2+ = high demand</div>
    <div id="overstockFormError" class="overstock-error" style="display:none"></div>
    <div id="overstockFormWarnings" style="display:none;font-size:10px;color:#EAB308;margin-top:6px"></div>
  </div>
  <div id="suggestionsSection" style="margin-bottom:10px">
    <button class="btn-add" onclick="loadSuggestions()" id="suggestBtn" style="background:#1a1a1a;color:#d1d5db;border:1px solid #333;font-size:11px;padding:8px 14px;width:100%;margin-bottom:6px">Find High-Quantity Listings</button>
    <div id="suggestionsContent"></div>
  </div>
  <div id="overstockLoading" style="text-align:center;padding:30px"><div class="spinner"></div><div style="margin-top:8px;color:#6B7280;font-size:12px">Loading...</div></div>
  <div id="overstockList"></div>
</div>
<script>
var allItems = [];
var page = 1;
var perPage = 50;
var currentTab = 'watchlist';

var overstockItems = [];
var overstockLoaded = false;

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.stream-tab').forEach(function(t) {
    t.style.color = '#6B7280'; t.style.borderBottomColor = 'transparent';
  });
  var el = document.getElementById('tab-' + tab);
  el.style.color = '#F0F0F0'; el.style.borderBottomColor = '#dc2626';
  document.getElementById('watchlistView').style.display = tab === 'watchlist' ? 'block' : 'none';
  document.getElementById('wantlistView').style.display = tab === 'wantlist' ? 'block' : 'none';
  document.getElementById('overstockView').style.display = tab === 'overstock' ? 'block' : 'none';
  if (tab === 'wantlist' && allItems.length === 0) load();
  if (tab === 'overstock') loadOverstock();
}

// ── WATCHLIST ────────────────────────────────────────────────
function loadWatchlist() {
  fetch('/restock-want-list/watchlist')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      document.getElementById('watchLoading').style.display = 'none';
      if (!d.success) { document.getElementById('watchList').innerHTML = '<div class="empty">Error loading watchlist</div>'; return; }
      document.getElementById('totalCount').textContent = '(' + d.total + ' watched)';
      var html = '';
      if (d.items.length === 0) {
        html = '<div class="empty">No items on watchlist. Add part numbers above to track rinse-and-repeat parts.</div>';
      }
      d.items.forEach(function(item) {
        var badge = item.stock === 0 ? '<span class="badge b-out">OUT</span>' : item.stock < item.targetStock ? '<span class="badge b-low">LOW (' + item.stock + ')</span>' : '<span class="badge b-ok">STOCKED (' + item.stock + ')</span>';
        var market = item.marketMedian ? '$' + Math.round(item.marketMedian) + ' med' : 'no market data';
        var sold = item.marketSold ? item.marketSold + ' sold' : '';
        var lastSoldStr = item.lastSold ? Math.floor((Date.now() - new Date(item.lastSold).getTime()) / 86400000) + 'd ago @ $' + Math.round(item.lastSoldPrice || 0) : 'never sold';
        var prioColor = item.priority === 'high' ? '#dc2626' : item.priority === 'low' ? '#6B7280' : '#d1d5db';
        html += '<div class="part-row">';
        html += '<div class="part-info">';
        html += '<div class="part-title" style="color:' + prioColor + '">' + item.partNumberBase + (item.description ? ' - ' + item.description : '') + '</div>';
        html += '<div class="part-meta">' + badge + ' <span>' + market + '</span> <span>' + sold + '</span> <span>Last sold: ' + lastSoldStr + '</span></div>';
        if (item.notes) html += '<div class="part-notes">' + item.notes + '</div>';
        html += '</div>';
        html += '<div class="part-actions"><button class="del-btn" onclick="removeWatch(' + item.id + ')" title="Remove">x</button></div>';
        html += '</div>';
      });
      document.getElementById('watchList').innerHTML = html;
    })
    .catch(function(err) {
      document.getElementById('watchLoading').style.display = 'none';
      document.getElementById('watchList').innerHTML = '<div class="empty">Error: ' + err.message + '</div>';
    });
}

function addToWatchlist() {
  var pn = document.getElementById('watchInput').value.trim();
  var desc = document.getElementById('watchDesc').value.trim();
  if (!pn) return;
  fetch('/restock-want-list/watchlist/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partNumberBase: pn, description: desc || null }) })
    .then(function() { document.getElementById('watchInput').value = ''; document.getElementById('watchDesc').value = ''; loadWatchlist(); });
}
function removeWatch(id) {
  fetch('/restock-want-list/watchlist/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
    .then(function() { loadWatchlist(); });
}

document.getElementById('watchInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') addToWatchlist(); });
loadWatchlist();

// ── WANT LIST (original) ─────────────────────────────────────
document.getElementById('addInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') addPart(); });

function load() {
  fetch('/restock-want-list/items?manual_only=true')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      document.getElementById('loading').style.display = 'none';
      if (!d.success) { document.getElementById('list').innerHTML = '<div class="empty">Error loading list</div>'; return; }
      allItems = d.items;
      document.getElementById('totalCount').textContent = '(' + d.total + ' parts)';
      page = 1;
      renderPage();
    })
    .catch(function(err) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('list').innerHTML = '<div class="empty">Error: ' + err.message + '</div>';
    });
}

function renderPage() {
  var start = (page - 1) * perPage;
  var visible = allItems.slice(start, start + perPage);
  var totalPages = Math.ceil(allItems.length / perPage);

  if (allItems.length === 0) {
    document.getElementById('list').innerHTML = '<div class="empty">No parts in want list. Add one above.</div>';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  var h = '<div class="card">';
  visible.forEach(function(item, idx) {
    // Determine badge based on match method + stock
    // PART_NUMBER = green tier, VEHICLE_MATCH = yellow tier, KEYWORD = red tier
    var badge, bc, tierLabel, tierColor;
    if (item.pulled) {
      badge = 'PULLED'; bc = 'b-pulled'; tierLabel = ''; tierColor = '';
    } else if (item.confidence === 'none') {
      badge = '? VERIFY'; bc = 'b-out'; tierLabel = 'NO MATCH'; tierColor = '#dc2626';
    } else if (item.matchMethod === 'PART_NUMBER') {
      tierLabel = 'PART_NUMBER'; tierColor = '#22c55e';
      var lc = item.listingCount || item.stock;
      var stockLabel = (lc !== item.stock) ? item.stock + ' qty / ' + lc + ' listing' + (lc !== 1 ? 's' : '') : item.stock + '';
      if (item.stock === 0) { badge = '0'; bc = 'b-out'; }
      else if (item.stock <= 2) { badge = stockLabel; bc = 'b-low'; }
      else { badge = stockLabel; bc = 'b-ok'; }
    } else if (item.matchMethod === 'VEHICLE_MATCH') {
      tierLabel = 'VEHICLE_MATCH'; tierColor = '#eab308';
      var lc = item.listingCount || item.stock;
      var stockLabel = (lc !== item.stock) ? item.stock + ' qty / ' + lc + ' listing' + (lc !== 1 ? 's' : '') : item.stock + '';
      if (item.stock === 0) { badge = '0'; bc = 'b-out'; }
      else if (item.stock <= 2) { badge = stockLabel; bc = 'b-low'; }
      else { badge = stockLabel; bc = 'b-ok'; }
    } else if (item.matchMethod === 'KEYWORD') {
      tierLabel = 'KEYWORD'; tierColor = '#dc2626';
      if (item.stock === 0) { badge = '0'; bc = 'b-out'; }
      else if (item.stock <= 2) { badge = '~' + item.stock; bc = 'b-low'; }
      else { badge = '~' + item.stock; bc = 'b-ok'; }
    } else {
      tierLabel = ''; tierColor = '#6B7280';
      if (item.stock === 0) { badge = 'OUT OF STOCK'; bc = 'b-out'; }
      else { badge = '~' + item.stock; bc = 'b-low'; }
    }

    var priceStr = item.avgPrice ? '$' + item.avgPrice : '-';
    var soldStr = '-';
    if (item.lastSold) {
      var days = Math.floor((Date.now() - new Date(item.lastSold).getTime()) / 86400000);
      soldStr = days <= 0 ? 'today' : days + 'd ago';
    }
    var pulledInfo = '';
    if (item.pulled && item.pulled_from) {
      pulledInfo = ' (from ' + esc(item.pulled_from) + ')';
    } else if (item.pulled && item.pulled_date) {
      var pd = Math.floor((Date.now() - new Date(item.pulled_date).getTime()) / 86400000);
      pulledInfo = ' (pulled ' + (pd <= 0 ? 'today' : pd + 'd ago') + ')';
    }

    var checkSvg = item.pulled
      ? '<svg viewBox="0 0 24 24" fill="#22c55e" stroke="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';

    h += '<div class="part-row">';
    // Checkbox on left
    h += '<div class="pull-check' + (item.pulled ? ' checked' : '') + '" onclick="togglePull(' + item.id + ',' + !item.pulled + ')" title="' + (item.pulled ? 'Unmark as pulled' : 'Mark as pulled') + '">' + checkSvg + '</div>';
    // Info
    h += '<div class="part-info">';
    h += '<div class="part-title"' + (item.pulled ? ' style="opacity:0.6"' : '') + '>' + esc(item.title) + '</div>';
    if (item.notes) h += '<div class="part-notes">' + esc(item.notes) + '</div>';
    h += '<div class="part-meta"><span class="badge ' + bc + '">' + badge + pulledInfo + '</span>';
    if (tierLabel) h += '<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:#1a1a1a;color:' + (tierColor || '#6B7280') + ';font-weight:700">' + tierLabel + '</span>';
    h += '<span>Avg ' + priceStr + '</span><span>Last sold ' + soldStr + '</span></div>';

    // Similar PN line (Tier 2)
    if (item.similar && item.similar.length > 0) {
      item.similar.forEach(function(sim) {
        h += '<div style="margin-top:3px;padding:3px 6px;background:#1a1a1a;border-radius:4px;border:1px solid #333;font-size:10px">';
        h += '<span style="color:#eab308;font-weight:700">SIMILAR:</span> ';
        h += '<span style="color:#d1d5db;font-family:monospace">' + esc(sim.similarPN) + '</span>';
        h += ' <span style="color:#9CA3AF">(' + sim.stockCount + ' in stock';
        if (sim.soldCount > 0) h += ', sold ' + sim.soldCount + 'x';
        if (sim.avgPrice) h += ' @ $' + sim.avgPrice + ' avg';
        h += ')</span></div>';
      });
    }

    // Match debug
    if (item.matchDebug) {
      h += '<details style="margin-top:3px"><summary style="font-size:9px;color:#6B7280;cursor:pointer">Match: ' + esc(item.matchDebug) + '</summary>';
      if (item.matchedTitles && item.matchedTitles.length > 0) {
        h += '<div style="font-size:10px;color:#9CA3AF;margin-top:3px;padding-left:8px;border-left:2px solid #2a2a2a">';
        item.matchedTitles.forEach(function(t) { h += '<div style="padding:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t) + '</div>'; });
        h += '</div>';
      } else {
        h += '<div style="font-size:10px;color:#6B7280;margin-top:2px;padding-left:8px">No matching listings found</div>';
      }
      h += '</details>';
    }
    // Yard results container
    h += '<div id="yard-' + item.id + '"></div>';
    h += '</div>';
    // Right side buttons
    h += '<div class="part-actions">';
    h += '<button class="find-btn" onclick="findInYard(' + item.id + ',this)" title="Find in yard"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></button>';
    h += '<button class="del-btn" onclick="delPart(' + item.id + ',this)" title="Remove"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg></button>';
    h += '</div>';
    h += '</div>';
  });
  h += '</div>';
  document.getElementById('list').innerHTML = h;

  // Pagination
  if (totalPages <= 1) { document.getElementById('pagination').innerHTML = ''; return; }
  var ph = '';
  for (var i = 1; i <= totalPages; i++) {
    ph += '<button class="pg-btn' + (i === page ? ' active' : '') + '" onclick="goPage(' + i + ')">' + i + '</button>';
  }
  document.getElementById('pagination').innerHTML = ph;
}

function goPage(p) { page = p; renderPage(); window.scrollTo(0, 0); }

function togglePull(id, pulled) {
  // Optimistic update
  for (var i = 0; i < allItems.length; i++) {
    if (allItems[i].id === id) {
      allItems[i].pulled = pulled;
      allItems[i].pulled_date = pulled ? new Date().toISOString() : null;
      break;
    }
  }
  renderPage();
  fetch('/restock-want-list/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, pulled: pulled }) })
    .catch(function(err) { alert('Error saving: ' + err.message); load(); });
}

function findInYard(id, btn) {
  var item = null;
  for (var i = 0; i < allItems.length; i++) { if (allItems[i].id === id) { item = allItems[i]; break; } }
  if (!item) return;

  var el = document.getElementById('yard-' + id);
  // Toggle off if already showing
  if (el.innerHTML) { el.innerHTML = ''; btn.classList.remove('has-results'); return; }

  el.innerHTML = '<div style="padding:4px 0;font-size:10px;color:#6B7280"><div class="spinner" style="width:14px;height:14px"></div> Searching yards...</div>';

  fetch('/restock-want-list/find-in-yard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: item.title }) })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.success || !d.vehicles || d.vehicles.length === 0) {
        el.innerHTML = '<div class="yard-results"><div style="color:#6B7280;text-align:center">No matching vehicles on current set lists</div></div>';
        return;
      }
      btn.classList.add('has-results');
      var h = '<div class="yard-results">';
      h += '<div style="font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;margin-bottom:4px">' + d.vehicles.length + ' vehicle' + (d.vehicles.length > 1 ? 's' : '') + ' found in yards</div>';
      d.vehicles.forEach(function(v) {
        h += '<div class="yard-row">';
        h += '<span style="font-weight:600">' + esc(v.year + ' ' + v.make + ' ' + v.model) + '</span>';
        if (v.color) h += ' <span style="color:#6B7280">(' + esc(v.color) + ')</span>';
        h += ' — <span class="yard-name">' + esc(v.yard) + '</span>';
        h += ' <span class="yard-loc">Row ' + esc(v.row) + '</span>';
        h += ' <span class="yard-age">set ' + v.daysAgo + '</span>';
        h += '</div>';
      });
      h += '</div>';
      el.innerHTML = h;
    })
    .catch(function(err) {
      el.innerHTML = '<div class="yard-results" style="color:#dc2626">Error: ' + err.message + '</div>';
    });
}

function addPart() {
  var inp = document.getElementById('addInput');
  var title = inp.value.trim();
  if (!title) return;
  var btn = document.getElementById('addBtn');
  btn.disabled = true; btn.textContent = '...';
  fetch('/restock-want-list/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title }) })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success) { inp.value = ''; load(); }
      else alert('Error: ' + (d.error || 'Unknown'));
    })
    .catch(function(err) { alert('Error: ' + err.message); })
    .finally(function() { btn.disabled = false; btn.textContent = 'Add'; });
}

function delPart(id, btn) {
  if (!confirm('Remove this part from the want list?')) return;
  btn.disabled = true; btn.style.opacity = '0.3';
  fetch('/restock-want-list/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
    .then(function(r) { return r.json(); })
    .then(function(d) { if (d.success) load(); })
    .catch(function(err) { alert('Error: ' + err.message); btn.disabled = false; btn.style.opacity = '1'; });
}

function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function loadJustSold() {
  fetch('/restock-want-list/just-sold')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.success || !d.items || d.items.length === 0) {
        document.getElementById('justSold').innerHTML = '';
        return;
      }
      var totalSales = d.items.reduce(function(n, s) { return n + s.sales.length; }, 0);
      var h = '<div class="card" style="border-color:#16a34a;border-width:2px">';
      h += '<div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">JUST SOLD — RESTOCK NOW (' + totalSales + ' sale' + (totalSales > 1 ? 's' : '') + ')</div>';
      d.items.forEach(function(s, idx) {
        h += '<div style="padding:8px 0;border-bottom:1px solid #1f1f1f">';
        h += '<div style="font-size:13px;font-weight:600">' + esc(s.wantTitle) + '</div>';
        // Show grouped sales: "3x sold — $500 / $200 / $399"
        var prices = s.sales.map(function(sl) { return '$' + sl.price; }).join(' / ');
        var soldLabel = s.sales.length > 1
          ? s.sales.length + 'x sold ' + s.sales[0].soldAgo
          : 'sold ' + s.sales[0].soldAgo;
        h += '<div style="font-size:11px;margin-top:2px"><span style="color:#22c55e;font-weight:700">' + prices + '</span> <span style="color:#9CA3AF">' + soldLabel + '</span></div>';
        // Collapsible details: matched sale titles + yard locations
        var hasYards = s.yardMatches && s.yardMatches.length > 0;
        var hasSaleTitles = s.matchedSaleTitles && s.matchedSaleTitles.length > 0;
        if (hasYards || hasSaleTitles) {
          var label = hasYards ? s.yardMatches.length + ' yard' + (s.yardMatches.length > 1 ? 's' : '') + ' nearby' : 'View details';
          h += '<details style="margin-top:4px"><summary style="font-size:10px;color:#22c55e;cursor:pointer;user-select:none">' + label + ' &#9654;</summary>';
          h += '<div style="margin-top:4px;padding:4px 8px;background:#0a0a0a;border-radius:4px;border:1px solid #2a2a2a">';
          if (hasYards) {
            s.yardMatches.forEach(function(v) {
              h += '<div style="font-size:10px;color:#d1d5db;padding:2px 0"><span style="font-weight:600">' + esc(v.desc) + '</span> — <span style="color:#22c55e">' + esc(v.yard) + '</span> Row ' + esc(v.row) + '</div>';
            });
          }
          if (hasSaleTitles) {
            h += '<div style="margin-top:4px;padding-top:4px;border-top:1px solid #2a2a2a;font-size:9px;color:#6B7280">Matched sales:</div>';
            s.matchedSaleTitles.forEach(function(t) {
              h += '<div style="font-size:9px;color:#9CA3AF;padding:1px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t) + '</div>';
            });
          }
          h += '</div></details>';
        } else {
          h += '<div style="font-size:10px;color:#6B7280;margin-top:2px">No matching vehicles in yards right now</div>';
        }
        h += '</div>';
      });
      h += '</div>';
      document.getElementById('justSold').innerHTML = h;
    })
    .catch(function() { /* ignore */ });
}

load();
loadJustSold();

// ── OVERSTOCK (group-based) ──────────────────────────────────
function loadOverstock() {
  document.getElementById('overstockLoading').style.display = 'block';
  document.getElementById('overstockList').innerHTML = '';
  fetch('/restock-want-list/overstock')
    .then(function(r) {
      if (!r.ok) throw new Error('Server error (' + r.status + ')');
      return r.json();
    })
    .then(function(groups) {
      document.getElementById('overstockLoading').style.display = 'none';
      if (!Array.isArray(groups)) {
        document.getElementById('overstockList').innerHTML = '<div class="empty">Error: unexpected response</div>';
        return;
      }
      overstockItems = groups;
      overstockLoaded = true;
      renderOverstock();
      updateOverstockBadge();
    })
    .catch(function(err) {
      document.getElementById('overstockLoading').style.display = 'none';
      document.getElementById('overstockList').innerHTML = '<div class="empty">Error: ' + (err.message || 'Failed to load') + '</div>';
    });
}

function updateOverstockBadge() {
  var triggered = overstockItems.filter(function(g) { return g.status === 'triggered'; }).length;
  var tabEl = document.getElementById('tab-overstock');
  if (triggered > 0) {
    tabEl.innerHTML = 'OVERSTOCK <span style="color:#EF4444">(' + triggered + ')</span>';
  } else {
    tabEl.textContent = 'OVERSTOCK';
  }
}

function relTime(dateStr) {
  if (!dateStr) return '';
  var days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  return days + 'd ago';
}

function parseItemIds(text) {
  return text.split(/[\n,\s\t]+/).map(function(s) { return s.trim(); }).filter(function(s) { return /^\d{10,15}$/.test(s); });
}

function renderOverstock() {
  if (overstockItems.length === 0) {
    document.getElementById('overstockList').innerHTML = '<div class="empty">No overstock groups tracked yet.<br><span style="font-size:11px">Paste eBay item numbers above to start monitoring, or use "Find High-Quantity Listings" to auto-detect.</span></div>';
    return;
  }
  var h = '';
  overstockItems.forEach(function(group) {
    var stock = group.live_stock != null ? group.live_stock : group.current_stock;
    var qtyColor = '#22C55E';
    if (stock <= group.restock_target) qtyColor = '#EF4444';
    else if (stock === group.restock_target + 1) qtyColor = '#EAB308';

    var statusBadge = '';
    var cardClass = 'overstock-card';
    if (group.status === 'triggered') {
      statusBadge = '<div class="status-badge" style="background:#EF4444;color:#fff">RESTOCK NOW</div>';
      cardClass += ' overstock-triggered';
    } else if (group.status === 'acknowledged') {
      statusBadge = '<div class="status-badge" style="background:#374151;color:#9CA3AF">ACKNOWLEDGED</div>';
    } else {
      statusBadge = '<div class="status-badge" style="background:#6B7280;color:#fff">WATCHING</div>';
    }

    var timeStr = '';
    if (group.status === 'triggered' && group.triggered_at) timeStr = 'Triggered ' + relTime(group.triggered_at);
    else if (group.status === 'acknowledged' && group.acknowledged_at) timeStr = 'Acknowledged ' + relTime(group.acknowledged_at);
    else timeStr = 'Tracking for ' + relTime(group.created_at);

    var typeLabel = group.group_type === 'single'
      ? 'SINGLE (qty ' + group.initial_stock + ')'
      : 'GROUP (' + (group.items ? group.items.length : group.initial_stock) + ' listings)';

    h += '<div class="' + cardClass + '">';
    h += statusBadge;
    h += '<div style="font-size:14px;font-weight:700;color:#F0F0F0;padding-right:90px">' + esc(group.name) + '</div>';
    h += '<div style="display:flex;gap:6px;align-items:center;margin-top:4px;flex-wrap:wrap">';
    if (group.part_type) h += '<span style="font-size:9px;padding:2px 6px;border-radius:3px;background:#1a1a1a;color:#9CA3AF;font-weight:700;border:1px solid #333">' + esc(group.part_type) + '</span>';
    h += '<span style="font-size:10px;color:#6B7280">' + typeLabel + '</span>';
    h += '</div>';

    // Expandable item list
    if (group.items && group.items.length > 0) {
      h += '<details style="margin-top:6px"><summary style="font-size:10px;color:#6B7280;cursor:pointer;user-select:none">' + group.items.length + ' item' + (group.items.length > 1 ? 's' : '') + ' &#9654;</summary>';
      h += '<div style="margin-top:4px;padding:4px 8px;background:#0a0a0a;border-radius:4px;border:1px solid #2a2a2a">';
      group.items.forEach(function(item) {
        var style = item.is_active ? 'color:#d1d5db' : 'color:#6B7280;text-decoration:line-through;opacity:0.5';
        h += '<div style="font-size:10px;padding:3px 0;' + style + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">';
        h += '<a href="https://www.ebay.com/itm/' + esc(item.ebay_item_id) + '" target="_blank" style="color:inherit;text-decoration:none">#' + esc(item.ebay_item_id) + '</a> ';
        h += esc(item.title || '');
        if (item.current_price) h += ' <span style="color:#22c55e">$' + parseFloat(item.current_price).toFixed(0) + '</span>';
        if (!item.is_active) h += ' <span style="color:#EF4444;font-size:8px;font-weight:700">SOLD</span>';
        h += '</div>';
      });
      h += '</div></details>';
    }

    h += '<div style="margin-top:8px;font-size:13px;font-weight:700;color:' + qtyColor + '">Stock: ' + stock + ' / ' + group.initial_stock + '</div>';
    h += '<div style="font-size:11px;color:#9CA3AF;margin-top:2px" id="restock-target-row-' + group.id + '">Restock at: <span onclick="editRestockTarget(' + group.id + ',' + group.restock_target + ',' + stock + ')" style="cursor:pointer;border-bottom:1px dashed #6B7280" title="Click to edit">' + group.restock_target + '</span>';
    if (group.restock_target === 0) h += ' <span style="color:#6B7280;font-size:9px;font-weight:700">SLOW MOVER</span>';
    h += '</div>';
    h += '<div style="font-size:10px;color:#6B7280;margin-top:4px">' + timeStr + '</div>';
    if (group.notes) h += '<div style="font-size:10px;color:#9CA3AF;margin-top:3px;font-style:italic">' + esc(group.notes) + '</div>';

    h += '<div class="actions-row">';
    if (group.status === 'triggered') {
      h += '<button class="btn-ack" onclick="ackOverstock(' + group.id + ')">Acknowledge</button>';
      h += '<button class="btn-rewatch" onclick="rewatchOverstock(' + group.id + ')">Re-watch</button>';
    } else if (group.status === 'acknowledged') {
      h += '<button class="btn-rewatch" onclick="rewatchOverstock(' + group.id + ')">Re-watch</button>';
      h += '<button class="btn-del" onclick="deleteOverstock(' + group.id + ')">Delete</button>';
    } else {
      h += '<button class="btn-rewatch" onclick="showAddItems(' + group.id + ')" style="border-color:#6B7280;color:#9CA3AF">Add Items</button>';
      h += '<button class="btn-del" onclick="deleteOverstock(' + group.id + ')">Delete</button>';
    }
    h += '</div>';
    h += '<div id="overstock-add-' + group.id + '" style="display:none;margin-top:8px"><input type="text" class="add-input" style="font-size:12px;padding:8px" placeholder="Paste item numbers (comma or space separated)" id="overstock-add-input-' + group.id + '"><button class="btn-add" style="margin-top:4px;font-size:11px;padding:6px 12px" onclick="addItemsToGroup(' + group.id + ')">Add to Group</button></div>';
    h += '<div id="overstock-err-' + group.id + '" class="overstock-error" style="display:none"></div>';
    h += '</div>';
  });
  document.getElementById('overstockList').innerHTML = h;
}

function addOverstockGroup() {
  var raw = document.getElementById('overstockIdsInput').value;
  var ids = parseItemIds(raw);
  var target = parseInt(document.getElementById('overstockTargetInput').value) || 1;
  var name = document.getElementById('overstockNameInput').value.trim();
  var notes = document.getElementById('overstockNotesInput').value.trim();
  var errEl = document.getElementById('overstockFormError');
  var warnEl = document.getElementById('overstockFormWarnings');
  errEl.style.display = 'none';
  warnEl.style.display = 'none';

  if (ids.length === 0) { errEl.textContent = 'No valid eBay item numbers found. Item numbers are 10-15 digits.'; errEl.style.display = 'block'; return; }

  fetch('/restock-want-list/overstock/add', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ebayItemIds: ids, restockTarget: target, name: name || undefined, notes: notes || undefined })
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      if (!res.ok) {
        var msg = res.data.error || 'Error creating group.';
        if (res.data.errors && res.data.errors.length > 0) msg += '\n' + res.data.errors.join('\n');
        errEl.textContent = msg; errEl.style.display = 'block';
        return;
      }
      document.getElementById('overstockIdsInput').value = '';
      document.getElementById('overstockTargetInput').value = '1';
      document.getElementById('overstockNameInput').value = '';
      document.getElementById('overstockNotesInput').value = '';
      if (res.data.errors && res.data.errors.length > 0) {
        warnEl.textContent = 'Warnings: ' + res.data.errors.join('; ');
        warnEl.style.display = 'block';
      }
      loadOverstock();
    })
    .catch(function(err) { errEl.textContent = err.message; errEl.style.display = 'block'; });
}

function showAddItems(groupId) {
  var el = document.getElementById('overstock-add-' + groupId);
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function addItemsToGroup(groupId) {
  var input = document.getElementById('overstock-add-input-' + groupId);
  var ids = parseItemIds(input.value);
  var errEl = document.getElementById('overstock-err-' + groupId);
  errEl.style.display = 'none';
  if (ids.length === 0) { errEl.textContent = 'No valid item numbers found.'; errEl.style.display = 'block'; return; }

  fetch('/restock-want-list/overstock/add-items', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId: groupId, ebayItemIds: ids })
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      if (!res.ok) { errEl.textContent = res.data.error || 'Error'; errEl.style.display = 'block'; return; }
      if (res.data.errors && res.data.errors.length > 0) {
        errEl.textContent = res.data.errors.join('; '); errEl.style.display = 'block';
        errEl.style.color = '#EAB308';
      }
      loadOverstock();
    })
    .catch(function(err) { errEl.textContent = err.message; errEl.style.display = 'block'; });
}

function ackOverstock(id) {
  fetch('/restock-want-list/overstock/acknowledge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id })
  }).then(function() { loadOverstock(); }).catch(function(err) { alert('Error: ' + err.message); });
}

function rewatchOverstock(id) {
  fetch('/restock-want-list/overstock/rewatch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id })
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      if (!res.ok) {
        var errEl = document.getElementById('overstock-err-' + id);
        if (errEl) { errEl.textContent = res.data.error || 'Error'; errEl.style.display = 'block'; }
        return;
      }
      loadOverstock();
    })
    .catch(function(err) { alert('Error: ' + err.message); });
}

function deleteOverstock(id) {
  if (!confirm('Remove overstock tracking for this group?')) return;
  fetch('/restock-want-list/overstock/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id })
  }).then(function() { loadOverstock(); }).catch(function(err) { alert('Error: ' + err.message); });
}

function editRestockTarget(groupId, current, stock) {
  var el = document.getElementById('restock-target-row-' + groupId);
  el.innerHTML = 'Restock at: <input type="number" id="restock-edit-' + groupId + '" value="' + current + '" min="0" max="' + Math.max(stock - 1, 0) + '" style="width:42px;padding:2px 4px;border:1px solid #dc2626;border-radius:4px;background:#1a1a1a;color:#F0F0F0;font-size:11px;text-align:center"> <button onclick="saveRestockTarget(' + groupId + ')" style="padding:2px 8px;border:1px solid #22c55e;border-radius:4px;background:#1a1a1a;color:#22c55e;font-size:10px;cursor:pointer">Save</button> <button onclick="loadOverstock()" style="padding:2px 8px;border:1px solid #333;border-radius:4px;background:#1a1a1a;color:#6B7280;font-size:10px;cursor:pointer">Cancel</button>';
  document.getElementById('restock-edit-' + groupId).focus();
}

function saveRestockTarget(groupId) {
  var input = document.getElementById('restock-edit-' + groupId);
  var val = parseInt(input.value);
  if (isNaN(val) || val < 0) { alert('Invalid target'); return; }
  fetch('/restock-want-list/overstock/update-target', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: groupId, restockTarget: val })
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      if (!res.ok) { alert(res.data.error || 'Error'); return; }
      loadOverstock();
    })
    .catch(function(err) { alert('Error: ' + err.message); });
}

function loadSuggestions() {
  var btn = document.getElementById('suggestBtn');
  btn.disabled = true; btn.textContent = 'Searching...';
  var el = document.getElementById('suggestionsContent');

  fetch('/restock-want-list/overstock/suggestions')
    .then(function(r) { return r.json(); })
    .then(function(items) {
      btn.disabled = false; btn.textContent = 'Find High-Quantity Listings';
      if (!items || items.length === 0) {
        el.innerHTML = '<div style="text-align:center;font-size:11px;color:#6B7280;padding:8px">No high-quantity listings found (all items are quantity 1)</div>';
        return;
      }
      var h = '<div class="card" style="padding:10px">';
      h += '<div style="font-size:10px;color:#6B7280;font-weight:700;text-transform:uppercase;margin-bottom:6px">' + items.length + ' high-quantity listings</div>';
      items.forEach(function(item, idx) {
        h += '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #1f1f1f;font-size:11px">';
        h += '<input type="checkbox" class="suggest-check" data-id="' + esc(item.ebayItemId) + '" style="accent-color:#dc2626">';
        h += '<input type="number" class="suggest-target" data-id="' + esc(item.ebayItemId) + '" value="1" min="0" max="' + (item.quantity - 1) + '" style="width:42px;padding:3px 4px;border:1px solid #333;border-radius:4px;background:#1a1a1a;color:#F0F0F0;font-size:11px;text-align:center">';
        h += '<div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d1d5db">' + esc(item.title) + '</div>';
        h += '<span style="color:#EAB308;font-weight:700;white-space:nowrap">Qty: ' + item.quantity + '</span>';
        if (item.currentPrice) h += '<span style="color:#22c55e;white-space:nowrap">$' + Math.round(item.currentPrice) + '</span>';
        h += '</div>';
      });
      h += '<button class="btn-add" style="margin-top:8px;font-size:11px;padding:6px 12px;width:100%" onclick="trackSelectedSuggestions()">Track Selected</button>';
      h += '</div>';
      el.innerHTML = h;
    })
    .catch(function(err) {
      btn.disabled = false; btn.textContent = 'Find High-Quantity Listings';
      el.innerHTML = '<div style="color:#EF4444;font-size:11px;padding:4px">Error: ' + err.message + '</div>';
    });
}

function trackSelectedSuggestions() {
  var checks = document.querySelectorAll('.suggest-check:checked');
  if (checks.length === 0) { alert('Select at least one listing'); return; }
  var promises = [];
  checks.forEach(function(cb) {
    var id = cb.getAttribute('data-id');
    var targetInput = document.querySelector('.suggest-target[data-id="' + id + '"]');
    var target = targetInput ? (parseInt(targetInput.value) || 1) : 1;
    promises.push(
      fetch('/restock-want-list/overstock/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ebayItemIds: [id], restockTarget: target })
      }).then(function(r) { return r.json(); })
    );
  });
  Promise.all(promises).then(function() {
    document.getElementById('suggestionsContent').innerHTML = '';
    loadOverstock();
  }).catch(function(err) { alert('Error: ' + err.message); });
}

// Pre-load overstock badge count on page load (badge only, don't mark as loaded)
fetch('/restock-want-list/overstock')
  .then(function(r) { return r.json(); })
  .then(function(groups) {
    if (Array.isArray(groups)) {
      overstockItems = groups;
      updateOverstockBadge();
    }
  })
  .catch(function() {});
</script>
</body>
</html>

```

## FILE: service/public/restock.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DarkHawk — THE QUARRY</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh}
  header{background:#141414;border-bottom:1px solid #2a2a2a;padding:14px 20px;display:flex;align-items:center;justify-content:space-between}
  header h1{font-size:18px;font-weight:700;letter-spacing:-0.03em;color:#F0F0F0}
  header .sub{font-size:11px;color:#9CA3AF;margin-top:1px}
  .nav{font-size:12px;display:flex;gap:12px}
  .nav a{color:#9CA3AF;text-decoration:none}.nav a:hover{color:#F0F0F0}
  .summary{display:flex;gap:8px;padding:12px 20px;flex-wrap:wrap}
  .stat{background:#141414;border:1px solid #2a2a2a;border-radius:6px;padding:8px 12px;min-width:80px}
  .stat-label{font-size:9px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em}
  .stat-value{font-size:18px;font-weight:800;margin-top:1px}
  .sg{color:#16a34a}.sy{color:#ca8a04}.so{color:#ea580c}.sr{color:#dc2626}.sgr{color:#6B7280}
  .section{padding:0 20px 12px}
  .section-header{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;padding:8px 0;border-bottom:1px solid #2a2a2a;margin-bottom:4px;display:flex;justify-content:space-between}
  .sh-green{color:#16a34a}.sh-yellow{color:#ca8a04}.sh-orange{color:#ea580c}.sh-red{color:#dc2626}.sh-grey{color:#6B7280}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{text-align:left;padding:4px 6px;color:#6B7280;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #2a2a2a}
  td{padding:5px 6px;border-bottom:1px solid #1f1f1f;color:#d1d5db}
  tr:hover td{background:#1a1a1a}
  .badge{font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;white-space:nowrap}
  .b-green{background:#064e3b;color:#16a34a}.b-yellow{background:#713f12;color:#a16207}.b-orange{background:#7c2d12;color:#c2410c}.b-red{background:#7f1d1d;color:#dc2626}.b-grey{background:#1f2937;color:#6B7280}
  .mono{font-family:monospace;font-size:10px}
  .profit-pos{color:#16a34a}.profit-neg{color:#dc2626}
  .sold-out{color:#dc2626;font-size:10px;font-weight:600}
  .loading{text-align:center;padding:40px;color:#6B7280}
  .spinner{width:24px;height:24px;border:2px solid #e5e7eb;border-top-color:#16a34a;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 10px}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('quarry')</script>
<div style="padding:6px 16px;background:#0a0a0a;border-bottom:1px solid #2a2a2a;">
  <p id="sub" style="font-size:11px;color:#6B7280;">Loading...</p>
</nav>
<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 16px;background:#0a0a0a;border-bottom:1px solid #2a2a2a;font-size:12px;color:#6B7280;">
  <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Period:</span>
  <button class="toggle-btn" onclick="setPeriod(7)" id="pd-7">7d</button>
  <button class="toggle-btn active" onclick="setPeriod(30)" id="pd-30">30d</button>
  <button class="toggle-btn" onclick="setPeriod(60)" id="pd-60">60d</button>
  <button class="toggle-btn" onclick="setPeriod(90)" id="pd-90">90d</button>
</div>
<style>
  .toggle-btn{padding:5px 12px;border-radius:6px;border:1px solid #2a2a2a;background:#1a1a1a;color:#6B7280;font-size:11px;font-weight:600;cursor:pointer}
  .toggle-btn.active{background:#064e3b;color:#16a34a;border-color:#bbf7d0}
</style>
<div class="summary" id="summary"></div>
<div id="content"><div class="loading"><div class="spinner"></div>Generating report...</div></div>
<script>
const TIER_CONFIG = {
  green:  { icon: '🟢', label: 'RESTOCK NOW',   badge: 'b-green',  header: 'sh-green' },
  yellow: { icon: '🟡', label: 'STRONG BUY',    badge: 'b-yellow', header: 'sh-yellow' },
  orange: { icon: '🟠', label: 'CONSIDER',      badge: 'b-orange', header: 'sh-orange' },
};

let currentDays = 30;
let foundItems = {};
let hideFound = false;

function setPeriod(days) {
  currentDays = days;
  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('pd-' + days).classList.add('active');
  load();
}

function toggleHideFound() {
  hideFound = document.getElementById('hideFoundCb').checked;
  load();
}

// Check if a report item has been FOUND (pulled from a yard via Scout Alerts)
function getFoundInfo(item) {
  // Match by sample title prefix (same key used in alert generation)
  const key = (item.sampleTitle || '').substring(0, 40).toLowerCase();
  return foundItems[key] || null;
}

async function load() {
  document.getElementById('content').innerHTML = '<div class="loading"><div class="spinner"></div>Generating report...</div>';
  try {
    const [reportRes, foundRes] = await Promise.all([
      fetch('/restock/report?days=' + currentDays).then(r => r.json()),
      fetch('/restock/found-items').then(r => r.json()).catch(() => ({ found: {} })),
    ]);
    const d = reportRes;
    foundItems = foundRes.found || {};
    if (!d.success) throw new Error(d.error);

    const foundCount = Object.keys(foundItems).length;
    const listingsNote = d.summary.activeListings != null ? ' | ' + d.summary.activeListings + ' active listings' : '';
    document.getElementById('sub').textContent = (d.period || 'Last 30 days') + ' — ' + d.summary.total + ' restock candidates (' + (d.summary.salesAnalyzed || 0) + ' sales analyzed' + listingsNote + ')';

    let summaryHtml =
      `<div class="stat"><div class="stat-label">Restock Now</div><div class="stat-value sg">${d.summary.green}</div></div>` +
      `<div class="stat"><div class="stat-label">Strong Buy</div><div class="stat-value sy">${d.summary.yellow}</div></div>` +
      `<div class="stat"><div class="stat-label">Consider</div><div class="stat-value so">${d.summary.orange}</div></div>`;
    if (foundCount > 0) summaryHtml += `<div class="stat"><div class="stat-label">Found</div><div class="stat-value" style="color:#22c55e">${foundCount}</div></div>`;
    summaryHtml +=
      `<div class="stat"><div class="stat-label">Sales</div><div class="stat-value">${d.summary.salesAnalyzed || 0}</div></div>` +
      `<div class="stat"><div class="stat-label">Listings</div><div class="stat-value">${d.summary.activeListings || 0}</div></div>`;
    document.getElementById('summary').innerHTML = summaryHtml;

    let html = '';
    if (foundCount > 0) {
      html += `<div style="display:flex;justify-content:flex-end;padding:4px 8px;font-size:11px"><label style="color:#6B7280;cursor:pointer;display:flex;align-items:center;gap:4px"><input type="checkbox" id="hideFoundCb" onchange="toggleHideFound()" ${hideFound ? 'checked' : ''} style="accent-color:#22c55e"> Hide found</label></div>`;
    }
    for (const tier of ['green', 'yellow', 'orange']) {
      const items = d.tiers[tier] || [];
      if (items.length === 0) continue;
      const cfg = TIER_CONFIG[tier];
      html += renderSection(tier, cfg, items);
    }
    if (!html || html.indexOf('<table>') === -1) {
      html += '<div class="loading" style="padding:30px;">';
      if ((d.summary.salesAnalyzed || 0) === 0) {
        html += '<div style="font-size:14px;font-weight:600;color:#F0F0F0;margin-bottom:8px;">No sales found in the last ' + currentDays + ' days</div>';
        html += '<div style="font-size:12px;color:#9CA3AF;line-height:1.6;">Try a wider window, or sync your eBay data:<br>Settings > Sync > Your Data</div>';
        if (currentDays < 90) html += '<button class="toggle-btn" style="margin-top:12px;padding:8px 16px;" onclick="setPeriod(90)">Try Last 90 Days</button>';
      } else {
        html += 'All sold parts are well-stocked. No restock flags.';
      }
      html += '</div>';
    }
    document.getElementById('content').innerHTML = html;
  } catch (e) {
    document.getElementById('content').innerHTML = '<div class="loading">Error: ' + e.message + '</div>';
  }
}

function renderSection(tier, cfg, items) {
  const soldLabel = 'Sold ' + currentDays + 'd';
  // Filter out found items if hideFound is on
  const visibleItems = hideFound ? items.filter(i => !getFoundInfo(i)) : items;
  if (visibleItems.length === 0) return '';

  let h = `<div class="section">
    <div class="section-header ${cfg.header}">
      <span>${cfg.icon} ${cfg.label} (${visibleItems.length})</span>
      <span style="font-size:9px;color:#6B7280">Score ${tier === 'green' ? '75+' : tier === 'yellow' ? '60-74' : '40-59'}</span>
    </div>
    <table><tr>
      <th>Score</th><th>Action</th><th>Vehicle</th><th>Part</th><th>Part #</th>
      <th>${soldLabel}</th><th>Stock</th><th>Avg $</th><th>Rev</th>
    </tr>`;
  for (const i of visibleItems) {
    const vehicle = [i.yearRange, i.make, i.model].filter(Boolean).join(' ');
    const pn = i.basePn || (i.variantPns && i.variantPns[0]) || '';
    const found = getFoundInfo(i);

    // FOUND banner — full-width green bar
    if (found) {
      const fDate = found.date ? new Date(found.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : '';
      h += `<tr><td colspan="9" style="padding:0"><div style="background:#064e3b;border:2px solid #22c55e;border-radius:6px;padding:8px 12px;margin:4px 0;display:flex;align-items:center;justify-content:space-between">
        <span style="color:#22c55e;font-weight:800;font-size:12px;letter-spacing:0.05em">FOUND — Pulled from ${found.yard || 'yard'}</span>
        <span style="color:#86efac;font-size:10px">${fDate ? 'Found ' + fDate : ''} ${found.vehicle ? '(' + found.vehicle + ')' : ''}</span>
      </div></td></tr>`;
    }

    h += `<tr${found ? ' style="opacity:0.5"' : ''}>
      <td><span class="badge ${cfg.badge}">${i.score}</span></td>
      <td style="font-size:10px;font-weight:600">${found ? 'INCOMING' : i.action}</td>
      <td style="font-weight:600">${vehicle || i.make}</td>
      <td style="font-weight:600">${i.partType}</td>
      <td class="mono" style="max-width:100px;overflow:hidden;text-overflow:ellipsis" title="${pn}">${pn}</td>
      <td style="font-weight:600">${i.sold7d}</td>
      <td>${i.activeStock}</td>
      <td>$${i.avgPrice}</td>
      <td>$${Math.round(i.revenue).toLocaleString()}</td>
    </tr>`;
    if (i.sampleTitle) {
      h += `<tr${found ? ' style="opacity:0.5"' : ''}><td colspan="9" style="font-size:10px;color:#9CA3AF;padding:1px 6px 4px">${i.sampleTitle.substring(0,90)}</td></tr>`;
    }
  }
  h += '</table></div>';
  return h;
}

load();
</script>
</body>
</html>

```

## FILE: service/public/sales.html
```html
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"><meta name="theme-color" content="#0a0a0a"><title>DarkHawk - THE QUARRY</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh}.placeholder{text-align:center;padding:80px 20px}.placeholder h2{font-size:24px;font-weight:800;margin-bottom:8px}.placeholder p{color:#6b7280;font-size:14px}</style></head><body>
<div id="dh-nav"></div>
<div class="placeholder"><h2>THE QUARRY</h2><p>Sold item intelligence - what moved, what's hot, pricing trends.</p><p style="margin-top:20px;color:#DC2626;font-weight:600">Coming soon</p></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('quarry')</script>
</body></html>

```

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
var _alertLookup = {};

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

function claimAlert(id, claimed, alertData) {
  if (!claimed && !confirm('Unmark this as pulled?')) return;
  if (claimed && alertData) {
    // Route through The Cache — CacheService marks the alert as claimed server-side
    fetch('/cache/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      partDescription: alertData.source_title || null,
      vehicle: { year: alertData.vehicle_year || null, make: alertData.vehicle_make || null, model: alertData.vehicle_model || null },
      yard: { name: alertData.yard_name || null, row: alertData.row || null },
      estimatedValue: alertData.part_value || null,
      source: 'scout_alert',
      sourceId: String(id),
    }) })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.success) load(currentPage); })
      .catch(function(err) { alert('Error: ' + err.message); });
  } else {
    // Unclaim — route through original endpoint
    fetch('/scout-alerts/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, claimed: false }) })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.success) load(currentPage); })
      .catch(function(err) { alert('Error: ' + err.message); });
  }
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
          _alertLookup[a.id] = a;
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
          h += '<div class="claim-check' + (isClaimed ? ' checked' : '') + '" onclick="claimAlert(' + a.id + ',' + !isClaimed + ',_alertLookup[' + a.id + '])">' + checkSvg + '</div>';
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

## FILE: service/public/stale-inventory.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk — CARCASS</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh}
.container{padding:12px;max-width:800px;margin:0 auto}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:10px}
.tabs{display:flex;gap:4px;margin-bottom:10px}
.tab{padding:8px 14px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#6B7280;font-size:12px;font-weight:700;cursor:pointer}
.tab.active{color:#ef4444;border-color:#ef4444}
.btn-sm{padding:5px 10px;font-size:10px;border-radius:4px;border:1px solid #333;background:#1a1a1a;color:#d1d5db;cursor:pointer}
.btn-sm:disabled{opacity:.3}
.btn-danger{border-color:#ef4444;color:#ef4444}
.btn-warn{border-color:#f59e0b;color:#f59e0b}
.btn-green{border-color:#22c55e;color:#22c55e}
.spinner{width:16px;height:16px;border:2px solid #333;border-top-color:#ef4444;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;color:#6B7280;padding:20px;font-size:13px}
.item-card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:10px;margin-bottom:8px}
.badge{font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px}
table{width:100%;border-collapse:collapse;font-size:11px}
th{text-align:left;padding:6px;color:#6B7280;font-size:9px;text-transform:uppercase;border-bottom:1px solid #2a2a2a}
td{padding:6px;border-bottom:1px solid #1f1f1f}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('carcass')</script>
<div class="container">
  <div class="card" style="border-color:#ef4444">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:10px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:0.06em">CARCASS</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px">End, relist, or reduce stale listings</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn-sm" onclick="runAutomation(this)">Run Auto</button>
        <button class="btn-sm btn-danger" id="bulkEndBtn" onclick="bulkEnd()" style="display:none">End Selected</button>
      </div>
    </div>
  </div>
  <div class="tabs">
    <div class="tab active" onclick="showTab('candidates',this)">CANDIDATES</div>
    <div class="tab" onclick="showTab('history',this)">HISTORY</div>
  </div>
  <div id="candidatesTab">
    <div id="candLoading" style="text-align:center;padding:20px"><div class="spinner"></div></div>
    <div id="candContent" style="display:none"></div>
  </div>
  <div id="historyTab" style="display:none">
    <div id="histLoading" style="text-align:center;padding:20px"><div class="spinner"></div></div>
    <div id="histContent" style="display:none"></div>
  </div>
</div>
<script>
var selectedIds=new Set();

function showTab(t,el){
  document.querySelectorAll('.tab').forEach(function(b){b.classList.remove('active')});
  el.classList.add('active');
  document.getElementById('candidatesTab').style.display=t==='candidates'?'block':'none';
  document.getElementById('historyTab').style.display=t==='history'?'block':'none';
  if(t==='history')loadHistory();
}

function loadCandidates(){
  document.getElementById('candLoading').style.display='block';
  document.getElementById('candContent').style.display='none';
  fetch('/stale-inventory/candidates').then(function(r){return r.json()}).then(function(d){
    document.getElementById('candLoading').style.display='none';
    document.getElementById('candContent').style.display='block';
    if(!d.success||!d.candidates||d.candidates.length===0){
      document.getElementById('candContent').innerHTML='<div class="empty">No stale candidates. All listings are healthy.</div>';
      return;
    }
    var h='<div style="font-size:11px;color:#6B7280;margin-bottom:8px">'+d.total+' listings need attention</div>';
    d.candidates.forEach(function(c){
      var recColor=c.recommendation==='end'?'#ef4444':c.recommendation==='deep_discount'?'#f59e0b':'#6B7280';
      var recLabel=c.recommendation==='end'?'END':c.recommendation==='deep_discount'?'DEEP DISCOUNT':c.recommendation==='reduce'?'REDUCE':'MONITOR';
      h+='<div class="item-card">';
      h+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">';
      h+='<div style="flex:1;min-width:0"><input type="checkbox" style="margin-right:6px" onchange="toggleSelect(\''+c.ebayItemId+'\')">';
      h+='<span style="font-size:12px;font-weight:600">'+esc(c.title||'').substring(0,70)+'</span>';
      h+='<div style="font-size:10px;color:#6B7280;margin-top:2px">$'+c.currentPrice.toFixed(2)+' · '+c.daysListed+'d listed · '+c.reductionCount+' reductions'+(c.isProgrammed?' · <span style="color:#a78bfa">PROGRAMMED</span>':'')+'</div>';
      h+='</div>';
      h+='<span class="badge" style="color:'+recColor+';border:1px solid '+recColor+';background:transparent">'+recLabel+'</span>';
      h+='</div>';
      h+='<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">';
      h+='<button class="btn-sm btn-warn" onclick="revise(\''+c.ebayItemId+'\','+c.currentPrice+',0.9,this)">-10%</button>';
      h+='<button class="btn-sm btn-warn" onclick="revise(\''+c.ebayItemId+'\','+c.currentPrice+',0.8,this)">-20%</button>';
      h+='<button class="btn-sm btn-danger" onclick="endItem(\''+c.ebayItemId+'\',this)">End</button>';
      h+='<button class="btn-sm btn-green" onclick="relistItem(\''+c.ebayItemId+'\',this)">Relist</button>';
      h+='</div></div>';
    });
    document.getElementById('candContent').innerHTML=h;
    document.getElementById('bulkEndBtn').style.display='inline-block';
  }).catch(function(e){
    document.getElementById('candLoading').style.display='none';
    document.getElementById('candContent').innerHTML='<div class="empty" style="color:#ef4444">Error: '+e.message+'</div>';
  });
}

function loadHistory(){
  document.getElementById('histLoading').style.display='block';
  document.getElementById('histContent').style.display='none';
  fetch('/stale-inventory/actions?limit=50').then(function(r){return r.json()}).then(function(d){
    document.getElementById('histLoading').style.display='none';
    document.getElementById('histContent').style.display='block';
    if(!d.success||!d.actions||d.actions.length===0){
      document.getElementById('histContent').innerHTML='<div class="empty">No actions taken yet.</div>';return;
    }
    var h='<table><thead><tr><th>Date</th><th>Item</th><th>Action</th><th>Old $</th><th>New $</th></tr></thead><tbody>';
    d.actions.forEach(function(a){
      var date=a.createdAt?new Date(a.createdAt).toLocaleDateString():'—';
      h+='<tr><td>'+date+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(a.title||a.ebay_item_id||'')+'</td>';
      h+='<td><span class="badge" style="background:#1a1a1a;color:'+(a.action_type==='end'?'#ef4444':'#f59e0b')+'">'+esc(a.action_type||'')+'</span></td>';
      h+='<td>'+(a.old_price?'$'+parseFloat(a.old_price).toFixed(2):'—')+'</td>';
      h+='<td>'+(a.new_price?'$'+parseFloat(a.new_price).toFixed(2):'—')+'</td></tr>';
    });
    h+='</tbody></table>';
    document.getElementById('histContent').innerHTML=h;
  }).catch(function(e){document.getElementById('histContent').innerHTML='<div class="empty">Error</div>';});
}

function revise(id,price,mult,btn){
  var newP=Math.round(price*mult*100)/100;
  if(!confirm('Reduce to $'+newP.toFixed(2)+'?'))return;
  btn.disabled=true;btn.textContent='...';
  fetch('/stale-inventory/revise-price',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ebayItemId:id,newPrice:newP})})
    .then(function(r){return r.json()}).then(function(d){
      if(d.success){btn.textContent='Done';btn.style.color='#22c55e';setTimeout(loadCandidates,1000);}
      else{btn.disabled=false;btn.textContent='Err';alert(d.error);}
    }).catch(function(){btn.disabled=false;btn.textContent='Err';});
}

function endItem(id,btn){
  if(!confirm('End this listing on eBay? This removes it from search.'))return;
  btn.disabled=true;btn.textContent='...';
  fetch('/stale-inventory/end-item',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ebayItemId:id})})
    .then(function(r){return r.json()}).then(function(d){
      if(d.success){btn.textContent='Ended';btn.style.color='#22c55e';setTimeout(loadCandidates,1000);}
      else{btn.disabled=false;btn.textContent='End';alert(d.error);}
    }).catch(function(){btn.disabled=false;btn.textContent='End';});
}

function relistItem(id,btn){
  if(!confirm('Relist this item? Creates a fresh listing with same details.'))return;
  btn.disabled=true;btn.textContent='...';
  fetch('/stale-inventory/relist-item',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ebayItemId:id})})
    .then(function(r){return r.json()}).then(function(d){
      if(d.success){btn.textContent='Relisted';btn.style.color='#22c55e';setTimeout(loadCandidates,1000);}
      else{btn.disabled=false;btn.textContent='Relist';alert(d.error);}
    }).catch(function(){btn.disabled=false;btn.textContent='Relist';});
}

function toggleSelect(id){if(selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);}

function bulkEnd(){
  if(selectedIds.size===0){alert('No items selected');return;}
  if(selectedIds.size>25){alert('Max 25 items per bulk end');return;}
  if(!confirm('End '+selectedIds.size+' listings on eBay?'))return;
  var btn=document.getElementById('bulkEndBtn');
  btn.disabled=true;btn.textContent='Ending...';
  fetch('/stale-inventory/bulk-end',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ebayItemIds:Array.from(selectedIds)})})
    .then(function(r){return r.json()}).then(function(d){
      btn.disabled=false;btn.textContent='End Selected';
      alert('Ended: '+d.totalEnded+', Failed: '+d.totalFailed);
      selectedIds.clear();loadCandidates();
    }).catch(function(){btn.disabled=false;btn.textContent='End Selected';});
}

function runAutomation(btn){
  btn.disabled=true;btn.textContent='Running...';
  fetch('/stale-inventory/run',{method:'POST'}).then(function(r){return r.json()}).then(function(){
    btn.disabled=false;btn.textContent='Run Auto';alert('Automation started in background');
  }).catch(function(){btn.disabled=false;btn.textContent='Run Auto';});
}

function esc(s){if(!s)return'';var d=document.createElement('div');d.textContent=s;return d.innerHTML;}

loadCandidates();
</script>
</body>
</html>

```

## FILE: service/public/test.html
```html
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test</title></head>
<body style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:40px;text-align:center">
<h1>test</h1>
<p style="color:#6B7280;font-size:12px">If you see this without a memory error, the phone is fine.</p>
</body></html>

```

## FILE: service/public/the-mark.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk — THE MARK</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh;display:flex;flex-direction:column}
.container{padding:12px;max-width:800px;margin:0 auto;width:100%;flex:1;display:flex;flex-direction:column}
.header-card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:12px}
.tool-frame{flex:1;min-height:calc(100vh - 250px);border:1px solid #2a2a2a;border-radius:10px;overflow:hidden;background:#141414}
.tool-frame iframe{width:100%;height:100%;border:none;min-height:calc(100vh - 250px)}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('mark')</script>
<div class="container">
  <div class="header-card">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:10px;font-weight:700;color:#DC2626;text-transform:uppercase;letter-spacing:0.06em">THE MARK</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px">Listing Intelligence</div>
      </div>
      <a href="https://listcleaner.dynatrackracingnc.workers.dev" target="_blank" rel="noopener" style="padding:6px 12px;font-size:11px;border-radius:4px;border:1px solid #333;background:#1a1a1a;color:#d1d5db;cursor:pointer;text-decoration:none">Open in new tab</a>
    </div>
  </div>
  <div class="tool-frame">
    <iframe src="https://listcleaner.dynatrackracingnc.workers.dev" allow="clipboard-read; clipboard-write"></iframe>
  </div>
</div>
</body>
</html>

```

## FILE: service/public/velocity.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk — VELOCITY</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh}
.container{padding:12px;max-width:800px;margin:0 auto}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:10px}
.stat-row{display:flex;gap:10px;margin-bottom:10px}
.stat-box{flex:1;background:#1a1a1a;border-radius:8px;padding:12px;text-align:center}
.stat-value{font-size:24px;font-weight:800}
.stat-label{font-size:10px;color:#6B7280;margin-top:2px;text-transform:uppercase;letter-spacing:0.05em}
.toggle-bar{display:flex;gap:4px;margin-bottom:10px}
.toggle-btn{padding:6px 12px;border:1px solid #333;border-radius:4px;background:#1a1a1a;color:#6B7280;font-size:11px;cursor:pointer}
.toggle-btn.active{color:#eab308;border-color:#eab308}
.spinner{width:16px;height:16px;border:2px solid #333;border-top-color:#eab308;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;color:#6B7280;padding:30px;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:8px;color:#6B7280;font-size:10px;text-transform:uppercase;border-bottom:1px solid #2a2a2a}
td{padding:8px;border-bottom:1px solid #1f1f1f}
.bar-chart{display:flex;align-items:flex-end;height:140px;padding:8px 0 20px 0;overflow-x:auto;overflow-y:visible}
.bar{background:#eab308;border-radius:3px 3px 0 0;position:relative;cursor:pointer;flex-shrink:0}
.bar:hover{background:#f59e0b}
.bar-label{position:absolute;bottom:-16px;left:50%;transform:translateX(-50%);font-size:8px;color:#6B7280;white-space:nowrap}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('velocity')</script>
<div class="container">
  <div class="card" style="border-color:#eab308">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div>
        <div style="font-size:10px;font-weight:700;color:#eab308;text-transform:uppercase;letter-spacing:0.06em">VELOCITY INTELLIGENCE</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px">Sales velocity, health score, and top performers</div>
      </div>
    </div>
    <div class="toggle-bar">
      <button class="toggle-btn" onclick="setPeriod(30)">30d</button>
      <button class="toggle-btn" onclick="setPeriod(60)">60d</button>
      <button class="toggle-btn active" onclick="setPeriod(90)">90d</button>
      <button class="toggle-btn" onclick="setPeriod(180)">180d</button>
      <button class="toggle-btn" onclick="setPeriod(365)">1yr</button>
      <button class="toggle-btn" onclick="setPeriod(0)">All Time</button>
    </div>
    <div id="loading" style="text-align:center;padding:16px"><div class="spinner"></div></div>
    <div id="content" style="display:none">
      <div class="stat-row">
        <div class="stat-box" id="healthBox"><div class="stat-value" id="healthScore">—</div><div class="stat-label">Health Score</div></div>
        <div class="stat-box"><div class="stat-value" id="sellThrough">—</div><div class="stat-label">Sell-Through %</div></div>
        <div class="stat-box"><div class="stat-value" id="activeCount">—</div><div class="stat-label">Active Listings</div></div>
        <div class="stat-box"><div class="stat-value" id="totalSales">—</div><div class="stat-label">Total Sales</div></div>
        <div class="stat-box"><div class="stat-value" id="avgWeekly">—</div><div class="stat-label">Avg/Week</div></div>
      </div>
      <div class="card">
        <div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;margin-bottom:8px">Weekly Sales</div>
        <div id="chartArea" class="bar-chart"></div>
      </div>
      <div class="card">
        <div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;margin-bottom:8px">Top Performers</div>
        <table>
          <thead><tr><th>#</th><th>Part</th><th>Sold</th><th>Revenue</th><th>Avg $</th></tr></thead>
          <tbody id="topTable"></tbody>
        </table>
      </div>
    </div>
  </div>
</div>
<script>
var currentPeriod = 90;

function setPeriod(days) {
  currentPeriod = days;
  document.querySelectorAll('.toggle-btn').forEach(function(b) { b.classList.remove('active'); });
  event.target.classList.add('active');
  load();
}

function load() {
  document.getElementById('loading').style.display = 'block';
  document.getElementById('content').style.display = 'none';

  Promise.all([
    fetch('/demand-analysis/health').then(function(r) { return r.json(); }),
    fetch('/demand-analysis/public/velocity?days=' + currentPeriod).then(function(r) { return r.json(); }),
    fetch('/demand-analysis/public/sell-through?days=' + currentPeriod).then(function(r) { return r.json(); }),
    fetch('/demand-analysis/public/top-performers?limit=25&days=' + currentPeriod).then(function(r) { return r.json(); }),
  ]).then(function(results) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';

    var health = results[0].dashboard || {};
    var velocity = results[1];
    var sellThrough = results[2];
    var topPerformers = results[3].items || [];

    // Health score
    var hs = health.healthScore || 0;
    var hsColor = hs >= 80 ? '#22c55e' : hs >= 60 ? '#3b82f6' : hs >= 40 ? '#eab308' : '#ef4444';
    document.getElementById('healthScore').textContent = hs;
    document.getElementById('healthScore').style.color = hsColor;
    document.getElementById('healthBox').style.borderLeft = '3px solid ' + hsColor;

    // Sell-through
    document.getElementById('sellThrough').textContent = (sellThrough.sellThroughRate || 0).toFixed(1) + '%';
    document.getElementById('activeCount').textContent = sellThrough.activeListings || 0;

    // Total sales from velocity totals
    var totals = velocity.totals || {};
    document.getElementById('totalSales').textContent = (totals.count || 0).toLocaleString();

    // Avg weekly
    var trend = health.velocityTrend || {};
    document.getElementById('avgWeekly').textContent = trend.avgWeeklySales || 0;

    // Chart
    var weeks = velocity.yourVelocity || [];
    var chartArea = document.getElementById('chartArea');
    if (weeks.length === 0) {
      chartArea.innerHTML = '<div class="empty">No velocity data yet</div>';
    } else {
      var maxSales = Math.max.apply(null, weeks.map(function(w) { return w.salesCount; })) || 1;
      var chartWidth = chartArea.parentElement.offsetWidth || 600;
      var naturalWidth = Math.floor((chartWidth - (weeks.length * 2)) / weeks.length);
      var barWidth = naturalWidth < 14 ? 14 : naturalWidth > 60 ? 60 : naturalWidth;
      var showLabels = barWidth >= 22;
      var html = '';
      weeks.forEach(function(w) {
        var pct = (w.salesCount / maxSales) * 100;
        var weekLabel = new Date(w.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        var labelHtml = showLabels ? '<div class="bar-label">' + weekLabel + '</div>' : '';
        html += '<div class="bar" style="height:' + Math.max(4, pct) + '%;width:' + barWidth + 'px;margin-right:2px" title="' + weekLabel + ': ' + w.salesCount + ' sales, $' + Math.round(w.totalRevenue) + ' rev">' + labelHtml + '</div>';
      });
      chartArea.innerHTML = html;
    }

    // Top performers table
    var tbody = document.getElementById('topTable');
    if (topPerformers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No sales data</td></tr>';
    } else {
      var rows = '';
      topPerformers.forEach(function(p, i) {
        rows += '<tr><td style="color:#6B7280">' + (i + 1) + '</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.title || '') + '</td><td style="font-weight:700">' + p.salesCount + '</td><td style="color:#22c55e">$' + Math.round(p.totalRevenue).toLocaleString() + '</td><td>$' + Math.round(p.avgPrice) + '</td></tr>';
      });
      tbody.innerHTML = rows;
    }
  }).catch(function(err) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
    document.getElementById('content').innerHTML = '<div class="empty" style="color:#ef4444">Error: ' + err.message + '</div>';
  });
}

function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

load();
</script>
</body>
</html>

```

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
      h+='<div style="display:flex;align-items:center;gap:8px;margin-top:3px"><span style="font-size:10px;color:#9CA3AF">'+p.stk+' in stock · '+p.sold+'x sold · Last '+ta(p.last)+'</span>';
      h+='<button onclick="pullFromHawkEye(\''+esc(p.pt)+'\',this)" style="padding:4px 10px;border-radius:6px;border:1px solid #2a2a2a;background:#1a1a1a;color:#d1d5db;font-size:10px;font-weight:700;cursor:pointer;min-height:28px">Pull</button></div>';
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

  // Cached parts notice
  if(data.cachedParts&&data.cachedParts.length>0){
    h+='<div class="card" style="background:#422006;border:1px solid #92400e">';
    h+='<div style="color:#eab308;font-size:11px;font-weight:700;margin-bottom:4px">\u26A1 IN THE CACHE</div>';
    data.cachedParts.forEach(function(c){
      h+='<div style="font-size:12px;color:#d1d5db;margin-top:4px">';
      h+=(c.partType||'Part')+' \u2014 claimed by '+(c.claimedBy||'?')+' via '+c.source+' \u00b7 '+ta(c.claimedAt);
      if(c.yardName)h+=' \u00b7 '+c.yardName;
      h+='</div>';
    });
    h+='</div>';
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

function pullFromHawkEye(partType,btn){
  btn.disabled=true;btn.textContent='Caching...';
  fetch('/cache/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    partType:partType,
    partDescription:partType+' \u2014 '+(_lastYear||'')+' '+(_lastMake||'')+' '+(_lastModel||''),
    vehicle:{year:_lastYear||null,make:_lastMake||null,model:_lastModel||null,vin:_lastVin||null},
    source:'hawk_eye',
    sourceId:_lastVin||null,
  })}).then(function(r){return r.json()}).then(function(d){
    if(d.success){btn.textContent='Cached \u2713';btn.style.background='#064e3b';btn.style.color='#22c55e';btn.style.borderColor='#065f46';}
    else{btn.disabled=false;btn.textContent='Pull';}
  }).catch(function(){btn.disabled=false;btn.textContent='Pull';});
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

