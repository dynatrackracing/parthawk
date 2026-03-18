import React from "react";

const defaultGrid = {
  year: null,
  make: null,
  model: null,
  yearData: null,
  makeData: null,
  modelData: null,
  result: null,
  searchItemResult: null,
  searchItemTitle: null,
  searchItemSeller: null,
  searchItemcategory: null,
  searchItemManufacturerPartNum: null,
  initialData: null,
};

const reducer = (state, action) => {
  switch (action.type) {
    case "UPDATE":
      return { ...state, ...action.grid };
    case "RESET":
      return defaultGrid;
    default:
      return state;
  }
};

const GridContext = React.createContext([defaultGrid, () => {}]);

export const GridProvider = ({ children }) => {
  const [state, dispatch] = React.useReducer(reducer, defaultGrid);

  return (
    <GridContext.Provider value={[state, dispatch]}>
      {children}
    </GridContext.Provider>
  );
};

export const useGrid = () => React.useContext(GridContext);
