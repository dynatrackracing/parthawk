import React from "react";
import { Route, Redirect } from "react-router-dom";
import { isAuthorized } from "../../utils/middleware";

const PrivateRoute = ({ component: Component, ...rest }) => {
  // Show the component only when the user is logged in
  // Otherwise, redirect the user to /signin page

  return (
    <Route
      exact
      path
      {...rest}
      render={(props) => {
        return isAuthorized() ? (
          <Component {...props} />
        ) : (
          <Redirect to="/login" />
        );
      }}
    />
  );
};
export default PrivateRoute;
