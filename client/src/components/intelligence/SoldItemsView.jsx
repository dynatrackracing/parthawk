import React, { useEffect, useState } from "react";
import axios from "../../utils/axios";
import { toast } from "react-toastify";

function SoldItemsView() {
  const [soldItems, setSoldItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("soldDate");
  const [sortDirection, setSortDirection] = useState("desc");

  useEffect(() => {
    fetchSoldItems();
  }, []);

  const fetchSoldItems = async () => {
    try {
      setLoading(true);
      const response = await axios.get("/market-research/all-sold?limit=200");
      if (response.data.success) {
        setSoldItems(response.data.soldItems || []);
      }
    } catch (error) {
      console.error("Error fetching sold items:", error);
      setSoldItems([]);
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

  const filteredAndSortedItems = soldItems
    .filter(
      (item) =>
        item.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.seller?.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      const direction = sortDirection === "asc" ? 1 : -1;

      // Handle dates
      if (sortField === "soldDate") {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      }

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

  // Calculate stats
  const uniqueSellers = [...new Set(soldItems.map((s) => s.seller).filter(Boolean))];
  const avgPrice = soldItems.length > 0
    ? soldItems.reduce((acc, s) => acc + parseFloat(s.soldPrice || 0), 0) / soldItems.length
    : 0;
  const prices = soldItems.map((s) => parseFloat(s.soldPrice || 0)).filter((p) => p > 0).sort((a, b) => a - b);
  const medianPrice = prices.length > 0
    ? prices.length % 2 === 0
      ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
      : prices[Math.floor(prices.length / 2)]
    : 0;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-9xl mx-auto">
      {/* Header */}
      <div className="sm:flex sm:justify-between sm:items-center mb-8">
        <div className="mb-4 sm:mb-0">
          <h1 className="text-2xl md:text-3xl text-gray-800 font-bold">
            Market Sold Items
          </h1>
          <p className="text-gray-500 mt-1">
            {soldItems.length} verified sales tracked from the market
          </p>
        </div>
        <div className="grid grid-flow-col sm:auto-cols-max justify-start sm:justify-end gap-2">
          <input
            type="text"
            placeholder="Search items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 uppercase">
            Total Sales
          </h3>
          <p className="text-3xl font-bold text-gray-900 mt-2">
            {soldItems.length}
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
            Average Sale Price
          </h3>
          <p className="text-3xl font-bold text-green-600 mt-2">
            ${avgPrice.toFixed(2)}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 uppercase">
            Median Sale Price
          </h3>
          <p className="text-3xl font-bold text-blue-600 mt-2">
            ${medianPrice.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Price Distribution */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          Price Distribution
        </h2>
        <div className="flex items-end h-40 space-x-1">
          {(() => {
            if (prices.length === 0) return null;
            const min = prices[0];
            const max = prices[prices.length - 1];
            const range = max - min || 1;
            const buckets = Array(10).fill(0);
            prices.forEach((price) => {
              const bucketIndex = Math.min(
                9,
                Math.floor(((price - min) / range) * 10)
              );
              buckets[bucketIndex]++;
            });
            const maxBucket = Math.max(...buckets) || 1;

            return buckets.map((count, index) => {
              const height = (count / maxBucket) * 100;
              const priceRange = `$${(min + (range * index) / 10).toFixed(0)}-$${(
                min +
                (range * (index + 1)) / 10
              ).toFixed(0)}`;
              return (
                <div
                  key={index}
                  className="flex-1 bg-indigo-200 rounded-t hover:bg-indigo-300 transition-colors cursor-pointer group relative"
                  style={{ height: `${height}%`, minHeight: count > 0 ? "8px" : "0" }}
                  title={`${priceRange}: ${count} items`}
                >
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap">
                    {priceRange}
                    <br />
                    {count} items
                  </div>
                </div>
              );
            });
          })()}
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-2">
          <span>${prices[0]?.toFixed(0) || "0"}</span>
          <span>${prices[prices.length - 1]?.toFixed(0) || "0"}</span>
        </div>
      </div>

      {/* Sold Items Table */}
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
                onClick={() => handleSort("soldPrice")}
              >
                Sold Price
                {sortField === "soldPrice" && (sortDirection === "asc" ? " ↑" : " ↓")}
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
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("soldDate")}
              >
                Sold Date
                {sortField === "soldDate" && (sortDirection === "asc" ? " ↑" : " ↓")}
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredAndSortedItems.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-6 py-12 text-center text-gray-500">
                  No sold items found. Run market research to track sales.
                </td>
              </tr>
            ) : (
              filteredAndSortedItems.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900 max-w-md truncate">
                      {item.title}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-green-600">
                      ${parseFloat(item.soldPrice).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{item.seller || "Unknown"}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {item.condition || "N/A"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {item.soldDate
                      ? new Date(item.soldDate).toLocaleDateString()
                      : "N/A"}
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

export default SoldItemsView;
