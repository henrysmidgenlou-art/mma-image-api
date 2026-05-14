import OpenAI from "openai"
import { TwitterApi } from "twitter-api-v2"
import { Redis } from "@upstash/redis"
import { put } from "@vercel/blob"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const twitterClient = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
})

const rwClient = twitterClient.readWrite

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

function getQueryValue(value) {
  if (Array.isArray(value)) return value[0]
  return value
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

async function fetchWikipediaConcepts() {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&generator=random&grnnamespace=0&grnlimit=7&prop=extracts&exintro=1&explaintext=1&format=json&origin=*"

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
    }))
    .filter((item) => item.title)

  if (!concepts.length) {
    throw new Error("No Wikipedia concepts found.")
  }

  return concepts
}

async function getRecentTickers() {
  if (!redis) return []

  const items = await redis.lrange("mma:random-wiki-recent-tickers", 0, 40)

  return Array.isArray(items) ? items : []
}

async function rememberTicker(ticker) {
  if (!redis) return

  await redis.lpush("mma:random-wiki-recent-tickers", ticker)
  await redis.ltrim("mma:random-wiki-recent-tickers", 0, 40)
}

async function getDailyCount() {
  if (!redis) return 0

  const today = new Date().toISOString().slice(0, 10)
  const key = `mma:random-wiki-count:${today}`
  const count = await redis.get(key)

  return Number(count || 0)
}

async function incrementDailyCount() {
  if (!redis) return null

  const today = new Date().toISOString().slice(0, 10)
  const key = `mma:random-wiki-count:${today}`
  const count = await redis.incr(key)

  await redis.expire(key, 60 * 60 * 36)

  return count
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

function fallbackTickerFromWikipedia(concepts) {
  const words = concepts
    .flatMap((item) => item.title.split(/[\s\-_:,.;/()]+/g))
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())
    .filter((word) => word.length >= 3 && word.length <= 8)

  return words[0] || "ODD"
}

async function createSceneFromWikipedia(concepts) {
  const recentTickers = await getRecentTickers()

  const sourceMaterial = concepts
    .map(
      (item, index) =>
        `${index + 1}. Title: ${item.title}\nSummary: ${
          item.extract || "No summary available."
        }`
    )
    .join("\n\n")

  const systemPrompt = `
You create strange fictional character concepts for an autonomous image bot.

Return ONLY valid JSON.

The image concept must be based on the supplied random Wikipedia article titles and summaries.
Do not use premade characters.
Do not use celebrities or real identifiable people.
Do not make a collage of random objects.
Invent one central fictional character inspired by the Wikipedia material.

The final image should feel like a realistic wide-angle flash photograph of a bizarre person or creature in a mundane place.
`

  const userPrompt = `
Random Wikipedia source material:

${sourceMaterial}

Recently used ticker words to avoid:
${recentTickers.join(", ") || "none"}

Create one new random image concept.

Return JSON exactly like this:
{
  "ticker": "ONEWORD",
  "subject": "one bizarre fictional character inspired by the Wikipedia articles",
  "location": "one specific physical place inspired by the Wikipedia articles",
  "action": "what the character is doing",
  "visual_details": ["detail one", "detail two", "detail three"],
  "mood": "short mood description"
}

Rules for ticker:
- one word only
- 3 to 8 letters or numbers
- no spaces
- no dollar sign
- not BTC, ETH, SOL, DOGE, PEPE, or MMA
- strange and memeable

Rules for subject:
- must be one clear central character
- weird, unique, uncanny, memorable
- not just a pile of objects
- not a logo
- not a creature from a known franchise
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
    location: safeText(parsed.location, 180),
    action: safeText(parsed.action, 220),
    visual_details: Array.isArray(parsed.visual_details)
      ? parsed.visual_details.map((item) => safeText(item, 160)).slice(0, 5)
      : [],
    mood: safeText(parsed.mood, 120),
  }
}

function buildImagePrompt(scene, concepts) {
  const sourceTitles = concepts.map((item) => item.title).join(", ")

  return `
Create one highly realistic wide-angle photograph of a single bizarre fictional character.

The character and scene are inspired by these random Wikipedia article titles:
${sourceTitles}

Main subject:
${scene.subject}

Location:
${scene.location}

Action:
${scene.action}

Visual details:
${scene.visual_details.map((detail) => `- ${detail}`).join("\n")}

Mood:
${scene.mood}

Reference style direction:
Make it feel like a strange real photo found online: a deadpan, uncanny character portrait in a mundane indoor place. The subject should be close to the camera, centered, and slightly distorted by a very wide lens. The image should feel lifelike, awkward, eerie, and documentary.

Mandatory camera requirements:
- real wide-angle lens photograph
- 18mm to 22mm lens feeling
- stronger wide-angle distortion than a normal portrait
- close camera position
- subject clearly visible and centered
- large expressive face or strange body proportions from lens distortion
- hands, face, clothing, and props should feel physically real
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
- weird character portrait
- mundane place plus bizarre subject
- early AI photo-generation weirdness, but with realistic texture
- not polished
- not cute
- not clean corporate art
- not fantasy concept art
- not a digital painting

Very important:
- ONE fictional character must be the main subject
- do not make random objects the main subject
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
- no gore
- no explicit sexual content
`.trim()
}

function buildPublicRecord({ tweetId, imageUrl, caption, scene, concepts }) {
  return {
    id: tweetId || `random-${Date.now()}`,
    imageUrl,
    prompt: caption,
    createdAt: new Date().toISOString(),
    source: "x-random-wikipedia-ai-scene",
    wikiTitles: concepts.map((item) => item.title),
    scene,
  }
}

export default async function handler(req, res) {
  setCors(res)

  if (req.method === "OPTIONS") {
    return res.status(200).end()
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Use GET instead." })
  }

  let stage = "start"

  try {
    const secret = getQueryValue(req.query?.secret)
    const dryRun =
      getQueryValue(req.query?.dryRun) === "true" ||
      getQueryValue(req.query?.dryRun) === "1"
    const force =
      getQueryValue(req.query?.force) === "true" ||
      getQueryValue(req.query?.force) === "1"

    if (!secret || secret !== process.env.BOT_SECRET) {
      return res.status(401).json({ error: "Unauthorized." })
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY." })
    }

    if (!process.env.OPENAI_TEXT_MODEL) {
      return res.status(500).json({ error: "Missing OPENAI_TEXT_MODEL." })
    }

    if (
      !process.env.X_API_KEY ||
      !process.env.X_API_SECRET ||
      !process.env.X_ACCESS_TOKEN ||
      !process.env.X_ACCESS_SECRET
    ) {
      return res.status(500).json({ error: "Missing X credentials." })
    }

    const dailyLimit = Number(process.env.RANDOM_DAILY_LIMIT || 8)

    stage = "daily_limit"

    if (!dryRun && !force) {
      const currentCount = await getDailyCount()

      if (currentCount >= dailyLimit) {
        return res.status(200).json({
          status: "ok",
          skipped: "Daily random post limit reached.",
          currentCount,
          dailyLimit,
        })
      }
    }

    stage = "fetch_wikipedia"

    const concepts = await fetchWikipediaConcepts()

    stage = "create_scene"

    let scene = await createSceneFromWikipedia(concepts)

    const recentTickers = await getRecentTickers()
    let attempts = 0

    while (recentTickers.includes(scene.ticker) && attempts < 3) {
      scene = await createSceneFromWikipedia(concepts)
      attempts++
    }

    const caption = `$${scene.ticker}`
    const imagePrompt = buildImagePrompt(scene, concepts)

    if (dryRun) {
      return res.status(200).json({
        status: "ok",
        dryRun: true,
        caption,
        ticker: scene.ticker,
        wikiTitles: concepts.map((item) => item.title),
        scene,
        imagePrompt,
        textModel: process.env.OPENAI_TEXT_MODEL,
        imageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      })
    }

    stage = "generate_image"

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

    stage = "save_blob"

    let imageUrl = null

    try {
      const filename = `generations/random-${Date.now()}-${scene.ticker.toLowerCase()}.png`

      const blob = await put(filename, imageBuffer, {
        access: "public",
        contentType: "image/png",
        addRandomSuffix: true,
      })

      imageUrl = blob.url
    } catch (blobError) {
      console.error("Blob save failed:", blobError)
    }

    stage = "upload_media"

    const mediaId = await rwClient.v1.uploadMedia(imageBuffer, {
      mimeType: "image/png",
    })

    stage = "post_tweet"

    const tweet = await rwClient.v2.tweet({
      text: caption,
      media: {
        media_ids: [mediaId],
      },
    })

    stage = "save_history"

    await rememberTicker(scene.ticker)

    const newCount = await incrementDailyCount()

    if (redis && imageUrl) {
      await redis.lpush(
        "mma:recent-generations",
        JSON.stringify(
          buildPublicRecord({
            tweetId: tweet?.data?.id || null,
            imageUrl,
            caption,
            scene,
            concepts,
          })
        )
      )

      await redis.ltrim("mma:recent-generations", 0, 9)
    }

    return res.status(200).json({
      status: "ok",
      randomMode: true,
      postedTweetId: tweet?.data?.id || null,
      caption,
      ticker: scene.ticker,
      wikiTitles: concepts.map((item) => item.title),
      scene,
      imageUrl,
      dailyCount: newCount,
      dailyLimit,
      imageStyle: "lifelike_wide_angle_uncanny_character_photo",
    })
  } catch (error) {
    console.error("x-random failed:", {
      stage,
      message: error?.message,
      code: error?.code,
      data: error?.data,
    })

    return res.status(500).json({
      error: "Random image bot failed.",
      stage,
      details: error?.message || "Unknown error",
      code: error?.code || null,
      data: error?.data || null,
    })
  }
}
