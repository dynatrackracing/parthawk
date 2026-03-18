import { useState, useCallback } from "react";
import { useRequest } from "ahooks";
import { Link, useHistory, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { useUserData } from "../context/user";
import AXIOS from "../utils/axios";
import Table from "./Table";
import Banner from "./Banner";
import Loading from "./loading";

const timeAgo = (dateStr) => {
  if (!dateStr) return null;
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${diffYears}y ago`;
};

const verdictColor = (verdict) => {
  if (!verdict) return "bg-gray-100 text-gray-800";
  switch (verdict) {
    case "OVERPRICED": return "bg-red-100 text-red-800";
    case "SLIGHTLY HIGH": return "bg-orange-100 text-orange-800";
    case "MARKET PRICE": return "bg-green-100 text-green-800";
    case "GOOD VALUE": return "bg-emerald-200 text-emerald-900";
    case "UNDERPRICED": return "bg-blue-100 text-blue-800";
    default: return "bg-gray-100 text-gray-800";
  }
};

const columns = [
  { Header: "Year", accessor: "year" },
  { Header: "Make", accessor: "make" },
  { Header: "Model", accessor: "model" },
  { Header: "Trim", accessor: "trim" },
  { Header: "Engine", accessor: "engine" },
];

const ItemDetail = () => {
  const { id } = useParams();
  const history = useHistory();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [priceCheck, setPriceCheck] = useState(null);
  const [priceCheckLoading, setPriceCheckLoading] = useState(false);
  const {
    state: { user },
  } = useUserData();

  const deleteItem = () => {
    toast.info("Deleting item...");

    AXIOS.delete(`/items/${id}`)
      .then(() => {
        toast.success("Item deleted successfully");
        setTimeout(() => history.push("/"), 0);
      })
      .catch((err) => {
        toast.error("Item not deleted");
        console.log("err: ", err);
      });
  };

  const runPriceCheck = useCallback(async (title, price) => {
    setPriceCheckLoading(true);
    try {
      const res = await AXIOS.post("/price-check/title", { title, price });
      setPriceCheck(res.data);
    } catch (err) {
      toast.error("Price check failed");
      console.error("Price check error:", err);
    } finally {
      setPriceCheckLoading(false);
    }
  }, []);

  const getItem = async () => {
    const res = await AXIOS.get(`/items/${id}`);
    return res.data[0];
  };

  const { data, loading } = useRequest(() => getItem(), {
    ready: id,
  });

  const getValue = (salesEase, difficulty) => {
    if (salesEase && difficulty) {
      return parseFloat((salesEase / difficulty).toFixed(2));
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loading />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-4xl mx-auto">
        <Banner title="Home > Item" subtitle="Item not found" />
        <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
          The requested item could not be found.
        </div>
      </div>
    );
  }

  const calculatedValue = getValue(data.salesEase, data.difficulty);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-4xl mx-auto">
      <Banner
        title="Home > Item Details"
        subtitle={data.title}
      />

      {/* Main Content Card */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="md:flex">
          {/* Image Section */}
          {data.pictureUrl && (
            <div className="md:w-1/3 p-6 bg-gray-50">
              <img
                alt={data.title}
                className="w-full rounded-lg shadow-sm object-cover"
                src={data.pictureUrl}
              />
            </div>
          )}

          {/* Details Section */}
          <div className={`${data.pictureUrl ? 'md:w-2/3' : 'w-full'} p-6`}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                {data.title}
              </h2>
              {data.createdAt && (
                <span
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600"
                  title={`Ingested: ${new Date(data.createdAt).toLocaleString()}`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {timeAgo(data.createdAt)}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Price */}
              <div className="bg-indigo-50 rounded-lg p-4">
                <span className="text-sm text-gray-500">Price</span>
                <p className="text-2xl font-bold text-indigo-600">${data.price}</p>
              </div>

              {/* Category */}
              {data.categoryTitle && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <span className="text-sm text-gray-500">Category</span>
                  <p className="text-lg font-medium text-gray-900">{data.categoryTitle}</p>
                </div>
              )}

              {/* Manufacturer Part Number */}
              {data.manufacturerPartNumber && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <span className="text-sm text-gray-500">Part Number</span>
                  <p className="text-lg font-medium text-gray-900">{data.manufacturerPartNumber}</p>
                </div>
              )}

              {/* Repair Item */}
              <div className="bg-gray-50 rounded-lg p-4">
                <span className="text-sm text-gray-500">Repair Item</span>
                <p className="text-lg font-medium text-gray-900">
                  {data.isRepair ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                      Yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      No
                    </span>
                  )}
                </p>
              </div>

              {/* Sales Ease */}
              {data.salesEase && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <span className="text-sm text-gray-500">Sales Ease</span>
                  <p className="text-lg font-medium text-gray-900">{data.salesEase} / 5</p>
                </div>
              )}

              {/* Difficulty */}
              {data.difficulty && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <span className="text-sm text-gray-500">Difficulty</span>
                  <p className="text-lg font-medium text-gray-900">{data.difficulty} / 5</p>
                </div>
              )}

              {/* Calculated Value */}
              {calculatedValue && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <span className="text-sm text-gray-500">Calculated Value</span>
                  <p className="text-lg font-medium text-indigo-600">{calculatedValue}</p>
                </div>
              )}
            </div>

            {/* Notes */}
            {data.notes && (
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-500 block mb-2">Notes</span>
                <p className="text-gray-700">{data.notes}</p>
              </div>
            )}
            {/* Price Check Section */}
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-700">Market Price Check</span>
                <button
                  onClick={() => runPriceCheck(data.title, data.price)}
                  disabled={priceCheckLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white transition-colors"
                >
                  {priceCheckLoading ? (
                    <>
                      <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Checking...
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      {priceCheck ? "Re-check" : "Check Price"}
                    </>
                  )}
                </button>
              </div>

              {priceCheck && priceCheck.metrics && (
                <div className="space-y-3">
                  {/* Verdict */}
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${verdictColor(priceCheck.metrics.verdict)}`}>
                      {priceCheck.metrics.verdict}
                    </span>
                    {priceCheck.metrics.priceDiffPercent != null && (
                      <span className="text-sm text-gray-500">
                        {priceCheck.metrics.priceDiffPercent > 0 ? "+" : ""}
                        {priceCheck.metrics.priceDiffPercent.toFixed(1)}% vs market
                      </span>
                    )}
                  </div>

                  {/* Market stats grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-white rounded p-2 text-center">
                      <div className="text-xs text-gray-400">Median</div>
                      <div className="text-sm font-semibold text-gray-900">${priceCheck.metrics.median?.toFixed(2)}</div>
                    </div>
                    <div className="bg-white rounded p-2 text-center">
                      <div className="text-xs text-gray-400">Average</div>
                      <div className="text-sm font-semibold text-gray-900">${priceCheck.metrics.avg?.toFixed(2)}</div>
                    </div>
                    <div className="bg-white rounded p-2 text-center">
                      <div className="text-xs text-gray-400">Range</div>
                      <div className="text-sm font-semibold text-gray-900">${priceCheck.metrics.min?.toFixed(0)} – ${priceCheck.metrics.max?.toFixed(0)}</div>
                    </div>
                    <div className="bg-white rounded p-2 text-center">
                      <div className="text-xs text-gray-400">Comps</div>
                      <div className="text-sm font-semibold text-gray-900">{priceCheck.metrics.count}</div>
                    </div>
                  </div>

                  {/* Sales velocity */}
                  {priceCheck.metrics.salesPerWeek != null && (
                    <div className="text-xs text-gray-500">
                      ~{priceCheck.metrics.salesPerWeek.toFixed(1)} sales/week
                      {priceCheck.searchQuery && <span className="ml-2 text-gray-400">| searched: "{priceCheck.searchQuery}"</span>}
                    </div>
                  )}

                  {/* Top comps */}
                  {priceCheck.topComps && priceCheck.topComps.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-indigo-600 hover:text-indigo-800 font-medium">
                        View top comparables ({priceCheck.topComps.length})
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {priceCheck.topComps.map((comp, i) => (
                          <li key={i} className="flex justify-between items-center bg-white rounded px-2 py-1">
                            <span className="text-gray-700 truncate mr-2">{comp.title}</span>
                            <span className="font-medium text-gray-900 shrink-0">${comp.price?.toFixed(2)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              {priceCheck && !priceCheck.metrics && (
                <p className="text-sm text-gray-500">No comparable sales found for this item.</p>
              )}
            </div>
          </div>
        </div>

        {/* Vehicle Compatibilities */}
        {data.autoCompatibilities && data.autoCompatibilities.length > 0 && (
          <div className="border-t border-gray-200">
            <div className="px-6 py-4 bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900">
                Vehicle Compatibilities ({data.autoCompatibilities.length})
              </h3>
            </div>
            <Table columns={columns} data={data.autoCompatibilities} />
          </div>
        )}

        {/* Action Buttons (Admin only) */}
        {user.isAdmin && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
            <div className="flex flex-col sm:flex-row gap-3">
              <Link to={`/item/edit/${id}`} className="flex-1">
                <button
                  type="button"
                  className="w-full bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium transition-colors"
                >
                  Edit Item
                </button>
              </Link>
              <Link
                to={{
                  pathname: `/item/add`,
                  state: { autos: data.autoCompatibilities },
                }}
                className="flex-1"
              >
                <button
                  type="button"
                  className="w-full bg-white hover:bg-gray-50 text-gray-700 px-6 py-3 rounded-lg font-medium border border-gray-300 transition-colors"
                >
                  Clone with Same Autos
                </button>
              </Link>
              <button
                onClick={() => setShowDeleteModal(true)}
                type="button"
                className="flex-1 bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-lg font-medium transition-colors"
              >
                Delete Item
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Item</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this item? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg font-medium border border-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={deleteItem}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ItemDetail;
