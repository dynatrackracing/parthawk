import React from "react";

const defaultItem = null;

const reducer = (state, action) => {
  switch (action.type) {
    case "UPDATE":
      return action.item;
    default:
      return state;
  }
};

const ItemContext = React.createContext([defaultItem, () => {}]);

export const ItemProvider = ({ children }) => {
  const [state, dispatch] = React.useReducer(reducer, defaultItem);

  return (
    <ItemContext.Provider value={[state, dispatch]}>
      {children}
    </ItemContext.Provider>
  );
};

export const useItem = () => React.useContext(ItemContext);
