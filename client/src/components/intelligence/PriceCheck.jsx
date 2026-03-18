import React, { useEffect, useState, useCallback } from "react";
import axios from "../../utils/axios";
import { toast } from "react-toastify";

function PriceCheck() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [bulkChecking, setBulkChecking] = useState(false);
  const [checkingId, setCheckingId] = useState(null);
  const [filter, setFilter] = useState("all"); // all, overpriced, underpriced, unchecked, omitted
  const [summary, setSummary] = useState({});
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalListings, setTotalListings] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const limit = 50;

  useEffect(() => {
    fetchListings();
  }, [page, filter, search]);

  // Reset to page 1 when filter or search changes
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [filter, search]);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchListings = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      const verdictParam = (filter !== 'all' && filter !== 'omitted') ? `&verdict=${filter}` : '';
      const omittedParam = filter === 'omitted' ? '&omitted=true' : '&omitted=false';
      const searchParam = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
      const response = await axios.get(`/price-check/all?page=${page}&limit=${limit}${verdictParam}${omittedParam}${searchParam}`);
      if (response.data.success) {
        setListings(response.data.listings || []);
        setSummary(response.data.summary || {});
        setTotalPages(response.data.totalPages || 1);
        setTotalListings(response.data.total || 0);
      }
    } catch (error) {
      console.error("Error fetching listings:", error);
      toast.error("Failed to load listings");
    } finally {
      setLoading(false);
    }
  };

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

  useEffect(() => { fetchSyncStatus(); }, []);

  const syncFromEbay = async () => {
    try {
      setSyncing(true);
      toast.info("Syncing listings from eBay... This may take a minute.");
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
            fetchListings(false);
          }
        } catch (e) {
          // keep polling
        }
      }, 3000);
    } catch (error) {
      if (error.response?.status === 409) {
        toast.warn("Sync already in progress");
      } else {
        toast.error("Failed to start sync");
      }
      setSyncing(false);
    }
  };

  // Update a single listing in place without refreshing the whole list
  const updateListingInPlace = (listingId, priceCheckData) => {
    setListings(prevListings => prevListings.map(listing => {
      if (listing.id === listingId) {
        // Calculate suggested price and diff
        let suggestedPrice = null;
        let priceDiff = null;
        if (priceCheckData.metrics?.median) {
          suggestedPrice = Math.round(priceCheckData.metrics.median * 0.95 * 100) / 100;
          priceDiff = listing.currentPrice - suggestedPrice;
        }

        return {
          ...listing,
          priceCheck: {
            checkedAt: new Date().toISOString(),
            verdict: priceCheckData.metrics?.verdict,
            marketMedian: priceCheckData.metrics?.median,
            marketMin: priceCheckData.metrics?.min,
            marketMax: priceCheckData.metrics?.max,
            compCount: priceCheckData.metrics?.count || 0,
            priceDiffPercent: priceCheckData.metrics?.priceDiffPercent,
            suggestedPrice,
            priceDiff,
            searchQuery: priceCheckData.searchQuery,
            topComps: priceCheckData.topComps || [],
            salesPerWeek: priceCheckData.metrics?.salesPerWeek,
            partType: priceCheckData.parts?.partType,
            make: priceCheckData.parts?.make,
            model: priceCheckData.parts?.model,
            years: priceCheckData.parts?.years,
          }
        };
      }
      return listing;
    }));

    // Update summary counts
    updateSummary();
  };

  const updateSummary = () => {
    setListings(prevListings => {
      const checked = prevListings.filter(l => l.priceCheck).length;
      const overpriced = prevListings.filter(l => l.priceCheck?.verdict === 'OVERPRICED').length;
      const underpriced = prevListings.filter(l => l.priceCheck?.verdict === 'UNDERPRICED').length;
      const atMarket = prevListings.filter(l => ['MARKET PRICE', 'GOOD VALUE'].includes(l.priceCheck?.verdict)).length;
      setSummary(prev => ({ ...prev, checked, overpriced, underpriced, atMarket, unchecked: prevListings.length - checked }));
      return prevListings;
    });
  };

  const checkPrice = async (listing, forceRefresh = false) => {
    try {
      setCheckingId(listing.id);
      const response = await axios.post(`/price-check/${listing.id}`, { forceRefresh });
      if (response.data.success) {
        updateListingInPlace(listing.id, response.data);

        if (response.data.cached) {
          toast.info("Showing cached result");
        } else {
          toast.success(`Price check complete: ${response.data.metrics?.count || 0} comps found`);
        }

        setExpandedIds(prev => new Set([...prev, listing.id]));
      }
    } catch (error) {
      console.error("Price check error:", error);
      toast.error("Price check failed");
    } finally {
      setCheckingId(null);
    }
  };

  const checkAllPrices = async () => {
    try {
      setBulkChecking(true);
      const uncheckedIds = listings
        .filter(l => !l.priceCheck)
        .slice(0, 20)
        .map(l => l.id);

      if (uncheckedIds.length === 0) {
        toast.info("All listings have been checked recently");
        setBulkChecking(false);
        return;
      }

      toast.info(`Checking ${uncheckedIds.length} listings...`);
      const response = await axios.post("/price-check/bulk", { listingIds: uncheckedIds });

      if (response.data.success) {
        toast.success(`Checked ${response.data.processed} listings`);
        if (response.data.remaining > 0) {
          toast.info(`${response.data.remaining} more listings to check`);
        }
        fetchListings(false);
      }
    } catch (error) {
      toast.error("Bulk check failed");
    } finally {
      setBulkChecking(false);
    }
  };

  // Omit / un-omit selected listings
  const omitSelected = async (omit) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    try {
      const response = await axios.post("/price-check/omit", { listingIds: ids, omit });
      if (response.data.success) {
        toast.success(`${omit ? 'Omitted' : 'Restored'} ${ids.length} listing${ids.length !== 1 ? 's' : ''}`);
        setSelectedIds(new Set());
        fetchListings(false);
      }
    } catch (error) {
      toast.error(`Failed to ${omit ? 'omit' : 'restore'} listings`);
    }
  };

  // Omit / un-omit a single listing
  const toggleOmit = async (listing) => {
    const newOmit = !listing.priceCheckOmitted;
    try {
      const response = await axios.post("/price-check/omit", { listingIds: [listing.id], omit: newOmit });
      if (response.data.success) {
        toast.success(newOmit ? 'Listing omitted from price checks' : 'Listing restored to price checks');
        setListings(prev => prev.map(l =>
          l.id === listing.id ? { ...l, priceCheckOmitted: newOmit } : l
        ));
        setSummary(prev => ({
          ...prev,
          omitted: (prev.omitted || 0) + (newOmit ? 1 : -1),
        }));
      }
    } catch (error) {
      toast.error('Failed to update omit status');
    }
  };

  // Selection helpers
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sortedListings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedListings.map(l => l.id)));
    }
  };

  // Sorting function
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return '↕';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const getVerdictStyle = (verdict) => {
    switch (verdict) {
      case "MARKET PRICE":
      case "GOOD VALUE":
        return "bg-green-100 text-green-800";
      case "SLIGHTLY HIGH":
        return "bg-yellow-100 text-yellow-800";
      case "OVERPRICED":
        return "bg-red-100 text-red-800";
      case "UNDERPRICED":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const sortedListings = [...listings].sort((a, b) => {
    if (!sortConfig.key) return 0;

    let aVal, bVal;
    switch (sortConfig.key) {
      case 'title':
        aVal = a.title?.toLowerCase() || '';
        bVal = b.title?.toLowerCase() || '';
        break;
      case 'currentPrice':
        aVal = a.currentPrice || 0;
        bVal = b.currentPrice || 0;
        break;
      case 'marketMedian':
        aVal = a.priceCheck?.marketMedian || 0;
        bVal = b.priceCheck?.marketMedian || 0;
        break;
      case 'suggestedPrice':
        aVal = a.priceCheck?.suggestedPrice || 0;
        bVal = b.priceCheck?.suggestedPrice || 0;
        break;
      case 'daysListed':
        aVal = a.daysListed || 0;
        bVal = b.daysListed || 0;
        break;
      case 'compCount':
        aVal = a.priceCheck?.compCount || 0;
        bVal = b.priceCheck?.compCount || 0;
        break;
      case 'priceDiffPercent':
        aVal = a.priceCheck?.priceDiffPercent || 0;
        bVal = b.priceCheck?.priceDiffPercent || 0;
        break;
      default:
        return 0;
    }

    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const allSelected = sortedListings.length > 0 && selectedIds.size === sortedListings.length;
  const someSelected = selectedIds.size > 0;
  const selectedAreAllOmitted = someSelected && [...selectedIds].every(id => {
    const l = listings.find(x => x.id === id);
    return l?.priceCheckOmitted;
  });

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
      <div className="sm:flex sm:justify-between sm:items-center mb-8">
        <div className="mb-4 sm:mb-0">
          <h1 className="text-2xl md:text-3xl text-gray-800 font-bold">
            Price Check
          </h1>
          <p className="text-gray-500 mt-1">
            Compare your prices to market sold items
          </p>
          {lastSyncedAt && (
            <p className="text-xs text-gray-400 mt-1">
              Last synced: {new Date(lastSyncedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex space-x-3">
          <button
            onClick={checkAllPrices}
            disabled={bulkChecking}
            className={`btn ${bulkChecking ? "bg-gray-400" : "bg-green-500 hover:bg-green-600"} text-white px-4 py-2 rounded-lg`}
          >
            {bulkChecking ? "Checking..." : "Check All Prices"}
          </button>
          <button
            onClick={syncFromEbay}
            disabled={syncing}
            className={`btn ${syncing ? "bg-gray-400" : "bg-indigo-500 hover:bg-indigo-600"} text-white px-4 py-2 rounded-lg`}
          >
            {syncing ? "Syncing..." : "Sync from eBay"}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <button
          onClick={() => setFilter("all")}
          className={`p-4 rounded-lg text-left ${filter === "all" ? "ring-2 ring-indigo-500" : ""} bg-white shadow`}
        >
          <p className="text-2xl font-bold text-gray-900">{totalListings}</p>
          <p className="text-sm text-gray-500">Total Listings</p>
        </button>
        <button
          onClick={() => setFilter("unchecked")}
          className={`p-4 rounded-lg text-left ${filter === "unchecked" ? "ring-2 ring-indigo-500" : ""} bg-white shadow`}
        >
          <p className="text-2xl font-bold text-gray-400">{summary.unchecked || 0}</p>
          <p className="text-sm text-gray-500">Unchecked</p>
        </button>
        <button
          onClick={() => setFilter("overpriced")}
          className={`p-4 rounded-lg text-left ${filter === "overpriced" ? "ring-2 ring-indigo-500" : ""} bg-white shadow`}
        >
          <p className="text-2xl font-bold text-red-600">{summary.overpriced || 0}</p>
          <p className="text-sm text-gray-500">Overpriced</p>
        </button>
        <button
          onClick={() => setFilter("underpriced")}
          className={`p-4 rounded-lg text-left ${filter === "underpriced" ? "ring-2 ring-indigo-500" : ""} bg-white shadow`}
        >
          <p className="text-2xl font-bold text-blue-600">{summary.underpriced || 0}</p>
          <p className="text-sm text-gray-500">Underpriced</p>
        </button>
        <button
          onClick={() => setFilter("atMarket")}
          className={`p-4 rounded-lg text-left ${filter === "atMarket" ? "ring-2 ring-indigo-500" : ""} bg-white shadow`}
        >
          <p className="text-2xl font-bold text-green-600">{summary.atMarket || 0}</p>
          <p className="text-sm text-gray-500">At Market</p>
        </button>
        <button
          onClick={() => setFilter("omitted")}
          className={`p-4 rounded-lg text-left ${filter === "omitted" ? "ring-2 ring-gray-500" : ""} bg-white shadow`}
        >
          <p className="text-2xl font-bold text-gray-400">{summary.omitted || 0}</p>
          <p className="text-sm text-gray-500">Omitted</p>
        </button>
      </div>

      {/* Search */}
      <div className="mb-4 flex items-center bg-white border border-gray-200 rounded-lg shadow-sm px-3 gap-2 focus-within:ring-2 focus-within:ring-indigo-500">
        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Search listings by title..."
          className="flex-1 py-2.5 text-sm bg-transparent outline-none"
        />
        {searchInput && (
          <button onClick={() => { setSearchInput(""); setSearch(""); }} className="text-gray-400 hover:text-gray-600 text-xs shrink-0">
            ✕
          </button>
        )}
      </div>

      {/* Bulk action bar — visible when items are selected */}
      {someSelected && (
        <div className="mb-4 flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2">
          <span className="text-sm text-indigo-700 font-medium">
            {selectedIds.size} listing{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex space-x-2">
            {!selectedAreAllOmitted && (
              <button
                onClick={() => omitSelected(true)}
                className="text-sm bg-gray-600 hover:bg-gray-700 text-white px-3 py-1 rounded"
              >
                Omit Selected
              </button>
            )}
            {selectedAreAllOmitted && (
              <button
                onClick={() => omitSelected(false)}
                className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded"
              >
                Restore Selected
              </button>
            )}
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700 px-2"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Listings Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300 text-indigo-600"
                />
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('title')}
              >
                Item {getSortIndicator('title')}
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('currentPrice')}
              >
                Your Price {getSortIndicator('currentPrice')}
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('marketMedian')}
              >
                Market {getSortIndicator('marketMedian')}
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('suggestedPrice')}
              >
                Suggested {getSortIndicator('suggestedPrice')}
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('daysListed')}
              >
                Days {getSortIndicator('daysListed')}
              </th>
              <th
                className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-16"
                onClick={() => handleSort('priceDiffPercent')}
              >
                +/- % {getSortIndicator('priceDiffPercent')}
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Verdict
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedListings.length === 0 ? (
              <tr>
                <td colSpan="9" className="px-6 py-12 text-center text-gray-500">
                  {filter === "omitted"
                    ? "No omitted listings. Omit items from price checks using the actions menu."
                    : filter !== "all"
                    ? "No listings match this filter"
                    : "No listings found. Click \"Sync from eBay\" to import."}
                </td>
              </tr>
            ) : (
              sortedListings.map((listing) => {
                const pc = listing.priceCheck;
                const isExpanded = expandedIds.has(listing.id);
                const isChecking = checkingId === listing.id;
                const isOmitted = listing.priceCheckOmitted;
                const isSelected = selectedIds.has(listing.id);

                const toggleExpand = () => {
                  setExpandedIds(prev => {
                    const next = new Set(prev);
                    if (next.has(listing.id)) {
                      next.delete(listing.id);
                    } else {
                      next.add(listing.id);
                    }
                    return next;
                  });
                };

                return (
                  <React.Fragment key={listing.id}>
                    <tr
                      className={`hover:bg-gray-50 cursor-pointer ${isExpanded ? 'bg-indigo-50' : ''} ${isChecking ? 'bg-yellow-50 animate-pulse' : ''} ${isOmitted ? 'opacity-60' : ''}`}
                      onClick={toggleExpand}
                    >
                      <td className="px-3 py-4 w-8" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(listing.id)}
                          className="rounded border-gray-300 text-indigo-600"
                        />
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center">
                          <span className="mr-2 text-gray-400">
                            {isExpanded ? '▼' : '▶'}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              {listing.viewItemUrl ? (
                                <a
                                  href={listing.viewItemUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800 hover:underline max-w-xs truncate block"
                                  title={listing.title}
                                  onClick={e => e.stopPropagation()}
                                >
                                  {listing.title}
                                </a>
                              ) : (
                                <div className="text-sm font-medium text-gray-900 max-w-xs truncate" title={listing.title}>
                                  {listing.title}
                                </div>
                              )}
                              {isOmitted && (
                                <span className="shrink-0 text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">
                                  omitted
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">
                              SKU: {listing.sku || "N/A"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-gray-900">
                          ${listing.currentPrice.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {pc ? (
                          <div>
                            <span className="text-sm font-medium text-gray-900">
                              ${pc.marketMedian?.toFixed(2) || "—"}
                            </span>
                            <div className="text-xs text-gray-400">
                              {pc.compCount} comps
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {pc?.suggestedPrice ? (
                          <div>
                            <span className={`text-sm font-bold ${pc.priceDiff > 5 ? "text-red-600" : pc.priceDiff < -5 ? "text-blue-600" : "text-green-600"}`}>
                              ${pc.suggestedPrice.toFixed(2)}
                            </span>
                            {pc.priceDiff !== 0 && (
                              <div className="text-xs text-gray-400">
                                {pc.priceDiff > 0 ? `-$${pc.priceDiff.toFixed(0)}` : `+$${Math.abs(pc.priceDiff).toFixed(0)}`}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                        {listing.daysListed}d
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap text-center">
                        {pc?.priceDiffPercent != null ? (
                          <span className={`text-sm font-bold ${
                            pc.priceDiffPercent > 20 ? "text-red-600" :
                            pc.priceDiffPercent > 10 ? "text-orange-500" :
                            pc.priceDiffPercent < -10 ? "text-blue-600" :
                            "text-green-600"
                          }`}>
                            {pc.priceDiffPercent > 0 ? "+" : ""}{pc.priceDiffPercent.toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {isChecking ? (
                          <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800 flex items-center">
                            <svg className="animate-spin h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Checking...
                          </span>
                        ) : isOmitted ? (
                          <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-500">
                            Omitted
                          </span>
                        ) : pc ? (
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getVerdictStyle(pc.verdict)}`}>
                            {pc.verdict}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">Not checked</span>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end space-x-2" onClick={(e) => e.stopPropagation()}>
                          {!isOmitted && (
                            isChecking ? (
                              <span className="text-yellow-600 text-xs font-medium">
                                Scanning eBay...
                              </span>
                            ) : (
                              <button
                                onClick={() => checkPrice(listing, !!pc)}
                                className="text-indigo-600 hover:text-indigo-900 text-xs"
                              >
                                {pc ? "Refresh" : "Check"}
                              </button>
                            )
                          )}
                          <button
                            onClick={() => toggleOmit(listing)}
                            className={`text-xs ${isOmitted ? 'text-indigo-600 hover:text-indigo-900' : 'text-gray-400 hover:text-gray-600'}`}
                          >
                            {isOmitted ? "Restore" : "Omit"}
                          </button>
                          {listing.viewItemUrl && (
                            <a
                              href={listing.viewItemUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-400 hover:text-gray-600 text-xs"
                            >
                              eBay
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded Details Row - only render when pc exists and not omitted */}
                    {pc && !isOmitted && (
                    <tr className="bg-gray-50">
                      <td colSpan="9" className="p-0 overflow-hidden">
                        <div
                          className={`transition-all duration-300 ease-in-out ${
                            isExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
                          }`}
                          style={{ overflow: 'hidden' }}
                        >
                          <div className="px-6 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Search Info */}
                            <div>
                              <h4 className="text-sm font-semibold text-gray-700 mb-2">Search Details</h4>
                              <div className="bg-white rounded p-3 text-sm space-y-1">
                                <div><span className="text-gray-500">Query:</span> <span className="ml-1 font-mono text-gray-800">{pc.searchQuery || 'N/A'}</span></div>
                                <div><span className="text-gray-500">Part Type:</span> {pc.partType || 'N/A'}</div>
                                <div><span className="text-gray-500">Vehicle:</span> {[pc.make, pc.model, pc.years].filter(Boolean).join(' ') || 'N/A'}</div>
                                <div><span className="text-gray-500">Sales Velocity:</span> {pc.salesPerWeek?.toFixed(1) || '—'} per week</div>
                                <div><span className="text-gray-500">Last Checked:</span> {new Date(pc.checkedAt).toLocaleString()}</div>
                              </div>
                            </div>

                            {/* Price Range */}
                            <div>
                              <h4 className="text-sm font-semibold text-gray-700 mb-2">Market Price Range</h4>
                              <div className="bg-white rounded p-3">
                                <div className="flex items-center justify-between text-sm mb-2">
                                  <span className="text-green-600 font-medium">${pc.marketMin?.toFixed(2)}</span>
                                  <span className="text-gray-400">—</span>
                                  <span className="text-indigo-600 font-bold">${pc.marketMedian?.toFixed(2)}</span>
                                  <span className="text-gray-400">—</span>
                                  <span className="text-red-600 font-medium">${pc.marketMax?.toFixed(2)}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs text-gray-400">
                                  <span>Min</span>
                                  <span>Median</span>
                                  <span>Max</span>
                                </div>
                                <div className="mt-3 text-sm">
                                  <span className="text-gray-500">Your price is </span>
                                  <span className={`font-bold ${pc.priceDiffPercent > 10 ? 'text-red-600' : pc.priceDiffPercent < -10 ? 'text-blue-600' : 'text-green-600'}`}>
                                    {pc.priceDiffPercent > 0 ? '+' : ''}{pc.priceDiffPercent?.toFixed(0)}%
                                  </span>
                                  <span className="text-gray-500"> {pc.priceDiffPercent > 0 ? 'above' : 'below'} median</span>
                                </div>
                              </div>
                            </div>

                            {/* Comparable Sales */}
                            <div className="md:col-span-2">
                              <h4 className="text-sm font-semibold text-gray-700 mb-2">
                                Comparable Sold Items ({pc.topComps?.length || 0} shown of {pc.compCount} found)
                              </h4>
                              {pc.topComps && pc.topComps.length > 0 ? (
                                <div className="bg-white rounded overflow-hidden">
                                  <table className="min-w-full text-sm">
                                    <thead className="bg-gray-100">
                                      <tr>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Title</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Sold Price</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Sold Date</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Match</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {pc.topComps.map((comp, idx) => (
                                        <tr key={idx} className="hover:bg-gray-50">
                                          <td className="px-3 py-2 text-gray-900 max-w-md truncate" title={comp.title}>
                                            {comp.title}
                                          </td>
                                          <td className="px-3 py-2 text-right font-medium text-green-600">
                                            ${comp.price?.toFixed(2)}
                                          </td>
                                          <td className="px-3 py-2 text-right text-gray-500">
                                            {comp.soldDate}
                                          </td>
                                          <td className="px-3 py-2 text-right">
                                            <span className={`px-2 py-0.5 rounded text-xs ${
                                              comp.score >= 90 ? 'bg-green-100 text-green-700' :
                                              comp.score >= 70 ? 'bg-yellow-100 text-yellow-700' :
                                              'bg-gray-100 text-gray-600'
                                            }`}>
                                              {comp.score || '—'}%
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="bg-white rounded p-4 text-center text-gray-500">
                                  No comparable items recorded. Click "Refresh" to fetch new data.
                                </div>
                              )}
                            </div>
                          </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                    )}
                    {/* Expanded row for unchecked items */}
                    {!pc && !isOmitted && (
                      <tr className={`bg-gray-50 ${!isExpanded && !isChecking ? 'hidden' : ''}`}>
                        <td colSpan="9" className="p-0 overflow-hidden">
                          <div
                            className={`transition-all duration-300 ease-in-out ${
                              isExpanded && !isChecking ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
                            }`}
                            style={{ overflow: 'hidden' }}
                          >
                            <div className="px-6 py-8 text-center">
                              <p className="text-gray-500 mb-3">This item hasn't been price checked yet.</p>
                              <button
                                onClick={(e) => { e.stopPropagation(); checkPrice(listing, false); }}
                                className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm"
                              >
                                Run Price Check
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    {/* Expanded row showing checking in progress */}
                    {isChecking && (
                      <tr className="bg-yellow-50">
                        <td colSpan="9" className="p-0 overflow-hidden">
                          <div
                            className={`transition-all duration-300 ease-in-out ${
                              isChecking ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
                            }`}
                            style={{ overflow: 'hidden' }}
                          >
                            <div className="px-6 py-8 text-center">
                              <div className="flex items-center justify-center space-x-3">
                                <svg className="animate-spin h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span className="text-yellow-700 font-medium">Scanning eBay for sold items...</span>
                              </div>
                              <p className="text-yellow-600 text-sm mt-2">This may take 10-30 seconds</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="mt-4 bg-white shadow rounded-lg px-6 py-4 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Showing {((page - 1) * limit) + 1} - {Math.min(page * limit, totalListings)} of {totalListings.toLocaleString()} listings
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

      {/* Legend */}
      <div className="mt-4 text-xs text-gray-500">
        <span className="font-medium">Suggested Price:</span> 5% below market median for faster sales.
        Price checks run automatically once a week for non-omitted listings.
      </div>
    </div>
  );
}

export default PriceCheck;
