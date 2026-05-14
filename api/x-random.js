import crypto from "crypto"
import OpenAI from "openai"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const X_API_KEY = process.env.X_API_KEY
const X_API_SECRET = process.env.X_API_SECRET
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN
const X_ACCESS_SECRET = process.env.X_ACCESS_SECRET
const BOT_SECRET = process.env.BOT_SECRET || process.env.SECRET || ""
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1"

const UPSTASH_URL =
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  ""
const UPSTASH_TOKEN =
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  ""

function unauthorized(res) {
  return res.status(401).json({ error: "Unauthorized." })
}

function checkSecret(req) {
  const incoming =
    req.query.secret ||
    req.headers["x-bot-secret"] ||
    req.headers["x-secret"] ||
    ""
  return BOT_SECRET && incoming === BOT_SECRET
}

function percentEncode(str = "") {
  return encodeURIComponent(str)
    .replace(/[!*()']/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
}

function buildQueryString(params = {}) {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  )
  if (!entries.length) return ""
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}=${percentEncode(String(v))}`)
    .join("&")
}

function buildOAuthHeader(method, url, queryParams = {}, bodyParams = {}) {
  const oauth = {
    oauth_consumer_key: X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: "1.0",
  }

  const allParams = {
    ...queryParams,
    ...bodyParams,
    ...oauth,
  }

  const parameterString = Object.keys(allParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(String(allParams[key]))}`)
    .join("&")

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(parameterString),
  ].join("&")

  const signingKey = `${percentEncode(X_API_SECRET)}&${percentEncode(
    X_ACCESS_SECRET
  )}`

  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64")

  oauth.oauth_signature = signature

  const header =
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((key) => `${percentEncode(key)}="${percentEncode(oauth[key])}"`)
      .join(", ")

  return header
}

async function xFetch(method, url, { query = {}, form = null, json = null } = {}) {
  const qs = buildQueryString(query)
  const fullUrl = qs ? `${url}?${qs}` : url

  let headers = {}
  let body

  if (form) {
    headers["Authorization"] = buildOAuthHeader(method, url, query, form)
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    body = new URLSearchParams(form).toString()
  } else {
    headers["Authorization"] = buildOAuthHeader(method, url, query, {})
    if (json) {
      headers["Content-Type"] = "application/json"
      body = JSON.stringify(json)
    }
  }

  const resp = await fetch(fullUrl, {
    method,
    headers,
    body,
  })

  const text = await resp.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }

  if (!resp.ok) {
    throw new Error(
      `X request failed (${resp.status}): ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`
    )
  }

  return data
}

async function uploadMediaToX(base64Image) {
  const data = await xFetch("POST", "https://upload.twitter.com/1.1/media/upload.json", {
    form: {
      media_data: base64Image,
    },
  })

  if (!data.media_id_string) {
    throw new Error("X media upload failed.")
  }

  return data.media_id_string
}

async function createTweet(statusText, mediaId) {
  const payload = {
    text: statusText,
  }

  if (mediaId) {
    payload.media = {
      media_ids: [mediaId],
    }
  }

  const data = await xFetch("POST", "https://api.twitter.com/2/tweets", {
    json: payload,
  })

  return data
}

async function upstashGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null
  const resp = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
    },
  })
  if (!resp.ok) return null
  const data = await resp.json()
  return data?.result ?? null
}

async function upstashSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null
  await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
    },
  })
}

function slugifyWord(s = "") {
  return s
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

async function getRandomWikipediaConcepts(count = 8) {
  const concepts = []
  const seen = new Set()

  for (let i = 0; i < count * 2 && concepts.length < count; i++) {
    try {
      const resp = await fetch(
        "https://en.wikipedia.org/api/rest_v1/page/random/summary",
        { headers: { Accept: "application/json" } }
      )
      const data = await resp.json()

      const raw = slugifyWord(data?.title || "")
      if (!raw) continue

      const cleaned = raw
        .split(/\s+/)
        .slice(0, 4)
        .join(" ")
        .trim()

      if (!cleaned) continue
      const key = cleaned.toLowerCase()
      if (seen.has(key)) continue

      seen.add(key)
      concepts.push(cleaned)
    } catch (e) {
      // ignore and continue
    }
  }

  if (!concepts.length) {
    return [
      "signal tower",
      "moon corridor",
      "glass orchard",
      "storm archive",
      "echo engine",
      "sleep museum",
      "dust palace",
      "mirror train",
    ]
  }

  return concepts
}

function buildRandomImagePrompt(concepts) {
  return `
Create a completely original AI-generated image inspired by these Wikipedia-derived concepts: ${concepts.join(
    ", "
  )}.

Create one strange, unique main subject as the focus of the image.
The main subject can be a person, creature, figure, or unusual character shaped by the concepts above.
The surrounding environment, props, clothing, and mood should also be influenced by the concepts.

Visual style:
- realistic photograph
- wide-angle lens look
- believable real-world lighting
- realistic skin, fabric, metal, and surface textures
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
- one strong main subject
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
`.trim()
}

async function generateImageBase64(prompt) {
  const result = await openai.images.generate({
    model: OPENAI_IMAGE_MODEL,
    prompt,
    size: "1024x1024",
  })

  const b64 = result?.data?.[0]?.b64_json
  if (!b64) {
    throw new Error("No image returned from OpenAI.")
  }
  return b64
}

function pickTickerFromConcepts(concepts) {
  const joined = concepts.join(" ")
  const words = joined
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, "").toUpperCase())
    .filter((w) => w.length >= 3 && w.length <= 6)

  if (!words.length) return "MMA"

  const pick = words[Math.floor(Math.random() * words.length)]
  return pick
}

function buildCaption(ticker) {
  return `$${ticker}`
}

export default async function handler(req, res) {
  try {
    if (!checkSecret(req)) {
      return unauthorized(res)
    }

    const dryRun =
      req.query.dryRun === "1" ||
      req.query.dryRun === "true" ||
      req.query.test === "1"

    const lockKey = "mma:x-random:last-run"
    const now = Date.now()
    const lastRun = Number((await upstashGet(lockKey)) || 0)

    if (!dryRun && lastRun && now - lastRun < 1000 * 60 * 10) {
      return res.status(200).json({
        status: "ok",
        skipped: "Recently ran already.",
      })
    }

    const concepts = await getRandomWikipediaConcepts(8)
    const prompt = buildRandomImagePrompt(concepts)
    const ticker = pickTickerFromConcepts(concepts)
    const caption = buildCaption(ticker)

    if (dryRun) {
      return res.status(200).json({
        status: "ok",
        dryRun: true,
        model: OPENAI_IMAGE_MODEL,
        selectedWords: concepts,
        caption,
        imagePrompt: prompt,
      })
    }

    const imageBase64 = await generateImageBase64(prompt)
    const mediaId = await uploadMediaToX(imageBase64)
    const tweet = await createTweet(caption, mediaId)

    await upstashSet(lockKey, String(now))

    return res.status(200).json({
      status: "ok",
      posted: true,
      model: OPENAI_IMAGE_MODEL,
      caption,
      concepts,
      tweetId: tweet?.data?.id || null,
    })
  } catch (error) {
    return res.status(500).json({
      error: "x-random failed.",
      details: error.message || String(error),
    })
  }
}
