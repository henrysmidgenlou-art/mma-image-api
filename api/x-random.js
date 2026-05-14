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

const redis = new Redis({
  url: redisUrl,
  token: redisToken,
})

const TICKER_WORDS = [
  "GLOOP",
  "ZORP",
  "MUNG",
  "BLOBB",
  "GRUM",
  "WORM",
  "FROG",
  "GOON",
  "MELT",
  "GUNK",
  "SPORK",
  "VEX",
  "GOB",
  "BAG",
  "OOZE",
  "GIGGLE",
  "NUB",
  "BLIMP",
  "SLOP",
  "MOSS",
  "YUCK",
  "WOBBLE",
  "GRAIL",
  "VOID",
  "LURK",
  "SNORF",
  "DREG",
  "BINGLE",
  "MEEP",
  "ZAP",
  "MOLD",
  "SCRUB",
  "PLUG",
  "DUNK",
  "CRUMB",
  "BEEP",
  "SLUDGE",
  "BOGGLE",
  "TWONK",
  "MANGLE",
]

const CHARACTER_TYPES = [
  "a hairless frog-like humanoid",
  "a nervous lizard accountant",
  "a wet goblin trader",
  "a pale basement prophet",
  "a strange bird-faced office worker",
  "a rubbery alien janitor",
  "a frog merchant with human hands",
  "a wrinkled moon-faced delivery man",
  "a bug-eyed vending machine repairman",
  "a fish-headed night clerk",
  "a tiny king in an oversized suit",
  "a melted-looking crypto gambler",
  "a mushroom-headed security guard",
  "a greasy wizard in business casual clothes",
  "a wide-eyed swamp creature wearing a tie",
  "a strange humanoid made of candle wax",
  "a bald monkey-like salesman",
  "a turtle-faced banker",
  "a ghostly elevator operator",
  "a frog priest holding a briefcase",
  "a bug-eyed man in a cheap raincoat",
  "a damp goblin sitting in an office chair",
  "a lumpy creature wearing old sneakers",
  "a nervous mole-person with a laptop",
  "a pale humanoid with enormous eyes",
  "a strange little trader with a huge head",
]

const LOCATIONS = [
  "in a fluorescent-lit basement",
  "inside an abandoned mall food court",
  "in a dirty office break room",
  "inside a 1990s computer lab",
  "in a foggy parking garage",
  "inside a laundromat at midnight",
  "in an empty diner",
  "inside a cluttered server room",
  "in a weird suburban living room",
  "inside a concrete bunker",
  "in a cramped pawn shop",
  "inside an old arcade",
  "in a flooded office hallway",
  "inside a dim convenience store",
  "in a dusty storage room",
  "inside a cheap motel lobby",
  "in a basement trading room",
  "inside a strange warehouse",
  "in a narrow hallway with old carpet",
  "inside a low-ceiling conference room",
]

const CHARACTER_DETAILS = [
  "holding a heavy plastic bag full of coins",
  "standing next to a glowing green candle chart",
  "clutching a tiny briefcase",
  "wearing a crooked paper crown",
  "holding an old keyboard like a sacred object",
  "staring directly into the camera",
  "surrounded by scattered receipts",
  "holding a gold coin between two fingers",
  "wearing oversized sunglasses indoors",
  "holding a cracked CRT monitor",
  "guarding a pile of strange bags",
  "standing beside a broken vending machine",
  "holding a tiny glowing frog",
  "wearing a wrinkled suit that does not fit",
  "holding a red candle and a green candle",
  "surrounded by cheap office furniture",
  "pointing at a mysterious glowing screen",
  "holding a plastic shopping basket",
  "sitting in a tiny chair",
  "standing under harsh ceiling lights",
]

const PHOTO_STYLES = [
  "shot with a 24mm wide-angle lens",
  "shot with a 20mm wide-angle lens",
  "shot with a 28mm documentary lens",
  "close wide-angle flash photograph",
  "awkward real-life documentary photo",
  "realistic candid photograph",
  "low-angle wide-angle photograph",
  "harsh direct flash photography",
  "strange real-world tabloid photograph",
  "amateur wide-angle digital camera photo",
]

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

function pick(array) {
  return array[Math.floor(Math.random() * array.length)]
}

function getQueryValue(value) {
  if (Array.isArray(value)) return value[0]
  return value
}

function cleanTicker(word) {
  return String(word || "MMA")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 10) || "MMA"
}

async function getDailyCount() {
  const today = new Date().toISOString().slice(0, 10)
  const key = `mma:random-photo-count:${today}`
  const count = await redis.get(key)
  return Number(count || 0)
}

async function incrementDailyCount() {
  const today = new Date().toISOString().slice(0, 10)
  const key = `mma:random-photo-count:${today}`
  const count = await redis.incr(key)
  await redis.expire(key, 60 * 60 * 36)
  return count
}

async function getRecentTickers() {
  const items = await redis.lrange("mma:random-photo-recent-tickers", 0, 30)
  return Array.isArray(items) ? items : []
}

async function rememberTicker(ticker) {
  await redis.lpush("mma:random-photo-recent-tickers", ticker)
  await redis.ltrim("mma:random-photo-recent-tickers", 0, 30)
}

async function pickFreshTicker() {
  const recent = await getRecentTickers()

  for (let i = 0; i < 20; i++) {
    const ticker = cleanTicker(pick(TICKER_WORDS))
    if (!recent.includes(ticker)) return ticker
  }

  return cleanTicker(pick(TICKER_WORDS))
}

function buildRandomScene() {
  const character = pick(CHARACTER_TYPES)
  const location = pick(LOCATIONS)
  const detail1 = pick(CHARACTER_DETAILS)
  const detail2 = pick(CHARACTER_DETAILS)
  const photoStyle = pick(PHOTO_STYLES)

  return {
    character,
    location,
    detail1,
    detail2,
    photoStyle,
  }
}

function buildImagePrompt(scene) {
  return `
Create one realistic wide-angle photograph of a single bizarre character.

Main subject:
${scene.character}

Location:
${scene.location}

Character action/details:
- ${scene.detail1}
- ${scene.detail2}

Camera and realism requirements:
- ${scene.photoStyle}
- real photograph look
- wide-angle lens distortion
- realistic human-scale environment
- natural but strange lighting
- harsh direct flash or fluorescent overhead lighting
- believable shadows
- realistic skin, fabric, plastic, metal, dust, and grime textures
- imperfect documentary photo
- slightly awkward real camera framing
- subject should be clearly visible and centered
- the image should feel like a weird real photo someone accidentally found online

Style:
- photorealistic
- uncanny but believable
- strange character portrait
- weird internet photography
- early AI photo-generation feeling, but more realistic
- gritty, low-budget, real-world atmosphere
- not polished
- not cute
- not clean corporate art

Very important:
- the image must have ONE main character as the subject
- do not make a collage of random objects
- do not make a cartoon
- do not make an illustration
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

function buildPublicRecord({ tweetId, imageUrl, caption, scene }) {
  return {
    id: tweetId || `random-${Date.now()}`,
    imageUrl,
    prompt: caption,
    createdAt: new Date().toISOString(),
    source: "x-random-photo",
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

    if (
      !process.env.X_API_KEY ||
      !process.env.X_API_SECRET ||
      !process.env.X_ACCESS_TOKEN ||
      !process.env.X_ACCESS_SECRET
    ) {
      return res.status(500).json({ error: "Missing X API credentials." })
    }

    if (!redisUrl || !redisToken) {
      return res.status(500).json({ error: "Missing Redis credentials." })
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

    stage = "build_prompt"

    const ticker = await pickFreshTicker()
    const caption = `$${ticker}`
    const scene = buildRandomScene()
    const imagePrompt = buildImagePrompt(scene)

    if (dryRun) {
      return res.status(200).json({
        status: "ok",
        dryRun: true,
        caption,
        ticker,
        scene,
        imagePrompt,
        model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
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
      const filename = `generations/random-${Date.now()}-${ticker.toLowerCase()}.png`

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

    await rememberTicker(ticker)

    const newCount = await incrementDailyCount()

    if (imageUrl) {
      await redis.lpush(
        "mma:recent-generations",
        JSON.stringify(
          buildPublicRecord({
            tweetId: tweet?.data?.id || null,
            imageUrl,
            caption,
            scene,
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
      ticker,
      scene,
      imageUrl,
      dailyCount: newCount,
      dailyLimit,
      imageStyle: "realistic_wide_angle_character_photo",
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
