import {
  signInWithPopup,
  setPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import FadeIn from "react-fade-in";
import { useHistory } from "react-router-dom";
import { toast } from "react-toastify";
import Logo from "../assets/images/logo.png";
import { useUserData } from "../context";
import { auth, provider } from "../firebase/firebase-config";
import AXIOS from "../utils/axios";

const Login = () => {
  const history = useHistory();
  const { setUser } = useUserData();

  const loginWithGoogle = () => {
    setPersistence(auth, browserSessionPersistence)
      .then(() => {
        return signInWithPopup(auth, provider)
          .then((result) => {
            login(result.user);
          })
          .catch((error) => {
            console.log(error.message);
            toast.error("Google sign-in failed");
          });
      })
      .catch((error) => {
        console.log(error.message);
        toast.error("Authentication error");
      });
  };

  const login = (user) => {
    const payload = {
      firstName: user.displayName?.split(" ")[0] || "",
      lastName: user.displayName?.split(" ")[1] || "",
      email: user.email,
      imageUrl: user.photoURL,
    };

    AXIOS.post("/users/login", payload)
      .then((response) => {
        setUser(response.data);
        if (response.data.isVerified) {
          toast.success("Login Successful");
          history.push("/");
        } else {
          toast.success("Account created but under verification");
          history.push("/verification");
        }
      })
      .catch((err) => {
        toast.error("Login Failed");
        console.log("err: ", err);
      });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-800 flex items-center justify-center p-4">
      {/* Background Pattern */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-white/10 rounded-full blur-3xl" />
      </div>

      <FadeIn delay={100}>
        <div className="relative w-full max-w-md">
          {/* Login Card */}
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            {/* Logo */}
            <div className="text-center mb-8">
              <img src={Logo} alt="PartHawk" className="h-16 w-auto mx-auto" />
            </div>

            {/* Welcome Text */}
            <div className="text-center mb-6">
              <h2 className="text-lg font-medium text-gray-900">
                Welcome back
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Sign in to continue to your account
              </p>
            </div>

            {/* Google Sign In Button */}
            <button
              type="button"
              onClick={loginWithGoogle}
              className="w-full flex items-center justify-center gap-3 px-6 py-3.5 border-2 border-gray-200 rounded-xl bg-white text-gray-700 font-medium hover:bg-gray-50 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all"
            >
              <svg width="20" height="20" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <g fill="none" fillRule="evenodd">
                  <path
                    d="M9 3.48c1.69 0 2.83.73 3.48 1.34l2.54-2.48C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z"
                    fill="#EA4335"
                  />
                  <path
                    d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z"
                    fill="#4285F4"
                  />
                  <path
                    d="M3.88 10.78A5.54 5.54 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A9.008 9.008 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.45 15.98 5.48 18 9 18z"
                    fill="#34A853"
                  />
                </g>
              </svg>
              Sign in with Google
            </button>

            {/* Footer */}
            <p className="mt-6 text-center text-xs text-gray-400">
              Secure authentication powered by Google
            </p>
          </div>

          {/* Bottom text */}
          <p className="mt-6 text-center text-sm text-white/60">
            © 2024 PartHawk. All rights reserved.
          </p>
        </div>
      </FadeIn>
    </div>
  );
};

export default Login;
