const OpenAI = require("openai")
const { TwitterApi } = require("twitter-api-v2")
const { put } = require("@vercel/blob")

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const WORD_BANK = [
  "coin rain",
  "giant eye",
  "library",
  "heavy bag",
  "sunken room",
  "storm",
  "tape recorder",
  "moon",
  "windmill",
  "signal tower",
  "neon hallway",
  "crystal desert",
  "candle smoke",
  "silver fish",
  "green candle",
  "red candle",
  "vault",
  "rotating chair",
  "telephone",
  "ladder",
  "subway tunnel",
  "plastic flowers",
  "empty theater",
  "frozen lake",
  "shopping cart",
  "satellite dish",
  "gold mask",
  "blue fire",
  "radio static",
  "spiral staircase",
  "whale shadow",
  "desert motel",
  "retro computer",
  "arcade cabinet",
  "robot hand",
  "paper crown",
  "mirror room",
  "flooded office",
  "airport runway",
  "clock tower",
  "orange fog",
  "snow globe",
  "glass pyramid",
  "black balloon",
  "train station",
  "broken helmet",
  "night market",
  "server rack",
  "metal stairs",
  "cathedral ceiling",
  "green laser",
  "storm drain",
  "old camera",
  "vinyl record",
  "flying papers",
  "cement hallway",
  "sunflower field",
  "elevator",
  "theater curtain",
  "rose petals",
  "white horse",
  "stack of TVs",
  "abandoned mall",
  "traffic cone",
  "copper wires",
  "bird cage",
  "marble statue",
  "suitcase",
  "smoke ring",
  "glass cube",
  "typewriter",
  "doorframe",
  "broken clock",
  "sailboat",
  "ice tunnel",
  "lighthouse",
  "empty diner",
  "spiral notebook",
  "shadow figure",
  "coiled cable",
  "hologram",
  "church bells",
  "gold chain",
  "submarine window",
  "coin tower",
  "shopping receipt",
  "paper airplane",
  "basement",
  "security monitor",
  "warehouse",
  "desert highway",
  "ferris wheel",
  "laundromat",
  "taxi meter",
  "rain puddle",
  "cracked glass",
  "parking garage",
  "traffic light",
  "jukebox",
  "museum hallway",
  "helmet visor",
  "television glow",
  "gumball machine",
  "bubble wrap",
  "microphone",
  "roulette wheel",
  "spiral shell",
  "moonlight",
  "locker room",
  "dripping faucet",
  "vacuum tube",
  "compass",
  "fire escape",
  "stained carpet",
  "lantern",
  "sinking staircase",
  "security camera",
  "control room",
  "coin pile",
  "siren",
  "trophy case",
  "paint bucket",
  "pay phone",
  "blue curtain",
  "foggy window",
  "telescope",
  "spiral smoke",
  "air vent",
  "broken mirror",
  "ice cream truck",
  "gas station",
  "projector",
  "mushroom lamp",
  "golden ticket",
  "slot machine",
  "record player",
  "glowing stairs",
  "underground river",
  "fountain",
  "ceiling fan",
  "white gloves",
  "data cable",
  "coin fountain",
  "metal desk",
  "waiting room",
  "palm tree",
  "observatory",
  "streetlight",
  "chess board",
  "glass hallway",
  "flashlight",
  "curtain of rain",
  "piano keys",
  "torn poster",
  "old map",
  "frozen roses",
  "dust cloud",
  "wire fence",
  "masked figure",
  "vending machine",
  "coin slot",
  "mechanical heart",
  "wristwatch",
  "spiral tunnel",
  "cinema screen",
  "telephone pole",
  "red room",
  "green glow",
  "marble floor",
  "copper door",
  "floating chair",
  "empty pool",
  "starlight",
  "engine room",
  "storm window",
  "winding corridor",
  "glass bottle",
  "signal flare",
  "raincoat",
  "vault door",
  "magnet",
  "ticket booth",
  "blue hallway",
  "ceiling hatch",
  "metal cage",
  "desert wind",
  "wooden ladder",
  "snowstorm",
  "terminal screen",
  "heavy bags",
  "market stall",
  "dusty bookshelf",
  "elevator light",
  "photo booth",
  "mysterious package",
  "gold coin",
  "red scarf",
  "old television",
  "concrete bunker",
]

const RANDOM_DAILY_LIMIT = Number(process.env.RANDOM_DAILY_LIMIT || 8)
const RANDOM_WORD_COUNT = Number(process.env.RANDOM_WORD_COUNT || 5)

function getEnv(name, fallback = "") {
  return process.env[name] || fallback
}

function getRedisConfig() {
  const baseUrl =
    getEnv("UPSTASH_REDIS_REST_KV_REST_API_URL") ||
    getEnv("UPSTASH_REDIS_REST_URL")

  const token =
    getEnv("UPSTASH_REDIS_REST_KV_REST_API_TOKEN") ||
    getEnv("UPSTASH_REDIS_REST_TOKEN")

  if (!baseUrl || !token) return null
  return { baseUrl, token }
}

async function redisCommand(commandArray) {
  const redis = getRedisConfig()
  if (!redis) return null

  const response = await fetch(redis.baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redis.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commandArray),
  })

  if (!response.ok) {
    throw new Error(`Redis request failed with ${response.status}`)
  }

  const data = await response.json()
  return data.result
}

function getQueryParam(req, key) {
  if (req.query && typeof req.query[key] !== "undefined") {
    return req.query[key]
  }

  try {
    const url = new URL(req.url, "http://localhost")
    return url.searchParams.get(key)
  } catch {
    return null
  }
}

function toTickerWord(value) {
  return (
    String(value || "MMA")
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .trim()
      .split(/\s+/)[0]
      .toUpperCase() || "MMA"
  )
}

function pickRandomItems(array, count) {
  const copy = [...array]

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }

  return copy.slice(0, Math.min(count, copy.length))
}

function getDateKey() {
  return new Date().toISOString().slice(0, 10)
}

async function checkDailyLimit() {
  const redis = getRedisConfig()

  if (!redis) {
    return {
      enabled: false,
      allowed: true,
      count: null,
      limit: RANDOM_DAILY_LIMIT,
    }
  }

  const key = `mma:x-random:count:${getDateKey()}`
  const count = Number(await redisCommand(["INCR", key]))

  if (count === 1) {
    await redisCommand(["EXPIRE", key, 60 * 60 * 48])
  }

  return {
    enabled: true,
    allowed: count <= RANDOM_DAILY_LIMIT,
    count,
    limit: RANDOM_DAILY_LIMIT,
  }
}

async function getRecentTickers() {
  const redis = getRedisConfig()
  if (!redis) return []

  const result = await redisCommand(["LRANGE", "mma:x-random:recent_tickers", 0, 24])
  return Array.isArray(result) ? result : []
}

async function rememberTicker(ticker) {
  const redis = getRedisConfig()
  if (!redis) return

  await redisCommand(["LPUSH", "mma:x-random:recent_tickers", ticker])
  await redisCommand(["LTRIM", "mma:x-random:recent_tickers", 0, 24])
}

async function rememberGenerationRecord(record) {
  const redis = getRedisConfig()
  if (!redis) return

  await redisCommand(["LPUSH", "mma:recent_generations", JSON.stringify(record)])
  await redisCommand(["LTRIM", "mma:recent_generations", 0, 49])
}

function buildSelection() {
  return pickRandomItems(WORD_BANK, RANDOM_WORD_COUNT)
}

function buildImagePrompt(selectedWords) {
  return `
Create a completely original AI-generated image.

Random inspiration words:
${selectedWords.join(", ")}

Main goal:
Create a highly realistic, visually striking image that feels like a strange but believable real photograph.

Important style direction:
- photorealistic
- cinematic but natural
- realistic lighting
- realistic materials and textures
- soft, believable shadows
- subtle film-like feel
- strange subject matter, but rendered as if it were a real photograph
- polished, memorable, atmospheric
- closer to classic early AI photo-generation aesthetics than cartoon art
- not cartoony
- not comic-book style
- not mascot art
- not glossy illustration
- not a meme template
- not a UI screenshot
- not a flowchart
- not a diagram
- not an infographic

Composition:
Use only 2 to 4 of the random inspiration words to create one single coherent scene.
Do NOT try to force every word into the image.
The final image should feel like an unusual real-world photograph, not a collage.

Visual feel:
- realistic photography
- cinematic framing
- authentic depth
- believable perspective
- subtle surrealism
- unexpected but elegant
- internet-weird in concept, realistic in execution

Strict rules:
- no readable brand logos
- no celebrity likeness
- no financial promises
- no "buy now" text
- no "100x" text
- no guaranteed profit language
- no hate, gore, or explicit sexual content
- minimal or no text in the image
`.trim()
}

async function generateImageBuffer(prompt) {
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1"

  const result = await openai.images.generate({
    model,
    prompt,
    size: "1024x1024",
  })

  const item = result?.data?.[0]

  if (!item) {
    throw new Error("No image was returned by OpenAI.")
  }

  if (item.b64_json) {
    return {
      buffer: Buffer.from(item.b64_json, "base64"),
      model,
    }
  }

  if (item.url) {
    const imageResponse = await fetch(item.url)
    if (!imageResponse.ok) {
      throw new Error(`Failed to download generated image (${imageResponse.status})`)
    }

    const arrayBuffer = await imageResponse.arrayBuffer()
    return {
      buffer: Buffer.from(arrayBuffer),
      model,
    }
  }

  throw new Error("OpenAI returned an unsupported image response.")
}

function createTwitterClient() {
  return new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  })
}

function requireEnvVars() {
  const required = [
    "OPENAI_API_KEY",
    "X_API_KEY",
    "X_API_SECRET",
    "X_ACCESS_TOKEN",
    "X_ACCESS_SECRET",
    "BOT_SECRET",
  ]

  const missing = required.filter((name) => !process.env[name])

  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`)
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." })
  }

  try {
    requireEnvVars()

    const secret = getQueryParam(req, "secret")
    const dryRun = String(getQueryParam(req, "dryRun") || "").toLowerCase() === "true"

    if (!secret || secret !== process.env.BOT_SECRET) {
      return res.status(401).json({ error: "Unauthorized." })
    }

    const recentTickers = await getRecentTickers()

    let selectedWords = []
    let captionWord = "MMA"

    for (let attempt = 0; attempt < 12; attempt++) {
      const candidateWords = buildSelection()
      const possibleTicker = toTickerWord(
        candidateWords[Math.floor(Math.random() * candidateWords.length)]
      )

      if (!recentTickers.includes(possibleTicker)) {
        selectedWords = candidateWords
        captionWord = possibleTicker
        break
      }
    }

    if (!selectedWords.length) {
      selectedWords = buildSelection()
      captionWord = toTickerWord(selectedWords[0] || "MMA")
    }

    const caption = `$${captionWord}`
    const imagePrompt = buildImagePrompt(selectedWords)

    if (dryRun) {
      return res.status(200).json({
        status: "ok",
        dryRun: true,
        model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
        selectedWords,
        caption,
        imagePrompt,
      })
    }

    const limitCheck = await checkDailyLimit()

    if (!limitCheck.allowed) {
      return res.status(200).json({
        status: "ok",
        skipped: `Daily random limit reached (${limitCheck.limit}/day).`,
        limitEnabled: limitCheck.enabled,
        count: limitCheck.count,
        limit: limitCheck.limit,
      })
    }

    const { buffer, model } = await generateImageBuffer(imagePrompt)

    let imageUrl = null
    try {
      const filename = `generations/${Date.now()}-${captionWord.toLowerCase()}.png`
      const blob = await put(filename, buffer, {
        access: "public",
        contentType: "image/png",
        addRandomSuffix: true,
      })
      imageUrl = blob.url
    } catch (blobError) {
      console.error("Blob upload error:", blobError)
    }

    const twitterClient = createTwitterClient()
    const mediaId = await twitterClient.v1.uploadMedia(buffer, {
      mimeType: "image/png",
    })

    const tweet = await twitterClient.v2.tweet({
      text: caption,
      media: {
        media_ids: [mediaId],
      },
    })

    await rememberTicker(captionWord)

    await rememberGenerationRecord({
      id: tweet?.data?.id || `random-${Date.now()}`,
      imageUrl,
      prompt: imagePrompt,
      createdAt: new Date().toISOString(),
      source: "x-random",
      caption,
      selectedWords,
      model,
    })

    return res.status(200).json({
      status: "ok",
      randomMode: true,
      model,
      selectedWords,
      caption,
      postedTweetId: tweet?.data?.id || null,
      imageUrl,
      duplicateProtection: true,
      dailyLimit: {
        enabled: limitCheck.enabled,
        count: limitCheck.count,
        limit: limitCheck.limit,
      },
    })
  } catch (error) {
    console.error("x-random error:", error)

    return res.status(500).json({
      error: "Random image bot failed.",
      details: error.message || "Unknown error",
    })
  }
}
