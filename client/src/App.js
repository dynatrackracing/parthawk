import { auth } from "./firebase/firebase-config";
import React, { useCallback, useEffect, useState } from "react";
import FadeIn from "react-fade-in";
import { Switch, useHistory, useLocation } from "react-router-dom";
import { cssTransition, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import AddItem from "./components/AddItem";
import EditItem from "./components/EditItem";
import Header from "./components/header/Header";
import Home from "./components/home/Home";
import ItemDetail from "./components/ItemDetail";
import PrivateRoute from "./components/routing/PrivateRoute";
import PublicRoute from "./components/routing/PublicRoute";
import SearchItem from "./components/SearchItem";
import Sidebar from "./components/Sidebar";

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
import Login from "./pages/Login";
import Payment from "./pages/Payment";
import "./styles/main.scss";
import AXIOS from "./utils/axios";
import Verification from "./pages/Verification";

const Zoom = cssTransition({
  enter: "zoomIn",
  exit: "zoomOut",
  collapse: false,
});

const App = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [initialPage, setInitialPage] = useState();
  const [isLoading, setIsLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    setInitialPage(location.pathname);
  }, []);

  const {
    state: { user: userData },
    setUser,
  } = useUserData();
  const history = useHistory();

  const fetchUserData = useCallback(async () => {
    setIsLoading(true);
    AXIOS.get(`/users/${auth.currentUser.email}`)
      .then((response) => {
        setUser(response.data);
        if (!response.data.isVerified) {
          history.push("/verification");
        } else {
          history.push(initialPage);
        }
      })
      .catch(() => {
        history.push("/login");
      })
      .finally(() => {
        setIsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Check for auth bypass in development/testing
    const authDisabled = window.localStorage.getItem('DISABLE_AUTH') === 'true';
    if (authDisabled) {
      setIsLoading(false);
      return;
    }

    auth.onAuthStateChanged(function (user) {
      if (!user) {
        history.push("/login");
        setIsLoading(false);
      } else {
        if (!userData) {
          fetchUserData();
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check if current path is a public route (login, verification)
  const isPublicRoute = location.pathname === '/login' || location.pathname === '/verification';

  if (isLoading) {
    return <></>;
  }

  return (
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

        {/* Public Routes - Full screen without app shell */}
        {isPublicRoute ? (
          <Switch>
            <PublicRoute
              restricted={true}
              component={Login}
              path="/login"
              exact
            />
            <PublicRoute component={Verification} path="/verification" exact />
          </Switch>
        ) : (
          /* Private Routes - With app shell (sidebar + header) */
          <div className="flex h-screen overflow-hidden">
            {/* Sidebar */}
            {(userData?.isVerified || window.localStorage.getItem('DISABLE_AUTH') === 'true') && (
              <FadeIn>
                <Sidebar
                  sidebarOpen={sidebarOpen}
                  setSidebarOpen={setSidebarOpen}
                />
              </FadeIn>
            )}
            <div className="s-base__background relative flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
              {/*  Site header */}
              <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

              <main>
                <div className="s-base__background w-full mx-auto">
                  <Switch>
                    <PrivateRoute exact path="/item/add" component={AddItem} />
                    <PrivateRoute
                      exact
                      path="/item/edit/:id"
                      component={EditItem}
                    />
                    <PrivateRoute
                      exact
                      path="/item/search"
                      component={SearchItem}
                    />
                    <PrivateRoute exact path="/item/:id" component={ItemDetail} />
                    <PrivateRoute exact path="/payment" component={Payment} />
                    <PrivateRoute exact path="/admin" component={AdminPanel} />

                    {/* Intelligence Routes */}
                    <PrivateRoute exact path="/intelligence" component={MarketDashboard} />
                    <PrivateRoute exact path="/intelligence/price-check" component={PriceCheck} />
                    <PrivateRoute exact path="/intelligence/stale-inventory" component={StaleInventory} />
                    <PrivateRoute exact path="/intelligence/your-listings" component={YourListings} />
                    <PrivateRoute exact path="/intelligence/your-sales" component={YourSales} />
                    <PrivateRoute exact path="/intelligence/price-analysis/:listingId" component={PriceAnalysis} />
                    <PrivateRoute exact path="/intelligence/pricing-insights" component={PricingInsights} />
                    <PrivateRoute exact path="/intelligence/competitors" component={CompetitorListings} />
                    <PrivateRoute exact path="/intelligence/sold-items" component={SoldItemsView} />
                    <PrivateRoute exact path="/intelligence/demand" component={DemandDashboard} />

                    <PrivateRoute exact path="/" component={Home} />
                  </Switch>
                </div>
              </main>
            </div>
          </div>
        )}
      </ItemProvider>
    </GridProvider>
  );
};

export default App;
