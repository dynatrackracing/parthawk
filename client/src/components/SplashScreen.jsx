import React, { useState, useEffect } from "react";

const SplashScreen = ({ onComplete }) => {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("darkhawk_splash_shown")) {
      setVisible(false);
      onComplete();
      return;
    }
    sessionStorage.setItem("darkhawk_splash_shown", "1");
    // 3.5s display, then 0.5s fade
    const fadeTimer = setTimeout(() => setFading(true), 3500);
    const hideTimer = setTimeout(() => { setVisible(false); onComplete(); }, 4000);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, [onComplete]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "#000", display: "flex", alignItems: "center", justifyContent: "center",
        opacity: fading ? 0 : 1, transition: "opacity 0.5s ease-out",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <img
          src="/admin/darkhawk-splash.jpg"
          alt="DarkHawk"
          style={{
            maxWidth: "80vw", maxHeight: "55vh", borderRadius: "12px",
            animation: "hawkPulse 0.8s ease-in-out 4",
          }}
        />
        <div style={{
          marginTop: "24px", fontSize: "32px", fontWeight: 900,
          letterSpacing: "8px", color: "#F0F0F0",
        }}>
          DARK<span style={{ color: "#DC2626" }}>HAWK</span>
        </div>
      </div>
      <style>{`
        @keyframes hawkPulse {
          0%, 100% {
            filter: drop-shadow(0 0 30px rgba(185, 28, 28, 0.4));
          }
          50% {
            filter: drop-shadow(0 0 60px rgba(220, 38, 38, 0.8));
          }
        }
      `}</style>
    </div>
  );
};

export default SplashScreen;
