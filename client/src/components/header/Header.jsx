import React from "react";
import { Link } from "react-router-dom";
import { useUserData } from "../../context/user";

function Header({ sidebarOpen, setSidebarOpen }) {
  const {
    state: { user },
  } = useUserData();

  return (
    <header className="sticky top-0 z-30 border-b" style={{ background: '#141414', borderColor: '#2a2a2a' }}>
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-12 -mb-px">
          <div className="flex items-center">
            <button
              className="text-gray-400 hover:text-white lg:hidden mr-3"
              aria-controls="sidebar"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <span className="sr-only">Open sidebar</span>
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <rect x="4" y="5" width="16" height="2" />
                <rect x="4" y="11" width="16" height="2" />
                <rect x="4" y="17" width="16" height="2" />
              </svg>
            </button>
            <Link to="/" className="flex items-center gap-2">
              <span style={{ color: '#ef4444', fontSize: '16px', fontWeight: 800, letterSpacing: '-0.03em' }}>DarkHawk</span>
            </Link>
          </div>

          <div className="hidden md:flex items-center gap-2">
            {user?.isAdmin && (
              <>
                <Link to="/item/add">
                  <button type="button" className="px-3 py-1.5 rounded text-xs font-semibold transition-colors" style={{ background: '#1c1c1c', border: '1px solid #2a2a2a', color: '#d1d5db' }}>
                    + Add
                  </button>
                </Link>
                <Link to="/admin">
                  <button type="button" className="px-3 py-1.5 rounded text-xs font-semibold transition-colors" style={{ background: '#1c1c1c', border: '1px solid #2a2a2a', color: '#d1d5db' }}>
                    Admin
                  </button>
                </Link>
              </>
            )}
            <Link to="/item/search">
              <button type="button" className="px-3 py-1.5 rounded text-xs font-semibold transition-colors" style={{ background: '#1c1c1c', border: '1px solid #2a2a2a', color: '#d1d5db' }}>
                Search
              </button>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
