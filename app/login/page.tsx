"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Incorrect password.");
        setBusy(false);
        return;
      }
      const returnTo = new URLSearchParams(window.location.search).get("return_to");
      window.location.href = returnTo || "/dashboard";
    } catch {
      setError("Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0b0d12", fontFamily: "var(--font-geist-sans, system-ui), sans-serif",
    }}>
      <form onSubmit={submit} style={{
        width: "min(360px, 90vw)", background: "#151821", borderRadius: 16, padding: "36px 32px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)", display: "flex", flexDirection: "column", gap: 16,
      }}>
        <div>
          <h1 style={{ color: "#fff", fontSize: 20, fontWeight: 600, margin: 0 }}>Jobsite Lens</h1>
          <p style={{ color: "#8a90a2", fontSize: 14, margin: "6px 0 0" }}>Enter the password to continue.</p>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          style={{
            padding: "12px 14px", borderRadius: 10, border: "1px solid #2a2f3d", background: "#0f1117",
            color: "#fff", fontSize: 15, outline: "none",
          }}
        />
        {error && <p style={{ color: "#ff6b6b", fontSize: 13, margin: 0 }}>{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          style={{
            padding: "12px 14px", borderRadius: 10, border: "none", background: busy || !password ? "#2a2f3d" : "#2768e8",
            color: "#fff", fontSize: 15, fontWeight: 600, cursor: busy || !password ? "default" : "pointer",
          }}
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
