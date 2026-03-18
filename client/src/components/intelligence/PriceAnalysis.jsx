import React, { useEffect, useState } from "react";
import { useParams, useHistory } from "react-router-dom";
import axios from "../../utils/axios";
import { toast } from "react-toastify";

function PriceAnalysis() {
  const { listingId } = useParams();
  const history = useHistory();
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (listingId) {
      fetchPriceAnalysis();
    }
  }, [listingId]);

  const fetchPriceAnalysis = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `/market-research/price-analysis/${listingId}`
      );
      if (response.data.success) {
        setAnalysis(response.data);
      }
    } catch (error) {
      console.error("Error fetching price analysis:", error);
      toast.error("Failed to load price analysis");
    } finally {
      setLoading(false);
    }
  };

  const getRecommendationColor = (action) => {
    switch (action) {
      case "REDUCE_PRICE":
        return "bg-red-100 text-red-800 border-red-200";
      case "RAISE_PRICE":
        return "bg-green-100 text-green-800 border-green-200";
      case "PRICE_OK":
        return "bg-blue-100 text-blue-800 border-blue-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-9xl mx-auto">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold text-gray-800">
            No Analysis Available
          </h2>
          <p className="text-gray-500 mt-2">
            Run market research for this item to see price analysis.
          </p>
          <button
            onClick={() => history.goBack()}
            className="mt-4 text-indigo-600 hover:text-indigo-800"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-9xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => history.goBack()}
          className="text-indigo-600 hover:text-indigo-800 mb-4 flex items-center"
        >
          <svg
            className="w-4 h-4 mr-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Listings
        </button>
        <h1 className="text-2xl md:text-3xl text-gray-800 font-bold">
          Price Analysis
        </h1>
        <p className="text-gray-500 mt-1 max-w-2xl truncate">
          {analysis.yourListing?.title}
        </p>
      </div>

      {/* Your Price vs Market */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 uppercase mb-2">
            Your Price
          </h3>
          <p className="text-3xl font-bold text-indigo-600">
            ${parseFloat(analysis.yourListing?.currentPrice || 0).toFixed(2)}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 uppercase mb-2">
            Competitor Avg
          </h3>
          <p className="text-3xl font-bold text-gray-900">
            ${parseFloat(analysis.competitorAnalysis?.avgPrice || 0).toFixed(2)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {analysis.competitorAnalysis?.count || 0} listings
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 uppercase mb-2">
            Avg Sold Price
          </h3>
          <p className="text-3xl font-bold text-green-600">
            ${parseFloat(analysis.soldAnalysis?.avgPrice || 0).toFixed(2)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {analysis.soldAnalysis?.count || 0} recent sales
          </p>
        </div>
      </div>

      {/* Recommendation */}
      {analysis.recommendation && (
        <div
          className={`rounded-lg border-2 p-6 mb-8 ${getRecommendationColor(
            analysis.recommendation.action
          )}`}
        >
          <div className="flex items-start">
            <div className="flex-shrink-0">
              {analysis.recommendation.action === "REDUCE_PRICE" && (
                <svg
                  className="h-8 w-8 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"
                  />
                </svg>
              )}
              {analysis.recommendation.action === "RAISE_PRICE" && (
                <svg
                  className="h-8 w-8 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                  />
                </svg>
              )}
              {analysis.recommendation.action === "PRICE_OK" && (
                <svg
                  className="h-8 w-8 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              )}
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-semibold">
                {analysis.recommendation.action === "REDUCE_PRICE" &&
                  "Consider Lowering Price"}
                {analysis.recommendation.action === "RAISE_PRICE" &&
                  "Consider Raising Price"}
                {analysis.recommendation.action === "PRICE_OK" &&
                  "Price Looks Good"}
                {analysis.recommendation.action === "INSUFFICIENT_DATA" &&
                  "Need More Data"}
              </h3>
              <p className="mt-1">{analysis.recommendation.message}</p>
              {analysis.recommendation.suggestedPrice && (
                <p className="mt-2 font-semibold">
                  Suggested Price: $
                  {parseFloat(analysis.recommendation.suggestedPrice).toFixed(2)}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Price Range Analysis */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Competitor Price Range */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            Competitor Price Range
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Minimum</span>
              <span className="font-medium text-gray-900">
                $
                {parseFloat(analysis.competitorAnalysis?.minPrice || 0).toFixed(
                  2
                )}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Average</span>
              <span className="font-medium text-gray-900">
                $
                {parseFloat(analysis.competitorAnalysis?.avgPrice || 0).toFixed(
                  2
                )}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Maximum</span>
              <span className="font-medium text-gray-900">
                $
                {parseFloat(analysis.competitorAnalysis?.maxPrice || 0).toFixed(
                  2
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Sold Price Range */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            Sold Price Range (30 days)
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Minimum</span>
              <span className="font-medium text-gray-900">
                ${parseFloat(analysis.soldAnalysis?.minPrice || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Average</span>
              <span className="font-medium text-gray-900">
                ${parseFloat(analysis.soldAnalysis?.avgPrice || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Maximum</span>
              <span className="font-medium text-gray-900">
                ${parseFloat(analysis.soldAnalysis?.maxPrice || 0).toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Competitors */}
      {analysis.competitorAnalysis?.topCompetitors?.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            Lowest Priced Competitors
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Seller
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Price
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Condition
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Free Shipping
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {analysis.competitorAnalysis.topCompetitors.map(
                  (competitor, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {competitor.seller || "Unknown"}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-green-600">
                        ${parseFloat(competitor.currentPrice).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {competitor.condition || "N/A"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {competitor.freeShipping ? (
                          <span className="text-green-600">Yes</span>
                        ) : (
                          <span className="text-gray-400">No</span>
                        )}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default PriceAnalysis;
