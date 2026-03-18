import React from "react";
import { Route, Redirect } from "react-router-dom";
import { isAuthorized } from "../../utils/middleware";

const PublicRoute = ({ component: Component, restricted, ...rest }) => (
  // restricted = false meaning public route
  // restricted = true meaning restricted route
  <Route
    {...rest}
    render={(props) => {
      if (restricted && isAuthorized()) {
        return <Redirect to="/" />;
      } else return <Component {...props} />;
    }}
  />
);

export default PublicRoute;
