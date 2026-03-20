import axios from "axios";

const AXIOS = axios.create({
  headers: {
    "Content-Type": "application/json",
  },
});

// No auth token injection — internal tool, all requests pass through
AXIOS.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API error:', error?.message || error);
    return Promise.reject(error);
  }
);

export default AXIOS;
