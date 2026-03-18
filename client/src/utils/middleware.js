import { auth } from "../firebase/firebase-config";

// LOGIN STATUS
export const isAuthorized = () => {
  // Allow bypassing auth in development/test mode
  if (process.env.NODE_ENV === 'development' && process.env.REACT_APP_DISABLE_AUTH === 'true') {
    return true;
  }
  if (typeof window !== 'undefined' && window.localStorage.getItem('DISABLE_AUTH') === 'true') {
    return true;
  }
  return auth.currentUser;
};
