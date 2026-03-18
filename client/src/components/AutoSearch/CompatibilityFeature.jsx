import React, { useState, useEffect } from "react";
import Select from "react-select";
import Loading from "../loading";
import AutoTable from "./AutoTable";
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

const CompatibilityFeature = ({
  setSelectedRows,
  setSelectedItems,
  setSelectedIds,
}) => {
  const [displayModel, setDisplayModel] = useState(true);
  const [displayYear, setDisplayYear] = useState(true);
  const [model, setModel] = useState([]);
  const [Model, setModel2] = useState([]);
  const [year, setYear] = useState([]);
  const [menuIsOpen, setMenuIsOpen] = useState();
  const [Year, setYear2] = useState([]);
  const [selectedModel, setSelectedModel] = useState([]);
  const [selectedYear, setSelectedYear] = useState([]);
  const [Make, setMake2] = useState([]);
  const [selectedMake, setSelectedMake] = useState([]);
  const [Trim, setTrim2] = useState([]);
  const [trim, setTrim] = useState([]);
  const [loading, setLoading] = useState({
    make: false,
    model: false,
    year: false,
  });
  const [render, setRender] = useState([]);
  const [renderYear, setRenderYear] = useState([]);
  const [renderOption, setRenderOption] = useState([]);

  /*Function to to get the car Make and set a variable named Make2  */
  const getMake = async () => {
    setLoading((prevState) => ({ ...prevState, make: true }));

    const response = await AXIOS.get("/autos/lookup?select=Make");
    if (response.data) {
      response.data.map((item) =>
        setMake2((prevArray) => [
          ...prevArray,
          { value: item.value, label: item.value },
        ])
      );
      setLoading((prevState) => ({ ...prevState, make: false }));
    }
  };

  /*1. Function to to get the Model Make
       2. Then group them by make before pushing to the variable named Model2
    */
  const getModel = async (make) => {
    let newArr = [];
    let result;
    setLoading((prevState) => ({ ...prevState, model: true }));
    const response = await AXIOS.get(`/autos/lookup?make=${make}&select=Model`);
    if (response.data) {
      response.data.map((item) =>
        newArr.push({ value: item.value, label: item.value, make: make })
      );
      if (newArr) {
        result = newArr.reduce(function (r, a) {
          r[a.make] = r[a.make] || [];
          r[a.make].push(a);
          return r;
        }, Object.create(null));
      }
      setModel2((prevState) => [
        ...prevState,
        { options: result[make], label: make },
      ]);
      setLoading((prevState) => ({ ...prevState, model: false }));
    }
  };

  /*1. Function to to get the Year
       2. Then group them by make before pushing to the variable named Year2
    */
  const getYear = async (make, model) => {
    let newArr = [];
    let result;
    setLoading((prevState) => ({ ...prevState, year: true }));
    const response = await AXIOS.get(
      `/autos/lookup?make=${make}&model=${model}&select=Year`
    );
    if (response.data) {
      response.data.map((item) =>
        newArr.push({
          value: item.value,
          label: item.value,
          make: make,
          model: model,
        })
      );
      if (newArr) {
        result = newArr.reduce(function (r, a) {
          r[a.make] = r[a.make] || [];
          r[a.make].push(a);
          return r;
        }, Object.create(null));
      }
      setYear2((prevState) => [
        ...prevState,
        {
          label: model,
          options: result[make],
        },
      ]);
      setLoading((prevState) => ({ ...prevState, year: false }));
    }
  };

  /*1. Function to to get the Trim
       2. Then group them by model before pushing to the variable named Trim2
    */
  const getTrim = async (make, model, year) => {
    // let result
    let newArr = [];
    setLoading((prevState) => ({ ...prevState, trim: true }));
    const response = await AXIOS.get(
      `/autos/lookup?make=${make}&model=${model}&year=${year}&select=Trim`
    );

    if (response.data) {
      response.data.map((item) =>
        newArr.push({ trim: item.value, make: make, model: model, year: year })
      );

      newArr.map((item) => setTrim2((prevArr) => [...prevArr, item]));

      setLoading((prevState) => ({ ...prevState, trim: false }));
    }
  };

  /*1. The reason we have Model and model is because we needed an assurance in order not to //#endregion
  make multiple calls for the same models and remove duplicates in the array
    */
  useEffect(() => {
    if (Model && Model.length > 0) {
      const uniqueArr = Model.filter(
        (v, i, a) => a.findIndex((t) => t.label === v.label) === i
      );

      setDisplayModel(false);
      setModel(uniqueArr);
    } else if (
      Model &&
      Model.length === 0 &&
      selectedMake &&
      selectedMake.length === 0
    ) {
      setModel([]);
      setDisplayModel(true);
    }
  }, [Model]);

  /*1. The reason we have Year and actual year is because we needed an assurance in order not to //#endregion
  make multiple calls for the same models and remove duplicates in the array
    */
  useEffect(() => {
    if (Year && Year.length > 0) {
      const uniqueArr = Year.filter(
        (v, i, a) => a.findIndex((t) => t.label === v.label) === i
      );

      setDisplayYear(false);
      setYear(uniqueArr);
    } else {
      setYear([]);
      setDisplayYear(true);
    }
  }, [Year]);

  /*1. Same logic as above
   */
  useEffect(() => {
    if (Trim && Trim.length > 0) {
      const uniqueArr = Trim.filter(
        (v, i, a) =>
          a.findIndex((t) => t.year === v.year && t.trim === v.trim) === i
      );

      setTrim(uniqueArr);
    }
  }, [Trim]);

  /* We initially get the Make when the page loads
   */
  useEffect(() => {
    getMake();
  }, []);

  /* Each time the Make select runs, the lifeycycle method above runs in order to get the appropirate model for each Make
   */
  useEffect(() => {
    let emptyMakeArray = [];
    if (selectedMake && selectedMake.length > 0) {
      selectedMake.forEach(function (arrayElem) {
        getModel(arrayElem.value);
      });

      // selectedMake.forEach(function (arrayElem) {
      //   if (emptyMakeArray && emptyMakeArray.length > 0) {
      //     emptyMakeArray.forEach(function (item) {
      //       if (item.value === arrayElem.value) {
      //       } else {
      //         getModel(arrayElem.value)
      //       }
      //     }
      //     )
      //   } else {
      //     emptyMakeArray.push({ value: arrayElem.value, label: arrayElem.value })
      //     getModel(arrayElem.value)
      //   }
      // });
      setDisplayModel(false);
    } else {
      setTrim2([]);
    }
  }, [render]);

  /* Logic that handles removal of previously selected make or model gets deleted
   */
  // useEffect(() => {

  //   if (selectedModel && selectedModel.length > 0) {
  //     const modelFilteredArray = selectedModel.filter((el) => {
  //       return selectedMake.some((f) => {
  //         return f.value === el.make
  //       });
  //     });

  //     setSelectedModel(modelFilteredArray)

  //     const filteredDropDownModel = model.filter((el) => {
  //       return modelFilteredArray.some((f) => {
  //         return f.make === el.label
  //       });
  //     });
  //     setModel2(filteredDropDownModel)
  //   } else {
  //     setModel2([])
  //   }

  //   if (selectedYear && selectedYear.length > 0) {
  //     const modelFilteredArray = selectedYear.filter((el) => {
  //       return selectedMake.some((f) => {
  //         return f.value === el.make
  //       });
  //     });

  //     setSelectedYear(modelFilteredArray)

  //     const filteredDropDownModel = year.filter((el) => {
  //       return modelFilteredArray.some((f) => {
  //         return f.make === el.make
  //       });
  //     });
  //     setYear2(filteredDropDownModel)
  //   } else {
  //     setYear2([])

  //   }

  //   if (trim && trim.length > 0) {
  //     const modelFilteredArray = trim.filter((el) => {
  //       return selectedMake.some((f) => {
  //         return f.value === el.make
  //       });
  //     });
  //     setTrim(modelFilteredArray)
  //     setTrim2(modelFilteredArray)
  //   }

  // }, [selectedMake, /*renderOption,*/ renderYear])

  // Lifecycle method to update the YEAR dropdown values whenever a model gets deleted
  // useEffect(() => {
  //   if (selectedYear && selectedYear.length > 0) {
  //     const modelFilteredArray = selectedYear.filter((el) => {
  //       return selectedModel.some((f) => {
  //         return f.value === el.model
  //       });
  //     });
  //     setSelectedYear(modelFilteredArray)
  //     const filteredDropDownModel = year.filter((el) => {
  //       return modelFilteredArray.some((f) => {
  //         return f.model === el.label
  //       });
  //     });
  //     setYear2(filteredDropDownModel)
  //   }
  // }, [selectedModel, renderYear])

  //Model State
  useEffect(() => {
    let emptyMakeArray = [];
    if (selectedModel && selectedModel.length > 0) {
      selectedModel.forEach(function (arrayElem) {
        if (emptyMakeArray && emptyMakeArray.length > 0) {
          emptyMakeArray.forEach(function (item) {
            if (item.value === arrayElem.value) {
            } else {
              getYear(arrayElem.make, arrayElem.value);
            }
          });
        } else {
          emptyMakeArray.push({
            value: arrayElem.value,
            make: arrayElem.make,
            modelFetched: true,
          });
          getYear(arrayElem.make, arrayElem.value);
        }
      });
      setDisplayYear(false);
    }
  }, [renderOption]);

  //Year State
  useEffect(() => {
    let emptyMakeArray = [];

    if (selectedYear && selectedYear.length > 0) {
      setLoading((prevState) => ({ ...prevState, trim: true }));
      setTrim2([]);
      selectedYear.forEach(function (arrayElem) {
        if (emptyMakeArray && emptyMakeArray.length > 0) {
          emptyMakeArray.forEach(function (item) {
            if (item.value === arrayElem.value) {
            } else {
              getTrim(arrayElem.make, arrayElem.model, arrayElem.value);
            }
          });
        } else {
          emptyMakeArray.push({
            value: arrayElem.value,
            make: arrayElem.make,
            model: arrayElem.model,
            modelFetched: true,
          });
          getTrim(arrayElem.make, arrayElem.model, arrayElem.value);
        }
      });
      setDisplayYear(false);
    }
  }, [renderYear]);

  const customStyles = {
    option: (provided) => ({
      ...provided,
      color: "black",
    }),
    control: (provided) => ({
      ...provided,
      color: "black",
    }),
    singleValue: (provided) => ({
      ...provided,
      color: "black",
    }),
  };
  // Function triggering what Make has been selected and pushing that item to the arrays of Make
  const onMakeChange = (option) => {
    let allSelectedMake = [];
    if (option) {
      option.map((item) =>
        allSelectedMake.push({ value: item.value, label: item.value })
      );
    }

    const uniqueArr = [
      ...new Map(allSelectedMake.map((item) => [item["value"], item])).values(),
    ];

    setSelectedMake(uniqueArr);

    setRender(option);
  };

  // Function triggering what Model has been selected and pushing that item to the arrays of Model
  const onModelChange = (option) => {
    let allSelectedModel = [];

    if (option) {
      option.map((item) => allSelectedModel.push(item));
    }
    const uniqueArr = [
      ...new Map(
        allSelectedModel.map((item) => [item["value"], item])
      ).values(),
    ];
    setSelectedModel(uniqueArr);
    setTrim2([]);
    setTrim([]);
    setYear([]);
    setYear2([]);
    setSelectedYear([]);
    console.log("option -> ", option);
    setRenderOption(option);
  };

  const onYearChange = (option) => {
    let allSelectedYear = [];

    if (option) {
      option.map((item) => allSelectedYear.push(item));
    }
    const uniqueArr = [
      ...new Map(allSelectedYear.map((item) => [item["value"], item])).values(),
    ];

    setSelectedYear(uniqueArr);
    setRenderYear(option);
  };

  return (
    <div
      className={`mb-0 ${
        trim && trim.length > 0
          ? `md:mb-10 edit-item-section__compatibility`
          : `md:mb-40 edit-item-section__compatibility`
      }`}
    >
      <h3 className="font-semibold text-lg text-gray-600 mb-3 mt-3">
        Start by selecting one or more makes, models and years
      </h3>
      <div className="auto-search-form">
        <div className="auto-search-form__field">
          <p>Make</p>

          <Select
            styles={customStyles}
            isMulti
            onChange={onMakeChange}
            value={selectedMake}
            isLoading={loading.make}
            placeholder="Select all that apply"
            name="colors"
            options={Make}
            className="basic-multi-select"
            classNamePrefix="select"
          />
        </div>

        <div className="auto-search-form__field">
          <p>Model</p>

          <Select
            styles={customStyles}
            isMulti
            name="colors"
            onChange={onModelChange}
            placeholder="Select all that apply"
            isDisabled={displayModel}
            value={selectedModel}
            isLoading={loading.model}
            options={model}
            className="basic-multi-select"
            classNamePrefix="select"
          />
        </div>

        <div className="auto-search-form__field">
          <p>Year</p>

          <Select
            styles={customStyles}
            placeholder="Select all that apply"
            isMulti
            onChange={onYearChange}
            value={selectedYear}
            name="colors"
            isDisabled={displayYear}
            isLoading={loading.year}
            options={year}
            className="basic-multi-select"
            //  onBlur={delayedCloseMenu}
            classNamePrefix="select"
            menuIsOpen={menuIsOpen}
            onFocus={() => setMenuIsOpen(!menuIsOpen)}
            onBlur={() => setMenuIsOpen(false)}
          />
        </div>
      </div>

      {trim && trim.length > 0 && (
        <>
          {!loading.trim ? (
            <>
              <h3 className="mt-50 text-2xl md:text-3xl text-gray-800 font-bold mb-1">
                Results
              </h3>

              <h4 className="text-xl md:text-2xl text-gray-800 bold mb-1">
                Items: {trim.length}
              </h4>
              <AutoTable
                columns={columns}
                data={trim}
                setSelectedRows={setSelectedRows}
              />
              {setSelectedItems && (
                <div className="button-group button-group--right">
                  <button
                    onClick={setSelectedItems}
                    className="button button--dark"
                    type="button"
                  >
                    Add
                  </button>
                </div>
              )}
            </>
          ) : (
            <Loading backgroundColor={true} />
          )}

          {!loading.trim && !trim && <p>No results found</p>}
        </>
      )}
    </div>
  );
};

export default CompatibilityFeature;
