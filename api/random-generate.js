import OpenAI from "openai"
import { Redis } from "@upstash/redis"
import { put } from "@vercel/blob"

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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

function safeText(value, maxLength = 500) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

function cleanTicker(value) {
  const cleaned =
    String(value || "ODD")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase()
      .slice(0, 8) || "ODD"

  if (cleaned.length < 3) return "ODD"

  return cleaned
}

function extractJson(text) {
  const raw = String(text || "").trim()

  try {
    return JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)

    if (!match) {
      throw new Error("Text model did not return JSON.")
    }

    return JSON.parse(match[0])
  }
}

async function fetchWikipediaConcepts() {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&generator=random&grnnamespace=0&grnlimit=8&prop=extracts|info&exintro=1&explaintext=1&inprop=url&format=json&origin=*"

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MemeMachineAutomata/1.0",
    },
  })

  if (!response.ok) {
    throw new Error(`Wikipedia fetch failed with ${response.status}`)
  }

  const data = await response.json()
  const pagesObject = data?.query?.pages || {}
  const pages = Object.values(pagesObject)

  const concepts = pages
    .map((page) => ({
      title: safeText(page.title, 120),
      extract: safeText(page.extract, 500),
      url:
        page.fullurl ||
        (page.pageid ? `https://en.wikipedia.org/?curid=${page.pageid}` : ""),
    }))
    .filter((item) => item.title)

  if (!concepts.length) {
    throw new Error("No Wikipedia concepts found.")
  }

  return concepts
}

function fallbackTickerFromWikipedia(concepts) {
  const words = concepts
    .flatMap((item) => item.title.split(/[\s\-_:,.;/()]+/g))
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())
    .filter((word) => word.length >= 3 && word.length <= 8)

  return words[0] || "ODD"
}

async function createSceneFromWikipedia(concepts) {
  const sourceMaterial = concepts
    .map(
      (item, index) =>
        `${index + 1}. Title: ${item.title}\nSummary: ${
          item.extract || "No summary available."
        }`
    )
    .join("\n\n")

  const systemPrompt = `
You create strange image concepts for an autonomous image generator.

Return ONLY valid JSON.

The concept must be based on the supplied random Wikipedia article titles and summaries.
Do not use premade characters.
Do not use celebrities or real identifiable people.
Do not make a collage of random objects.
Let the Wikipedia source material determine the subject, setting, props, mood, and visual details.

The final image should feel like a realistic wide-angle photograph with subtle uncanny early-AI-image weirdness.
`

  const userPrompt = `
Random Wikipedia source material:

${sourceMaterial}

Create one new random image concept.

Return JSON exactly like this:
{
  "ticker": "ONEWORD",
  "subject": "one strange central subject inspired by the Wikipedia articles",
  "setting": "one specific physical setting inspired by the Wikipedia articles",
  "details": ["detail one", "detail two", "detail three"],
  "mood": "short mood description",
  "primarySourceTitle": "the Wikipedia title that most inspired the concept"
}

Rules for ticker:
- one word only
- 3 to 8 letters or numbers
- no spaces
- no dollar sign
- not BTC, ETH, SOL, DOGE, PEPE, or MMA
- strange and memeable

Rules for concept:
- make it visually unique
- do not force a repeated scene type
- do not default to diners, basements, computers, traders, robots, or CRT monitors unless Wikipedia source material strongly suggests it
- create one strong main subject or scene
- not a logo
- not a known franchise character
`

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
  })

  const content = completion.choices?.[0]?.message?.content

  if (!content) {
    throw new Error("No scene JSON returned from text model.")
  }

  const parsed = extractJson(content)
  const fallbackTicker = fallbackTickerFromWikipedia(concepts)

  return {
    ticker: cleanTicker(parsed.ticker || fallbackTicker),
    subject: safeText(parsed.subject, 240),
    setting: safeText(parsed.setting, 220),
    details: Array.isArray(parsed.details)
      ? parsed.details.map((item) => safeText(item, 160)).slice(0, 5)
      : [],
    mood: safeText(parsed.mood, 120),
    primarySourceTitle: safeText(parsed.primarySourceTitle, 120),
  }
}

function getPrimaryWikiLink(concepts, scene) {
  if (!concepts.length) return null

  const preferredTitle = String(scene.primarySourceTitle || "").toLowerCase()

  if (preferredTitle) {
    const match = concepts.find(
      (item) => item.title.toLowerCase() === preferredTitle
    )

    if (match?.url) {
      return {
        title: match.title,
        url: match.url,
      }
    }

    const fuzzyMatch = concepts.find((item) =>
      item.title.toLowerCase().includes(preferredTitle)
    )

    if (fuzzyMatch?.url) {
      return {
        title: fuzzyMatch.title,
        url: fuzzyMatch.url,
      }
    }
  }

  const firstWithUrl = concepts.find((item) => item.url) || concepts[0]

  return {
    title: firstWithUrl.title,
    url: firstWithUrl.url,
  }
}

function buildImagePrompt(scene, concepts) {
  const sourceTitles = concepts.map((item) => item.title).join(", ")

  return `
Create a completely original AI-generated image inspired by these Wikipedia article titles:
${sourceTitles}

Main subject:
${scene.subject}

Setting:
${scene.setting}

Visual details:
${scene.details.map((detail) => `- ${detail}`).join("\n")}

Mood:
${scene.mood}

Let the Wikipedia-inspired concept determine the subject, clothing, environment, props, scale, atmosphere, and mood.

Visual style:
- realistic photograph
- wide-angle lens look
- believable real-world lighting
- realistic skin, fabric, metal, plastic, and surface textures
- subtle uncanny early-AI-image quality
- surreal but lifelike
- strange and memorable
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
- do not repeat the same type of setting every time
- do not force diners, basements, CRT monitors, robots, traders, or mascots unless the concept naturally calls for it

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

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Use GET instead." })
  }

  try {
    const concepts = await fetchWikipediaConcepts()
    const scene = await createSceneFromWikipedia(concepts)

    const caption = `$${scene.ticker}`
    const imagePrompt = buildImagePrompt(scene, concepts)
    const primaryWikiLink = getPrimaryWikiLink(concepts, scene)

    const wikiLinks = concepts
      .filter((item) => item.title && item.url)
      .map((item) => ({
        title: item.title,
        url: item.url,
      }))

    const result = await openai.images.generate({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      prompt: imagePrompt,
      size: "1024x1024",
      quality: "high",
    })

    const imageBase64 = result.data?.[0]?.b64_json

    if (!imageBase64) {
      return res.status(500).json({
        error: "No image returned from OpenAI.",
      })
    }

    const imageBuffer = Buffer.from(imageBase64, "base64")

    let imageUrl = null

    try {
      const filename = `generations/random-site-${Date.now()}-${scene.ticker.toLowerCase()}.png`

      const blob = await put(filename, imageBuffer, {
        access: "public",
        contentType: "image/png",
        addRandomSuffix: true,
      })

      imageUrl = blob.url
    } catch (blobError) {
      console.error("Blob save failed:", blobError)
    }

    if (redis && imageUrl) {
      await redis.lpush(
        "mma:recent-generations",
        JSON.stringify({
          id: `random-site-${Date.now()}`,
          imageUrl,
          prompt: caption,
          createdAt: new Date().toISOString(),
          source: "framer-random-wikipedia",
          wikiTitles: concepts.map((item) => item.title),
          wikiLinks,
          primaryWikiLink,
          scene,
        })
      )

      await redis.ltrim("mma:recent-generations", 0, 19)
    }

    return res.status(200).json({
      image: `data:image/png;base64,${imageBase64}`,
      imageUrl,
      caption,
      ticker: scene.ticker,
      wikiTitles: concepts.map((item) => item.title),
      wikiLinks,
      primaryWikiLink,
      scene,
    })
  } catch (error) {
    console.error("Random site generation failed:", error)

    return res.status(500).json({
      error: "Random generation failed.",
      details: error?.message || "Unknown error",
    })
  }
}
