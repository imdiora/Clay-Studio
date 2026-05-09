# Claymation Studio

Turn a script into a claymation video in 5 steps — fully automated with AI.

---

## Setup

Go to **Settings** (gear icon, top right) and enter your API keys:

| Key | Used For |
|-----|----------|
| OpenAI / Anthropic / Gemini | Script breakdown |
| Gemini | Image generation |
| Kie.ai | Video animation |

---

## The 5 Steps

### 1. Story
- Paste your script
- *(Optional)* Check "I have a character reference" and describe or upload your character
- Click **Generate Scene Breakdown**

### 2. Scene Breakdown
- Review the AI-generated scenes
- Edit duration, description, or dialogue on any scene if needed
- Click **Continue to Images**

### 3. Images
- Choose **NanoBanana 2** (fast) or **NanoBanana Pro** (higher quality)
- Click **Generate All Images**
- You can also upload your own image for any scene
- Click **Continue to Animate**

### 4. Animate
- Choose a video engine (recommended: **Veo 3.1 Standard**)
- For each scene, click **Assign Frames** to set a start and/or end image
- Click **Generate All Videos**
- Click **Continue to Voiceover**

### 5. Voiceover
- Pick a voice: **Echo** (neutral), **Onyx** (deep), or **Nova** (energetic)
- Click **Generate All Voiceovers**
- Click **Assemble Final Video**
- Click **Download** when it's done

---

## Tips

- **Character consistency** — upload a reference image and enable *NanoBanana Style Reference*
- **Transitions** — set the end frame of one scene as the start frame of the next
- **Short scenes** (3–5s) = 1 clip · **Longer scenes** (6–9s) = start + end frame
- **Testing** — use Veo Lite to draft quickly, switch to Standard for finals
- **Voiceover + video** — keep audio OFF in video settings; voiceover is added separately

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Invalid API Key" | Double-check the key and available quota |
| Images not generating | Check Activity Log · try NanoBanana Pro |
| Videos not generating | Make sure start frame is assigned · check Kie.ai points |
| Character looks different | Add more detail to character description · regenerate scene |
| Assembly fails | Ensure all scenes have videos · refresh and retry |

The **Activity Log** (bottom of screen) shows all errors in detail.
