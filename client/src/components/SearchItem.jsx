import { useRequest } from "ahooks";
import { useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { toast } from "react-toastify";
import { useGrid } from "../context";
import { useUserData } from "../context/user";
import AXIOS from "../utils/axios";
import AutoTable from "./AutoSearchForm/AutoTable";
import Banner from "./Banner";
import Loading from "./loading";

const SearchItem = () => {
  const { state: { user: userData } } = useUserData();

  const columns = useMemo(() => {
    const myColumns = [
      { Header: "Title", accessor: "title" },
      { Header: "Part Number", accessor: "manufacturerPartNumber" },
      { Header: "Category", accessor: "categoryTitle" },
    ];

    if (userData.canSeePrice) {
      myColumns.splice(1, 0, { Header: "Price", accessor: "price" });
    }

    return myColumns;
  }, [userData.canSeePrice]);

  const [fetched, setFetched] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [grid, dispatchGrid] = useGrid();
  const [selectedCategory, setSelectedCategory] = useState(grid.searchItemcategory);
  const [inputTitle, setInputTitle] = useState(grid.searchItemTitle);
  const [inputSeller, setInputSeller] = useState(grid.searchItemSeller);
  const [inputManufacturePartNum, setInputManufacturePartNum] = useState(grid.searchItemManufacturerPartNum);
  const { state: { user } } = useUserData();

  const fetchItems = async (body) => {
    setFetched(true);
    const res = await AXIOS.get("/items/lookup/search", { params: body });
    dispatchGrid({ type: "UPDATE", grid: { searchItemResult: res.data || [] } });
    return res.data || [];
  };

  const { loading, run } = useRequest((body) => fetchItems(body), { manual: true });

  const onSubmit = (e) => {
    e.preventDefault();

    const title = e.target["title"].value.trim();
    const seller = e.target["seller"] ? e.target["seller"].value.trim() : "";
    const manufacturerPartNumber = e.target["manufacturerPartNumber"].value.trim();

    const body = {};
    const searchItemParams = {};

    if (title) {
      body["title"] = title;
      searchItemParams["searchItemTitle"] = title;
    }
    if (seller) {
      body["seller"] = seller;
      searchItemParams["searchItemSeller"] = seller;
    }
    if (selectedCategory) {
      body["categoryTitle"] = selectedCategory.value;
      searchItemParams["searchItemcategory"] = selectedCategory.value;
    }
    if (manufacturerPartNumber) {
      body["manufacturerPartNumber"] = manufacturerPartNumber;
      searchItemParams["searchItemManufacturerPartNum"] = manufacturerPartNumber;
    }

    dispatchGrid({ type: "UPDATE", grid: { ...searchItemParams } });

    if (Object.keys(body).length === 0) {
      toast.error("Please fill at least one field");
      return;
    }

    run(body);
  };

  useEffect(() => {
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
  }, []);

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

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-4xl mx-auto">
      <Banner
        title="Home > Search"
        subtitle="Search by title, seller, category and more"
      />

      {/* Search Form */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <form onSubmit={onSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
              <input
                type="text"
                name="title"
                placeholder="Search by title..."
                onChange={(e) => setInputTitle(e.target.value)}
                value={inputTitle}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
              />
            </div>

            {/* Seller (Admin only) */}
            {user.isAdmin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Seller</label>
                <input
                  type="text"
                  name="seller"
                  placeholder="Search by seller..."
                  onChange={(e) => setInputSeller(e.target.value)}
                  value={inputSeller}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
                />
              </div>
            )}

            {/* Category */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
              <Select
                styles={selectStyles}
                placeholder="Select category"
                onChange={setSelectedCategory}
                value={selectedCategory}
                options={categoryOptions}
                isClearable
              />
            </div>

            {/* Part Number */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Manufacturer Part Number</label>
              <input
                type="text"
                name="manufacturerPartNumber"
                placeholder="Search by part number..."
                onChange={(e) => setInputManufacturePartNum(e.target.value)}
                value={inputManufacturePartNum}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              className="bg-indigo-500 hover:bg-indigo-600 text-white px-8 py-3 rounded-lg font-medium transition-colors"
            >
              Search
            </button>
          </div>
        </form>
      </div>

      {/* Results */}
      {(fetched || grid.searchItemResult) && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Results</h2>
            {!loading && grid.searchItemResult && (
              <p className="text-sm text-gray-500 mt-1">
                Found {grid.searchItemResult.length} item{grid.searchItemResult.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>

          <div className="p-6">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loading />
              </div>
            ) : grid.searchItemResult && grid.searchItemResult.length > 0 ? (
              <AutoTable columns={columns} data={grid.searchItemResult} />
            ) : (
              <p className="text-center text-gray-500 py-8">No results found. Try adjusting your search criteria.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchItem;
