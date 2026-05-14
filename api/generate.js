import OpenAI from "openai";

export const config = {
  maxDuration: 60,
};

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in Vercel.");
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

function cleanPrompt(prompt = "") {
  return String(prompt).replace(/\s+/g, " ").trim();
}

function makeFinalPrompt(userPrompt) {
  return `
Create a lifelike wide-angle documentary photograph based on this prompt:

${userPrompt}

Style:
- realistic photograph
- wide-angle lens
- natural lighting
- cinematic but believable
- varied composition
- no text
- no captions
- no logos
- no watermarks
`.trim();
}

async function generateImageFromPrompt(prompt) {
  const openai = getOpenAIClient();

  const finalPrompt = makeFinalPrompt(prompt);

  const image = await openai.images.generate({
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
    prompt: finalPrompt,
    size: "1024x1024",
  });

  const b64 = image?.data?.[0]?.b64_json;

  if (!b64) {
    throw new Error("OpenAI did not return image data.");
  }

  return {
    image: `data:image/png;base64,${b64}`,
    prompt: finalPrompt,
    imageBytes: Buffer.from(b64, "base64").length,
  };
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Use POST.",
    });
  }

  try {
    const prompt = cleanPrompt(req.body?.prompt);

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Missing prompt.",
      });
    }

    const generated = await generateImageFromPrompt(prompt);

    return res.status(200).json({
      success: true,
      image: generated.image,
      prompt: generated.prompt,
      imageBytes: generated.imageBytes,
    });
  } catch (error) {
    console.error("generate failed:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Image generation failed.",
      details: error.data || error.errors || null,
    });
  }
}
