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
        ]),
    }
}

const FORM_MODES = [
    {
        name: "Strange Product Photo",
        characterAllowed: false,
        description:
            "do not make a character; turn the source into a bizarre physical product, prototype, appliance, toy, gadget, package, or catalog object",
    },
    {
        name: "Room / Environment Scene",
        characterAllowed: false,
        description:
            "do not make a character; turn the source into a strange room, staged environment, hallway, office, bathroom, bedroom, gym, or miniature set",
    },
    {
        name: "Museum Object / Specimen",
        characterAllowed: false,
        description:
            "do not make a humanoid; present the source as an artifact, specimen, preserved object, sculpture, fossil-like thing, or unexplained museum item",
    },
    {
        name: "Food / Object Close-Up",
        characterAllowed: false,
        description:
            "do not make a person; turn the source into a weird close-up of food, material, texture, household object, mechanical part, or physical prop",
    },
    {
        name: "Toy / Packaging / Catalog",
        characterAllowed: false,
        description:
            "do not default to a living being; make the source feel like a toy, boxed object, product catalog photo, shelf display, or fake commercial item",
    },
    {
        name: "Architectural / Place Photo",
        characterAllowed: false,
        description:
            "do not make a mascot; translate the source into a strange building, landscape, room, monument, stage set, or location photograph",
    },
    {
        name: "Animal / Field Discovery",
        characterAllowed: true,
        description:
            "only use a creature if the source supports it; make it feel like a field-guide discovery, strange animal documentation, or wildlife snapshot",
    },
    {
        name: "Human Portrait / Meme Photo",
        characterAllowed: true,
        description:
            "use a person only if the source supports it; create a fictional human, performer, awkward portrait, or meme-like snapshot without copying a real likeness",
    },
    {
        name: "Mascot / Costume / Performer",
        characterAllowed: true,
        description:
            "a mascot or costumed performer is allowed, but avoid the same bald head, giant eyes, and generic creature formula",
    },
    {
        name: "Abstract Physical Prop",
        characterAllowed: false,
        description:
            "do not make a face; turn the source into an abstract real-world prop, sculpture, machine, texture, diagram-like object, or impossible handmade construction",
    },
]

const STYLE_WORLDS = [
    {
        name: "Bright Absurd Commercial",
        description:
            "a brightly lit, silly, colorful commercial-style photo, playful and bizarre, exaggerated but still photographic",
    },
    {
        name: "Weird Family Snapshot",
        description:
            "a surreal family snapshot, awkward but sincere, physically real, mundane setting turned bizarre",
    },
    {
        name: "Low-Budget Sci-Fi Still",
        description:
            "a cheap but memorable science-fiction movie still, practical effects, theatrical set design, cinematic but awkward",
    },
    {
        name: "Mall Portrait Studio",
        description:
            "a stiff portrait-studio photo with fake backdrop, awkward pose, over-serious energy, uncanny normality",
    },
    {
        name: "Tabloid Shock Photo",
        description:
            "a sensational tabloid-style image, direct flash, caught-at-the-wrong-moment energy, strange but believable",
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
            "a cursed office-training still, beige realism, serious instructional pose, deeply awkward energy",
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
            "a low-resolution viral-looking image, funny and unsettling, awkward flash, strange proportions, meme-like realism",
    },
    {
        name: "Aquarium Bathroom Diorama",
        description:
            "a surreal bathroom or aquarium-like set, wet blue lighting, coral textures, porcelain objects, absurd placement",
    },
    {
        name: "1970s Epoxy Puppet / Object Photo",
        description:
            "a glossy synthetic object or puppet-like prop, epoxy acrylic surface, rounded forms, theatrical 1970s lighting",
    },
    {
        name: "Food Magazine Gone Wrong",
        description:
            "a bright old food-magazine photograph, strange edible forms, staged plates, glossy highlights, funny but physically real",
    },
    {
        name: "Hardware Store Catalog",
        description:
            "a plain product photograph of tools, objects, parts, shelves, labels removed, practical and weirdly serious",
    },
    {
        name: "School Science Fair Display",
        description:
            "a handmade poster-board or science-fair style display, awkward craft materials, physical model, fluorescent room lighting",
    },
    {
        name: "Miniature Model Set",
        description:
            "a tabletop miniature scene, model railroad realism, tiny props, visible handmade scale details, photographed close",
    },
]

const CAMERA_ANGLES = [
    "extreme low angle looking upward, making the source feel giant and ridiculous",
    "high angle looking down from above, making the source look trapped, small, or clinical",
    "tight close-up filling the frame with object texture or subject detail",
    "wide-angle full scene shot with exaggerated perspective",
    "awkward off-center snapshot framing like the photographer reacted too late",
    "front-facing deadpan documentation framing",
    "fisheye-like near-camera distortion",
    "medium shot with too much empty space around the subject",
    "point-of-view angle as if the camera stumbled into the scene",
    "doorway or hallway angle, peeking into the situation",
    "floor-level shot looking slightly upward",
    "surveillance-like overhead angle",
    "backlit silhouette shot with the subject mostly in shadow",
    "heroic promotional angle like a product poster gone wrong",
    "awkward posed school-photo angle only if a person or mascot is appropriate",
    "slightly tilted dutch-angle composition",
    "macro-close detail shot of material, food, machinery, surface, or artifact",
    "wide lens inches from the object, making proportions feel huge and warped",
    "straight-on product catalog composition with blank serious framing",
    "low camera near the ground with the source looming overhead",
    "close flash snapshot with harsh shadows on the wall behind",
    "long hallway perspective with the subject or object at the end",
    "square cropped internet image framing with too much subject and not enough context",
    "museum inventory angle, centered and emotionless",
    "tabletop photography angle looking slightly down at a strange object",
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
    "golden-hour sunlight that makes the absurd source look beautiful",
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
    "hardware-store fluorescent lighting",
    "school classroom lighting",
    "museum display-case lighting",
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
    "hyper-bright blue sky and clean beige tones",
    "glossy green sci-fi colors",
    "aquarium blues, coral pinks, and toilet porcelain whites",
    "low-res internet browns and muddy indoor shadows",
    "soft suburban brick-wall reds and corn-yellow highlights",
    "oversaturated meme-image colors with awkward compression",
    "bright food-ad reds, yellows, and shiny highlights",
    "museum beige, dusty gray, and aged paper tones",
    "primary-color toy plastic palette",
]

const OBJECT_DIRECTIONS = [
    "make it a physical object with no face",
    "make it a product photo with no character",
    "make it an environment or room scene instead of a portrait",
    "make it a strange artifact on a table",
    "make it a handmade model or miniature set",
    "make it a weird household object photographed seriously",
    "make it a fake commercial product",
    "make it a scientific specimen or archive object",
    "make it an architectural or landscape transformation",
    "make it a food, machine, prop, package, or display when appropriate",
    "avoid eyes, mouth, face, or humanoid body unless the source truly supports it",
    "avoid the same mascot-head formula; let the Wikipedia source decide the form",
]

const CHARACTER_DIRECTIONS = [
    "only make a character if the Wikipedia source supports a person, animal, performer, mascot, or creature",
    "if a character appears, make their silhouette and materials specific to the Wikipedia source",
    "avoid generic bald humanoid heads",
    "avoid repeating the same giant-eye mascot look",
    "make the pose and costume highly specific rather than a reusable creature portrait",
    "use a fictional performer or costume if the source is a real person",
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
    "epoxy acrylic, glassy surfaces, shiny green plastic, synthetic material",
    "low-resolution compressed textures, weird smoothing, meme artifacting",
    "oversized food texture, kernels, soft flesh tones, and brick-wall background",
    "coral reef textures, toilet porcelain, blue water light, rubber surfaces",
    "wood, screws, chipped paint, dust, metal brackets, and handmade seams",
    "paper labels removed, cardboard display stands, clear plastic packaging",
    "stone, concrete, moss, old brick, landscape texture, and miniature terrain",
]

const COMPOSITION_GAGS = [
    "place the source too close to the camera",
    "make one part of the object or scene appear huge because of lens distortion",
    "use too much empty space for awkward comedy",
    "frame the source as if it is way more important than it should be",
    "present the bizarre object or scene with absurd dignity",
    "treat the bizarre source like it belongs in a completely normal photo",
    "contrast a silly subject with a serious composition",
    "make the image feel like an accidental masterpiece",
    "pose the source in front of a plain wall as if nothing is wrong",
    "make the camera angle make the source look unexpectedly monumental",
    "stage it like a product demonstration gone wrong",
    "place a bizarre object or scene in a bathroom, hallway, backyard, office, or store without explanation",
    "make it look like a real listing photo for something nobody should own",
    "make it look like a museum catalog image for an object nobody can explain",
]

const BRIGHT_FUN_ENHANCERS = [
    "lean into bright, cheerful colors when appropriate",
    "allow playful, silly energy instead of always eerie energy",
    "favor bold visual contrast and memorable shapes",
    "make the image visually loud if the source allows it",
    "let the humor come from the photo feeling real",
    "make it feel like a viral image people cannot stop staring at",
    "make it look funnier, brighter, and more specific than a generic horror image",
    "let the absurdity be instantly readable even before someone knows the Wikipedia source",
]

function chooseWeighted(options, extra = []) {
    const pool = [...options, ...extra].filter(Boolean)
    return pick(pool)
}

function chooseFormMode(profile) {
    const extras = []

    if (profile.isPerson) {
        extras.push(
            FORM_MODES.find((x) => x.name === "Human Portrait / Meme Photo"),
            FORM_MODES.find((x) => x.name === "Mascot / Costume / Performer"),
            FORM_MODES.find((x) => x.name === "Room / Environment Scene")
        )
    }

    if (profile.isAnimal) {
        extras.push(
            FORM_MODES.find((x) => x.name === "Animal / Field Discovery"),
            FORM_MODES.find((x) => x.name === "Museum Object / Specimen"),
            FORM_MODES.find((x) => x.name === "Room / Environment Scene")
        )
    }

    if (profile.isPlace) {
        extras.push(
            FORM_MODES.find((x) => x.name === "Architectural / Place Photo"),
            FORM_MODES.find((x) => x.name === "Room / Environment Scene"),
            FORM_MODES.find((x) => x.name === "Miniature Model Set")
        )
    }

    if (profile.isObject || profile.isMedia) {
        extras.push(
            FORM_MODES.find((x) => x.name === "Strange Product Photo"),
            FORM_MODES.find((x) => x.name === "Toy / Packaging / Catalog"),
            FORM_MODES.find((x) => x.name === "Abstract Physical Prop")
        )
    }

    if (profile.isScience) {
        extras.push(
            FORM_MODES.find((x) => x.name === "Museum Object / Specimen"),
            FORM_MODES.find((x) => x.name === "Abstract Physical Prop")
        )
    }

    if (profile.isFood) {
        extras.push(
            FORM_MODES.find((x) => x.name === "Food / Object Close-Up"),
            FORM_MODES.find((x) => x.name === "Strange Product Photo")
        )
    }

    if (!profile.isPerson && !profile.isAnimal) {
        extras.push(
            FORM_MODES.find((x) => x.name === "Strange Product Photo"),
            FORM_MODES.find((x) => x.name === "Room / Environment Scene"),
            FORM_MODES.find((x) => x.name === "Museum Object / Specimen"),
            FORM_MODES.find((x) => x.name === "Toy / Packaging / Catalog"),
            FORM_MODES.find((x) => x.name === "Abstract Physical Prop")
        )
    }

    return chooseWeighted(FORM_MODES, extras)
}

function buildStyleMix(page) {
    const profile = inferWikiProfile(page)
    const formMode = chooseFormMode(profile)

    const styleWorldExtras = []
    const angleExtras = []
    const lightingExtras = []
    const colorExtras = []
    const materialExtras = []
    const directionExtras = []

    if (profile.isPerson) {
        styleWorldExtras.push(
            STYLE_WORLDS.find((x) => x.name === "Mall Portrait Studio"),
            STYLE_WORLDS.find((x) => x.name === "Tabloid Shock Photo"),
            STYLE_WORLDS.find((x) => x.name === "Heroic Giant Perspective"),
            STYLE_WORLDS.find((x) => x.name === "Cursed Internet Meme Photo")
        )
        angleExtras.push(
            "extreme low-angle portrait making the person seem absurdly powerful, only if a person is used",
            "tight documentary close-up with unsettling human detail, only if a person is used",
            "wide lens close-up where the face and hands become too large, only if a person is used"
        )
        directionExtras.push(...CHARACTER_DIRECTIONS)
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
        directionExtras.push(
            "make the animal or creature form specific to the source, not a generic monster",
            "avoid turning every animal into the same humanoid mascot"
        )
    }

    if (profile.isObject || profile.isMedia) {
        styleWorldExtras.push(
            STYLE_WORLDS.find((x) => x.name === "Toy / Catalog Photo"),
            STYLE_WORLDS.find((x) => x.name === "Museum Archive Documentation"),
            STYLE_WORLDS.find((x) => x.name === "Bright Absurd Commercial"),
            STYLE_WORLDS.find((x) => x.name === "Hardware Store Catalog")
        )
        materialExtras.push(
            "hard glossy product surfaces and packaging-like realism",
            "toy plastic, molded seams, bright paint, and catalog reflections"
        )
        directionExtras.push(...OBJECT_DIRECTIONS)
    }

    if (profile.isPlace) {
        styleWorldExtras.push(
            STYLE_WORLDS.find((x) => x.name === "Heroic Giant Perspective"),
            STYLE_WORLDS.find((x) => x.name === "Bright Absurd Commercial"),
            STYLE_WORLDS.find((x) => x.name === "Miniature Model Set")
        )
        angleExtras.push(
            "dramatic wide perspective that exaggerates scale and makes the location feel absurd"
        )
        directionExtras.push(
            "make it a place, room, building, model, landscape, or monument instead of a character"
        )
    }

    if (profile.isScience) {
        styleWorldExtras.push(
            STYLE_WORLDS.find((x) => x.name === "Museum Archive Documentation"),
            STYLE_WORLDS.find((x) => x.name === "Field Guide Discovery"),
            STYLE_WORLDS.find((x) => x.name === "Low-Budget Sci-Fi Still"),
            STYLE_WORLDS.find((x) => x.name === "School Science Fair Display")
        )
        directionExtras.push(
            "make it a specimen, diagram-like physical model, apparatus, or science fair object"
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

    if (profile.isFood) {
        styleWorldExtras.push(
            STYLE_WORLDS.find((x) => x.name === "Food Magazine Gone Wrong"),
            STYLE_WORLDS.find((x) => x.name === "Bright Absurd Commercial")
        )
        colorExtras.push(
            "bright food-ad reds, yellows, and shiny highlights",
            "surreal candy-color palette"
        )
        directionExtras.push(
            "make it food, packaging, texture, table setting, or kitchen object rather than a character"
        )
    }

    if (profile.isFunnyOrAbsurd) {
        colorExtras.push(
            "ultra-bright playful colors",
            "ridiculous but lovable color combinations",
            "oversaturated meme-image colors with awkward compression"
        )
        directionExtras.push(
            "lean into ridiculous humor while keeping it photographic",
            "make it silly through the situation, object, setting, or composition, not only through a face"
        )
    }

    if (!profile.isPerson && !profile.isAnimal) {
        directionExtras.push(...OBJECT_DIRECTIONS)
    }

    return {
        profile,
        formMode,
        world: chooseWeighted(STYLE_WORLDS, styleWorldExtras),
        cameraAngle: chooseWeighted(CAMERA_ANGLES, angleExtras),
        lighting: chooseWeighted(LIGHTING_STYLES, lightingExtras),
        colorMood: chooseWeighted(COLOR_MOODS, colorExtras),
        materials: chooseWeighted(MATERIALS, materialExtras),
        direction1: chooseWeighted(OBJECT_DIRECTIONS, directionExtras),
        direction2: chooseWeighted(OBJECT_DIRECTIONS, directionExtras),
        direction3: chooseWeighted(COMPOSITION_GAGS, directionExtras),
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

Core instruction:
Use the Wikipedia topic, text information, and source image as inspiration.
The final image should be strongly shaped by what the source actually is.
Do NOT use one generic weird character formula every time.

Chosen image form:
${styleMix.formMode.name}
${styleMix.formMode.description}

Visual world:
${styleMix.world.name}
${styleMix.world.description}

Camera angle:
${styleMix.cameraAngle}

Lighting:
${styleMix.lighting}

Color mood:
${styleMix.colorMood}

Materials / texture:
${styleMix.materials}

Composition idea:
${styleMix.composition}

Specific variation directions:
${styleMix.direction1}
${styleMix.direction2}
${styleMix.direction3}

Extra energy:
${styleMix.brightFun}

Important anti-repetition rules:
Do not default to a humanoid character.
Do not reuse the same bald head, big eyes, tiny mouth, mascot face, or creature portrait formula.
If the Wikipedia topic is not clearly about a person or animal, avoid making a face entirely.
Let the subject become a scene, object, product, place, food, machine, specimen, prop, display, room, landscape, architecture, package, toy, or environment.
Only make a person, mascot, or creature when the chosen image form and Wikipedia source support it.
If a person appears, make it fictional and transformed, not a copy of any real person.
If a character appears, their shape, materials, costume, and setting must be specific to the Wikipedia source, not generic.

Use a broad range that can include:
- strange product photography
- weird room or environment scenes
- museum objects and specimen photos
- food/object close-ups
- toy packaging and catalog photos
- architectural/place transformations
- field-guide discoveries
- meme-like snapshots
- public-access TV stills
- bright surreal commercial photography
- low-angle giant-perspective photos
- fish-eye or close-lens distortion
- domestic absurdity
- practical effects, handmade props, and physical materials

Make it look like a photographed image, not a polished digital illustration.
It can be bright, funny, awkward, surreal, or slightly disturbing depending on the topic.
Let the Wikipedia subject determine which direction makes the most sense.
The image should feel like it could become a strange viral image because of its specificity.

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
