import React, { useEffect, useState } from "react";
import axios from "../../utils/axios";
import { toast } from "react-toastify";

function StaleInventory() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(60);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const limit = 50;

  useEffect(() => {
    fetchListings();
  }, [threshold, page]);

  // Reset to page 1 when threshold changes
  useEffect(() => {
    setPage(1);
  }, [threshold]);

  const fetchListings = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`/intelligence/dead-inventory?daysThreshold=${threshold}&limit=${limit}&page=${page}`);
      if (response.data.success) {
        setListings(response.data.deadInventory || []);
        setTotalPages(response.data.totalPages || 1);
        setTotalItems(response.data.total || 0);
      }
    } catch (error) {
      console.error("Error fetching stale inventory:", error);
      toast.error("Failed to load stale inventory");
    } finally {
      setLoading(false);
    }
  };

  // Group by recommendation
  const groupedByAction = {
    SCRAP: listings.filter(l => l.recommendation === "SCRAP"),
    "DEEP DISCOUNT": listings.filter(l => l.recommendation === "DEEP DISCOUNT"),
    "REDUCE PRICE": listings.filter(l => l.recommendation === "REDUCE PRICE"),
    RELIST: listings.filter(l => l.recommendation === "RELIST"),
    HOLD: listings.filter(l => l.recommendation === "HOLD"),
  };

  const totalValue = listings.reduce((sum, l) => sum + parseFloat(l.currentPrice || 0), 0);
  const potentialRecovery = listings
    .filter(l => l.recommendation !== "SCRAP")
    .reduce((sum, l) => sum + parseFloat(l.currentPrice || 0) * 0.7, 0);

  const getRecommendationStyle = (rec) => {
    switch (rec) {
      case "SCRAP": return "bg-red-100 text-red-800 border-red-200";
      case "DEEP DISCOUNT": return "bg-amber-200 text-amber-900 border-amber-400";
      case "REDUCE PRICE": return "bg-yellow-200 text-yellow-900 border-yellow-400";
      case "RELIST": return "bg-blue-100 text-blue-800 border-blue-200";
      case "HOLD": return "bg-green-100 text-green-800 border-green-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getDemandIndicator = (marketSales) => {
    if (marketSales === 0) return { label: "No Demand", color: "text-red-700", bg: "bg-red-100" };
    if (marketSales < 3) return { label: "Very Low", color: "text-amber-800", bg: "bg-amber-200" };
    if (marketSales < 10) return { label: "Low", color: "text-yellow-800", bg: "bg-yellow-200" };
    if (marketSales < 25) return { label: "Moderate", color: "text-blue-700", bg: "bg-blue-100" };
    return { label: "Good", color: "text-green-700", bg: "bg-green-100" };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl text-gray-800 font-bold">
          Stale Inventory
        </h1>
        <p className="text-gray-500 mt-1">
          Items that have been listed for a long time with actionable recommendations
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm font-medium text-gray-500">Stale Items</p>
          <p className="text-2xl font-bold text-yellow-600">{totalItems}</p>
          <p className="text-xs text-gray-400">{threshold}+ days</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm font-medium text-gray-500">Value at Risk</p>
          <p className="text-2xl font-bold text-gray-900">${totalValue.toFixed(0)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm font-medium text-gray-500">Potential Recovery</p>
          <p className="text-2xl font-bold text-green-600">${potentialRecovery.toFixed(0)}</p>
          <p className="text-xs text-gray-400">at 70% of list</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm font-medium text-gray-500">Need Action</p>
          <p className="text-2xl font-bold text-red-600">
            {groupedByAction["SCRAP"].length + groupedByAction["DEEP DISCOUNT"].length}
          </p>
          <p className="text-xs text-gray-400">scrap or deep discount</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm font-medium text-gray-500">Threshold</p>
          <input
            type="range"
            min="30"
            max="180"
            step="30"
            value={threshold}
            onChange={(e) => setThreshold(parseInt(e.target.value))}
            className="w-full mt-2"
          />
          <p className="text-xs text-gray-400 mt-1">{threshold} days</p>
        </div>
      </div>

      {/* Action Summary */}
      <div className="grid grid-cols-5 gap-2 mb-6">
        {Object.entries(groupedByAction).map(([action, items]) => (
          <div
            key={action}
            className={`p-3 rounded-lg border ${getRecommendationStyle(action)}`}
          >
            <p className="text-xs font-medium">{action}</p>
            <p className="text-lg font-bold">{items.length}</p>
          </div>
        ))}
      </div>

      {/* Stale Listings Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Item
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Price
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Days
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Market Demand
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Recommendation
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {listings.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-12 text-center text-gray-500">
                  No stale inventory found at {threshold}+ days. Great job!
                </td>
              </tr>
            ) : (
              listings.map((listing, idx) => {
                const demand = getDemandIndicator(listing.marketSalesLast90Days);
                return (
                  <tr key={listing.ebayItemId || idx} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <div className="text-sm font-medium text-gray-900 max-w-xs truncate" title={listing.title}>
                        {listing.title}
                      </div>
                      <div className="text-xs text-gray-500">
                        SKU: {listing.sku || "N/A"}
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        ${listing.currentPrice}
                      </div>
                      {listing.marketAvgPrice && (
                        <div className="text-xs text-gray-400">
                          Mkt avg: ${listing.marketAvgPrice}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className={`text-sm font-bold ${
                        listing.daysListed >= 180 ? "text-red-600" :
                        listing.daysListed >= 120 ? "text-orange-600" :
                        listing.daysListed >= 90 ? "text-yellow-600" :
                        "text-gray-600"
                      }`}>
                        {listing.daysListed}
                      </span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className={`inline-flex items-center px-2 py-1 rounded ${demand.bg}`}>
                        <span className={`text-xs font-medium ${demand.color}`}>
                          {demand.label}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {listing.marketSalesLast90Days} sold / 90d
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full border ${getRecommendationStyle(listing.recommendation)}`}>
                        {listing.recommendation}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-sm text-gray-900 font-medium">
                        {listing.suggestedAction}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {listing.reasoning}
                      </div>
                      {listing.viewItemUrl && (
                        <a
                          href={listing.viewItemUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-indigo-600 hover:text-indigo-800 mt-1 inline-block"
                        >
                          View on eBay →
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="px-6 py-4 bg-gray-50 border-t flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Showing {((page - 1) * limit) + 1} - {Math.min(page * limit, totalItems)} of {totalItems} stale items
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className={`px-3 py-1 text-sm rounded ${page === 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-700 hover:bg-gray-100 border'}`}
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className={`px-3 py-1 text-sm rounded ${page === totalPages ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-700 hover:bg-gray-100 border'}`}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-6 bg-gray-50 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Understanding Recommendations</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          <div className="flex items-start">
            <span className={`px-2 py-1 rounded mr-2 ${getRecommendationStyle("SCRAP")}`}>SCRAP</span>
            <span className="text-gray-600">No market demand, consider removing</span>
          </div>
          <div className="flex items-start">
            <span className={`px-2 py-1 rounded mr-2 ${getRecommendationStyle("DEEP DISCOUNT")}`}>DEEP DISCOUNT</span>
            <span className="text-gray-600">Very low demand, aggressive price cut needed</span>
          </div>
          <div className="flex items-start">
            <span className={`px-2 py-1 rounded mr-2 ${getRecommendationStyle("REDUCE PRICE")}`}>REDUCE</span>
            <span className="text-gray-600">Priced above market, lower to compete</span>
          </div>
          <div className="flex items-start">
            <span className={`px-2 py-1 rounded mr-2 ${getRecommendationStyle("RELIST")}`}>RELIST</span>
            <span className="text-gray-600">Listing stale, end and relist for visibility</span>
          </div>
          <div className="flex items-start">
            <span className={`px-2 py-1 rounded mr-2 ${getRecommendationStyle("HOLD")}`}>HOLD</span>
            <span className="text-gray-600">Demand exists, monitor a bit longer</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StaleInventory;
