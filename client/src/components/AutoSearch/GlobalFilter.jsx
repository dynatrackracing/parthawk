import React, { useState } from "react";

const GlobalFilter = ({ filter, setFilter }) => {
  const [value, setValue] = useState("");

  return (
    <div className="table-filter">
   
      <div className="table-filter__search">
        <input
          placeholder="Search here"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setFilter(value);
            }
          }}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setFilter(value)}
          className="button"
        >
          Search
        </button>
      </div>
    </div>
  );
};

export default GlobalFilter;
