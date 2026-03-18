import React, { useState, useEffect } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { useGrid, useUserData } from "../context";
import { toast } from "react-toastify";
import Table from "./Table";
import Banner from "./Banner";
import CompatibilityFeature from "./AutoSearch/CompatibilityFeature";
import Select from "react-select";
import AXIOS from "../utils/axios";

const columns = [
  {
    Header: "Year",
    Footer: "Year",
    accessor: "year",
  },
  {
    Header: "Make",
    Footer: "Make",
    accessor: "make",
  },
  {
    Header: "Model",
    Footer: "Model",
    accessor: "model",
  },
  {
    Header: "Trim",
    Footer: "Trim",
    accessor: "trim",
  },
  {
    Header: "Engine",
    Footer: "Engine",
    accessor: "engine",
  },
];

const AddItem = () => {
  const location = useLocation();
  const [difficulty, setDifficulty] = useState(0);
  const [salesEase, setSalesEase] = useState(0);
  const [selectedRows, setSelectedRows] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);

  const [categoryOptions, setCategoryOptions] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState();
  const [data, setData] = useState({
    title: "",
    notes: "",
    price: "",
    pictureUrl: "",
    manufacturerPartNumber: "",
  });

  const history = useHistory();
  const [, dispatchGrid] = useGrid();
  const {
    state: { user },
  } = useUserData();

  const getValue = () => {
    if (!difficulty) return "";
    if (!salesEase) return "";

    const value = parseFloat((salesEase / difficulty).toFixed(2));
    return value;
  };

  const onSubmit = (saveType) => {
    if (data.title && data.price) {
      const title = data.title && data.title.trim();
      const notes = data.notes && data.notes.trim();
      const price = data.price;
      const pictureUrl = data.pictureUrl && data.pictureUrl.trim();
      const manufacturerPartNumber =
        data.manufacturerPartNumber && data.manufacturerPartNumber.trim();

      const body = {
        title,
        price,
        auto: selectedItems?.map((selectedItem) => selectedItem) || [],
        pictureUrl,
        manufacturerPartNumber,
      };

      if (notes) body["notes"] = notes;
      if (salesEase) body["salesEase"] = salesEase;
      if (difficulty) body["difficulty"] = difficulty;
      if (selectedCategory) body["categoryTitle"] = selectedCategory.value;

      toast.info("Adding item...");

      setTimeout(() => {
        if (saveType === "save") {
          AXIOS.post("/items", body)
            .then((response) => {
              dispatchGrid({ type: "RESET" });
              toast.success("Item successfully added");
              history.push(`/item/${response.data.id}`);
            })
            .catch((err) => {
              toast.error("Item not added");
              console.log("err: ", err);
            });
        } else if (saveType === "save-and-stay") {
          AXIOS.post("/items", body)
            .then(() => {
              setData({
                ...data,
                title: "",
                notes: "",
                price: "",
                pictureUrl: "",
              });
              setSelectedCategory({});
              setDifficulty(0);
              setSalesEase(0);
              toast.success("Item successfully added");
            })
            .catch((err) => {
              toast.error("Item not added");
              console.log("err: ", err);
            });
        }
      }, 10);
    }
  };

  // Getting all categories
  useEffect(() => {
    if (!user?.isAdmin) {
      history.push("/");
    }
    AXIOS.get("/filters/item?field=categoryTitle")
      .then((response) => {
        if (response.data) {
          response.data.map((item) =>
            setCategoryOptions((prevState) => [
              ...prevState,
              { label: item, value: item },
            ])
          );
        }
      })
      .catch((err) => {
        console.log("err: ", err);
      });

    if (location.state && location.state.autos) {
      setSelectedItems(location.state.autos);
    }
  }, []);

  const handleSelectCategory = (item) => {
    setSelectedCategory(item);
  };

  const selectStyles = {
    control: (provided, state) => ({
      ...provided,
      borderRadius: '8px',
      borderColor: state.isFocused ? '#6366f1' : '#d1d5db',
      boxShadow: state.isFocused ? '0 0 0 3px rgba(99, 102, 241, 0.1)' : 'none',
      minHeight: '44px',
      '&:hover': {
        borderColor: '#9ca3af',
      },
    }),
    option: (provided, state) => ({
      ...provided,
      color: '#111827',
      backgroundColor: state.isSelected ? '#6366f1' : state.isFocused ? '#f3f4f6' : 'white',
    }),
    singleValue: (provided) => ({
      ...provided,
      color: '#111827',
    }),
    placeholder: (provided) => ({
      ...provided,
      color: '#9ca3af',
    }),
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-3xl mx-auto">
      <Banner
        title="Home > Add Item"
        subtitle="Fill out the form to add a new item to inventory"
      />

      <div className="bg-white rounded-lg shadow p-6">
        {/* Title */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            value={data.title}
            onChange={(e) => setData({ ...data, title: e.target.value })}
            type="text"
            placeholder="Enter item title"
            name="title"
            required
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
          />
        </div>

        {/* Price */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Price <span className="text-red-500">*</span>
          </label>
          <input
            value={data.price}
            onChange={(e) => setData({ ...data, price: e.target.value })}
            type="number"
            step="any"
            name="price"
            placeholder="0.00"
            required
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
          />
        </div>

        {/* Picture URL */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Picture URL
          </label>
          <input
            value={data.pictureUrl}
            onChange={(e) => setData({ ...data, pictureUrl: e.target.value })}
            type="text"
            name="pictureUrl"
            placeholder="https://..."
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
          />
        </div>

        {/* Manufacturer Part Number */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Manufacturer Part Number
          </label>
          <input
            value={data.manufacturerPartNumber}
            onChange={(e) =>
              setData({ ...data, manufacturerPartNumber: e.target.value })
            }
            type="text"
            name="ManufacturerPartNumber"
            placeholder="Enter part number"
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
          />
        </div>

        {/* Category */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Category
          </label>
          <Select
            styles={selectStyles}
            placeholder="Select category"
            onChange={handleSelectCategory}
            value={selectedCategory}
            name="category"
            options={categoryOptions}
            isClearable
          />
        </div>

        {/* Sales Ease & Difficulty - Side by Side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sales Ease
              <span className="text-gray-400 font-normal ml-1">(1-5, higher = easier)</span>
            </label>
            <select
              value={salesEase}
              onChange={(e) => setSalesEase(parseInt(e.target.value))}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
            >
              <option value={0}>Select</option>
              {[1, 2, 3, 4, 5].map((number) => (
                <option key={number} value={number}>{number}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Difficulty
              <span className="text-gray-400 font-normal ml-1">(1-5, higher = harder)</span>
            </label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(parseInt(e.target.value))}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
            >
              <option value={0}>Select</option>
              {[1, 2, 3, 4, 5].map((number) => (
                <option key={number} value={number}>{number}</option>
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
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Notes
          </label>
          <textarea
            value={data.notes}
            onChange={(e) => setData({ ...data, notes: e.target.value })}
            name="notes"
            placeholder="Add any additional notes..."
            rows={4}
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-gray-900 placeholder-gray-400"
          />
        </div>

        {/* Selected Compatibilities */}
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
                    selectedItems.filter(
                      (selectedItem) =>
                        !(
                          selectedItem.make === obj.make &&
                          selectedItem.model === obj.model &&
                          selectedItem.trim === obj.trim &&
                          selectedItem.year === obj.year
                        )
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
            onClick={() => onSubmit("save")}
            className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            type="submit"
          >
            Save Item
          </button>
          <button
            onClick={() => onSubmit("save-and-stay")}
            className="flex-1 bg-white hover:bg-gray-50 text-gray-700 px-6 py-3 rounded-lg font-medium border border-gray-300 transition-colors"
            type="submit"
          >
            Save and Add Another
          </button>
        </div>
      </div>

      {/* Compatibility Section */}
      <div className="mt-8 bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Vehicle Compatibility</h2>
        <CompatibilityFeature
          setSelectedRows={setSelectedRows}
          setSelectedItems={() => {
            if (!selectedRows || selectedRows.length === 0) {
              toast.error("Please select compatibilities first");
              return;
            }
            toast.success("Selected Compatibilities Added");
            setSelectedItems([
              ...selectedItems,
              ...selectedRows.map(
                (selectedRow) => selectedRow.original
              ),
            ]);
          }}
        />
      </div>
    </div>
  );
};

export default AddItem;
