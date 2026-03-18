import React from "react";
import { Switch } from "react-router-dom";
import NotFound from "../notfound/NotFound";
import ItemDetail from "../ItemDetail";
import EditItem from "../EditItem";
import AddItem from "../AddItem";
import SearchItem from "../SearchItem";

// Intelligence Pages (Simplified)
import MarketDashboard from "../intelligence/MarketDashboard";
import PriceCheck from "../intelligence/PriceCheck";
import StaleInventory from "../intelligence/StaleInventory";
import YourListings from "../intelligence/YourListings";
import YourSales from "../intelligence/YourSales";

import Page from "./Page";

const Routes = () => {
  return (
    <section>
      <Switch>
        <Page exact path="/item/add" component={AddItem} title="Add Item" />
        <Page
          exact
          path="/item/search"
          component={SearchItem}
          title="Search Item"
        />
        <Page
          exact
          path="/item/edit/:id"
          component={EditItem}
          title="Edit Item"
        />
        <Page
          exact
          path="/item/:id"
          component={ItemDetail}
          title="Item Detail"
        />

        {/* Intelligence Routes - Simplified */}
        <Page
          exact
          path="/intelligence"
          component={MarketDashboard}
          title="Sales Intelligence"
        />
        <Page
          exact
          path="/intelligence/price-check"
          component={PriceCheck}
          title="Price Check"
        />
        <Page
          exact
          path="/intelligence/stale-inventory"
          component={StaleInventory}
          title="Stale Inventory"
        />
        <Page
          exact
          path="/intelligence/your-listings"
          component={YourListings}
          title="Your Listings"
        />
        <Page
          exact
          path="/intelligence/your-sales"
          component={YourSales}
          title="Your Sales"
        />

        <Page component={NotFound} />
      </Switch>
    </section>
  );
};

export default Routes;
