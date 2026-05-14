import OpenAI from "openai";
import { TwitterApi } from "twitter-api-v2";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEnv(name) {
  return process.env[name] || "";
}

function checkRequiredEnv() {
  const missing = [];

  if (!getEnv("OPENAI_API_KEY")) missing.push("OPENAI_API_KEY");
  if (!getEnv("X_API_KEY")) missing.push("X_API_KEY");
  if (!getEnv("X_API_SECRET")) missing.push("X_API_SECRET");
  if (!getEnv("X_ACCESS_TOKEN")) missing.push("X_ACCESS_TOKEN");
  if (!getEnv("X_ACCESS_SECRET")) missing.push("X_ACCESS_SECRET");

  return missing;
}

function makeTickerFromTitle(title = "") {
  const cleanedTitle = String(title)
    .replace(/\([^)]*\)/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim();

  const words = cleanedTitle
    .split(/[\s-]+/)
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean);

  let ticker = words[0] || "WIKI";

  ticker = ticker.toUpperCase().slice(0, 10);

  if (!ticker) {
    ticker = "WIKI";
  }

  return `$${ticker}`;
}

function makeTweetText(title, wikiLink) {
  const ticker = makeTickerFromTitle(title);

  return `${ticker}

${wikiLink}`.trim();
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
          source: "wikipedia-api",
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
          source: "wikipedia-rest",
        };
      }
    }
  }

  throw new Error("Wikipedia fetch failed after retries");
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

async function generateImageBuffer(wiki) {
  const prompt = makeImagePrompt(wiki);

  const image = await openai.images.generate({
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
    prompt,
    size: "1024x1024",
  });

  const b64 = image?.data?.[0]?.b64_json;

  if (!b64) {
    throw new Error("OpenAI image generation succeeded, but no base64 image was returned.");
  }

  const buffer = Buffer.from(b64, "base64");

  if (!buffer || buffer.length < 1000) {
    throw new Error("Generated image buffer was empty or too small.");
  }

  return buffer;
}

async function postToXWithImage(tweetText, imageBuffer) {
  const xClient = new TwitterApi({
    appKey: getEnv("X_API_KEY"),
    appSecret: getEnv("X_API_SECRET"),
    accessToken: getEnv("X_ACCESS_TOKEN"),
    accessSecret: getEnv("X_ACCESS_SECRET"),
  });

  const mediaId = await xClient.v1.uploadMedia(imageBuffer, {
    mimeType: "image/png",
  });

  if (!mediaId) {
    throw new Error("X media upload failed. No media ID returned.");
  }

  const posted = await xClient.v2.tweet({
    text: tweetText,
    media: {
      media_ids: [mediaId],
    },
  });

  return {
    posted,
    mediaId,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      success: false,
      error: "Use GET or POST.",
      method: req.method,
    });
  }

  const debugMode =
    req.query?.debug === "1" ||
    req.query?.debug === "true" ||
    req.body?.debug === true;

  const testImageMode =
    req.query?.testImage === "1" ||
    req.query?.testImage === "true" ||
    req.body?.testImage === true;

  try {
    const missing = checkRequiredEnv();

    if (missing.length > 0) {
      return res.status(500).json({
        success: false,
        error: "Missing required environment variables in Vercel.",
        missing,
      });
    }

    const wiki = await fetchRandomWikipedia();
    const tweetText = makeTweetText(wiki.title, wiki.url);

    if (debugMode && !testImageMode) {
      return res.status(200).json({
        success: true,
        debug: true,
        message: "Debug worked. No image generated and no post sent to X.",
        wiki,
        tweetText,
        tweetLength: tweetText.length,
        hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
        imageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      });
    }

    const imageBuffer = await generateImageBuffer(wiki);

    if (debugMode && testImageMode) {
      return res.status(200).json({
        success: true,
        debug: true,
        testImage: true,
        message: "Image generation worked. No post sent to X.",
        wiki,
        tweetText,
        tweetLength: tweetText.length,
        imageBytes: imageBuffer.length,
        imageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      });
    }

    const result = await postToXWithImage(tweetText, imageBuffer);

    return res.status(200).json({
      success: true,
      message: "Posted to X with image.",
      tweet: result.posted?.data || result.posted,
      mediaId: result.mediaId,
      wiki,
      tweetText,
      tweetLength: tweetText.length,
      imageBytes: imageBuffer.length,
    });
  } catch (error) {
    console.error("x-random failed:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Unknown error",
      details: error.data || error.errors || null,
    });
  }
}
