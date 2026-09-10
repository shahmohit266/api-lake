import { getServerSession } from "next-auth";
import ExtractorClient from "./ExtractorClient";

export default async function Home() {
  const session = await getServerSession();
  const userEmail = session?.user?.email || "unknown_user";

  if (!session) {
    return (
      <main style={{ minHeight: "100vh", background: "#0f172a", display: "flex", justifyContent: "center", alignItems: "center", fontFamily: "sans-serif" }}>
        <div style={{ background: "#1e293b", padding: "40px", borderRadius: "12px", border: "1px solid #334155", textAlign: "center", maxWidth: "400px", width: "100%", color: "#f8fafc" }}>
          <h1 style={{ fontSize: "1.4rem", color: "#38bdf8", marginBottom: "10px" }}>API Data Extractor</h1>
          <p style={{ color: "#94a3b8", fontSize: "14px", marginBottom: "24px" }}>Please sign in with your corporate account to access this tool.</p>
          <a href="/api/auth/signin" style={{ display: "block", padding: "12px", background: "#38bdf8", color: "#000", textDecoration: "none", borderRadius: "6px", fontWeight: "bold", fontSize: "14px" }}>
            Sign in with Google
          </a>
        </div>
      </main>
    );
  }

  return <ExtractorClient userEmail={userEmail} />;
}