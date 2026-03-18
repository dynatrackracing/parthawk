import React, { useEffect, useState } from "react";
import axios from "../../utils/axios";
import { toast } from "react-toastify";
import { useHistory } from "react-router-dom";

function PricingInsights() {
  const [underpriced, setUnderpriced] = useState([]);
  const [overpriced, setOverpriced] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("underpriced");
  const history = useHistory();

  useEffect(() => {
    fetchPricingData();
  }, []);

  const fetchPricingData = async () => {
    try {
      setLoading(true);
      const [underpricedRes, overpricedRes] = await Promise.all([
        axios.get("/pricing/underpriced?limit=20"),
        axios.get("/pricing/overpriced?limit=20"),
      ]);

      if (underpricedRes.data.success) {
        setUnderpriced(underpricedRes.data.items || []);
      }
      if (overpricedRes.data.success) {
        setOverpriced(overpricedRes.data.items || []);
      }
    } catch (error) {
      console.error("Error fetching pricing data:", error);
      toast.error("Failed to load pricing insights");
    } finally {
      setLoading(false);
    }
  };

  const viewDetails = (listingId) => {
    history.push(`/intelligence/price-analysis/${listingId}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  const totalPotentialGain = underpriced.reduce(
    (acc, item) => acc + (item.potentialGain || 0),
    0
  );

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-9xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl text-gray-800 font-bold">
          ML Pricing Insights
        </h1>
        <p className="text-gray-500 mt-1">
          AI-powered pricing recommendations based on market data
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-green-50 rounded-lg border border-green-200 p-6">
          <h3 className="text-sm font-medium text-green-800 uppercase">
            Underpriced Items
          </h3>
          <p className="text-3xl font-bold text-green-700 mt-2">
            {underpriced.length}
          </p>
          <p className="text-sm text-green-600 mt-1">
            Potential to raise prices
          </p>
        </div>
        <div className="bg-red-50 rounded-lg border border-red-200 p-6">
          <h3 className="text-sm font-medium text-red-800 uppercase">
            Overpriced Items
          </h3>
          <p className="text-3xl font-bold text-red-700 mt-2">
            {overpriced.length}
          </p>
          <p className="text-sm text-red-600 mt-1">May need price reduction</p>
        </div>
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-6">
          <h3 className="text-sm font-medium text-blue-800 uppercase">
            Potential Revenue Gain
          </h3>
          <p className="text-3xl font-bold text-blue-700 mt-2">
            ${totalPotentialGain.toFixed(2)}
          </p>
          <p className="text-sm text-blue-600 mt-1">
            From underpriced items
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab("underpriced")}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === "underpriced"
                ? "border-green-500 text-green-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            Underpriced ({underpriced.length})
          </button>
          <button
            onClick={() => setActiveTab("overpriced")}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === "overpriced"
                ? "border-red-500 text-red-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            Overpriced ({overpriced.length})
          </button>
        </nav>
      </div>

      {/* Items List */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Current Price
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Suggested Price
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                {activeTab === "underpriced" ? "Potential Gain" : "Overpriced By"}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Confidence
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Key Insight
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {(activeTab === "underpriced" ? underpriced : overpriced).map(
              (item) => (
                <tr key={item.listingId} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-gray-900">
                      ${item.currentPrice.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`text-sm font-medium ${
                        activeTab === "underpriced"
                          ? "text-green-600"
                          : "text-red-600"
                      }`}
                    >
                      ${item.suggestedPrice?.toFixed(2) || "N/A"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        activeTab === "underpriced"
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {activeTab === "underpriced"
                        ? `+$${item.potentialGain?.toFixed(2)}`
                        : `-$${item.overpricedBy?.toFixed(2)}`}
                      {" "}
                      ({(activeTab === "underpriced"
                        ? item.potentialGainPercent
                        : item.overpricedPercent
                      )?.toFixed(0)}%)
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                        <div
                          className={`h-2 rounded-full ${
                            item.confidence >= 0.8
                              ? "bg-green-500"
                              : item.confidence >= 0.5
                              ? "bg-yellow-500"
                              : "bg-red-500"
                          }`}
                          style={{ width: `${item.confidence * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-xs text-gray-500">
                        {(item.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-600 max-w-xs truncate">
                      {item.insights?.[item.insights.length - 1] || "No insight"}
                    </p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => viewDetails(item.listingId)}
                      className="text-indigo-600 hover:text-indigo-900"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              )
            )}
            {(activeTab === "underpriced" ? underpriced : overpriced).length ===
              0 && (
              <tr>
                <td
                  colSpan="6"
                  className="px-6 py-12 text-center text-gray-500"
                >
                  No {activeTab} items found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ML Algorithm Info */}
      <div className="mt-8 bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">
          How Our Pricing Algorithm Works
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="flex items-start">
            <div className="flex-shrink-0 bg-indigo-100 rounded-full p-2">
              <svg
                className="w-6 h-6 text-indigo-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="ml-4">
              <h4 className="text-sm font-medium text-gray-900">
                50% Market Sales
              </h4>
              <p className="text-sm text-gray-500">
                Real sold prices from the market (most reliable indicator)
              </p>
            </div>
          </div>
          <div className="flex items-start">
            <div className="flex-shrink-0 bg-green-100 rounded-full p-2">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
                />
              </svg>
            </div>
            <div className="ml-4">
              <h4 className="text-sm font-medium text-gray-900">
                35% Your History
              </h4>
              <p className="text-sm text-gray-500">
                Your past successful sales (your pricing power)
              </p>
            </div>
          </div>
          <div className="flex items-start">
            <div className="flex-shrink-0 bg-yellow-100 rounded-full p-2">
              <svg
                className="w-6 h-6 text-yellow-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <div className="ml-4">
              <h4 className="text-sm font-medium text-gray-900">
                15% Competitor Prices
              </h4>
              <p className="text-sm text-gray-500">
                Current competition (may be overpriced)
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PricingInsights;
