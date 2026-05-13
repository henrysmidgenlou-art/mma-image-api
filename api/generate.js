import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST instead." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const prompt = body?.prompt;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Prompt is required." });
    }

    if (prompt.length > 400) {
      return res.status(400).json({
        error: "Prompt is too long. Keep it under 400 characters.",
      });
    }

    const finalPrompt = `
Create a funny AI-generated meme image.

User request:
${prompt}

Style:
- funny internet meme
- crypto trader / bagholder theme
- exaggerated cartoon expression
- clean composition
- bold visual idea
- no real celebrity likeness
- no financial promises
- no hate, harassment, adult content, or graphic violence
- leave open space for meme caption text
`;

    const result = await openai.images.generate({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini",
      prompt: finalPrompt,
      size: "1024x1024",
      quality: "low",
    });

    const imageBase64 = result.data?.[0]?.b64_json;

    if (!imageBase64) {
      return res.status(500).json({ error: "No image was generated." });
    }

    return res.status(200).json({
      image: `data:image/png;base64,${imageBase64}`,
    });
  } catch (error) {
    console.error("Image generation failed:", error);
    return res.status(500).json({ error: "Image generation failed." });
  }
}
