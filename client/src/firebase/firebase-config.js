import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyB88Oh81NKiJQO6_xxDaCKKj8QDeayrZLM",
  authDomain: "parthawk.firebaseapp.com",
  projectId: "parthawk",
  storageBucket: "parthawk.appspot.com",
  messagingSenderId: "507031527490",
  appId: "1:507031527490:web:7a8851d2d61de86b1ecddb",
  measurementId: "G-YFZXZ7KQ66"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
