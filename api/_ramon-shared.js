const OpenAIModule = require("openai")
const OpenAI = OpenAIModule.default || OpenAIModule

const DEFAULT_IMAGE_MODEL = "gpt-image-1"
const DEFAULT_IMAGE_SIZE = "1536x1024"
const DEFAULT_IMAGE_QUALITY = "medium"

const RECENT_KEY = "ramon:recent-generations"
const RECENT_BLOB_PATH = "ramon/recent-generations.json"

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
            "biography",
            "player",
            "athlete",
            "professor",
            "director",
            "producer",
            "composer",
            "poet",
            "journalist",
            "activist",
            "lawyer",
            "mayor",
            "governor",
            "minister",
            "wrestler",
            "boxer",
            "coach",
            "model",
            "designer",
            "screenwriter",
            "filmmaker",
            "dancer",
            "rapper",
            "performer",
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
            "genus",
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
            "church",
            "castle",
            "station",
            "district",
            "province",
            "county",
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
            "book",
            "album",
            "film",
            "software",
            "painting",
            "sculpture",
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
            "mineral",
            "molecule",
            "organism",
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
            "clothing",
        ]),
        isFood: hasAny([
            "food",
            "dish",
            "fruit",
            "vegetable",
            "meat",
            "bread",
            "cake",
            "drink",
            "restaurant",
            "cuisine",
            "sauce",
            "cheese",
            "corn",
            "potato",
            "rice",
            "soup",
        ]),
        isEvent: hasAny([
            "war",
            "battle",
            "incident",
            "festival",
            "ceremony",
            "election",
            "competition",
            "tournament",
            "game",
            "show",
            "performance",
            "race",
        ]),
        isMedia: hasAny([
            "film",
            "television",
            "series",
            "album",
            "song",
            "novel",
            "book",
            "magazine",
            "comic",
            "video game",
            "episode",
        ]),
    }
}

function extractWikiAnchorList(page) {
    const title = String(page?.title || "")
    const summary = String(page?.extract || "")

    const words = `${title} ${summary}`
        .replace(/[^\w\s-]/g, " ")
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 4)
        .filter(
            (word) =>
                ![
                    "about",
                    "which",
                    "their",
                    "there",
                    "first",
                    "after",
                    "before",
                    "known",
                    "where",
                    "while",
                    "being",
                    "other",
                    "through",
                    "during",
                    "would",
                    "could",
                    "should",
                    "wikipedia",
                    "article",
                    "english",
                    "including",
                    "several",
                    "became",
                    "called",
                    "american",
                    "british",
                ].includes(word.toLowerCase())
        )

    return [...new Set(words)].slice(0, 18)
}

function extractWikiAnchors(page) {
    const list = extractWikiAnchorList(page)
    return list.length ? list.join(", ") : String(page?.title || "")
}

const COLOR_MOODS = [
    "bright toy-commercial colors",
    "washed-out 1990s photo-lab colors",
    "sickly green color cast",
    "sunny suburban summer colors",
    "cold blue-gray tones",
    "warm orange nostalgic tones",
    "surreal candy-color palette",
    "faded analog-film colors",
    "clean product-photo whites and bold accents",
    "cheap VHS-video color response",
    "pale pastel portrait colors",
    "hyper-bright blue sky and beige tones",
    "glossy green sci-fi colors",
    "aquarium blues and coral pinks",
    "muddy indoor internet-photo browns",
    "oversaturated meme-image colors",
    "bright food-ad reds and yellows",
    "museum beige and dusty gray",
    "neon arcade colors",
    "faded family-album colors",
    "loud parade-float colors",
    "glossy celebrity-magazine colors",
    "flashy red-carpet black and gold",
]

const MATERIALS = [
    "rubber, latex, foam, vinyl",
    "cheap fabric, cardboard, painted wood",
    "glossy product plastic",
    "ceramic and porcelain",
    "beige office laminate",
    "wet shiny aquarium surfaces",
    "epoxy acrylic and glassy eyes",
    "compressed low-resolution texture",
    "oversized food texture",
    "wood, screws, chipped paint, dust",
    "clear plastic packaging",
    "stone, concrete, moss, old brick",
    "medical mannequin plastic",
    "hardware-store metal, hoses, buckets",
    "papier-mâché and parade-float paint",
    "wax museum skin",
    "inflatable vinyl seams",
    "clay-like handmade surface",
    "appliance plastic and chrome",
    "cheap formalwear fabric",
    "movie costume leather and nylon",
    "department-store mannequin plastic",
    "synthetic wig hair",
]

const GENERAL_POSES = [
    "standing proudly like a monument",
    "sitting awkwardly at a table",
    "caught mid-step",
    "staring directly into the camera",
    "posing like a product demonstration",
    "standing too close to the lens",
    "peeking from a doorway",
    "posed like a family portrait",
    "frozen in a TV interview chair",
    "displayed like a catalog item",
    "placed in a bathroom with no explanation",
    "floating or staged in a miniature set",
    "holding an object from the Wikipedia source",
    "standing in a backyard like nothing is wrong",
    "presenting itself like a salesman",
    "being photographed like a strange celebrity",
    "posing like a movie publicity still",
    "walking through an airport hallway",
    "standing in a store display window",
    "demonstrating a strange source-related product",
]

const PERSON_SCENES = [
    "awkward paparazzi photo",
    "strange red carpet moment",
    "low-budget movie still",
    "public access TV interview",
    "mall portrait studio photo",
    "tabloid evidence photo",
    "weird family-style portrait",
    "backstage hallway snapshot",
    "celebrity shrine room portrait",
    "dusty wax museum photo",
    "late-night infomercial set",
    "odd magazine advertisement photo",
    "airport candid photo",
    "behind-the-scenes press junket image",
]

const PERSON_PRESENTATIONS = [
    "live-action publicity photograph",
    "strange candid celebrity snapshot",
    "awkward magazine portrait",
    "weirdly believable wax-museum-style portrait",
    "public-access-TV still frame",
    "paparazzi hallway shot",
    "cheap commercial portrait",
    "surreal domestic portrait",
    "strange behind-the-scenes photo",
    "awkward awards-style portrait without any logos",
]

const PERSON_LENSES = [
    "24mm wide-angle lens with exaggerated perspective",
    "fisheye lens with warped corners",
    "50mm portrait lens",
    "85mm close portrait lens",
    "telephoto paparazzi lens",
    "cheap disposable camera lens",
    "security-camera-style wide lens",
    "VHS camcorder look",
    "macro-like close facial framing",
    "ultra-wide interior lens",
]

const PERSON_LIGHTING = [
    "harsh direct flash",
    "soft portrait lighting",
    "cold fluorescent lighting",
    "overexposed daylight",
    "cheap TV studio lighting",
    "single overhead bulb",
    "golden-hour lighting",
    "flashlit night scene",
    "murky VHS lighting",
    "bright commercial lighting",
    "backlit silhouette lighting",
    "wax museum spotlighting",
]

const PERSON_BACKGROUNDS = [
    "airport hallway filled with source-related props",
    "cluttered celebrity shrine room inspired by the Wikipedia page",
    "public access TV set with source-themed objects",
    "fake movie set based on the page summary",
    "mall portrait backdrop with awkward themed props",
    "museum room filled with source-inspired artifacts",
    "suburban backyard with bizarre source-related objects",
    "red carpet event scene with odd source-based details",
    "store display setup based on the source profession",
    "chaotic dressing room filled with page-related objects",
    "corporate training room themed around the source topic",
    "hotel hallway or backstage corridor filled with source-inspired clutter",
]

const PERSON_WEIRD_TWISTS = [
    "slightly uncanny but believable",
    "awkward and funny",
    "surreal but grounded",
    "strangely glamorous",
    "low-budget and theatrical",
    "practical-effects weird",
    "deeply awkward in a funny way",
    "visually cluttered and bizarre",
    "oddly sincere and homemade",
    "cheaply commercial in a funny way",
]

const PERSON_PROP_RULES = [
    "use objects from the Wikipedia summary as background props",
    "turn the person’s profession into visual set dressing",
    "include objects related to the page title and career",
    "make the room feel dedicated to the subject’s public identity",
    "scatter multiple source-specific details in the background",
    "include one oversized prop based on the summary",
    "use the source image composition as loose pose guidance",
    "make the background feel like a themed shrine, set, or event space for the subject",
]

const PERSON_WARDROBE = [
    "oversized beige suit",
    "awkward formal shirt",
    "movie-star suit with strange proportions",
    "action-movie jacket",
    "red-carpet formalwear with no readable logos",
    "vintage commercial spokesperson outfit",
    "local TV host blazer",
    "plain suburban clothes",
    "wax museum display clothing",
    "1980s workout clothes",
    "airport travel jacket",
    "cheap sports uniform",
]

const NON_PERSON_LENSES = [
    "24mm wide-angle lens",
    "fisheye lens",
    "macro close-up lens",
    "50mm documentary lens",
    "telephoto crop",
    "cheap disposable camera look",
    "security camera wide lens",
    "VHS camcorder still frame",
    "product catalog lens",
    "ultra-wide room lens",
]

const NON_PERSON_LIGHTING = [
    "harsh direct flash",
    "soft overcast daylight",
    "bright commercial lighting",
    "cold fluorescent lighting",
    "single overhead bulb",
    "golden-hour sunlight",
    "aquarium-blue lighting",
    "flat catalog lighting",
    "museum display-case lighting",
    "flashlit night scene",
    "sickly sci-fi underglow",
]

const NON_PERSON_WEIRD_TWISTS = [
    "funny and strange",
    "surreal and specific",
    "awkward but believable",
    "weirdly documentary-like",
    "homemade and theatrical",
    "artificial but photographed seriously",
    "dense with source-specific detail",
    "slightly cursed but funny",
]

const NON_PERSON_PROP_RULES = [
    "extract concrete nouns from the Wikipedia summary and turn them into physical props",
    "make the environment feel like it belongs to the topic, not a random weird room",
    "include one oversized prop based on the title or source image",
    "include several tiny details based on words from the summary",
    "use profession, location, era, or category to choose objects",
    "make the setting feel like a shrine, display, museum, store, or documentary setup",
    "make the source image colors influence the props and environment",
    "avoid generic weirdness; every odd detail should connect to the source",
]

const BACKGROUND_DENSITY = [
    "minimal background with one very specific source-related prop",
    "medium clutter with three to five visible source-related objects",
    "busy background with many strange props connected to the Wikipedia topic",
    "overstuffed scene with source-related objects everywhere, but still readable as one photograph",
    "background tells a second story using objects from the source summary",
]

const ANIMAL_SCENES = [
    "field-guide discovery photograph",
    "awkward home snapshot",
    "bathroom aquarium scene",
    "museum specimen setup",
    "suburban yard discovery",
    "pet-like meme photo",
    "documentary-style encounter",
    "science-fair-style display photo",
]

const OBJECT_SCENES = [
    "strange product photo",
    "catalog shoot",
    "museum display image",
    "hardware-store aisle photo",
    "miniature diorama setup",
    "infomercial demonstration photo",
    "odd domestic snapshot",
    "surreal workshop scene",
]

const PLACE_SCENES = [
    "architectural photograph",
    "tourist snapshot",
    "miniature diorama scene",
    "museum archive documentation",
    "strange event photo",
    "documentary location still",
    "surreal room/environment photo",
    "odd suburban scene",
]

const FOOD_SCENES = [
    "weird food advertisement photo",
    "tabletop product shot",
    "odd kitchen snapshot",
    "magazine food photo gone wrong",
    "domestic still life",
    "fast-food commercial parody photo",
    "surreal buffet display",
    "scientific specimen-like food shot",
]

const GENERAL_SCENES = [
    "strange documentary photograph",
    "odd commercial photo",
    "awkward domestic snapshot",
    "museum archive documentation",
    "miniature set photograph",
    "surreal room scene",
    "public event photo",
    "catalog image gone wrong",
]

const NON_PERSON_BACKGROUNDS = [
    "chaotic source shrine",
    "fake movie set",
    "museum display room",
    "toy store-like display without making the main subject a toy",
    "suburban backyard scene",
    "public access TV studio",
    "corporate training room",
    "bathroom aquarium set",
    "hardware store aisle",
    "school gym or science fair",
    "miniature diorama world",
    "celebrity storage room full of topic-inspired objects",
]

function buildRandomPromptPlan(page) {
    const profile = inferWikiProfile(page)
    const anchors = extractWikiAnchors(page)
    const anchorList = extractWikiAnchorList(page)
    const varietySeed = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    if (profile.isPerson) {
        return {
            type: "person",
            profile,
            anchors,
            anchorList,
            title: page?.title || "",
            scene: pick(PERSON_SCENES),
            presentation: pick(PERSON_PRESENTATIONS),
            lens: pick(PERSON_LENSES),
            lighting: pick(PERSON_LIGHTING),
            background: pick(PERSON_BACKGROUNDS),
            weirdTwist: pick(PERSON_WEIRD_TWISTS),
            propRules: pickMany(PERSON_PROP_RULES, 3),
            wardrobe: pick(PERSON_WARDROBE),
            pose: pick(GENERAL_POSES),
            colorMood: pick(COLOR_MOODS),
            materials: pickMany(MATERIALS, 2),
            backgroundDensity: pick(BACKGROUND_DENSITY),
            varietySeed,
        }
    }

    const subtype = profile.isAnimal
        ? "animal"
        : profile.isPlace
          ? "place"
          : profile.isFood
            ? "food"
            : profile.isObject || profile.isScience || profile.isMedia
              ? "object"
              : "general"

    const scenePool =
        subtype === "animal"
            ? ANIMAL_SCENES
            : subtype === "place"
              ? PLACE_SCENES
              : subtype === "food"
                ? FOOD_SCENES
                : subtype === "object"
                  ? OBJECT_SCENES
                  : GENERAL_SCENES

    return {
        type: "nonPerson",
        subtype,
        profile,
        anchors,
        anchorList,
        title: page?.title || "",
        scene: pick(scenePool),
        lens: pick(NON_PERSON_LENSES),
        lighting: pick(NON_PERSON_LIGHTING),
        background: pick(NON_PERSON_BACKGROUNDS),
        weirdTwist: pick(NON_PERSON_WEIRD_TWISTS),
        propRules: pickMany(NON_PERSON_PROP_RULES, 3),
        pose: pick(GENERAL_POSES),
        colorMood: pick(COLOR_MOODS),
        materials: pickMany(MATERIALS, 2),
        backgroundDensity: pick(BACKGROUND_DENSITY),
        varietySeed,
    }
}

function buildRandomizedPrompt(page, plan) {
    const title = page?.title || "Random Wikipedia Subject"
    const summary = page?.extract || ""
    const imageUrl = getWikipediaImageUrl(page) || "No image available"

    if (plan.type === "person") {
        return `
Create a single weird photographed image inspired by this Wikipedia person.

Subject:
${title}

Summary:
${summary}

Source image:
${imageUrl}

Important identity rule:
Use the Wikipedia page image and summary to guide the person's likeness.
Make the result resemble the source person in a loose but recognizable way through face shape, hairstyle, age range, styling, posture, and public-role cues.
Do not copy the exact face perfectly.
Keep the result clearly person-first.

Randomized scene plan:
- presentation: ${plan.presentation}
- scene: ${plan.scene}
- lens: ${plan.lens}
- lighting: ${plan.lighting}
- background: ${plan.background}
- background density: ${plan.backgroundDensity}
- mood: ${plan.weirdTwist}
- wardrobe: ${plan.wardrobe}
- pose: ${plan.pose}
- color mood: ${plan.colorMood}
- materials: ${plan.materials.join(", ")}

Source anchors:
${plan.anchors}

Background instructions:
${plan.propRules.map((x) => `- ${x}`).join("\n")}

Important scene rules:
The background must feel specifically connected to the Wikipedia page.
Use props, set dressing, objects, shelves, costumes, furniture, event details, hobby items, trophies, tools, domestic clutter, or display pieces inspired by the page summary and source image.
Let the weirdness come from the random scene choices and source-based props, not from turning the person into the same character every time.
Do not default to a toy, action figure, or mascot unless the randomized scene naturally suggests it.
Wax-museum-like or mannequin-like looks are allowed sometimes, but they should be only one possible outcome among many.
Make the result look like a real photograph, not polished digital fantasy art.

Hard rules:
- one image only
- no collage
- no split panels
- no readable text
- no watermark
- no logos
- no gore
- no graphic injury

Variety seed:
${plan.varietySeed}
`.trim()
    }

    const subtypeInstruction =
        plan.subtype === "animal"
            ? "Keep the result connected to the animal/species identity from the Wikipedia page."
            : plan.subtype === "place"
              ? "Keep the result connected to the place, structure, or location identity from the Wikipedia page."
              : plan.subtype === "food"
                ? "Keep the result connected to the food or dish identity from the Wikipedia page."
                : plan.subtype === "object"
                  ? "Keep the result connected to the object, artifact, product, science, or media identity from the Wikipedia page."
                  : "Keep the result clearly connected to the Wikipedia topic."

    return `
Create a single weird photographed image inspired by this Wikipedia subject.

Subject:
${title}

Summary:
${summary}

Source image:
${imageUrl}

Topic rule:
${subtypeInstruction}

Randomized scene plan:
- scene: ${plan.scene}
- lens: ${plan.lens}
- lighting: ${plan.lighting}
- background world: ${plan.background}
- background density: ${plan.backgroundDensity}
- mood: ${plan.weirdTwist}
- pose/staging: ${plan.pose}
- color mood: ${plan.colorMood}
- materials: ${plan.materials.join(", ")}

Source anchors:
${plan.anchors}

Background instructions:
${plan.propRules.map((x) => `- ${x}`).join("\n")}

Important scene rules:
Use the Wikipedia title, source image, and summary as the basis for the main subject, props, and environment.
The background should contain visible objects or environmental details connected to the source.
Make the image feel weird, specific, and different from previous generations.
Do not rely on the same plain setup every time.
Make it feel like a photographed image, not polished digital fantasy art.

Hard rules:
- one image only
- no collage
- no split panels
- no readable text
- no watermark
- no logos
- no gore
- no graphic injury

Variety seed:
${plan.varietySeed}
`.trim()
}

function buildPromptFromPage(page) {
    const styleMix = buildRandomPromptPlan(page)
    const prompt = buildRandomizedPrompt(page, styleMix)

    return {
        prompt,
        styleMix,
    }
}

async function fetchRandomWikipediaPage(requireImage = true) {
    const preferPeople = process.env.WIKI_PEOPLE_BIAS === "0" ? false : true
    const batchSize = Number(process.env.WIKI_RANDOM_BATCH_SIZE || 10)

    const params = new URLSearchParams({
        action: "query",
        format: "json",
        generator: "random",
        grnnamespace: "0",
        grnlimit: String(batchSize),
        prop: "extracts|pageimages|info",
        exintro: "1",
        explaintext: "1",
        inprop: "url",
        piprop: "thumbnail|original",
        pithumbsize: "900",
        origin: "*",
    })

    const response = await fetch(
        `https://en.wikipedia.org/w/api.php?${params.toString()}`,
        {
            headers: {
                "User-Agent":
                    "RamonAIImageBot/1.0 (https://mma-image-api.vercel.app)",
            },
        }
    )

    if (!response.ok) {
        throw new Error(`Wikipedia failed: ${response.status}`)
    }

    const data = await response.json()
    const pages = Object.values(data?.query?.pages || {}).map((page) => ({
        title: page.title || "",
        extract: page.extract || "",
        description: "",
        type: "standard",
        url: page.fullurl || "",
        content_urls: {
            desktop: {
                page: page.fullurl || "",
            },
            mobile: {
                page: page.fullurl || "",
            },
        },
        thumbnail: page.thumbnail?.source
            ? { source: page.thumbnail.source }
            : undefined,
        originalimage: page.original?.source
            ? { source: page.original.source }
            : undefined,
    }))

    function isValidPage(page) {
        const hasTitle = page?.title && !page.title.includes(":")
        const hasSummary = page?.extract && page.extract.length > 80
        const hasImage = Boolean(getWikipediaImageUrl(page))
        return hasTitle && hasSummary && (!requireImage || hasImage)
    }

    const validPages = pages.filter(isValidPage)

    if (!validPages.length) {
        throw new Error("No valid Wikipedia pages found in random batch.")
    }

    if (preferPeople) {
        const peoplePages = validPages.filter((page) =>
            inferWikiProfile(page).isPerson
        )

        if (peoplePages.length) {
            return pick(peoplePages)
        }
    }

    return pick(validPages)
}

async function fetchWikipediaPageFromUrl(url) {
    const title = cleanWikiTitleFromUrl(url)

    if (!title) {
        throw new Error("Could not read the Wikipedia title from that URL.")
    }

    const normalizedTitle = title.replaceAll(" ", "_")

    const params = new URLSearchParams({
        action: "query",
        format: "json",
        titles: normalizedTitle,
        prop: "extracts|pageimages|info",
        exintro: "1",
        explaintext: "1",
        inprop: "url",
        piprop: "thumbnail|original",
        pithumbsize: "900",
        redirects: "1",
        origin: "*",
    })

    const response = await fetch(
        `https://en.wikipedia.org/w/api.php?${params.toString()}`,
        {
            headers: {
                "User-Agent":
                    "RamonAIImageBot/1.0 (https://mma-image-api.vercel.app)",
            },
        }
    )

    if (!response.ok) {
        throw new Error(`Wikipedia page failed: ${response.status}`)
    }

    const data = await response.json()
    const pages = Object.values(data?.query?.pages || {})
    const page = pages.find((item) => item && item.pageid && !item.missing)

    if (!page) {
        throw new Error("Wikipedia page not found.")
    }

    return {
        title: page.title || title,
        extract: page.extract || "",
        description: "",
        type: "standard",
        url: page.fullurl || `https://en.wikipedia.org/wiki/${normalizedTitle}`,
        content_urls: {
            desktop: {
                page:
                    page.fullurl ||
                    `https://en.wikipedia.org/wiki/${normalizedTitle}`,
            },
            mobile: {
                page:
                    page.fullurl ||
                    `https://en.wikipedia.org/wiki/${normalizedTitle}`,
            },
        },
        thumbnail: page.thumbnail?.source
            ? { source: page.thumbnail.source }
            : undefined,
        originalimage: page.original?.source
            ? { source: page.original.source }
            : undefined,
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
        process.env.UPSTASH_KV_REST_API_URL

    const token =
        process.env.UPSTASH_REDIS_REST_TOKEN ||
        process.env.KV_REST_API_TOKEN ||
        process.env.UPSTASH_KV_REST_API_TOKEN

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

async function getRecentFromUpstash() {
    const result = await upstashCommand(["GET", RECENT_KEY])
    if (!result) return []

    const parsed = JSON.parse(result)
    if (!Array.isArray(parsed)) return []

    return parsed.slice(0, 10)
}

async function saveRecentToUpstash(next) {
    await upstashCommand(["SET", RECENT_KEY, JSON.stringify(next)])
    return true
}

async function getRecentFromBlob() {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return []

    try {
        const { list } = await import("@vercel/blob")

        const result = await list({
            prefix: RECENT_BLOB_PATH,
            limit: 1,
        })

        const blob =
            result?.blobs?.find((item) => item.pathname === RECENT_BLOB_PATH) ||
            result?.blobs?.[0]

        if (!blob?.url) return []

        const response = await fetch(`${blob.url}?t=${Date.now()}`, {
            cache: "no-store",
        })

        if (!response.ok) return []

        const parsed = await response.json()

        if (!Array.isArray(parsed)) return []

        return parsed.slice(0, 10)
    } catch {
        return []
    }
}

async function saveRecentToBlob(next) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return false

    try {
        const { put } = await import("@vercel/blob")

        await put(RECENT_BLOB_PATH, JSON.stringify(next, null, 2), {
            access: "public",
            contentType: "application/json",
            allowOverwrite: true,
        })

        return true
    } catch {
        return false
    }
}

async function getRecentGenerations() {
    try {
        const upstashRecent = await getRecentFromUpstash()
        if (upstashRecent.length) return upstashRecent
    } catch {}

    try {
        const blobRecent = await getRecentFromBlob()
        if (blobRecent.length) return blobRecent
    } catch {}

    return []
}

async function saveRecentGeneration(item) {
    try {
        if (!item?.image) return false

        const current = await getRecentGenerations()

        const next = [
            item,
            ...current.filter((existing) => existing.image !== item.image),
        ].slice(0, 10)

        let saved = false

        try {
            if (getUpstashConfig()) {
                saved = await saveRecentToUpstash(next)
            }
        } catch {}

        if (!saved) {
            saved = await saveRecentToBlob(next)
        }

        return saved
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
