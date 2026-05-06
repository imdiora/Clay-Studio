import React, { useState, useEffect, useCallback, useRef } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { Download, XCircle } from 'lucide-react';

const VIDEO_MODEL_CONFIGS = {
    'veo-3.1-lite': {
        provider: 'veo',
        label: 'Veo 3.1 Lite',
        model: 'veo3_lite',
        endpoint: '/api/v1/veo/generate',
        pollFamily: 'veo',
        pointsPerSecond: 0.4
    },
    'veo-3.1-fast': {
        provider: 'veo',
        label: 'Veo 3.1 Fast',
        model: 'veo3_fast',
        endpoint: '/api/v1/veo/generate',
        pollFamily: 'veo',
        pointsPerSecond: 0.6
    },
    'veo-3.1-standard': {
        provider: 'veo',
        label: 'Veo 3.1 Standard / Quality',
        model: 'veo3',
        endpoint: '/api/v1/veo/generate',
        pollFamily: 'veo',
        pointsPerSecond: 1.5
    },
    'kling-3.0-standard': {
        provider: 'kling',
        label: 'Kling 3.0 Standard',
        model: 'kling-3.0/video',
        mode: 'std',
        endpoint: '/api/v1/jobs/createTask',
        pollFamily: 'kling',
        pointsPerSecond: 0.4
    },
    'kling-3.0-pro': {
        provider: 'kling',
        label: 'Kling 3.0 Pro',
        model: 'kling-3.0/video',
        mode: 'pro',
        endpoint: '/api/v1/jobs/createTask',
        pollFamily: 'kling',
        pointsPerSecond: 0.8
    },
    'kling-3.0-4k': {
        provider: 'kling',
        label: 'Kling 3.0 4K',
        model: 'kling-3.0/video',
        mode: '4K',
        endpoint: '/api/v1/jobs/createTask',
        pollFamily: 'kling',
        pointsPerSecond: 1.6
    }
};

const MODEL_TIER_BY_ENGINE = {
    'veo-3.1-lite': 'lite',
    'veo-3.1-fast': 'lite',
    'veo-3.1-standard': 'standard',
    'kling-3.0-standard': 'standard',
    'kling-3.0-pro': 'pro',
    'kling-3.0-4k': 'pro'
};

const KLING_NEGATIVE_PROMPT = 'Non-disney, Non-cartoon';
const LITE_STATIC_CAMERA_PROMPT = 'Static camera, centered composition.';

const getVideoModelTier = (selectedModel) => MODEL_TIER_BY_ENGINE[selectedModel] || 'standard';

const isKlingVideoModel = (selectedModel) => {
    const config = VIDEO_MODEL_CONFIGS[selectedModel];
    return config?.provider === 'kling' || String(selectedModel).toLowerCase().includes('kling');
};

const capPromptWords = (prompt, maxWords) => {
    const words = prompt.trim().split(/\s+/).filter(Boolean);
    return words.length > maxWords ? words.slice(0, maxWords).join(' ') : words.join(' ');
};

const removeKlingNegativeTerms = (prompt) => prompt
    .replace(/\bnon[-\s]?disney\b[.,;:]?/gi, '')
    .replace(/\bnon[-\s]?cartoon\b[.,;:]?/gi, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/([.,;:]){2,}/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

const IMAGE_MODEL_CONFIGS = {
    nanoBanana2: {
        label: 'NanoBanana 2',
        modelId: 'gemini-2.5-flash-image-preview',
        candidateModelIds: [
            'gemini-2.5-flash-image-preview',
            'gemini-2.5-flash-image',
            'gemini-2.0-flash-preview-image-generation'
        ],
        quality: 'standard',
        steps: 'minimum',
        upscale: false,
        timeoutMs: 180000,
        chunkSize: 4,
        chunkDelayMs: 500,
        priority: 'high',
        targetSeconds: 20,
        mode: 'flash'
    },
    nanoBananaPro: {
        label: 'NanoBanana Pro',
        modelId: 'gemini-3-pro-image-preview',
        candidateModelIds: [
            'gemini-3-pro-image-preview',
            'gemini-3-pro-image',
            'gemini-2.5-flash-image-preview'
        ],
        quality: 'high',
        steps: 'standard',
        upscale: true,
        timeoutMs: 300000,
        chunkSize: 2,
        chunkDelayMs: 1000,
        priority: 'standard',
        targetSeconds: 45,
        mode: 'refinement'
    }
};

const getImageModelConfig = (selectedModel) => IMAGE_MODEL_CONFIGS[selectedModel] || IMAGE_MODEL_CONFIGS.nanoBanana2;

const compressPromptForFastImageModel = (prompt) => {
    const repeatedStyleTerms = [
        'claymation',
        'handmade',
        'stop-motion',
        'tactile clay',
        'soft cinematic lighting',
        'non-CGI',
        'clear silhouette'
    ];

    return repeatedStyleTerms.reduce((currentPrompt, term) => {
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let hasKeptFirst = false;
        return currentPrompt.replace(new RegExp(`\\b${escapedTerm}\\b`, 'gi'), (match) => {
            if (hasKeptFirst) return '';
            hasKeptFirst = true;
            return match;
        });
    }, prompt)
        .replace(/\s+([.,;:])/g, '$1')
        .replace(/([.,;:]){2,}/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();
};

const transformImagePromptForModel = (prompt, selectedModel) => {
    const config = getImageModelConfig(selectedModel);
    const basePrompt = selectedModel === 'nanoBanana2'
        ? compressPromptForFastImageModel(prompt)
        : prompt.trim();
    const urlHint = 'If hosted image URL output is supported, return an image URL instead of inline Base64.';

    if (config.mode === 'flash') {
        return `${basePrompt} Render with standard quality, minimum sampling steps, no upscaling. ${urlHint}`.trim();
    }

    return `${basePrompt} Use refinement quality with richer detail and stable character consistency. ${urlHint}`.trim();
};

const getOrCreateImageSeed = (scene, sceneIndex) => scene?.imageSeed || Math.floor((Date.now() + sceneIndex) % 2147483647);

const extractGeneratedImageUrl = (data) => {
    const part = data?.candidates?.[0]?.content?.parts?.[0];
    const textContent = part?.text || '';
    const urlMatch = textContent.match(/https?:\/\/\S+/);

    return part?.fileData?.fileUri ||
        part?.fileData?.uri ||
        part?.file_data?.file_uri ||
        part?.file_data?.uri ||
        part?.image?.url ||
        part?.url ||
        (urlMatch ? urlMatch[0].replace(/[)"'\]]+$/, '') : null);
};

const transformVideoPrompt = (originalPrompt, selectedModel) => {
    const tier = getVideoModelTier(selectedModel);
    let prompt = isKlingVideoModel(selectedModel)
        ? removeKlingNegativeTerms(originalPrompt || '')
        : (originalPrompt || '').trim();

    prompt = prompt
        .replace(/\b(non[-\s]?disney|disney|pixar|dreamworks|marvel|dc comics|star wars|pokemon|mickey|simba|lion king)\b[.,;:]?/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (tier === 'lite') {
        prompt = prompt
            .replace(/\bcamera follows\b[.,;:]?/gi, '')
            .replace(/\bpanning\b[.,;:]?/gi, '')
            .replace(/\btracking\b[.,;:]?/gi, '')
            .replace(/\bcomplex physics\b[.,;:]?/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        return capPromptWords(`${capPromptWords(prompt, 34)} ${LITE_STATIC_CAMERA_PROMPT}`, 40);
    }

    return prompt;
};

const migrateVideoEngine = (stored) => {
    const migrations = {
        'veo-lite': 'veo-3.1-lite',
        'veo-fast': 'veo-3.1-fast',
        'veo-standard': 'veo-3.1-standard',
        'kling-standard': 'kling-3.0-standard',
        'kling-pro': 'kling-3.0-pro'
    };
    const nextValue = migrations[stored] || stored;
    return VIDEO_MODEL_CONFIGS[nextValue] ? nextValue : 'veo-3.1-fast';
};

const USER_CANCELLED_REQUEST = 'Request cancelled by user';

const VOICE_CONFIG = [
    { id: 'echo', name: 'Echo', style: 'Neutral & Steady', emoji: '🔊', sampleUrl: '/samples/echo.mp3' },
    { id: 'onyx', name: 'Onyx', style: 'Deep & Cinematic', emoji: '🎙️', sampleUrl: '/samples/onyx.mp3' },
    { id: 'nova', name: 'Nova', style: 'Bright & Energetic', emoji: '⚡', sampleUrl: '/samples/nova.mp3' }
];

const normalizeVoiceId = (voiceId) => (
    VOICE_CONFIG.some(voice => voice.id === voiceId) ? voiceId : VOICE_CONFIG[0].id
);

const VIBE_OPTIONS = ['Neutral', 'Dramatic', 'Optimistic', 'Whisper', 'Authoritative'];

// Production credits: 10 pts per image, 50 pts per video, 5 pts per voiceover
const PTS_COST = { image: 10, video: 50, voiceover: 5 };

const WIZARD_STEPS = ['Story', 'Scene Breakdown', 'Images', 'Animate', 'Voiceover'];

const ClayStudioLogo = () => (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Clay Studio">
        <path d="M18 2C9.8 2 4 8.2 4 15.5C4 18.5 4.5 21.5 6.5 24C8.2 26.1 8 29.2 12 31.5C14 32.6 16 33.5 18 33.5C20 33.5 22 32.6 24 31.5C28 29.2 27.8 26.1 29.5 24C31.5 21.5 32 18.5 32 15.5C32 8.2 26.2 2 18 2Z" fill="url(#cs-grad)" />
        <polygon points="14.5,11.5 27,18 14.5,24.5" fill="white" fillOpacity="0.93" />
        <defs>
            <linearGradient id="cs-grad" x1="4" y1="2" x2="32" y2="33.5" gradientUnits="userSpaceOnUse">
                <stop stopColor="#E8896A" />
                <stop offset="1" stopColor="#8B3A20" />
            </linearGradient>
        </defs>
    </svg>
);

export default function App() {
    // Persistent state with localStorage
    const [anthropicKey, setAnthropicKey] = useState(() => localStorage.getItem('anthropicKey') || '');
    const [openAIKey, setOpenAIKey] = useState(() => localStorage.getItem('openAIKey') || '');
    const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('geminiKey') || '');
    const [kieAiKey, setKieAiKey] = useState(() => localStorage.getItem('kieAiKey') || '2edf9c1f2454e5b6e8e5bdbae5690ad1');
    const [activeTextProvider, setActiveTextProvider] = useState(() => localStorage.getItem('activeTextProvider') || 'openai');
    const [activeImageModel, setActiveImageModel] = useState(() => localStorage.getItem('activeImageModel') || 'nanoBanana2');
    const [activeVideoEngine, setActiveVideoEngine] = useState(() => {
        const stored = localStorage.getItem('activeVideoEngine');
        return migrateVideoEngine(stored);
    });
    const [videoResolution, setVideoResolution] = useState(() => localStorage.getItem('videoResolution') || '720p');
    const [videoAudio, setVideoAudio] = useState(() => localStorage.getItem('videoAudio') === 'true');
    const [qualityPreset, setQualityPreset] = useState(() => localStorage.getItem('qualityPreset') || 'highQuality');
    const [videoPromptEngine, setVideoPromptEngine] = useState(() => localStorage.getItem('videoPromptEngine') || 'kling');
    
    // App state
    const [script, setScript] = useState('');
    const [characterDescription, setCharacterDescription] = useState('');
    const [scenes, setScenes] = useState([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [hasCharacter, setHasCharacter] = useState(false);
    const [referenceImage, setReferenceImage] = useState(null);
    const [visionGuidedBreakdown, setVisionGuidedBreakdown] = useState(false);
    const [nanoBananaStyleRef, setNanoBananaStyleRef] = useState(false);
    const [isGeneratingImages, setIsGeneratingImages] = useState(false);
    const [currentGeneratingIndex, setCurrentGeneratingIndex] = useState(-1);
    const [generationProgress, setGenerationProgress] = useState({ completed: 0, total: 0 });
    const [copyFeedback, setCopyFeedback] = useState('');
    const [isGeneratingVideos, setIsGeneratingVideos] = useState(false);
    const [videoPollingMap, setVideoPollingMap] = useState(new Map());
    const [estimatedCost, setEstimatedCost] = useState(0);
    const [logs, setLogs] = useState([]);
    const [logsCollapsed, setLogsCollapsed] = useState(false);
    const [isAssemblingVideo, setIsAssemblingVideo] = useState(false);
    const [assemblyProgress, setAssemblyProgress] = useState('');
    const [finalVideoUrl, setFinalVideoUrl] = useState(null);
    const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [activityLogOpen, setActivityLogOpen] = useState(false);
    const [inspectorTab, setInspectorTab] = useState('inspector');
    const [logFilter, setLogFilter] = useState('ALL');
    const [mobileWorkspaceTab, setMobileWorkspaceTab] = useState('preview');
    const [selectedAssemblySceneIndexes, setSelectedAssemblySceneIndexes] = useState([]);
    const [wizardStep, setWizardStep] = useState(1);
    const logsContainerRef = useRef(null);
    const ffmpegRef = useRef(null);
    const ffmpegLoadPromiseRef = useRef(null);
    const activeImageGenTimersRef = useRef(new Map());
    const imageAbortControllersRef = useRef(new Map());
    const videoAbortControllersRef = useRef(new Map());
    const videoPollingIntervalsRef = useRef(new Map());
    const audioAbortControllersRef = useRef(new Map());
    const sampleAudioRef = useRef(null);
    const [playingVoiceSample, setPlayingVoiceSample] = useState('');

    // Asset Tray state (Start/End Frame assignment for each scene)
    const [assetTrayOpen, setAssetTrayOpen] = useState(false);
    const [assetTraySceneIndex, setAssetTraySceneIndex] = useState(0);
    const [assetTraySlot, setAssetTraySlot] = useState('start'); // 'start' | 'end'

    // Voiceover step selected scene (separate from animate selectedSceneIndex)
    const [voiceoverSceneIndex, setVoiceoverSceneIndex] = useState(0);

    const addLog = useCallback((type, message) => {
        const timestamp = new Date();
        setLogs(prev => {
            const nextLogs = [
                ...prev,
                {
                    id: `${timestamp.getTime()}-${Math.random().toString(36).slice(2)}`,
                    timestamp,
                    type,
                    message: typeof message === 'string' ? message : JSON.stringify(message, null, 2)
                }
            ];
            return nextLogs.slice(-200);
        });
    }, []);

    // Save to localStorage whenever keys or settings change
    useEffect(() => {
        localStorage.setItem('anthropicKey', anthropicKey);
        localStorage.setItem('openAIKey', openAIKey);
        localStorage.setItem('geminiKey', geminiKey);
        localStorage.setItem('kieAiKey', kieAiKey);
        localStorage.setItem('activeTextProvider', activeTextProvider);
        localStorage.setItem('activeImageModel', activeImageModel);
        localStorage.setItem('activeVideoEngine', activeVideoEngine);
        localStorage.setItem('videoResolution', videoResolution);
        localStorage.setItem('videoAudio', videoAudio.toString());
        localStorage.setItem('qualityPreset', qualityPreset);
        localStorage.setItem('videoPromptEngine', videoPromptEngine);
    }, [anthropicKey, openAIKey, geminiKey, kieAiKey, activeTextProvider, activeImageModel, activeVideoEngine, videoResolution, videoAudio, qualityPreset, videoPromptEngine]);

    // Calculate estimated cost in Kie.ai points
    useEffect(() => {
        const pointsPerScene = () => {
            const avgDuration = scenes.reduce((sum, s) => sum + (s.duration || 5), 0) / (scenes.length || 1);
            const videoConfig = VIDEO_MODEL_CONFIGS[activeVideoEngine] || VIDEO_MODEL_CONFIGS['veo-3.1-fast'];
            return avgDuration * videoConfig.pointsPerSecond;
        };

        const total = scenes.length * pointsPerScene();
        setEstimatedCost(total);
    }, [scenes, activeVideoEngine]);

    useEffect(() => {
        if (!logsCollapsed && logsContainerRef.current) {
            logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
    }, [logs, logsCollapsed]);

    useEffect(() => {
        return () => {
            if (finalVideoUrl) {
                URL.revokeObjectURL(finalVideoUrl);
            }
            if (sampleAudioRef.current) {
                sampleAudioRef.current.pause();
                sampleAudioRef.current = null;
            }
        };
    }, [finalVideoUrl]);

    useEffect(() => {
        const timers = activeImageGenTimersRef.current;
        return () => {
            timers.forEach(timerId => clearInterval(timerId));
            timers.clear();
        };
    }, []);

    useEffect(() => {
        if (scenes.length === 0) {
            setSelectedSceneIndex(0);
            return;
        }
        if (selectedSceneIndex > scenes.length - 1) {
            setSelectedSceneIndex(scenes.length - 1);
        }
    }, [scenes.length, selectedSceneIndex]);

    useEffect(() => {
        const completedVideoIndexes = scenes
            .map((scene, index) => (scene.videoUrl ? index : null))
            .filter(index => index !== null);

        setSelectedAssemblySceneIndexes(prev => {
            const stillValid = prev.filter(index => completedVideoIndexes.includes(index));
            if (stillValid.length > 0 || completedVideoIndexes.length === 0) {
                return stillValid;
            }
            return completedVideoIndexes;
        });
    }, [scenes]);

    function buildImagePromptForScene(scene, useSimplifiedPrompt = false) {
        const characterLockText = characterDescription.trim()
            ? `Character identity lock: preserve this exact clay character across every scene: ${characterDescription.trim()}. Keep the same body shape, face, eyes, clothing/accessories, proportions, color palette, and handmade clay texture. Do not redesign the character.`
            : 'Character identity lock: preserve the same handmade clay character design from the scene/reference context. Keep body shape, face, eyes, clothing/accessories, proportions, color palette, and clay texture consistent. Do not redesign the character.';

        return useSimplifiedPrompt
            ? `Create one vertical 9:16 handmade stop-motion claymation frame. ${characterLockText} Main scene: ${scene?.frameDescription || ''}. Keep composition simple, clear subject, textured clay, non-CGI.`
            : `Generate a 9:16 vertical claymation stop-motion image. ${characterLockText} Scene: ${scene?.frameDescription || ''}. Handmade clay aesthetic, non-CGI, artistic stop-motion photography. Vertical portrait format, 9:16 aspect ratio. Professional claymation style with detailed textures and depth.`;
    }

    // Image upload handlers
    const handleImagePaste = (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        
        for (let item of items) {
            if (item.type.indexOf('image') !== -1) {
                const file = item.getAsFile();
                convertToBase64(file);
            }
        }
    };

    const handleImageDrop = (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.type.indexOf('image') !== -1) {
            convertToBase64(file);
        }
    };

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            convertToBase64(file);
        }
    };

    const convertToBase64 = (file) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            setReferenceImage(reader.result);
            addLog('SUCCESS', `Reference image loaded: ${file.name || 'pasted image'}.`);
        };
        reader.readAsDataURL(file);
    };

    // Manual image upload for individual scenes
    const handleSceneImagePaste = (sceneIndex, e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        
        for (let item of items) {
            if (item.type.indexOf('image') !== -1) {
                const file = item.getAsFile();
                convertSceneImageToBase64(file, sceneIndex);
            }
        }
    };

    const handleSceneImageUpload = (sceneIndex, file) => {
        if (file) {
            convertSceneImageToBase64(file, sceneIndex);
        }
    };

    const convertSceneImageToBase64 = (file, sceneIndex) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const updatedScenes = [...scenes];
            updatedScenes[sceneIndex].generatedImage = reader.result;
            updatedScenes[sceneIndex].isManualUpload = true;
            setScenes(updatedScenes);
            addLog('SUCCESS', `Scene ${sceneIndex + 1} manual image loaded: ${file.name || 'pasted image'}.`);
        };
        reader.readAsDataURL(file);
    };

    // Text generation with multimodal support
    const generateSceneDescriptions = async () => {
        console.log('=== STARTING GENERATION ===');
        addLog('API_CALL', `Starting scene breakdown with ${activeTextProvider}.`);
        
        if (!script.trim()) {
            addLog('ERROR', 'Scene breakdown blocked: no script entered.');
            alert('Please enter a script first');
            return;
        }

        const currentKey = activeTextProvider === 'openai' ? openAIKey : 
                          activeTextProvider === 'anthropic' ? anthropicKey : geminiKey;

        if (!currentKey.trim()) {
            addLog('ERROR', `Scene breakdown blocked: missing ${activeTextProvider.toUpperCase()} API key.`);
            alert(`Please enter your ${activeTextProvider.toUpperCase()} API key first`);
            return;
        }

        setIsGenerating(true);

        try {
            const systemPrompt = `You are an expert claymation video creator. Your job is to break down a script into individual scenes with frame descriptions for stop-motion clay animation.

For each scene:
1. Determine the approximate duration (3-9 seconds based on content)
2. Create a detailed visual description for the frame
3. Include camera angle, character actions, and background details
4. Extract the dialogue/voiceover text from the script
5. Follow the claymation aesthetic: handmade, non-CGI, stop-motion feel

${hasCharacter ? `Character reference: ${characterDescription}` : 'No character reference provided.'}
${visionGuidedBreakdown && referenceImage ? 'Use the reference image provided to guide the visual style and aesthetics.' : ''}

Format your response as JSON:
{
  "scenes": [
    {
      "text": "the script text for this scene",
      "dialogue": "the exact dialogue or voiceover spoken in this scene (empty string if none)",
      "duration": number (in seconds),
      "frameDescription": "detailed visual description including camera angle, character pose, expression, background, lighting"
    }
  ]
}

Guidelines:
- Keep scenes between 3-9 seconds
- Use specific camera angles: 3/4 shot, over-shoulder, straight-on, close-up, macro
- Describe character expressions and actions clearly
- Extract all dialogue/voiceover text into the dialogue field
- Keep backgrounds simple unless specified otherwise
- Maintain consistency with character description if provided`;

            const userPrompt = `Break down this script into claymation scenes:\n\n${script}`;
            addLog('API_CALL', `Text generation prompt:\n${userPrompt}`);
            let response, data, content;

            switch (activeTextProvider) {
                case 'openai':
                    console.log('Calling OpenAI API with gpt-4o...');
                    addLog('API_CALL', 'Calling OpenAI gpt-4o for scene JSON.');
                    const openaiMessages = [
                        { role: 'system', content: systemPrompt }
                    ];
                    
                    if (visionGuidedBreakdown && referenceImage) {
                        openaiMessages.push({
                            role: 'user',
                            content: [
                                { type: 'text', text: userPrompt },
                                { 
                                    type: 'image_url', 
                                    image_url: { url: referenceImage }
                                }
                            ]
                        });
                    } else {
                        openaiMessages.push({ role: 'user', content: userPrompt });
                    }

                    response = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${openAIKey}`
                        },
                        body: JSON.stringify({
                            model: 'gpt-4o',
                            messages: openaiMessages,
                            max_tokens: 4000
                        })
                    });
                    data = await response.json();
                    
                    if (!response.ok) {
                        throw new Error(`OpenAI Error (${response.status}): ${data.error?.message || 'Invalid API Key'}`);
                    }
                    
                    content = data.choices?.[0]?.message?.content || '';
                    break;

                case 'anthropic':
                    console.log('Calling Anthropic API with claude-3-5-sonnet...');
                    addLog('API_CALL', `Calling Anthropic claude-sonnet-4-5 with system prompt:\n${systemPrompt}`);
                    const anthropicContent = [];
                    
                    if (visionGuidedBreakdown && referenceImage) {
                        const base64Data = referenceImage.split(',')[1];
                        const mediaType = referenceImage.split(';')[0].split(':')[1];
                        
                        anthropicContent.push({
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mediaType,
                                data: base64Data
                            }
                        });
                    }
                    
                    anthropicContent.push({
                        type: 'text',
                        text: userPrompt
                    });

                    response = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': anthropicKey,
                            'anthropic-version': '2023-06-01'
                        },
                        body: JSON.stringify({
                            model: 'claude-sonnet-4-5',
                            max_tokens: 4000,
                            system: systemPrompt,
                            messages: [{ 
                                role: 'user', 
                                content: anthropicContent
                            }]
                        })
                    });
                    data = await response.json();
                    
                    if (!response.ok) {
                        throw new Error(`Anthropic Error (${response.status}): ${data.error?.message || 'Invalid API Key'}`);
                    }
                    
                    content = data.content?.find(c => c.type === 'text')?.text || '';
                    break;

                case 'gemini':
                    console.log('Calling Gemini API with gemini-1.5-pro...');
                    addLog('API_CALL', 'Calling Gemini gemini-1.5-pro for scene JSON.');
                    const geminiParts = [];
                    
                    if (visionGuidedBreakdown && referenceImage) {
                        const base64Data = referenceImage.split(',')[1];
                        const mimeType = referenceImage.split(';')[0].split(':')[1];
                        geminiParts.push({
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Data
                            }
                        });
                    }
                    
                    geminiParts.push({ text: `${systemPrompt}\n\n${userPrompt}` });

                    response = await fetch(`/gemini-proxy/v1beta/models/gemini-1.5-pro:generateContent?key=${geminiKey}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            contents: [{ parts: geminiParts }],
                            generationConfig: {
                                maxOutputTokens: 4000
                            }
                        })
                    });
                    data = await response.json();
                    
                    if (!response.ok) {
                        throw new Error(`Gemini Error (${response.status}): ${data.error?.message || 'Invalid API Key'}`);
                    }
                    
                    content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    break;

                default:
                    throw new Error('Invalid text provider');
            }

            console.log('Content received (first 200 chars):', content.substring(0, 200));

            if (!content) {
                throw new Error('No content received from API');
            }
            
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                addLog('SUCCESS', `Scene JSON returned:\n${JSON.stringify(parsed, null, 2)}`);
                
                if (!parsed.scenes || parsed.scenes.length === 0) {
                    throw new Error('API returned empty scenes array');
                }
                
                // Add generatedImage field to each scene
                const scenesWithImages = parsed.scenes.map(scene => ({
                    ...scene,
                    dialogue: scene.dialogue || '',
                    narratorScript: scene.dialogue || scene.text || '',
                    audioUrl: null,
                    audioFileName: '',
                    audioSource: '',
                    isGeneratingAudio: false,
                    voiceId: VOICE_CONFIG[0].id,
                    voiceVibe: 'Neutral',
                    imagePrompt: buildImagePromptForScene(scene),
                    generatedImage: null,
                    startFrame: null,
                    endFrame: null,
                    isGenerating: false,
                    error: null,
                    videoPrompt: generateVideoPrompt({ ...scene, dialogue: scene.dialogue || '' }),
                    isManualUpload: false,
                    videoUrl: null,
                    videoTaskId: null,
                    videoProgress: 0,
                    videoStatus: 'pending',
                    isGeneratingVideo: false,
                    videoEngine: null
                }));
                
                setScenes(scenesWithImages);
                addLog('SUCCESS', `Generated ${parsed.scenes.length} scene descriptions.`);
                alert(`✅ Successfully generated ${parsed.scenes.length} scenes!`);
            } else {
                throw new Error('No valid JSON found in API response');
            }
        } catch (error) {
            console.error('Error:', error);
            addLog('ERROR', `Scene breakdown failed: ${error.message}`);
            alert(`❌ Error: ${error.message}`);
        } finally {
            setIsGenerating(false);
        }
    };

    const fetchWithTimeout = async (url, options = {}, timeoutMs = 120000) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const externalSignal = options.signal;
        const abortFromExternal = () => controller.abort();

        if (externalSignal) {
            if (externalSignal.aborted) {
                controller.abort();
            } else {
                externalSignal.addEventListener('abort', abortFromExternal, { once: true });
            }
        }

        try {
            const { signal: _signal, ...fetchOptions } = options;
            return await fetch(url, {
                ...fetchOptions,
                signal: controller.signal
            });
        } catch (error) {
            if (error.name === 'AbortError') {
                if (externalSignal?.aborted) {
                    throw new Error(USER_CANCELLED_REQUEST);
                }
                throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
            externalSignal?.removeEventListener?.('abort', abortFromExternal);
        }
    };

    const clearImageGenerationProgressTimer = (sceneIndex) => {
        const timerId = activeImageGenTimersRef.current.get(sceneIndex);
        if (timerId) {
            clearInterval(timerId);
            activeImageGenTimersRef.current.delete(sceneIndex);
        }
    };

    const startOptimisticImageProgress = (sceneIndex, targetSeconds, statusText) => {
        clearImageGenerationProgressTimer(sceneIndex);
        const startedAt = performance.now();
        const timerId = setInterval(() => {
            const elapsedRatio = (performance.now() - startedAt) / (targetSeconds * 1000);
            const nextProgress = Math.min(95, Math.max(5, Math.round(elapsedRatio * 90) + 5));

            setScenes(prevScenes => prevScenes.map((scene, index) => (
                index === sceneIndex && scene.isGenerating
                    ? { ...scene, imageProgress: nextProgress, imageStatusText: statusText }
                    : scene
            )));

            if (nextProgress >= 95) {
                clearImageGenerationProgressTimer(sceneIndex);
            }
        }, 500);

        activeImageGenTimersRef.current.set(sceneIndex, timerId);
    };

    // Helper function for chunked parallel processing
    const processInChunks = async (items, chunkSize, processFn, delayMs = 1500) => {
        const results = [];
        for (let i = 0; i < items.length; i += chunkSize) {
            const chunk = items.slice(i, i + chunkSize);
            console.log(`Processing chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(items.length / chunkSize)}`);
            addLog('API_CALL', `Starting image batch ${Math.floor(i / chunkSize) + 1}/${Math.ceil(items.length / chunkSize)} with ${chunk.length} scene(s).`);
            
            // Process chunk in parallel using Promise.allSettled for graceful error handling
            const chunkResults = await Promise.allSettled(
                chunk.map(item => processFn(item))
            );
            
            results.push(...chunkResults);
            addLog('SUCCESS', `Image batch ${Math.floor(i / chunkSize) + 1} finished: ${chunkResults.filter(result => result.status === 'fulfilled').length} succeeded, ${chunkResults.filter(result => result.status === 'rejected').length} failed.`);
            
            // Add delay between chunks to avoid rate limits (except for last chunk)
            if (i + chunkSize < items.length) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        return results;
    };

    // NanoBanana image generation
    const generateSceneImage = async (sceneIndex, options = {}) => {
        const scene = scenes[sceneIndex];
        const currentKey = geminiKey;
        const selectedImageModel = options.forceImageModel || activeImageModel;
        const imageModelConfig = getImageModelConfig(selectedImageModel);
        const isFastImageModel = selectedImageModel === 'nanoBanana2';

        if (!currentKey.trim()) {
            addLog('ERROR', `Scene ${sceneIndex + 1} image generation blocked: missing Gemini API key.`);
            throw new Error('Gemini API key required for image generation');
        }

        if (imageAbortControllersRef.current.has(sceneIndex)) {
            addLog('API_CALL', `Scene ${sceneIndex + 1} image generation is already running. Duplicate request ignored.`);
            return { success: false, cancelled: false, duplicate: true, index: sceneIndex };
        }

        const imageAbortController = new AbortController();
        imageAbortControllersRef.current.set(sceneIndex, imageAbortController);
        const activeImagePrompt = options.prompt?.trim() || scene.imagePrompt?.trim() || buildImagePromptForScene(scene);
        const imageSeed = options.seed || getOrCreateImageSeed(scene, sceneIndex);
        const submittedImagePrompt = transformImagePromptForModel(activeImagePrompt, selectedImageModel);
        const imageStatusText = isFastImageModel
            ? 'Fast-track generation'
            : 'Crafting high-fidelity version... this may take longer';

        // Update scene generating state
        setScenes(prevScenes => prevScenes.map((item, index) => (
            index === sceneIndex
                ? {
                    ...item,
                    imagePrompt: activeImagePrompt,
                    imageSeed,
                    generatedImage: null,
                    isManualUpload: false,
                    isGenerating: true,
                    imageProgress: isFastImageModel ? 5 : 3,
                    imageStatusText,
                    error: null,
                    videoUrl: null,
                    videoTaskId: null,
                    videoProgress: 0,
                    videoStatus: 'pending',
                    isGeneratingVideo: false
                }
                : item
        )));
        startOptimisticImageProgress(sceneIndex, imageModelConfig.targetSeconds, imageStatusText);

        try {
            const startedAt = performance.now();
            const modelId = imageModelConfig.modelId;
            const candidateModelIds = [...new Set(imageModelConfig.candidateModelIds || [modelId])];
            const timeoutMs = imageModelConfig.timeoutMs;
            const buildImageParts = (useSimplifiedPrompt = false) => {
                const promptText = useSimplifiedPrompt
                    ? transformImagePromptForModel(buildImagePromptForScene(scene, true), selectedImageModel)
                    : submittedImagePrompt;

                const parts = [];
                if (nanoBananaStyleRef && referenceImage) {
                    const base64Data = referenceImage.split(',')[1];
                    const mimeType = referenceImage.split(';')[0].split(':')[1];
                    parts.push({
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data
                        }
                    });
                    parts.push({ 
                        text: useSimplifiedPrompt
                            ? `Use the reference only for style. ${promptText}`
                            : `Use this reference image as the character identity and clay style lock. Preserve the same character design, proportions, face, clothing/accessories, colors, and clay texture. ${promptText}` 
                    });
                } else {
                    parts.push({ text: promptText });
                }
                return parts;
            };

            const requestNanoBananaImage = async (imageParts, requestTimeoutMs, attemptLabel, candidateModelId = modelId) => {
                const promptText = imageParts[imageParts.length - 1]?.text || scene.frameDescription;
                const timerLabel = `[Image API] Scene ${sceneIndex + 1} ${imageModelConfig.label} ${attemptLabel} ${candidateModelId}`;
                addLog('API_CALL', `Requesting Scene ${sceneIndex + 1} image from ${imageModelConfig.label} (${candidateModelId}) [${attemptLabel}]. Quality=${imageModelConfig.quality}, Steps=${imageModelConfig.steps}, Upscale=${imageModelConfig.upscale}. Timeout=${Math.round(requestTimeoutMs / 1000)}s. Prompt: ${promptText}`);
                console.time(timerLabel);
                try {
                    return await fetchWithTimeout(`/gemini-proxy/v1beta/models/${candidateModelId}:generateContent?key=${currentKey}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(isFastImageModel ? { 'X-Model-Priority': imageModelConfig.priority } : {})
                        },
                        signal: imageAbortController.signal,
                        body: JSON.stringify({
                            contents: [{ parts: imageParts }],
                            generationConfig: {
                                responseModalities: ["IMAGE"],
                                seed: imageSeed
                            }
                        })
                    }, requestTimeoutMs);
                } finally {
                    console.timeEnd(timerLabel);
                }
            };

            const requestImageWithModelFallback = async (imageParts, requestTimeoutMs, attemptLabel) => {
                let lastResponse = null;
                let lastData = null;

                for (const candidateModelId of candidateModelIds) {
                    const candidateResponse = await requestNanoBananaImage(imageParts, requestTimeoutMs, attemptLabel, candidateModelId);
                    const candidateData = await candidateResponse.json();

                    if (candidateResponse.ok) {
                        return { response: candidateResponse, data: candidateData, resolvedModelId: candidateModelId };
                    }

                    lastResponse = candidateResponse;
                    lastData = candidateData;

                    const errorMessage = candidateData.error?.message || '';
                    const canTryNextModel = candidateResponse.status === 404 && /not found|not supported/i.test(errorMessage);
                    if (!canTryNextModel) {
                        break;
                    }

                    addLog('ERROR', `${candidateModelId} is unavailable for image generation. Trying next Gemini image model.`);
                }

                return {
                    response: lastResponse,
                    data: lastData || {},
                    resolvedModelId: candidateModelIds[candidateModelIds.length - 1]
                };
            };

            let response;
            let data;
            let resolvedModelId;
            try {
                ({ response, data, resolvedModelId } = await requestImageWithModelFallback(buildImageParts(false), timeoutMs, 'full prompt'));
            } catch (error) {
                if (!isFastImageModel || !error.message.includes('timed out')) {
                    throw error;
                }
                addLog('ERROR', `Scene ${sceneIndex + 1} full prompt timed out on NanoBanana 2. Retrying once with compressed prompt.`);
                ({ response, data, resolvedModelId } = await requestImageWithModelFallback(buildImageParts(true), 120000, 'compressed retry'));
            }

            console.log('Image API Response (Scene ' + (sceneIndex + 1) + '):', data.candidates?.[0]?.content ? 'Success' : 'Failed');

            if (!response.ok) {
                if (response.status === 429) {
                    throw new Error('Rate Limit Hit');
                }
                throw new Error(`API Error (${response.status}) using ${resolvedModelId}: ${data.error?.message || 'Unknown error'}`);
            }

            // Check multiple possible response formats
            const imageUrl = extractGeneratedImageUrl(data);
            let imageData = null;
            
            // Format 1: inlineData (camelCase) - THIS IS THE CORRECT ONE
            imageData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            
            // Format 2: inline_data (snake_case)
            if (!imageData) {
                imageData = data.candidates?.[0]?.content?.parts?.[0]?.inline_data?.data;
            }
            
            // Format 3: direct image data
            if (!imageData) {
                imageData = data.candidates?.[0]?.content?.parts?.[0]?.image?.data;
            }
            
            // Format 4: text response with base64
            if (!imageData) {
                const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (textContent && textContent.includes('base64')) {
                    imageData = textContent;
                }
            }

            console.log('Image output found (Scene ' + (sceneIndex + 1) + '):', !!(imageUrl || imageData));
            
            if (imageUrl || imageData) {
                const firstPixelSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);
                const generatedImage = imageUrl || (() => {
                    const mimeType = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType || 'image/jpeg';
                    return imageData.startsWith('data:') ? imageData : `data:${mimeType};base64,${imageData}`;
                })();

                setScenes(prevScenes => prevScenes.map((item, index) => (
                    index === sceneIndex
                        ? {
                            ...item,
                            generatedImage,
                            generatedImageModel: selectedImageModel,
                            imageSeed,
                            imageProgress: 100,
                            imageStatusText: null,
                            isGenerating: false,
                            error: null
                        }
                        : item
                )));
                addLog('SUCCESS', `${imageModelConfig.label} | Prompt Length: ${submittedImagePrompt.length} | Time to First Pixel: ${firstPixelSeconds} seconds`);
                addLog('SUCCESS', `Scene ${sceneIndex + 1} Image Generated in ${firstPixelSeconds}s. ${imageUrl ? `URL: ${imageUrl}` : `Base64 preview: ${generatedImage.slice(0, 120)}...`}`);
                return { success: true, index: sceneIndex };
            } else {
                console.error('Full API response:', data);
                throw new Error(`No image data in response`);
            }
        } catch (error) {
            const isCancelled = error.message === USER_CANCELLED_REQUEST;
            if (!isCancelled) {
                console.error(`Image generation error (Scene ${sceneIndex + 1}):`, error);
            }
            addLog(isCancelled ? 'SUCCESS' : 'ERROR', `Scene ${sceneIndex + 1} image generation ${isCancelled ? 'cancelled' : `failed: ${error.message}`}`);
            setScenes(prevScenes => prevScenes.map((item, index) => (
                index === sceneIndex
                    ? { ...item, isGenerating: false, imageProgress: 0, imageStatusText: null, error: isCancelled ? null : error.message }
                    : item
            )));
            if (isCancelled) {
                return { success: false, cancelled: true, index: sceneIndex };
            }
            throw error;
        } finally {
            clearImageGenerationProgressTimer(sceneIndex);
            if (imageAbortControllersRef.current.get(sceneIndex) === imageAbortController) {
                imageAbortControllersRef.current.delete(sceneIndex);
            }
        }
    };

    const generateSceneImageSafely = async (sceneIndex, options = {}) => {
        try {
            await generateSceneImage(sceneIndex, options);
        } catch (error) {
            // generateSceneImage already updates scene state and logs the technical error.
            if (error.message !== USER_CANCELLED_REQUEST) {
                addLog('ERROR', `Scene ${sceneIndex + 1} image request ended without a generated frame: ${error.message}`);
            }
        }
    };

    const redoSceneImageWithPro = (sceneIndex) => {
        const scene = scenes[sceneIndex];
        if (!scene || scene.isGenerating) return;

        const prompt = scene.imagePrompt?.trim() || buildImagePromptForScene(scene);
        const seed = getOrCreateImageSeed(scene, sceneIndex);
        addLog('API_CALL', `Redo with Pro requested for Scene ${sceneIndex + 1}. Reusing prompt and seed=${seed}.`);
        generateSceneImageSafely(sceneIndex, {
            forceImageModel: 'nanoBananaPro',
            prompt,
            seed
        });
    };

    const cancelSceneImageGeneration = (sceneIndex) => {
        const controller = imageAbortControllersRef.current.get(sceneIndex);
        if (!controller) {
            addLog('API_CALL', `Scene ${sceneIndex + 1} image cancellation ignored because no image request is active.`);
            return;
        }

        controller.abort();
        imageAbortControllersRef.current.delete(sceneIndex);
        setScenes(prevScenes => prevScenes.map((scene, index) => (
            index === sceneIndex ? { ...scene, isGenerating: false, imageProgress: 0, imageStatusText: null, error: null } : scene
        )));
        clearImageGenerationProgressTimer(sceneIndex);
        addLog('SUCCESS', `Manual cancellation: Scene ${sceneIndex + 1} image generation stopped.`);
    };

    const lockCharacterFromSceneOne = () => {
        const sceneOneImage = scenes[0]?.generatedImage;
        if (!sceneOneImage) {
            alert('Generate or upload Scene 1 first, then use it as the character reference.');
            return;
        }

        setReferenceImage(sceneOneImage);
        setNanoBananaStyleRef(true);
        setHasCharacter(true);
        showCopyFeedback('Scene 1 locked as character reference!');
        addLog('SUCCESS', 'Scene 1 image is now locked as the NanoBanana character/style reference for later frames.');
    };

    // Generate all images with chunked parallelism
    const generateAllImages = async () => {
        if (!geminiKey.trim()) {
            alert('Please enter your Gemini API key for image generation');
            return;
        }

        const sceneIndices = scenes
            .map((scene, index) => ({ scene, index }))
            .filter(({ scene }) => !scene.generatedImage && !scene.isGenerating)
            .map(({ index }) => index);

        if (sceneIndices.length === 0) {
            addLog('SUCCESS', 'Generate All Frames skipped: every scene already has an image.');
            alert('All scenes already have images. Use Regenerate on a scene if you want to replace one.');
            return;
        }

        setIsGeneratingImages(true);
        setGenerationProgress({ completed: 0, total: sceneIndices.length });
        
        const imageModelConfig = getImageModelConfig(activeImageModel);
        const CHUNK_SIZE = imageModelConfig.chunkSize;
        const DELAY_BETWEEN_CHUNKS = imageModelConfig.chunkDelayMs;
        
        console.log(`🚀 Starting batch generation: ${sceneIndices.length} images in chunks of ${CHUNK_SIZE}`);
        addLog('API_CALL', `Starting NanoBanana batch generation: ${sceneIndices.length} pending image(s), ${CHUNK_SIZE} parallel per batch, ${DELAY_BETWEEN_CHUNKS}ms delay between batches.`);
        
        try {
            const results = await processInChunks(
                sceneIndices,
                CHUNK_SIZE,
                async (index) => {
                    try {
                        return await generateSceneImage(index);
                    } finally {
                        // Advance progress for both successful and failed scenes so the UI cannot hang.
                        setGenerationProgress(prev => ({
                            completed: Math.min(prev.completed + 1, prev.total),
                            total: prev.total
                        }));
                    }
                },
                DELAY_BETWEEN_CHUNKS
            );
            
            // Count successes and failures
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            
            console.log(`✅ Generation complete: ${successful} successful, ${failed} failed`);
            addLog(failed > 0 ? 'ERROR' : 'SUCCESS', `Image batch complete: ${successful} successful, ${failed} failed.`);
            
            if (failed > 0) {
                alert(`⚠️ Generation complete!\n✅ ${successful} images generated successfully\n❌ ${failed} images failed\n\nFailed images can be regenerated individually.`);
            } else {
                alert(`✅ All ${successful} images generated successfully!`);
            }
        } catch (error) {
            console.error('Batch generation error:', error);
            addLog('ERROR', `Image batch generation failed: ${error.message}`);
            alert(`❌ Batch generation error: ${error.message}`);
        } finally {
            setIsGeneratingImages(false);
            setGenerationProgress({ completed: 0, total: 0 });
        }
    };

    // Download utilities
    const downloadImage = (imageData, filename) => {
        if (!imageData) return;
        const link = document.createElement('a');
        link.href = imageData;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        addLog('SUCCESS', `Saved generated image: ${filename}`);
    };

    const downloadAllFrames = async () => {
        const zip = new JSZip();
        
        for (const [index, scene] of scenes.entries()) {
            if (scene.generatedImage) {
                if (/^https?:\/\//i.test(scene.generatedImage)) {
                    const response = await fetch(scene.generatedImage);
                    const blob = await response.blob();
                    zip.file(`scene_${index + 1}.png`, blob);
                } else {
                    const base64Data = scene.generatedImage.split(',')[1];
                    zip.file(`scene_${index + 1}.png`, base64Data, { base64: true });
                }
            }
        }

        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, 'claymation_frames.zip');
    };

    const loadFFmpeg = useCallback(async () => {
        if (ffmpegRef.current?.loaded) {
            return ffmpegRef.current;
        }

        if (ffmpegLoadPromiseRef.current) {
            return ffmpegLoadPromiseRef.current;
        }

        ffmpegLoadPromiseRef.current = (async () => {
            const ffmpeg = ffmpegRef.current || new FFmpeg();
            ffmpegRef.current = ffmpeg;

            ffmpeg.on('log', ({ message }) => {
                if (message?.trim()) {
                    addLog('FFMPEG', message.trim());
                }
            });

            const canUseMultiThread = typeof window !== 'undefined' && window.crossOriginIsolated;
            const corePackage = canUseMultiThread ? '@ffmpeg/core-mt' : '@ffmpeg/core';
            const coreBaseURL = `https://unpkg.com/${corePackage}@0.12.10/dist/esm`;
            const loadOptions = {
                coreURL: await toBlobURL(`${coreBaseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${coreBaseURL}/ffmpeg-core.wasm`, 'application/wasm')
            };

            if (canUseMultiThread) {
                loadOptions.workerURL = await toBlobURL(`${coreBaseURL}/ffmpeg-core.worker.js`, 'text/javascript');
            }

            addLog('FFMPEG', `Loading FFmpeg ${canUseMultiThread ? 'multi-threaded' : 'single-thread'} core...`);
            await ffmpeg.load(loadOptions);
            addLog('SUCCESS', `FFmpeg loaded (${canUseMultiThread ? 'multi-threaded' : 'single-thread'}).`);
            return ffmpeg;
        })();

        try {
            return await ffmpegLoadPromiseRef.current;
        } catch (error) {
            ffmpegLoadPromiseRef.current = null;
            throw error;
        }
    }, [addLog]);

    const assembleFinalVideo = async (sceneIndexes = null) => {
        const requestedIndexes = Array.isArray(sceneIndexes) ? new Set(sceneIndexes) : null;
        const orderedVideos = scenes
            .map((scene, index) => ({ scene, index }))
            .filter(({ scene, index }) => {
                if (requestedIndexes && !requestedIndexes.has(index)) {
                    return false;
                }
                if (!scene.videoUrl) {
                    addLog('ERROR', `[FFMPEG] Skipping Scene ${index + 1}: missing generated video.`);
                    return false;
                }
                return true;
            });

        if (orderedVideos.length === 0) {
            alert(requestedIndexes ? 'No selected scene videos found. Select completed scene videos first.' : 'No generated scene videos found. Animate scenes first.');
            return;
        }

        setIsAssemblingVideo(true);
            const sceneLabel = orderedVideos.map(({ index }) => index + 1).join(', ');
            setAssemblyProgress(`Preparing ${orderedVideos.length} selected scene video(s): ${sceneLabel}...`);
            addLog('FFMPEG', `Assembling selected scene videos only: ${sceneLabel}.`);

        try {
            if (finalVideoUrl) {
                URL.revokeObjectURL(finalVideoUrl);
                setFinalVideoUrl(null);
            }

            const ffmpeg = await loadFFmpeg();
            const inputFiles = [];

            await Promise.all([
                ...orderedVideos.map((_, index) => ffmpeg.deleteFile(`scene_${String(index + 1).padStart(3, '0')}.mp4`).catch(() => {})),
                ...orderedVideos.map((_, index) => ffmpeg.deleteFile(`scene_audio_${String(index + 1).padStart(3, '0')}.mp3`).catch(() => {})),
                ...orderedVideos.map((_, index) => ffmpeg.deleteFile(`scene_muxed_${String(index + 1).padStart(3, '0')}.mp4`).catch(() => {})),
                ffmpeg.deleteFile('concat_list.txt').catch(() => {}),
                ffmpeg.deleteFile('output.mp4').catch(() => {})
            ]);

            for (let i = 0; i < orderedVideos.length; i += 1) {
                const { scene, index } = orderedVideos[i];
                const filename = `scene_${String(i + 1).padStart(3, '0')}.mp4`;
                setAssemblyProgress(`Loading Scene ${index + 1} (${i + 1}/${orderedVideos.length})...`);
                addLog('FFMPEG', `Loading file ${i + 1}/${orderedVideos.length}: Scene ${index + 1} from ${scene.videoUrl}`);

                const videoResponse = await fetch(scene.videoUrl);
                if (!videoResponse.ok) {
                    throw new Error(`Failed to fetch Scene ${index + 1} video (${videoResponse.status})`);
                }

                const videoBlob = await videoResponse.blob();
                await ffmpeg.writeFile(filename, await fetchFile(videoBlob));
                addLog('SUCCESS', `[FFMPEG] Scene ${index + 1} written to VFS as ${filename} (${(videoBlob.size / 1024 / 1024).toFixed(2)} MB).`);

                const muxedFilename = `scene_muxed_${String(i + 1).padStart(3, '0')}.mp4`;
                if (scene.audioUrl) {
                    const audioFilename = `scene_audio_${String(i + 1).padStart(3, '0')}.mp3`;
                    setAssemblyProgress(`Mixing voiceover for Scene ${index + 1}...`);
                    addLog('FFMPEG', `Loading voiceover for Scene ${index + 1} from ${scene.audioUrl}`);

                    const audioResponse = await fetch(scene.audioUrl);
                    if (!audioResponse.ok) {
                        throw new Error(`Failed to fetch Scene ${index + 1} audio (${audioResponse.status})`);
                    }

                    const audioBlob = await audioResponse.blob();
                    await ffmpeg.writeFile(audioFilename, await fetchFile(audioBlob));
                    addLog('FFMPEG', `Muxing Scene ${index + 1} video with ${scene.audioSource || 'voiceover'} audio.`);
                    await ffmpeg.exec([
                        '-i', filename,
                        '-i', audioFilename,
                        '-map', '0:v:0',
                        '-map', '1:a:0',
                        '-c:v', 'copy',
                        '-c:a', 'aac',
                        '-shortest',
                        muxedFilename
                    ]);
                    inputFiles.push(muxedFilename);
                } else {
                    setAssemblyProgress(`Adding silent audio track for Scene ${index + 1}...`);
                    await ffmpeg.exec([
                        '-i', filename,
                        '-f', 'lavfi',
                        '-t', String(scene.duration || 5),
                        '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
                        '-map', '0:v:0',
                        '-map', '1:a:0',
                        '-c:v', 'copy',
                        '-c:a', 'aac',
                        '-shortest',
                        muxedFilename
                    ]);
                    inputFiles.push(muxedFilename);
                }
            }

            const concatList = inputFiles.map(filename => `file '${filename}'`).join('\n');
            await ffmpeg.writeFile('concat_list.txt', new TextEncoder().encode(concatList));
            addLog('FFMPEG', `concat_list.txt created:\n${concatList}`);

            setAssemblyProgress(`Stitching selected scenes: ${orderedVideos.map(({ index }) => index + 1).join(', ')}...`);
            addLog('FFMPEG', 'Running ffmpeg -f concat -safe 0 -i concat_list.txt -c copy output.mp4');
            await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat_list.txt', '-c', 'copy', 'output.mp4']);

            const outputData = await ffmpeg.readFile('output.mp4');
            const outputBlob = new Blob([outputData], { type: 'video/mp4' });
            const outputUrl = URL.createObjectURL(outputBlob);
            setFinalVideoUrl(outputUrl);
            saveAs(outputBlob, 'claymation_final.mp4');
            addLog('SUCCESS', `Master video created: ${(outputBlob.size / 1024 / 1024).toFixed(2)} MB, ${orderedVideos.length} clip(s). Download triggered as claymation_final.mp4.`);
            setAssemblyProgress('Final master video ready.');
        } catch (error) {
            console.error('Final video assembly error:', error);
            addLog('ERROR', `[FFMPEG] Assembly failed: ${error.message}`);
            alert(`Final video assembly failed: ${error.message}`);
        } finally {
            setIsAssemblingVideo(false);
        }
    };

    // Reset studio
    const resetStudio = () => {
        if (confirm('Are you sure you want to reset the studio? This will clear all data and settings.')) {
            localStorage.clear();
            window.location.reload();
        }
    };

    // Generate video prompts for Kling or Veo
    const generateVideoPrompt = (scene, engine = videoPromptEngine) => {
        const baseDesc = scene.frameDescription;
        const dialogue = scene.dialogue;
        const claymationStyle = "Handmade stop-motion clay animation, non-CGI, artistic lighting, textured claymation aesthetic";
        
        if (engine === 'kling') {
            // Kling Format: [Camera] + [Action] + [Script/Dialogue context] + [Lighting]
            const cameraMatch = baseDesc.match(/(close-up|wide shot|3\/4 shot|over-shoulder|straight-on|macro|medium shot)/i);
            const camera = cameraMatch ? cameraMatch[0] : 'Medium shot';
            
            let prompt = `${camera}. ${baseDesc}. `;
            
            if (dialogue) {
                prompt += `Character says "${dialogue}" with matching lip-sync and facial expressions. `;
            }
            
            prompt += `${claymationStyle}. Animation must start at the first frame. Non-disney. Non-cartoon.`;
            
            return prompt;
        } else if (engine === 'veo') {
            // Veo Format: [Cinematic Framing] + [Detailed Action] + [Audio/Script cues] + [Claymation Texture]
            let prompt = `Cinematic claymation shot: ${baseDesc}. `;
            
            if (dialogue) {
                prompt += `Audio: Character speaks: "${dialogue}" with synchronized lip movements and emotive delivery. `;
            }
            
            prompt += `${claymationStyle}. Professional stop-motion cinematography with depth and detailed textures. Smooth frame-by-frame animation.`;
            
            return prompt;
        }
        
        return baseDesc;
    };

    // Generate video prompts for all scenes
    const generateAllVideoPrompts = () => {
        const updatedScenes = scenes.map(scene => ({
            ...scene,
            videoPrompt: generateVideoPrompt(scene)
        }));
        setScenes(updatedScenes);
        showCopyFeedback('Video prompts generated!');
    };

    // Copy utilities with feedback
    const showCopyFeedback = (message) => {
        setCopyFeedback(message);
        setTimeout(() => setCopyFeedback(''), 2000);
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        showCopyFeedback('Copied!');
    };

    const formatLogEntry = (log) => {
        const time = log.timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        return `[${time}] [${log.type}] ${log.message}`;
    };

    const copyEntireLog = () => {
        const output = logs.length
            ? logs.map(formatLogEntry).join('\n')
            : '[NO_LOGS] No system logs in this session.';
        copyToClipboard(output);
        addLog('SUCCESS', `Copied ${logs.length} log entries to clipboard.`);
    };

    const copyAllSceneData = () => {
        let output = "=== CLAYMATION SCENE BREAKDOWN ===\n\n";
        
        scenes.forEach((scene, index) => {
            output += `Scene ${index + 1} (${scene.duration}s)\n`;
            output += `Visual Description: ${scene.frameDescription}\n`;
            if (scene.dialogue) {
                output += `Script/Dialogue: "${scene.dialogue}"\n`;
            }
            output += `\n`;
        });

        copyToClipboard(output);
    };

    const copyAllVideoPrompts = () => {
        // Generate prompts if not already generated
        if (!scenes[0]?.videoPrompt) {
            const updatedScenes = scenes.map(scene => ({
                ...scene,
                videoPrompt: generateVideoPrompt(scene)
            }));
            setScenes(updatedScenes);
        }
        
        let output = `=== ${videoPromptEngine.toUpperCase()} VIDEO PROMPTS ===\n\n`;
        
        scenes.forEach((scene, index) => {
            const prompt = scene.videoPrompt || generateVideoPrompt(scene);
            output += `${index + 1}. ${prompt}\n\n`;
            output += `Duration: ${scene.duration}s\n`;
            output += `Settings: 780p, Audio ${scene.dialogue ? 'ON' : 'OFF'}\n\n`;
            output += `---\n\n`;
        });

        copyToClipboard(output);
    };

    // Clear all API keys
    const clearAllKeys = () => {
        if (confirm('Clear all API keys from browser storage?')) {
            setOpenAIKey('');
            setAnthropicKey('');
            setGeminiKey('');
            setKieAiKey('');
            localStorage.removeItem('openAIKey');
            localStorage.removeItem('anthropicKey');
            localStorage.removeItem('geminiKey');
            localStorage.removeItem('kieAiKey');
            showCopyFeedback('All keys cleared!');
        }
    };

    const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });

    const normalizeImageForKie = async (imageSource) => {
        if (!imageSource) {
            throw new Error('No scene image available for Kie.ai payload');
        }

        let normalizedSource = imageSource;
        if (imageSource.startsWith('blob:')) {
            const response = await fetch(imageSource);
            const blob = await response.blob();
            normalizedSource = await blobToDataUrl(blob);
        }

        if (normalizedSource.startsWith('data:')) {
            const [metadata, base64Data] = normalizedSource.split(',');
            if (!base64Data) {
                throw new Error('Loaded image data URL is missing Base64 content');
            }

            const mimeType = metadata.match(/^data:(.*?);base64$/)?.[1] || 'image/png';
            return {
                value: base64Data,
                dataUrl: normalizedSource,
                mimeType,
                sourceType: 'base64',
                byteLength: Math.round((base64Data.length * 3) / 4),
                preview: `${base64Data.slice(0, 80)}...`
            };
        }

        if (/^https?:\/\//i.test(normalizedSource)) {
            return {
                value: normalizedSource,
                dataUrl: normalizedSource,
                mimeType: 'remote-url',
                sourceType: 'url',
                byteLength: normalizedSource.length,
                preview: normalizedSource
            };
        }

        return {
            value: normalizedSource,
            dataUrl: `data:image/png;base64,${normalizedSource}`,
            mimeType: 'image/png',
            sourceType: 'base64',
            byteLength: Math.round((normalizedSource.length * 3) / 4),
            preview: `${normalizedSource.slice(0, 80)}...`
        };
    };

    const getKieImageUrl = async (kieImage, sceneIndex, signal) => {
        if (kieImage.sourceType === 'url') {
            addLog('API_CALL', `Scene ${sceneIndex + 1} using existing public image URL for I2V: ${kieImage.value}`);
            return kieImage.value;
        }

        const extension = kieImage.mimeType?.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
        const fileName = `scene_${sceneIndex + 1}_${Date.now()}.${extension}`;
        const base64Data = kieImage.dataUrl || `data:${kieImage.mimeType};base64,${kieImage.value}`;

        addLog('API_CALL', `Uploading Scene ${sceneIndex + 1} image to Kie file storage for true image-to-video. fileName=${fileName}`);

        const uploadPayload = {
            base64Data,
            uploadPath: 'claymation-i2v',
            fileName
        };
        const uploadEndpoints = [
            'https://kieai.redpandaai.co/api/file-base64-upload',
            '/kie-proxy/api/file-base64-upload'
        ];

        let uploadResponse = null;
        let uploadData = null;

        for (const uploadEndpoint of uploadEndpoints) {
            addLog('API_CALL', `Trying Kie image upload endpoint: ${uploadEndpoint}`);
            uploadResponse = await fetch(uploadEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${kieAiKey}`
                },
                signal,
                body: JSON.stringify(uploadPayload)
            });

            const responseText = await uploadResponse.text();
            try {
                uploadData = responseText ? JSON.parse(responseText) : {};
            } catch {
                uploadData = { message: responseText };
            }

            addLog('API_CALL', `Kie image upload response from ${uploadEndpoint} for Scene ${sceneIndex + 1}: ${JSON.stringify(uploadData, null, 2)}`);

            if (uploadResponse.ok) {
                break;
            }

            addLog('ERROR', `Kie image upload endpoint failed (${uploadResponse.status}): ${uploadEndpoint}`);
        }

        if (!uploadResponse?.ok) {
            throw new Error(`Kie image upload failed (${uploadResponse?.status || 'unknown'}): ${uploadData?.msg || uploadData?.message || JSON.stringify(uploadData)}`);
        }

        const imageUrl = uploadData.downloadUrl ||
                        uploadData.data?.downloadUrl ||
                        uploadData.data?.url ||
                        uploadData.url;

        if (!imageUrl) {
            throw new Error(`Kie image upload did not return a downloadUrl. Response: ${JSON.stringify(uploadData)}`);
        }

        addLog('SUCCESS', `Scene ${sceneIndex + 1} image uploaded for I2V. URL: ${imageUrl}`);
        return imageUrl;
    };

    // ===== KIE.AI UNIFIED VIDEO GENERATION SYSTEM =====
    
    // Generate video for single scene using Kie.ai API
    const generateSceneVideo = async (sceneIndex) => {
        const scene = scenes[sceneIndex];
        const startFrameSource = scene.startFrame || scene.generatedImage;
        const endFrameSource = scene.endFrame;
        
        if (!startFrameSource) {
            addLog('ERROR', `Scene ${sceneIndex + 1} video generation blocked: no image available.`);
            alert('Please generate, upload, or assign a Start Frame first');
            return;
        }

        if (!kieAiKey.trim()) {
            addLog('ERROR', 'Video generation blocked: missing Kie.ai API key.');
            alert('Please enter your Kie.ai API key');
            return;
        }

        if (videoAbortControllersRef.current.has(sceneIndex)) {
            addLog('API_CALL', `Scene ${sceneIndex + 1} video generation is already running. Duplicate request ignored.`);
            return;
        }

        const videoAbortController = new AbortController();
        videoAbortControllersRef.current.set(sceneIndex, videoAbortController);
        const activeVideoPrompt = scene.videoPrompt?.trim() || generateVideoPrompt(scene);

        // Update scene state
        const updatedScenes = [...scenes];
        updatedScenes[sceneIndex].isGeneratingVideo = true;
        updatedScenes[sceneIndex].videoStatus = 'submitting';
        updatedScenes[sceneIndex].videoProgress = 0;
        updatedScenes[sceneIndex].videoPrompt = activeVideoPrompt;
        setScenes(updatedScenes);

        let taskSubmitted = false;
        try {
            const kieStartImage = await normalizeImageForKie(startFrameSource);
            const kieStartImageUrl = await getKieImageUrl(kieStartImage, sceneIndex, videoAbortController.signal);
            const kieEndImage = endFrameSource ? await normalizeImageForKie(endFrameSource) : null;
            const kieEndImageUrl = kieEndImage ? await getKieImageUrl(kieEndImage, sceneIndex, videoAbortController.signal) : null;
            const kieImageUrls = kieEndImageUrl ? [kieStartImageUrl, kieEndImageUrl] : [kieStartImageUrl];
            const videoConfig = VIDEO_MODEL_CONFIGS[activeVideoEngine] || VIDEO_MODEL_CONFIGS['veo-3.1-fast'];
            const submittedVideoPrompt = transformVideoPrompt(activeVideoPrompt, activeVideoEngine);
            const klingNegativePrompt = isKlingVideoModel(activeVideoEngine) ? KLING_NEGATIVE_PROMPT : null;

            // Determine endpoint and model based on selected engine
            console.log(`📊 Current engine setting: ${activeVideoEngine}`);
            const endpoint = videoConfig.endpoint;
            const model = videoConfig.model;

            console.log(`🎬 Submitting video generation for Scene ${sceneIndex + 1}`);
            console.log(`   Engine: ${activeVideoEngine}`);
            console.log(`   Model: ${model}`);
            console.log(`   Endpoint: ${endpoint}`);
            addLog('API_CALL', `Scene ${sceneIndex + 1} start frame prepared for Kie.ai: source=${kieStartImage.sourceType}, mime=${kieStartImage.mimeType}, approxBytes=${kieStartImage.byteLength}, imagePreview=${kieStartImage.preview}`);
            if (kieEndImage) {
                addLog('API_CALL', `Scene ${sceneIndex + 1} end frame prepared for Kie.ai: source=${kieEndImage.sourceType}, mime=${kieEndImage.mimeType}, approxBytes=${kieEndImage.byteLength}, imagePreview=${kieEndImage.preview}`);
            }
            addLog('API_CALL', `Submitting Scene ${sceneIndex + 1} to Kie.ai I2V. Engine=${activeVideoEngine}, Model=${model}, Endpoint=${endpoint}, Mode=${videoConfig.mode || 'default'}, Resolution=${videoResolution}, Audio=${videoAudio && scene.dialogue ? 'ON' : 'OFF'}, imageUrls=${kieImageUrls.join(' → ')}. Prompt: ${submittedVideoPrompt}`);

            const requestBody = videoConfig.provider === 'veo'
                ? {
                    model: model,
                    prompt: submittedVideoPrompt,
                    imageUrls: kieImageUrls,
                    generationType: 'FIRST_AND_LAST_FRAMES_2_VIDEO',
                    duration: scene.duration,
                    aspect_ratio: '9:16',
                    resolution: videoResolution,
                    audio_enabled: videoAudio && scene.dialogue ? true : false
                }
                : {
                    model: model,
                    input: {
                        prompt: submittedVideoPrompt,
                        negative_prompt: klingNegativePrompt,
                        image_url: kieStartImageUrl,
                        image_urls: kieImageUrls,
                        duration: String(scene.duration),
                        aspect_ratio: '9:16',
                        mode: videoConfig.mode,
                        sound: videoAudio && scene.dialogue ? true : false,
                        multi_shots: false
                    }
                };

            const requestBodyLog = videoConfig.provider === 'veo'
                ? {
                    ...requestBody,
                    imageUrls: kieImageUrls,
                    uploadedImageSource: `start=[${kieStartImage.sourceType} ${kieStartImage.mimeType}, approx ${kieStartImage.byteLength} bytes] ${kieStartImage.preview}${kieEndImage ? `; end=[${kieEndImage.sourceType} ${kieEndImage.mimeType}, approx ${kieEndImage.byteLength} bytes] ${kieEndImage.preview}` : ''}`
                }
                : {
                    ...requestBody,
                    input: {
                        ...requestBody.input,
                        image_url: kieStartImageUrl,
                        image_urls: kieImageUrls
                    },
                    uploadedImageSource: `start=[${kieStartImage.sourceType} ${kieStartImage.mimeType}, approx ${kieStartImage.byteLength} bytes] ${kieStartImage.preview}${kieEndImage ? `; end=[${kieEndImage.sourceType} ${kieEndImage.mimeType}, approx ${kieEndImage.byteLength} bytes] ${kieEndImage.preview}` : ''}`
                };
            addLog('API_CALL', `Kie.ai request payload for Scene ${sceneIndex + 1}:\n${JSON.stringify(requestBodyLog, null, 2)}`);

            const videoTimerLabel = `[Video API] Scene ${sceneIndex + 1} ${videoConfig.label}`;
            console.time(videoTimerLabel);
            let response;
            try {
                response = await fetch(`/kie-proxy${endpoint}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${kieAiKey}`
                    },
                    signal: videoAbortController.signal,
                    body: JSON.stringify(requestBody)
                });
            } finally {
                console.timeEnd(videoTimerLabel);
            }

            const data = await response.json();
            console.log('📦 API Response:', data);
            addLog('API_CALL', `Kie.ai submit response for Scene ${sceneIndex + 1}: ${JSON.stringify(data, null, 2)}`);

            if (!response.ok) {
                console.error('❌ API Error Response:', data);
                console.error('   Status:', response.status);
                console.error('   Engine:', activeVideoEngine);
                console.error('   Endpoint:', endpoint);
                throw new Error(data.error?.message || data.message || `API Error ${response.status}: ${JSON.stringify(data)}`);
            }

            // Try multiple possible task ID fields (including nested ones)
            const taskId = data.task_id || 
                          data.taskId || 
                          data.id || 
                          data.request_id ||
                          data.data?.taskId ||  // Kie.ai format
                          data.data?.task_id ||
                          data.data?.id;

            console.log('🆔 Task ID:', taskId);
            console.log('📋 Full response keys:', Object.keys(data));

            if (!taskId) {
                console.error('❌ No task ID found in response. Full response:', data);
                addLog('ERROR', `No Kie.ai task ID found for Scene ${sceneIndex + 1}. Response: ${JSON.stringify(data, null, 2)}`);
                throw new Error(`No task ID received from API. Response: ${JSON.stringify(data).substring(0, 200)}`);
            }

            // Update scene with task ID
            updatedScenes[sceneIndex].videoTaskId = taskId;
            updatedScenes[sceneIndex].videoStatus = 'generating';
            setScenes([...updatedScenes]);

            console.log(`✅ Task submitted: ${taskId} for Scene ${sceneIndex + 1}`);
            addLog('SUCCESS', `Kie.ai task submitted for Scene ${sceneIndex + 1}. Task ID: ${taskId}`);

            // Start unified polling for this task
            taskSubmitted = true;
            startUnifiedPolling(sceneIndex, taskId, activeVideoEngine);

        } catch (error) {
            const isCancelled = error.name === 'AbortError' || error.message === USER_CANCELLED_REQUEST;
            if (!isCancelled) {
                console.error(`Video generation error (Scene ${sceneIndex + 1}):`, error);
            }
            addLog(isCancelled ? 'SUCCESS' : 'ERROR', `Scene ${sceneIndex + 1} video generation ${isCancelled ? 'cancelled' : `failed: ${error.message}`}`);
            updatedScenes[sceneIndex].isGeneratingVideo = false;
            updatedScenes[sceneIndex].videoStatus = isCancelled ? 'pending' : 'failed';
            updatedScenes[sceneIndex].error = isCancelled ? null : error.message;
            setScenes([...updatedScenes]);
        } finally {
            if (!taskSubmitted && videoAbortControllersRef.current.get(sceneIndex) === videoAbortController) {
                videoAbortControllersRef.current.delete(sceneIndex);
            }
        }
    };

    // Unified polling function for Kie.ai task status
    const startUnifiedPolling = (sceneIndex, taskId, engine) => {
        console.log(`🔄 Starting polling for Scene ${sceneIndex + 1}, Task: ${taskId}, Engine: ${engine}`);
        addLog('POLLING', `Starting Kie.ai polling for Scene ${sceneIndex + 1}. Task ID: ${taskId}. Engine: ${engine}.`);
        const videoConfig = VIDEO_MODEL_CONFIGS[engine] || VIDEO_MODEL_CONFIGS['veo-3.1-fast'];
        
        // Determine the correct polling endpoint based on engine
        const isVeo = videoConfig.pollFamily === 'veo';
        const pollEndpoint = isVeo 
            ? `/kie-proxy/api/v1/veo/record-info?taskId=${taskId}`
            : `/kie-proxy/api/v1/jobs/recordInfo?taskId=${taskId}`;
        
        console.log(`📍 Using ${isVeo ? 'Veo' : 'Kling'} polling endpoint: ${pollEndpoint}`);
        addLog('POLLING', `Polling endpoint selected: ${pollEndpoint}`);
        let pollCount = 0;
        
        const pollInterval = setInterval(async () => {
            const sceneStillActive = videoAbortControllersRef.current.has(sceneIndex);
            if (!sceneStillActive) {
                clearInterval(pollInterval);
                videoPollingIntervalsRef.current.delete(sceneIndex);
                videoPollingIntervalsRef.current.delete(taskId);
                setVideoPollingMap(prev => {
                    const newMap = new Map(prev);
                    newMap.delete(taskId);
                    return newMap;
                });
                return;
            }

            try {
                pollCount += 1;
                const response = await fetch(pollEndpoint, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${kieAiKey}`
                    }
                });

                if (!response.ok) {
                    console.error(`❌ Polling HTTP error for Scene ${sceneIndex + 1}:`, response.status);
                    addLog('ERROR', `Poll #${pollCount}: Scene ${sceneIndex + 1} HTTP ${response.status}.`);
                    return;
                }

                const data = await response.json();
                if (!videoAbortControllersRef.current.has(sceneIndex)) {
                    clearInterval(pollInterval);
                    videoPollingIntervalsRef.current.delete(sceneIndex);
                    videoPollingIntervalsRef.current.delete(taskId);
                    return;
                }
                
                if (data.code !== 200) {
                    console.error(`❌ API returned error code: ${data.code}, message: ${data.msg}`);
                    addLog('ERROR', `Poll #${pollCount}: Kie.ai returned code ${data.code}. ${data.msg || 'No message.'}`);
                    return;
                }
                
                const updatedScenes = [...scenes];
                const taskData = data.data;
                
                if (isVeo) {
                    // Veo format: successFlag (0=generating, 1=success, 2/3=failed)
                    const successFlag = taskData.successFlag;
                    console.log(`📊 Veo poll Scene ${sceneIndex + 1}: successFlag=${successFlag}`);
                    addLog('POLLING', `Poll #${pollCount}: Kie.ai Task ID ${taskId} - Veo successFlag ${successFlag}.`);
                    
                    if (successFlag === 0) {
                        // Still generating - increment progress gradually
                        updatedScenes[sceneIndex].videoProgress = Math.min(updatedScenes[sceneIndex].videoProgress + 5, 90);
                        updatedScenes[sceneIndex].videoStatus = 'generating';
                        addLog('POLLING', `Poll #${pollCount}: Scene ${sceneIndex + 1} rendering ${updatedScenes[sceneIndex].videoProgress}%.`);
                        setScenes([...updatedScenes]);
                    } else if (successFlag === 1) {
                        // Success - parse resultUrls (JSON string)
                        console.log(`🔍 Full taskData for Scene ${sceneIndex + 1}:`, taskData);
                        console.log(`🔍 resultUrls field:`, taskData.resultUrls);
                        console.log(`🔍 resultUrls type:`, typeof taskData.resultUrls);
                        
                        let videoUrl;
                        if (taskData.resultUrls) {
                            if (typeof taskData.resultUrls === 'string') {
                                const resultUrls = JSON.parse(taskData.resultUrls);
                                videoUrl = resultUrls[0];
                            } else if (Array.isArray(taskData.resultUrls)) {
                                videoUrl = taskData.resultUrls[0];
                            }
                        }
                        
                        // Try alternative field names
                        if (!videoUrl) {
                            videoUrl = taskData.videoUrl || taskData.video_url || taskData.url || 
                                      taskData.response?.videoUrl || taskData.response?.video_url ||
                                      taskData.response?.resultUrls?.[0] ||
                                      taskData.response?.originUrls?.[0] ||
                                      taskData.response?.fullResultUrls?.[0] ||
                                      taskData.response?.full_result_urls?.[0];
                        }
                        
                        console.log(`✅ Veo video completed for Scene ${sceneIndex + 1}:`, videoUrl);
                        
                        if (videoUrl) {
                            updatedScenes[sceneIndex].videoUrl = videoUrl;
                            updatedScenes[sceneIndex].videoEngine = engine;
                            updatedScenes[sceneIndex].isGeneratingVideo = false;
                            updatedScenes[sceneIndex].videoStatus = 'completed';
                            updatedScenes[sceneIndex].videoProgress = 100;
                            setScenes([...updatedScenes]);
                            addLog('SUCCESS', `Scene ${sceneIndex + 1} Veo video completed. URL: ${videoUrl}`);
                            videoAbortControllersRef.current.delete(sceneIndex);
                            videoPollingIntervalsRef.current.delete(sceneIndex);
                            videoPollingIntervalsRef.current.delete(taskId);
                            clearInterval(pollInterval);
                            setVideoPollingMap(prev => {
                                const newMap = new Map(prev);
                                newMap.delete(taskId);
                                return newMap;
                            });
                        } else {
                            console.error(`❌ Could not find video URL in response. Full taskData:`, JSON.stringify(taskData, null, 2));
                            addLog('ERROR', `Scene ${sceneIndex + 1} Veo completed but video URL was not found. Response: ${JSON.stringify(taskData, null, 2)}`);
                            updatedScenes[sceneIndex].isGeneratingVideo = false;
                            updatedScenes[sceneIndex].videoStatus = 'failed';
                            updatedScenes[sceneIndex].videoProgress = 100;
                            updatedScenes[sceneIndex].error = 'Video generated but URL not found in response. Check console for details.';
                            setScenes([...updatedScenes]);
                            videoAbortControllersRef.current.delete(sceneIndex);
                            videoPollingIntervalsRef.current.delete(sceneIndex);
                            videoPollingIntervalsRef.current.delete(taskId);
                            clearInterval(pollInterval);
                            setVideoPollingMap(prev => {
                                const newMap = new Map(prev);
                                newMap.delete(taskId);
                                return newMap;
                            });
                        }
                    } else if (successFlag === 2 || successFlag === 3) {
                        // Failed
                        console.error(`❌ Veo video failed for Scene ${sceneIndex + 1}, successFlag=${successFlag}`);
                        const veoFailureMessage = taskData.errorMessage || 'Video generation failed';
                        const isSafetyBlock = /safety|restricted|third-party|copyright|content/i.test(veoFailureMessage);
                        addLog('ERROR', `Scene ${sceneIndex + 1} Veo failed. successFlag=${successFlag}. ${veoFailureMessage}${isSafetyBlock ? ' Try replacing the Start/End frame with original non-IP clay assets and remove brand/character references from the prompt.' : ''}`);
                        updatedScenes[sceneIndex].isGeneratingVideo = false;
                        updatedScenes[sceneIndex].videoStatus = 'failed';
                        updatedScenes[sceneIndex].error = isSafetyBlock
                            ? `Safety filters blocked the request: ${veoFailureMessage}`
                            : veoFailureMessage;
                        setScenes([...updatedScenes]);
                        videoAbortControllersRef.current.delete(sceneIndex);
                        videoPollingIntervalsRef.current.delete(sceneIndex);
                        videoPollingIntervalsRef.current.delete(taskId);
                        clearInterval(pollInterval);
                        setVideoPollingMap(prev => {
                            const newMap = new Map(prev);
                            newMap.delete(taskId);
                            return newMap;
                        });
                    }
                } else {
                    // Kling format: status (waiting/queuing/generating/success/fail)
                    const status = taskData.status;
                    console.log(`📊 Kling poll Scene ${sceneIndex + 1}: status=${status}`);
                    addLog('POLLING', `Poll #${pollCount}: Kie.ai Task ID ${taskId} - Kling status ${status}.`);
                    
                    if (status === 'waiting' || status === 'queuing') {
                        updatedScenes[sceneIndex].videoProgress = 10;
                        updatedScenes[sceneIndex].videoStatus = 'queued';
                        addLog('POLLING', `Poll #${pollCount}: Scene ${sceneIndex + 1} queued 10%.`);
                        setScenes([...updatedScenes]);
                    } else if (status === 'generating') {
                        updatedScenes[sceneIndex].videoProgress = Math.min(updatedScenes[sceneIndex].videoProgress + 5, 90);
                        updatedScenes[sceneIndex].videoStatus = 'generating';
                        addLog('POLLING', `Poll #${pollCount}: Scene ${sceneIndex + 1} rendering ${updatedScenes[sceneIndex].videoProgress}%.`);
                        setScenes([...updatedScenes]);
                    } else if (status === 'success') {
                        // Success - parse resultJson (JSON string)
                        const resultJson = JSON.parse(taskData.resultJson || '{}');
                        const videoUrl = resultJson.videos?.[0]?.url || resultJson.video_url || resultJson.url;
                        console.log(`✅ Kling video completed for Scene ${sceneIndex + 1}:`, videoUrl);
                        
                        if (videoUrl) {
                            updatedScenes[sceneIndex].videoUrl = videoUrl;
                            updatedScenes[sceneIndex].videoEngine = engine;
                            updatedScenes[sceneIndex].isGeneratingVideo = false;
                            updatedScenes[sceneIndex].videoStatus = 'completed';
                            updatedScenes[sceneIndex].videoProgress = 100;
                            setScenes([...updatedScenes]);
                            addLog('SUCCESS', `Scene ${sceneIndex + 1} Kling video completed. URL: ${videoUrl}`);
                            videoAbortControllersRef.current.delete(sceneIndex);
                            videoPollingIntervalsRef.current.delete(sceneIndex);
                            videoPollingIntervalsRef.current.delete(taskId);
                            clearInterval(pollInterval);
                            setVideoPollingMap(prev => {
                                const newMap = new Map(prev);
                                newMap.delete(taskId);
                                return newMap;
                            });
                        }
                    } else if (status === 'fail') {
                        // Failed
                        console.error(`❌ Kling video failed for Scene ${sceneIndex + 1}`);
                        addLog('ERROR', `Scene ${sceneIndex + 1} Kling failed. ${taskData.failReason || ''}`);
                        updatedScenes[sceneIndex].isGeneratingVideo = false;
                        updatedScenes[sceneIndex].videoStatus = 'failed';
                        updatedScenes[sceneIndex].error = taskData.failReason || 'Video generation failed';
                        setScenes([...updatedScenes]);
                        videoAbortControllersRef.current.delete(sceneIndex);
                        videoPollingIntervalsRef.current.delete(sceneIndex);
                        videoPollingIntervalsRef.current.delete(taskId);
                        clearInterval(pollInterval);
                        setVideoPollingMap(prev => {
                            const newMap = new Map(prev);
                            newMap.delete(taskId);
                            return newMap;
                        });
                    }
                }
            } catch (error) {
                console.error(`⚠️ Polling exception for Scene ${sceneIndex + 1}:`, error);
                addLog('ERROR', `Poll #${pollCount}: Scene ${sceneIndex + 1} polling exception: ${error.message}`);
            }
        }, 3000); // Poll every 3 seconds

        // Store interval in map for cleanup
        videoPollingIntervalsRef.current.set(sceneIndex, pollInterval);
        videoPollingIntervalsRef.current.set(taskId, pollInterval);
        setVideoPollingMap(prev => new Map(prev).set(taskId, pollInterval));
    };

    // Generate all videos in parallel
    const generateAllVideos = async () => {
        if (!kieAiKey.trim()) {
            alert('Please enter your Kie.ai API key');
            return;
        }

        const scenesWithImages = scenes.filter(s => s.generatedImage);
        if (scenesWithImages.length === 0) {
            alert('Please generate images first');
            return;
        }

        setIsGeneratingVideos(true);
        
        console.log(`🎬 Starting parallel video generation for ${scenesWithImages.length} scenes via Kie.ai`);

        try {
            // Submit all videos in parallel
            const promises = scenes.map((scene, index) => {
                if (scene.generatedImage && !scene.videoUrl) {
                    return generateSceneVideo(index);
                }
                return Promise.resolve();
            });

            await Promise.all(promises);
            
            const engineName = (VIDEO_MODEL_CONFIGS[activeVideoEngine] || VIDEO_MODEL_CONFIGS['veo-3.1-fast']).label;
            alert(`✅ All videos submitted to Kie.ai (${engineName})! Videos will complete in 15-60 seconds. Watch the progress bars for real-time updates.`);
        } catch (error) {
            console.error('Batch video generation error:', error);
            alert(`❌ Error: ${error.message}`);
        } finally {
            setIsGeneratingVideos(false);
        }
    };

    // Download video
    const downloadVideo = (videoUrl, filename) => {
        const link = document.createElement('a');
        link.href = videoUrl;
        link.download = filename;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const cancelSceneVideoGeneration = (sceneIndex) => {
        const scene = scenes[sceneIndex];
        const controller = videoAbortControllersRef.current.get(sceneIndex);
        const intervalFromScene = videoPollingIntervalsRef.current.get(sceneIndex);
        const intervalFromTask = scene?.videoTaskId ? videoPollingIntervalsRef.current.get(scene.videoTaskId) : null;

        if (!controller && !scene?.videoTaskId && !intervalFromScene && !intervalFromTask) {
            addLog('API_CALL', `Scene ${sceneIndex + 1} video cancellation ignored because no video request is active.`);
            return;
        }

        controller?.abort();
        videoAbortControllersRef.current.delete(sceneIndex);

        if (intervalFromScene) {
            clearInterval(intervalFromScene);
            videoPollingIntervalsRef.current.delete(sceneIndex);
        }

        if (scene?.videoTaskId) {
            const intervalId = intervalFromTask || videoPollingMap.get(scene.videoTaskId);
            if (intervalId) {
                clearInterval(intervalId);
                videoPollingIntervalsRef.current.delete(scene.videoTaskId);
                setVideoPollingMap(prev => {
                    const newMap = new Map(prev);
                    newMap.delete(scene.videoTaskId);
                    return newMap;
                });
            }
        }

        setScenes(prevScenes => prevScenes.map((item, index) => (
            index === sceneIndex
                ? { ...item, isGeneratingVideo: false, videoStatus: 'pending', videoProgress: 0, videoTaskId: null, error: null }
                : item
        )));
        addLog('SUCCESS', `Manual cancellation: Scene ${sceneIndex + 1} video generation stopped.`);
    };

    const exportAllPrompts = () => {
        let output = "CLAYMATION PRODUCTION EXPORT\n";
        output += "=".repeat(60) + "\n\n";
        
        scenes.forEach((scene, index) => {
            output += `SCENE ${index + 1} (${scene.duration}s)\n`;
            output += "-".repeat(60) + "\n";
            output += `Description: ${scene.text}\n\n`;
            if (scene.dialogue) {
                output += `Dialogue: "${scene.dialogue}"\n\n`;
            }
            output += `Frame Description:\n${scene.frameDescription}\n\n`;
            output += `Video Prompt (${videoPromptEngine.toUpperCase()}):\n${scene.videoPrompt || generateVideoPrompt(scene)}\n\n`;
            output += `Settings: 780p, Audio ${scene.dialogue ? 'ON' : 'OFF'}\n`;
            output += `Duration: ${scene.duration} seconds\n\n`;
            output += "\n";
        });

        copyToClipboard(output);
    };

    const selectedScene = scenes[selectedSceneIndex] || null;
    const totalDuration = scenes.reduce((sum, scene) => sum + (Number(scene.duration) || 0), 0);
    const scenesWithImagesCount = scenes.filter(scene => scene.generatedImage).length;
    const scenesWithVideosCount = scenes.filter(scene => scene.videoUrl).length;
    const scenesWithAudioCount = scenes.filter(scene => scene.audioUrl).length;
    const selectedAssemblyVideosCount = selectedAssemblySceneIndexes.filter(index => scenes[index]?.videoUrl).length;
    const filteredLogs = logFilter === 'ALL' ? logs : logs.filter(log => log.type === logFilter);

    // Live budget — recomputed only when scenes array changes (memoized)
    const liveBudget = React.useMemo(() => {
        const imagePts = scenesWithImagesCount * PTS_COST.image;
        const videoPts = scenesWithVideosCount * PTS_COST.video;
        const audioPts = scenesWithAudioCount * PTS_COST.voiceover;
        const total = imagePts + videoPts + audioPts;

        // Per-engine video breakdown
        const engineBreakdown = {};
        scenes.forEach(scene => {
            if (!scene.videoUrl || !scene.videoEngine) return;
            const label = VIDEO_MODEL_CONFIGS[scene.videoEngine]?.label || scene.videoEngine;
            engineBreakdown[label] = (engineBreakdown[label] || 0) + PTS_COST.video;
        });

        return { imagePts, videoPts, audioPts, total, engineBreakdown };
    }, [scenes, scenesWithImagesCount, scenesWithVideosCount, scenesWithAudioCount]);

    const getSceneStatus = (scene) => {
        if (!scene) return 'Draft';
        if (scene.error) return 'Failed';
        if (scene.isGeneratingVideo) return 'Animating';
        if (scene.videoUrl) return 'Video Ready';
        if (scene.generatedImage) return 'Image Ready';
        return 'Draft';
    };

    const getStatusClasses = (status) => {
        switch (status) {
            case 'Video Ready':
                return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
            case 'Animating':
                return 'bg-orange-500/15 text-orange-300 border-orange-500/30';
            case 'Image Ready':
                return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
            case 'Failed':
                return 'bg-red-500/15 text-red-300 border-red-500/30';
            default:
                return 'bg-slate-700/60 text-slate-300 border-slate-600/60';
        }
    };

    const getCurrentStep = () => {
        if (finalVideoUrl) return 'Export';
        if (scenesWithVideosCount > 0 || scenes.some(scene => scene.isGeneratingVideo)) return 'Animate';
        if (scenesWithImagesCount > 0) return 'Images';
        if (scenes.length > 0) return 'Scene Breakdown';
        return 'Story';
    };

    const currentStep = getCurrentStep();
    const isLiteVideoEngine = getVideoModelTier(activeVideoEngine) === 'lite';

    const getNextAction = () => {
        if (scenes.length === 0) {
            return {
                label: script.trim() ? 'Create Scene Breakdown' : 'Add Scene Manually',
                action: script.trim() ? generateSceneDescriptions : addManualScene,
                disabled: isGenerating
            };
        }
        if (scenesWithImagesCount < scenes.length) {
            return {
                label: isGeneratingImages ? 'Generating Images...' : 'Generate All Images',
                action: generateAllImages,
                disabled: isGeneratingImages
            };
        }
        if (scenesWithVideosCount < scenes.length) {
            return {
                label: isGeneratingVideos ? 'Animating Scenes...' : 'Animate All Scenes',
                action: generateAllVideos,
                disabled: isGeneratingVideos
            };
        }
        if (!finalVideoUrl) {
            return {
                label: isAssemblingVideo ? 'Creating Final Video...' : 'Create Final Video',
                action: assembleFinalVideo,
                disabled: isAssemblingVideo
            };
        }
        return {
            label: 'Download Final Movie',
            action: () => saveAs(finalVideoUrl, 'claymation_final.mp4'),
            disabled: false
        };
    };

    const nextAction = getNextAction();

    const toggleAssemblyScene = (index) => {
        if (!scenes[index]?.videoUrl) {
            addLog('API_CALL', `Scene ${index + 1} cannot be selected for assembly yet because no completed video exists.`);
            return;
        }

        setSelectedAssemblySceneIndexes(prev => (
            prev.includes(index)
                ? prev.filter(item => item !== index)
                : [...prev, index].sort((a, b) => a - b)
        ));
        addLog('SUCCESS', `Scene ${index + 1} assembly selection toggled.`);
    };

    function createSceneTemplate(title = `Scene ${scenes.length + 1}`) {
        return {
            text: title,
            dialogue: '',
            narratorScript: '',
            audioUrl: null,
            audioFileName: '',
            audioSource: '',
            isGeneratingAudio: false,
            voiceId: VOICE_CONFIG[0].id,
            voiceVibe: 'Neutral',
            duration: 5,
            frameDescription: 'Describe your scene here...',
            imagePrompt: '',
            generatedImage: null,
            startFrame: null,   // I2V start frame (defaults to generatedImage)
            endFrame: null,     // I2V end frame (continuity from prev scene)
            isGenerating: false,
            error: null,
            videoPrompt: '',
            isManualUpload: false,
            videoUrl: null,
            videoTaskId: null,
            videoProgress: 0,
            videoStatus: 'pending',
            isGeneratingVideo: false,
            videoEngine: null   // which engine produced the video
        };
    }

    function addManualScene() {
        const newScene = createSceneTemplate(`Scene ${scenes.length + 1}`);
        setScenes(prev => [...prev, newScene]);
        setSelectedSceneIndex(scenes.length);
    }

    const updateSceneField = (index, field, value) => {
        setScenes(prev => prev.map((scene, sceneIndex) => (
            sceneIndex === index ? { ...scene, [field]: value } : scene
        )));
    };

    const updateScenePromptField = (index, field, value) => {
        updateSceneField(index, field, value);
    };

    const logPromptModification = (index, label) => {
        addLog('SUCCESS', `Manual modification: Scene ${index + 1} ${label} updated by user.`);
    };

    const setSceneAudio = (sceneIndex, audioUrl, audioFileName, audioSource) => {
        setScenes(prev => prev.map((scene, index) => {
            if (index !== sceneIndex) return scene;
            if (scene.audioUrl && scene.audioUrl.startsWith('blob:')) {
                URL.revokeObjectURL(scene.audioUrl);
            }
            return {
                ...scene,
                audioUrl,
                audioFileName,
                audioSource,
                isGeneratingAudio: false
            };
        }));
    };

    const handleSceneAudioUpload = (sceneIndex, file) => {
        if (!file) return;
        const audioUrl = URL.createObjectURL(file);
        setSceneAudio(sceneIndex, audioUrl, file.name, 'upload');
        addLog('SUCCESS', `Scene ${sceneIndex + 1} audio uploaded manually: ${file.name}. This overrides any AI-generated audio.`);
    };

    const playVoiceSample = (voice) => {
        if (!voice?.sampleUrl) return;

        if (sampleAudioRef.current && playingVoiceSample === voice.id) {
            sampleAudioRef.current.pause();
            sampleAudioRef.current = null;
            setPlayingVoiceSample('');
            return;
        }

        if (sampleAudioRef.current) {
            sampleAudioRef.current.pause();
        }

        const audio = new Audio(voice.sampleUrl);
        sampleAudioRef.current = audio;
        setPlayingVoiceSample(voice.id);
        audio.onended = () => setPlayingVoiceSample('');
        audio.onerror = () => {
            setPlayingVoiceSample('');
            addLog('ERROR', `Voice sample failed to play: ${voice.name}. Check public${voice.sampleUrl}.`);
        };
        audio.play().catch(error => {
            setPlayingVoiceSample('');
            addLog('ERROR', `Voice sample playback blocked: ${error.message}`);
        });
    };

    const generateNarratorAudio = async (sceneIndex) => {
        const scene = scenes[sceneIndex];
        const narratorScript = scene?.narratorScript?.trim() || scene?.dialogue?.trim() || scene?.text?.trim();
        const selectedVoiceId = normalizeVoiceId(scene?.voiceId);
        const selectedVibe = scene?.voiceVibe || 'Neutral';

        if (!openAIKey.trim()) {
            alert('Please enter your OpenAI API key for narrator audio.');
            addLog('ERROR', `Scene ${sceneIndex + 1} audio generation blocked: missing OpenAI API key.`);
            return;
        }

        if (!narratorScript) {
            alert('Add narrator script or dialogue before generating voiceover.');
            addLog('ERROR', `Scene ${sceneIndex + 1} audio generation blocked: empty narrator script.`);
            return;
        }

        if (audioAbortControllersRef.current.has(sceneIndex)) {
            addLog('API_CALL', `Scene ${sceneIndex + 1} audio generation already running. Duplicate request ignored.`);
            return;
        }

        const audioAbortController = new AbortController();
        audioAbortControllersRef.current.set(sceneIndex, audioAbortController);
        setScenes(prev => prev.map((item, index) => (
            index === sceneIndex ? { ...item, isGeneratingAudio: true } : item
        )));

        try {
            addLog('API_CALL', `Generating OpenAI TTS audio for Scene ${sceneIndex + 1}. Voice=${selectedVoiceId}, vibe=${selectedVibe}. Script: ${narratorScript}`);
            const response = await fetch('/openai-proxy/v1/audio/speech', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openAIKey}`
                },
                signal: audioAbortController.signal,
                body: JSON.stringify({
                    model: 'tts-1',
                    voice: selectedVoiceId,
                    input: narratorScript,
                    response_format: 'mp3'
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenAI TTS Error (${response.status}): ${errorText}`);
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            const audioFileName = `scene_${sceneIndex + 1}_${selectedVoiceId}_${selectedVibe.toLowerCase()}.mp3`;
            setSceneAudio(sceneIndex, audioUrl, audioFileName, 'tts-1');
            addLog('SUCCESS', `Scene ${sceneIndex + 1} AI narrator audio generated (${(audioBlob.size / 1024).toFixed(1)} KB).`);
        } catch (error) {
            if (error.name === 'AbortError') {
                addLog('SUCCESS', `Scene ${sceneIndex + 1} audio generation cancelled.`);
            } else {
                console.error('Narrator audio generation error:', error);
                addLog('ERROR', `Scene ${sceneIndex + 1} audio generation failed: ${error.message}`);
                alert(`Audio generation failed: ${error.message}`);
            }
            setScenes(prev => prev.map((item, index) => (
                index === sceneIndex ? { ...item, isGeneratingAudio: false } : item
            )));
        } finally {
            audioAbortControllersRef.current.delete(sceneIndex);
        }
    };

    // ── Asset Tray helpers ──────────────────────────────────────────────────

    /** Open the tray for a specific scene + slot ('start' or 'end') */
    const openAssetTray = useCallback((sceneIndex, slot) => {
        setAssetTraySceneIndex(sceneIndex);
        setAssetTraySlot(slot);
        setAssetTrayOpen(true);
    }, []);

    /** Assign an image to startFrame or endFrame */
    const assignFrameSlot = useCallback((sceneIndex, slot, imageDataOrUrl) => {
        setScenes(prev => prev.map((scene, i) => (
            i === sceneIndex ? { ...scene, [slot === 'start' ? 'startFrame' : 'endFrame']: imageDataOrUrl } : scene
        )));
        setAssetTrayOpen(false);
        addLog('SUCCESS', `Scene ${sceneIndex + 1} ${slot} frame assigned.`);
    }, [addLog]);

    /** Handle file upload into a frame slot */
    const handleFrameSlotUpload = useCallback((sceneIndex, slot, file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = () => assignFrameSlot(sceneIndex, slot, reader.result);
        reader.readAsDataURL(file);
    }, [assignFrameSlot]);

    /** Extract the last frame of a source scene's video and assign it to a target frame slot. */
    const captureLastVideoFrame = useCallback((sourceSceneIndex, targetSceneIndex = sourceSceneIndex, targetSlot = 'end') => {
        const scene = scenes[sourceSceneIndex];
        if (!scene?.videoUrl) return;

        addLog('API_CALL', `Extracting last frame from Scene ${sourceSceneIndex + 1} video for continuity.`);
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.src = scene.videoUrl;
        video.preload = 'metadata';

        video.onloadedmetadata = () => {
            video.currentTime = Math.max(0, video.duration - 0.1);
        };

        video.onseeked = () => {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 720;
            canvas.height = video.videoHeight || 1280;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = canvas.toDataURL('image/jpeg', 0.92);
            assignFrameSlot(targetSceneIndex, targetSlot, frame);
            addLog('SUCCESS', `Scene ${sourceSceneIndex + 1} last frame assigned to Scene ${targetSceneIndex + 1} ${targetSlot} frame.`);
        };

        video.onerror = () => addLog('ERROR', `Could not extract last frame from Scene ${sourceSceneIndex + 1} video.`);
        video.load();
    }, [scenes, assignFrameSlot, addLog]);

    /** Clipboard paste handler for frame slots */
    const handleFrameClipboardPaste = useCallback(async (sceneIndex, slot) => {
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
                const imageType = item.types.find(t => t.startsWith('image/'));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    const reader = new FileReader();
                    reader.onloadend = () => assignFrameSlot(sceneIndex, slot, reader.result);
                    reader.readAsDataURL(blob);
                    return;
                }
            }
            addLog('ERROR', 'No image found in clipboard.');
        } catch {
            addLog('ERROR', 'Clipboard read failed. Make sure you have a copied image.');
        }
    }, [assignFrameSlot, addLog]);

    const deleteScene = (index) => {
        if (confirm('Delete this scene?')) {
            setScenes(prev => prev.filter((_, sceneIndex) => sceneIndex !== index));
            setSelectedSceneIndex(prev => Math.max(0, Math.min(prev, scenes.length - 2)));
        }
    };

    const wizardNextEnabled = (() => {
        switch (wizardStep) {
            case 1: return scenes.length > 0;
            case 2: return scenes.length > 0;
            case 3: return scenesWithImagesCount > 0;
            case 4: return scenesWithVideosCount > 0 || !!finalVideoUrl;
            default: return false;
        }
    })();

    const wizardNextHint = (() => {
        switch (wizardStep) {
            case 1: return 'Generate a scene breakdown first';
            case 2: return 'Add at least one scene';
            case 3: return 'Generate at least one frame first';
            case 4: return 'Animate at least one scene first';
            default: return '';
        }
    })();

    return (
        <div className="min-h-screen bg-[#070B14] text-slate-50">
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
                * { font-family: 'Inter', system-ui, sans-serif; }
                .studio-panel { background: rgba(15, 23, 42, 0.78); border: 1px solid rgba(148, 163, 184, 0.16); box-shadow: 0 24px 80px rgba(0,0,0,0.32); backdrop-filter: blur(16px); }
                .studio-input { background: rgba(2, 6, 23, 0.72); border: 1px solid rgba(100, 116, 139, 0.38); color: #F8FAFC; border-radius: 0.75rem; outline: none; transition: border-color .18s ease, box-shadow .18s ease; }
                .studio-input:focus { border-color: #F97316; box-shadow: 0 0 0 2px rgba(249,115,22,.18); }
                .studio-prompt { background: rgba(2, 6, 23, 0.72); border: 1px solid rgba(6, 182, 212, 0.18); color: #F8FAFC; border-radius: 0.75rem; outline: none; transition: border-color .18s ease, box-shadow .18s ease; }
                .studio-prompt:focus { border-color: rgba(6, 182, 212, 0.3); box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.12); }
            `}</style>

            {isAssemblingVideo && (
                <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
                    <div className="studio-panel rounded-2xl p-8 max-w-md w-full text-center border-emerald-500/40">
                        <div className="w-14 h-14 border-4 border-slate-700 border-t-emerald-400 rounded-full animate-spin mx-auto mb-4"></div>
                        <h2 className="text-2xl font-bold text-emerald-300 mb-2">Creating Final Video</h2>
                        <p className="text-slate-300 text-sm">{assemblyProgress || 'Preparing final master...'}</p>
                    </div>
                </div>
            )}

            <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_0%,rgba(200,113,79,0.12),transparent_34%),radial-gradient(circle_at_80%_10%,rgba(168,85,247,0.10),transparent_28%),linear-gradient(135deg,#070B14_0%,#0B1020_46%,#111827_100%)]"></div>

            {/* ─── HEADER ─── */}
            <header className="sticky top-0 z-40 border-b border-slate-700/40 bg-[#070B14]/88 backdrop-blur-xl">
                <div className="max-w-[1720px] mx-auto px-4 lg:px-6 h-16 flex items-center justify-between gap-4">
                    {/* Logo + Brand */}
                    <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
                        <ClayStudioLogo />
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h1 className="text-base font-extrabold tracking-tight truncate" style={{ color: '#E8896A' }}>Clay Studio</h1>
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#C8714F]/20 text-[#E8896A] border border-[#C8714F]/30">PRO</span>
                            </div>
                        </div>
                    </div>

                    {/* Wizard Step Indicator */}
                    <nav className="hidden md:flex items-center gap-0.5">
                        {WIZARD_STEPS.map((label, i) => {
                            const stepNum = i + 1;
                            const active = wizardStep === stepNum;
                            const done = wizardStep > stepNum;
                            return (
                                <React.Fragment key={label}>
                                    <button
                                        onClick={() => (done || active) ? setWizardStep(stepNum) : undefined}
                                        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition-all ${
                                            active ? 'bg-[#C8714F]/15 text-[#E8896A] border-[#C8714F]/50 shadow-md' :
                                            done ? 'text-emerald-300 border-emerald-500/30 hover:border-emerald-400/60 cursor-pointer' :
                                            'text-slate-600 border-transparent cursor-default'
                                        }`}
                                    >
                                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                                            active ? 'bg-[#C8714F] text-white' :
                                            done ? 'bg-emerald-500 text-white' :
                                            'bg-slate-800 text-slate-500'
                                        }`}>{done ? '✓' : stepNum}</span>
                                        {label}
                                    </button>
                                    {i < WIZARD_STEPS.length - 1 && (
                                        <div className={`w-4 h-px mx-0.5 ${wizardStep > i + 1 ? 'bg-emerald-500/40' : 'bg-slate-700/60'}`}></div>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </nav>

                    {/* Right controls */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {copyFeedback && <span className="hidden sm:inline text-xs text-emerald-300">{copyFeedback}</span>}
                        {estimatedCost > 0 && (
                            <div className="hidden sm:block rounded-full border border-[#C8714F]/30 bg-[#C8714F]/10 px-3 py-1.5 text-xs text-[#E8896A]">
                                Est. <span className="font-bold">{estimatedCost.toFixed(1)} pts</span>
                            </div>
                        )}
                        <button onClick={() => setActivityLogOpen(true)} className="hidden sm:flex w-10 h-10 rounded-xl border border-slate-700/60 bg-slate-800/80 hover:border-[#C8714F]/50 transition items-center justify-center text-slate-400 text-sm" title="Activity Log">📋</button>
                        <button onClick={() => setSettingsOpen(true)} className="w-10 h-10 rounded-xl border border-slate-700/60 bg-slate-800/80 hover:border-[#C8714F]/50 transition flex items-center justify-center" aria-label="Open settings">⚙️</button>
                    </div>
                </div>
            </header>

            <main className="relative z-10 max-w-[1720px] mx-auto px-4 lg:px-6 pt-6 pb-28">

                {/* ─── STEP 1: STORY ─── */}
                {wizardStep === 1 && (
                    <section className="grid lg:grid-cols-[1.1fr_0.9fr] gap-6 items-stretch min-h-[calc(100vh-12rem)]">
                        <div className="studio-panel rounded-3xl p-6 lg:p-8 flex flex-col justify-center">
                            <div className="inline-flex items-center gap-2 text-[#E8896A] text-sm font-semibold mb-4">
                                <span className="w-8 h-8 rounded-xl bg-[#C8714F]/15 flex items-center justify-center">🎬</span>
                                Step 1 · Your Story
                            </div>
                            <h2 className="text-4xl lg:text-5xl font-black tracking-tight leading-tight mb-3" style={{ color: '#FFFFFF' }}>Turn a script into a finished clay video.</h2>
                            <p className="text-slate-400 text-base max-w-xl mb-6">Write or paste your script, set up your character, then let Clay Studio break it into timed scenes automatically.</p>

                            <label className="text-sm font-semibold text-slate-300 mb-2 block">Video Script</label>
                            <textarea className="studio-input min-h-48 p-4 resize-y text-sm leading-relaxed" placeholder="Paste your story or production script..." value={script} onChange={(e) => setScript(e.target.value)} />

                            <div className="grid sm:grid-cols-3 gap-3 mt-4">
                                <label className="flex items-center gap-2 rounded-2xl border border-slate-700/60 bg-slate-900/50 p-3 text-sm text-slate-300 cursor-pointer">
                                    <input type="checkbox" className="accent-[#C8714F]" checked={hasCharacter} onChange={(e) => setHasCharacter(e.target.checked)} />
                                    Character reference
                                </label>
                                <label className={`flex items-center gap-2 rounded-2xl border border-slate-700/60 bg-slate-900/50 p-3 text-sm cursor-pointer ${!referenceImage ? 'opacity-40 text-slate-300' : 'text-sky-300'}`}>
                                    <input type="checkbox" className="accent-sky-500" checked={visionGuidedBreakdown} onChange={(e) => setVisionGuidedBreakdown(e.target.checked)} disabled={!referenceImage} />
                                    Vision-guided
                                </label>
                                <label className={`flex items-center gap-2 rounded-2xl border border-slate-700/60 bg-slate-900/50 p-3 text-sm cursor-pointer ${!referenceImage ? 'opacity-40 text-slate-300' : 'text-purple-300'}`}>
                                    <input type="checkbox" className="accent-purple-500" checked={nanoBananaStyleRef} onChange={(e) => setNanoBananaStyleRef(e.target.checked)} disabled={!referenceImage} />
                                    Style reference
                                </label>
                            </div>

                            {hasCharacter && (
                                <div className="mt-4">
                                    <label className="text-sm font-semibold text-slate-300 mb-2 block">Character Description</label>
                                    <textarea className="studio-input w-full min-h-28 p-4 text-sm" placeholder="Describe your clay character's body, eyes, outfit, colors, texture..." value={characterDescription} onChange={(e) => setCharacterDescription(e.target.value)} />
                                </div>
                            )}

                            <div className="flex flex-col sm:flex-row gap-3 mt-6">
                                <button onClick={generateSceneDescriptions} disabled={isGenerating || !script.trim()} className="flex-1 rounded-2xl bg-[#C8714F] hover:bg-[#B05A3A] disabled:opacity-50 px-5 py-4 font-bold transition shadow-lg shadow-orange-950/30">
                                    {isGenerating ? '⏳ Generating Scenes...' : '🎬 Generate Scene Breakdown'}
                                </button>
                                <button onClick={addManualScene} className="rounded-2xl border border-slate-700/70 bg-slate-900/70 hover:border-[#C8714F]/60 px-5 py-4 font-semibold transition">+ Add Scene</button>
                            </div>

                            {scenes.length > 0 && (
                                <div className="mt-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 text-sm text-emerald-300 flex items-center justify-between">
                                    <span>✓ {scenes.length} scene{scenes.length !== 1 ? 's' : ''} ready</span>
                                    <button onClick={() => setWizardStep(2)} className="text-xs font-bold underline underline-offset-2">View scenes →</button>
                                </div>
                            )}
                        </div>

                        <div className="studio-panel rounded-3xl p-6 flex flex-col gap-5">
                            <div className="rounded-2xl border-2 border-dashed border-slate-700/70 bg-slate-950/50 p-5 text-center cursor-pointer hover:border-[#C8714F]/60 transition" onDrop={handleImageDrop} onDragOver={(e) => e.preventDefault()} onPaste={handleImagePaste} onClick={() => document.getElementById('imageUpload')?.click()}>
                                {referenceImage ? (
                                    <div className="relative">
                                        <img src={referenceImage} alt="Reference" className="max-h-64 mx-auto rounded-2xl object-contain" />
                                        <button className="absolute top-2 right-2 w-7 h-7 rounded-full bg-red-500/80 hover:bg-red-500 text-white text-xs flex items-center justify-center" onClick={(e) => { e.stopPropagation(); setReferenceImage(null); }}>✕</button>
                                    </div>
                                ) : (
                                    <div className="py-12">
                                        <div className="text-5xl mb-3">🖼️</div>
                                        <p className="font-semibold text-slate-200">Drop, paste, or click to add a reference image</p>
                                        <p className="text-sm text-slate-500 mt-1">Useful for character and style consistency</p>
                                    </div>
                                )}
                            </div>
                            <input id="imageUpload" type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

                            <div className="grid grid-cols-3 gap-3 text-center">
                                <div className="rounded-2xl bg-slate-900/70 border border-slate-700/50 p-4"><div className="text-2xl font-black text-[#E8896A]">5</div><div className="text-xs text-slate-500">Steps</div></div>
                                <div className="rounded-2xl bg-slate-900/70 border border-slate-700/50 p-4"><div className="text-2xl font-black text-sky-300">9:16</div><div className="text-xs text-slate-500">Frames</div></div>
                                <div className="rounded-2xl bg-slate-900/70 border border-slate-700/50 p-4"><div className="text-2xl font-black text-emerald-300">MP4</div><div className="text-xs text-slate-500">Output</div></div>
                            </div>

                            {isGenerating && (
                                <div className="text-center py-4">
                                    <div className="inline-block w-10 h-10 border-4 border-slate-700 border-t-[#C8714F] rounded-full animate-spin mb-3"></div>
                                    <p className="text-slate-400 text-sm">Analyzing script with {activeTextProvider.toUpperCase()}...</p>
                                </div>
                            )}
                        </div>
                    </section>
                )}

                {/* ─── STEP 2: SCENE BREAKDOWN ─── */}
                {wizardStep === 2 && (
                    <section>
                        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                            <div>
                                <h2 className="text-2xl font-black">Scene Breakdown</h2>
                                <p className="text-slate-400 text-sm mt-1">{scenes.length} scenes · {Math.round(totalDuration / 60)}m {totalDuration % 60}s · Review and edit before generating frames.</p>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                                <button onClick={addManualScene} className="rounded-xl bg-[#C8714F]/15 border border-[#C8714F]/40 text-[#E8896A] hover:border-[#C8714F]/70 px-4 py-2 text-sm font-semibold transition">+ Add Scene</button>
                                <button onClick={copyAllSceneData} className="rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-4 py-2 text-sm font-semibold transition">📋 Copy All</button>
                                <button onClick={exportAllPrompts} className="rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-4 py-2 text-sm font-semibold transition">📄 Export</button>
                            </div>
                        </div>

                        {scenes.length === 0 ? (
                            <div className="studio-panel rounded-3xl p-12 text-center">
                                <div className="text-5xl mb-4">📝</div>
                                <h3 className="text-xl font-bold mb-2">No scenes yet</h3>
                                <p className="text-slate-400 text-sm mb-6">Go back to Step 1 and generate a scene breakdown from your script, or add scenes manually.</p>
                                <div className="flex gap-3 justify-center">
                                    <button onClick={() => setWizardStep(1)} className="rounded-2xl border border-slate-700 bg-slate-800 px-6 py-3 font-semibold hover:border-[#C8714F]/50 transition">← Back to Story</button>
                                    <button onClick={addManualScene} className="rounded-2xl bg-[#C8714F] hover:bg-[#B05A3A] px-6 py-3 font-semibold transition">+ Add Scene Manually</button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {scenes.map((scene, index) => (
                                    <div key={index} className="studio-panel rounded-2xl p-4">
                                        <div className="flex items-center gap-3 mb-3">
                                            <input type="text" className="studio-input text-sm font-bold flex-1 px-3 py-2" value={scene.text} onChange={(e) => updateSceneField(index, 'text', e.target.value)} placeholder="Scene title" />
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                <span className="text-xs text-slate-500">Dur.</span>
                                                <input type="number" className="studio-input text-xs px-2 py-2 w-16 text-center" value={scene.duration} onChange={(e) => updateSceneField(index, 'duration', parseInt(e.target.value) || 5)} min="3" max="15" />
                                                <span className="text-xs text-slate-400">s</span>
                                                <button onClick={() => deleteScene(index)} className="w-8 h-8 rounded-xl text-red-400 hover:bg-red-500/10 transition text-sm flex items-center justify-center" title="Delete scene">🗑️</button>
                                            </div>
                                        </div>
                                        <div className="grid lg:grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-xs font-semibold text-slate-500 mb-1 block">Visual Description</label>
                                                <textarea className="studio-input w-full p-3 text-xs min-h-20 resize-none" value={scene.frameDescription} onChange={(e) => updateSceneField(index, 'frameDescription', e.target.value)} placeholder="Describe the visual scene..." />
                                            </div>
                                            <div>
                                                <label className="text-xs font-semibold text-slate-500 mb-1 block">Dialogue / Voiceover</label>
                                                <textarea className="studio-prompt w-full p-3 text-xs min-h-20 resize-none" value={scene.dialogue || ''} onChange={(e) => updateSceneField(index, 'dialogue', e.target.value)} placeholder="Optional spoken line for this scene..." />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                )}

                {/* ─── STEP 3: IMAGES ─── */}
                {wizardStep === 3 && (
                    <section>
                        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                            <div>
                                <h2 className="text-2xl font-black">Frame Generation</h2>
                                <p className="text-slate-400 text-sm mt-1">Generate or upload a 9:16 clay frame for each scene.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button onClick={generateAllImages} disabled={isGeneratingImages} className="rounded-xl bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 px-4 py-2 text-sm font-bold transition">
                                    {isGeneratingImages ? `⏳ Generating… ${generationProgress.completed}/${generationProgress.total}` : '🚀 Generate All Frames'}
                                </button>
                                <button onClick={lockCharacterFromSceneOne} disabled={!scenes[0]?.generatedImage || isGeneratingImages} className="rounded-xl bg-emerald-600/20 border border-emerald-600/40 text-emerald-300 hover:border-emerald-400/70 disabled:opacity-40 px-4 py-2 text-sm font-semibold transition">🔒 Lock Character</button>
                                {scenesWithImagesCount > 0 && <button onClick={downloadAllFrames} className="rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-4 py-2 text-sm font-semibold">📦 ZIP Frames</button>}
                            </div>
                        </div>

                        {isGeneratingImages && (
                            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-2xl p-4 mb-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-semibold">{activeImageModel === 'nanoBanana2' ? '⚡ Fast-track generation in progress...' : '⏳ Crafting high-fidelity frames...'}</span>
                                    <span className="text-sm font-bold text-cyan-400">{generationProgress.completed}/{generationProgress.total}</span>
                                </div>
                                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                                    <div className="bg-gradient-to-r from-cyan-500 to-[#C8714F] h-full transition-all duration-500" style={{ width: `${generationProgress.total ? (generationProgress.completed / generationProgress.total) * 100 : 0}%` }}></div>
                                </div>
                            </div>
                        )}

                        {scenesWithImagesCount === 0 && !isGeneratingImages && (
                            <div className="bg-purple-500/10 border border-purple-500/30 rounded-2xl p-3 mb-4 text-sm">
                                💡 <strong>Pro Tip:</strong> Click "Generate All Frames" or upload your own images per scene. Use "Lock Character" after Scene 1 for consistency.
                            </div>
                        )}

                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {scenes.map((scene, index) => (
                                <div key={index} className="bg-slate-900 border border-slate-700/60 rounded-2xl overflow-hidden hover:border-cyan-500/40 transition-all">
                                    <div className="relative bg-slate-950" style={{ aspectRatio: '9/16' }}>
                                        {scene.isGenerating ? (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/70 p-3">
                                                <div className="w-7 h-7 border-[3px] border-slate-700 border-t-cyan-500 rounded-full animate-spin mb-2"></div>
                                                <span className="text-[10px] text-cyan-400 font-semibold text-center">{scene.imageStatusText || 'Generating...'}</span>
                                                <div className="w-3/4 bg-slate-800 rounded-full h-1 overflow-hidden mt-2">
                                                    <div className="bg-gradient-to-r from-cyan-500 to-[#C8714F] h-full transition-all duration-500" style={{ width: `${scene.imageProgress || 5}%` }}></div>
                                                </div>
                                            </div>
                                        ) : scene.generatedImage ? (
                                            <>
                                                <img src={scene.generatedImage} alt={`Scene ${index + 1}`} className="w-full h-full object-cover" />
                                                {scene.isManualUpload && <div className="absolute top-1.5 right-1.5 bg-purple-500 text-white text-[9px] px-1.5 py-0.5 rounded font-bold">Upload</div>}
                                            </>
                                        ) : scene.error ? (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 text-xs p-3 text-center">
                                                <span className="mb-1 text-lg">❌</span>
                                                <span>{scene.error}</span>
                                            </div>
                                        ) : (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 text-xs cursor-pointer hover:bg-slate-900/50 transition-all" onClick={() => document.getElementById(`imgUp-${index}`)?.click()} onPaste={(e) => handleSceneImagePaste(index, e)} tabIndex={0}>
                                                <span className="text-2xl mb-1">📷</span>
                                                <span>Click / Paste</span>
                                            </div>
                                        )}
                                        <input id={`imgUp-${index}`} type="file" accept="image/*" className="hidden" onChange={(e) => handleSceneImageUpload(index, e.target.files[0])} />
                                    </div>
                                    <div className="p-2 space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-bold text-slate-300 truncate">Scene {index + 1}</span>
                                            <span className="text-[10px] text-slate-500">{scene.duration}s</span>
                                        </div>
                                        <button onClick={() => generateSceneImageSafely(index)} disabled={scene.isGenerating || isGeneratingImages} className="w-full bg-cyan-600/20 hover:bg-cyan-600/40 border border-cyan-600/30 disabled:opacity-40 text-cyan-300 rounded-lg py-1.5 text-[10px] font-semibold transition">
                                            {scene.isGenerating ? '⏳' : scene.generatedImage ? '🔄 Regen' : scene.error ? '🔄 Retry' : '🎨 Generate'}
                                        </button>
                                        <div className="flex gap-1">
                                            {scene.generatedImage && <button onClick={() => downloadImage(scene.generatedImage, `scene_${index + 1}.png`)} className="flex-1 bg-slate-800 hover:bg-slate-700 rounded-lg py-1.5 text-[10px] transition" title="Save">💾</button>}
                                            {scene.generatedImageModel === 'nanoBanana2' && !scene.isGenerating && (
                                                <button onClick={() => redoSceneImageWithPro(index)} className="flex-1 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-400/20 text-yellow-200 rounded-lg py-1.5 text-[10px] font-semibold transition" title="Redo with Pro">✨ Pro</button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* ─── STEP 4: ANIMATE ─── */}
                {wizardStep === 4 && (
                    <section className="grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)_340px] gap-5">
                        {/* Scene list sidebar */}
                        <aside className="studio-panel rounded-3xl p-4 h-fit xl:sticky xl:top-20">
                            <div className="rounded-2xl bg-slate-950/60 border border-slate-700/50 p-4 mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-400 to-[#C8714F] flex items-center justify-center">🎬</div>
                                    <div className="min-w-0">
                                        <h3 className="font-bold truncate">Animate</h3>
                                        <p className="text-xs text-slate-500">{scenes.length} scenes · {scenesWithVideosCount} animated</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-bold text-slate-300">Scenes</h3>
                                <button onClick={addManualScene} className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-[#C8714F] transition text-sm" aria-label="Add scene">+</button>
                            </div>
                            <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                                {scenes.map((scene, index) => {
                                    const status = getSceneStatus(scene);
                                    const active = selectedSceneIndex === index;
                                    const selectedForAssembly = selectedAssemblySceneIndexes.includes(index);
                                    return (
                                        <div key={index} className={`w-full rounded-2xl border p-2 transition ${active ? 'border-[#C8714F]/70 bg-[#C8714F]/10 shadow-md' : 'border-slate-700/50 bg-slate-900/45 hover:border-slate-500/70'}`}>
                                            <div className="flex gap-2">
                                                <button onClick={() => setSelectedSceneIndex(index)} className="flex min-w-0 flex-1 gap-3 text-left">
                                                    <div className="w-12 h-14 rounded-xl bg-slate-950 overflow-hidden flex-shrink-0">
                                                        {scene.generatedImage ? <img src={scene.generatedImage} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-slate-600">🎞️</div>}
                                                    </div>
                                                    <div className="min-w-0 flex-1 pt-1">
                                                        <p className="text-xs text-slate-500">Scene {index + 1}</p>
                                                        <p className="text-sm font-semibold truncate">{scene.text || `Scene ${index + 1}`}</p>
                                                        <span className={`inline-flex mt-1 text-[10px] px-2 py-0.5 rounded-full border ${getStatusClasses(status)}`}>{status}</span>
                                                    </div>
                                                </button>
                                                {scene.isGeneratingVideo ? (
                                                    <button
                                                        onClick={() => cancelSceneVideoGeneration(index)}
                                                        className="w-8 h-8 mt-3 rounded-lg border border-red-500/40 bg-red-500/15 text-red-200 hover:border-red-400 transition"
                                                        title="Cancel this scene animation"
                                                    >
                                                        ×
                                                    </button>
                                                ) : (
                                                    <button onClick={() => toggleAssemblyScene(index)} disabled={!scene.videoUrl} className={`w-8 h-8 mt-3 rounded-lg border text-xs font-black transition ${selectedForAssembly ? 'bg-emerald-500 text-white border-emerald-400' : 'bg-slate-950/70 text-slate-500 border-slate-700'} disabled:opacity-30`} title={scene.videoUrl ? 'Select for assembly' : 'Animate first'}>
                                                        {selectedForAssembly ? '✓' : '+'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="mt-4 space-y-2">
                                <button onClick={generateAllVideos} disabled={isGeneratingVideos || scenesWithImagesCount === 0} className="w-full rounded-2xl bg-[#C8714F] hover:bg-[#B05A3A] disabled:opacity-50 py-3 text-sm font-bold transition">
                                    {isGeneratingVideos ? '⏳ Submitting...' : '🎬 Animate All (I2V)'}
                                </button>
                                {isLiteVideoEngine && (
                                    <p className="text-[11px] text-[#E8896A] bg-[#C8714F]/10 border border-[#C8714F]/30 rounded-xl px-3 py-2 text-center">Optimizing for speed: Static camera enabled.</p>
                                )}
                                <button onClick={() => assembleFinalVideo(selectedAssemblySceneIndexes)} disabled={isAssemblingVideo || selectedAssemblyVideosCount === 0} className="w-full rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 py-3 text-sm font-bold transition">
                                    {isAssemblingVideo ? '🧵 Assembling...' : `🎬 Assemble (${selectedAssemblyVideosCount})`}
                                </button>
                            </div>

                            <div className="mt-3 rounded-2xl bg-slate-950/60 border border-slate-700/50 p-3">
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-xs font-bold text-slate-300">Character & Style Lock</h3>
                                    <button onClick={lockCharacterFromSceneOne} disabled={!scenes[0]?.generatedImage} className="text-xs text-[#E8896A] disabled:text-slate-600">Lock</button>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-10 h-10 rounded-xl bg-slate-900 overflow-hidden border border-slate-700/60">
                                        {(referenceImage || scenes[0]?.generatedImage) ? <img src={referenceImage || scenes[0]?.generatedImage} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-slate-600">👤</div>}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-semibold truncate">{characterDescription ? 'Main Character' : 'No character locked'}</p>
                                        <p className="text-[10px] text-slate-500">{nanoBananaStyleRef ? 'Style ref active' : 'No style ref'}</p>
                                    </div>
                                </div>
                            </div>
                        </aside>

                        {/* Main scene viewer */}
                        <section className="space-y-5">
                            <div className="studio-panel rounded-3xl p-4 lg:p-5">
                                <div className="flex items-center justify-between gap-3 mb-4">
                                    <div className="min-w-0">
                                        <p className="text-sm text-slate-500">Scene {selectedSceneIndex + 1}</p>
                                        <input className="bg-transparent text-2xl font-black tracking-tight focus:outline-none focus:text-[#E8896A] w-full" value={selectedScene?.text || ''} onChange={(e) => updateSceneField(selectedSceneIndex, 'text', e.target.value)} />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {selectedScene?.generatedImage && (
                                            <button onClick={() => downloadImage(selectedScene.generatedImage, `scene_${selectedSceneIndex + 1}_frame.png`)} className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-200 hover:border-cyan-300 px-3 py-1.5 text-sm font-semibold transition">
                                                <Download size={16} /> Save
                                            </button>
                                        )}
                                        <span className="rounded-full bg-slate-900/70 border border-slate-700/60 px-3 py-1.5 text-sm text-slate-300">{selectedScene?.duration || 5}s</span>
                                    </div>
                                </div>

                                {/* Main preview */}
                                <div className="relative aspect-video rounded-3xl overflow-hidden bg-slate-950 border border-slate-700/50 shadow-2xl shadow-black/30 mb-4">
                                    {selectedScene?.isGenerating ? (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 bg-slate-900/70">
                                            <div className="w-full max-w-sm">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-sm font-bold text-cyan-300">{selectedScene.imageStatusText || 'Generating frame...'}</span>
                                                    <span className="text-xs text-cyan-200">{selectedScene.imageProgress || 5}%</span>
                                                </div>
                                                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                                                    <div className="bg-gradient-to-r from-cyan-500 to-[#C8714F] h-full transition-all duration-500" style={{ width: `${selectedScene.imageProgress || 5}%` }}></div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : selectedScene?.videoUrl ? (
                                        <video src={selectedScene.videoUrl} controls className="w-full h-full object-contain bg-black" />
                                    ) : selectedScene?.generatedImage ? (
                                        <img src={selectedScene.generatedImage} alt={`Scene ${selectedSceneIndex + 1}`} className="w-full h-full object-contain bg-black" />
                                    ) : (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8">
                                            <div className="text-5xl mb-3">🎞️</div>
                                            <h3 className="text-xl font-bold">No frame yet</h3>
                                            <p className="text-sm text-slate-500 mt-2">Go back to Step 3 to generate frames first.</p>
                                        </div>
                                    )}
                                </div>

                                {/* ── First & Last Frame Slots ─────────────────────── */}
                                <div className="rounded-2xl bg-slate-950/60 border border-slate-700/50 p-4 mb-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <div>
                                            <h4 className="text-sm font-bold text-slate-200">First & Last Frame</h4>
                                            <p className="text-[11px] text-slate-500 mt-0.5">Pin frames to prevent AI drift between shots.</p>
                                        </div>
                                        {selectedSceneIndex > 0 && scenes[selectedSceneIndex - 1]?.videoUrl && (
                                            <button onClick={() => captureLastVideoFrame(selectedSceneIndex - 1, selectedSceneIndex, 'start')} className="text-xs text-[#E8896A] border border-[#C8714F]/40 hover:border-[#E8896A] rounded-xl px-3 py-1.5 transition">
                                                ⬅ Pull continuity from Scene {selectedSceneIndex}
                                            </button>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        {/* Start Frame */}
                                        {(['start', 'end']).map(slot => {
                                            const slotImage = slot === 'start'
                                                ? (selectedScene?.startFrame || selectedScene?.generatedImage)
                                                : (selectedScene?.endFrame || (selectedSceneIndex > 0 ? scenes[selectedSceneIndex - 1]?.endFrame : null));
                                            const isSet = slot === 'start'
                                                ? !!selectedScene?.startFrame
                                                : !!selectedScene?.endFrame;
                                            return (
                                                <div key={slot} className="space-y-2">
                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{slot === 'start' ? '▶ Start Frame' : '⏹ End Frame'}</p>
                                                    <div
                                                        className={`relative aspect-[9/16] max-h-40 w-full rounded-2xl overflow-hidden border-2 cursor-pointer transition ${isSet ? 'border-[#C8714F]/60' : 'border-dashed border-slate-600 hover:border-[#C8714F]/50'} bg-slate-900`}
                                                        onClick={() => openAssetTray(selectedSceneIndex, slot)}
                                                        title={`Click to assign ${slot} frame`}
                                                    >
                                                        {slotImage ? (
                                                            <img src={slotImage} alt={`${slot} frame`} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 text-xs">
                                                                <span className="text-2xl mb-1">+</span>
                                                                <span>Assign</span>
                                                            </div>
                                                        )}
                                                        {isSet && (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); updateSceneField(selectedSceneIndex, slot === 'start' ? 'startFrame' : 'endFrame', null); }}
                                                                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-red-500/80 text-white text-xs hover:bg-red-600 flex items-center justify-center"
                                                            >×</button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* ── Asset Tray (inline drawer) ─────────────────── */}
                                {assetTrayOpen && assetTraySceneIndex === selectedSceneIndex && (
                                    <div className="rounded-2xl bg-[#0B1020] border border-[#C8714F]/40 p-4 mb-4 shadow-2xl">
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="text-sm font-bold text-[#E8896A]">
                                                Asset Tray — Assign {assetTraySlot === 'start' ? 'Start' : 'End'} Frame
                                            </h4>
                                            <button onClick={() => setAssetTrayOpen(false)} className="text-slate-500 hover:text-white text-lg leading-none">×</button>
                                        </div>

                                        <div className="space-y-4">
                                            {/* Source 1: Step 3 gallery (all scene images) */}
                                            <div>
                                                <p className="text-[11px] font-semibold text-slate-400 mb-2">Step 3 Gallery</p>
                                                <div className="flex gap-2 overflow-x-auto pb-1">
                                                    {scenes.filter(s => s.generatedImage).map((scene, i) => (
                                                        <button key={i} onClick={() => assignFrameSlot(assetTraySceneIndex, assetTraySlot, scene.generatedImage)} className="w-14 h-20 rounded-xl overflow-hidden border-2 border-slate-700 hover:border-[#C8714F] flex-shrink-0 transition">
                                                            <img src={scene.generatedImage} alt="" className="w-full h-full object-cover" />
                                                        </button>
                                                    ))}
                                                    {scenes.filter(s => s.generatedImage).length === 0 && (
                                                        <p className="text-xs text-slate-600">No frames generated yet.</p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Source 2: Previous scene end-frame continuity */}
                                            {assetTraySceneIndex > 0 && scenes[assetTraySceneIndex - 1]?.videoUrl && (
                                                <div>
                                                    <p className="text-[11px] font-semibold text-slate-400 mb-2">Continuity — Last frame of Scene {assetTraySceneIndex}</p>
                                                    <button onClick={() => captureLastVideoFrame(assetTraySceneIndex - 1, assetTraySceneIndex, assetTraySlot)} className="rounded-xl bg-[#C8714F]/20 border border-[#C8714F]/40 hover:border-[#E8896A] px-4 py-2 text-xs font-semibold text-[#E8896A] transition">
                                                        ⬅ Extract & Assign Last Frame
                                                    </button>
                                                </div>
                                            )}

                                            {/* Source 3: File upload + clipboard */}
                                            <div className="flex gap-2 flex-wrap">
                                                <label className="rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-4 py-2 text-xs font-semibold cursor-pointer transition">
                                                    Upload File
                                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFrameSlotUpload(assetTraySceneIndex, assetTraySlot, e.target.files?.[0])} />
                                                </label>
                                                <button onClick={() => handleFrameClipboardPaste(assetTraySceneIndex, assetTraySlot)} className="rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-4 py-2 text-xs font-semibold transition">
                                                    📋 Paste from Clipboard
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                                    {scenes.map((scene, index) => (
                                        <button key={index} onClick={() => setSelectedSceneIndex(index)} className={`w-20 h-14 rounded-xl overflow-hidden border flex-shrink-0 ${selectedSceneIndex === index ? 'border-[#C8714F]' : 'border-slate-700/70'}`}>
                                            {scene.generatedImage ? <img src={scene.generatedImage} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-slate-900 flex items-center justify-center text-slate-600 text-xs">{index + 1}</div>}
                                        </button>
                                    ))}
                                    <label className="w-20 h-14 rounded-xl border border-dashed border-slate-600 flex-shrink-0 flex items-center justify-center text-slate-500 cursor-pointer hover:border-[#C8714F]/70">
                                        +
                                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleSceneImageUpload(selectedSceneIndex, e.target.files[0])} />
                                    </label>
                                </div>
                            </div>

                            <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
                                <div className="rounded-2xl bg-[#C8714F] p-4 text-left shadow-lg shadow-orange-950/25">
                                    <button onClick={() => generateSceneImageSafely(selectedSceneIndex)} disabled={selectedScene?.isGenerating || isGeneratingImages} className="w-full text-left disabled:opacity-50">
                                        <div className="text-2xl mb-3">✨</div>
                                        <div className="font-bold">{selectedScene?.isGenerating ? 'Generating...' : selectedScene?.generatedImage ? 'Regenerate Image' : 'Generate Image'}</div>
                                        <p className="text-xs text-orange-100/80 mt-1">Create a frame for this scene</p>
                                    </button>
                                    {selectedScene?.isGenerating && <button onClick={() => cancelSceneImageGeneration(selectedSceneIndex)} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-black/25 hover:bg-black/40 px-3 py-2 text-xs font-bold transition"><XCircle size={16} /> Cancel</button>}
                                    {selectedScene?.generatedImageModel === 'nanoBanana2' && !selectedScene?.isGenerating && <button onClick={() => redoSceneImageWithPro(selectedSceneIndex)} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-yellow-400/15 text-yellow-100 border border-yellow-300/30 hover:border-yellow-200 px-3 py-2 text-xs font-bold transition">✨ Redo with Pro</button>}
                                </div>
                                <label className="rounded-2xl bg-purple-500/15 border border-purple-500/30 hover:border-purple-400/70 p-4 text-left transition cursor-pointer">
                                    <div className="text-2xl mb-3">🖼️</div>
                                    <div className="font-bold">Replace Frame</div>
                                    <p className="text-xs text-slate-400 mt-1">Upload your own image</p>
                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleSceneImageUpload(selectedSceneIndex, e.target.files[0])} />
                                </label>
                                <div className="rounded-2xl bg-emerald-500/15 border border-emerald-500/30 hover:border-emerald-400/70 p-4 text-left transition">
                                    <button onClick={() => generateSceneVideo(selectedSceneIndex)} disabled={!selectedScene?.generatedImage || selectedScene?.isGeneratingVideo} className="w-full text-left disabled:opacity-50">
                                        <div className="text-2xl mb-3">▶️</div>
                                        <div className="font-bold">{selectedScene?.isGeneratingVideo ? 'Animating...' : 'Animate Scene'}</div>
                                        <p className="text-xs text-slate-400 mt-1">Create video from frame</p>
                                    </button>
                                    {isLiteVideoEngine && <p className="text-xs text-emerald-200 mt-2">Optimizing for speed: Static camera enabled.</p>}
                                    {selectedScene?.isGeneratingVideo && <button onClick={() => cancelSceneVideoGeneration(selectedSceneIndex)} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-red-500/15 text-red-200 border border-red-500/30 hover:border-red-400 px-3 py-2 text-xs font-bold transition"><XCircle size={16} /> Cancel</button>}
                                </div>
                                <button onClick={lockCharacterFromSceneOne} disabled={!scenes[0]?.generatedImage} className="rounded-2xl bg-slate-900/70 border border-slate-700/60 hover:border-[#C8714F]/60 disabled:opacity-50 p-4 text-left transition">
                                    <div className="text-2xl mb-3">🔒</div>
                                    <div className="font-bold">Keep Character</div>
                                    <p className="text-xs text-slate-400 mt-1">Use Scene 1 as reference</p>
                                </button>
                            </div>

                            <div className="studio-panel rounded-3xl p-4 lg:p-5">
                                <div className="flex items-center justify-between gap-3 mb-4">
                                    <div>
                                        <h3 className="font-black text-lg">Modify Prompts</h3>
                                        <p className="text-xs text-slate-500">Edits here are used directly by Generate and Animate.</p>
                                    </div>
                                    <button onClick={() => { if (!selectedScene) return; updateSceneField(selectedSceneIndex, 'imagePrompt', buildImagePromptForScene(selectedScene)); updateSceneField(selectedSceneIndex, 'videoPrompt', generateVideoPrompt(selectedScene)); addLog('SUCCESS', `Scene ${selectedSceneIndex + 1} prompts reset.`); }} className="rounded-xl border border-slate-700/60 bg-slate-900/70 hover:border-cyan-500/40 px-3 py-2 text-xs font-semibold transition">Reset AI Prompts</button>
                                </div>
                                <div className="grid lg:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-semibold text-cyan-200">Image Prompt</label>
                                        <textarea className="studio-prompt w-full mt-2 min-h-36 p-3 text-sm leading-relaxed resize-y" value={selectedScene?.imagePrompt || ''} placeholder="AI image prompt for this scene..." onChange={(e) => updateScenePromptField(selectedSceneIndex, 'imagePrompt', e.target.value)} onBlur={() => logPromptModification(selectedSceneIndex, 'image prompt')} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-semibold text-cyan-200">Video Prompt</label>
                                        <textarea className="studio-prompt w-full mt-2 min-h-36 p-3 text-sm leading-relaxed resize-y" value={selectedScene?.videoPrompt || ''} placeholder="AI video prompt for this scene..." onChange={(e) => updateScenePromptField(selectedSceneIndex, 'videoPrompt', e.target.value)} onBlur={() => logPromptModification(selectedSceneIndex, 'video prompt')} />
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Inspector aside */}
                        <aside className="studio-panel rounded-3xl p-4 h-fit xl:sticky xl:top-20">
                            <div className="flex rounded-2xl bg-slate-950/60 border border-slate-700/50 p-1 mb-4">
                                {['inspector', 'prompts'].map(tab => (
                                    <button key={tab} onClick={() => setInspectorTab(tab)} className={`flex-1 rounded-xl py-2 text-sm font-semibold transition ${inspectorTab === tab ? 'bg-[#C8714F] text-white' : 'text-slate-400 hover:text-white'}`}>{tab === 'inspector' ? 'Inspector' : 'Prompt Details'}</button>
                                ))}
                            </div>
                            {inspectorTab === 'inspector' ? (
                                <div className="space-y-4">
                                    <div><label className="text-xs font-semibold text-slate-500">Scene Title</label><input className="studio-input w-full mt-1 p-3 text-sm" value={selectedScene?.text || ''} onChange={(e) => updateSceneField(selectedSceneIndex, 'text', e.target.value)} /></div>
                                    <div><label className="text-xs font-semibold text-slate-500">Duration</label><input type="number" min="3" max="15" className="studio-input w-full mt-1 p-3 text-sm" value={selectedScene?.duration || 5} onChange={(e) => updateSceneField(selectedSceneIndex, 'duration', parseInt(e.target.value) || 5)} /></div>
                                    <div><label className="text-xs font-semibold text-slate-500">Dialogue</label><textarea className="studio-input w-full mt-1 p-3 text-sm min-h-24" value={selectedScene?.dialogue || ''} onChange={(e) => updateSceneField(selectedSceneIndex, 'dialogue', e.target.value)} /></div>
                                    <div><label className="text-xs font-semibold text-slate-500">Visual Description</label><textarea className="studio-input w-full mt-1 p-3 text-sm min-h-32" value={selectedScene?.frameDescription || ''} onChange={(e) => updateSceneField(selectedSceneIndex, 'frameDescription', e.target.value)} /></div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <select className="studio-input p-3 text-sm" value={selectedScene?.camera || 'Over-shoulder'} onChange={(e) => updateSceneField(selectedSceneIndex, 'camera', e.target.value)}>
                                            <option>Over-shoulder</option><option>Close-up</option><option>Wide shot</option><option>3/4 shot</option><option>Macro</option>
                                        </select>
                                        <select className="studio-input p-3 text-sm" value={selectedScene?.motion || 'Static'} onChange={(e) => updateSceneField(selectedSceneIndex, 'motion', e.target.value)}>
                                            <option>Static</option><option>Slow push-in</option><option>Pan left</option><option>Pan right</option><option>Handheld</option>
                                        </select>
                                    </div>
                                    <button onClick={() => deleteScene(selectedSceneIndex)} className="text-sm text-red-300 hover:text-red-200">Delete Scene</button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="text-xs font-semibold text-slate-500">Video Prompt</label>
                                            <button className="text-xs text-[#E8896A]" onClick={() => copyToClipboard(selectedScene?.videoPrompt || generateVideoPrompt(selectedScene || {}))}>Copy</button>
                                        </div>
                                        <div className="rounded-2xl bg-slate-950/80 border border-slate-700/60 p-3 text-xs text-slate-300 leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap">{selectedScene ? (selectedScene.videoPrompt || generateVideoPrompt(selectedScene)) : ''}</div>
                                    </div>
                                    <button onClick={generateAllVideoPrompts} className="w-full rounded-2xl bg-purple-500/20 border border-purple-500/40 hover:border-purple-400/70 py-3 font-semibold transition">Generate All Video Prompts</button>
                                    <button onClick={copyAllVideoPrompts} className="w-full rounded-2xl bg-slate-900/80 border border-slate-700/60 hover:border-slate-500 py-3 font-semibold transition">Copy All Video Prompts</button>
                                </div>
                            )}
                        </aside>
                    </section>
                )}

                {/* ─── STEP 5: VOICEOVER ─── */}
                {wizardStep === 5 && (() => {
                    const voScene = scenes[voiceoverSceneIndex] || scenes[0];
                    const voIdx = voiceoverSceneIndex;
                    return (
                        <section className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_300px] gap-5">

                            {/* ── Left: Scene Sidebar (mirrors Animate) ── */}
                            <aside className="studio-panel rounded-3xl p-4 h-fit xl:sticky xl:top-20">
                                <div className="rounded-2xl bg-slate-950/60 border border-slate-700/50 p-3 mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-[#C8714F] flex items-center justify-center text-xl">🎙️</div>
                                        <div className="min-w-0">
                                            <h3 className="font-bold text-sm truncate">Casting Desk</h3>
                                            <p className="text-[11px] text-slate-500">{scenesWithAudioCount}/{scenes.length} voiced</p>
                                        </div>
                                    </div>
                                </div>

                                <h3 className="text-sm font-bold text-slate-400 mb-2">Scenes</h3>
                                <div className="space-y-1.5 max-h-[45vh] overflow-y-auto pr-1 mb-4">
                                    {scenes.map((scene, index) => (
                                        <button
                                            key={index}
                                            onClick={() => setVoiceoverSceneIndex(index)}
                                            className={`w-full rounded-2xl border p-3 text-left transition flex items-center gap-3 ${voiceoverSceneIndex === index ? 'border-purple-500/60 bg-purple-500/10' : 'border-slate-700/50 bg-slate-900/40 hover:border-slate-500/60'}`}
                                        >
                                            <div className="w-10 h-12 rounded-xl bg-slate-950 overflow-hidden flex-shrink-0">
                                                {scene.generatedImage
                                                    ? <img src={scene.generatedImage} alt="" className="w-full h-full object-cover" />
                                                    : <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs">🎞️</div>}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[10px] text-slate-500">Scene {index + 1}</p>
                                                <p className="text-xs font-semibold truncate">{scene.text}</p>
                                                <span className={`inline-block mt-0.5 text-[9px] px-1.5 py-0.5 rounded-full border ${scene.audioUrl ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-slate-800 text-slate-600 border-slate-700'}`}>
                                                    {scene.audioUrl ? 'Audio ✓' : 'Silent'}
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                                </div>

                                {/* Budget summary in sidebar */}
                                <div className="rounded-2xl bg-slate-950/70 border border-slate-700/50 p-3">
                                    <p className="text-[11px] font-bold text-slate-400 mb-2">Live Budget</p>
                                    <p className="text-2xl font-black text-[#E8896A]">{liveBudget.total} <span className="text-sm font-semibold text-slate-400">pts</span></p>
                                    <div className="mt-2 space-y-1 text-[10px] text-slate-500">
                                        <div className="flex justify-between"><span>Images ({scenesWithImagesCount}×{PTS_COST.image})</span><span>{liveBudget.imagePts} pts</span></div>
                                        <div className="flex justify-between"><span>Video ({scenesWithVideosCount}×{PTS_COST.video})</span><span>{liveBudget.videoPts} pts</span></div>
                                        <div className="flex justify-between"><span>Voiceover ({scenesWithAudioCount}×{PTS_COST.voiceover})</span><span>{liveBudget.audioPts} pts</span></div>
                                        {Object.entries(liveBudget.engineBreakdown).map(([label, pts]) => (
                                            <div key={label} className="flex justify-between text-slate-600"><span className="truncate">{label}</span><span>{pts} pts</span></div>
                                        ))}
                                    </div>
                                </div>
                            </aside>

                            {/* ── Centre: Selected Scene Casting Desk ── */}
                            <section className="space-y-5">
                                {voScene ? (
                                    <>
                                        <div className="studio-panel rounded-3xl p-5">
                                            <div className="flex items-center justify-between gap-3 mb-4">
                                                <div className="min-w-0">
                                                    <p className="text-sm text-slate-500">Scene {voIdx + 1}</p>
                                                    <h2 className="text-xl font-black truncate">{voScene.text}</h2>
                                                </div>
                                                <span className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border font-semibold ${voScene.audioUrl ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
                                                    {voScene.audioUrl ? 'Audio Ready' : 'No Audio'}
                                                </span>
                                            </div>

                                            {/* Scene preview thumbnail */}
                                            {voScene.generatedImage && (
                                                <div className="flex gap-4 mb-5 items-start">
                                                    <img src={voScene.generatedImage} alt="" className="w-20 rounded-2xl border border-slate-700/60 object-cover" style={{aspectRatio:'9/16'}} />
                                                    {voScene.videoUrl && (
                                                        <video src={voScene.videoUrl} controls className="flex-1 rounded-2xl border border-slate-700/60 max-h-40 bg-black" />
                                                    )}
                                                </div>
                                            )}

                                            {/* Narrator script */}
                                            <label className="text-xs font-semibold text-slate-400 block mb-1">Narrator Script</label>
                                            <textarea
                                                className="studio-input w-full p-3 text-sm min-h-28 resize-y mb-4"
                                                placeholder="Write the narration for this scene..."
                                                value={voScene.narratorScript ?? voScene.dialogue ?? ''}
                                                onChange={(e) => updateSceneField(voIdx, 'narratorScript', e.target.value)}
                                            />

                                            {/* Voice selector */}
                                            <label className="text-xs font-semibold text-slate-400 block mb-2">Voice</label>
                                            <div className="grid grid-cols-3 gap-3 mb-4">
                                                {VOICE_CONFIG.map(voice => {
                                                    const active = normalizeVoiceId(voScene.voiceId) === voice.id;
                                                    const playing = playingVoiceSample === voice.id;
                                                    return (
                                                        <div key={voice.id} className={`rounded-2xl border p-3 transition cursor-pointer ${active ? 'border-purple-400 bg-purple-500/15 shadow-md shadow-purple-900/20' : 'border-slate-700 bg-slate-900/60 hover:border-purple-400/50'}`} onClick={() => updateSceneField(voIdx, 'voiceId', voice.id)}>
                                                            <div className="flex items-center justify-between gap-2 mb-1">
                                                                <span className="text-lg">{voice.emoji}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => { e.stopPropagation(); playVoiceSample(voice); }}
                                                                    className={`w-7 h-7 rounded-lg border text-xs transition ${playing ? 'bg-purple-500/30 border-purple-400 text-purple-100' : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-purple-400'}`}
                                                                    title={`${playing ? 'Pause' : 'Play'} sample`}
                                                                >{playing ? '❚❚' : '🔊'}</button>
                                                            </div>
                                                            <p className="text-sm font-black text-white">{voice.name}</p>
                                                            <p className="text-[11px] text-slate-400">{voice.style}</p>
                                                            {active && <span className="mt-1.5 inline-block text-[9px] bg-purple-500/20 text-purple-300 rounded-full px-2 py-0.5">Selected</span>}
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Vibe + upload row */}
                                            <div className="flex flex-wrap gap-3 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <label className="text-xs font-semibold text-slate-400">Vibe</label>
                                                    <select className="studio-input p-2 text-xs" value={voScene.voiceVibe || 'Neutral'} onChange={(e) => updateSceneField(voIdx, 'voiceVibe', e.target.value)}>
                                                        {VIBE_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                                                    </select>
                                                </div>
                                                <label className="rounded-xl border border-slate-700 bg-slate-900 hover:border-purple-400/50 px-3 py-2 text-xs cursor-pointer transition">
                                                    Upload Audio Override
                                                    <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleSceneAudioUpload(voIdx, e.target.files?.[0])} />
                                                </label>
                                            </div>

                                            {/* Generate button + audio player */}
                                            <button onClick={() => generateNarratorAudio(voIdx)} disabled={voScene.isGeneratingAudio} className="w-full rounded-2xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 py-3 font-bold text-sm transition mb-3">
                                                {voScene.isGeneratingAudio ? '🎙️ Generating TTS...' : 'Generate OpenAI TTS-1 Voiceover'}
                                            </button>

                                            {voScene.audioUrl && (
                                                <div className="rounded-2xl bg-slate-950/70 border border-slate-700/50 p-3 space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <p className="text-xs font-semibold text-emerald-300">✓ Audio Ready · {voScene.audioSource || 'audio'}</p>
                                                        <button onClick={() => saveAs(voScene.audioUrl, voScene.audioFileName || `scene_${voIdx + 1}_voiceover.mp3`)} className="text-xs text-slate-400 hover:text-emerald-300 transition">Download MP3</button>
                                                    </div>
                                                    <audio src={voScene.audioUrl} controls className="w-full h-8" />
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="studio-panel rounded-3xl p-10 text-center text-slate-500">
                                        <p className="text-4xl mb-3">🎙️</p>
                                        <p>No scenes yet. Go back to Story to build your project.</p>
                                    </div>
                                )}
                            </section>

                            {/* ── Right: Assembly & Export ── */}
                            <aside className="space-y-4 h-fit xl:sticky xl:top-20">
                                {finalVideoUrl && (
                                    <div className="studio-panel rounded-3xl p-4 border border-emerald-500/30">
                                        <h3 className="text-base font-black text-emerald-300 mb-2">🎉 Final Ready</h3>
                                        <video src={finalVideoUrl} controls className="w-full rounded-2xl bg-black mb-3 border border-emerald-500/20" />
                                        <button onClick={() => saveAs(finalVideoUrl, 'clay_studio_final.mp4')} className="w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 font-bold py-3 text-sm transition">💾 Download Final MP4</button>
                                    </div>
                                )}

                                <div className="studio-panel rounded-3xl p-4">
                                    <h3 className="font-black text-base mb-3">Assemble Movie</h3>
                                    <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                                        <div className="rounded-xl bg-slate-950/70 border border-slate-700/50 p-2"><p className="text-[10px] text-slate-500">Scenes</p><p className="text-lg font-black">{scenes.length}</p></div>
                                        <div className="rounded-xl bg-slate-950/70 border border-slate-700/50 p-2"><p className="text-[10px] text-slate-500">Videos</p><p className="text-lg font-black text-emerald-300">{scenesWithVideosCount}</p></div>
                                        <div className="rounded-xl bg-slate-950/70 border border-slate-700/50 p-2"><p className="text-[10px] text-slate-500">Audio</p><p className="text-lg font-black text-purple-300">{scenesWithAudioCount}</p></div>
                                    </div>
                                    {isAssemblingVideo && assemblyProgress && (
                                        <p className="text-xs text-[#E8896A] mb-2">{assemblyProgress}</p>
                                    )}
                                    <div className="space-y-2">
                                        <button onClick={() => assembleFinalVideo()} disabled={isAssemblingVideo || scenesWithVideosCount === 0} className="w-full rounded-2xl bg-[#C8714F] hover:bg-[#B05A3A] disabled:opacity-50 py-3 font-bold text-sm transition">
                                            {isAssemblingVideo ? '🧵 Assembling...' : '🎬 Assemble All'}
                                        </button>
                                        <button onClick={() => assembleFinalVideo(selectedAssemblySceneIndexes)} disabled={isAssemblingVideo || selectedAssemblyVideosCount === 0} className="w-full rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 py-3 font-bold text-sm transition">
                                            {isAssemblingVideo ? '🧵 Assembling...' : `Assemble Selected (${selectedAssemblyVideosCount})`}
                                        </button>
                                    </div>
                                </div>

                                <div className="studio-panel rounded-3xl p-4">
                                    <h3 className="font-black text-base mb-3">Export Assets</h3>
                                    <div className="space-y-2">
                                        <button onClick={downloadAllFrames} className="w-full rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 py-2.5 font-semibold text-xs transition">📦 Download Frames (ZIP)</button>
                                        <button onClick={copyAllVideoPrompts} className="w-full rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 py-2.5 font-semibold text-xs transition">📋 Copy Video Prompts</button>
                                        <button onClick={exportAllPrompts} className="w-full rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 py-2.5 font-semibold text-xs transition">📄 Export Production Notes</button>
                                    </div>
                                </div>
                            </aside>
                        </section>
                    );
                })()}

            </main>

            {/* ─── WIZARD BOTTOM NAV ─── */}
            <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#070B14]/92 backdrop-blur-xl border-t border-slate-700/50">
                <div className="max-w-[1720px] mx-auto px-4 lg:px-6 py-3 flex items-center justify-between gap-4">
                    <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500">
                        <span className="font-semibold text-slate-300">{scenes.length} scenes</span>
                        <span>·</span>
                        <span className="text-sky-400 font-semibold">{scenesWithImagesCount} frames</span>
                        <span>·</span>
                        <span className="text-emerald-400 font-semibold">{scenesWithVideosCount} videos</span>
                        {finalVideoUrl && <><span>·</span><span className="text-[#E8896A] font-semibold">Final ready ✓</span></>}
                    </div>
                    <div className="sm:hidden text-sm font-bold text-slate-400">{WIZARD_STEPS[wizardStep - 1]}</div>

                    {/* Live Budget pill */}
                    {liveBudget.total > 0 && (
                        <div className="hidden md:flex items-center gap-1.5 rounded-full border border-[#C8714F]/40 bg-[#C8714F]/10 px-3 py-1.5 text-xs font-semibold text-[#E8896A]" title={`Images: ${liveBudget.imagePts} pts · Video: ${liveBudget.videoPts} pts · Audio: ${liveBudget.audioPts} pts`}>
                            💰 {liveBudget.total} pts
                        </div>
                    )}

                    <div className="flex items-center gap-3 ml-auto">
                        {wizardStep > 1 && (
                            <button onClick={() => setWizardStep(w => w - 1)} className="rounded-2xl border border-slate-700/70 bg-slate-900/70 hover:border-slate-600 px-5 py-2.5 text-sm font-semibold transition">
                                ← Previous
                            </button>
                        )}
                        {wizardStep < WIZARD_STEPS.length && (
                            <button
                                onClick={() => setWizardStep(w => w + 1)}
                                disabled={!wizardNextEnabled}
                                className="rounded-2xl bg-[#C8714F] hover:bg-[#B05A3A] disabled:opacity-40 px-6 py-2.5 text-sm font-bold transition"
                                title={!wizardNextEnabled ? wizardNextHint : undefined}
                            >
                                Next: {WIZARD_STEPS[wizardStep]} →
                            </button>
                        )}
                        {wizardStep === WIZARD_STEPS.length && finalVideoUrl && (
                            <button onClick={() => saveAs(finalVideoUrl, 'clay_studio_final.mp4')} className="rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 px-6 py-2.5 text-sm font-bold transition">
                                💾 Download Final
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Settings panel */}
            {settingsOpen && (
                <div className="fixed inset-0 z-[70]">
                    <button className="absolute inset-0 bg-black/60" onClick={() => setSettingsOpen(false)} aria-label="Close settings"></button>
                    <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-[#0B1020] border-l border-slate-700/60 shadow-2xl p-6 overflow-y-auto">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="text-2xl font-black">Settings</h2>
                                <p className="text-sm text-slate-500">API keys, models, and utility actions.</p>
                            </div>
                            <button onClick={() => setSettingsOpen(false)} className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center">✕</button>
                        </div>
                        <div className="space-y-6">
                            <section className="studio-panel rounded-2xl p-4">
                                <h3 className="font-bold mb-4">API Keys</h3>
                                <div className="space-y-3">
                                    {[
                                        ['OpenAI API Key', openAIKey, setOpenAIKey, 'sk-...'],
                                        ['Anthropic API Key', anthropicKey, setAnthropicKey, 'sk-ant-...'],
                                        ['Gemini API Key', geminiKey, setGeminiKey, 'AIza...'],
                                        ['Kie.ai API Key', kieAiKey, setKieAiKey, 'Enter Kie.ai key']
                                    ].map(([label, value, setter, placeholder]) => (
                                        <div key={label}>
                                            <label className="text-xs font-semibold text-slate-500">{label}</label>
                                            <input type="password" className="studio-input w-full mt-1 p-3 text-sm" placeholder={placeholder} value={value} onChange={(e) => setter(e.target.value)} />
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <section className="studio-panel rounded-2xl p-4">
                                <h3 className="font-bold mb-4">Model Settings</h3>
                                <div className="grid sm:grid-cols-2 gap-3">
                                    <select className="studio-input p-3 text-sm" value={activeTextProvider} onChange={(e) => setActiveTextProvider(e.target.value)}>
                                        <option value="openai">OpenAI (gpt-4o)</option>
                                        <option value="anthropic">Anthropic (claude-sonnet-4-5)</option>
                                        <option value="gemini">Gemini (gemini-1.5-pro)</option>
                                    </select>
                                    <select className="studio-input p-3 text-sm" value={activeImageModel} onChange={(e) => setActiveImageModel(e.target.value)}>
                                        <option value="nanoBanana2">NanoBanana 2 (Fast)</option>
                                        <option value="nanoBananaPro">NanoBanana Pro</option>
                                    </select>
                                    <select className="studio-input p-3 text-sm sm:col-span-2" value={activeVideoEngine} onChange={(e) => setActiveVideoEngine(e.target.value)}>
                                        {Object.entries(VIDEO_MODEL_CONFIGS).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}
                                    </select>
                                    <select className="studio-input p-3 text-sm" value={videoResolution} onChange={(e) => setVideoResolution(e.target.value)}>
                                        <option value="720p">720p</option>
                                        <option value="1080p">1080p</option>
                                    </select>
                                    <select className="studio-input p-3 text-sm" value={videoAudio ? 'on' : 'off'} onChange={(e) => setVideoAudio(e.target.value === 'on')}>
                                        <option value="off">Audio Off</option>
                                        <option value="on">Audio On (w/ Dialogue)</option>
                                    </select>
                                    <select className="studio-input p-3 text-sm sm:col-span-2" value={videoPromptEngine} onChange={(e) => setVideoPromptEngine(e.target.value)}>
                                        <option value="kling">Kling Prompt Format</option>
                                        <option value="veo">Veo Prompt Format</option>
                                    </select>
                                </div>
                            </section>

                            <section className="studio-panel rounded-2xl p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="font-bold">Activity Log</h3>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-500">{logs.length}/200 events</span>
                                        <button onClick={() => setLogs([])} className="text-xs text-slate-500 hover:text-red-400 transition px-2 py-1 rounded-lg border border-slate-700 hover:border-red-500/50">Clear</button>
                                    </div>
                                </div>
                                <div className="h-48 overflow-y-auto rounded-xl bg-slate-950/60 border border-slate-700/50 p-2 space-y-1 text-[10px] font-mono">
                                    {logs.length === 0 ? (
                                        <p className="text-slate-600 text-center py-4">No events yet. Generate a scene to see activity.</p>
                                    ) : (
                                        [...logs].reverse().map((log, i) => (
                                            <div key={i} className="flex gap-2 items-start leading-relaxed">
                                                <span className={`shrink-0 font-bold uppercase ${
                                                    log.type === 'ERROR' ? 'text-red-400' :
                                                    log.type === 'SUCCESS' ? 'text-emerald-400' :
                                                    log.type === 'API_CALL' ? 'text-cyan-400' :
                                                    'text-slate-500'
                                                }`}>{log.type}</span>
                                                <span className="text-slate-400 break-all">{log.message}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </section>

                            <section className="studio-panel rounded-2xl p-4">
                                <h3 className="font-bold mb-4 text-red-200">Danger & Utilities</h3>
                                <div className="flex flex-wrap gap-2">
                                    <button className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2 text-sm" onClick={() => { localStorage.removeItem('activeVideoEngine'); localStorage.removeItem('videoResolution'); localStorage.removeItem('videoAudio'); window.location.reload(); }}>Reset Settings</button>
                                    <button className="rounded-xl bg-amber-500/15 text-amber-200 border border-amber-500/30 hover:border-amber-400 px-4 py-2 text-sm" onClick={clearAllKeys}>Clear Keys</button>
                                    <button className="rounded-xl bg-red-500/15 text-red-200 border border-red-500/30 hover:border-red-400 px-4 py-2 text-sm" onClick={resetStudio}>Reset Studio</button>
                                </div>
                            </section>
                        </div>
                    </aside>
                </div>
            )}

            {/* Activity log panel */}
            {activityLogOpen && (
                <div className="fixed inset-0 z-[70]">
                    <button className="absolute inset-0 bg-black/60" onClick={() => setActivityLogOpen(false)} aria-label="Close activity log"></button>
                    <aside className="absolute right-0 top-0 h-full w-full max-w-2xl bg-[#0B1020] border-l border-slate-700/60 shadow-2xl p-6 overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-2xl font-black">Activity Log</h2>
                                <p className="text-sm text-slate-500">{logs.length}/200 events</p>
                            </div>
                            <button onClick={() => setActivityLogOpen(false)} className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center">✕</button>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-4">
                            {['ALL', 'SUCCESS', 'ERROR', 'POLLING', 'FFMPEG', 'API_CALL'].map(type => (
                                <button key={type} onClick={() => setLogFilter(type)} className={`rounded-full px-3 py-1.5 text-xs font-semibold border ${logFilter === type ? 'bg-[#C8714F] text-white border-[#C8714F]' : 'bg-slate-900 text-slate-400 border-slate-700'}`}>{type}</button>
                            ))}
                        </div>
                        <div className="flex gap-2 mb-4">
                            <button onClick={copyEntireLog} disabled={logs.length === 0} className="rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-4 py-2 text-sm font-semibold">Copy Entire Log</button>
                            <button onClick={() => setLogs([])} disabled={logs.length === 0} className="rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-4 py-2 text-sm font-semibold">Clear Log</button>
                        </div>
                        <div ref={logsContainerRef} className="flex-1 overflow-y-auto rounded-2xl bg-black border border-slate-800 p-4 font-mono text-xs">
                            {filteredLogs.length === 0 ? <p className="text-slate-600">No matching log entries.</p> : filteredLogs.map(log => (
                                <div key={log.id} className={`mb-2 whitespace-pre-wrap ${log.type === 'ERROR' ? 'text-red-400' : log.type === 'SUCCESS' ? 'text-emerald-400' : log.type === 'POLLING' ? 'text-sky-300' : log.type === 'FFMPEG' ? 'text-purple-300' : 'text-slate-300'}`}>
                                    {formatLogEntry(log)}
                                </div>
                            ))}
                        </div>
                    </aside>
                </div>
            )}
        </div>
    );
}
