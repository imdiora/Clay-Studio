# Claymation Studio - User Guide

## 🎬 What is Claymation Studio?

Claymation Studio is an AI-powered web application that automates the entire workflow of creating stop-motion claymation videos. Simply enter a script, and the tool will break it into scenes, generate claymation frames, animate them, add voiceovers, and stitch everything into a final video.

---

## 🚀 Getting Started

### Prerequisites

Before you begin, you'll need API keys from one or more of these providers:

- **Anthropic** (Claude AI) - For scene breakdown - [Get key](https://console.anthropic.com/)
- **OpenAI** (GPT-4) - Alternative for scene breakdown - [Get key](https://platform.openai.com/)
- **Google Gemini** - For image generation - [Get key](https://aistudio.google.com/app/apikey)
- **Kie.ai** - For video animation - [Get key](https://kie.ai/)

### Starting the Application

1. Open the Claymation Studio web application in your browser
2. Click the **Settings** button (gear icon) in the top right
3. Enter your API keys in the appropriate fields
4. Select your preferred AI models
5. Click **Save Settings**

---

## 📖 Complete Workflow Guide

Claymation Studio uses a **5-step wizard** to guide you through the entire process:

### **Step 1: Story** 📝

This is where you input your script and configure your project.

#### Basic Setup:
1. **Enter Your Script**
   - Type or paste your video script into the text area
   - The script can be any length (the AI will break it into appropriate scenes)

#### Optional Character Setup:
2. **Add Character Reference** (Optional)
   - Check "I have a character reference" if you want consistent characters
   - Enter a detailed character description (e.g., "A small blue clay tomato with big eyes wearing a tiny hat")
   - Or upload a reference image by:
     - Clicking **"Upload Image"**
     - Dragging and dropping an image
     - Pasting an image (Ctrl+V / Cmd+V)

#### Advanced Options:
3. **Vision-Guided Breakdown** (Optional)
   - Enable this if you uploaded a reference image and want the AI to analyze it
   - The AI will match the visual style of your reference

4. **NanoBanana Style Reference** (Optional)
   - Enable this to pass your reference image to the image generator
   - Helps maintain consistent visual style across all frames

#### Generate Scenes:
5. Click **"Generate Scene Breakdown"**
   - The AI will analyze your script
   - Break it into timed scenes (3-9 seconds each)
   - Generate detailed frame descriptions for each scene
   - Extract dialogue for voiceovers

---

### **Step 2: Scene Breakdown** 🎞️

Review and edit the AI-generated scenes.

#### What You'll See:
- **Scene Cards** - Each scene shows:
  - Scene number and duration
  - Script text for that section
  - Detailed frame description (camera angle, character actions, background)
  - Extracted dialogue/voiceover text

#### What You Can Do:
1. **Review Scenes**
   - Check if scenes are split appropriately
   - Verify frame descriptions make sense

2. **Edit Scenes** (if needed)
   - Click the **Edit** button on any scene
   - Modify duration, description, or dialogue
   - Save changes

3. **Delete Scenes** (if needed)
   - Click the **Delete** button (X icon) to remove unwanted scenes

4. **Add More Scenes** (if needed)
   - Click **"Add Scene Manually"** at the bottom
   - Fill in the scene details

#### When Ready:
5. Click **"Continue to Images"** to proceed to the next step

---

### **Step 3: Images** 🖼️

Generate claymation frames for each scene.

#### Setup:
1. **Select Image Model**
   - **NanoBanana 2** (Fast, recommended) - Quick generation, good quality
   - **NanoBanana Pro** (Slow) - Higher quality, more detailed

#### Generate Images:

**Option A: Generate All Images at Once**
2. Click **"Generate All Images"**
   - The system will create frames for all scenes automatically
   - Progress shown in real-time
   - You can cancel anytime by clicking **"Cancel Generation"**

**Option B: Generate Individual Images**
3. Navigate through scenes using the scene selector
4. Click **"Generate Image"** for the current scene only

**Option C: Upload Your Own Images**
5. For any scene, click **"Upload Image"**
6. Select a custom image file
7. Or paste an image directly (Ctrl+V / Cmd+V)

#### Review Generated Images:
- Preview each image in the center panel
- Regenerate if you're not satisfied with the result
- Replace with a custom upload if preferred

#### When Ready:
6. Ensure all scenes have images (generated or uploaded)
7. Click **"Continue to Animate"** to proceed

---

### **Step 4: Animate** 🎥

Convert your still images into animated claymation videos.

#### Setup:
1. **Select Video Engine**
   - **Veo 3.1 Lite** - Fast, low cost
   - **Veo 3.1 Fast** - Balanced speed and quality
   - **Veo 3.1 Standard** - High quality (recommended)
   - **Kling 3.0 Standard** - Alternative engine
   - **Kling 3.0 Pro** - High quality alternative
   - **Kling 3.0 4K** - Ultra high quality

2. **Configure Settings**
   - **Resolution**: 720p, 1080p, or 4K
   - **Audio**: Enable if you want background sounds (usually OFF for voiceover addition)
   - **Prompt Engine**: Kling or Veo style prompts

#### Assign Start/End Frames (Important!)

For each scene, you need to assign which image to use:

3. **Click "Assign Frames"** on a scene card
   - **Start Frame**: The image the video begins with
   - **End Frame**: The image the video ends with (creates transition effect)
   
   **Tips:**
   - For single-shot scenes: Use the same image for both start and end
   - For transitions: Use different images (end of scene 1 → start of scene 2)
   - Scenes 6+ seconds should use both frames for smooth flow

4. **Asset Tray Opens** - Select which scene's image to use:
   - Click on any scene thumbnail to assign it as the frame
   - You can use images from any scene as start/end frames

#### Generate Videos:

**Option A: Generate All Videos**
5. Click **"Generate All Videos"**
   - Videos generate sequentially
   - Real-time progress updates
   - Can take several minutes per scene

**Option B: Generate Individual Videos**
6. Navigate to a scene
7. Click **"Generate Video"** for that scene only

#### Review Videos:
- Play each generated video in the preview panel
- Regenerate if animation doesn't look right
- Videos auto-save to each scene

#### When Ready:
8. Ensure all scenes have videos
9. Click **"Continue to Voiceover"** to proceed

---

### **Step 5: Voiceover** 🎤

Add AI-generated voiceovers to your scenes.

#### Setup:
1. **Select Voice**
   - **Echo** - Neutral & Steady
   - **Onyx** - Deep & Cinematic
   - **Nova** - Bright & Energetic
   - Click the play icon (▶) to hear voice samples

2. **Set Voice Vibe**
   - Neutral, Dramatic, Optimistic, Whisper, or Authoritative

3. **End Hold Duration** (Optional)
   - Add silence at the end of each scene:
     - None (0s)
     - Short (+0.5s)
     - Medium (+1.5s)
     - Long (+3s)

#### Generate Voiceovers:

**Option A: Generate All Voiceovers**
4. Click **"Generate All Voiceovers"**
   - Creates audio for all scenes with dialogue
   - Scenes without dialogue are skipped
   - Progress shown in real-time

**Option B: Generate Individual Voiceovers**
5. Navigate through scenes using the scene selector
6. Click **"Generate Voiceover"** for the current scene

#### Review Audio:
- Each scene shows if voiceover is generated (✓)
- Play the video preview to hear the audio
- Regenerate with different settings if needed

#### When Ready:
7. Click **"Assemble Final Video"** to combine everything!

---

## 🎞️ Final Assembly

After completing all steps, assemble your complete video:

### Automatic Assembly:
1. Click **"Assemble Final Video"** button
2. The system will:
   - Stitch all scene videos together
   - Sync voiceovers with their scenes
   - Create one complete video file

3. **Progress Updates**:
   - FFmpeg processes each scene
   - Real-time status messages
   - Can take a few minutes depending on video length

### Download Your Video:
4. When complete, the **Download** button appears
5. Click **"Download Final Video"** 
6. Your complete claymation video saves as `claymation-final.mp4`

---

## 💡 Tips & Best Practices

### Writing Scripts:
- ✅ Keep scripts clear and visual
- ✅ Break complex ideas into simple scenes
- ✅ Describe what viewers should see, not just hear
- ❌ Avoid abstract concepts that are hard to visualize

### Character Consistency:
- ✅ Provide detailed character descriptions upfront
- ✅ Include colors, shapes, clothing, and unique features
- ✅ Upload a reference image if you have one
- ✅ Enable "NanoBanana Style Reference" for best consistency

### Scene Timing:
- ✅ 3-5 seconds: Single action or statement
- ✅ 6-9 seconds: Complex action or longer dialogue
- ✅ Use shorter scenes for fast-paced content
- ✅ Use longer scenes for dramatic moments

### Image Generation:
- ✅ Use **NanoBanana 2** for quick iterations
- ✅ Use **NanoBanana Pro** for final production
- ✅ Regenerate if characters don't match previous scenes
- ✅ Upload custom images for critical scenes

### Video Animation:
- ✅ **Veo 3.1 Standard** is the best balance of quality/speed
- ✅ Use **Start + End Frames** for smooth transitions between scenes
- ✅ Use the **same image** for start and end if no transition needed
- ✅ Turn OFF audio in video settings (you'll add voiceover separately)

### Voiceovers:
- ✅ Test all three voices to find the best fit
- ✅ Use **Echo** for educational/informative content
- ✅ Use **Onyx** for dramatic/serious content
- ✅ Use **Nova** for upbeat/energetic content
- ✅ Add end hold for breathing room between scenes

---

## 🎛️ Advanced Features

### Scene Inspector:
- View detailed information about each scene
- See all prompts sent to AI models
- Copy prompts for external use
- Debug generation issues

### Activity Log:
- Track all API calls and system events
- Filter by type: ALL, SUCCESS, ERROR, API_CALL, INFO
- Debug issues with API keys or generation
- Export logs for troubleshooting

### Batch Operations:
- **Download All Images**: Get all generated frames as a ZIP
- **Download All Videos**: Get all scene videos as a ZIP
- **Export Scene Data**: Export all prompts and metadata as JSON

### Manual Overrides:
- Upload custom images for any scene
- Edit scene descriptions manually
- Adjust durations on the fly
- Skip voiceover for specific scenes

---

## 🔧 Troubleshooting

### "Invalid API Key" Error:
- ✅ Check that you entered the correct key
- ✅ Verify key has available credits/quota
- ✅ Try regenerating a new key from the provider

### Images Not Generating:
- ✅ Check Activity Log for specific error messages
- ✅ Verify Gemini API key is valid
- ✅ Try switching to NanoBanana Pro if Flash fails
- ✅ Upload a custom image as a workaround

### Videos Not Generating:
- ✅ Ensure you assigned start/end frames
- ✅ Check Kie.ai account has sufficient points
- ✅ Try a different video engine
- ✅ Check Activity Log for API errors

### Video Assembly Fails:
- ✅ Ensure all scenes have generated videos
- ✅ Try downloading scenes individually first
- ✅ Refresh the page and try again
- ✅ Check browser console for FFmpeg errors

### Character Inconsistency:
- ✅ Provide more detailed character description
- ✅ Enable "Vision-Guided Breakdown" with reference image
- ✅ Enable "NanoBanana Style Reference"
- ✅ Regenerate inconsistent scenes
- ✅ Use NanoBanana Pro for better consistency

---

## 📊 Understanding Costs

The app shows estimated **Kie.ai points** for video generation:

- **Video costs vary by model**:
  - Veo 3.1 Lite: 0.4 pts/second
  - Veo 3.1 Fast: 0.6 pts/second
  - Veo 3.1 Standard: 1.5 pts/second
  - Kling 3.0 Standard: 0.4 pts/second
  - Kling 3.0 Pro: 0.8 pts/second
  - Kling 3.0 4K: 1.6 pts/second

**Example**: A 5-second video on Veo 3.1 Standard = 7.5 points

**Tips to minimize costs**:
- Use Veo 3.1 Lite for testing
- Switch to higher quality only for final renders
- Keep scenes concise
- Preview with single scenes before generating all

---

## 🎯 Quick Start Checklist

- [ ] Add API keys in Settings
- [ ] Write or paste your script
- [ ] (Optional) Add character description or reference image
- [ ] Click "Generate Scene Breakdown"
- [ ] Review scenes, edit if needed
- [ ] Click "Continue to Images"
- [ ] Click "Generate All Images"
- [ ] Click "Continue to Animate"
- [ ] Assign start/end frames for each scene
- [ ] Click "Generate All Videos"
- [ ] Click "Continue to Voiceover"
- [ ] Select voice and vibe
- [ ] Click "Generate All Voiceovers"
- [ ] Click "Assemble Final Video"
- [ ] Download your completed claymation video!

---

## 🎉 Example Workflow

**Goal**: Create a 15-second claymation video about a tomato going to the market.

1. **Story Step**:
   - Script: "Tommy the Tomato woke up excited. Today was market day! He grabbed his little basket and headed down the garden path."
   - Character: "A round red clay tomato with big happy eyes, tiny arms and legs, wearing a straw hat"
   - Click "Generate Scene Breakdown"

2. **Scene Breakdown**:
   - AI creates 3 scenes (5 seconds each)
   - Scene 1: Tommy waking up in bed
   - Scene 2: Tommy holding basket
   - Scene 3: Tommy walking on path
   - Click "Continue to Images"

3. **Images**:
   - Select "NanoBanana 2"
   - Click "Generate All Images"
   - Wait 30-60 seconds
   - Review all 3 frames
   - Click "Continue to Animate"

4. **Animate**:
   - Select "Veo 3.1 Standard"
   - For Scene 1: Assign Scene 1 image as start, Scene 2 image as end
   - For Scene 2: Assign Scene 2 image as start, Scene 3 image as end
   - For Scene 3: Assign Scene 3 image as start and end
   - Click "Generate All Videos"
   - Wait 5-10 minutes
   - Click "Continue to Voiceover"

5. **Voiceover**:
   - Select "Nova" voice (energetic)
   - Set vibe to "Optimistic"
   - Click "Generate All Voiceovers"
   - Wait 30 seconds
   - Click "Assemble Final Video"

6. **Final Assembly**:
   - Wait 2-3 minutes
   - Click "Download Final Video"
   - Done! 🎉

---

## 📞 Support

If you encounter issues:

1. Check the **Activity Log** (bottom left icon) for error details
2. Review this guide's **Troubleshooting** section
3. Ensure all API keys are valid and have available quota
4. Try refreshing the browser page
5. Check browser console (F12) for technical errors

---

## 🌟 Happy Creating!

You now have everything you need to create amazing claymation videos. Start simple, experiment with different styles, and have fun bringing your stories to life!

**Remember**: The first video always takes the longest as you learn the workflow. After that, you'll be creating claymation content in minutes!
