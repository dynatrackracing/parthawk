import React from "react";
import { useState } from "react";

const defaultState = {
  user: null,
};

const UserDataContext = React.createContext([defaultState, () => {}]);

export const UserDataProvider = ({ children }) => {
  const [state, setState] = useState(defaultState);

  const setUser = (userData) => {
    setState({ user: userData });
  };

  const resetUser = () => {
    setState(defaultState);
  };

  return (
    <UserDataContext.Provider value={{ state, setUser, resetUser }}>
      {children}
    </UserDataContext.Provider>
  );
};

export const useUserData = () => React.useContext(UserDataContext);
