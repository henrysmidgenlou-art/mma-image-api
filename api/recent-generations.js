const { getRecentGenerations } = require("./_ramon-shared")

function sendJson(res, status, data) {
    res.statusCode = status
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Cache-Control", "no-store")
    res.end(JSON.stringify(data, null, 2))
}

module.exports = async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

    if (req.method === "OPTIONS") {
        res.statusCode = 204
        return res.end()
    }

    if (req.method !== "GET") {
        return sendJson(res, 405, {
            ok: false,
            error: "Use GET.",
        })
    }

    try {
        const recent = await getRecentGenerations()

        return sendJson(res, 200, {
            ok: true,
            recent,
            generations: recent,
        })
    } catch (error) {
        return sendJson(res, 500, {
            ok: false,
            error: error?.message || "Recent generations failed.",
            recent: [],
            generations: [],
        })
    }
}
