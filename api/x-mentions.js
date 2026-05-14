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
      max_results: 5,
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

      checked.push({
        tweetId,
        text,
      })

      if (authorId === botUserId) {
        continue
      }

      if (!text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) {
        continue
      }

      const repliedKey = `mma:replied:${tweetId}`
      const lockKey = `mma:lock:${tweetId}`

      stage = "check_duplicate"

      const alreadyReplied = await redis.get(repliedKey)

      if (alreadyReplied) {
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
        await redis.set(repliedKey, "prompt_too_short", {
          ex: 60 * 60 * 24 * 30,
        })

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

        await redis.set(repliedKey, "safety_reply_sent", {
          ex: 60 * 60 * 24 * 90,
        })

        await redis.del(lockKey)

        return res.status(200).json({
          status: "ok",
          replied: "Unsafe prompt warning sent.",
          tweetId,
        })
      }

      stage = "generate_image"

      const finalPrompt = `
Create a funny AI-generated meme image.

User request:
${prompt}

Style:
- funny internet meme
- crypto trader / memecoin vibe
- exaggerated cartoon expression
- clean composition
- visually bold and funny
- no hate, harassment, adult content, or graphic violence
- no financial promises
- no real celebrity likeness
- leave room for meme-like composition if helpful
`

      const imageResult = await openai.images.generate({
        model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini",
        prompt: finalPrompt,
        size: "1024x1024",
        quality: "low",
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

      await redis.set(repliedKey, "replied", {
        ex: 60 * 60 * 24 * 90,
      })

      await redis.del(lockKey)

      return res.status(200).json({
        status: "ok",
        botUserId,
        tweetId,
        prompt,
        replied: true,
        duplicateProtection: true,
      })
    }

    return res.status(200).json({
      status: "ok",
      message: "No new unprocessed direct mentions found.",
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
