import axios from "axios";
import { auth } from "../firebase/firebase-config";

const AXIOS = axios.create({
  headers: {
    "Content-Type": "application/json",
  },
});

// Get the token and inject it to the header before every request
AXIOS.interceptors.request.use(async (config) => {
  // Skip auth token if DISABLE_AUTH is set (for testing)
  if (window.localStorage.getItem('DISABLE_AUTH') === 'true') {
    return config;
  }

  const token = await auth.currentUser.getIdToken();
  config.headers.Authorization = `Bearer ${token}`;

  return config;
});

AXIOS.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    console.log(error);
  }
);

export default AXIOS;
