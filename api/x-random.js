const { TwitterApi } = require("twitter-api-v2")

const {
    fetchRandomWikipediaPage,
    buildPromptFromPage,
    generateImageBuffer,
    uploadImageToBlob,
    getWikipediaPageUrl,
    getWikipediaImageUrl,
    makeTicker,
    saveRecentGeneration,
    buildRecentItem,
} = require("./_ramon-shared")

function sendJson(res, status, data) {
    res.statusCode = status
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Cache-Control", "no-store")
    res.end(JSON.stringify(data, null, 2))
}

function getQuery(req) {
    const url = new URL(req.url, "https://example.com")
    return Object.fromEntries(url.searchParams.entries())
}

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)]
}

function pickMany(arr, count) {
    const copy = [...arr]
    const result = []

    while (copy.length && result.length < count) {
        const index = Math.floor(Math.random() * copy.length)
        result.push(copy.splice(index, 1)[0])
    }

    return result
}

function isAuthorized(req, query) {
    const cronSecret =
        process.env.CRON_SECRET ||
        process.env.BOT_SECRET ||
        process.env.X_BOT_SECRET

    if (!cronSecret) return true

    const supplied =
        query.secret ||
        query.cronSecret ||
        req.headers["x-cron-secret"] ||
        req.headers["authorization"]?.replace(/^Bearer\s+/i, "")

    return String(supplied || "").trim() === String(cronSecret || "").trim()
}

function getTwitterClient() {
    const appKey = process.env.X_API_KEY
    const appSecret = process.env.X_API_SECRET
    const accessToken = process.env.X_ACCESS_TOKEN
    const accessSecret = process.env.X_ACCESS_SECRET

    if (!appKey || !appSecret || !accessToken || !accessSecret) {
        throw new Error(
            "Missing X credentials. Add X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, and X_ACCESS_SECRET."
        )
    }

    return new TwitterApi({
        appKey,
        appSecret,
        accessToken,
        accessSecret,
    })
}

async function postToX({ text, imageBuffer }) {
    const client = getTwitterClient()

    const mediaId = await client.v1.uploadMedia(imageBuffer, {
        mimeType: "image/png",
    })

    const tweet = await client.v2.tweet({
        text,
        media: {
            media_ids: [mediaId],
        },
    })

    return tweet
}

function describeError(error) {
    return {
        message:
            error?.data?.detail ||
            error?.data?.error ||
            error?.response?.data?.detail ||
            error?.response?.data?.error ||
            error?.message ||
            "Unknown error",
        code: error?.code || error?.response?.status || null,
        details: error?.data || error?.response?.data || null,
    }
}

const X_PRESENTATIONS = [
    "weird live-action publicity photograph",
    "awkward paparazzi snapshot",
    "low-budget movie still",
    "public-access TV still frame",
    "red carpet photo gone wrong",
    "tabloid evidence-style photograph",
    "surreal domestic candid photo",
    "strange magazine portrait",
    "behind-the-scenes press photo",
    "airport hallway candid",
    "wax museum snapshot",
    "cheap commercial portrait",
    "documentary-style weird room photo",
]

const X_SCENES = [
    "cluttered source-specific shrine room",
    "fake movie set with visible props",
    "airport or hotel hallway filled with source-related objects",
    "public-access TV studio with strange props",
    "suburban backyard filled with bizarre source details",
    "museum display room with artifacts from the source topic",
    "press junket room with odd background objects",
    "chaotic dressing room or storage room",
    "red-carpet event space with no readable logos",
    "corporate training room themed around the source",
    "low-budget documentary reenactment scene",
    "mall portrait studio with source-related props",
]

const X_LENSES = [
    "24mm wide-angle lens with strong perspective distortion",
    "fisheye lens with warped edges and chaotic room perspective",
    "cheap disposable camera with direct flash",
    "telephoto paparazzi crop with compressed background",
    "VHS camcorder still-frame look",
    "85mm close portrait lens with shallow depth of field",
    "security-camera-style wide overhead lens",
    "low-angle sports photographer lens",
    "ultra-wide room lens showing lots of background clutter",
]

const X_LIGHTING = [
    "harsh direct flash with ugly shadows",
    "cold fluorescent hallway lighting",
    "cheap TV studio lighting",
    "flashlit nighttime scene",
    "soft awkward portrait lighting",
    "overexposed daylight",
    "single overhead bulb",
    "wax museum spotlighting",
    "murky VHS gray lighting",
    "bright commercial lighting used in a strange way",
]

const X_BACKGROUND_RULES = [
    "make the background contain multiple visible props based on concrete nouns from the Wikipedia summary",
    "make the environment feel dedicated to the Wikipedia topic rather than a random room",
    "include one oversized object based on the title or source image",
    "scatter small source-specific objects across the background",
    "turn the subject's profession, location, era, or category into set dressing",
    "make the background tell a second story about the Wikipedia page",
    "use the source image colors as hints for props and background objects",
    "make the scene look like a real photographed event, not a clean product render",
]

function buildXRandomPrompt(basePrompt, page, styleMix) {
    const title = page?.title || "Random Wikipedia Subject"
    const summary = page?.extract || ""
    const isPerson = Boolean(styleMix?.profile?.isPerson)
    const xPresentation = pick(X_PRESENTATIONS)
    const xScene = pick(X_SCENES)
    const xLens = pick(X_LENSES)
    const xLighting = pick(X_LIGHTING)
    const xRules = pickMany(X_BACKGROUND_RULES, 4)

    return `
${basePrompt}

X RANDOM EXTRA RANDOMIZATION LAYER:
This version is for an automated X post, so make it feel like a surprising real photo people would stop scrolling for.

X-specific randomized direction:
- presentation: ${xPresentation}
- scene: ${xScene}
- lens: ${xLens}
- lighting: ${xLighting}

X-specific background rules:
${xRules.map((rule) => `- ${rule}`).join("\n")}

${
    isPerson
        ? `
X person-page rule:
The Wikipedia topic is a person or public figure.
Keep the image person-first and source-inspired.
The person should loosely resemble the source photo through hairstyle, face shape, age range, posture, wardrobe vibe, and public-role cues.
Do not copy the exact face perfectly.
Do not replace the person with a random animal, toy, dog, pet, monster, or unrelated mascot.
`
        : `
X non-person rule:
Keep the main subject visibly connected to the Wikipedia topic.
Do not turn the topic into a generic toy, mascot, or unrelated creature.
`
}

Toy / wax balance:
Wax museum, mannequin, puppet, or prop-like qualities are allowed only if they fit the randomized presentation.
Do not make every image look like a toy, action figure, collectible, boxed product, doll, or toy commercial.
If toy-like language appears anywhere in the earlier prompt, reinterpret it as background props, practical effects, set dressing, or a strange real-world photographed object unless the source itself strongly supports a toy.

Final X style:
Make the final image feel candid, photographic, source-specific, weird, and different from previous generations.
The scene should have a clear subject plus a background with visible source-related objects.
Avoid plain empty backgrounds.
Avoid repeating the same face, same lens, same pose, same toy look, or same wax figure setup every time.
`.trim()
}

module.exports = async function handler(req, res) {
    const query = getQuery(req)

    if (req.method !== "GET" && req.method !== "POST") {
        return sendJson(res, 405, {
            ok: false,
            error: "Use GET or POST.",
        })
    }

    if (!isAuthorized(req, query)) {
        return sendJson(res, 401, {
            ok: false,
            error: "Unauthorized cron request.",
        })
    }

    const debug = query.debug === "1" || query.dry === "1"
    const includeImage = query.includeImage === "1"
    const requireImage = query.requireImage === "0" ? false : true

    try {
        const page = await fetchRandomWikipediaPage(requireImage)
        const wikiUrl = getWikipediaPageUrl(page)
        const wikiImageUrl = getWikipediaImageUrl(page)
        const ticker = makeTicker(page?.title)

        let { prompt, styleMix } = buildPromptFromPage(page)

        prompt = buildXRandomPrompt(prompt, page, styleMix)

        let generated
        try {
            generated = await generateImageBuffer(prompt)
        } catch (error) {
            const info = describeError(error)

            return sendJson(res, 500, {
                ok: false,
                stage: "openai_image_generation",
                error: info.message,
                errorCode: info.code,
                errorDetails: info.details,
                wikiTitle: page?.title || "",
                wikiUrl,
                ticker,
            })
        }

        let publicImageUrl = ""

        try {
            publicImageUrl = await uploadImageToBlob({
                buffer: generated.buffer,
                filename: `${ticker.replace("$", "")}.png`,
                mimeType: generated.mimeType,
            })
        } catch {
            publicImageUrl = ""
        }

        if (publicImageUrl) {
            await saveRecentGeneration(
                buildRecentItem({
                    image: publicImageUrl,
                    page,
                    prompt,
                    source: debug ? "x-random-debug" : "x-random",
                })
            )
        }

        const tweetText = `${ticker}\n${wikiUrl}`.trim()

        let tweet = null

        if (!debug) {
            try {
                tweet = await postToX({
                    text: tweetText,
                    imageBuffer: generated.buffer,
                })
            } catch (error) {
                const info = describeError(error)

                return sendJson(res, 500, {
                    ok: false,
                    stage: "x_posting",
                    error: info.message,
                    errorCode: info.code,
                    errorDetails: info.details,
                    wikiTitle: page?.title || "",
                    wikiUrl,
                    ticker,
                    tweetText,
                })
            }
        }

        return sendJson(res, 200, {
            ok: true,
            posted: !debug,
            debug,
            ticker,
            tweetText,
            tweetId: tweet?.data?.id || null,
            wikiTitle: page?.title || "",
            wikiUrl,
            wikiImageUrl,
            imageGenerated: true,
            imageUrl: publicImageUrl || null,
            model: generated.model,
            size: generated.size,
            quality: generated.quality,
            prompt,
            stylePlan: styleMix,
            image: includeImage
                ? `data:${generated.mimeType};base64,${generated.b64}`
                : undefined,
        })
    } catch (error) {
        const info = describeError(error)

        return sendJson(res, 500, {
            ok: false,
            stage: "setup_or_wikipedia",
            error: info.message,
            errorCode: info.code,
            errorDetails: info.details,
        })
    }
}
