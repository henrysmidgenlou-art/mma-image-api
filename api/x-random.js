import OpenAI from "openai";
import { TwitterApi } from "twitter-api-v2";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const xClient = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

function cleanText(text) {
  return text
    .replace(/["“”]/g, "")
    .replace(/#/g, "")
    .trim();
}

function makeSafeTweet(text, wikiLink) {
  const maxTextLength = 235;
  let cleaned = cleanText(text);

  if (cleaned.length > maxTextLength) {
    cleaned = cleaned.slice(0, maxTextLength).trim();
    cleaned = cleaned.replace(/[.,!?;:]?$/, "...");
  }

  return `${cleaned}

${wikiLink}`;
}

export default async function handler(req, res) {
  try {
    // Allow POST for cron jobs and GET for browser testing
    if (req.method !== "POST" && req.method !== "GET") {
      return res.status(405).json({
        error: "Use POST or GET.",
      });
    }

    // Optional security:
    // If you add CRON_SECRET in Vercel, your cron URL should be:
    // /api/x-random?secret=YOUR_SECRET
    if (process.env.CRON_SECRET) {
      const secret = req.query?.secret || req.headers["x-cron-secret"];

      if (secret !== process.env.CRON_SECRET) {
        return res.status(401).json({
          error: "Unauthorized",
        });
      }
    }

    // 1. Get random Wikipedia article
    const wikiRes = await fetch(
      "https://en.wikipedia.org/api/rest_v1/page/random/summary"
    );

    if (!wikiRes.ok) {
      throw new Error(`Wikipedia fetch failed: ${wikiRes.status}`);
    }

    const wikiData = await wikiRes.json();

    const wikiTitle = wikiData.title || "Random Wikipedia article";
    const wikiExtract = wikiData.extract || "";
    const wikiLink =
      wikiData?.content_urls?.desktop?.page ||
      wikiData?.content_urls?.mobile?.page ||
      wikiData?.url ||
      "";

    if (!wikiLink) {
      throw new Error("Could not find Wikipedia link.");
    }

    // 2. Generate X post text
    const textPrompt = `
Create a short, weird, funny, viral-style X post based on this random Wikipedia article.

Title:
${wikiTitle}

Summary:
${wikiExtract}

Rules:
- Do not use hashtags.
- Do not include a link.
- Do not say "Wikipedia says".
- Keep it under 220 characters.
- Make it feel like a strange internet observation.
`;

    const textCompletion = await openai.chat.completions.create({
      model: process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: textPrompt,
        },
      ],
      temperature: 0.95,
    });

    const generatedText =
      textCompletion.choices?.[0]?.message?.content?.trim() ||
      `Today’s random Wikipedia rabbit hole: ${wikiTitle}`;

    const tweetText = makeSafeTweet(generatedText, wikiLink);

    // 3. Generate image prompt
    const imagePrompt = `
Wide-angle realistic photograph inspired by this random Wikipedia article.

Article title:
${wikiTitle}

Article summary:
${wikiExtract}

Style:
Realistic wide-angle documentary photograph.
Natural lighting.
Cinematic but believable.
No text.
No logos.
No fake captions.
Do not make it look like a poster.
Do not make it look like digital art.
Only use visual inspiration from the article.
`;

    // 4. Generate image
    const imageResult = await openai.images.generate({
      model: process.env.OPENAI_IMAGE_MODEL || "dall-e-3",
      prompt: imagePrompt,
      size: "1792x1024",
      quality: "standard",
      style: "natural",
      response_format: "b64_json",
    });

    const imageBase64 = imageResult.data?.[0]?.b64_json;

    if (!imageBase64) {
      throw new Error("No image was generated.");
    }

    const imageBuffer = Buffer.from(imageBase64, "base64");

    // 5. Upload image to X
    const mediaId = await xClient.v1.uploadMedia(imageBuffer, {
      mimeType: "image/png",
    });

    // 6. Post to X with image and Wikipedia link
    const postedTweet = await xClient.v2.tweet({
      text: tweetText,
      media: {
        media_ids: [mediaId],
      },
    });

    return res.status(200).json({
      success: true,
      wikiTitle,
      wikiLink,
      tweetText,
      tweetId: postedTweet?.data?.id,
      postedTweet,
    });
  } catch (error) {
    console.error("x-random error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Something went wrong.",
    });
  }
}
