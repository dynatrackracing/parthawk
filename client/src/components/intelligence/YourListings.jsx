import React, { useEffect, useState } from "react";
import axios from "../../utils/axios";
import { toast } from "react-toastify";
import { useHistory } from "react-router-dom";

function YourListings() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const history = useHistory();

  useEffect(() => {
    fetchListings();
    fetchSyncStatus();
  }, []);

  const fetchSyncStatus = async () => {
    try {
      const response = await axios.get("/sync/status");
      if (response.data.success) {
        if (response.data.syncing) setSyncing(true);
        if (response.data.lastSyncedAt) setLastSyncedAt(response.data.lastSyncedAt);
      }
    } catch (error) {
      // ignore
    }
  };

  const fetchListings = async () => {
    try {
      setLoading(true);
      const response = await axios.get("/sync/your-listings");
      if (response.data.success) {
        setListings(response.data.listings || []);
      }
    } catch (error) {
      console.error("Error fetching listings:", error);
      toast.error("Failed to load your listings");
    } finally {
      setLoading(false);
    }
  };

  const syncFromEbay = async () => {
    try {
      setSyncing(true);
      toast.info("Syncing your listings from eBay... This may take a minute.");
      const response = await axios.post("/sync/your-data");

      if (response.status === 409) {
        toast.warn("Sync already in progress");
        return;
      }

      // Poll sync status until complete
      const poll = setInterval(async () => {
        try {
          const status = await axios.get("/sync/status");
          if (!status.data.syncing) {
            clearInterval(poll);
            setSyncing(false);
            if (status.data.error) {
              toast.error(`Sync error: ${status.data.error}`);
            } else {
              const r = status.data.lastResult || {};
              toast.success(
                `Synced ${r.listings?.synced || 0} listings, ${r.orders?.synced || 0} orders`
              );
              setLastSyncedAt(status.data.lastSyncedAt);
            }
            fetchListings();
          }
        } catch (e) {
          // keep polling
        }
      }, 3000);
    } catch (error) {
      console.error("Error syncing:", error);
      if (error.response?.status === 409) {
        toast.warn("Sync already in progress");
      } else {
        toast.error("Failed to start sync");
      }
      setSyncing(false);
    }
  };

  const viewPriceAnalysis = (listingId) => {
    history.push(`/intelligence/price-analysis/${listingId}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-9xl mx-auto">
      {/* Header */}
      <div className="sm:flex sm:justify-between sm:items-center mb-8">
        <div className="mb-4 sm:mb-0">
          <h1 className="text-2xl md:text-3xl text-gray-800 font-bold">
            Your Listings
          </h1>
          <p className="text-gray-500 mt-1">
            {listings.length} active listings from your eBay store
          </p>
          {lastSyncedAt && (
            <p className="text-xs text-gray-400 mt-1">
              Last synced: {new Date(lastSyncedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="grid grid-flow-col sm:auto-cols-max justify-start sm:justify-end gap-2">
          <button
            onClick={syncFromEbay}
            disabled={syncing}
            className={`btn ${
              syncing ? "bg-gray-400" : "bg-indigo-500 hover:bg-indigo-600"
            } text-white px-4 py-2 rounded-lg`}
          >
            {syncing ? "Syncing..." : "Sync from eBay"}
          </button>
        </div>
      </div>

      {/* Listings Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Item
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Price
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Qty
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Days Listed
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {listings.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-12 text-center text-gray-500">
                  No listings found. Click "Sync from eBay" to import your
                  listings.
                </td>
              </tr>
            ) : (
              listings.map((listing) => (
                <tr key={listing.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <div className="ml-0">
                        <div className="text-sm font-medium text-gray-900 max-w-md truncate">
                          {listing.title}
                        </div>
                        <div className="text-sm text-gray-500">
                          SKU: {listing.sku || "N/A"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-green-600">
                      ${parseFloat(listing.currentPrice).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {listing.quantityAvailable}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        listing.listingStatus === "Active"
                          ? "bg-green-100 text-green-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {listing.listingStatus}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {listing.daysListed || "N/A"} days
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => viewPriceAnalysis(listing.id)}
                      className="text-indigo-600 hover:text-indigo-900 mr-4"
                    >
                      Price Analysis
                    </button>
                    {listing.viewItemUrl && (
                      <a
                        href={listing.viewItemUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-600 hover:text-gray-900"
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

export default YourListings;
