const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const PROMPT_MODEL = process.env.OPENAI_PROMPT_MODEL || "gpt-4.1-mini";

const IMAGE_SIZE = process.env.IMAGE_SIZE || "1536x1024";
const IMAGE_QUALITY = process.env.IMAGE_QUALITY || "medium";
const IMAGE_FORMAT = process.env.IMAGE_FORMAT || "jpeg";

const USE_WIKI_IMAGE_PROMPT_BUILDER =
  process.env.USE_WIKI_IMAGE_PROMPT_BUILDER !== "false";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function isUsableImageUrl(url) {
  if (!url || typeof url !== "string") return false;

  const clean = url.toLowerCase();

  if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
    return false;
  }

  if (clean.endsWith(".svg")) return false;
  if (clean.includes(".svg?")) return false;

  return true;
}

function addHardImageRules(prompt) {
  return `
${prompt}

FINAL IMAGE RULES:
Create one single standalone image only.
Do not create a collage.
Do not create a triptych.
Do not create panels.
Do not create side-by-side images.
Do not add labels.
Do not add captions.
Do not add title text.
Do not add numbers.
Do not add readable text anywhere.
Do not add logos.
Do not add watermarks.
Do not add borders.
No gore.
No graphic injury.
No explicit violence.
Make it look intentional, strange, and visually connected to the Wikipedia source subject.
`.trim();
}

async function buildPromptFromWikiImage({
  prompt,
  wikiTitle,
  wikiSummary,
  wikiUrl,
  wikiImageUrl,
}) {
  const promptBuilderText = `
You are creating the final prompt for a weird Wikipedia image-generation tool.

Your job:
Look at the Wikipedia source image and use it as the visual subject reference.
Then combine it with the user's weird style prompt.

Wikipedia title:
${wikiTitle || "Not provided"}

Wikipedia summary:
${wikiSummary || "Not provided"}

Wikipedia URL:
${wikiUrl || "Not provided"}

User style prompt:
${prompt}

Instructions:
- Study the Wikipedia image visually.
- Identify the main subject, shape, pose, colors, materials, environment, and any recognizable visual details.
- Keep the generated image clearly inspired by that Wikipedia image and article topic.
- Do not copy the exact image.
- Transform the subject into a much weirder, uncanny, surreal version.
- Preserve enough of the source image/topic so someone can feel the connection.
- If the source is a person, do not recreate their exact face or likeness. Use a fictional generic performer inspired by the topic instead.
- Make it feel like a real analog photograph or photographed physical object, unless the prompt specifically asks for a photographed print/poster.
- Keep the vintage weird practical-effects feeling.
- No readable text in the final image.
- No labels.
- No logos.
- No watermarks.
- No gore.

Write only the final image-generation prompt.
Do not explain.
Do not use markdown.
`.trim();

  const content = [
    {
      type: "input_text",
      text: promptBuilderText,
    },
  ];

  if (isUsableImageUrl(wikiImageUrl)) {
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
    max_output_tokens: 1000,
  });

  const finalPrompt = response.output_text?.trim();

  if (!finalPrompt) {
    throw new Error("Prompt builder returned no prompt.");
  }

  return addHardImageRules(finalPrompt);
}

function buildFallbackPrompt({ prompt, wikiTitle, wikiSummary, wikiUrl, wikiImageUrl }) {
  return addHardImageRules(`
${prompt}

Extra Wikipedia context:
Title: ${wikiTitle || "Not provided"}
Summary: ${wikiSummary || "Not provided"}
URL: ${wikiUrl || "Not provided"}
Image URL: ${wikiImageUrl || "Not provided"}

Use the Wikipedia title, article summary, and image URL as the subject inspiration.
The final image should feel clearly connected to the Wikipedia topic.
If there is an image URL, visually imply the subject from that image as strongly as possible.
Do not copy the exact source image.
Transform the subject into a much weirder analog-photo version.
`);
}

async function generateImage(finalPrompt) {
  const result = await openai.images.generate({
    model: IMAGE_MODEL,
    prompt: finalPrompt,
    size: IMAGE_SIZE,
    quality: IMAGE_QUALITY,
    n: 1,
    output_format: IMAGE_FORMAT,
  });

  const image = result?.data?.[0];

  if (image?.b64_json) {
    return `data:image/${IMAGE_FORMAT};base64,${image.b64_json}`;
  }

  if (image?.url) {
    return image.url;
  }

  throw new Error("No image returned from OpenAI.");
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Use POST instead.",
    });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing OPENAI_API_KEY env var.",
      });
    }

    const {
      prompt,
      wikiTitle,
      wikiSummary,
      wikiUrl,
      wikiImageUrl,
    } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Missing prompt.",
      });
    }

    let finalPrompt;
    let promptBuilderUsed = false;
    let promptBuilderFailed = false;
    let promptBuilderError = null;

    if (USE_WIKI_IMAGE_PROMPT_BUILDER && isUsableImageUrl(wikiImageUrl)) {
      try {
        finalPrompt = await buildPromptFromWikiImage({
          prompt,
          wikiTitle,
          wikiSummary,
          wikiUrl,
          wikiImageUrl,
        });

        promptBuilderUsed = true;
      } catch (error) {
        console.warn("Wiki image prompt builder failed. Falling back.", error);

        promptBuilderFailed = true;
        promptBuilderError = error.message || "Prompt builder failed.";

        finalPrompt = buildFallbackPrompt({
          prompt,
          wikiTitle,
          wikiSummary,
          wikiUrl,
          wikiImageUrl,
        });
      }
    } else {
      finalPrompt = buildFallbackPrompt({
        prompt,
        wikiTitle,
        wikiSummary,
        wikiUrl,
        wikiImageUrl,
      });
    }

    const image = await generateImage(finalPrompt);

    return res.status(200).json({
      ok: true,
      image,
      wikiTitle: wikiTitle || null,
      wikiSummary: wikiSummary || null,
      wikiUrl: wikiUrl || null,
      wikiImageUrl: wikiImageUrl || null,
      promptBuilderEnabled: USE_WIKI_IMAGE_PROMPT_BUILDER,
      promptBuilderUsed,
      promptBuilderFailed,
      promptBuilderError,
      finalPrompt,
    });
  } catch (error) {
    console.error("generate.js error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Image generation failed.",
      stack:
        process.env.NODE_ENV !== "production"
          ? error.stack
          : undefined,
    });
  }
};
