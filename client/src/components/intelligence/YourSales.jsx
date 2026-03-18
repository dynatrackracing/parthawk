import React, { useEffect, useState, useCallback } from "react";
import axios from "../../utils/axios";
import { toast } from "react-toastify";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  BarController,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  BarController,
  Title,
  Tooltip,
  Legend,
  Filler
);

function YourSales() {
  const [sales, setSales] = useState([]);
  const [trends, setTrends] = useState([]);
  const [totals, setTotals] = useState({});
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('daily');
  const [daysBack, setDaysBack] = useState(90);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalSales, setTotalSales] = useState(0);
  const limit = 50;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [salesRes, trendsRes] = await Promise.all([
        axios.get(`/sync/your-sales?page=${page}&limit=${limit}`),
        axios.get(`/sync/your-sales/trends?period=${period}&daysBack=${daysBack}`),
      ]);

      if (salesRes.data.success) {
        setSales(salesRes.data.sales || []);
        setTotalPages(salesRes.data.totalPages || 1);
        setTotalSales(salesRes.data.total || 0);
      }
      if (trendsRes.data.success) {
        setTrends(trendsRes.data.trends || []);
        setTotals(trendsRes.data.totals || {});
      }
    } catch (error) {
      console.error("Error fetching sales:", error);
      toast.error("Failed to load sales data");
    } finally {
      setLoading(false);
    }
  }, [page, period, daysBack]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Calculate additional stats from trends totals (covers all sales, not just current page)
  const totalRevenue = parseFloat(totals.revenue || 0);
  const avgPrice = parseFloat(totals.avgPrice || 0);

  // Calculate this week vs last week
  const now = new Date();
  const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);

  const thisWeekSales = sales.filter(s => new Date(s.soldDate) >= oneWeekAgo);
  const lastWeekSales = sales.filter(s => {
    const date = new Date(s.soldDate);
    return date >= twoWeeksAgo && date < oneWeekAgo;
  });

  const thisWeekRevenue = thisWeekSales.reduce((sum, s) => sum + parseFloat(s.salePrice || 0), 0);
  const lastWeekRevenue = lastWeekSales.reduce((sum, s) => sum + parseFloat(s.salePrice || 0), 0);
  const weekOverWeekChange = lastWeekRevenue > 0
    ? ((thisWeekRevenue - lastWeekRevenue) / lastWeekRevenue * 100).toFixed(0)
    : 0;

  // Chart data
  const chartData = {
    labels: trends.map(t => {
      const date = new Date(t.date);
      return period === 'weekly'
        ? `Week of ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
        : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }),
    datasets: [
      {
        label: 'Revenue ($)',
        data: trends.map(t => parseFloat(t.revenue)),
        borderColor: 'rgb(99, 102, 241)',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        fill: true,
        tension: 0.3,
        yAxisID: 'y',
      },
      {
        label: 'Units Sold',
        data: trends.map(t => t.count),
        borderColor: 'rgb(34, 197, 94)',
        backgroundColor: 'rgba(34, 197, 94, 0.5)',
        type: 'bar',
        yAxisID: 'y1',
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top',
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            if (context.dataset.label === 'Revenue ($)') {
              return `Revenue: $${context.parsed.y.toFixed(2)}`;
            }
            return `Units: ${context.parsed.y}`;
          }
        }
      }
    },
    scales: {
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: 'Revenue ($)',
        },
        ticks: {
          callback: function(value) {
            return '$' + value;
          }
        }
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: 'Units',
        },
        grid: {
          drawOnChartArea: false,
        },
      },
    },
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
          Your Sales History
        </h1>
        <p className="text-gray-500 mt-1">
          Track your sales performance over time
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm font-medium text-gray-500">Total Sales</p>
          <p className="text-2xl font-bold text-gray-900">{totalSales.toLocaleString()}</p>
          <p className="text-xs text-gray-400">all time</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm font-medium text-gray-500">Period Revenue</p>
          <p className="text-2xl font-bold text-green-600">${totalRevenue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
          <p className="text-xs text-gray-400">last {daysBack} days</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm font-medium text-gray-500">Avg Sale Price</p>
          <p className="text-2xl font-bold text-gray-900">${avgPrice.toFixed ? avgPrice.toFixed(2) : avgPrice}</p>
          <p className="text-xs text-gray-400">last {daysBack} days</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm font-medium text-gray-500">This Week</p>
          <p className="text-2xl font-bold text-gray-900">${thisWeekRevenue.toFixed(0)}</p>
          <p className={`text-xs ${parseInt(weekOverWeekChange) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {parseInt(weekOverWeekChange) >= 0 ? '+' : ''}{weekOverWeekChange}% vs last week
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Sales Trend</h2>
          <div className="flex space-x-2">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="text-sm border rounded px-2 py-1"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            <select
              value={daysBack}
              onChange={(e) => setDaysBack(parseInt(e.target.value))}
              className="text-sm border rounded px-2 py-1"
            >
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
              <option value="365">1 year</option>
            </select>
          </div>
        </div>
        <div style={{ height: '300px' }}>
          {trends.length > 0 ? (
            <Line data={chartData} options={chartOptions} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              No data available for the selected period
            </div>
          )}
        </div>
        {trends.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-4 pt-4 border-t">
            <div className="text-center">
              <p className="text-sm text-gray-500">Period Revenue</p>
              <p className="text-xl font-bold text-indigo-600">${parseFloat(totals.revenue || 0).toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-500">Period Units</p>
              <p className="text-xl font-bold text-green-600">{totals.count || 0}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-500">Period Avg</p>
              <p className="text-xl font-bold text-gray-900">${totals.avgPrice || '0.00'}</p>
            </div>
          </div>
        )}
      </div>

      {/* Recent Sales Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-800">Recent Sales</h2>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Item
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Sale Price
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Sold Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Buyer
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sales.length === 0 ? (
              <tr>
                <td colSpan="4" className="px-6 py-12 text-center text-gray-500">
                  No sales found. Sync your eBay data to import sales.
                </td>
              </tr>
            ) : (
              sales.map((sale) => (
                <tr key={sale.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900 max-w-md truncate" title={sale.title}>
                      {sale.title}
                    </div>
                    <div className="text-sm text-gray-500">
                      SKU: {sale.sku || "N/A"}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-green-600">
                      ${parseFloat(sale.salePrice).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {sale.soldDate ? new Date(sale.soldDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {sale.buyerUsername || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="px-6 py-4 bg-gray-50 border-t flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Showing {((page - 1) * limit) + 1} - {Math.min(page * limit, totalSales)} of {totalSales.toLocaleString()} sales
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
    </div>
  );
}

export default YourSales;
