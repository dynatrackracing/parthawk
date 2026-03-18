import React, { useState, useEffect } from "react";
import { useHistory } from "react-router-dom";

const API_URL = process.env.REACT_APP_API_URL || "";

function DemandDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [competitionKeywords, setCompetitionKeywords] = useState("");
  const [competitionAnalysis, setCompetitionAnalysis] = useState(null);
  const [analyzingCompetition, setAnalyzingCompetition] = useState(false);
  const history = useHistory();

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("userToken");
      const response = await fetch(`${API_URL}/demand-analysis/dashboard`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (data.success) {
        setDashboard(data.dashboard);
      } else {
        setError(data.error || "Failed to load dashboard");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const analyzeCompetition = async () => {
    if (!competitionKeywords.trim()) return;

    try {
      setAnalyzingCompetition(true);
      const token = localStorage.getItem("userToken");
      const response = await fetch(
        `${API_URL}/demand-analysis/competition/${encodeURIComponent(
          competitionKeywords
        )}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const data = await response.json();
      if (data.success) {
        setCompetitionAnalysis(data.analysis);
      }
    } catch (err) {
      console.error("Error analyzing competition:", err);
    } finally {
      setAnalyzingCompetition(false);
    }
  };

  const getHealthColor = (label) => {
    const colors = {
      Excellent: "bg-green-500",
      Good: "bg-blue-500",
      Fair: "bg-yellow-500",
      Poor: "bg-orange-500",
      Critical: "bg-red-500",
    };
    return colors[label] || "bg-gray-500";
  };

  const getScoreColor = (score) => {
    if (score >= 70) return "text-green-400";
    if (score >= 40) return "text-yellow-400";
    return "text-red-400";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900 text-red-200 p-4 rounded-lg">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">
        Demand Analysis Dashboard
      </h1>

      {/* Health Score Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-gray-400 text-sm uppercase mb-2">
            Inventory Health Score
          </h2>
          <div className="flex items-center">
            <span
              className={`text-4xl font-bold ${getScoreColor(
                dashboard?.healthScore
              )}`}
            >
              {dashboard?.healthScore || 0}
            </span>
            <span className="text-gray-500 ml-2">/100</span>
          </div>
          <div
            className={`mt-2 inline-block px-3 py-1 rounded-full text-sm ${getHealthColor(
              dashboard?.healthRating?.label
            )}`}
          >
            {dashboard?.healthRating?.label || "Unknown"}
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-gray-400 text-sm uppercase mb-2">
            Sell-Through Rate
          </h2>
          <div className="flex items-center">
            <span
              className={`text-4xl font-bold ${getScoreColor(
                dashboard?.sellThrough?.sellThroughRate * 2
              )}`}
            >
              {dashboard?.sellThrough?.sellThroughRate?.toFixed(1) || 0}%
            </span>
          </div>
          <p className="text-gray-500 text-sm mt-2">
            {dashboard?.sellThrough?.soldItems || 0} sold /{" "}
            {dashboard?.sellThrough?.activeListings || 0} active
          </p>
          <p className="text-gray-400 text-xs mt-1">
            {dashboard?.sellThrough?.insight}
          </p>
        </div>

        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-gray-400 text-sm uppercase mb-2">
            Sales Velocity
          </h2>
          <div className="flex items-center">
            <span className="text-4xl font-bold text-indigo-400">
              {dashboard?.velocityTrend?.recentWeekSales || 0}
            </span>
            <span className="text-gray-500 ml-2">this week</span>
          </div>
          <p className="text-gray-500 text-sm mt-2">
            Avg: {dashboard?.velocityTrend?.avgWeeklySales || 0}/week (
            {dashboard?.velocityTrend?.weeks || 0} weeks)
          </p>
        </div>
      </div>

      {/* Stale Inventory Alert */}
      {dashboard?.staleInventoryCount > 0 && (
        <div className="bg-yellow-900/50 border border-yellow-700 rounded-lg p-4 mb-6">
          <h2 className="text-yellow-400 font-semibold mb-2">
            Stale Inventory Alert
          </h2>
          <p className="text-yellow-300 mb-3">
            {dashboard.staleInventoryCount} items have been listed for 60+ days
            without selling.
          </p>
          <div className="space-y-2">
            {dashboard?.staleInventorySample?.map((item, index) => (
              <div
                key={item.id || index}
                className="bg-yellow-900/30 rounded p-3"
              >
                <p className="text-white text-sm truncate">{item.title}</p>
                <div className="flex justify-between text-xs text-yellow-400 mt-1">
                  <span>${item.currentPrice?.toFixed(2)}</span>
                  <span>{item.daysListed} days listed</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Performers */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6">
        <h2 className="text-white font-semibold mb-4">Top Performing Products</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left pb-2">Product</th>
                <th className="text-right pb-2">Sales</th>
                <th className="text-right pb-2">Revenue</th>
                <th className="text-right pb-2">Avg Price</th>
              </tr>
            </thead>
            <tbody>
              {dashboard?.topPerformers?.map((item, index) => (
                <tr key={index} className="border-b border-gray-700/50">
                  <td className="py-2 text-white truncate max-w-xs">
                    {item.title}
                  </td>
                  <td className="py-2 text-right text-green-400">
                    {item.salesCount}
                  </td>
                  <td className="py-2 text-right text-indigo-400">
                    ${item.totalRevenue?.toFixed(2)}
                  </td>
                  <td className="py-2 text-right text-gray-400">
                    ${item.avgPrice?.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Competition Analysis Tool */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-white font-semibold mb-4">
          Competition Analysis Tool
        </h2>
        <div className="flex gap-4 mb-4">
          <input
            type="text"
            value={competitionKeywords}
            onChange={(e) => setCompetitionKeywords(e.target.value)}
            placeholder="Enter keywords (e.g., 'honda civic ecu')"
            className="flex-1 bg-gray-700 text-white rounded px-4 py-2"
            onKeyPress={(e) => e.key === "Enter" && analyzeCompetition()}
          />
          <button
            onClick={analyzeCompetition}
            disabled={analyzingCompetition}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded disabled:opacity-50"
          >
            {analyzingCompetition ? "Analyzing..." : "Analyze"}
          </button>
        </div>

        {competitionAnalysis && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div className="bg-gray-700 rounded p-4">
              <h3 className="text-gray-400 text-sm uppercase mb-2">
                Competition
              </h3>
              <p className="text-2xl font-bold text-orange-400">
                {competitionAnalysis.competition?.level?.toUpperCase()}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                {competitionAnalysis.competition?.listingCount} listings from{" "}
                {competitionAnalysis.competition?.uniqueSellers} sellers
              </p>
              <p className="text-sm text-gray-400">
                Avg price: $
                {competitionAnalysis.competition?.avgPrice?.toFixed(2)}
              </p>
            </div>

            <div className="bg-gray-700 rounded p-4">
              <h3 className="text-gray-400 text-sm uppercase mb-2">Demand</h3>
              <p className="text-2xl font-bold text-green-400">
                {competitionAnalysis.demand?.level?.toUpperCase()}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                {competitionAnalysis.demand?.soldCount} sales
              </p>
              <p className="text-sm text-gray-400">
                Avg sold: ${competitionAnalysis.demand?.avgSoldPrice?.toFixed(2)}
              </p>
            </div>

            <div className="bg-gray-700 rounded p-4">
              <h3 className="text-gray-400 text-sm uppercase mb-2">
                Opportunity
              </h3>
              <p
                className={`text-2xl font-bold ${getScoreColor(
                  competitionAnalysis.opportunity?.score
                )}`}
              >
                {competitionAnalysis.opportunity?.score}/100
              </p>
              <p className="text-sm text-gray-400 mt-1">
                {competitionAnalysis.opportunity?.recommendation}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DemandDashboard;
