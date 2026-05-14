function pickRandomItems(array, count) {
  const shuffled = [...array].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

function buildRandomPrompt() {
  const words = pickRandomItems(RANDOM_WORDS, 12)

  return `
Create a completely original surreal AI-generated image.

Random inspiration words:
${words.join(", ")}

Style direction:
- evoke the feeling of early AI image generation
- surreal, uncanny, imaginative, dreamlike
- visually coherent but strange
- painterly digital image, not cartoonish
- soft shading, slightly airbrushed textures
- odd combinations of objects and ideas
- minimal text
- simple, strong composition
- internet-weird but not childish
- cinematic, strange, memorable
- look closer to early DALL·E-style generative imagery
- not comic-book style
- not anime
- not 3D toy-like
- not glossy mascot art
- not a meme template
- not a UI screenshot
- not an infographic

Image content:
Use several of the random inspiration words to create one single strange visual scene.
The image should feel like an unexpected artificial dream.

Rules:
- no readable brand logos
- no real celebrity likeness
- no financial promises
- no “buy now”
- no “100x”
- no guaranteed profit language
- no hate, gore, or explicit sexual content
`
}
