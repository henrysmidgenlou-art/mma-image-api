const crypto = require("crypto")
const OpenAI = require("openai")
const OAuth = require("oauth-1.0a")
const { put } = require("@vercel/blob")

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1"
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini"

function getSecretFromReq(req) {
  return (
    req.query?.secret ||
    req.headers["x-bot-secret"] ||
    req.body?.secret ||
    ""
  )
}

function isDryRun(req) {
  return (
    req.query?.dryRun === "1" ||
    req.query?.dryRun === "true" ||
    req.body?.dryRun === true ||
    req.body?.dryRun === "1" ||
    req.body?.dryRun === "true"
  )
}

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(data))
}

function makeOAuth() {
  return new OAuth({
    consumer: {
      key: process.env.X_API_KEY,
      secret: process.env.X_API_SECRET,
    },
    signature_method: "HMAC-SHA1",
    hash_function(baseString, key) {
      return crypto.createHmac("sha1", key).update(baseString).digest("base64")
    },
  })
}

function getOAuthHeader(url, method, token, tokenSecret, data = undefined) {
  const oauth = makeOAuth()
  const authData = oauth.authorize(
    { url, method, data },
    { key: token, secret: tokenSecret }
  )
  return oauth.toHeader(authData).Authorization
}

function normalizeTicker(value) {
  const cleaned = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 8)

  return cleaned ? `$${cleaned}` : `$ODD`
}

async function fetchRandomWikiSummary() {
  const res = await fetch("https://en.wikipedia.org/api/rest_v1/page/random/summary", {
    headers: {
      "User-Agent": "Meme-Machine-Automata/1.0",
      Accept: "application/json",
    },
  })

  if (!res.ok) {
    throw new Error(`Wikipedia request failed: ${res.status}`)
  }

  const data = await res.json()

  return {
    title: data.title || "",
    extract: (data.extract || "").replace(/\s+/g, " ").trim().slice(0, 350),
  }
}

async function getWikipediaSourceSet(count = 5) {
  const items = []
  const seen = new Set()

  let tries = 0
  while (items.length < count && tries < count * 4) {
    tries++
    try {
      const item = await fetchRandomWikiSummary()
      const key = (item.title || "").toLowerCase()
      if (!key) continue
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    } catch (err) {
      // keep trying
    }
  }

  if (!items.length) {
    throw new Error("Could not fetch random Wikipedia source material.")
  }

  return items
}

async function buildConceptFromWikipedia(wikiItems) {
  const sourceText = wikiItems
    .map((item, i) => {
      return `${i + 1}. TITLE: ${item.title}\nSUMMARY: ${item.extract}`
    })
    .join("\n\n")

  const prompt = `
You are creating one strange AI-image concept for an autonomous image bot.

Use ONLY the random Wikipedia source material below as inspiration.
Do not use any pre-made mascot list.
Do not output multiple ideas.

Return STRICT JSON with this shape:
{
  "ticker": "ONE UPPERCASE WORD, 3 to 8 letters, letters only",
  "subject": "a short description of the main subject",
  "scene": "a short description of the scene",
  "mood": "short mood phrase",
  "visualSeed": "a concise idea summary"
}

Rules:
- ticker must be a single invented or remixed uppercase word
- no spaces in ticker
- no dollar sign in ticker
- make the concept bizarre, memorable, and surreal
- include a clear SUBJECT, not just random objects
- the subject should feel weird, unique, uncanny, and visually strong
- do not mention brands or celebrities
- do not mention finance promises
- do not include offensive, hateful, or sexual content

Wikipedia source material:
${sourceText}
`.trim()

  const response = await openai.chat.completions.create({
    model: TEXT_MODEL,
    temperature: 1.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You create surreal but coherent visual concepts and output only valid JSON.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  })

  const raw = response.choices?.[0]?.message?.content || "{}"
  let parsed

  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    parsed = {}
  }

  const ticker = normalizeTicker(parsed.ticker)
  const subject = String(parsed.subject || "a strange uncanny person-like figure").trim()
  const scene = String(parsed.scene || "an ordinary place made visually surreal").trim()
  const mood = String(parsed.mood || "uncanny deadpan surrealism").trim()
  const visualSeed = String(parsed.visualSeed || "a strange being in a real place").trim()

  return {
    ticker,
    subject,
    scene,
    mood,
    visualSeed,
    wikiItems,
  }
}

function buildImagePrompt(concept) {
  const sourceTitles = concept.wikiItems.map((x) => x.title).join(", ")

  return `
Create a completely original AI-generated image.

Core concept:
- Main subject: ${concept.subject}
- Scene: ${concept.scene}
- Mood: ${concept.mood}
- Visual seed: ${concept.visualSeed}

Inspiration background:
This concept was inspired by random Wikipedia material including: ${sourceTitles}

STYLE DIRECTION:
- Make it look like a realistic, uncanny, wide-angle photograph
- Strong sense of a real camera being used
- Wide-angle lens look, around 20mm to 24mm
- Slight perspective distortion from being close to the subject
- Realistic lighting, skin, fabric, surfaces, and environment details
- Slightly eerie / deadpan / early-AI-photo feeling
- Closer to a strange real photograph than an illustration
- Not cute, not comic-book, not cartoon, not anime
- Not glossy 3D art
- Not a UI screenshot
- Not a diagram
- Not an infographic

COMPOSITION:
- One clear central subject
- Make the subject weird, memorable, and unique
- The subject should feel like an odd character or being, not just scattered objects
- Put the subject in a believable real-world environment
- Frame it like a documentary snapshot or uncanny portrait
- Make it visually striking and internet-weird
- Photographic realism over stylization

LOOK / FEEL:
- subtle direct flash or strong practical lighting is okay
- slightly unsettling but still believable
- mundane setting + bizarre subject works well
- surreal realism
- highly detailed
- cinematic but natural
- life-like

STRICT RULES:
- no readable brand logos
- no celebrity likeness
- no political propaganda
- no gore
- no explicit sexual content
- no financial promises
- no "buy now"
- no "100x"
- no guaranteed profit language
- do not render it as a cartoon
`.trim()
}

async function generateImageBuffer(prompt) {
  const result = await openai.images.generate({
    model: IMAGE_MODEL,
    prompt,
    size: "1024x1024",
  })

  const b64 = result.data?.[0]?.b64_json
  if (!b64) {
    throw new Error("Image generation returned no base64 image.")
  }

  return Buffer.from(b64, "base64")
}

async function uploadImageToBlob(buffer, caption, prompt) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return null
  }

  const now = Date.now()
  const slug = caption.replace(/\$/g, "").toLowerCase() || "odd"

  const blob = await put(`generations/${now}-${slug}.png`, buffer, {
    access: "public",
    contentType: "image/png",
    addRandomSuffix: true,
  })

  // Optional metadata record
  try {
    await put(
      `generations/${now}-${slug}.json`,
      JSON.stringify(
        {
          caption,
          prompt,
          createdAt: new Date().toISOString(),
          source: "x-random",
        },
        null,
        2
      ),
      {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: true,
      }
    )
  } catch (err) {
    // do not fail the whole job if metadata write fails
  }

  return blob
}

async function uploadMediaToX(imageBuffer) {
  const url = "https://upload.twitter.com/1.1/media/upload.json"

  const formData = {
    media_data: imageBuffer.toString("base64"),
  }

  const body = new URLSearchParams(formData).toString()

  const authHeader = getOAuthHeader(
    url,
    "POST",
    process.env.X_ACCESS_TOKEN,
    process.env.X_ACCESS_SECRET,
    formData
  )

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  })

  const text = await res.text()
  let data = {}
  try {
    data = JSON.parse(text)
  } catch (err) {}

  if (!res.ok) {
    throw new Error(`X media upload failed (${res.status}): ${text}`)
  }

  if (!data.media_id_string) {
    throw new Error("X media upload did not return media_id_string.")
  }

  return data.media_id_string
}

async function postTweetToX(text, mediaId) {
  const url = "https://api.twitter.com/2/tweets"

  const payload = {
    text,
    media: {
      media_ids: [mediaId],
    },
  }

  const authHeader = getOAuthHeader(
    url,
    "POST",
    process.env.X_ACCESS_TOKEN,
    process.env.X_ACCESS_SECRET
  )

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const bodyText = await res.text()
  let data = {}
  try {
    data = JSON.parse(bodyText)
  } catch (err) {}

  if (!res.ok) {
    throw new Error(`X post failed (${res.status}): ${bodyText}`)
  }

  return data?.data?.id || null
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed." })
  }

  const providedSecret = getSecretFromReq(req)
  if (!process.env.BOT_SECRET || providedSecret !== process.env.BOT_SECRET) {
    return json(res, 401, { error: "Unauthorized." })
  }

  const dryRun = isDryRun(req)

  try {
    const wikiItems = await getWikipediaSourceSet(5)
    const concept = await buildConceptFromWikipedia(wikiItems)
    const caption = concept.ticker
    const imagePrompt = buildImagePrompt(concept)

    if (dryRun) {
      return json(res, 200, {
        status: "ok",
        dryRun: true,
        model: IMAGE_MODEL,
        caption,
        wikipediaTitles: wikiItems.map((x) => x.title),
        concept: {
          subject: concept.subject,
          scene: concept.scene,
          mood: concept.mood,
          visualSeed: concept.visualSeed,
        },
        imagePrompt,
      })
    }

    const imageBuffer = await generateImageBuffer(imagePrompt)
    const blob = await uploadImageToBlob(imageBuffer, caption, imagePrompt)
    const mediaId = await uploadMediaToX(imageBuffer)
    const postedTweetId = await postTweetToX(caption, mediaId)

    return json(res, 200, {
      status: "ok",
      randomMode: true,
      model: IMAGE_MODEL,
      caption,
      postedTweetId,
      imageUrl: blob?.url || null,
    })
  } catch (err) {
    console.error("x-random error:", err)

    return json(res, 500, {
      error: "X random bot failed.",
      details: err.message || "Unknown error",
    })
  }
}
