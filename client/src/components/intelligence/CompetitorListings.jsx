import React, { useEffect, useState } from "react";
import axios from "../../utils/axios";
import { toast } from "react-toastify";

function CompetitorListings() {
  const [competitors, setCompetitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("scrapedAt");
  const [sortDirection, setSortDirection] = useState("desc");

  useEffect(() => {
    fetchCompetitors();
  }, []);

  const fetchCompetitors = async () => {
    try {
      setLoading(true);
      // This endpoint would need to be created, for now we'll use a placeholder
      const response = await axios.get("/market-research/all-competitors?limit=100");
      if (response.data.success) {
        setCompetitors(response.data.competitors || []);
      }
    } catch (error) {
      console.error("Error fetching competitors:", error);
      // For now, show empty state
      setCompetitors([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const filteredAndSortedCompetitors = competitors
    .filter(
      (c) =>
        c.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.seller?.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      const direction = sortDirection === "asc" ? 1 : -1;

      if (typeof aVal === "number" && typeof bVal === "number") {
        return (aVal - bVal) * direction;
      }
      return String(aVal || "").localeCompare(String(bVal || "")) * direction;
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  // Get unique sellers for stats
  const uniqueSellers = [...new Set(competitors.map((c) => c.seller).filter(Boolean))];
  const avgPrice = competitors.length > 0
    ? competitors.reduce((acc, c) => acc + parseFloat(c.currentPrice || 0), 0) / competitors.length
    : 0;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-9xl mx-auto">
      {/* Header */}
      <div className="sm:flex sm:justify-between sm:items-center mb-8">
        <div className="mb-4 sm:mb-0">
          <h1 className="text-2xl md:text-3xl text-gray-800 font-bold">
            Competitor Listings
          </h1>
          <p className="text-gray-500 mt-1">
            {competitors.length} active competitor listings tracked
          </p>
        </div>
        <div className="grid grid-flow-col sm:auto-cols-max justify-start sm:justify-end gap-2">
          <input
            type="text"
            placeholder="Search listings..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 uppercase">
            Total Listings
          </h3>
          <p className="text-3xl font-bold text-gray-900 mt-2">
            {competitors.length}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 uppercase">
            Unique Sellers
          </h3>
          <p className="text-3xl font-bold text-gray-900 mt-2">
            {uniqueSellers.length}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 uppercase">
            Average Price
          </h3>
          <p className="text-3xl font-bold text-green-600 mt-2">
            ${avgPrice.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Listings Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("title")}
              >
                Title
                {sortField === "title" && (sortDirection === "asc" ? " ↑" : " ↓")}
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("currentPrice")}
              >
                Price
                {sortField === "currentPrice" && (sortDirection === "asc" ? " ↑" : " ↓")}
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("seller")}
              >
                Seller
                {sortField === "seller" && (sortDirection === "asc" ? " ↑" : " ↓")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Condition
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Shipping
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("scrapedAt")}
              >
                Last Seen
                {sortField === "scrapedAt" && (sortDirection === "asc" ? " ↑" : " ↓")}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredAndSortedCompetitors.length === 0 ? (
              <tr>
                <td colSpan="7" className="px-6 py-12 text-center text-gray-500">
                  No competitor listings found. Run market research to track competitors.
                </td>
              </tr>
            ) : (
              filteredAndSortedCompetitors.map((competitor) => (
                <tr key={competitor.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900 max-w-xs truncate">
                      {competitor.title}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-green-600">
                      ${parseFloat(competitor.currentPrice).toFixed(2)}
                    </span>
                    {competitor.originalPrice &&
                      competitor.originalPrice !== competitor.currentPrice && (
                        <span className="text-xs text-gray-400 line-through ml-2">
                          ${parseFloat(competitor.originalPrice).toFixed(2)}
                        </span>
                      )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{competitor.seller || "Unknown"}</div>
                    {competitor.sellerFeedbackScore && (
                      <div className="text-xs text-gray-500">
                        {competitor.sellerFeedbackScore} ({competitor.sellerFeedbackPercent}%)
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {competitor.condition || "N/A"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {competitor.freeShipping ? (
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                        Free
                      </span>
                    ) : competitor.shippingCost ? (
                      <span className="text-sm text-gray-500">
                        ${parseFloat(competitor.shippingCost).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {competitor.scrapedAt
                      ? new Date(competitor.scrapedAt).toLocaleDateString()
                      : "N/A"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {competitor.viewItemUrl && (
                      <a
                        href={competitor.viewItemUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:text-indigo-900"
                      >
                        View on eBay
                      </a>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CompetitorListings;
