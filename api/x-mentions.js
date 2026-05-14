import crypto from "crypto"
import OpenAI from "openai"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const X_API_KEY = process.env.X_API_KEY
const X_API_SECRET = process.env.X_API_SECRET
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN
const X_ACCESS_SECRET = process.env.X_ACCESS_SECRET
const X_BOT_USER_ID = process.env.X_BOT_USER_ID || ""
const X_BOT_USERNAME = (process.env.X_BOT_USERNAME || "").replace("@", "")
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

async function replyToTweet(tweetId, text, mediaId) {
  const payload = {
    text,
    reply: {
      in_reply_to_tweet_id: tweetId,
    },
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

async function readMentions(userId, sinceId) {
  const query = {
    "tweet.fields": "author_id,created_at,conversation_id",
    expansions: "author_id",
    max_results: "10",
  }

  if (sinceId) {
    query.since_id = sinceId
  }

  return await xFetch(
    "GET",
    `https://api.twitter.com/2/users/${userId}/mentions`,
    { query }
  )
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

function buildMentionImagePrompt(userPrompt) {
  return `
Create a completely original AI-generated image based on this user prompt: ${userPrompt}

Create one strong main subject or scene as the focus of the image.
Use the user prompt to determine the subject, environment, props, clothing, mood, and details.

Visual style:
- realistic photograph
- wide-angle lens look
- believable real-world lighting
- realistic skin, fabric, metal, and surface textures
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
- cinematic framing
- environmental context
- visually clear and interesting

The final image should feel like a weird but believable real photograph.

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

function extractPrompt(text) {
  if (!text) return ""

  let cleaned = text
  if (X_BOT_USERNAME) {
    const re = new RegExp(`@${X_BOT_USERNAME}`, "ig")
    cleaned = cleaned.replace(re, "")
  }

  cleaned = cleaned.replace(/\s+/g, " ").trim()
  return cleaned
}

function isLikelySpam(text) {
  if (!text) return true
  if (text.includes("http://") || text.includes("https://")) return true

  const mentionCount = (text.match(/@\w+/g) || []).length
  if (mentionCount > 2) return true

  return false
}

export default async function handler(req, res) {
  try {
    if (!checkSecret(req)) {
      return unauthorized(res)
    }

    if (!X_BOT_USER_ID) {
      return res.status(500).json({
        error: "Missing X_BOT_USER_ID env var.",
      })
    }

    const sinceKey = "mma:x-mentions:since-id"
    const processedPrefix = "mma:x-mentions:processed:"
    const sinceId = await upstashGet(sinceKey)

    const mentions = await readMentions(X_BOT_USER_ID, sinceId)
    const tweets = mentions?.data || []

    if (!tweets.length) {
      return res.status(200).json({
        status: "ok",
        message: "No new mentions found.",
        botUserId: X_BOT_USER_ID,
      })
    }

    const sorted = [...tweets].sort((a, b) => Number(a.id) - Number(b.id))
    let newestId = sorted[sorted.length - 1]?.id || sinceId

    for (const tweet of sorted) {
      const tweetId = tweet.id
      const text = tweet.text || ""

      await upstashSet(sinceKey, newestId)

      const already = await upstashGet(`${processedPrefix}${tweetId}`)
      if (already) continue

      if (isLikelySpam(text)) {
        await upstashSet(`${processedPrefix}${tweetId}`, "spam")
        continue
      }

      const userPrompt = extractPrompt(text)
      if (!userPrompt) {
        await upstashSet(`${processedPrefix}${tweetId}`, "empty")
        continue
      }

      const imagePrompt = buildMentionImagePrompt(userPrompt)
      const imageBase64 = await generateImageBase64(imagePrompt)
      const mediaId = await uploadMediaToX(imageBase64)

      const replyText = `@${(X_BOT_USERNAME || "").replace("@", "")}`.trim() || " "

      const posted = await replyToTweet(tweetId, replyText, mediaId)
      await upstashSet(`${processedPrefix}${tweetId}`, "done")

      return res.status(200).json({
        status: "ok",
        botUserId: X_BOT_USER_ID,
        tweetId,
        prompt: userPrompt,
        replied: true,
        replyTweetId: posted?.data?.id || null,
      })
    }

    return res.status(200).json({
      status: "ok",
      message: "No new valid direct mentions found.",
      botUserId: X_BOT_USER_ID,
      checked: tweets.map((t) => ({
        tweetId: t.id,
        text: t.text,
      })),
    })
  } catch (error) {
    return res.status(500).json({
      error: "X mention bot failed.",
      details: error.message || String(error),
    })
  }
}
