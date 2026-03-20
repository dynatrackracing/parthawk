
import React, { useEffect, useState } from "react";
import FadeIn from "react-fade-in";
import { Route, Switch, useLocation } from "react-router-dom";
import { cssTransition, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import AddItem from "./components/AddItem";
import EditItem from "./components/EditItem";
import Header from "./components/header/Header";
import Home from "./components/home/Home";
import ItemDetail from "./components/ItemDetail";
import SearchItem from "./components/SearchItem";
import Sidebar from "./components/Sidebar";
import SplashScreen from "./components/SplashScreen";

// Intelligence Pages
import MarketDashboard from "./components/intelligence/MarketDashboard";
import YourListings from "./components/intelligence/YourListings";
import PriceCheck from "./components/intelligence/PriceCheck";
import StaleInventory from "./components/intelligence/StaleInventory";
import YourSales from "./components/intelligence/YourSales";
import PriceAnalysis from "./components/intelligence/PriceAnalysis";
import PricingInsights from "./components/intelligence/PricingInsights";
import CompetitorListings from "./components/intelligence/CompetitorListings";
import SoldItemsView from "./components/intelligence/SoldItemsView";
import DemandDashboard from "./components/intelligence/DemandDashboard";
import { GridProvider, ItemProvider, useUserData } from "./context";
import AdminPanel from "./pages/Admin";
import "./styles/main.scss";

const Zoom = cssTransition({
  enter: "zoomIn",
  exit: "zoomOut",
  collapse: false,
});

const App = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [initialPage, setInitialPage] = useState();
  const [isLoading, setIsLoading] = useState(true);
  const [splashDone, setSplashDone] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setInitialPage(location.pathname);
  }, []);

  const {
    state: { user: userData },
    setUser,
  } = useUserData();
  // No auth — internal tool, auto-set admin user
  useEffect(() => {
    setUser({ isAdmin: true, isVerified: true, canSeePrice: true, email: 'admin@darkhawk.local' });
    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) {
    return <></>;
  }

  return (
    <>
    {!splashDone && <SplashScreen onComplete={() => setSplashDone(true)} />}
    <GridProvider>
      <ItemProvider>
        <ToastContainer
          position="top-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop={true}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss={false}
          draggable={false}
          pauseOnHover={true}
          transition={Zoom}
          limit={3}
        />

        {/* App shell — no auth required */}
          <div className="flex h-screen overflow-hidden">
            <FadeIn>
              <Sidebar
                sidebarOpen={sidebarOpen}
                setSidebarOpen={setSidebarOpen}
              />
            </FadeIn>
            <div className="s-base__background relative flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
              {/*  Site header */}
              <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

              <main>
                <div className="s-base__background w-full mx-auto">
                  <Switch>
                    <Route exact path="/item/add" component={AddItem} />
                    <Route
                      exact
                      path="/item/edit/:id"
                      component={EditItem}
                    />
                    <Route
                      exact
                      path="/item/search"
                      component={SearchItem}
                    />
                    <Route exact path="/item/:id" component={ItemDetail} />
                    <Route exact path="/payment" component={Payment} />
                    <Route exact path="/admin" component={AdminPanel} />

                    {/* Intelligence Routes */}
                    <Route exact path="/intelligence" component={MarketDashboard} />
                    <Route exact path="/intelligence/price-check" component={PriceCheck} />
                    <Route exact path="/intelligence/stale-inventory" component={StaleInventory} />
                    <Route exact path="/intelligence/your-listings" component={YourListings} />
                    <Route exact path="/intelligence/your-sales" component={YourSales} />
                    <Route exact path="/intelligence/price-analysis/:listingId" component={PriceAnalysis} />
                    <Route exact path="/intelligence/pricing-insights" component={PricingInsights} />
                    <Route exact path="/intelligence/competitors" component={CompetitorListings} />
                    <Route exact path="/intelligence/sold-items" component={SoldItemsView} />
                    <Route exact path="/intelligence/demand" component={DemandDashboard} />

                    <Route exact path="/" component={Home} />
                  </Switch>
                </div>
              </main>
            </div>
          </div>
      </ItemProvider>
    </GridProvider>
    </>
  );
};

export default App;
