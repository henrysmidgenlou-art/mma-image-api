const {
    fetchWikipediaPageFromUrl,
    buildPromptFromPage,
    generateImageBuffer,
    getWikipediaPageUrl,
    getWikipediaImageUrl,
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
        let finalPrompt = body.prompt || ""

        if (body.wikiUrl) {
            page = await fetchWikipediaPageFromUrl(body.wikiUrl)

            if (!finalPrompt) {
                const built = buildPromptFromPage(page)
                finalPrompt = built.prompt
            }
        }

        if (!finalPrompt.trim()) {
            return sendJson(res, 400, {
                ok: false,
                error: "Missing prompt.",
            })
        }

        const generated = await generateImageBuffer(finalPrompt)

        const imageDataUrl = `data:${generated.mimeType};base64,${generated.b64}`

        return sendJson(res, 200, {
            ok: true,
            image: imageDataUrl,
            imageUrl: imageDataUrl,
            url: imageDataUrl,
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
