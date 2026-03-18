import React, { useState, useEffect } from "react";
import { useHistory, useParams, Link } from "react-router-dom";
import { useItem, useUserData } from "../context";
import Loading from "./loading";
import Table from "./Table";
import Modal from "./Modal";
import { toast } from "react-toastify";
import Banner from "./Banner";
import CompatibilityFeature from "./AutoSearch/CompatibilityFeature";
import Select from "react-select";
import AXIOS from "../utils/axios";

const columns = [
  { Header: "Year", accessor: "year" },
  { Header: "Make", accessor: "make" },
  { Header: "Model", accessor: "model" },
  { Header: "Trim", accessor: "trim" },
  { Header: "Engine", accessor: "engine" },
];

const EditItem = () => {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [selectedItem, dispatchItem] = useItem();
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectedRows, setSelectedRows] = useState(null);
  const [difficulty, setDifficulty] = useState(0);
  const [salesEase, setSalesEase] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [data, setData] = useState({
    title: "",
    notes: "",
    price: "",
    pictureUrl: "",
    manufacturerPartNumber: "",
  });

  const history = useHistory();
  const { state: { user } } = useUserData();

  const deleteItem = () => {
    toast.info("Deleting item...");

    AXIOS.delete(`/items/${id}`)
      .then(() => {
        toast.success("Item deleted successfully");
        setTimeout(() => {
          history.push("/");
          window.location.reload();
        }, 20);
      })
      .catch((err) => {
        toast.error("Item not deleted");
        console.log("err: ", err);
      });
  };

  const getValue = () => {
    if (!difficulty || !salesEase) return "";
    return parseFloat((salesEase / difficulty).toFixed(2));
  };

  const getDate = (date) => {
    const dateObject = new Date(date);
    return dateObject.toDateString() + ", " + dateObject.toLocaleTimeString();
  };

  const onSubmit = () => {
    const body = {
      id,
      title: data.title || selectedItem.title,
      pictureUrl: data.pictureUrl || selectedItem.pictureUrl,
      price: data.price || selectedItem.price,
      notes: data.notes || selectedItem.notes,
      categoryTitle: (selectedCategory && selectedCategory.value) || selectedItem.category,
      manufacturerPartNumber: data.manufacturerPartNumber || selectedItem.manufacturerPartNumber,
      salesEase: salesEase || null,
      difficulty: difficulty || null,
      auto: selectedItems?.map((item) => item) || [],
    };

    toast.info("Updating item...");

    AXIOS.put(`/items/${id}`, body)
      .then(() => {
        toast.success("Item successfully updated");
        history.push(`/item/${id}`);
        setTimeout(() => dispatchItem({ type: "UPDATE", item: null }), 0);
      })
      .catch((err) => {
        toast.error("Item not updated");
        console.log("err: ", err);
      });
  };

  const fetchItem = async () => {
    const res = await AXIOS.get(`/items/${id}`);
    dispatchItem({ type: "UPDATE", item: res.data[0] });
    setSelectedItems(res.data[0].autoCompatibilities);
    setLoading(false);
  };

  useEffect(() => {
    if (selectedItem) {
      if (id !== selectedItem.id) fetchItem();
      else {
        setSelectedItems(selectedItem.autoCompatibilities);
        setLoading(false);
        selectedItem.autoCompatibilities.forEach((item) => {
          setSelectedIds((prevId) => [...prevId, item]);
        });
        setData({
          manufacturerPartNumber: selectedItem.manufacturerPartNumber || null,
          title: selectedItem.title,
          price: selectedItem.price,
          notes: selectedItem.notes,
          pictureUrl: selectedItem.pictureUrl,
        });
      }
    } else {
      fetchItem();
    }
  }, [selectedItem]);

  useEffect(() => {
    if (user.isAdmin === "false") {
      history.push("/");
    }

    AXIOS.get("/filters/item?field=categoryTitle")
      .then((response) => {
        if (response.data) {
          response.data.forEach((item) => {
            setCategoryOptions((prevState) => [
              ...prevState,
              { label: item, value: item },
            ]);
          });
        }
      })
      .catch((err) => console.log("err: ", err));
  }, [history, user.isAdmin]);

  const selectStyles = {
    control: (provided, state) => ({
      ...provided,
      borderRadius: '8px',
      borderColor: state.isFocused ? '#6366f1' : '#d1d5db',
      boxShadow: state.isFocused ? '0 0 0 3px rgba(99, 102, 241, 0.1)' : 'none',
      minHeight: '44px',
      '&:hover': { borderColor: '#9ca3af' },
    }),
    option: (provided, state) => ({
      ...provided,
      color: '#111827',
      backgroundColor: state.isSelected ? '#6366f1' : state.isFocused ? '#f3f4f6' : 'white',
    }),
    singleValue: (provided) => ({ ...provided, color: '#111827' }),
    placeholder: (provided) => ({ ...provided, color: '#9ca3af' }),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loading />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-3xl mx-auto">
      <Banner
        title="Home > Edit Item"
        subtitle="Update the item details and save changes"
      />

      <div className="bg-white rounded-lg shadow p-6">
        {/* Title */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
          <input
            type="text"
            placeholder="Title"
            value={data.title}
            onChange={(e) => setData({ ...data, title: e.target.value })}
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
          />
        </div>

        {/* Price */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Price</label>
          <input
            type="number"
            step="any"
            placeholder="0.00"
            value={data.price}
            onChange={(e) => setData({ ...data, price: e.target.value })}
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
          />
        </div>

        {/* Picture URL */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Picture URL</label>
          <input
            type="text"
            placeholder="https://..."
            value={data.pictureUrl}
            onChange={(e) => setData({ ...data, pictureUrl: e.target.value })}
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
          />
        </div>

        {/* Category */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
          <Select
            defaultValue={
              selectedItem?.categoryTitle && {
                label: selectedItem.categoryTitle,
                value: selectedItem.categoryTitle,
              }
            }
            styles={selectStyles}
            placeholder="Select category"
            onChange={setSelectedCategory}
            value={selectedCategory}
            options={categoryOptions}
            isClearable
          />
        </div>

        {/* Seller (Read-only) */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Seller</label>
          <input
            disabled
            type="text"
            value={selectedItem.seller || ''}
            className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed"
          />
        </div>

        {/* Manufacturer Part Number */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Manufacturer Part Number</label>
          <input
            type="text"
            placeholder="Enter part number"
            value={data.manufacturerPartNumber}
            onChange={(e) => setData({ ...data, manufacturerPartNumber: e.target.value })}
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
          />
        </div>

        {/* Updated At (Read-only) */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Last Updated</label>
          <input
            disabled
            type="text"
            value={getDate(selectedItem.updatedAt)}
            className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed"
          />
        </div>

        {/* Sales Ease & Difficulty */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sales Ease
              <span className="text-gray-400 font-normal ml-1">(1-5)</span>
            </label>
            <select
              defaultValue={selectedItem.salesEase}
              onChange={(e) => setSalesEase(parseInt(e.target.value))}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
            >
              <option value="">Select</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Difficulty
              <span className="text-gray-400 font-normal ml-1">(1-5)</span>
            </label>
            <select
              defaultValue={selectedItem.difficulty}
              onChange={(e) => setDifficulty(parseInt(e.target.value))}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
            >
              <option value="">Select</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Value Display */}
        {getValue() && (
          <div className="mb-6 p-3 bg-gray-50 rounded-lg">
            <span className="text-sm text-gray-600">Calculated Value: </span>
            <span className="text-lg font-semibold text-indigo-600">{getValue()}</span>
          </div>
        )}

        {/* Notes */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
          <textarea
            placeholder="Add any additional notes..."
            rows={4}
            value={data.notes}
            onChange={(e) => setData({ ...data, notes: e.target.value })}
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-gray-900 placeholder-gray-400"
          />
        </div>

        {/* Vehicle Compatibilities */}
        {selectedItems && selectedItems.length > 0 && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Vehicle Compatibilities ({selectedItems.length})
            </label>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <Table
                columns={columns}
                data={selectedItems}
                removeItem={(obj) =>
                  setSelectedItems(
                    obj.id
                      ? selectedItems.filter((item) => item.id !== obj.id)
                      : selectedItems.filter(
                          (item) =>
                            !(item.make === obj.make && item.model === obj.model && item.trim === obj.trim && item.year === obj.year)
                        )
                  )
                }
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-200">
          <button
            onClick={onSubmit}
            className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            Save Changes
          </button>
          <Link
            to={{ pathname: `/item/add`, state: { autos: selectedItem.autoCompatibilities } }}
            className="flex-1"
          >
            <button className="w-full bg-white hover:bg-gray-50 text-gray-700 px-6 py-3 rounded-lg font-medium border border-gray-300 transition-colors">
              Clone with Same Autos
            </button>
          </Link>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            Delete Item
          </button>
        </div>
      </div>

      {/* Compatibility Section */}
      <div className="mt-8 bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Vehicle Compatibility</h2>
        <CompatibilityFeature
          setSelectedIds={setSelectedIds}
          setSelectedRows={setSelectedRows}
          setSelectedItems={() => {
            setSelectedItems([
              ...selectedItems,
              ...selectedRows.map((row) => row.original),
            ]);
            toast.success("Compatibilities added");
          }}
        />
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Item</h3>
            <p className="text-gray-600 mb-6">Are you sure you want to delete this item? This action cannot be undone.</p>
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

export default EditItem;
