import { Redis } from "@upstash/redis"

const redisUrl =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL

const redisToken =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN

const redis = new Redis({
  url: redisUrl,
  token: redisToken,
})

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

export default async function handler(req, res) {
  setCors(res)

  if (req.method === "OPTIONS") {
    return res.status(200).end()
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Use GET instead." })
  }

  try {
    if (!redisUrl || !redisToken) {
      return res.status(200).json({
        generations: [],
        warning: "Redis is not connected.",
      })
    }

    const items = await redis.lrange("mma:recent-generations", 0, 9)

    const generations = items
      .map((item) => {
        if (typeof item === "string") {
          try {
            return JSON.parse(item)
          } catch {
            return null
          }
        }

        return item
      })
      .filter(Boolean)

    return res.status(200).json({
      generations,
    })
  } catch (error) {
    console.error("Recent generations failed:", error)

    return res.status(500).json({
      error: "Could not load recent generations.",
      details: error?.message || "Unknown error",
    })
  }
}
