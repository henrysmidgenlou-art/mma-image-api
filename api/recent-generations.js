import { getRecentGenerations } from "./_recent-store.js";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Use GET.",
    });
  }

  try {
    const generations = getRecentGenerations();

    return res.status(200).json({
      success: true,
      generations,
    });
  } catch (error) {
    console.error("recent-generations failed:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Could not load recent generations.",
    });
  }
}
