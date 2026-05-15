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

module.exports = async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

    if (req.method === "OPTIONS") {
        res.statusCode = 204
        return res.end()
    }

    if (req.method !== "GET" && req.method !== "POST") {
        return sendJson(res, 405, {
            ok: false,
            error: "Use GET or POST.",
        })
    }

    const query = getQuery(req)
    const requireImage = query.requireImage === "0" ? false : true
    const includeImage = query.includeImage === "1"

    try {
        const page = await fetchRandomWikipediaPage(requireImage)
        const wikiUrl = getWikipediaPageUrl(page)
        const wikiImageUrl = getWikipediaImageUrl(page)
        const ticker = makeTicker(page?.title)
        const { prompt, styleMix } = buildPromptFromPage(page)

        const generated = await generateImageBuffer(prompt)

        let imageUrl = ""

        try {
            imageUrl = await uploadImageToBlob({
                buffer: generated.buffer,
                filename: `${ticker.replace("$", "")}.png`,
                mimeType: generated.mimeType,
            })
        } catch {
            imageUrl = ""
        }

        const imageDataUrl = `data:${generated.mimeType};base64,${generated.b64}`
        const finalImage = imageUrl || imageDataUrl

        await saveRecentGeneration(
            buildRecentItem({
                image: finalImage,
                page,
                prompt,
                source: "random-generate",
            })
        )

        return sendJson(res, 200, {
            ok: true,
            ticker,
            wikiTitle: page?.title || "",
            wikiUrl,
            wikiImageUrl,
            image: finalImage,
            imageUrl: finalImage,
            url: finalImage,
            imageGenerated: true,
            model: generated.model,
            size: generated.size,
            quality: generated.quality,
            styleWorld: styleMix?.world?.name || "",
            prompt,
            base64: includeImage ? imageDataUrl : undefined,
        })
    } catch (error) {
        return sendJson(res, 500, {
            ok: false,
            error: error?.message || "Random generate failed.",
        })
    }
}
