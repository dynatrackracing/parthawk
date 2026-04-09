/**
 * DarkHawk shared navigation - two-bar layout
 * Usage: <div id="dh-nav"></div><script src="/admin/dh-nav.js"></script><script>dhNav('feed')</script>
 * Active page keys: feed, alerts, vin, gate, scour, quarry, sky, perch, mark, velocity, instincts, prey-cycle, carcass
 */
function dhNav(activePage) {
  const field = [
    { key: 'feed',   label: 'DAILY FEED',      href: '/admin/pull' },
    { key: 'alerts', label: 'SCOUT ALERTS',     href: '/admin/scout-alerts' },
    { key: 'cache',  label: 'THE CACHE',        href: '/admin/the-cache' },
    { key: 'vin',    label: 'HAWK EYE',         href: '/admin/vin' },
    { key: 'gate',   label: 'NEST PROTECTOR',   href: '/admin/gate' },
  ];
  const intel = [
    { key: 'scour',  label: 'SCOUR STREAM',     href: '/admin/restock-list' },
    { key: 'quarry', label: 'THE QUARRY',        href: '/admin/restock' },
    { key: 'sky',    label: 'SKY WATCH',         href: '/admin/opportunities' },
    { key: 'perch',  label: 'HUNTERS PERCH',     href: '/admin/hunters-perch' },
    { key: 'mark',   label: 'THE MARK',          href: '/admin/the-mark' },
    { key: 'velocity', label: 'VELOCITY',       href: '/admin/velocity' },
    { key: 'instincts', label: 'INSTINCTS',     href: '/admin/instincts' },
    { key: 'prey-cycle', label: 'PREY-CYCLE',   href: '/admin/prey-cycle' },
    { key: 'carcass',  label: 'CARCASS',         href: '/admin/carcass' },
    { key: 'phoenix', label: '\uD83D\uDD25 PHOENIX',     href: '/admin/phoenix' },
    { key: 'blocked', label: 'BLOCKED',        href: '/admin/blocked-comps' },
  ];

  function linkHTML(item, isField) {
    const active = item.key === activePage;
    const color = active ? (isField ? '#DC2626' : '#eab308') : '#6b7280';
    const weight = active ? '700' : '500';
    return `<a href="${item.href}" style="color:${color};text-decoration:none;padding:5px 10px;border-radius:4px;white-space:nowrap;font-weight:${weight};font-size:11px;letter-spacing:.02em">${item.label}</a>`;
  }

  const html = `
<style>
  @media (max-width: 768px) { #dh-intel-row { display: none !important; } }
  #dh-intel-row a[href="/admin/carcass"] { display: none !important; }
</style>
<div style="background:#0a0a0a;position:sticky;top:0;z-index:100">
  <div style="text-align:center;padding:14px 16px 8px;background:#0a0a0a">
    <a href="/admin/home" style="text-decoration:none;display:inline-flex;align-items:center;gap:12px">
      <img src="/admin/darkhawk-logo-sm.png" style="height:50px;border-radius:8px;filter:drop-shadow(0 0 8px rgba(220,38,38,0.5))" alt="DH">
      <span style="font-size:22px;font-weight:900;letter-spacing:3px;color:#F0F0F0">DARK<span style="color:#DC2626">HAWK</span></span>
    </a>
  </div>
  <div id="dh-field-row" style="display:flex;justify-content:flex-start;gap:4px;padding:6px 10px;background:#0a0a0a;border-bottom:1px solid #1a1a1a;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch">
    <span style="font-size:9px;font-weight:700;color:#333;text-transform:uppercase;letter-spacing:.1em;padding:5px 4px;white-space:nowrap">FIELD</span>
    ${field.map(f => linkHTML(f, true)).join('')}
  </div>
  <div id="dh-intel-row" style="display:flex;justify-content:center;gap:4px;padding:5px 10px;background:#0a0a0a;border-bottom:1px solid #2a2a2a;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;position:relative">
    <span style="font-size:9px;font-weight:700;color:#333;text-transform:uppercase;letter-spacing:.1em;padding:5px 4px;white-space:nowrap">INTEL</span>
    ${intel.map(f => linkHTML(f, false)).join('')}
    <a href="/auth/logout" style="color:#6B7280;text-decoration:none;padding:5px 10px;white-space:nowrap;font-size:10px;position:absolute;right:10px;top:50%;transform:translateY(-50%)">Logout</a>
  </div>
</div>`;

  const el = document.getElementById('dh-nav');
  if (el) { el.innerHTML = html; }

  // Splash background — persists per session + body::before dim layer
  var sn = sessionStorage.getItem('splash');
  if (!sn) { sn = Math.floor(Math.random() * 8) + 1; sessionStorage.setItem('splash', sn); }
  document.body.style.backgroundImage = "url('/admin/images/splash-" + sn + ".jpg')";
  document.body.style.backgroundSize = 'cover';
  document.body.style.backgroundPosition = 'center';
  document.body.style.backgroundRepeat = 'no-repeat';
  document.body.style.backgroundAttachment = 'fixed';
  // Remove old overlay div if present (replaced by ::before)
  var oldOv = document.getElementById('dh-bg-overlay');
  if (oldOv) oldOv.remove();
  // Inject body::before style for dim layer (sits behind all content)
  if (!document.getElementById('dh-bg-style')) {
    var s = document.createElement('style');
    s.id = 'dh-bg-style';
    s.textContent = 'body::before{content:\"\";position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:0;pointer-events:none}body>*{position:relative;z-index:1}';
    document.head.appendChild(s);
  }
}
