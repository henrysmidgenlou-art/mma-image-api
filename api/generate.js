const {
    fetchWikipediaPageFromUrl,
    buildPromptFromPage,
    generateImageBuffer,
    uploadImageToBlob,
    getWikipediaPageUrl,
    getWikipediaImageUrl,
    saveRecentGeneration,
    buildRecentItem,
} = require("./_ramon-shared")

function sendJson(res, status, data) {
    res.statusCode = status
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Cache-Control", "no-store")
    res.end(JSON.stringify(data))
}

async function readBody(req) {
    if (req.body) return req.body

    return await new Promise((resolve, reject) => {
        let data = ""

        req.on("data", (chunk) => {
            data += chunk
        })

        req.on("end", () => {
            try {
                resolve(data ? JSON.parse(data) : {})
            } catch (error) {
                reject(error)
            }
        })

        req.on("error", reject)
    })
}

module.exports = async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

    if (req.method === "OPTIONS") {
        res.statusCode = 204
        return res.end()
    }

    if (req.method !== "POST") {
        return sendJson(res, 405, {
            ok: false,
            error: "Use POST.",
        })
    }

    try {
        const body = await readBody(req)

        let page = null
        let finalPrompt = String(body.prompt || "").trim()

        if (body.wikiUrl && !finalPrompt) {
            page = await fetchWikipediaPageFromUrl(body.wikiUrl)
            const built = buildPromptFromPage(page)
            finalPrompt = built.prompt
        }

        if (!finalPrompt) {
            return sendJson(res, 400, {
                ok: false,
                error: "Missing prompt.",
            })
        }

        const generated = await generateImageBuffer(finalPrompt)

        let imageUrl = ""

        try {
            imageUrl = await uploadImageToBlob({
                buffer: generated.buffer,
                filename: "ramon-generation.png",
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
                prompt: finalPrompt,
                source: "generate",
            })
        )

        return sendJson(res, 200, {
            ok: true,
            image: finalImage,
            imageUrl: finalImage,
            url: finalImage,
            prompt: finalPrompt,
            wikiTitle: page?.title || body.wikiTitle || "",
            wikiUrl: page ? getWikipediaPageUrl(page) : body.wikiUrl || "",
            wikiImageUrl: page
                ? getWikipediaImageUrl(page)
                : body.wikiImageUrl || "",
            model: generated.model,
            size: generated.size,
            quality: generated.quality,
        })
    } catch (error) {
        return sendJson(res, 500, {
            ok: false,
            error: error?.message || "Generate failed.",
        })
    }
}
