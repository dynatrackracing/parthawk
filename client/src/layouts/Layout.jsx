import React from "react";

const Layout = ({ children, darker, full }) => {
  const className = `layout ${darker ? "layout__darker" : ""} ${
    full && "layout__full"
  }`;

  return <div className={className}>{children}</div>;
};

export default Layout;
