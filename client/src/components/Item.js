import React from "react";
import { Link } from "react-router-dom";

const ItemComponent = ({ item }) => {
  console.log("item:", item);

  return (
    <div className="item">
      <Link to={`/item/${item.id}`}>
        <p>{item.title}</p>
        <div className="item__picture">
          <img src={item.pictureUrl} />
          <div>
            <p>Price: ${item.price}</p>
            {item.manufacturerPartNumber && (
              <p>Manufacturer Part Number: {item.manufacturerPartNumber}</p>
            )}
            <p>Category: {item.categoryTitle}</p>
          </div>
        </div>
      </Link>
    </div>
  );
};

export default ItemComponent;
