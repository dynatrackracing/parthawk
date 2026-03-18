import React, { useState, useEffect } from "react";
import { useRequest } from "ahooks";
import { toast } from "react-toastify";
import AutoTable from "./AutoTable";
import Loading from "../loading";
import { useGrid } from "../../context";
import AXIOS from "../../utils/axios";

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

const FormComponent = ({ setSelectedRows, setSelectedItems }) => {
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

    const params = {
      ungroup: true,
    };
    if (year) params["year"] = year;
    if (make) params["make"] = make;
    if (model) params["model"] = model;

    const response = await AXIOS.get("/autos/distinct", { params });

    dispatchGrid({
      type: "UPDATE",
      grid: { result: response.data.response },
    });

    console.log("data:", response.data);

    return response.data;
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

  const handleSubmit = async () => {
    console.log("year:", year);
    console.log("make:", make);
    console.log("model:", model);

    if (!year && !make && !model) {
      toast.error("Filter is empty");
      console.log("filter is empty");
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
    if (grid.initialData) {
      initialData.run({ data: grid.initialData });
      setIsLoading(false);
    } else {
      console.log("grid empty");
      initialData.run({});
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return isLoading ? (
    <Loading />
  ) : (
    <div>
      <div className="auto-search-form">
        {!initialData.loading && initialData.data ? (
          <>
            <div className="auto-search-form__field">
              <p>Year</p>
              {fetching ? (
                <Loading inline />
              ) : (
                <>
                  {!years.loading && years.data && (
                    <select onChange={yearChange} name="year">
                      <option selected value="">
                        select year
                      </option>
                      {years.data.year.map((y) => (
                        <option selected={y === parseInt(year)} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  )}

                  {!years.loading && !years.data && (
                    <select onChange={yearChange} name="year">
                      <option selected value="">
                        select year
                      </option>
                      {initialData.data.year.map((y) => (
                        <option selected={y === parseInt(year)} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>

            <div className="auto-search-form__field">
              <p>Make</p>
              {fetching ? (
                <Loading inline />
              ) : (
                <>
                  {!makes.loading && makes.data && (
                    <select onChange={makeChange} name="make">
                      <option selected value="">
                        select make
                      </option>
                      {makes.data.make.map((m) => (
                        <option selected={m === make} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}

                  {!makes.loading && !makes.data && (
                    <select onChange={makeChange} name="make">
                      <option selected value="">
                        select make
                      </option>
                      {initialData.data.make.map((m) => (
                        <option selected={m === make} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>

            <div className="auto-search-form__field">
              <p>Model</p>
              {fetching ? (
                <Loading inline />
              ) : (
                <>
                  {!models.loading && models.data && (
                    <select onChange={modelChange} name="model">
                      <option selected value="">
                        select model
                      </option>
                      {models.data.model.map((m) => (
                        <option selected={m === model} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}

                  {!models.loading && !models.data && (
                    <select onChange={modelChange} name="model">
                      <option selected value="">
                        select model
                      </option>
                      {initialData.data.model.map((m) => (
                        <option selected={m === model} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <Loading />
        )}
      </div>

      {!initialData.loading && initialData.data && (
        <div className="form-buttons">
          <button type="button" onClick={handleSubmit} className="button">
            Submit
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
            className="button button--dark"
          >
            Reset
          </button>
        </div>
      )}

      <h3 className="mt-50 text-2xl md:text-3xl text-gray-800 font-bold mb-1">
        Results
      </h3>

      {fetched ? (
        <>
          {!loading && data ? (
            <>
              <h4 className="text-xl md:text-2xl text-gray-800 bold mb-1">
                Items: {data.length}
              </h4>
              <AutoTable
                columns={columns}
                data={data}
                setSelectedRows={setSelectedRows}
              />
              {setSelectedItems && (
                <div className="button-group button-group--right">
                  <button
                    onClick={setSelectedItems}
                    className="button"
                    type="button"
                  >
                    Add
                  </button>
                </div>
              )}
            </>
          ) : (
            <Loading />
          )}
          {!loading && !data && <p>No results found</p>}
        </>
      ) : (
        <p className="text-2xl md:text-3xl text-gray-800 font-bold mb-1">
          Submit form above
        </p>
      )}
    </div>
  );
};

export default FormComponent;
