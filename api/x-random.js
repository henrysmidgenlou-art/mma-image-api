const crypto = require("crypto")
const OpenAI = require("openai")
const { TwitterApi } = require("twitter-api-v2")
const { Redis } = require("@upstash/redis")

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const redis = Redis.fromEnv()

const twitterClient = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
}).readWrite

const RANDOM_WORDS = [
  "frog", "wizard", "basement", "printer", "moon", "candle", "bagel",
  "helmet", "tunnel", "glove", "banana", "television", "eyeball", "toaster",
  "wallet", "keyboard", "satellite", "traffic cone", "elevator", "sword",
  "cloud", "vending machine", "fish tank", "office chair", "crystal", "robot",
  "spaceship", "briefcase", "lighthouse", "submarine", "microphone", "taxi",
  "shoe", "ladder", "mushroom", "mirror", "pyramid", "teleporter", "fountain",
  "goldfish", "lava lamp", "shopping cart", "mailbox", "piano", "jellyfish",
  "desert", "neon swamp", "ancient coin", "glowing cube", "tornado", "camera",
  "spiral staircase", "crown", "storm", "ice cream", "security camera",
  "server room", "typewriter", "vacuum", "red balloon", "cat statue", "orb",
  "mask", "radio", "cactus", "train", "skyscraper", "cave", "fruit bowl",
  "wire", "drone", "statue", "moon boots", "soap bubble", "circuit board",
  "dinosaur", "alarm clock", "library", "hammer", "suitcase", "bathtub",
  "portal", "pigeon", "neon sign", "paperclip", "snow globe", "lantern",
  "castle", "raincoat", "arcade machine", "telescope", "garden hose", "bell",
  "parachute", "carousel", "torch", "strawberry", "giant key", "plasma ball",
  "floating island", "glowing egg", "tape recorder", "vinyl record",
  "broken monitor", "green flame", "plastic chair", "wireframe skull",
  "shadow hand", "puddle", "giant eye", "mechanical flower", "metal bird",
  "glass house", "rubber duck", "magnet", "anchor", "maze", "spiral sun",
  "tiny door", "paper boat", "black cat", "silver apple", "cracked helmet",
  "sleeping volcano", "strange tower", "golden fish", "stone face",
  "invisible ladder", "pixel cloud", "frozen wave", "red smoke", "blue fire",
  "glowing tunnel", "clockwork moon", "hologram", "deserted mall", "rope",
  "soap cube", "marble head", "honey jar", "plastic fruit", "alarm siren",
  "bat wing", "giant spoon", "wire tree", "fog machine", "museum hallway",
  "skeleton key", "windmill", "paper mask", "sunflower", "tax form",
  "broken elevator", "sleeping robot", "singing stone", "dancing chair",
  "melting computer", "floating keyboard", "red candle", "green candle",
  "terminal screen", "data cloud", "retro monitor", "basement lab",
  "coin rain", "strange trader", "vacant office", "empty mall", "foggy hallway",
  "echo chamber", "silver frog", "giant candle", "flying wallet", "laser eye",
  "rusted machine", "crystal cave", "ghost printer", "neon hallway",
  "watchtower", "paper crown", "glass pyramid", "strange river", "heavy bag",
  "vault door", "signal tower", "wire nest", "old server", "dim attic",
  "sunken room", "mysterious hand", "bronze statue", "fluorescent tunnel",
  "sky whale", "machine room", "strange fruit", "paint bucket", "telephone pole",
  "infinite staircase", "moon window", "water cube", "night garden",
  "giant teacup", "sleeping mask", "broken arcade", "purple fog", "steel bird",
  "lost hallway", "invisible chair", "paper moon", "plastic fish",
  "retro computer", "glowing candle", "weird signal", "basement tunnel",
  "floating brick", "hollow statue", "glass apple", "metal flower"
]

function getQueryValue(value) {
  if (Array.isArray(value)) return value[0]
  return value
}

function shuffle(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function pickRandomItems(array, count) {
  return shuffle(array).slice(0, count)
}

function hashText(text) {
  return crypto.createHash("sha1").update(text).digest("hex")
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + "..."
}

function buildPrompt(words) {
  return `
Create a completely original surreal AI-generated image.

Random inspiration words:
${words.join(", ")}

Style direction:
- evoke the feeling of early AI image generation
- surreal, uncanny, imaginative, dreamlike
- visually coherent but strange
- painterly digital image, not cartoonish
- soft shading, slightly airbrushed textures
- odd combinations of objects and ideas
- minimal text
- simple, strong composition
- internet-weird but not childish
- cinematic, strange, memorable
- closer to the classic early generative image aesthetic
- not comic-book style
- not anime
- not glossy mascot art
- not a meme template
- not a UI screenshot
- not a diagram
- not an infographic

Image content:
Use several of the random inspiration words to create one single strange visual scene.
The image should feel like an unexpected artificial dream.

Rules:
- no readable brand logos
- no real celebrity likeness
- no financial promises
- no “buy now”
- no “100x”
- no guaranteed profit language
- no hate, gore, or explicit sexual content
`
    .trim()
}

function buildCaption(words) {
  const shortWords = words.slice(0, 4).join(" / ")
  return truncate(
    `M.M.A. autonomous transmission 🧠⚡️\nSignal words: ${shortWords}\nMachine-made image. No financial advice.`,
    280
  )
}

async function generateImageBuffer(prompt) {
  const result = await openai.images.generate({
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
    prompt,
    size: process.env.OPENAI_IMAGE_SIZE || "1024x1024",
  })

  const image = result?.data?.[0]

  if (!image) {
    throw new Error("No image returned from OpenAI.")
  }

  if (image.b64_json) {
    return Buffer.from(image.b64_json, "base64")
  }

  if (image.url) {
    const response = await fetch(image.url)
    if (!response.ok) {
      throw new Error(`Failed to fetch generated image URL: ${response.status}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  throw new Error("Image response did not include b64_json or url.")
}

async function getUniqueWordSet(force = false) {
  const tries = 8

  for (let i = 0; i < tries; i++) {
    const count = 10 + Math.floor(Math.random() * 3) // 10-12 words
    const words = pickRandomItems(RANDOM_WORDS, count)
    const signature = words.slice().sort().join("|")
    const signatureHash = hashText(signature)
    const dupKey = `mma:random:dup:${signatureHash}`

    if (force) {
      return { words, signature, signatureHash, dupKey }
    }

    const exists = await redis.get(dupKey)
    if (!exists) {
      return { words, signature, signatureHash, dupKey }
    }
  }

  return null
}

async function incrementDailyCount() {
  const today = new Date().toISOString().slice(0, 10)
  const dailyKey = `mma:random:count:${today}`
  const count = await redis.incr(dailyKey)
  await redis.expire(dailyKey, 60 * 60 * 24 * 3)
  return count
}

async function getDailyCount() {
  const today = new Date().toISOString().slice(0, 10)
  const dailyKey = `mma:random:count:${today}`
  const count = await redis.get(dailyKey)
  return Number(count || 0)
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" })
    }

    const dryRun = getQueryValue(req.query?.dryRun) === "1"
    const force = getQueryValue(req.query?.force) === "1"

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" })
    }

    if (!process.env.X_API_KEY || !process.env.X_API_SECRET || !process.env.X_ACCESS_TOKEN || !process.env.X_ACCESS_SECRET) {
      return res.status(500).json({ error: "Missing X API credentials" })
    }

    const dailyLimit = Number(process.env.RANDOM_DAILY_LIMIT || 8)

    if (!dryRun && !force) {
      const currentCount = await getDailyCount()
      if (currentCount >= dailyLimit) {
        return res.status(200).json({
          status: "ok",
          skipped: `Daily random post limit reached (${dailyLimit}).`,
        })
      }
    }

    const uniqueSet = await getUniqueWordSet(force)

    if (!uniqueSet) {
      return res.status(200).json({
        status: "ok",
        skipped: "Could not find a fresh random word combination.",
      })
    }

    const { words, signatureHash, dupKey } = uniqueSet
    const prompt = buildPrompt(words)
    const caption = buildCaption(words)

    if (dryRun) {
      return res.status(200).json({
        status: "ok",
        dryRun: true,
        model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
        selectedWords: words,
        caption,
        imagePrompt: prompt,
      })
    }

    const imageBuffer = await generateImageBuffer(prompt)

    const mediaId = await twitterClient.v1.uploadMedia(imageBuffer, {
      mimeType: "image/png",
    })

    const tweet = await twitterClient.v2.tweet({
      text: caption,
      media: {
        media_ids: [mediaId],
      },
    })

    await redis.set(dupKey, "1", { ex: 60 * 60 * 24 * 30 })

    const newCount = await incrementDailyCount()

    const historyItem = {
      tweetId: tweet?.data?.id || null,
      caption,
      prompt,
      selectedWords: words,
      createdAt: new Date().toISOString(),
      mode: "random",
    }

    await redis.lpush("mma:random:history", JSON.stringify(historyItem))
    await redis.ltrim("mma:random:history", 0, 49)

    return res.status(200).json({
      status: "ok",
      randomMode: true,
      postedTweetId: tweet?.data?.id || null,
      selectedWords: words,
      caption,
      dailyCount: newCount,
      dailyLimit,
      duplicateProtection: true,
    })
  } catch (error) {
    console.error("x-random error:", error)

    return res.status(500).json({
      error: "Random post bot failed.",
      details: error?.message || "Unknown error",
    })
  }
}
