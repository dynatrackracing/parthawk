import React from "react";
import { Link } from "react-router-dom";
import { useUserData } from "../../context/user";

function Header({ sidebarOpen, setSidebarOpen }) {
  const {
    state: { user },
  } = useUserData();

  return (
    <header className="s-header bg-white sticky top-0 b border-b border-gray-200 z-30">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 -mb-px">
          {/* Header: Left side */}
          <div className="flex">
            {/* Hamburger button */}
            <button
              className="text-gray-500 hover:text-gray-600 lg:hidden"
              aria-controls="sidebar"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <span className="sr-only">Open sidebar</span>
              <svg
                className="w-6 h-6 fill-current"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect x="4" y="5" width="16" height="2" />
                <rect x="4" y="11" width="16" height="2" />
                <rect x="4" y="17" width="16" height="2" />
              </svg>
            </button>

            <Link to="/">
              <h3 className="s-header__title md:ml-0 ml-4">PartHawk</h3>
            </Link>
          </div>

          {/* Header: Right side */}
          <div className="md:flex items-center">
            {/* <SearchModal />
            <Notifications />
            <Help /> */}
            {/*  Divider */}
            {/* <hr className="w-px h-6 bg-gray-200 mx-3" /> */}
            {/* <UserMenu /> */}

            <div className="hidden md:flex items-center gap-3">
              {user?.isAdmin && (
                <>
                  <Link to={`/item/add`}>
                    <button type="button" className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                      Add Item
                    </button>
                  </Link>
                  <Link to={`/admin`}>
                    <button type="button" className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                      Admin Panel
                    </button>
                  </Link>
                </>
              )}

              <Link to={`/item/search`}>
                <button type="button" className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 transition-colors">
                  Search Item
                </button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
