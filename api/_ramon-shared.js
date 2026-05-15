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
            "fictional",
        ]),
    }
}

function extractWikiAnchors(page) {
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
                ].includes(word.toLowerCase())
        )

    const unique = [...new Set(words)].slice(0, 16)

    return unique.length ? unique.join(", ") : title
}

const FORM_MODES = [
    {
        name: "Person-First Publicity Photo",
        characterAllowed: true,
        weightForPeople: 16,
        description:
            "keep the source as a fictionalized person-first image inspired by the person's role, career, era, wardrobe, posture, and public context",
    },
    {
        name: "Human Portrait / Meme Photo",
        characterAllowed: true,
        weightForPeople: 12,
        description:
            "make a strange fictional human portrait inspired by the source, meme-like but still connected to the person's biography",
    },
    {
        name: "Movie Still / Public Figure Scene",
        characterAllowed: true,
        weightForPeople: 10,
        description:
            "make a fictional alternate-universe movie still, publicity photo, award-photo, sports portrait, TV still, or magazine image connected to the person",
    },
    {
        name: "Toy / Action Figure / Wax Figure",
        characterAllowed: true,
        weightForPeople: 6,
        description:
            "make the person source into a toy-like figure, wax figure, action figure, puppet, boxed figure, or catalog character",
    },
    {
        name: "Mascot / Costume / Performer",
        characterAllowed: true,
        weightForPeople: 3,
        description:
            "make a costumed performer or staged character inspired by the source, but keep it connected to the person's role and avoid unrelated animal transformations",
    },
    {
        name: "Creature / Field Discovery",
        characterAllowed: true,
        weightForPeople: 0,
        description:
            "make a strange documented creature only if the source is animal/creature related; do not use this for normal real-person pages",
    },
    {
        name: "Strange Product Photo",
        characterAllowed: false,
        weightForPeople: 1,
        description:
            "do not make a character; turn the source into a bizarre physical product, prototype, appliance, gadget, package, or catalog object",
    },
    {
        name: "Room / Environment Scene",
        characterAllowed: false,
        weightForPeople: 1,
        description:
            "turn the source into a strange room, staged environment, hallway, office, bathroom, bedroom, gym, film set, or miniature set",
    },
    {
        name: "Museum Object / Specimen",
        characterAllowed: false,
        weightForPeople: 1,
        description:
            "present the source as an artifact, preserved object, sculpture, fossil-like thing, or unexplained museum item",
    },
    {
        name: "Food / Object Close-Up",
        characterAllowed: false,
        weightForPeople: 1,
        description:
            "turn the source into a weird close-up of food, material, texture, household object, mechanical part, or physical prop",
    },
    {
        name: "Architectural / Place Photo",
        characterAllowed: false,
        weightForPeople: 1,
        description:
            "translate the source into a strange building, landscape, room, monument, stage set, or location photograph",
    },
]

const PERSON_SAFE_ARCHETYPE_NAMES = [
    "Low-Angle Movie Star",
    "Magazine Cover Doppelganger",
    "Wax Museum Celebrity Figure",
    "Public Access TV Guest",
    "Action Figure Actor",
    "Old Magazine Advertisement Person",
    "Sports Card Oddity",
    "Suburban Backyard Giant",
    "Ancient Portrait Figure",
    "Corporate Training Dummy",
    "Medical Demonstration Dummy",
    "Claymation-Looking Real Puppet",
    "Inflatable Vinyl Person",
    "Appliance-Head Person",
    "Rubber Suit Movie Extra",
    "Mall Portrait Alien Relative",
]

const ANIMAL_ARCHETYPE_NAMES = [
    "Cursed Pet-Like Meme Creature",
    "Aquarium Bathroom Creature",
    "Scientific Field Specimen",
    "Tiny Roommate Creature",
]

const CHARACTER_ARCHETYPES = [
    {
        name: "Low-Angle Movie Star",
        body: "fictional movie-star stand-in, human body, dramatic heroic stance, huge perspective from below",
        face: "fictional human face inspired by the source image composition, not the real person's exact likeness",
        mood: "alternate-universe celebrity publicity photo, action-movie confidence, silly but person-first",
        avoid: "no animal body, no random dog, no unrelated mascot, no copy of the real face",
    },
    {
        name: "Magazine Cover Doppelganger",
        body: "fictional celebrity-like person posed like an old magazine portrait or publicity still",
        face: "recognizably human, charismatic but slightly wrong, not a direct likeness",
        mood: "glossy but strange celebrity portrait, bright commercial colors, awkward charm",
        avoid: "no creature face, no pet transformation, no mascot head",
    },
    {
        name: "Wax Museum Celebrity Figure",
        body: "stiff wax figure body, formal celebrity pose, museum display posture",
        face: "slightly melted waxy human face, blank eyes, too-still expression, not exact likeness",
        mood: "dusty wax museum realism, uncanny but person-related",
        avoid: "no dog, no monster, no generic bald puppet",
    },
    {
        name: "Public Access TV Guest",
        body: "fictional guest or host seated on a cheap local TV set, human or costume based on the source",
        face: "awkward human expression, uncomfortable smile, VHS still-frame realism",
        mood: "cheap studio interview, public-access TV, strange but connected to their career or role",
        avoid: "no unrelated animal creature, no generic sci-fi alien",
    },
    {
        name: "Action Figure Actor",
        body: "toy-like action figure or collectible version of a fictionalized public figure",
        face: "painted toy face, not realistic, not an exact likeness",
        mood: "1990s toy commercial, boxed-figure energy, colorful product-photo weirdness",
        avoid: "no living dog or pet, no monster unless source supports it",
    },
    {
        name: "Old Magazine Advertisement Person",
        body: "fictional spokesperson or model posed in an old advertisement layout",
        face: "smiling too intensely or deadpan like a print ad model",
        mood: "bright magazine ad, product demonstration, absurd optimism",
        avoid: "no creature transformation unless source demands it",
    },
    {
        name: "Sports Card Oddity",
        body: "athletic pose, trading-card portrait, uniform or costume based on source keywords",
        face: "serious game-face expression or mascot-athlete stare",
        mood: "1990s sports card photo, flash, bold posture",
        avoid: "no museum specimen framing",
    },
    {
        name: "Suburban Backyard Giant",
        body: "large awkward human-like figure in a normal backyard, porch, driveway, or lawn",
        face: "fictional human or mask face based on source role, not exact likeness",
        mood: "daylight neighborhood photo, absurd scale, strangely believable",
        avoid: "no pet body, no animal transformation",
    },
    {
        name: "Ancient Portrait Figure",
        body: "stiff historical portrait pose translated into a photographed costume or prop",
        face: "painted, powdered, masked, or serious museum-like expression",
        mood: "old portrait meets real flash photo, strange and formal",
        avoid: "no modern meme compression",
    },
    {
        name: "Corporate Training Dummy",
        body: "office-training mannequin, presenter, or dummy in beige corporate setting",
        face: "instructional blank stare, plastic or mannequin-like, awkward professionalism",
        mood: "cursed office training video, fluorescent, serious and absurd",
        avoid: "no fantasy creature anatomy",
    },
    {
        name: "Medical Demonstration Dummy",
        body: "non-graphic clinical demonstration dummy, plastic anatomy model, sterile room",
        face: "smooth medical mannequin face or featureless head",
        mood: "clean, unsettling, textbook-photo realism",
        avoid: "no gore, no wounds",
    },
    {
        name: "Claymation-Looking Real Puppet",
        body: "soft rounded handmade body, clay-like surface, visible handmade imperfections",
        face: "simple handmade facial features, uneven eyes, not symmetrical",
        mood: "physical stop-motion puppet photographed in real life",
        avoid: "no glossy AI fantasy finish",
    },
    {
        name: "Inflatable Vinyl Person",
        body: "air-filled vinyl human-like body, rounded swollen limbs, seams and glossy wrinkles",
        face: "printed or molded face, slightly misaligned, toy-like",
        mood: "weird promotional inflatable photographed seriously",
        avoid: "no realistic skin, no animal body",
    },
    {
        name: "Appliance-Head Person",
        body: "ordinary human body with a source-specific machine, appliance, helmet, object, or artifact replacing the head",
        face: "no normal face; the object itself is the head",
        mood: "deadpan, funny, product-meets-person surrealism",
        avoid: "no eyes unless the source object naturally suggests them",
    },
    {
        name: "Rubber Suit Movie Extra",
        body: "visible rubber suit, foam seams, practical-effects costume, awkward human posture",
        face: "mask or prosthetic face with handmade detail",
        mood: "low-budget movie still, cinematic but cheap, physical effects",
        avoid: "no polished digital fantasy, no random pet",
    },
    {
        name: "Mall Portrait Alien Relative",
        body: "stiff seated or standing figure posed like an awkward family portrait",
        face: "forced smile, strange but gentle human-like features, soft studio weirdness",
        mood: "family-photo energy, awkward and wholesome, not scary",
        avoid: "no horror monster posture",
    },
    {
        name: "Glossy Helmet Puppet",
        body: "smooth synthetic puppet body with a helmet-shaped head and epoxy-like surface",
        face: "small glassy eyes, tiny mouth, shiny acrylic facial planes",
        mood: "1970s sci-fi, eerie but clean and colorful",
        avoid: "no furry monster texture, no human skin realism",
    },
    {
        name: "Cursed Pet-Like Meme Creature",
        body: "dog-like or pet-like proportions, squat body, awkward limbs, internet-photo realism",
        face: "startled pet expression, funny wide eyes, wet nose or smooth animal-like features",
        mood: "funny first, creepy second, like an old viral image",
        avoid: "no humanoid bald head, no normal person face",
    },
    {
        name: "Food-Headed Performer",
        body: "human or mannequin body wearing ordinary clothes, but the head or body is transformed into source-specific food/object forms",
        face: "face may be absent, carved, tiny, or implied through object texture",
        mood: "bright commercial absurdity, colorful, silly, instantly readable",
        avoid: "no generic monster face, no gore",
    },
    {
        name: "Aquarium Bathroom Creature",
        body: "rubbery wet figure or object staged in a bathroom/aquarium world",
        face: "fish-like, smooth, partially hidden, or non-human; not the default big-eyed mascot",
        mood: "blue-lit porcelain surrealism, coral colors, absurd domestic setting",
        avoid: "no dry studio portrait",
    },
    {
        name: "Toy Commercial Mascot",
        body: "colorful molded toy-like character or mascot staged like a product commercial",
        face: "painted toy features, shiny plastic eyes, cheerful but off",
        mood: "bright 1990s toy ad, playful, colorful, product-photo energy",
        avoid: "no dark horror lighting",
    },
    {
        name: "Scientific Field Specimen",
        body: "specific animal-human or specimen anatomy based on the Wikipedia topic",
        face: "field-guide realism, animal-like or specimen-like, not cartoon",
        mood: "documentary, naturalist, clear daylight, strange discovery",
        avoid: "no generic mascot costume",
    },
    {
        name: "Tiny Roommate Creature",
        body: "small person/creature/object living in an ordinary room, table, bed, or shelf",
        face: "tiny expressive face or no face depending on the source",
        mood: "domestic, funny, snapshot-like, discovered accidentally",
        avoid: "no giant heroic angle",
    },
    {
        name: "Hardware Store Humanoid",
        body: "body assembled from tools, hoses, plastic buckets, metal parts, or hardware-store materials",
        face: "face made from object parts or absent entirely",
        mood: "practical, funny, product-photo realism",
        avoid: "no flesh face unless source requires it",
    },
]

const STYLE_WORLDS = [
    "alternate-universe celebrity publicity photograph",
    "bright surreal commercial photography",
    "awkward family snapshot",
    "low-budget sci-fi movie still",
    "mall portrait studio photo",
    "tabloid newspaper evidence photo",
    "public-access TV still frame",
    "museum archive documentation",
    "toy catalog photography",
    "field-guide discovery photo",
    "corporate training video still",
    "suburban backyard snapshot",
    "old magazine advertisement",
    "1990s sports card photo",
    "hardware store product catalog",
    "school science fair display",
    "miniature model set photography",
    "food magazine photo gone wrong",
    "bathroom aquarium surrealism",
    "local parade documentation",
    "cursed low-resolution internet photo",
    "wax museum snapshot",
    "old product demonstration photo",
    "strange yearbook portrait",
    "toy store display photo",
    "paparazzi photo from a strange event",
    "movie poster behind-the-scenes still",
]

const CAMERA_ANGLES = [
    "extreme low angle looking upward",
    "high angle looking down from above",
    "tight flash close-up",
    "wide-angle full-body shot with exaggerated perspective",
    "awkward off-center snapshot",
    "front-facing deadpan portrait",
    "fisheye-like near-camera distortion",
    "medium shot with too much empty space",
    "point-of-view angle as if accidentally discovered",
    "doorway or hallway peeking angle",
    "floor-level shot",
    "surveillance-like overhead angle",
    "backlit silhouette",
    "heroic promotional angle",
    "school-photo style composition",
    "slightly tilted dutch angle",
    "macro-close detail shot",
    "wide lens inches from the subject",
    "museum inventory angle",
    "tabletop product photography angle",
    "sports-card low angle",
    "bathroom mirror angle",
    "backyard snapshot angle",
    "old catalog straight-on angle",
    "close-up from below the chin",
    "side profile like a catalog specimen",
    "three-quarter portrait with awkward flash",
    "red-carpet step-and-repeat angle without readable logos",
    "paparazzi telephoto crop",
]

const LIGHTING_STYLES = [
    "harsh direct flash with ugly shadows",
    "soft overcast daylight",
    "bright cheerful commercial lighting",
    "cold fluorescent school hallway lighting",
    "greenish institutional lighting",
    "warm suburban daylight",
    "single overhead bulb",
    "backlit glowing silhouette",
    "cheap TV studio lighting",
    "overexposed noon daylight",
    "golden-hour sunlight",
    "aquarium-blue artificial light",
    "flashlit nighttime scene",
    "soft portrait-studio lighting",
    "high-contrast theatrical lighting",
    "flat catalog lighting",
    "bright blue sky outdoor lighting",
    "bathroom mirror lighting",
    "murky VHS gray lighting",
    "sickly sci-fi underglow",
    "toy-commercial glossy highlights",
    "cheap webcam room lighting",
    "hardware-store fluorescent lighting",
    "museum display-case lighting",
    "wax museum spotlighting",
    "school gymnasium lighting",
    "strip-mall storefront lighting",
    "Hollywood press-photo flash",
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
    "clean product-photo whites and bold accents",
    "cheap VHS-video color response",
    "pale pastel portrait colors",
    "hyper-bright blue sky and beige tones",
    "glossy green sci-fi colors",
    "aquarium blues and coral pinks",
    "muddy indoor internet-photo browns",
    "brick-wall reds and corn-yellow highlights",
    "oversaturated meme-image colors",
    "bright food-ad reds and yellows",
    "museum beige and dusty gray",
    "primary-color toy plastic palette",
    "wax yellow and dusty red museum tones",
    "neon arcade colors",
    "faded family-album colors",
    "loud parade-float colors",
    "glossy celebrity-magazine colors",
]

const MATERIALS = [
    "rubber, latex, foam, vinyl",
    "cheap fabric, cardboard, painted wood",
    "toy-like molded plastic",
    "fake fur and handmade seams",
    "glossy product plastic",
    "ceramic and porcelain",
    "beige office laminate",
    "wet shiny aquarium surfaces",
    "epoxy acrylic and glassy eyes",
    "compressed low-resolution texture",
    "oversized food texture",
    "coral reef textures and blue water light",
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
]

const WARDROBE_DETAILS = [
    "oversized beige suit",
    "cheap sports uniform",
    "plain suburban clothes",
    "toy mascot costume",
    "lab coat",
    "corporate polo shirt",
    "old-fashioned formal wear",
    "rubber sci-fi helmet",
    "paper crown or parade costume",
    "no clothing, object-only form",
    "museum tag removed",
    "plastic product packaging",
    "school science fair materials",
    "windbreaker jacket",
    "awkward formal shirt",
    "vintage commercial spokesperson outfit",
    "local TV host blazer",
    "homemade costume with visible seams",
    "movie-star suit with strange proportions",
    "action-movie jacket",
    "red-carpet formalwear with no readable logos",
    "wax museum display clothing",
]

const POSE_DIRECTIONS = [
    "standing proudly like a monument",
    "sitting awkwardly at a table",
    "caught mid-step",
    "staring directly into the camera",
    "posing like a product demonstration",
    "standing too close to the lens",
    "lying on a museum table",
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
    "standing like an award-show photo without copying any real event",
    "crouching like an action hero in a very awkward way",
]

const SOURCE_TRANSFORMERS = [
    "use the source title to determine the silhouette",
    "use the source image colors as color hints",
    "turn a key object from the source summary into the main prop",
    "make the era or profession from the summary influence the wardrobe",
    "make the location from the summary influence the room or background",
    "make the source category decide whether it is person, animal, object, place, or product",
    "use two or three concrete nouns from the summary as visible physical details",
    "avoid generic weirdness; every odd detail should connect to the source",
    "use the Wikipedia source image as a loose color, pose, or object reference without copying it",
    "make the background logically connect to the source topic",
]

function weightedPick(items, weightKey = "weightForPeople") {
    const pool = []

    for (const item of items) {
        const rawWeight = Number(item?.[weightKey] ?? 1)
        const weight = Math.max(0, rawWeight)

        for (let i = 0; i < weight; i++) {
            pool.push(item)
        }
    }

    return pick(pool.length ? pool : items)
}

function chooseFormMode(profile) {
    if (profile.isPerson) {
        return weightedPick(FORM_MODES, "weightForPeople")
    }

    const extras = []

    if (profile.isAnimal) {
        extras.push(
            FORM_MODES.find((x) => x.name === "Creature / Field Discovery"),
            FORM_MODES.find((x) => x.name === "Museum Object / Specimen")
        )
    }

    if (profile.isPlace) {
        extras.push(
            FORM_MODES.find((x) => x.name === "Architectural / Place Photo"),
            FORM_MODES.find((x) => x.name === "Room / Environment Scene")
        )
    }

    if (profile.isFood) {
        extras.push(
            FORM_MODES.find((x) => x.name === "Food / Object Close-Up"),
            FORM_MODES.find((x) => x.name === "Strange Product Photo")
        )
    }

    if (profile.isObject || profile.isMedia || profile.isScience) {
        extras.push(
            FORM_MODES.find((x) => x.name === "Strange Product Photo"),
            FORM_MODES.find((x) => x.name === "Museum Object / Specimen"),
            FORM_MODES.find((x) => x.name === "Toy / Action Figure / Doll")
        )
    }

    return pick([...FORM_MODES, ...extras].filter(Boolean))
}

function pickCharacterArchetype(profile) {
    if (profile.isPerson) {
        const personSafe = CHARACTER_ARCHETYPES.filter((item) =>
            PERSON_SAFE_ARCHETYPE_NAMES.includes(item.name)
        )

        return pick(personSafe.length ? personSafe : CHARACTER_ARCHETYPES)
    }

    if (profile.isAnimal) {
        const animalSafe = CHARACTER_ARCHETYPES.filter((item) =>
            ANIMAL_ARCHETYPE_NAMES.includes(item.name)
        )

        return pick(animalSafe.length ? animalSafe : CHARACTER_ARCHETYPES)
    }

    return pick(CHARACTER_ARCHETYPES)
}

function buildStyleMix(page) {
    const profile = inferWikiProfile(page)
    const formMode = chooseFormMode(profile)
    const characterArchetype = formMode.characterAllowed
        ? pickCharacterArchetype(profile)
        : null

    const styleWorld = pick(STYLE_WORLDS)

    return {
        profile,
        anchors: extractWikiAnchors(page),
        formMode,
        characterArchetype,
        styleWorld,
        world: {
            name: styleWorld,
        },
        cameraAngle: pick(CAMERA_ANGLES),
        lighting: pick(LIGHTING_STYLES),
        colorMood: pick(COLOR_MOODS),
        materials: pickMany(MATERIALS, 3),
        wardrobe: pick(WARDROBE_DETAILS),
        pose: pick(POSE_DIRECTIONS),
        sourceTransformer: pickMany(SOURCE_TRANSFORMERS, 3),
    }
}

function buildWeirdWikiPrompt(page, styleMix) {
    const title = page?.title || "Random Wikipedia Subject"
    const summary = page?.extract || ""
    const wikiImageUrl = getWikipediaImageUrl(page)
    const isPerson = Boolean(styleMix?.profile?.isPerson)

    return `
Create ONE single standalone weird photograph inspired by this Wikipedia subject.

Wikipedia topic:
${title}

Wikipedia summary:
${summary}

Wikipedia image source:
${wikiImageUrl || "No image available"}

Source anchors to visibly influence the image:
${styleMix.anchors}

Chosen image form:
${styleMix.formMode.name}
${styleMix.formMode.description}

${
    styleMix.characterArchetype
        ? `
Selected character family:
${styleMix.characterArchetype.name}

Body language / body type:
${styleMix.characterArchetype.body}

Face / head design:
${styleMix.characterArchetype.face}

Mood:
${styleMix.characterArchetype.mood}

Avoid for this character:
${styleMix.characterArchetype.avoid}

Very important:
Commit strongly to this selected character family.
Do not blend it with the other archetypes.
Do not use the default generic big-eyed mascot face unless this archetype specifically calls for it.
Do not reuse the same character head shape, eye style, mouth, or body type from previous images.
`
        : `
No-character rule:
This generation should NOT become a humanoid character.
Avoid eyes, mouth, mascot face, bald creature head, or portrait framing.
Make the source into an object, product, room, place, food, machine, specimen, prop, package, or environment.
`
}

${
    isPerson
        ? `
PERSON-SOURCE RULES:
This Wikipedia topic is a person or public figure.
Keep the image person-first and biography-inspired.
Do NOT turn this person into a random animal, dog, pet, monster, unrelated creature, or unrelated mascot.
Create a fictional stand-in inspired by the person's public role, profession, era, clothing, posture, source image composition, and career context.
Do not copy the exact face, identity, or likeness of the real person.
It should feel like a strange alternate-universe publicity photo, paparazzi photo, movie still, magazine portrait, toy figure, wax figure, TV still, or commercial portrait connected to this person.
The weird twist should come from the selected character family, camera, lighting, materials, pose, and source details — not from replacing the person with an unrelated animal.
`
        : ""
}

Visual world:
${styleMix.styleWorld}

Camera:
${styleMix.cameraAngle}

Lighting:
${styleMix.lighting}

Color mood:
${styleMix.colorMood}

Materials:
${styleMix.materials.join(", ")}

Wardrobe / surface / display detail:
${styleMix.wardrobe}

Pose / staging:
${styleMix.pose}

Source-dependent transformation rules:
${styleMix.sourceTransformer.join("\n")}

Super important variety rules:
Make this image look completely different from previous generations.
Do not reuse the same character head shape, same eye shape, same mouth, same bald mascot look, same portrait setup, or same rubber creature formula.
If this is a character, its silhouette, face, body, costume, material, setting, and mood must come from the selected character family and the Wikipedia source.
If this is not a character, do not sneak in a face.
The image must feel connected to the actual Wikipedia topic, not like a random unrelated weird creature.

Make it look like a photographed image, not polished digital fantasy art.
It can be bright, funny, awkward, surreal, colorful, domestic, commercial, documentary, toy-like, scientific, or meme-like depending on the selected style and source.
The image should feel specific enough that it could become a strange viral image.

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
    const preferPeople = process.env.WIKI_PEOPLE_BIAS === "0" ? false : true
    const batchSize = Number(process.env.WIKI_RANDOM_BATCH_SIZE || 20)

    async function fetchRandomBatch() {
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
        const pages = Object.values(data?.query?.pages || {})

        return pages.map((page) => ({
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
                ? {
                      source: page.thumbnail.source,
                  }
                : undefined,
            originalimage: page.original?.source
                ? {
                      source: page.original.source,
                  }
                : undefined,
        }))
    }

    function isValidPage(page) {
        const hasTitle = page?.title && !page.title.includes(":")
        const hasSummary = page?.extract && page.extract.length > 80
        const hasImage = Boolean(getWikipediaImageUrl(page))

        return hasTitle && hasSummary && (!requireImage || hasImage)
    }

    const pages = await fetchRandomBatch()
    const validPages = pages.filter(isValidPage)

    if (!validPages.length) {
        throw new Error("No valid Wikipedia pages found in random batch.")
    }

    if (preferPeople) {
        const peoplePages = validPages.filter((page) => {
            const profile = inferWikiProfile(page)
            return profile.isPerson
        })

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
