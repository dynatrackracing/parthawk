import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "../../utils/axios";

function MarketDashboard() {
  const [stats, setStats] = useState({ listings: 0, sales: 0, staleCount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      // Get basic counts from your data
      const [listingsRes, salesRes] = await Promise.all([
        axios.get("/sync/your-listings").catch(() => ({ data: { listings: [] } })),
        axios.get("/sync/your-sales").catch(() => ({ data: { sales: [] } })),
      ]);

      const listings = listingsRes.data.listings || [];
      const sales = salesRes.data.sales || [];
      const staleCount = listings.filter(l => l.daysListed >= 60).length;

      setStats({
        listings: listings.length,
        sales: sales.length,
        staleCount,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl text-gray-800 font-bold">
          Sales Intelligence
        </h1>
        <p className="text-gray-500 mt-1">
          Tools to help you price, identify stale inventory, and find opportunities
        </p>
      </div>

      {/* 4 Business Need Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* How to Price */}
        <Link
          to="/intelligence/price-check"
          className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow border-l-4 border-green-500"
        >
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">Price Check</h2>
              <p className="text-sm text-gray-500 mt-1">
                How should I price this?
              </p>
              <p className="text-2xl font-bold text-gray-900 mt-4">
                {stats.listings.toLocaleString()}
              </p>
              <p className="text-sm text-gray-500">active listings</p>
            </div>
            <div className="bg-green-100 rounded-full p-3">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="mt-4 text-sm text-green-600 font-medium">
            Check market prices →
          </div>
        </Link>

        {/* Dead Inventory */}
        <Link
          to="/intelligence/stale-inventory"
          className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow border-l-4 border-yellow-500"
        >
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">Stale Inventory</h2>
              <p className="text-sm text-gray-500 mt-1">
                What's sitting too long?
              </p>
              <p className="text-2xl font-bold text-gray-900 mt-4">
                {stats.staleCount}
              </p>
              <p className="text-sm text-gray-500">items 60+ days</p>
            </div>
            <div className="bg-yellow-100 rounded-full p-3">
              <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="mt-4 text-sm text-yellow-600 font-medium">
            Review stale items →
          </div>
        </Link>

        {/* What to Pull - Coming Soon */}
        <div className="bg-gray-50 rounded-lg shadow p-6 border-l-4 border-gray-300 opacity-60">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-600">What to Pull</h2>
              <p className="text-sm text-gray-400 mt-1">
                What parts to grab at the junkyard?
              </p>
              <p className="text-sm text-gray-400 mt-4">
                Collecting market data...
              </p>
            </div>
            <div className="bg-gray-200 rounded-full p-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-400">
            Coming soon
          </div>
        </div>

        {/* Opportunities - Coming Soon */}
        <div className="bg-gray-50 rounded-lg shadow p-6 border-l-4 border-gray-300 opacity-60">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-600">Opportunities</h2>
              <p className="text-sm text-gray-400 mt-1">
                What's selling that I don't have?
              </p>
              <p className="text-sm text-gray-400 mt-4">
                Collecting market data...
              </p>
            </div>
            <div className="bg-gray-200 rounded-full p-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-400">
            Coming soon
          </div>
        </div>
      </div>

      {/* Sales Summary */}
      <div className="mt-8 bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Your Sales</h2>
        <div className="flex items-baseline">
          <span className="text-3xl font-bold text-gray-900">{stats.sales.toLocaleString()}</span>
          <span className="ml-2 text-gray-500">sales imported</span>
        </div>
        <Link to="/intelligence/your-sales" className="mt-4 inline-block text-sm text-indigo-600 font-medium">
          View sales history →
        </Link>
      </div>
    </div>
  );
}

export default MarketDashboard;
