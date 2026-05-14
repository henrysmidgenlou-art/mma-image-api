import OpenAI from "openai"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

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

    const finalPrompt = `
Create a high-quality meme-style AI image based on this user request:

${prompt}

Visual style:
- classic early AI image generation aesthetic
- DALL-E-inspired surreal digital art look
- dreamlike, slightly uncanny, weird but coherent
- soft painterly lighting
- strange object combinations
- retro AI image generator feeling
- internet meme energy, but not flat cartoon art
- surreal composition
- odd, funny, memorable visual joke
- not photorealistic
- not anime
- not comic-book style
- not glossy modern 3D
- not corporate stock image

Scene direction:
- make it feel like an early OpenAI image-generation style meme
- strange but readable image idea
- expressive composition
- surreal humor
- crypto / memecoin / internet culture vibe if relevant
- detailed but slightly weird AI-art texture

Avoid:
- flat cartoon style
- childish illustration
- flowcharts
- diagrams
- infographics
- UI screenshots
- messy unreadable text

Rules:
- no hate, harassment, adult content, or graphic violence
- no real celebrity likeness
- no readable brand logos
- no financial promises
- no "buy now"
- no "100x"
- no guaranteed profit
`

    const result = await openai.images.generate({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      prompt: finalPrompt,
      size: "1024x1024",
      quality: "medium",
    })

    const imageBase64 = result.data?.[0]?.b64_json

    if (!imageBase64) {
      return res.status(500).json({ error: "No image was generated." })
    }

    return res.status(200).json({
      image: `data:image/png;base64,${imageBase64}`,
    })
  } catch (error) {
    console.error("Image generation failed:", error)

    return res.status(500).json({
      error: "Image generation failed.",
      details: error?.message || "Unknown error",
    })
  }
}
