const OpenAIModule = require("openai")
const OpenAI = OpenAIModule.default || OpenAIModule

const DEFAULT_IMAGE_MODEL = "gpt-image-1"
const DEFAULT_IMAGE_SIZE = "1536x1024"
const DEFAULT_IMAGE_QUALITY = "medium"
const RECENT_KEY = "ramon:recent-generations"

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

function safeText(value) {
    return String(value || "").toLowerCase()
}

function getWikipediaImageUrl(page) {
    return page?.originalimage?.source || page?.thumbnail?.source || ""
}

function getWikipediaPageUrl(page) {
    return (
        page?.content_urls?.desktop?.page ||
        page?.content_urls?.mobile?.page ||
        page?.url ||
        ""
    )
}

function cleanWikiTitleFromUrl(url) {
    try {
        const parsed = new URL(url)
        const parts = parsed.pathname.split("/wiki/")
        if (!parts[1]) return ""
        return decodeURIComponent(parts[1]).replaceAll("_", " ")
    } catch {
        return ""
    }
}

function makeTicker(title) {
    let clean = String(title || "MEME")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toUpperCase()

    if (!clean) clean = "MEME"
    if (/^\d/.test(clean)) clean = `M${clean}`

    return `$${clean.slice(0, 8)}`
}

function inferWikiProfile(page) {
    const title = safeText(page?.title)
    const summary = safeText(page?.extract)
    const description = safeText(page?.description)
    const full = `${title} ${description} ${summary}`

    const hasAny = (words) => words.some((word) => full.includes(word))

    return {
        isPerson: hasAny([
            "born",
            "actor",
            "actress",
            "politician",
            "writer",
            "singer",
            "musician",
            "footballer",
            "artist",
            "philosopher",
            "scientist",
            "comedian",
            "businessman",
            "businesswoman",
            "person",
            "human",
            "president",
            "king",
            "queen",
        ]),
        isAnimal: hasAny([
            "animal",
            "mammal",
            "bird",
            "fish",
            "species",
            "reptile",
            "amphibian",
            "insect",
            "dog",
            "cat",
            "whale",
            "shark",
            "frog",
            "monkey",
            "dinosaur",
            "eel",
        ]),
        isPlace: hasAny([
            "city",
            "town",
            "village",
            "country",
            "mountain",
            "river",
            "lake",
            "island",
            "building",
            "bridge",
            "park",
            "museum",
            "stadium",
            "temple",
        ]),
        isObject: hasAny([
            "device",
            "machine",
            "tool",
            "artifact",
            "instrument",
            "weapon",
            "vehicle",
            "computer",
            "camera",
            "engine",
            "product",
            "toy",
            "telephone",
            "ship",
            "aircraft",
        ]),
        isScience: hasAny([
            "chemical",
            "physics",
            "mathematics",
            "astronomy",
            "biology",
            "medical",
            "disease",
            "syndrome",
            "theory",
            "equation",
            "planet",
            "galaxy",
            "specimen",
        ]),
        isDomestic: hasAny([
            "house",
            "home",
            "family",
            "kitchen",
            "bathroom",
            "bedroom",
            "school",
            "child",
            "food",
            "restaurant",
            "pet",
        ]),
        isFunnyOrAbsurd: hasAny([
            "novelty",
            "cartoon",
            "comedy",
            "mascot",
            "toy",
            "children",
            "myth",
            "folklore",
            "legend",
            "parody",
            "odd",
            "unusual",
            "strange",
        ]),
    }
}

const STYLE_WORLDS = [
    {
        name: "Weird Family Snapshot",
        description:
            "a surreal family snapshot, awkward but sincere, physically real, strange expressions, mundane setting turned bizarre",
    },
    {
        name: "Low-Budget Sci-Fi Still",
        description:
            "a cheap but memorable science-fiction movie still, practical effects, theatrical set design, cinematic but awkward",
    },
    {
        name: "Bright Absurd Commercial",
        description:
            "a brightly lit, silly, colorful commercial-style photo, playful and bizarre, exaggerated but still photographic",
    },
    {
        name: "Mall Portrait Studio",
        description:
            "a stiff portrait-studio photo with fake backdrop, awkward pose, over-serious expression, uncanny normality",
    },
    {
        name: "Tabloid Shock Photo",
        description:
            "a sensational, bizarre tabloid-style image, direct flash, caught-at-the-wrong-moment energy, strange but believable",
    },
    {
        name: "Public Access TV Still",
        description:
            "a weird local-TV still frame, harsh studio lighting, strange set, awkward host or guest energy",
    },
    {
        name: "Museum Archive Documentation",
        description:
            "a deadpan archive or specimen photo, subject presented clearly like an unexplained artifact or preserved thing",
    },
    {
        name: "Toy / Catalog Photo",
        description:
            "a strange product-catalog or toy-ad style photograph, colorful, clean, playful, but clearly weird",
    },
    {
        name: "Field Guide Discovery",
        description:
            "a wildlife or scientific field-guide photo, curious, clear, strange, as if documenting something impossible",
    },
    {
        name: "Corporate Training Video Still",
        description:
            "a cursed office-training still, beige realism, serious instructional pose, deeply awkward human energy",
    },
    {
        name: "Surreal Domestic Photo",
        description:
            "a bizarre image inside a familiar home environment, domestic and ordinary but transformed into something absurd",
    },
    {
        name: "Heroic Giant Perspective",
        description:
            "a dramatic low-angle photo that makes the subject seem oversized, absurdly important, or comically monumental",
    },
    {
        name: "Cursed Internet Meme Photo",
        description:
            "a low-resolution viral-looking image, funny and unsettling, awkward flash, strange facial proportions, meme-like realism",
    },
    {
        name: "Aquarium Bathroom Diorama",
        description:
            "a surreal bathroom or aquarium-like set, wet blue lighting, coral textures, porcelain objects, absurd creature placement",
    },
    {
        name: "1970s Epoxy Puppet Portrait",
        description:
            "a glossy synthetic puppet-like portrait, epoxy acrylic skin, rounded features, strange glassy eyes, theatrical 1970s lighting",
    },
]

const CAMERA_ANGLES = [
    "extreme low angle looking upward, making the subject feel giant and ridiculous",
    "high angle looking down from above, making the subject look trapped or pathetic",
    "tight close-up with the face filling the frame",
    "wide-angle full-body shot with exaggerated perspective",
    "awkward off-center snapshot framing like the photographer reacted too late",
    "front-facing deadpan portrait framing",
    "fisheye-like near-camera distortion",
    "very close low-angle portrait with enlarged hands or features",
    "medium shot with too much empty space around the subject",
    "point-of-view angle as if the camera stumbled into the scene",
    "doorway or hallway angle, peeking into the situation",
    "floor-level shot looking slightly upward",
    "surveillance-like overhead angle",
    "backlit silhouette shot with the subject mostly in shadow",
    "heroic promotional angle like a sports poster gone wrong",
    "awkward posed school-photo angle",
    "slightly tilted dutch-angle composition",
    "macro-close detail shot of a weird object or facial feature",
    "wide lens inches from the subject, making the nose, hands, or mouth look too large",
    "straight-on school portrait composition with a blank unnatural stare",
    "low camera near the ground with the subject looming overhead",
    "close flash snapshot with harsh shadows on the wall behind",
    "long hallway perspective with the subject staring from the end",
    "square cropped internet image framing with too much face and not enough context",
]

const LIGHTING_STYLES = [
    "harsh direct flash with deep ugly shadows",
    "soft overcast daylight with a strange calm mood",
    "bright cheerful commercial lighting with punchy highlights",
    "cold fluorescent lighting like a school hallway or office",
    "greenish institutional lighting",
    "warm suburban daylight with nostalgic colors",
    "moody single overhead bulb",
    "backlit glowing silhouette lighting",
    "stage-like spotlight on the subject",
    "low-budget TV studio lighting",
    "overexposed daylight with blown-out highlights",
    "golden-hour sunlight that makes the absurd subject look beautiful",
    "aquarium-blue artificial light",
    "flashlit nighttime scene with dark background",
    "soft portrait-studio lighting with unsettling stillness",
    "high-contrast theatrical lighting",
    "flat catalog lighting meant to show everything clearly",
    "bright blue sky outdoor lighting with oversized heroic perspective",
    "bathroom mirror lighting with porcelain reflections",
    "murky VHS lighting with gray shadows",
    "sickly green sci-fi glow from below",
    "toy-commercial studio lighting with glossy highlights",
    "cheap webcam-like room lighting with low-resolution softness",
]

const COLOR_MOODS = [
    "bright toy-commercial colors",
    "washed-out 1990s photo-lab colors",
    "sickly green color cast",
    "sunny suburban summer colors",
    "cold blue-gray tones",
    "warm orange nostalgic tones",
    "surreal candy-color palette",
    "faded analog-film colors",
    "high-contrast black background with vivid subject color",
    "clean product-photo whites and bold accent colors",
    "cheap VHS-video color response",
    "pale pastel portrait colors",
    "hyper-bright blue sky and clean beige clothing tones",
    "glossy green sci-fi helmet colors",
    "aquarium blues, coral pinks, and toilet porcelain whites",
    "low-res internet browns and muddy indoor shadows",
    "soft suburban brick-wall reds and corn-yellow highlights",
    "oversaturated meme-image colors with awkward compression",
]

const SILLY_WEIRD_TRAITS = [
    "give the subject oversized eyes or a blank, stunned stare",
    "make the proportions awkward in a funny but believable way",
    "make the hands, head, or mouth slightly too large",
    "make the expression intensely serious even if the situation is ridiculous",
    "make the image feel silly, absurd, and unintentionally hilarious",
    "create the feeling of a cursed but memorable internet image",
    "make the scene strangely wholesome and unsettling at the same time",
    "add visual logic that feels dreamlike but still photographic",
    "make the subject look like a real practical prop, mascot, costume, or malformed product",
    "make the pose awkward and specific rather than generic",
    "make the image feel like a forgotten meme from another universe",
    "make the weirdness playful rather than scary",
    "use a strange wide-eyed stare, tiny mouth, or oddly smooth face",
    "make the subject appear caught in a ridiculous private moment",
    "give it the energy of an old viral image people would repost for years",
    "make it funny first, creepy second",
    "add an absurd food, bathroom, toy, pet, or office connection only if it fits the Wikipedia topic",
]

const MATERIALS = [
    "rubber, latex, foam, vinyl, and glossy plastic",
    "cheap fabric, cardboard, painted wood, and amateur craft materials",
    "toy-like molded plastic and bright painted surfaces",
    "fuzzy costume textures, fake fur, and handmade seams",
    "smooth product-plastic surfaces and soft reflections",
    "ceramic, porcelain, and polished household textures",
    "beige office materials, laminate, fake leather, and fluorescent reflections",
    "wet shiny surfaces, aquarium textures, and smooth odd skin",
    "epoxy acrylic, glassy eyes, shiny green helmet plastic, synthetic skin",
    "low-resolution compressed textures, weird skin smoothing, meme artifacting",
    "oversized food texture, kernels, soft flesh tones, and brick-wall background",
    "coral reef textures, toilet porcelain, blue water light, rubber creature skin",
]

const EXPRESSIONS = [
    "wide-eyed amazement",
    "deadpan emotional emptiness",
    "awkward forced smile",
    "childlike wonder",
    "caught-in-the-act panic",
    "vacant public-access-TV stare",
    "serious documentary expression",
    "disturbingly cheerful grin",
    "blank mascot expression",
    "confused human discomfort",
    "startled dog-like joy",
    "smooth tiny-faced grin",
    "terrified hallway stare",
    "glazed puppet expression",
    "too-proud heroic smile",
]

const COMPOSITION_GAGS = [
    "place the subject too close to the camera",
    "make one body part appear huge because of lens distortion",
    "use too much empty space for awkward comedy",
    "frame the subject as if it is way more important than it should be",
    "present the subject with absurd dignity",
    "treat the bizarre subject like it belongs in a completely normal photo",
    "contrast a silly subject with a serious composition",
    "make the image feel like an accidental masterpiece",
    "pose the subject in front of a plain wall as if nothing is wrong",
    "make the camera angle make the subject look unexpectedly monumental",
    "stage it like a product demonstration gone wrong",
    "place a bizarre subject in a bathroom, hallway, backyard, or office without explanation",
]

const BRIGHT_FUN_ENHANCERS = [
    "lean into bright, cheerful colors when appropriate",
    "allow playful, silly energy instead of always eerie energy",
    "favor bold visual contrast and memorable shapes",
    "make the image visually loud if the subject allows it",
    "let the humor come from the photo feeling real",
    "make it feel like a viral image people cannot stop staring at",
    "make it look funnier, brighter, and more specific than a generic horror image",
    "let the absurdity be instantly readable even before someone knows the Wikipedia source",
]

function chooseWeighted(options, extra = []) {
    const pool = [...options, ...extra].filter(Boolean)
    return pick(pool)
}

function buildStyleMix(page) {
    const profile = inferWikiProfile(page)

    const styleWorldExtras = []
    const angleExtras = []
    const lightingExtras = []
    const colorExtras = []
    const sillyExtras = []
    const materialExtras = []

    if (profile.isPerson) {
        styleWorldExtras.push(
            STYLE_WORLDS.find((x) => x.name === "Mall Portrait Studio"),
            STYLE_WORLDS.find((x) => x.name === "Tabloid Shock Photo"),
            STYLE_WORLDS.find((x) => x.name === "Heroic Giant Perspective"),
            STYLE_WORLDS.find((x) => x.name === "Cursed Internet Meme Photo")
        )
        angleExtras.push(
            "extreme low-angle portrait making the person seem absurdly powerful",
            "tight face close-up with unsettling human detail",
            "wide lens close-up where the face and hands become too large"
        )
    }

    if (profile.isAnimal) {
        styleWorldExtras.push(
            STYLE_WORLDS.find((x) => x.name === "Field Guide Discovery"),
            STYLE_WORLDS.find((x) => x.name === "Surreal Domestic Photo"),
            STYLE_WORLDS.find((x) => x.name === "Aquarium Bathroom Diorama"),
            STYLE_WORLDS.find((x) => x.name === "Cursed Internet Meme Photo")
        )
        lightingExtras.push(
            "wildlife-documentation lighting",
            "bright daylight as if caught in nature or a backyard",
            "aquarium-blue artificial light"
        )
        sillyExtras.push(
            "make the creature appear oddly human in posture or expression",
            "make the animal look like it accidentally became a meme"
        )
    }

    if (profile.isObject) {
        styleWorldExtras.push(
            STYLE_WORLDS.find((x) => x.name === "Toy / Catalog Photo"),
            STYLE_WORLDS.find((x) => x.name === "Museum Archive Documentation"),
            STYLE_WORLDS.find((x) => x.name === "Bright Absurd Commercial")
        )
        materialExtras.push(
            "hard glossy product surfaces and packaging-like realism",
            "toy plastic, molded seams, bright paint, and catalog reflections"
        )
    }

    if (profile.isPlace) {
        styleWorldExtras.push(
            STYLE_WORLDS.find((x) => x.name === "Heroic Giant Perspective"),
            STYLE_WORLDS.find((x) => x.name === "Bright Absurd Commercial"),
            STYLE_WORLDS.find((x) => x.name === "Surreal Domestic Photo")
        )
        angleExtras.push(
            "dramatic perspective that exaggerates scale and makes architecture feel absurd"
        )
    }

    if (profile.isScience) {
        styleWorldExtras.push(
            STYLE_WORLDS.find((x) => x.name === "Museum Archive Documentation"),
            STYLE_WORLDS.find((x) => x.name === "Field Guide Discovery"),
            STYLE_WORLDS.find((x) => x.name === "Low-Budget Sci-Fi Still"),
            STYLE_WORLDS.find((x) => x.name === "1970s Epoxy Puppet Portrait")
        )
    }

    if (profile.isDomestic) {
        styleWorldExtras.push(
            STYLE_WORLDS.find((x) => x.name === "Weird Family Snapshot"),
            STYLE_WORLDS.find((x) => x.name === "Surreal Domestic Photo"),
            STYLE_WORLDS.find((x) => x.name === "Cursed Internet Meme Photo")
        )
        lightingExtras.push(
            "warm indoor household lighting",
            "flashlit living-room snapshot lighting"
        )
    }

    if (profile.isFunnyOrAbsurd) {
        colorExtras.push(
            "ultra-bright playful colors",
            "ridiculous but lovable color combinations",
            "oversaturated meme-image colors with awkward compression"
        )
        sillyExtras.push(
            "make it extra silly and meme-like",
            "lean into ridiculous humor while keeping it photographic"
        )
    }

    return {
        world: chooseWeighted(STYLE_WORLDS, styleWorldExtras),
        cameraAngle: chooseWeighted(CAMERA_ANGLES, angleExtras),
        lighting: chooseWeighted(LIGHTING_STYLES, lightingExtras),
        colorMood: chooseWeighted(COLOR_MOODS, colorExtras),
        silly1: chooseWeighted(SILLY_WEIRD_TRAITS, sillyExtras),
        silly2: pick(SILLY_WEIRD_TRAITS),
        silly3: pick(SILLY_WEIRD_TRAITS),
        materials: chooseWeighted(MATERIALS, materialExtras),
        expression: pick(EXPRESSIONS),
        composition: pick(COMPOSITION_GAGS),
        brightFun: pick(BRIGHT_FUN_ENHANCERS),
    }
}

function buildWeirdWikiPrompt(page, styleMix) {
    const title = page?.title || "Random Wikipedia Subject"
    const summary = page?.extract || ""
    const wikiImageUrl = getWikipediaImageUrl(page)

    return `
Create ONE single standalone weird photograph inspired by this Wikipedia subject.

Wikipedia topic:
${title}

Wikipedia summary:
${summary}

Wikipedia image source:
${wikiImageUrl || "No image available"}

Use the Wikipedia topic, the text information, and the source image as inspiration.
The final image should feel strongly shaped by what the subject actually is.
If the topic is a person, lean into portrait, documentary, meme-photo, or absurd heroic perspective logic.
If the topic is an animal, object, place, scientific topic, domestic subject, or event, let that change the entire structure of the image.
Do not use one generic creature formula every time.

Visual world:
${styleMix.world.name}
${styleMix.world.description}

Camera angle:
${styleMix.cameraAngle}

Lighting:
${styleMix.lighting}

Color mood:
${styleMix.colorMood}

Expression or emotional tone:
${styleMix.expression}

Composition idea:
${styleMix.composition}

Materials / texture:
${styleMix.materials}

Weirdness directions:
${styleMix.silly1}
${styleMix.silly2}
${styleMix.silly3}

Extra energy:
${styleMix.brightFun}

Important style direction based on the established look:
Use a broad range that can include:
- bright surreal commercial photography
- awkward family snapshots
- low-angle giant-perspective portraits
- fish-eye or close-lens distortion
- bizarre but funny human expressions
- domestic absurdity
- strange meme-like realism
- practical effects and odd mascot-like forms
- glossy epoxy or acrylic puppet-like faces
- oversized hands, heads, eyes, mouths, or food objects when appropriate
- aquarium bathroom surrealism when appropriate
- playful, bright, visually memorable weirdness
- uncanny but sometimes silly rather than always creepy

Make it look like a photographed image, not a polished digital illustration.
It can be bright, funny, awkward, surreal, or slightly disturbing depending on the topic.
Let the Wikipedia subject determine which direction makes the most sense.
The image should feel like it could become a strange viral meme.

If the topic is a real person, do not recreate their exact likeness.
Instead make a fictionalized or transformed version inspired by the subject.

Hard rules:
One single image only.
No collage.
No split panels.
No readable text.
No watermark.
No logos.
No gore.
No graphic injury.
No explicit violence.
`.trim()
}

async function fetchRandomWikipediaPage(requireImage = true) {
    let lastPage = null

    for (let i = 0; i < 12; i++) {
        const response = await fetch(
            "https://en.wikipedia.org/api/rest_v1/page/random/summary"
        )

        if (!response.ok) {
            throw new Error(`Wikipedia failed: ${response.status}`)
        }

        const page = await response.json()
        lastPage = page

        const hasTitle = page?.title && !page.title.includes(":")
        const hasSummary = page?.extract && page.extract.length > 80
        const notDisambiguation = page?.type !== "disambiguation"
        const hasImage = Boolean(getWikipediaImageUrl(page))

        if (hasTitle && hasSummary && notDisambiguation) {
            if (!requireImage || hasImage) return page
        }
    }

    return lastPage
}

async function fetchWikipediaPageFromUrl(url) {
    const title = cleanWikiTitleFromUrl(url)

    if (!title) {
        throw new Error("Could not read the Wikipedia title from that URL.")
    }

    const encodedTitle = encodeURIComponent(title.replaceAll(" ", "_"))

    const response = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`
    )

    if (!response.ok) {
        throw new Error(`Wikipedia page failed: ${response.status}`)
    }

    return await response.json()
}

function buildPromptFromPage(page) {
    const styleMix = buildStyleMix(page)
    const prompt = buildWeirdWikiPrompt(page, styleMix)

    return {
        prompt,
        styleMix,
    }
}

async function generateImageBuffer(prompt) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("Missing OPENAI_API_KEY environment variable.")
    }

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    })

    const model =
        process.env.OPENAI_IMAGE_MODEL ||
        process.env.IMAGE_MODEL ||
        DEFAULT_IMAGE_MODEL

    const size = process.env.IMAGE_SIZE || DEFAULT_IMAGE_SIZE
    const quality = process.env.IMAGE_QUALITY || DEFAULT_IMAGE_QUALITY

    const result = await openai.images.generate({
        model,
        prompt,
        size,
        quality,
        output_format: "png",
    })

    const b64 = result?.data?.[0]?.b64_json

    if (!b64) {
        throw new Error("OpenAI returned no image data.")
    }

    return {
        buffer: Buffer.from(b64, "base64"),
        b64,
        mimeType: "image/png",
        model,
        size,
        quality,
    }
}

async function uploadImageToBlob({ buffer, filename, mimeType = "image/png" }) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return ""

    const { put } = await import("@vercel/blob")

    const safeFilename = String(filename || "ramon-generation.png")
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .slice(0, 80)

    const blob = await put(`ramon/${Date.now()}-${safeFilename}`, buffer, {
        access: "public",
        contentType: mimeType,
        addRandomSuffix: true,
    })

    return blob.url
}

function getUpstashConfig() {
    const url =
        process.env.UPSTASH_REDIS_REST_URL ||
        process.env.KV_REST_API_URL ||
        process.env.UPSTASH_KV_REST_API_URL ||
        process.env.UPSTASH_REDIS_REST_KV_REST_API_URL

    const token =
        process.env.UPSTASH_REDIS_REST_TOKEN ||
        process.env.KV_REST_API_TOKEN ||
        process.env.UPSTASH_KV_REST_API_TOKEN ||
        process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN

    if (!url || !token) return null

    return {
        url: String(url).replace(/\/$/, ""),
        token,
    }
}

async function upstashCommand(command) {
    const config = getUpstashConfig()
    if (!config) return null

    const response = await fetch(config.url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${config.token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
        throw new Error(data?.error || `Upstash failed: ${response.status}`)
    }

    return data.result
}

async function getRecentGenerations() {
    try {
        const result = await upstashCommand(["GET", RECENT_KEY])
        if (!result) return []

        const parsed = JSON.parse(result)
        if (!Array.isArray(parsed)) return []

        return parsed.slice(0, 10)
    } catch {
        return []
    }
}

async function saveRecentGeneration(item) {
    try {
        if (!item?.image) return false

        const current = await getRecentGenerations()

        const next = [
            item,
            ...current.filter((existing) => existing.image !== item.image),
        ].slice(0, 10)

        await upstashCommand(["SET", RECENT_KEY, JSON.stringify(next)])

        return true
    } catch {
        return false
    }
}

function buildRecentItem({ image, page, prompt, source = "api" }) {
    return {
        image,
        title: page?.title || "Custom Prompt",
        wikiUrl: page ? getWikipediaPageUrl(page) : "",
        wikiImageUrl: page ? getWikipediaImageUrl(page) : "",
        prompt: prompt || "",
        source,
        createdAt: new Date().toISOString(),
    }
}

module.exports = {
    getWikipediaImageUrl,
    getWikipediaPageUrl,
    cleanWikiTitleFromUrl,
    fetchRandomWikipediaPage,
    fetchWikipediaPageFromUrl,
    buildPromptFromPage,
    generateImageBuffer,
    uploadImageToBlob,
    makeTicker,
    getRecentGenerations,
    saveRecentGeneration,
    buildRecentItem,
}
