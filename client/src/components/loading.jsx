import React from "react";
import LoadingIcon from "../assets/loading.svg";

const Loading = ({ text, inline, backgroundColor }) => {
  return (
    <span className={`loading ${inline && "loading__inline"}  ${backgroundColor && `bg-gray-300`}`}>
      <img alt="loading" src={LoadingIcon} />
      {text && <span>{text}</span>}
    </span>
  );
};

export default Loading;
