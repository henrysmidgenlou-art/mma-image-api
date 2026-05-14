import OpenAI from "openai";
import { TwitterApi } from "twitter-api-v2";

const SITE_URL = "https://mma-image-api.vercel.app";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(text = "") {
  return String(text)
    .replace(/[“”"]/g, "")
    .replace(/#/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getEnv(name) {
  return process.env[name] || "";
}

function checkXCredentials() {
  const missing = [];

  if (!getEnv("X_API_KEY")) missing.push("X_API_KEY");
  if (!getEnv("X_API_SECRET")) missing.push("X_API_SECRET");
  if (!getEnv("X_ACCESS_TOKEN")) missing.push("X_ACCESS_TOKEN");
  if (!getEnv("X_ACCESS_SECRET")) missing.push("X_ACCESS_SECRET");

  return missing;
}

function makeSafeTweet(title, extract, wikiLink) {
  const cleanTitle = cleanText(title || "Random Wikipedia");
  let cleanExtract = cleanText(extract || "");

  const prefix = `Random Wikipedia:\n${cleanTitle}\n\n`;
  const suffix = `\n\n${wikiLink}`;

  const maxLength = 270;
  const maxExtractLength = maxLength - prefix.length - suffix.length;

  if (maxExtractLength > 40 && cleanExtract.length > maxExtractLength) {
    cleanExtract = cleanExtract.slice(0, maxExtractLength - 3).trim();
    cleanExtract = cleanExtract.replace(/[,.;:!?]+$/, "");
    cleanExtract += "...";
  }

  let tweet = `${prefix}${cleanExtract}${suffix}`.trim();

  if (tweet.length > 280) {
    tweet = `${prefix}${suffix}`.trim();
  }

  if (tweet.length > 280) {
    tweet = `${cleanTitle}\n\n${wikiLink}`.trim();
  }

  return tweet;
}

async function fetchRandomWikipedia() {
  const userAgent =
    "RamonRandomWikiBot/1.0 (https://mma-image-api.vercel.app; contact: swielechowski@gmail.com)";

  const url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&generator=random&grnnamespace=0&prop=extracts|info&exintro=1&explaintext=1&inprop=url&origin=*";

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
      throw new Error(`Wikipedia fetch failed: ${response.status}`);
    }

    const data = await response.json();
    const pages = data?.query?.pages;

    if (!pages) {
      throw new Error("Wikipedia returned no pages");
    }

    const page = Object.values(pages)[0];

    return {
      title: page.title || "Random Wikipedia",
      extract: page.extract || "",
      url: page.fullurl || `https://en.wikipedia.org/?curid=${page.pageid}`,
      source: "wikipedia",
    };
  }

  return getFallbackWikiPost();
}

function getFallbackWikiPost() {
  const fallbacks = [
    {
      title: "Special:Random",
      extract:
        "Wikipedia was rate-limiting the bot, so this post is using Wikipedia's random article link instead.",
      url: "https://en.wikipedia.org/wiki/Special:Random",
    },
    {
      title: "Random article",
      extract:
        "A random Wikipedia rabbit hole for the timeline. Tap the link to land on a random page.",
      url: "https://en.wikipedia.org/wiki/Special:Random",
    },
  ];

  const pick = fallbacks[Math.floor(Math.random() * fallbacks.length)];

  return {
    ...pick,
    source: "fallback",
  };
}

function makeImagePrompt(wiki) {
  return `
Create a lifelike wide-angle documentary photograph inspired by this Wikipedia topic:

Title: ${wiki.title}

Context: ${wiki.extract}

Style:
- realistic photograph
- wide-angle lens
- natural lighting
- cinematic but believable
- no text, no labels, no logos
- do not make every image look the same
- base the scene only on the topic above
`.trim();
}

async function generateImageBuffer(wiki) {
  if (!openai) {
    return null;
  }

  const prompt = makeImagePrompt(wiki);

  const image = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
  });

  const b64 = image?.data?.[0]?.b64_json;

  if (!b64) {
    return null;
  }

  return Buffer.from(b64, "base64");
}

async function postToX(tweetText, imageBuffer) {
  const xClient = new TwitterApi({
    appKey: getEnv("X_API_KEY"),
    appSecret: getEnv("X_API_SECRET"),
    accessToken: getEnv("X_ACCESS_TOKEN"),
    accessSecret: getEnv("X_ACCESS_SECRET"),
  });

  let mediaIds = [];

  if (imageBuffer) {
    try {
      const mediaId = await xClient.v1.uploadMedia(imageBuffer, {
        mimeType: "image/png",
      });

      mediaIds = [mediaId];
    } catch (error) {
      console.error("Image upload failed. Posting text only.", error);
      mediaIds = [];
    }
  }

  if (mediaIds.length > 0) {
    return await xClient.v2.tweet({
      text: tweetText,
      media: {
        media_ids: mediaIds,
      },
    });
  }

  return await xClient.v2.tweet(tweetText);
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

  try {
    const missingXCredentials = checkXCredentials();

    if (missingXCredentials.length > 0) {
      return res.status(500).json({
        success: false,
        error: "Missing X environment variables in Vercel.",
        missing: missingXCredentials,
      });
    }

    const wiki = await fetchRandomWikipedia();

    const tweetText = makeSafeTweet(wiki.title, wiki.extract, wiki.url);

    if (debugMode) {
      return res.status(200).json({
        success: true,
        debug: true,
        message: "Debug worked. No post was sent to X.",
        wiki,
        tweetText,
        tweetLength: tweetText.length,
        hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
        source: wiki.source,
      });
    }

    let imageBuffer = null;

    try {
      imageBuffer = await generateImageBuffer(wiki);
    } catch (error) {
      console.error("OpenAI image generation failed. Posting text only.", error);
      imageBuffer = null;
    }

    const posted = await postToX(tweetText, imageBuffer);

    return res.status(200).json({
      success: true,
      message: "Posted to X.",
      tweet: posted?.data || posted,
      wiki,
      tweetText,
      tweetLength: tweetText.length,
      postedWithImage: Boolean(imageBuffer),
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
