const OpenAI = require("openai");
const { TwitterApi } = require("twitter-api-v2");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const PROMPT_MODEL = process.env.OPENAI_PROMPT_MODEL || "gpt-4.1-mini";

const IMAGE_SIZE = process.env.IMAGE_SIZE || "1536x1024";
const IMAGE_QUALITY = process.env.IMAGE_QUALITY || "medium";
const IMAGE_FORMAT = process.env.IMAGE_FORMAT || "jpeg";

const REQUIRE_WIKI_IMAGE = process.env.REQUIRE_WIKI_IMAGE !== "false";

// This is the new optional mode.
// Set USE_AI_PROMPT_BUILDER=false in Vercel if you want to turn it off.
const USE_AI_PROMPT_BUILDER = process.env.USE_AI_PROMPT_BUILDER !== "false";

function getTwitterClient() {
  return new TwitterApi({
    appKey: process.env.X_API_KEY || process.env.TWITTER_API_KEY,
    appSecret: process.env.X_API_SECRET || process.env.TWITTER_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET || process.env.TWITTER_ACCESS_SECRET,
  }).readWrite;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickMany(arr, count) {
  const copy = [...arr];
  const result = [];

  while (copy.length && result.length < count) {
    const index = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(index, 1)[0]);
  }

  return result;
}

const STYLE_PROMPTS = [
  "uncanny vintage flash portrait, awkward deadpan realism, soft focus, faded color film, practical effects, strange physical props",
  "1970s experimental sci-fi movie still, handmade costumes, weird helmets, surreal analog realism, physical set design",
  "low-budget practical-effects creature photo, rubber masks, prosthetics, fake skin, unsettling but believable",
  "strange 1990s found photograph, direct flash, washed-out colors, odd framing, eerie ordinary location",
  "retro sports documentary photo gone wrong, realistic fight-night setting, bizarre costume logic, grainy film look",
  "forgotten museum archive photograph, specimen-like subject, deadpan staging, clinical weirdness, analog realism",
  "surreal domestic snapshot, awkward family-photo energy, unsettling expressions, strange creature-like costumes",
  "weird public-access television still, harsh studio lighting, eccentric props, analog video-to-photo feeling",
  "obscure European art-film still, soft cinematic blur, theatrical staging, unsettling surreal subject",
  "flash photo from a strange backstage event, sweaty practical effects, awkward pose, raw documentary realism",
  "colorful absurdist costume photograph, handmade textures, oversized props, weird but physically real",
  "body-horror inspired practical makeup photo, non-graphic, distorted features, prosthetic transformation, vintage film still",
  "inflatable latex-like surrealism, glossy artificial skin, strange air-filled shapes, direct flash realism",
  "black-and-white psychological portrait, huge uncanny eyes, theatrical shadows, old archive photograph",
  "bright surreal 1960s color photograph, playful but disturbing props, strange fashion, soft faded film grain",
];

const CAMERA_ANGLES = [
  "shot from a low wide-angle perspective, making the subject feel huge and awkward",
  "shot from slightly above with an uncomfortable documentary angle",
  "tight close-up with distorted wide-angle facial proportions",
  "medium shot, straight-on, deadpan mugshot-like framing",
  "off-center candid framing like the photographer barely caught the moment",
  "wide shot with the subject oddly small inside a strange environment",
  "side-profile angle with the subject staring past the camera",
  "low ringside angle like a fight photographer is crouched near the mat",
  "awkward point-and-shoot snapshot angle with imperfect composition",
  "slightly tilted frame, as if from an old disposable camera",
];

const LENS_TYPES = [
  "24mm wide-angle lens",
  "28mm documentary lens",
  "35mm point-and-shoot lens",
  "50mm vintage portrait lens",
  "fisheye-adjacent wide lens with subtle distortion",
  "cheap disposable camera lens",
  "old flash-camera lens with slight softness",
  "soft telephoto portrait lens",
  "grainy VHS-era still-photo look",
  "macro-like close-up lens for unsettling detail",
];

const LIGHTING_STYLES = [
  "harsh direct flash with deep shadows behind the subject",
  "dim locker-room fluorescent lighting",
  "eerie overhead arena lighting",
  "warm sunset light through dirty windows",
  "cold blue night lighting with heavy shadows",
  "washed-out noon daylight in an ordinary outdoor space",
  "red-orange stage lighting like a strange performance",
  "greenish institutional hallway lighting",
  "single bare bulb lighting from above",
  "bright 1960s studio lighting with soft shadows",
  "overexposed flash reflection on glossy surfaces",
  "moody underlit horror-movie lighting, but still photographic",
];

const COLOR_GRADES = [
  "faded 1970s color film",
  "washed-out 1990s drugstore photo colors",
  "muddy brown and orange tones",
  "sickly green fluorescent color cast",
  "cold blue and gray tones",
  "warm yellow indoor flash tones",
  "bright surreal candy colors with analog grain",
  "muted museum-photo colors",
  "high-contrast black-and-white archive photo",
  "slightly magenta expired-film color shift",
  "sun-bleached outdoor color palette",
  "dark red stage-light color cast",
];

const SETTINGS = [
  "a grimy MMA locker room",
  "a small local fight arena after hours",
  "a strange empty gymnasium",
  "a tiled bathroom with a mirror",
  "a plain suburban living room",
  "a public park with bare trees",
  "a dim museum storage room",
  "a low-budget television studio",
  "a backstage curtain area",
  "a weird laboratory room with old equipment",
  "an empty ice rink",
  "a motel room with bad lighting",
  "a concrete hallway under fluorescent lights",
  "an outdoor field at dusk",
  "a basement training space",
];

const WEIRDNESS_MODIFIERS = [
  "make the subject appear physically wrong in a believable practical-effects way",
  "include oversized staring eyes or an uncanny blank expression",
  "use handmade masks, fake skin, prosthetics, or rubber costume pieces",
  "add awkward human posture that makes the subject feel real and uncomfortable",
  "make the scene feel like a found photograph from a parallel reality",
  "include glossy artificial textures, latex, plastic, slime, fur, foam, or rubber",
  "make it look like a real person wearing an extremely disturbing costume",
  "add strange protective fight gear that barely makes sense",
  "create a surreal mismatch between an ordinary location and an impossible subject",
  "make the subject look like it is preparing for a bizarre underground fight",
  "make it unsettling without blood, gore, or graphic injury",
  "use physical props that look handmade and low-budget",
  "make the pose stiff, awkward, and deadpan",
  "make the image feel like an old archive photo nobody can explain",
];

const TEXTURE_MODIFIERS = [
  "wet rubbery skin",
  "powdery moth-like fuzz",
  "cracked latex",
  "peeling prosthetic makeup",
  "glossy inflatable surfaces",
  "faded fabric costume seams",
  "old foam creature-suit texture",
  "hand-painted mask details",
  "dusty museum-object surfaces",
  "sweaty fight-gear leather",
  "muddy preserved-earth texture",
  "cheap plastic helmet reflections",
];

function buildStyleMix() {
  return {
    style: pick(STYLE_PROMPTS),
    cameraAngle: pick(CAMERA_ANGLES),
    lens: pick(LENS_TYPES),
    lighting: pick(LIGHTING_STYLES),
    colorGrade: pick(COLOR_GRADES),
    setting: pick(SETTINGS),
    weirdness: pickMany(WEIRDNESS_MODIFIERS, 3),
    textures: pickMany(TEXTURE_MODIFIERS, 3),
  };
}

function getWikipediaImageUrl(page) {
  return page?.originalimage?.source || page?.thumbnail?.source || null;
}

function getWikipediaPageUrl(page) {
  return (
    page?.content_urls?.desktop?.page ||
    page?.content_urls?.mobile?.page ||
    page?.url ||
    `https://en.wikipedia.org/wiki/${encodeURIComponent(
      String(page?.title || "Random").replaceAll(" ", "_")
    )}`
  );
}

async function fetchRandomWikipediaPage() {
  let lastGoodPage = null;

  for (let i = 0; i < 15; i++) {
    const response = await fetch(
      "https://en.wikipedia.org/api/rest_v1/page/random/summary",
      {
        headers: {
          "User-Agent": "weird-wiki-fight-bot/1.0",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Wikipedia request failed with status ${response.status}`);
    }

    const page = await response.json();

    const hasTitle = page?.title && !page.title.includes(":");
    const hasSummary = page?.extract && page.extract.length > 80;
    const notDisambiguation = page?.type !== "disambiguation";
    const hasImage = Boolean(getWikipediaImageUrl(page));

    if (hasTitle && hasSummary && notDisambiguation) {
      lastGoodPage = page;

      if (!REQUIRE_WIKI_IMAGE || hasImage) {
        return page;
      }
    }
  }

  if (lastGoodPage) return lastGoodPage;

  throw new Error("Could not find a usable random Wikipedia page.");
}

function makeTickerFromTitle(title) {
  const blacklist = new Set([
    "the",
    "a",
    "an",
    "of",
    "and",
    "or",
    "in",
    "on",
    "at",
    "to",
    "for",
    "from",
    "by",
    "with",
  ]);

  const clean = String(title || "WIKI")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ");

  const words = clean
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  const picked =
    words.find((w) => !blacklist.has(w.toLowerCase()) && w.length > 1) ||
    words[0] ||
    "WIKI";

  return picked.toUpperCase().slice(0, 12);
}

function buildPostText(page) {
  const ticker = makeTickerFromTitle(page.title);
  const wikiUrl = getWikipediaPageUrl(page);

  return `$${ticker}\n${wikiUrl}`;
}

function addHardNoTextRules(prompt) {
  return `
${prompt}

ABSOLUTE IMAGE RULES:
This must be ONE single standalone photograph.
Do not create a collage.
Do not create a triptych.
Do not create a contact sheet.
Do not create panels.
Do not create side-by-side images.
Do not add labels.
Do not add captions.
Do not add title text.
Do not add numbers.
Do not add any readable text anywhere.
Do not add logos.
Do not add watermarks.
Do not add borders.
No gore.
No graphic injury.
No explicit violence.
No cartoon style.
No polished digital fantasy art.
`.trim();
}

function buildFallbackImagePrompt(page, styleMix) {
  const wikiImageUrl = getWikipediaImageUrl(page);

  return addHardNoTextRules(`
Create ONE single standalone bizarre analog photograph inspired by this Wikipedia subject.

Wikipedia topic:
${page.title}

Wikipedia summary:
${page.extract}

Wikipedia source image:
${wikiImageUrl || "No source image available"}

Use the Wikipedia topic and its source image idea as inspiration for the subject.
Do not copy the Wikipedia image exactly.
Transform the subject into a much weirder physical, uncanny, surreal version while keeping it somewhat recognizable.

Visual style:
${styleMix.style}

Camera:
${styleMix.cameraAngle}, ${styleMix.lens}

Lighting and color:
${styleMix.lighting}, ${styleMix.colorGrade}

Setting:
${styleMix.setting}

Weirdness:
${styleMix.weirdness.join(". ")}

Textures:
${styleMix.textures.join(", ")}

Make it look like a real analog photograph from the 1960s through 1990s.
Use practical effects, masks, prosthetics, strange costumes, rubber, latex, foam, handmade props, awkward posing, film grain, soft focus, faded colors, direct flash, and deadpan documentary realism.

If the Wikipedia topic is a real person, do not recreate their exact face or likeness.
Use a fictional generic performer inspired by the topic instead.
`);
}

async function buildImagePromptWithAI(page, styleMix) {
  const wikiImageUrl = getWikipediaImageUrl(page);
  const wikiUrl = getWikipediaPageUrl(page);

  const promptBuilderInstructions = `
You are writing ONE final image-generation prompt for a weird random Wikipedia MMA image bot.

Wikipedia topic:
${page.title}

Wikipedia summary:
${page.extract}

Wikipedia URL:
${wikiUrl}

Random visual mix to include:
- Style: ${styleMix.style}
- Camera angle: ${styleMix.cameraAngle}
- Lens: ${styleMix.lens}
- Lighting: ${styleMix.lighting}
- Color grade: ${styleMix.colorGrade}
- Setting: ${styleMix.setting}
- Weirdness: ${styleMix.weirdness.join("; ")}
- Textures: ${styleMix.textures.join("; ")}

Use the Wikipedia image as source inspiration when available.
Do not copy the image exactly.
Transform the main subject into a much weirder analog-photo version.

Write only the final image prompt.
Do not add quotes.
Do not add explanation.

Important rules for the final image prompt:
- It must describe ONE single standalone photograph.
- No collage.
- No triptych.
- No split-screen.
- No panels.
- No labels.
- No captions.
- No readable text anywhere in the image.
- No logos.
- No watermarks.
- Make it look like a real analog photograph, not a digital illustration.
- Keep the Wikipedia subject somewhat recognizable.
- If the Wikipedia topic is a real person, do not recreate their exact face or likeness; use a fictional generic performer inspired by the topic instead.
- Keep it weird, surreal, awkward, unsettling, and funny in a disturbing way.
- Use practical effects, masks, costumes, prosthetics, inflatables, props, fake skin, rubber, latex, foam, or handmade creature effects.
- Keep a loose MMA / underground fight-night feeling when it fits naturally.
- No gore, no graphic injury, no explicit violence.
`;

  const content = [
    {
      type: "input_text",
      text: promptBuilderInstructions,
    },
  ];

  if (wikiImageUrl) {
    content.push({
      type: "input_image",
      image_url: wikiImageUrl,
      detail: "low",
    });
  }

  const response = await openai.responses.create({
    model: PROMPT_MODEL,
    input: [
      {
        role: "user",
        content,
      },
    ],
    max_output_tokens: 900,
  });

  const finalPrompt = response.output_text?.trim();

  if (!finalPrompt) {
    throw new Error("AI prompt builder returned no prompt.");
  }

  return addHardNoTextRules(finalPrompt);
}

async function generateImageBuffer(prompt) {
  const result = await openai.images.generate({
    model: IMAGE_MODEL,
    prompt,
    size: IMAGE_SIZE,
    quality: IMAGE_QUALITY,
    n: 1,
    output_format: IMAGE_FORMAT,
  });

  const image = result?.data?.[0];

  if (image?.b64_json) {
    return Buffer.from(image.b64_json, "base64");
  }

  if (image?.url) {
    const imageResponse = await fetch(image.url);

    if (!imageResponse.ok) {
      throw new Error(
        `Could not download generated image: ${imageResponse.status}`
      );
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  throw new Error("No image data returned from OpenAI.");
}

async function uploadImageToX(imageBuffer) {
  const twitterClient = getTwitterClient();

  const mimeType = IMAGE_FORMAT === "png" ? "image/png" : "image/jpeg";

  const mediaId = await twitterClient.v1.uploadMedia(imageBuffer, {
    mimeType,
  });

  return mediaId;
}

async function postToX(text, imageBuffer) {
  const twitterClient = getTwitterClient();
  const mediaId = await uploadImageToX(imageBuffer);

  const tweet = await twitterClient.v2.tweet({
    text,
    media: {
      media_ids: [mediaId],
    },
  });

  return tweet;
}

function checkRequiredEnvVars({ needsX, needsPromptBuilder }) {
  const missing = [];

  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");

  if (needsPromptBuilder && !process.env.OPENAI_API_KEY) {
    missing.push("OPENAI_API_KEY");
  }

  if (needsX) {
    if (!process.env.X_API_KEY && !process.env.TWITTER_API_KEY) {
      missing.push("X_API_KEY");
    }

    if (!process.env.X_API_SECRET && !process.env.TWITTER_API_SECRET) {
      missing.push("X_API_SECRET");
    }

    if (!process.env.X_ACCESS_TOKEN && !process.env.TWITTER_ACCESS_TOKEN) {
      missing.push("X_ACCESS_TOKEN");
    }

    if (!process.env.X_ACCESS_SECRET && !process.env.TWITTER_ACCESS_SECRET) {
      missing.push("X_ACCESS_SECRET");
    }
  }

  if (missing.length) {
    throw new Error(`Missing env vars: ${[...new Set(missing)].join(", ")}`);
  }
}

async function runBot({ debug = false, skipImage = false }) {
  checkRequiredEnvVars({
    needsX: !debug && !skipImage,
    needsPromptBuilder: USE_AI_PROMPT_BUILDER,
  });

  const page = await fetchRandomWikipediaPage();
  const styleMix = buildStyleMix();

  const postText = buildPostText(page);
  const wikiUrl = getWikipediaPageUrl(page);
  const wikiImageUrl = getWikipediaImageUrl(page);

  let imagePrompt;
  let promptBuilderUsed = false;
  let promptBuilderFailed = false;
  let promptBuilderError = null;

  if (USE_AI_PROMPT_BUILDER) {
    try {
      imagePrompt = await buildImagePromptWithAI(page, styleMix);
      promptBuilderUsed = true;
    } catch (error) {
      console.warn("AI prompt builder failed. Falling back.", error);
      promptBuilderFailed = true;
      promptBuilderError = error.message || "Prompt builder failed.";
      imagePrompt = buildFallbackImagePrompt(page, styleMix);
    }
  } else {
    imagePrompt = buildFallbackImagePrompt(page, styleMix);
  }

  if (skipImage) {
    return {
      ok: true,
      debug,
      skippedImage: true,
      posted: false,
      promptBuilderEnabled: USE_AI_PROMPT_BUILDER,
      promptBuilderUsed,
      promptBuilderFailed,
      promptBuilderError,
      wikiTitle: page.title,
      wikiUrl,
      wikiImageUrl,
      postText,
      imagePrompt,
      styleMix,
    };
  }

  const imageBuffer = await generateImageBuffer(imagePrompt);

  let tweet = null;

  if (!debug) {
    tweet = await postToX(postText, imageBuffer);
  }

  return {
    ok: true,
    debug,
    posted: !debug,
    promptBuilderEnabled: USE_AI_PROMPT_BUILDER,
    promptBuilderUsed,
    promptBuilderFailed,
    promptBuilderError,
    wikiTitle: page.title,
    wikiUrl,
    wikiImageUrl,
    postText,
    imageBytes: imageBuffer.length,
    imagePrompt,
    styleMix,
    tweet,
  };
}

module.exports = async function handler(req, res) {
  try {
    const query = req.query || {};

    const secretFromRequest =
      query.secret ||
      req.headers["x-cron-secret"] ||
      req.headers["authorization"];

    if (process.env.CRON_SECRET) {
      const expectedA = process.env.CRON_SECRET;
      const expectedB = `Bearer ${process.env.CRON_SECRET}`;

      if (secretFromRequest !== expectedA && secretFromRequest !== expectedB) {
        return res.status(401).json({
          ok: false,
          error: "Unauthorized. Missing or incorrect cron secret.",
        });
      }
    }

    const debug = query.debug === "1" || query.dry === "1";
    const skipImage = query.skipImage === "1" || query.promptOnly === "1";

    const result = await runBot({
      debug,
      skipImage,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("x-random bot error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Unknown error",
      stack: process.env.NODE_ENV !== "production" ? error.stack : undefined,
    });
  }
};
