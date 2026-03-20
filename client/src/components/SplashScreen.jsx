import React, { useState, useEffect } from "react";

const SplashScreen = ({ onComplete }) => {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    // Check if already shown this session
    if (sessionStorage.getItem("darkhawk_splash_shown")) {
      setVisible(false);
      onComplete();
      return;
    }
    sessionStorage.setItem("darkhawk_splash_shown", "1");
    const fadeTimer = setTimeout(() => setFading(true), 2000);
    const hideTimer = setTimeout(() => { setVisible(false); onComplete(); }, 2800);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, [onComplete]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "#000", display: "flex", alignItems: "center", justifyContent: "center",
        opacity: fading ? 0 : 1, transition: "opacity 0.8s ease-out",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <img
          src="/admin/darkhawk-splash.png"
          alt="DarkHawk"
          style={{
            maxWidth: "80vw", maxHeight: "60vh", borderRadius: "12px",
            filter: "drop-shadow(0 0 30px rgba(220,38,38,0.5))",
            animation: "glowPulse 2s ease-in-out infinite",
          }}
        />
        <div style={{ marginTop: "20px", fontSize: "28px", fontWeight: 900, letterSpacing: "6px", color: "#F0F0F0" }}>
          DARK<span style={{ color: "#DC2626" }}>HAWK</span>
        </div>
      </div>
      <style>{`
        @keyframes glowPulse {
          0%, 100% { filter: drop-shadow(0 0 20px rgba(220,38,38,0.3)); }
          50% { filter: drop-shadow(0 0 40px rgba(220,38,38,0.7)); }
        }
      `}</style>
    </div>
  );
};

export default SplashScreen;
