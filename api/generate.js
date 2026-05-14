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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
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

  const lower = prompt.toLowerCase()
  return bannedWords.some((word) => lower.includes(word))
}

function cleanPublicPrompt(prompt) {
  return prompt.replace(/\s+/g, " ").trim().slice(0, 120)
}

function buildImagePrompt(prompt) {
  return `
Create one highly realistic wide-angle photograph based on this user request:

${prompt}

Reference style direction:
Make it feel like a strange real photo found online: a deadpan, uncanny subject in a mundane indoor place. The subject should be close to the camera, centered, and slightly distorted by a very wide lens. The image should feel lifelike, awkward, eerie, documentary, and memorable.

Mandatory camera requirements:
- real wide-angle lens photograph
- 18mm to 22mm lens feeling
- stronger wide-angle distortion than a normal portrait
- close camera position
- one clear central subject
- subject clearly visible and centered
- large expressive face, hands, body, or object proportions from lens distortion
- realistic human-scale environment
- harsh direct flash or fluorescent overhead lighting
- dim mundane background
- believable shadows
- realistic skin, fabric, plastic, metal, dust, grime, walls, floor, and background textures
- imperfect documentary snapshot
- awkward real camera framing
- gritty low-budget real-world atmosphere
- strange enough to feel like an uncanny photo someone accidentally found online

Visual look:
- photorealistic
- lifelike
- realistic photograph
- uncanny but believable
- weird character portrait or strange central subject
- mundane place plus bizarre subject
- early AI photo-generation weirdness, but with realistic texture
- not polished
- not cute
- not clean corporate art
- not fantasy concept art
- not a digital painting

Very important:
- one main subject only
- do not make random objects the main subject unless the user specifically asks for an object
- do not make a collage of objects
- do not make a cartoon
- do not make anime
- do not make comic-book art
- do not make glossy 3D mascot art
- do not make toy-like characters
- do not make a logo
- do not make a poster
- do not make a chart, diagram, UI screenshot, or infographic
- minimal or no text in the image
- no readable brand logos
- no celebrity likeness
- no financial promises
- no buy now text
- no 100x text
- no gore
- no explicit sexual content
`.trim()
}

export default async function handler(req, res) {
  setCors(res)

  if (req.method === "OPTIONS") {
    return res.status(200).end()
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST instead." })
  }

  try {
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

    const filename = `generations/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.png`

    const blob = await put(filename, imageBuffer, {
      access: "public",
      contentType: "image/png",
    })

    const imageUrl = blob.url

    const item = {
      id: filename,
      imageUrl,
      prompt: cleanPublicPrompt(prompt),
      createdAt: new Date().toISOString(),
    }

    if (redis) {
      await redis.lpush("mma:recent-generations", JSON.stringify(item))
      await redis.ltrim("mma:recent-generations", 0, 9)
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
