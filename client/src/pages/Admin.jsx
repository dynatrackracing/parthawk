import React, { useState, useEffect } from "react";
import { useHistory } from "react-router-dom";
import Toggle from "react-toggle";
import "react-toggle/style.css";
import { useUserData } from "../context/user";
import AXIOS from "../utils/axios";
import Banner from "../components/Banner";
import Loading from "../components/loading";

const AdminPanel = () => {
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const {
    state: { user },
  } = useUserData();
  const history = useHistory();

  useEffect(() => {
    if (!user.isAdmin) {
      history.push("/");
      return;
    }

    AXIOS.get(`/users/`)
      .then((response) => {
        setAllUsers(response.data);
        setLoading(false);
      })
      .catch((err) => {
        console.log("err:", err);
        setLoading(false);
      });
  }, [user, history]);

  const handleAdmin = (value, userEmail) => {
    AXIOS.put(`/users/${userEmail}`, { isAdmin: !value })
      .then(() => {
        setAllUsers(allUsers.map(u =>
          u.email === userEmail ? { ...u, isAdmin: !value } : u
        ));
      })
      .catch((err) => console.log("err:", err));
  };

  const handleVerified = (value, userEmail) => {
    AXIOS.put(`/users/${userEmail}`, { isVerified: !value })
      .then(() => {
        setAllUsers(allUsers.map(u =>
          u.email === userEmail ? { ...u, isVerified: !value } : u
        ));
      })
      .catch((err) => console.log("err:", err));
  };

  const handleSeePrice = (value, userEmail) => {
    AXIOS.put(`/users/${userEmail}`, { canSeePrice: !value })
      .then(() => {
        setAllUsers(allUsers.map(u =>
          u.email === userEmail ? { ...u, canSeePrice: !value } : u
        ));
      })
      .catch((err) => console.log("err:", err));
  };

  const filteredUsers = allUsers.filter(user => {
    const search = searchTerm.toLowerCase();
    return (
      user.firstName?.toLowerCase().includes(search) ||
      user.lastName?.toLowerCase().includes(search) ||
      user.email?.toLowerCase().includes(search)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loading />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-6xl mx-auto">
      <Banner
        title="Home > Admin Panel"
        subtitle="Manage users and their permissions"
      />

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {/* Search Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Users ({filteredUsers.length})
            </h2>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                <svg className="h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 4a6 6 0 100 12 6 6 0 000-12zm-8 6a8 8 0 1114.32 4.906l5.387 5.387a1 1 0 01-1.414 1.414l-5.387-5.387A8 8 0 012 10z" />
                </svg>
              </span>
              <input
                type="text"
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 w-full sm:w-64 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-900 placeholder-gray-400"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Admin
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Verified
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Can See Price
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredUsers.length > 0 ? (
                filteredUsers.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          {item.imageUrl ? (
                            <img
                              className="h-10 w-10 rounded-full object-cover"
                              src={item.imageUrl}
                              alt=""
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center">
                              <span className="text-indigo-600 font-medium">
                                {item.firstName?.charAt(0) || '?'}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {item.firstName} {item.lastName}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">{item.email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <Toggle
                        id={`admin-${item.id}`}
                        checked={item.isAdmin}
                        onChange={() => handleAdmin(item.isAdmin, item.email)}
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <Toggle
                        id={`verified-${item.id}`}
                        checked={item.isVerified}
                        onChange={() => handleVerified(item.isVerified, item.email)}
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <Toggle
                        id={`price-${item.id}`}
                        checked={item.canSeePrice || false}
                        onChange={() => handleSeePrice(item.canSeePrice, item.email)}
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                    {searchTerm ? 'No users found matching your search.' : 'No users found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
          <span className="text-sm text-gray-500">
            Showing {filteredUsers.length} of {allUsers.length} users
          </span>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
