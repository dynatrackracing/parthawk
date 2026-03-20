// import { signOut } from "firebase/auth"; // Auth removed
import React, { useEffect, useRef } from "react";
import { NavLink, useHistory, useLocation } from "react-router-dom";
import Logo from "../assets/images/logo.png";
// import { auth } from "../firebase/firebase-config"; // Auth removed
import { toast } from "react-toastify";
import { useUserData } from "../context/user";

// Icon components for cleaner code
const HomeIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
);

const AddIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
  </svg>
);

const SearchIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const ChartIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const DollarIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ClockIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const SettingsIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const LogoutIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
  </svg>
);

const SalesIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
  </svg>
);

const TargetIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

// NavItem component for consistent styling
const NavItem = ({ to, icon: Icon, label, isActive }) => (
  <NavLink
    exact
    to={to}
    className={`flex items-center gap-2.5 px-3 py-2 rounded-md transition-all duration-150 ${
      isActive
        ? "bg-red-500/10 text-red-400"
        : "text-gray-500 hover:text-gray-200 hover:bg-white/5"
    }`}
  >
    <Icon />
    <span className="text-xs font-semibold tracking-wide">{label}</span>
  </NavLink>
);

function Sidebar({ sidebarOpen, setSidebarOpen }) {
  const location = useLocation();
  const history = useHistory();
  const page = location?.pathname;

  const trigger = useRef(null);
  const sidebar = useRef(null);
  const {
    state: { user },
    resetUser,
  } = useUserData();

  // Close on click outside
  useEffect(() => {
    const clickHandler = ({ target }) => {
      if (!sidebar.current || !trigger.current) return;
      if (!sidebarOpen || sidebar.current.contains(target) || trigger.current.contains(target)) return;
      setSidebarOpen(false);
    };
    document.addEventListener("click", clickHandler);
    return () => document.removeEventListener("click", clickHandler);
  });

  // Close on Esc key
  useEffect(() => {
    const keyHandler = ({ keyCode }) => {
      if (!sidebarOpen || keyCode !== 27) return;
      setSidebarOpen(false);
    };
    document.addEventListener("keydown", keyHandler);
    return () => document.removeEventListener("keydown", keyHandler);
  });

  // Close on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const logout = () => {
    // Auth removed — no logout needed for internal tool
    toast.success("Session cleared");
    setSidebarOpen(false);
  };

  return (
    <div className="lg:w-52">
      {/* Sidebar backdrop (mobile only) */}
      <div
        className={`fixed inset-0 bg-gray-900/50 z-40 lg:hidden transition-opacity duration-200 ${
          sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <div
        id="sidebar"
        ref={sidebar}
        className={`fixed z-50 left-0 top-0 lg:static lg:left-auto lg:top-auto lg:translate-x-0 transform h-screen overflow-y-auto no-scrollbar w-52 lg:w-52 flex-shrink-0 transition-transform duration-200 ease-in-out flex flex-col ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between h-12 px-3 border-b border-slate-800">
          {/* Logo */}
          <NavLink exact to="/" className="flex items-center gap-2">
            <img src={Logo} alt="DarkHawk" className="h-8 w-auto" />
          </NavLink>

          {/* Close button (mobile) */}
          <button
            ref={trigger}
            className="lg:hidden text-gray-400 hover:text-white"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <div className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
          {/* Navigation */}
          <div>
            <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Tools
            </h3>
            <nav className="space-y-1">
              <NavItem to="/" icon={HomeIcon} label="Home" isActive={page === "/"} />
              <a href="/admin/pull" className="flex items-center gap-2.5 px-3 py-2 rounded-md transition-all duration-150 text-gray-500 hover:text-gray-200 hover:bg-white/5">
                <TargetIcon />
                <span className="text-xs font-semibold tracking-wide">Attack List</span>
              </a>
              <a href="/admin/restock" className="flex items-center gap-2.5 px-3 py-2 rounded-md transition-all duration-150 text-gray-500 hover:text-gray-200 hover:bg-white/5">
                <ChartIcon />
                <span className="text-xs font-semibold tracking-wide">Restock Report</span>
              </a>
              <a href="/admin/gate" className="flex items-center gap-2.5 px-3 py-2 rounded-md transition-all duration-150 text-gray-500 hover:text-gray-200 hover:bg-white/5">
                <DollarIcon />
                <span className="text-xs font-semibold tracking-wide">Gate Calculator</span>
              </a>
              <a href="/admin/vin" className="flex items-center gap-2.5 px-3 py-2 rounded-md transition-all duration-150 text-gray-500 hover:text-gray-200 hover:bg-white/5">
                <SearchIcon />
                <span className="text-xs font-semibold tracking-wide">VIN Scanner</span>
              </a>
            </nav>
          </div>

          {/* Admin Section */}
          {user?.isAdmin && (
            <div>
              <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Admin
              </h3>
              <nav className="space-y-1">
                <NavItem to="/admin" icon={SettingsIcon} label="Admin Panel" isActive={page === "/admin"} />
              </nav>
            </div>
          )}
        </div>

        {/* Logout Button */}
        <div className="p-4 border-t border-slate-800">
          <button
            onClick={logout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-all duration-150"
          >
            <LogoutIcon />
            <span className="text-sm font-medium">Logout</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default Sidebar;
