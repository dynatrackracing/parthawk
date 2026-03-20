import React, { useEffect, useState } from "react";
import FadeIn from "react-fade-in";
import AutoSearchForm from "../AutoSearchForm/AutoSearchForm";
import axios from "../../utils/axios";

const StatCard = ({ label, value, sub }) => (
  <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '12px 16px', flex: 1, minWidth: '120px' }}>
    <div style={{ fontSize: '10px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
    <div style={{ fontSize: '22px', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.03em', marginTop: '2px' }}>{value}</div>
    {sub && <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px' }}>{sub}</div>}
  </div>
);

const Home = () => {
  const [stats, setStats] = useState(null);

  useEffect(() => {
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
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
            Vehicle Search
          </div>
          <AutoSearchForm />
        </div>

        {/* Quick links */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          {[
            { label: 'Attack List', href: '/admin/pull' },
            { label: 'Price Check', href: '/intelligence/price-check' },
            { label: 'Stale Inventory', href: '/intelligence/stale-inventory' },
            { label: 'Your Sales', href: '/intelligence/your-sales' },
            { label: 'Gate Calculator', href: '/admin/gate' },
            { label: 'VIN Scanner', href: '/admin/vin' },
          ].map(link => (
            <a key={link.href} href={link.href}
              style={{ padding: '8px 14px', background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', color: '#94a3b8', fontSize: '12px', fontWeight: 600, textDecoration: 'none', transition: 'color 0.15s' }}
              onMouseOver={e => e.target.style.color = '#f1f5f9'}
              onMouseOut={e => e.target.style.color = '#94a3b8'}
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </FadeIn>
  );
};

export default Home;
