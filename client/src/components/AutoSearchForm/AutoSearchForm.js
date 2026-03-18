import React, { useState, useEffect, useMemo } from "react";
import { useRequest } from "ahooks";
import { toast } from "react-toastify";
import AutoTable from "./AutoTable";
import Loading from "../loading";
import { useGrid } from "../../context";
import { transformSearchData } from "../../utils/transform";
import AXIOS from "../../utils/axios";

const FormComponent = () => {
  const [canSeePrice, setCanSeePrice] = useState(true);

  const columns = useMemo(() => {
    let myColumns = [
      { Header: "Title", accessor: "title" },
      { Header: "Part Number", accessor: "manufacturerPartNumber" },
      { Header: "Category", accessor: "categoryTitle" },
    ];
    if (canSeePrice) {
      myColumns.splice(1, 0, { Header: "Price", accessor: "price" });
    }
    return myColumns;
  }, [canSeePrice]);

  const [fetched, setFetched] = useState(false);
  const [year, setYear] = useState(null);
  const [make, setMake] = useState(null);
  const [model, setModel] = useState(null);

  const [grid, dispatchGrid] = useGrid();

  const [fetching, setFetching] = useState(false);

  const [isLoading, setIsLoading] = useState(true);

  const fetchItems = async (gridResult) => {
    if (gridResult) {
      return gridResult;
    }

    const params = {};
    if (year) params["year"] = year;
    if (make) params["make"] = make;
    if (model) params["model"] = model;

    const response = await AXIOS.get("/items/auto", { params });

    const result = transformSearchData(response.data.response);
    setCanSeePrice(result[0].price && true);
    dispatchGrid({
      type: "UPDATE",
      grid: { result },
    });

    return result;
  };

  const fetchDropdown = async (values) => {
    const { year, make, model, data } = values;

    if (data) return data;

    const params = {};
    if (year) params["year"] = year;
    if (make) params["make"] = make;
    if (model) params["model"] = model;

    const response = await AXIOS.get("/autos/distinct", { params });

    return response.data;
  };

  const initialData = useRequest((values) => fetchDropdown(values), {
    manual: true,
  });

  const years = useRequest((values) => fetchDropdown(values), {
    manual: true,
  });
  const makes = useRequest((values) => fetchDropdown(values), {
    manual: true,
  });
  const models = useRequest((values) => fetchDropdown(values), {
    manual: true,
  });

  const { data, loading, run } = useRequest(fetchItems, {
    manual: true,
  });

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!year && !make && !model) {
      toast.error("Please select at least one filter");
      return;
    }

    setFetched(true);
    run();
  };

  const yearChange = async (e) => {
    if (e.target.value === "") {
      setYear("");
      resetYear();
      return;
    }

    setYear(e.target.value);

    if (make && model) return;

    setFetching(true);

    const params = {
      year: e.target.value,
    };

    if (make) params["make"] = make;
    if (model) params["model"] = model;

    const response = await AXIOS.get("/autos/distinct", { params });
    const yearData = response.data;

    years.run({ data: { year: yearData.year } });
    makes.run({ data: { make: yearData.make } });
    models.run({ data: { model: yearData.model } });

    setTimeout(() => {
      setFetching(false);
      dispatchGrid({
        type: "UPDATE",
        grid: {
          year: e.target.value,
          yearData: yearData.year,
          makeData: yearData.make,
          modelData: yearData.model,
        },
      });
    }, 0);
  };

  const makeChange = async (e) => {
    if (e.target.value === "") {
      setMake("");
      resetMake();
      return;
    }

    setMake(e.target.value);

    setFetching(true);

    const params = {
      make: e.target.value,
    };

    if (year) params["year"] = year;
    if (model) params["model"] = model;

    const response = await AXIOS.get("/autos/distinct", { params });
    const makeData = response.data;

    years.run({ data: { year: makeData.year } });
    makes.run({ data: { make: makeData.make } });
    models.run({ data: { model: makeData.model } });

    setTimeout(() => {
      setFetching(false);
      dispatchGrid({
        type: "UPDATE",
        grid: {
          make: e.target.value,
          yearData: makeData.year,
          makeData: makeData.make,
          modelData: makeData.model,
        },
      });
    }, 0);
  };

  const modelChange = async (e) => {
    if (e.target.value === "") {
      setModel("");
      resetModel();
      return;
    }

    setModel(e.target.value);

    if (year && make) return;

    setFetching(true);

    const params = {
      model: e.target.value,
    };

    if (year) params["year"] = year;
    if (make) params["make"] = make;

    const response = await AXIOS.get("/autos/distinct", { params });
    const modelData = response.data;

    years.run({ data: { year: modelData.year } });
    makes.run({ data: { make: modelData.make } });
    models.run({ data: { model: modelData.model } });

    setTimeout(() => {
      setFetching(false);
      dispatchGrid({
        type: "UPDATE",
        grid: {
          model: e.target.value,
          yearData: modelData.year,
          makeData: modelData.make,
          modelData: modelData.model,
        },
      });
    }, 0);
  };

  const resetYear = async () => {
    setYear(null);

    if (make && model) return;

    setFetching(true);

    const params = {};

    if (make) params["make"] = make;
    if (model) params["model"] = model;

    const response = await AXIOS.get("/autos/distinct", { params });
    const modelData = response.data;

    if (modelData.model.length === 1) setModel(modelData.model[0]);
    if (modelData.make.length === 1) setMake(modelData.make[0]);
    if (modelData.year.length === 1) setYear(modelData.year[0]);

    models.run({ data: { model: modelData.model } });
    makes.run({ data: { make: modelData.make } });
    years.run({ data: { year: modelData.year } });

    setTimeout(() => {
      setFetching(false);
    }, 0);
  };

  const resetMake = async () => {
    setFetching(true);

    setMake(null);

    const params = {};

    if (year) params["year"] = year;
    if (model) params["model"] = model;

    const response = await AXIOS.get("/autos/distinct", { params });
    const modelData = response.data;

    models.run({ data: { model: modelData.model } });
    makes.run({ data: { make: modelData.make } });
    years.run({ data: { year: modelData.year } });

    setTimeout(() => {
      setFetching(false);
    }, 0);
  };

  const resetModel = async () => {
    setModel(null);

    if (year && make) return;

    setFetching(true);

    const params = {};

    if (year) params["year"] = year;
    if (make) params["make"] = make;

    const response = await AXIOS.get("/autos/distinct", { params });
    const modelData = response.data;

    models.run({ data: { model: modelData.model } });
    makes.run({ data: { make: modelData.make } });
    years.run({ data: { year: modelData.year } });

    setTimeout(() => {
      setFetching(false);
    }, 0);
  };

  useEffect(() => {
    if (!initialData.loading && initialData.data) {
      dispatchGrid({
        type: "UPDATE",
        grid: { initialData: initialData.data },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData.loading]);

  useEffect(() => {
    if (!loading && data) {
      dispatchGrid({ type: "UPDATE", grid: { result: data } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    if (grid.initialData) {
      initialData.run({ data: grid.initialData });

      if (grid.yearData) {
        setYear(grid.year);
        years.run({ data: { year: grid.yearData } });

        setMake(grid.make);
        makes.run({ data: { make: grid.makeData } });

        setModel(grid.model);
        models.run({ data: { model: grid.modelData } });
      }
      if (grid.result) {
        setFetched(true);
        run(grid.result);
      }

      setIsLoading(false);
    } else {
      initialData.run({});
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectClasses = "w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900";

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loading />
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit}>
        {!initialData.loading && initialData.data ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Year */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Year</label>
              {fetching ? (
                <div className="h-12 flex items-center justify-center">
                  <Loading inline />
                </div>
              ) : (
                <select
                  onChange={yearChange}
                  name="year"
                  value={year || ""}
                  className={selectClasses}
                >
                  <option value="">Select year</option>
                  {(years.data?.year || initialData.data.year).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Make */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Make</label>
              {fetching ? (
                <div className="h-12 flex items-center justify-center">
                  <Loading inline />
                </div>
              ) : (
                <select
                  onChange={makeChange}
                  name="make"
                  value={make || ""}
                  className={selectClasses}
                >
                  <option value="">Select make</option>
                  {(makes.data?.make || initialData.data.make).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Model */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Model</label>
              {fetching ? (
                <div className="h-12 flex items-center justify-center">
                  <Loading inline />
                </div>
              ) : (
                <select
                  onChange={modelChange}
                  name="model"
                  value={model || ""}
                  className={selectClasses}
                >
                  <option value="">Select model</option>
                  {(models.data?.model || initialData.data.model).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-8">
            <Loading />
          </div>
        )}

        {!initialData.loading && initialData.data && (
          <div className="flex gap-3 mt-6">
            <button
              type="submit"
              className="bg-indigo-500 hover:bg-indigo-600 text-white px-8 py-3 rounded-lg font-medium transition-colors"
            >
              Search
            </button>
            <button
              onClick={() => {
                setYear(null);
                setMake(null);
                setModel(null);
                years.run({ data: { year: initialData.data.year } });
                makes.run({ data: { make: initialData.data.make } });
                models.run({ data: { model: initialData.data.model } });
              }}
              type="button"
              className="bg-white hover:bg-gray-50 text-gray-700 px-8 py-3 rounded-lg font-medium border border-gray-300 transition-colors"
            >
              Reset
            </button>
          </div>
        )}
      </form>

      {/* Results Section */}
      {(fetched || grid.result) && (
        <div className="mt-8 border-t border-gray-200 pt-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loading />
            </div>
          ) : grid.result && grid.result.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Results</h3>
                <span className="text-sm text-gray-500">
                  {grid.result.length} item{grid.result.length !== 1 ? 's' : ''} found
                </span>
              </div>
              <AutoTable columns={columns} data={grid.result} />
            </>
          ) : (
            <p className="text-center text-gray-500 py-8">
              No results found. Try adjusting your filters.
            </p>
          )}
        </div>
      )}

      {!fetched && !grid.result && (
        <p className="text-center text-gray-400 mt-6 py-4">
          Select filters above and click Search to find parts
        </p>
      )}
    </>
  );
};

export default FormComponent;
