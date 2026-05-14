import OpenAI from "openai";
import { addRecentGeneration } from "./_recent-store.js";

export const config = {
  maxDuration: 60,
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeTickerFromTitle(title = "") {
  const cleanedTitle = String(title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "SS")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim();

  const words = cleanedTitle
    .split(/[\s-]+/)
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean);

  let ticker = words[0] || "WIKI";

  ticker = ticker.toUpperCase().slice(0, 10);

  if (!ticker) ticker = "WIKI";

  return `$${ticker}`;
}

async function fetchRandomWikipedia() {
  const userAgent =
    "RamonRandomWikiBot/1.0 (https://mma-image-api.vercel.app; contact: swielechowski@gmail.com)";

  const urls = [
    "https://en.wikipedia.org/w/api.php?action=query&format=json&generator=random&grnnamespace=0&prop=extracts|info&exintro=1&explaintext=1&inprop=url&origin=*",
    "https://en.wikipedia.org/api/rest_v1/page/random/summary",
  ];

  for (const url of urls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await fetch(url, {
        headers: {
          "User-Agent": userAgent,
          "Api-User-Agent": userAgent,
          Accept: "application/json",
        },
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const waitTime = retryAfter
          ? Number(retryAfter) * 1000
          : 2000 * attempt;

        await sleep(waitTime);
        continue;
      }

      if (!response.ok) {
        await sleep(1000 * attempt);
        continue;
      }

      const data = await response.json();

      if (data?.query?.pages) {
        const page = Object.values(data.query.pages)[0];

        return {
          title: page.title || "Random Wikipedia",
          extract: page.extract || page.title || "",
          url: page.fullurl || `https://en.wikipedia.org/?curid=${page.pageid}`,
        };
      }

      if (data?.title) {
        return {
          title: data.title || "Random Wikipedia",
          extract: data.extract || data.title || "",
          url:
            data.content_urls?.desktop?.page ||
            data.content_urls?.mobile?.page ||
            `https://en.wikipedia.org/wiki/${encodeURIComponent(data.title)}`,
        };
      }
    }
  }

  throw new Error("Wikipedia fetch failed after retries.");
}

function makeImagePrompt(wiki) {
  return `
Create a lifelike wide-angle documentary photograph inspired by this random Wikipedia topic.

Topic:
${wiki.title}

Context:
${wiki.extract || wiki.title}

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
- do not make every image look the same
- base the scene only on the Wikipedia topic
`.trim();
}

async function generateImage(wiki) {
  const prompt = makeImagePrompt(wiki);

  const image = await openai.images.generate({
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
    prompt,
    size: "1024x1024",
  });

  const b64 = image?.data?.[0]?.b64_json;

  if (!b64) {
    throw new Error("OpenAI did not return image data.");
  }

  return {
    image: `data:image/png;base64,${b64}`,
    prompt,
    imageBytes: Buffer.from(b64, "base64").length,
  };
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      success: false,
      error: "Use GET or POST.",
    });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "Missing OPENAI_API_KEY in Vercel.",
      });
    }

    const wiki = await fetchRandomWikipedia();
    const ticker = makeTickerFromTitle(wiki.title);
    const generated = await generateImage(wiki);

    const primaryWikiLink = {
      title: wiki.title,
      url: wiki.url,
    };

    const wikiLinks = [primaryWikiLink];

    addRecentGeneration({
      imageUrl: generated.image,
      prompt: `${ticker} — ${wiki.title}`,
      createdAt: new Date().toISOString(),
      wikiLinks,
      primaryWikiLink,
    });

    return res.status(200).json({
      success: true,

      image: generated.image,
      caption: ticker,
      prompt: generated.prompt,

      primaryWikiLink,
      wikiLinks,

      wikiTitle: wiki.title,
      wikiLink: wiki.url,
      ticker,
      imageBytes: generated.imageBytes,
    });
  } catch (error) {
    console.error("random-generate failed:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Random generation failed.",
      details: error.data || error.errors || null,
    });
  }
}
