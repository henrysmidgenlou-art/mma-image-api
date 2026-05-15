const { TwitterApi } = require("twitter-api-v2")

const {
    fetchRandomWikipediaPage,
    buildPromptFromPage,
    generateImageBuffer,
    getWikipediaPageUrl,
    getWikipediaImageUrl,
    makeTicker,
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
    const requireImage = query.requireImage === "0" ? false : true

    try {
        const page = await fetchRandomWikipediaPage(requireImage)
        const wikiUrl = getWikipediaPageUrl(page)
        const wikiImageUrl = getWikipediaImageUrl(page)
        const ticker = makeTicker(page?.title)
        const { prompt, styleMix } = buildPromptFromPage(page)

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
            model: generated.model,
            size: generated.size,
            quality: generated.quality,
            styleWorld: styleMix?.world?.name || "",
            prompt,
            image: debug
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
