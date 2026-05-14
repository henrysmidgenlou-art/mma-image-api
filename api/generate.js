import OpenAI from "openai"
import { put } from "@vercel/blob"
import { Redis } from "@upstash/redis"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const redisUrl =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL

const redisToken =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN

const redis =
  redisUrl && redisToken
    ? new Redis({
        url: redisUrl,
        token: redisToken,
      })
    : null

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

function looksUnsafe(prompt) {
  const bannedWords = [
    "nude",
    "porn",
    "sex",
    "gore",
    "kill",
    "murder",
    "racist",
    "terrorist",
  ]

  const lower = String(prompt || "").toLowerCase()
  return bannedWords.some((word) => lower.includes(word))
}

function cleanPublicPrompt(prompt) {
  return String(prompt || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
}

function buildImagePrompt(prompt) {
  return `
Create a completely original AI-generated image based on this user prompt:

${prompt}

Let the user prompt determine the subject, setting, props, clothing, mood, and details.

Visual style:
- realistic photograph
- wide-angle lens look
- believable real-world lighting
- realistic skin, fabric, metal, plastic, and surface textures
- subtle uncanny early-AI-image quality
- surreal but lifelike
- strange and memorable when appropriate
- not cartoon
- not illustration
- not anime
- not glossy 3D render
- not a meme template
- not a UI screenshot
- not a diagram
- not an infographic

Composition:
- one strong main subject or scene
- visually clear
- cinematic framing
- environmental context
- allow weirdness and unpredictability

The image should feel like a bizarre but believable real photograph.

Rules:
- no readable logos
- no heavy text
- no celebrity likeness
- no hate, gore, or explicit sexual content
- no financial promises
`.trim()
}

export default async function handler(req, res) {
  setCors(res)

  if (req.method === "OPTIONS") {
    return res.status(200).end()
  }

  if (req.method === "GET") {
    return res.status(405).json({ error: "Use POST instead." })
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST instead." })
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY." })
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body
    const prompt = body?.prompt

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Prompt is required." })
    }

    if (prompt.length > 400) {
      return res.status(400).json({
        error: "Prompt is too long. Keep it under 400 characters.",
      })
    }

    if (looksUnsafe(prompt)) {
      return res.status(400).json({
        error: "Try a safer prompt.",
      })
    }

    const finalPrompt = buildImagePrompt(prompt)

    const result = await openai.images.generate({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      prompt: finalPrompt,
      size: "1024x1024",
      quality: "high",
    })

    const imageBase64 = result.data?.[0]?.b64_json

    if (!imageBase64) {
      return res.status(500).json({ error: "No image was generated." })
    }

    const imageBuffer = Buffer.from(imageBase64, "base64")

    let imageUrl = null

    try {
      const filename = `generations/site-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.png`

      const blob = await put(filename, imageBuffer, {
        access: "public",
        contentType: "image/png",
        addRandomSuffix: true,
      })

      imageUrl = blob.url
    } catch (blobError) {
      console.error("Blob save failed:", blobError?.message || blobError)
    }

    try {
      if (redis && imageUrl) {
        await redis.lpush(
          "mma:recent-generations",
          JSON.stringify({
            id: `site-${Date.now()}`,
            imageUrl,
            prompt: cleanPublicPrompt(prompt),
            createdAt: new Date().toISOString(),
            source: "framer-prompt",
          })
        )

        await redis.ltrim("mma:recent-generations", 0, 9)
      }
    } catch (redisError) {
      console.error("Redis save failed:", redisError?.message || redisError)
    }

    return res.status(200).json({
      image: `data:image/png;base64,${imageBase64}`,
      imageUrl,
    })
  } catch (error) {
    console.error("Image generation failed:", error)

    return res.status(500).json({
      error: "Image generation failed.",
      details: error?.message || "Unknown error",
    })
  }
}
