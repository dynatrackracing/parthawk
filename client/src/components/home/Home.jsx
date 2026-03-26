import React, { useEffect, useState } from "react";
import FadeIn from "react-fade-in";
import AutoSearchForm from "../AutoSearchForm/AutoSearchForm";
import axios from "../../utils/axios";

const StatCard = ({ label, value, sub }) => (
  <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '12px 16px', flex: 1, minWidth: '120px' }}>
    <div style={{ fontSize: '10px', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
    <div style={{ fontSize: '22px', fontWeight: 800, color: '#F0F0F0', letterSpacing: '-0.03em', marginTop: '2px' }}>{value}</div>
    {sub && <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '1px' }}>{sub}</div>}
  </div>
);

const Home = () => {
  const [stats, setStats] = useState(null);
  const [marketStatus, setMarketStatus] = useState(null);
  const [pricingRunning, setPricingRunning] = useState(false);

  useEffect(() => {
    // Fetch market pricing status
    axios.get("/api/market-price/status").then(res => setMarketStatus(res.data)).catch(() => {});

    const fetchStats = async () => {
      try {
        const [salesRes, yardRes] = await Promise.all([
          axios.get("/sync/your-sales/trends?daysBack=90&period=daily").catch(() => null),
          axios.get("/yards/status").catch(() => null),
        ]);
        const totals = salesRes?.data?.totals;
        const yards = yardRes?.data || [];
        const activeYards = yards.filter(y => y.vehicle_count > 0);
        const totalVehicles = activeYards.reduce((s, y) => s + (y.vehicle_count || 0), 0);
        setStats({
          sold90d: totals?.count || 0,
          revenue90d: totals?.revenue ? '$' + Math.round(parseFloat(totals.revenue)).toLocaleString() : '$0',
          avgPrice: totals?.avgPrice ? '$' + parseFloat(totals.avgPrice).toFixed(0) : '$0',
          yardVehicles: totalVehicles,
          activeYards: activeYards.length,
        });
      } catch (e) {
        setStats({ sold90d: '—', revenue90d: '—', avgPrice: '—', yardVehicles: '—', activeYards: '—' });
      }
    };
    fetchStats();
  }, []);

  return (
    <FadeIn delay={50}>
      <div style={{ padding: '16px 20px', maxWidth: '900px' }}>
        {/* Stats row */}
        {stats && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <StatCard label="Sold 90d" value={stats.sold90d} sub="units" />
            <StatCard label="Revenue 90d" value={stats.revenue90d} />
            <StatCard label="Avg Price" value={stats.avgPrice} sub="per unit" />
            <StatCard label="Yard Vehicles" value={stats.yardVehicles} sub={`${stats.activeYards} yards active`} />
          </div>
        )}

        {/* Search */}
        <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
            Vehicle Search
          </div>
          <AutoSearchForm />
        </div>

        {/* Quick links */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          {[
            { label: '🎯 DAILY FEED', href: '/admin/pull' },
            { label: '🦅 HAWK EYE', href: '/admin/vin' },
            { label: '🛡️ NEST PROTECTOR', href: '/admin/gate' },
            { label: '🦴 BONE PILE', href: '/admin/restock' },
            { label: '🪹 HUNTERS PERCH', href: '/admin/restock-list' },
            { label: '📡 SCOUT ALERTS', href: '/admin/scout-alerts' },
          ].map(link => (
            <a key={link.href} href={link.href}
              style={{ padding: '10px 16px', background: '#141414', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#9CA3AF', fontSize: '13px', fontWeight: 600, textDecoration: 'none', transition: 'all 0.15s', flex: '1', minWidth: '140px', textAlign: 'center' }}
              onMouseOver={e => { e.target.style.color = '#DC2626'; e.target.style.borderColor = '#DC2626'; }}
              onMouseOut={e => { e.target.style.color = '#9CA3AF'; e.target.style.borderColor = '#2a2a2a'; }}
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Market Pricing Controls */}
        <div style={{ marginTop: '12px', background: '#141414', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Market Pricing</div>
            <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
              {marketStatus?.lastRun
                ? `${marketStatus.cachedParts} parts cached · Updated ${new Date(marketStatus.lastRun).toLocaleDateString()}`
                : 'No market data yet'}
            </div>
          </div>
          <button
            onClick={async () => {
              setPricingRunning(true);
              try {
                await axios.post('/api/market-price/run-batch');
                setTimeout(() => { setPricingRunning(false); axios.get("/api/market-price/status").then(res => setMarketStatus(res.data)).catch(() => {}); }, 5000);
              } catch (e) { setPricingRunning(false); }
            }}
            disabled={pricingRunning}
            style={{ padding: '8px 16px', background: pricingRunning ? '#1a1a1a' : '#dc2626', border: '1px solid #333', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: pricingRunning ? 'default' : 'pointer', opacity: pricingRunning ? 0.5 : 1 }}
          >
            {pricingRunning ? 'Running...' : 'Refresh Market Prices'}
          </button>
        </div>
      </div>
    </FadeIn>
  );
};

export default Home;
