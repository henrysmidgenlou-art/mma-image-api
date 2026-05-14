import OpenAI from "openai"
import { TwitterApi } from "twitter-api-v2"
import { Redis } from "@upstash/redis"

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

function cleanPrompt(text, botUsername) {
  if (!text) return ""

  const escapedUsername = botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const mentionRegex = new RegExp(`@${escapedUsername}\\b`, "gi")

  return text
    .replace(mentionRegex, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
}

function countMentions(text) {
  const matches = text.match(/@\w+/g)
  return matches ? matches.length : 0
}

function hasLink(text) {
  const lower = text.toLowerCase()
  return (
    lower.includes("http://") ||
    lower.includes("https://") ||
    lower.includes("www.") ||
    lower.includes("t.co/")
  )
}

function startsWithBotMention(text, botUsername) {
  const lower = text.trim().toLowerCase()
  return lower.startsWith(`@${botUsername.toLowerCase()}`)
}

function looksLikeSpam(text) {
  const lower = text.toLowerCase()

  const spamWords = [
    "airdrop",
    "giveaway",
    "claim",
    "reward",
    "free crypto",
    "join the action",
    "click to start",
    "pump signal",
    "randomized",
    "wallet",
    "connect wallet",
    "limited time",
    "100x",
    "guaranteed",
  ]

  return spamWords.some((word) => lower.includes(word))
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

function getMentionsFromResponse(mentionTimeline) {
  return (
    mentionTimeline?.tweets ||
    mentionTimeline?.data?.data ||
    mentionTimeline?.data ||
    []
  )
}

async function markHandled(tweetId, reason) {
  const handledKey = `mma:replied:${tweetId}`

  await redis.set(handledKey, reason, {
    ex: 60 * 60 * 24 * 90,
  })
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
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Use GET instead." })
  }

  let stage = "start"

  try {
    const secret = req.query.secret

    if (!secret || secret !== process.env.BOT_SECRET) {
      return res.status(401).json({ error: "Unauthorized." })
    }

    const botUsername = process.env.X_BOT_USERNAME
    const botUserId = process.env.X_BOT_USER_ID

    if (!botUsername) {
      return res.status(500).json({
        error: "Missing X_BOT_USERNAME.",
      })
    }

    if (!botUserId) {
      return res.status(500).json({
        error: "Missing X_BOT_USER_ID.",
      })
    }

    if (!redisUrl) {
      return res.status(500).json({
        error: "Missing Redis URL.",
      })
    }

    if (!redisToken) {
      return res.status(500).json({
        error: "Missing Redis token.",
      })
    }

    stage = "read_mentions"

    const mentionTimeline = await rwClient.v2.userMentionTimeline(botUserId, {
      max_results: 10,
      "tweet.fields": ["author_id", "created_at", "conversation_id"],
    })

    const mentions = getMentionsFromResponse(mentionTimeline)

    if (!mentions.length) {
      return res.status(200).json({
        status: "ok",
        message: "No mentions found.",
        botUserId,
      })
    }

    const checked = []

    for (const tweet of mentions) {
      const tweetId = tweet.id
      const authorId = tweet.author_id
      const text = tweet.text || ""

      const handledKey = `mma:replied:${tweetId}`
      const lockKey = `mma:lock:${tweetId}`

      checked.push({
        tweetId,
        text,
      })

      stage = "check_duplicate"

      const alreadyHandled = await redis.get(handledKey)

      if (alreadyHandled) {
        continue
      }

      if (authorId === botUserId) {
        await markHandled(tweetId, "ignored_own_post")
        continue
      }

      if (!startsWithBotMention(text, botUsername)) {
        await markHandled(tweetId, "ignored_not_direct_start")
        continue
      }

      if (countMentions(text) > 2) {
        await markHandled(tweetId, "ignored_too_many_mentions")
        continue
      }

      if (hasLink(text)) {
        await markHandled(tweetId, "ignored_contains_link")
        continue
      }

      if (looksLikeSpam(text)) {
        await markHandled(tweetId, "ignored_spam_language")
        continue
      }

      const gotLock = await redis.set(lockKey, Date.now().toString(), {
        nx: true,
        ex: 600,
      })

      if (!gotLock) {
        continue
      }

      const prompt = cleanPrompt(text, botUsername)

      if (!prompt || prompt.length < 4) {
        await markHandled(tweetId, "prompt_too_short")
        await redis.del(lockKey)

        return res.status(200).json({
          status: "ok",
          skipped: "Prompt too short.",
          tweetId,
          text,
        })
      }

      if (looksUnsafe(prompt)) {
        stage = "send_safety_reply"

        await rwClient.v2.tweet({
          text: "I can’t generate that one. Try a safer prompt.",
          reply: {
            in_reply_to_tweet_id: tweetId,
          },
        })

        await markHandled(tweetId, "safety_reply_sent")
        await redis.del(lockKey)

        return res.status(200).json({
          status: "ok",
          replied: "Unsafe prompt warning sent.",
          tweetId,
        })
      }

      stage = "generate_image"

      const finalPrompt = buildImagePrompt(prompt)

      const imageResult = await openai.images.generate({
        model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
        prompt: finalPrompt,
        size: "1024x1024",
        quality: "high",
      })

      const imageBase64 = imageResult.data?.[0]?.b64_json

      if (!imageBase64) {
        await redis.del(lockKey)

        return res.status(500).json({
          error: "No image returned from OpenAI.",
          tweetId,
        })
      }

      stage = "upload_media"

      const imageBuffer = Buffer.from(imageBase64, "base64")

      const mediaId = await rwClient.v1.uploadMedia(imageBuffer, {
        mimeType: "image/png",
      })

      stage = "post_reply"

      await rwClient.v2.tweet({
        text: "Generated by Meme Machine Automata 🤖",
        reply: {
          in_reply_to_tweet_id: tweetId,
        },
        media: {
          media_ids: [mediaId],
        },
      })

      stage = "mark_replied"

      await markHandled(tweetId, "replied")
      await redis.del(lockKey)

      return res.status(200).json({
        status: "ok",
        botUserId,
        tweetId,
        prompt,
        replied: true,
        duplicateProtection: true,
        spamProtection: true,
        imageStyle: "lifelike_wide_angle_uncanny_photo",
      })
    }

    return res.status(200).json({
      status: "ok",
      message: "No new valid direct mentions found.",
      botUserId,
      checked,
    })
  } catch (error) {
    console.error("X mention bot failed:", {
      stage,
      message: error?.message,
      code: error?.code,
      data: error?.data,
    })

    return res.status(500).json({
      error: "X mention bot failed.",
      stage,
      details: error?.message || "Unknown error",
      code: error?.code || null,
      data: error?.data || null,
    })
  }
}
