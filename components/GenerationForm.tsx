
import React, { useRef, useState, useEffect } from 'react';
import { AppMode, AspectRatio, GenerationParams, ImageResolution, VideoResolution, ImageModel, VideoModel, ImageStyle, VideoStyle, VideoDuration, ChatMessage, AssetItem, SmartAsset, APP_LIMITS, AgentAction, SmartAssetRole } from '../types';
import { Settings2, Sparkles, Image as ImageIcon, Video as VideoIcon, X, Palette, MessageSquare, Layers, ChevronDown, ChevronUp, SlidersHorizontal, Monitor, Eye, Lock, ScanFace, Frame, ArrowRight, Loader2, Clock, BookTemplate, Clapperboard, XCircle, Search, Briefcase } from 'lucide-react';
import { ChatInterface } from './ChatInterface';
import { extractPromptFromHistory, optimizePrompt, describeImage } from '../services/geminiService';
import { PromptBuilder } from './PromptBuilder';
import { useLanguage } from '../contexts/LanguageContext';

interface GenerationFormProps {
  mode: AppMode;
  params: GenerationParams;
  setParams: React.Dispatch<React.SetStateAction<GenerationParams>>;
  chatParams: GenerationParams;
  setChatParams: React.Dispatch<React.SetStateAction<GenerationParams>>;
  isGenerating: boolean;
  startTime?: number;
  onGenerate: (overrideParams?: Partial<GenerationParams>) => void;
  onVerifyVeo: () => void;
  veoVerified: boolean;
  chatHistory: ChatMessage[];
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  activeTab: 'studio' | 'chat';
  onTabChange: (tab: 'studio' | 'chat') => void;
  chatSelectedImages: string[];
  setChatSelectedImages: React.Dispatch<React.SetStateAction<string[]>>;
  projectId: string;
  cooldownEndTime?: number;
  onToolCall?: (action: AgentAction) => void;
  projectContextSummary?: string;
  projectSummaryCursor?: number;
  onUpdateProjectContext?: (summary: string, cursor: number) => void;
  agentContextAssets?: SmartAsset[];
  onRemoveContextAsset?: (assetId: string) => void;
  onClearContextAssets?: () => void;
  // NEW: Draft images from image generation (构思图)
  thoughtImages?: Array<{ id: string; data: string; mimeType: string; isFinal: boolean; timestamp: number }>;
  setThoughtImages?: React.Dispatch<React.SetStateAction<Array<{ id: string; data: string; mimeType: string; isFinal: boolean; timestamp: number }>>>;
}

const VIDEO_TEMPLATES = [
  { label: 'Cinematic Drone', text: 'A cinematic drone shot flying over a futuristic city at sunset, neon lights reflecting on glass buildings, 4k, high detail.' },
  { label: 'Nature Documentary', text: 'Close up of a rare tropical bird in the rainforest, vibrant feathers, shallow depth of field, soft lighting.' },
  { label: 'Cyberpunk Street', text: 'Walking through a rainy cyberpunk street at night, holograms, wet pavement, steam rising from vents.' },
  { label: 'Product Showcase', text: 'A sleek modern smartphone rotating in a studio environment, soft lighting, clean background, 3d render style.' },
  { label: 'Abstract Flow', text: 'Abstract liquid gold flowing and morphing into different shapes, black background, high contrast, elegant motion.' },
  { label: 'Character Action', text: 'A knight in shining armor swinging a sword in slow motion, sparks flying, dramatic lighting.' }
];

const DEFAULT_SMART_ASSET_ROLE = SmartAssetRole.EDIT_BASE;

const resolveSmartAssetRole = (asset: SmartAsset): SmartAssetRole => {
  if (asset.role && Object.values(SmartAssetRole).includes(asset.role)) return asset.role;
  const legacyType = asset.type ? String(asset.type).toUpperCase() : '';
  switch (legacyType) {
    case 'STRUCTURE':
      return SmartAssetRole.COMPOSITION;
    case 'STYLE':
      return SmartAssetRole.STYLE;
    case 'SUBJECT':
      return SmartAssetRole.SUBJECT;
    case 'EDIT_BASE':
      return SmartAssetRole.EDIT_BASE;
    default:
      return DEFAULT_SMART_ASSET_ROLE;
  }
};

export const GenerationForm: React.FC<GenerationFormProps> = ({
  mode,
  params,
  setParams,
  chatParams,
  setChatParams,
  isGenerating,
  startTime,
  onGenerate,
  onVerifyVeo: _onVerifyVeo,
  veoVerified: _veoVerified,
  chatHistory,
  setChatHistory,
  activeTab,
  onTabChange,
  chatSelectedImages,
  setChatSelectedImages,
  projectId,
  cooldownEndTime = 0,
  onToolCall,
  projectContextSummary,
  projectSummaryCursor,
  onUpdateProjectContext,
  agentContextAssets,
  onRemoveContextAsset,
  onClearContextAssets,
  thoughtImages,
  setThoughtImages
}) => {
  const { t, language } = useLanguage();
  const smartAssetRoleOptions = [
    { value: SmartAssetRole.EDIT_BASE, label: t('role.edit_base') },
    { value: SmartAssetRole.SUBJECT, label: t('role.subject') },
    { value: SmartAssetRole.STYLE, label: t('role.style') },
    { value: SmartAssetRole.COMPOSITION, label: t('role.composition') }
  ];
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isDescribing, setIsDescribing] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isAspectRatioOpen, setIsAspectRatioOpen] = useState(false);
  const [_isWarningExpanded, _setIsWarningExpanded] = useState(false);

  // Local prompt state for smooth typing (debounced sync to params)
  const [localPrompt, setLocalPrompt] = useState(params.prompt || '');
  const promptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local prompt to params with debounce
  const handlePromptChange = (value: string) => {
    setLocalPrompt(value);
    if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
    promptTimerRef.current = setTimeout(() => {
      setParams(prev => ({ ...prev, prompt: value }));
    }, 300);
  };

  // Sync external params.prompt changes to local state (e.g., from optimize/template)
  useEffect(() => {
    if (params.prompt !== localPrompt) {
      setLocalPrompt(params.prompt || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.prompt]);

  // Video Mode Tabs
  const [activeVideoTab, setActiveVideoTab] = useState<'keyframes' | 'style'>('keyframes');

  // Drag State
  const [dragTarget, setDragTarget] = useState<'smart' | 'videoStart' | 'videoEnd' | 'videoStyle' | null>(null);

  // Refs for file inputs
  const startFrameInputRef = useRef<HTMLInputElement>(null);
  const endFrameInputRef = useRef<HTMLInputElement>(null);
  const videoStyleRefsInputRef = useRef<HTMLInputElement>(null);
  const smartAssetInputRef = useRef<HTMLInputElement>(null);

  // Model-specific reference image limit
  const getMaxSmartAssets = () => params.imageModel === ImageModel.PRO ? 14 : 3;

  // Timer State
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  useEffect(() => {
    if (mode === AppMode.IMAGE && (!params.smartAssets || params.smartAssets.length === 0)) {
      const migratedAssets: SmartAsset[] = [];
      if (params.referenceImage && params.referenceImageMimeType) {
        migratedAssets.push({
          id: crypto.randomUUID(),
          data: params.referenceImage,
          mimeType: params.referenceImageMimeType,
          role: SmartAssetRole.EDIT_BASE
        });
      }
      if (params.subjectReferences && params.subjectReferences.length > 0) {
        params.subjectReferences.forEach(ref => {
          migratedAssets.push({ id: crypto.randomUUID(), data: ref.data, mimeType: ref.mimeType, role: SmartAssetRole.SUBJECT });
        });
      }
      if (params.styleReferences && params.styleReferences.length > 0) {
        params.styleReferences.forEach(ref => {
          migratedAssets.push({ id: crypto.randomUUID(), data: ref.data, mimeType: ref.mimeType, role: SmartAssetRole.STYLE });
        });
      }
      if (migratedAssets.length > 0) {
        setParams(prev => ({
          ...prev,
          smartAssets: migratedAssets,
          referenceImage: undefined,
          referenceImageMimeType: undefined,
          subjectReferences: [],
          styleReferences: []
        }));
      }
    }
  }, [mode, projectId]);

  useEffect(() => {
    if (mode !== AppMode.IMAGE || !params.smartAssets || params.smartAssets.length === 0) return;
    const needsNormalization = params.smartAssets.some(asset => !asset.role);
    if (!needsNormalization) return;
    setParams(prev => ({
      ...prev,
      smartAssets: prev.smartAssets?.map(asset => ({
        ...asset,
        role: resolveSmartAssetRole(asset)
      }))
    }));
  }, [mode, params.smartAssets, setParams]);

  // VEO API RESTRAINT LOGIC (DOCUMENTATION SYNC)
  useEffect(() => {
    if (mode === AppMode.VIDEO) {
      const isVideoExtension = !!params.inputVideoUri;
      const hasRefImages = (params.videoStyleReferences?.length || 0) > 0;

      setParams(prev => {
        let updates: Partial<GenerationParams> = {};

        // 1. Extension Rules: 720p + 8s
        if (isVideoExtension) {
          if (prev.videoResolution !== VideoResolution.RES_720P) updates.videoResolution = VideoResolution.RES_720P;
          if (prev.videoDuration !== VideoDuration.LONG) updates.videoDuration = VideoDuration.LONG;
        }

        // 2. Ref Images Rules: 16:9 + 8s + 720p
        else if (hasRefImages) {
          if (prev.aspectRatio !== AspectRatio.LANDSCAPE) updates.aspectRatio = AspectRatio.LANDSCAPE;
          if (prev.videoDuration !== VideoDuration.LONG) updates.videoDuration = VideoDuration.LONG;
          if (prev.videoResolution !== VideoResolution.RES_720P) updates.videoResolution = VideoResolution.RES_720P;
        }

        // 3. 1080p Rules: Only supported with 8s duration
        else if (prev.videoResolution === VideoResolution.RES_1080P && prev.videoDuration !== VideoDuration.LONG) {
          updates.videoDuration = VideoDuration.LONG;
        }

        // 4. Default Aspect Ratio correction (9:16 or 16:9 only)
        const validRatios = [AspectRatio.LANDSCAPE, AspectRatio.PORTRAIT];
        if (!validRatios.includes(prev.aspectRatio)) {
          updates.aspectRatio = AspectRatio.LANDSCAPE;
        }

        if (Object.keys(updates).length > 0) return { ...prev, ...updates };
        return prev;
      });
    }
  }, [mode, params.inputVideoUri, params.videoStyleReferences, params.videoResolution, params.videoDuration, params.aspectRatio]);

  // Enforce valid Resolution for Image Flash Model
  useEffect(() => {
    if (mode === AppMode.IMAGE && params.imageModel === ImageModel.FLASH) {
      if (params.imageResolution !== ImageResolution.RES_1K) {
        setParams(prev => ({ ...prev, imageResolution: ImageResolution.RES_1K }));
      }
    }
  }, [mode, params.imageModel, params.imageResolution, setParams]);

  const handleToggleSearch = () => {
    setParams(prev => {
      const nextState = !prev.useGrounding;
      if (nextState && prev.imageModel !== ImageModel.PRO) {
        return { ...prev, useGrounding: true, imageModel: ImageModel.PRO, imageResolution: ImageResolution.RES_2K };
      }
      return { ...prev, useGrounding: nextState };
    });
  };

  const handleModelChange = (newModel: ImageModel) => {
    setParams(prev => {
      const updates: Partial<GenerationParams> = { imageModel: newModel };
      if (newModel === ImageModel.PRO && prev.imageResolution === ImageResolution.RES_1K) {
        updates.imageResolution = ImageResolution.RES_2K;
      }
      if (newModel === ImageModel.FLASH && prev.useGrounding) {
        updates.useGrounding = false;
      }
      return { ...prev, ...updates };
    });
  };

  useEffect(() => {
    let intervalId: any;
    const updateTimer = () => {
      const now = Date.now();
      if (isGenerating && startTime) {
        const diff = Math.max(0, Math.floor((now - startTime) / 1000));
        setElapsedSeconds(diff);
      } else {
        setElapsedSeconds(0);
      }
      if (cooldownEndTime > now) {
        const remaining = Math.ceil((cooldownEndTime - now) / 1000);
        setCooldownRemaining(remaining);
      } else {
        setCooldownRemaining(0);
      }
    };
    updateTimer();
    intervalId = setInterval(updateTimer, 1000);
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [isGenerating, startTime, cooldownEndTime]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showTemplates && !(event.target as Element).closest('.template-dropdown')) {
        setShowTemplates(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTemplates]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleRatioChange = (ratio: AspectRatio) => {
    setParams(prev => ({ ...prev, aspectRatio: ratio }));
  };

  const handleApplyPrompt = (prompt: string) => { setParams(prev => ({ ...prev, prompt })); onTabChange('studio'); };

  const handleOptimizePrompt = async () => {
    if (!params.prompt.trim()) return;
    setIsOptimizing(true);
    try {
      const optimized = await optimizePrompt(params.prompt, mode, params.smartAssets);
      setParams(prev => ({ ...prev, prompt: optimized }));
    } catch (e) {
      console.error("Optimization failed", e);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleDescribeImage = async () => {
    const firstAsset = params.smartAssets?.[0];
    if (!firstAsset) { alert("Please upload a reference image first."); return; }
    setIsDescribing(true);
    try {
      const desc = await describeImage(firstAsset.data, firstAsset.mimeType);
      setParams(prev => ({ ...prev, prompt: desc }));
    } catch (e) {
      console.error(e); alert("Failed to describe image.");
    } finally {
      setIsDescribing(false);
    }
  };

  const handleAppendTag = (tag: string) => { setParams(prev => { const current = prev.prompt.trim(); if (current.includes(tag)) return prev; return { ...prev, prompt: current ? `${current}, ${tag}` : tag }; }); };
  const applyTemplate = (text: string) => { setParams(prev => ({ ...prev, prompt: text })); setShowTemplates(false); };
  const isValidImage = (file: File) => { const validTypes = ['image/jpeg', 'image/png', 'image/webp']; if (!validTypes.includes(file.type)) { console.warn(`Blocked invalid file type: ${file.type}`); return false; } return true; };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>, field: 'smart' | 'start' | 'end' | 'videoStyle') => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (field === 'smart') {
      const currentCount = params.smartAssets?.length || 0;
      const maxAllowed = getMaxSmartAssets();
      if (currentCount + files.length > maxAllowed) {
        alert(`${params.imageModel === ImageModel.PRO ? 'Pro' : 'Flash'} 模型最多支持 ${maxAllowed} 张参考图，当前已有 ${currentCount} 张`);
        return;
      }
    }

    const processFile = (file: File) => new Promise<{ data: string, mimeType: string }>((resolve, reject) => {
      if (!isValidImage(file)) { alert(`File ${file.name} is not a supported image type.`); reject('Invalid type'); return; }
      if (file.size > APP_LIMITS.MAX_FILE_SIZE_BYTES) {
        alert(`${file.name}: ${t('msg.upload_limit_size')}`);
        reject('Too large');
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        const matches = result.match(/^data:(.+);base64,(.+)$/);
        if (matches) resolve({ mimeType: matches[1], data: matches[2] }); else reject('Invalid format');
      };
      reader.readAsDataURL(file);
    });

    if (field === 'smart') {
      const validFiles = Array.from(files).filter(isValidImage);
      // FIX: Use Promise.allSettled to handle partial failures gracefully
      // This ensures valid files are still processed even if some fail
      Promise.allSettled(validFiles.map(processFile)).then(settledResults => {
        const successfulResults = settledResults
          .filter((r): r is PromiseFulfilledResult<{ data: string, mimeType: string }> => r.status === 'fulfilled')
          .map(r => r.value);

        if (successfulResults.length > 0) {
          setParams(prev => {
            const newAssets: SmartAsset[] = successfulResults.map(r => ({ id: crypto.randomUUID(), data: r.data, mimeType: r.mimeType, role: DEFAULT_SMART_ASSET_ROLE }));
            return { ...prev, smartAssets: [...(prev.smartAssets || []), ...newAssets] };
          });
        }
      });
    } else if (field === 'videoStyle') {
      const currentCount = params.videoStyleReferences?.length || 0;
      const availableSlots = 3 - currentCount;
      const validFiles = Array.from(files).filter(isValidImage).slice(0, availableSlots);
      Promise.allSettled(validFiles.map(processFile)).then(settledResults => {
        const results = settledResults
          .filter((r): r is PromiseFulfilledResult<{ data: string, mimeType: string }> => r.status === 'fulfilled')
          .map(r => r.value);

        if (results.length > 0) {
          setParams(prev => ({ ...prev, videoStyleReferences: [...(prev.videoStyleReferences || []), ...results] }));
        }
      });
    } else {
      if (!isValidImage(files[0])) { alert("Invalid file type."); return; }
      processFile(files[0]).then(({ data, mimeType }) => {
        setParams(prev => {
          if (field === 'start') return { ...prev, videoStartImage: data, videoStartImageMimeType: mimeType };
          if (field === 'end') return { ...prev, videoEndImage: data, videoEndImageMimeType: mimeType };
          return prev;
        });
      });
    }
    e.target.value = '';
  };

  const removeImage = (field: 'start' | 'end') => { setParams(prev => { if (field === 'start') return { ...prev, videoStartImage: undefined, videoStartImageMimeType: undefined }; if (field === 'end') return { ...prev, videoEndImage: undefined, videoEndImageMimeType: undefined }; return prev; }); };
  const removeVideoStyleRef = (index: number) => setParams(prev => ({ ...prev, videoStyleReferences: prev.videoStyleReferences?.filter((_, i) => i !== index) }));
  const removeSmartAsset = (id: string) => { setParams(prev => ({ ...prev, smartAssets: prev.smartAssets?.filter(a => a.id !== id) })); };
  const updateSmartAssetRole = (id: string, role: SmartAssetRole) => {
    setParams(prev => ({
      ...prev,
      smartAssets: prev.smartAssets?.map(asset => asset.id === id ? { ...asset, role } : asset)
    }));
  };
  const clearEditPreview = () => {
    setParams(prev => ({
      ...prev,
      editBaseImage: undefined,
      editMask: undefined,
      editRegions: undefined,
      editPreviewImage: undefined,
      editPreviewMimeType: undefined
    }));
  };

  const handleGenerateClick = async () => { if (activeTab === 'chat') { setIsAnalyzing(true); try { const chatPrompt = await extractPromptFromHistory(chatHistory, mode); if (chatPrompt) onGenerate({ prompt: chatPrompt }); else { const lastUserMsg = [...chatHistory].reverse().find(m => m.role === 'user'); if (lastUserMsg && lastUserMsg.content) onGenerate({ prompt: lastUserMsg.content }); } } catch (e) { console.error("Failed to extract prompt", e); } finally { setIsAnalyzing(false); } } else { onGenerate(); } };
  const handleDragOver = (e: React.DragEvent, target: 'smart' | 'videoStart' | 'videoEnd' | 'videoStyle') => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragTarget(target); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragTarget(null); };
  const handleDrop = async (e: React.DragEvent, target: 'smart' | 'videoStart' | 'videoEnd' | 'videoStyle') => {
    e.preventDefault(); setDragTarget(null);
    try {
      const assetStr = e.dataTransfer.getData('application/lumina-asset');
      if (assetStr) {
        const asset: AssetItem = JSON.parse(assetStr);
        let data = '', mimeType = '';
        if (asset.url.startsWith('data:')) { const matches = asset.url.match(/^data:(.+);base64,(.+)$/); if (matches) { mimeType = matches[1]; data = matches[2]; } }
        else { const resp = await fetch(asset.url); const blob = await resp.blob(); const reader = new FileReader(); await new Promise<void>((resolve) => { reader.onload = () => { const res = reader.result as string; const matches = res.match(/^data:(.+);base64,(.+)$/); if (matches) { mimeType = matches[1]; data = matches[2]; } resolve(); }; reader.readAsDataURL(blob); }); }
        if (data && mimeType) {
          const newItem = { data, mimeType };
          if (target === 'smart') {
            const maxAllowed = getMaxSmartAssets();
            if ((params.smartAssets?.length || 0) >= maxAllowed) {
              alert(`${params.imageModel === ImageModel.PRO ? 'Pro' : 'Flash'} 模型最多支持 ${maxAllowed} 张参考图`);
              return;
            }
            setParams(prev => ({ ...prev, smartAssets: [...(prev.smartAssets || []), { id: crypto.randomUUID(), data, mimeType, role: DEFAULT_SMART_ASSET_ROLE }] }));
          }
          else if (target === 'videoStyle') setParams(prev => ({ ...prev, videoStyleReferences: [...(prev.videoStyleReferences || []), newItem].slice(0, 3) }));
          else if (target === 'videoStart') setParams(prev => ({ ...prev, videoStartImage: data, videoStartImageMimeType: mimeType }));
          else if (target === 'videoEnd') setParams(prev => ({ ...prev, videoEndImage: data, videoEndImageMimeType: mimeType }));
        }
      } else {
        const files = Array.from(e.dataTransfer.files) as File[];
        if (target === 'smart') {
          const maxAllowed = getMaxSmartAssets();
          if ((params.smartAssets?.length || 0) + files.length > maxAllowed) {
            alert(`${params.imageModel === ImageModel.PRO ? 'Pro' : 'Flash'} 模型最多支持 ${maxAllowed} 张参考图`);
            return;
          }
        }
        const validFiles = files.filter(isValidImage);
        if (validFiles.length > 0) {
          const processFile = (file: File) => new Promise<{ data: string, mimeType: string }>((resolve, reject) => {
            if (file.size > APP_LIMITS.MAX_FILE_SIZE_BYTES) {
              alert(`${file.name}: ${t('msg.upload_limit_size')}`);
              reject();
              return;
            }
            const reader = new FileReader();
            reader.onload = (ev) => { const res = ev.target?.result as string; const matches = res.match(/^data:(.+);base64,(.+)$/); if (matches) resolve({ mimeType: matches[1], data: matches[2] }); else reject(); };
            reader.readAsDataURL(file);
          });
          // FIX: Use Promise.allSettled to handle partial failures gracefully
          const settledResults = await Promise.allSettled(validFiles.map(processFile));
          const results = settledResults
            .filter((r): r is PromiseFulfilledResult<{ data: string, mimeType: string }> => r.status === 'fulfilled')
            .map(r => r.value);

          if (results.length > 0) {
            if (target === 'smart') setParams(prev => ({ ...prev, smartAssets: [...(prev.smartAssets || []), ...results.map(r => ({ id: crypto.randomUUID(), data: r.data, mimeType: r.mimeType, role: DEFAULT_SMART_ASSET_ROLE }))] }));
            else if (target === 'videoStyle') setParams(prev => ({ ...prev, videoStyleReferences: [...(prev.videoStyleReferences || []), ...results].slice(0, 3) }));
            else if (target === 'videoStart' && results[0]) setParams(prev => ({ ...prev, videoStartImage: results[0].data, videoStartImageMimeType: results[0].mimeType }));
            else if (target === 'videoEnd' && results[0]) setParams(prev => ({ ...prev, videoEndImage: results[0].data, videoEndImageMimeType: results[0].mimeType }));
          }
        }
      }
    } catch (error) { console.error("Drop failed", error); }
  };

  const renderRatioVisual = (ratio: AspectRatio) => {
    let width = 16, height = 16;
    const enumKey = Object.keys(AspectRatio).find(k => AspectRatio[k as keyof typeof AspectRatio] === ratio) as string;
    const label = t(`ratio.${enumKey}` as any) || ratio;
    switch (ratio) {
      case AspectRatio.SQUARE: width = 16; height = 16; break;
      case AspectRatio.LANDSCAPE: width = 24; height = 14; break;
      case AspectRatio.PORTRAIT: width = 14; height = 24; break;
      case AspectRatio.FOUR_THIRDS: width = 20; height = 15; break;
      case AspectRatio.THREE_FOURTHS: width = 15; height = 20; break;
      case AspectRatio.TWO_THIRDS: width = 14; height = 21; break;
      case AspectRatio.THREE_TWOS: width = 21; height = 14; break;
      case AspectRatio.FOUR_FIFTHS: width = 16; height = 20; break;
      case AspectRatio.FIVE_FOURTHS: width = 20; height = 16; break;
      case AspectRatio.ULTRAWIDE: width = 28; height = 12; break;
    }
    const isSelected = params.aspectRatio === ratio;
    return (
      <button key={ratio} onClick={() => handleRatioChange(ratio)} className={`relative flex flex-col items-center justify-center p-2 rounded-lg border transition-all gap-2 group h-20 ${isSelected ? 'border-brand-500 bg-brand-500/10' : 'border-dark-border bg-dark-surface hover:bg-white/5 hover:border-gray-500'}`} title={label}>
        <div className={`border-2 rounded-sm transition-colors ${isSelected ? 'border-brand-400 bg-brand-400/20' : 'border-gray-500 bg-gray-500/10 group-hover:border-gray-400'}`} style={{ width: `${width}px`, height: `${height}px` }} />
        <span className={`text-[10px] font-medium text-center ${isSelected ? 'text-brand-400' : 'text-gray-500 group-hover:text-gray-300'}`}>{label}</span>
      </button>
    );
  };

  const isVideoGenerating = mode === AppMode.VIDEO && isGenerating;
  const isCoolingDown = cooldownRemaining > 0;
  const isBtnDisabled = (activeTab === 'studio' ? !params.prompt.trim() : (chatHistory.length === 0 || isAnalyzing)) || isVideoGenerating || isCoolingDown;
  const displayedRatios = mode === AppMode.VIDEO ? [AspectRatio.LANDSCAPE, AspectRatio.PORTRAIT] : Object.values(AspectRatio);
  const isVeoHQ = params.videoModel === VideoModel.VEO_HQ;
  const isVideoExtension = !!params.inputVideoUri;
  const hasRefImages = (params.videoStyleReferences?.length || 0) > 0;

  const handleVideoTabSwitch = (tab: 'keyframes' | 'style') => { setActiveVideoTab(tab); if (tab === 'keyframes') { setParams(prev => ({ ...prev, videoStyleReferences: [] })); } else { setParams(prev => ({ ...prev, videoStartImage: undefined, videoStartImageMimeType: undefined, videoEndImage: undefined, videoEndImageMimeType: undefined })); } };
  const cancelVideoExtension = () => {
    setParams(prev => ({
      ...prev,
      inputVideoUri: undefined
    }));
  };

  return (
    <div className="w-[400px] flex-shrink-0 flex flex-col border-r border-dark-border bg-dark-panel z-20 h-full">
      <div className="h-16 flex items-center px-4 border-b border-dark-border gap-2 shrink-0 justify-between">
        <h2 className="text-xl font-bold text-brand-500 mr-4">
          {mode === AppMode.VIDEO ? t('nav.video') : t('nav.image')}
        </h2>
        {isGenerating && <div className="flex items-center gap-1.5 px-2 py-1 bg-brand-500/10 rounded-full border border-brand-500/20 animate-pulse"><div className="w-2 h-2 rounded-full border border-brand-400 border-t-transparent animate-spin" /><span className="text-[10px] text-brand-400 font-mono">{formatTime(elapsedSeconds)}</span></div>}
        {isCoolingDown && <div className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/10 rounded-full border border-yellow-500/20"><Clock size={10} className="text-yellow-500" /><span className="text-[10px] text-yellow-500 font-mono">Cooldown {cooldownRemaining}s</span></div>}
      </div>

      <div className="p-2 mx-4 mt-4 bg-dark-bg rounded-lg flex border border-dark-border shrink-0">
        <button onClick={() => onTabChange('studio')} className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${activeTab === 'studio' ? 'bg-dark-surface text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}>{t('tab.parameters')}</button>
        <button onClick={() => onTabChange('chat')} className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${activeTab === 'chat' ? 'bg-dark-surface text-brand-400 shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}><MessageSquare size={12} />{t('tab.assistant')}</button>
      </div>

      <div className="flex-1 relative overflow-hidden flex flex-col">
        <div className={`absolute inset-0 flex flex-col ${activeTab === 'chat' ? 'z-10 opacity-100 pointer-events-auto' : 'z-0 opacity-0 pointer-events-none'}`}>
          <ChatInterface
            history={chatHistory}
            setHistory={setChatHistory}
            onApplyPrompt={handleApplyPrompt}
            selectedImages={chatSelectedImages}
            setSelectedImages={setChatSelectedImages}
            projectId={projectId}
            params={chatParams}
            setParams={setChatParams}
            mode={mode}
            onToolCall={onToolCall}
            projectContextSummary={projectContextSummary}
            projectSummaryCursor={projectSummaryCursor}
            onUpdateProjectContext={onUpdateProjectContext}
            agentContextAssets={agentContextAssets}
            onRemoveContextAsset={onRemoveContextAsset}
            onClearContextAssets={onClearContextAssets}
            thoughtImages={thoughtImages}
            setThoughtImages={setThoughtImages}
          />
        </div>

        <div className={`absolute inset-0 overflow-y-auto p-6 space-y-6 custom-scrollbar ${activeTab === 'studio' ? 'z-10 opacity-100 pointer-events-auto' : 'z-0 opacity-0 pointer-events-none'}`}>
          {/* Model Selection */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('lbl.model')}</label>
            <div className="relative">
              {mode === AppMode.IMAGE ? (
                <select
                  value={params.imageModel}
                  onChange={(e) => handleModelChange(e.target.value as ImageModel)}
                  className="w-full bg-dark-surface border border-dark-border rounded-xl px-4 py-3 text-sm text-white appearance-none focus:border-brand-500 focus:outline-none transition-colors"
                >
                  <option value={ImageModel.FLASH}>{t('model.flash')}</option>
                  <option value={ImageModel.PRO}>{t('model.pro')}</option>
                </select>
              ) : (
                <select value={params.videoModel} onChange={(e) => setParams(prev => ({ ...prev, videoModel: e.target.value as VideoModel }))} className="w-full bg-dark-surface border border-dark-border rounded-xl px-4 py-3 text-sm text-white appearance-none focus:border-brand-500 focus:outline-none transition-colors">
                  <option value={VideoModel.VEO_FAST}>{t('model.veo_fast')}</option>
                  <option value={VideoModel.VEO_HQ}>{t('model.veo_hq')}</option>
                </select>
              )}
              <Settings2 className="absolute right-3 top-3.5 text-gray-500 pointer-events-none" size={16} />
            </div>

            {mode === AppMode.IMAGE && params.imageModel === ImageModel.PRO && (
              <div className={`flex flex-col gap-2 p-3 bg-dark-surface border border-dark-border rounded-xl animate-in fade-in slide-in-from-top-2 transition-colors ${params.useGrounding ? 'border-brand-500/30 bg-brand-500/5' : ''}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col flex-1 min-w-0">
                    <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5 cursor-pointer select-none" onClick={handleToggleSearch}>
                      <Search size={12} className={params.useGrounding ? "text-brand-400" : "text-gray-500"} />
                      {t('lbl.use_search')}
                    </label>
                    <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{t('help.search_desc')}</p>
                  </div>
                  <button
                    onClick={handleToggleSearch}
                    className={`w-9 h-5 rounded-full transition-colors relative flex items-center shrink-0 ${params.useGrounding ? 'bg-brand-500' : 'bg-gray-700'}`}
                  >
                    <div className={`w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-all absolute ${params.useGrounding ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <PromptBuilder onAppend={handleAppendTag} mode={mode} />

            {/* Style Selector - Moved after Prompt Builder */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('lbl.style')}</label>
              <div className="relative">
                <select value={mode === AppMode.IMAGE ? (params.imageStyle || ImageStyle.NONE) : (params.videoStyle || VideoStyle.NONE)} onChange={(e) => setParams(prev => mode === AppMode.IMAGE ? ({ ...prev, imageStyle: e.target.value as ImageStyle }) : ({ ...prev, videoStyle: e.target.value as VideoStyle }))} className="w-full bg-dark-surface border border-dark-border rounded-lg px-3 py-2 text-xs text-white appearance-none focus:border-brand-500 focus:outline-none transition-colors">
                  {mode === AppMode.IMAGE ? Object.entries(ImageStyle).map(([key, value]) => <option key={key} value={value}>{t(`style.${key}` as any) || value}</option>) : Object.entries(VideoStyle).map(([key, value]) => <option key={key} value={value}>{t(`style.${key}` as any) || value}</option>)}
                </select>
                <Palette size={14} className="absolute right-3 top-2.5 text-gray-500 pointer-events-none" />
              </div>
            </div>

            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('lbl.prompt')}</label>
              <div className="flex gap-2 relative">
                {mode === AppMode.VIDEO && (
                  <div className="relative template-dropdown">
                    <button onClick={() => setShowTemplates(!showTemplates)} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg text-[10px] font-medium transition-colors border border-white/10">
                      <BookTemplate size={12} /> {t('tmpl.select')}
                    </button>
                    {showTemplates && (
                      <div className="absolute top-full right-0 mt-2 w-64 bg-dark-surface border border-dark-border rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                        <div className="p-2 text-[10px] font-bold text-gray-500 uppercase border-b border-dark-border">{t('tmpl.select')}</div>
                        <div className="max-h-48 overflow-y-auto custom-scrollbar">
                          {VIDEO_TEMPLATES.map((tmpl, idx) => (
                            <button key={idx} onClick={() => applyTemplate(tmpl.text)} className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-white/10 hover:text-white transition-colors border-b border-dark-border/30 last:border-0">
                              <div className="font-bold mb-0.5 text-brand-400">{tmpl.label}</div>
                              <div className="text-[10px] text-gray-500 line-clamp-2 leading-tight">{tmpl.text}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {mode === AppMode.IMAGE && params.smartAssets && params.smartAssets.length > 0 && (
                  <button onClick={handleDescribeImage} disabled={isDescribing} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-lg text-[10px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-indigo-500/20">
                    {isDescribing ? <div className="w-3 h-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" /> : <Eye size={12} />} {isDescribing ? 'Analyzing...' : t('btn.describe')}
                  </button>
                )}
                <button onClick={handleOptimizePrompt} disabled={isOptimizing || !params.prompt.trim()} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 rounded-lg text-[10px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-brand-500/20">
                  {isOptimizing ? <div className="w-3 h-3 rounded-full border-2 border-brand-400 border-t-transparent animate-spin" /> : <Sparkles size={12} />} {isOptimizing ? 'Enhancing...' : t('btn.magic_enhance')}
                </button>
              </div>
            </div>
            <textarea value={localPrompt} onChange={(e) => handlePromptChange(e.target.value)} placeholder={mode === AppMode.IMAGE ? t('ph.prompt.image') : t('ph.prompt.video')} className="w-full h-32 bg-dark-surface border border-dark-border rounded-xl p-4 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none resize-none transition-colors" />
          </div>

          <div className="border border-dark-border rounded-xl overflow-hidden bg-dark-surface/30">
            <button onClick={() => setIsAdvancedOpen(!isAdvancedOpen)} className="w-full flex items-center justify-between p-3 text-xs font-bold text-gray-400 uppercase tracking-wider hover:bg-white/5 transition-colors">
              <div className="flex items-center gap-2"><SlidersHorizontal size={14} />{language === 'zh' ? '反向提示词 (Negative)' : 'Negative Prompt'}</div>
              {isAdvancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {isAdvancedOpen && (
              <div className="p-3 pt-0 space-y-4 animate-in slide-in-from-top-2">
                <div className="space-y-2">
                  <textarea value={params.negativePrompt || ''} onChange={(e) => setParams(prev => ({ ...prev, negativePrompt: e.target.value }))} placeholder={t('ph.negative')} className="w-full h-20 bg-dark-surface border border-dark-border rounded-lg p-3 text-xs text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none resize-none" />
                </div>
              </div>
            )}
          </div>

          {mode === AppMode.IMAGE && params.editPreviewImage && params.editPreviewMimeType && (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{t('lbl.edit_preview')}</span>
                <button onClick={clearEditPreview} className="text-[10px] text-gray-400 hover:text-white transition-colors">
                  {t('btn.clear_edit')}
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-dark-border bg-black">
                  <img src={`data:${params.editPreviewMimeType};base64,${params.editPreviewImage}`} alt="Edit Preview" className="w-full h-full object-cover" />
                </div>
                <div className="text-[11px] text-gray-400 leading-relaxed">
                  {t('help.edit_preview')}
                </div>
              </div>
            </div>
          )}

          {/* SMART ASSETS */}
          {mode === AppMode.IMAGE && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-px bg-white/10 flex-1" />
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{t('lbl.smart_assets')}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${(params.smartAssets?.length || 0) >= getMaxSmartAssets() ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}`}>
                  {params.smartAssets?.length || 0}/{getMaxSmartAssets()}
                </span>
                <div className="h-px bg-white/10 flex-1" />
              </div>
              <p className="text-[10px] text-gray-500">{t('help.smart_assets')}</p>
              <div className="flex flex-wrap gap-2">
                {params.smartAssets?.map((asset, index) => (
                  <div key={asset.id} className="flex flex-col items-center gap-1 animate-in fade-in zoom-in">
                    <div className="relative group">
                      <div className="w-16 h-16 rounded-lg overflow-hidden border border-dark-border bg-black">
                        <img src={`data:${asset.mimeType};base64,${asset.data}`} alt={`Image ${index + 1}`} className="w-full h-full object-cover" />
                      </div>
                      {/* Image number badge */}
                      <div className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-brand-500 text-white text-[10px] font-bold flex items-center justify-center shadow-lg">
                        {index + 1}
                      </div>
                      {/* Delete button */}
                      <button
                        onClick={() => removeSmartAsset(asset.id)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                      >
                        <X size={10} />
                      </button>
                    </div>
                    <select
                      value={resolveSmartAssetRole(asset)}
                      onChange={(e) => updateSmartAssetRole(asset.id, e.target.value as SmartAssetRole)}
                      className="w-20 bg-dark-bg border border-dark-border rounded px-1 py-0.5 text-[9px] text-gray-300"
                    >
                      {smartAssetRoleOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {/* Only show upload area if not at limit */}
              {(params.smartAssets?.length || 0) < getMaxSmartAssets() && (
                <div className={`w-full h-24 border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all ${dragTarget === 'smart' ? 'border-brand-500 bg-brand-500/10' : 'border-dark-border hover:border-brand-500 hover:bg-white/5'}`} onClick={() => smartAssetInputRef.current?.click()} onDragOver={(e) => handleDragOver(e, 'smart')} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, 'smart')}>
                  <Briefcase className="text-gray-500 mb-2" size={20} /><span className="text-xs text-gray-400 font-medium">{t('help.upload')}</span><span className="text-[10px] text-gray-600 mt-1">Multi-file supported</span>
                </div>
              )}
              <input ref={smartAssetInputRef} type="file" multiple accept="image/png, image/jpeg, image/webp" className="hidden" onChange={(e) => handleUpload(e, 'smart')} />
            </div>
          )}

          {/* VIDEO CONTROLS */}
          {mode === AppMode.VIDEO && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-5">
              <div className="flex items-center gap-2 mb-2"><div className="h-px bg-white/10 flex-1" /><span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{t('lbl.video_controls')}</span><div className="h-px bg-white/10 flex-1" /></div>

              {isVideoExtension && (
                <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 relative overflow-hidden">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-purple-500/20 rounded-lg shrink-0"><Clapperboard size={20} className="text-purple-400" /></div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-purple-200 uppercase mb-1">{t('lbl.video_extend')}</h4>
                      <p className="text-[10px] text-gray-400 leading-relaxed mb-2">You are extending an existing video. Locked to 720p and 8s for stability.</p>
                      <button onClick={cancelVideoExtension} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded border border-white/10 text-[10px] text-gray-300 transition-colors"><XCircle size={12} /> Cancel Extension</button>
                    </div>
                  </div>
                </div>
              )}

              {!isVideoExtension && (
                <>
                  {isVeoHQ && (
                    <div className="flex bg-dark-bg p-1 rounded-lg border border-dark-border mb-3">
                      <button onClick={() => handleVideoTabSwitch('keyframes')} className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${activeVideoTab === 'keyframes' ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30' : 'text-gray-500 hover:text-gray-300'}`}>{t('lbl.video_keyframes')}</button>
                      <button onClick={() => handleVideoTabSwitch('style')} className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${activeVideoTab === 'style' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'text-gray-500 hover:text-gray-300'}`}>{t('lbl.video_subject_ref')}</button>
                    </div>
                  )}
                  {(!isVeoHQ || activeVideoTab === 'keyframes') && (
                    <div className="space-y-3 animate-in fade-in slide-in-from-right-2">
                      <p className="text-[10px] text-gray-500">{t('help.video_frames')}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Start Frame</label>
                          {params.videoStartImage ? (
                            <div className="relative aspect-video rounded-lg overflow-hidden border border-dark-border group"><img src={`data:${params.videoStartImageMimeType};base64,${params.videoStartImage}`} className="w-full h-full object-cover" /><button onClick={() => removeImage('start')} className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100"><X size={12} /></button></div>
                          ) : (
                            <div className={`aspect-video border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer ${dragTarget === 'videoStart' ? 'border-brand-500 bg-brand-500/10' : 'border-dark-border hover:border-brand-500 hover:bg-white/5'}`} onClick={() => startFrameInputRef.current?.click()} onDragOver={(e) => handleDragOver(e, 'videoStart')} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, 'videoStart')}><ArrowRight size={16} className="text-gray-500 mb-1" /><span className="text-[10px] text-gray-500">Start</span></div>
                          )}
                          <input ref={startFrameInputRef} type="file" accept="image/png, image/jpeg, image/webp" className="hidden" onChange={(e) => handleUpload(e, 'start')} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">End Frame</label>
                          {params.videoEndImage ? (
                            <div className="relative aspect-video rounded-lg overflow-hidden border border-dark-border group"><img src={`data:${params.videoEndImageMimeType};base64,${params.videoEndImage}`} className="w-full h-full object-cover" /><button onClick={() => removeImage('end')} className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100"><X size={12} /></button></div>
                          ) : (
                            <div className={`aspect-video border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer ${dragTarget === 'videoEnd' ? 'border-brand-500 bg-brand-500/10' : 'border-dark-border hover:border-brand-500 hover:bg-white/5'}`} onClick={() => endFrameInputRef.current?.click()} onDragOver={(e) => handleDragOver(e, 'videoEnd')} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, 'videoEnd')}><Frame size={16} className="text-gray-500 mb-1" /><span className="text-[10px] text-gray-500">End</span></div>
                          )}
                          <input ref={endFrameInputRef} type="file" accept="image/png, image/jpeg, image/webp" className="hidden" onChange={(e) => handleUpload(e, 'end')} />
                        </div>
                      </div>
                    </div>
                  )}
                  {isVeoHQ && activeVideoTab === 'style' && (
                    <div className="space-y-3 animate-in fade-in slide-in-from-right-2">
                      <p className="text-[10px] text-gray-500">{t('help.video_subject_desc')}</p>
                      <div className="grid grid-cols-3 gap-2">
                        {params.videoStyleReferences?.map((ref, idx) => (
                          <div key={idx} className="relative aspect-square rounded-lg border border-dark-border overflow-hidden group"><img src={`data:${ref.mimeType};base64,${ref.data}`} alt="ref" className="w-full h-full object-cover" /><button onClick={() => removeVideoStyleRef(idx)} className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><X size={12} /></button></div>
                        ))}
                        {(params.videoStyleReferences?.length || 0) < 3 && (
                          <div className={`aspect-square border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors ${dragTarget === 'videoStyle' ? 'border-purple-500 bg-purple-500/10' : 'border-dark-border hover:border-purple-500 hover:bg-white/5'}`} onClick={() => videoStyleRefsInputRef.current?.click()} onDragOver={(e) => handleDragOver(e, 'videoStyle')} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, 'videoStyle')}><ScanFace size={20} className="text-gray-500 mb-1" /><span className="text-[10px] text-gray-500 text-center">{t('help.upload')}</span></div>
                        )}
                      </div>
                      <input ref={videoStyleRefsInputRef} type="file" multiple accept="image/png, image/jpeg, image/webp" className="hidden" onChange={(e) => handleUpload(e, 'videoStyle')} />
                      <div className="p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-[10px] text-yellow-500">Note: Using references locks to 16:9, 720p, and 8s duration.</div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="space-y-4 pt-4 border-t border-dark-border/30">
            {/* Duration Selector */}
            {mode === AppMode.VIDEO && (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('lbl.duration')}</label>
                  {(isVideoExtension || hasRefImages) && <span className="text-[10px] text-purple-400 flex items-center gap-1"><Lock size={8} /> Locked (8s)</span>}
                </div>
                <div className={`grid grid-cols-3 gap-2 ${isVideoExtension || hasRefImages ? 'opacity-50 pointer-events-none' : ''}`}>
                  {[VideoDuration.SHORT, VideoDuration.MEDIUM, VideoDuration.LONG].map(dur => (
                    <button
                      key={dur}
                      onClick={() => setParams(prev => ({ ...prev, videoDuration: dur }))}
                      className={`py-2 rounded-lg border text-xs font-medium transition-all ${params.videoDuration === dur ? 'border-brand-500 bg-brand-500/20 text-brand-400' : 'border-dark-border bg-dark-surface text-gray-500 hover:border-gray-500'}`}
                    >
                      {dur}s
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Aspect Ratio - Collapsible for IMAGE, Grid for VIDEO */}
            {mode === AppMode.IMAGE ? (
              <div className="border border-dark-border rounded-xl overflow-hidden bg-dark-surface/30">
                <button
                  onClick={() => setIsAspectRatioOpen(!isAspectRatioOpen)}
                  disabled={hasRefImages || isVideoExtension}
                  className={`w-full flex items-center justify-between p-3 text-xs font-bold text-gray-400 uppercase tracking-wider transition-colors ${(hasRefImages || isVideoExtension) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/5'}`}
                >
                  <div className="flex items-center gap-2">
                    <Frame size={14} />
                    <span>{t('lbl.aspect_ratio')}</span>
                    <span className="text-brand-400 normal-case font-normal">({params.aspectRatio})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {(hasRefImages || isVideoExtension) && <span className="text-[10px] text-purple-400 flex items-center gap-1 font-normal normal-case"><Lock size={8} /> Locked</span>}
                    {isAspectRatioOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>
                </button>
                {isAspectRatioOpen && (
                  <div className="p-3 pt-0 animate-in slide-in-from-top-2">
                    <div className="grid gap-2 grid-cols-5">
                      {displayedRatios.map(renderRatioVisual)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('lbl.aspect_ratio')}</label>
                  {(hasRefImages || isVideoExtension) && <span className="text-[10px] text-purple-400 flex items-center gap-1"><Lock size={8} /> Locked</span>}
                </div>
                <div className={`grid gap-2 grid-cols-2 ${(hasRefImages || isVideoExtension) ? 'opacity-50 pointer-events-none' : ''}`}>
                  {displayedRatios.map(renderRatioVisual)}
                </div>
              </div>
            )}


            {/* Resolution & Count/Duration */}
            <div className={`grid gap-4 ${mode === AppMode.IMAGE ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('lbl.resolution')}</label>
                <div className={`relative ${(hasRefImages || isVideoExtension) ? 'opacity-50 pointer-events-none' : ''}`}>
                  <select value={mode === AppMode.IMAGE ? params.imageResolution : params.videoResolution} onChange={(e) => setParams(prev => mode === AppMode.IMAGE ? ({ ...prev, imageResolution: e.target.value as ImageResolution }) : ({ ...prev, videoResolution: e.target.value as VideoResolution }))} className="w-full bg-dark-surface border border-dark-border rounded-lg px-3 py-2 text-xs text-white appearance-none focus:border-brand-500 focus:outline-none">
                    {mode === AppMode.IMAGE ? (<><option value={ImageResolution.RES_1K}>1K</option><option value={ImageResolution.RES_2K} disabled={params.imageModel === ImageModel.FLASH}>2K (Pro)</option><option value={ImageResolution.RES_4K} disabled={params.imageModel === ImageModel.FLASH}>4K (Pro)</option></>) : (
                      <>
                        <option value={VideoResolution.RES_720P}>720p HD</option>
                        <option value={VideoResolution.RES_1080P} disabled={params.videoDuration !== VideoDuration.LONG}>1080p FHD (Requires 8s)</option>
                      </>
                    )}
                  </select>
                  <Monitor size={14} className="absolute right-3 top-2.5 text-gray-500 pointer-events-none" />
                </div>
              </div>

              {mode === AppMode.IMAGE && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('lbl.count')}</label>
                  <div className="grid grid-cols-4 gap-1">
                    {[1, 2, 3, 4].map(num => (<button key={num} onClick={() => setParams(prev => ({ ...prev, numberOfImages: num }))} className={`py-2 rounded-lg border text-xs font-medium transition-all ${(params.numberOfImages || 1) === num ? 'border-brand-500 bg-brand-500/20 text-brand-400' : 'border-dark-border bg-dark-surface text-gray-500 hover:border-gray-500'}`}>{num}</button>))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="pb-6" />
        </div>
      </div>

      {activeTab === 'studio' && (
        <div className="p-4 bg-dark-panel border-t border-dark-border z-20 shrink-0">
          <button onClick={handleGenerateClick} disabled={isBtnDisabled} className={`w-full py-4 font-bold rounded-xl shadow-lg transition-all transform hover:-translate-y-0.5 flex flex-col items-center justify-center gap-1 ${isBtnDisabled ? 'bg-gray-700 text-gray-400 cursor-not-allowed transform-none' : 'bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white shadow-brand-900/20'}`}>
            {isCoolingDown ? (<div className="flex items-center gap-2 text-yellow-400"><Clock size={20} className="animate-pulse" /><span>System Busy (Wait {cooldownRemaining}s)</span></div>) : isGenerating || isAnalyzing ? (<div className="flex items-center gap-2">{isAnalyzing ? (<><Sparkles size={20} className="animate-pulse" /><span>{t('btn.analyzing')}</span></>) : (mode === AppMode.VIDEO ? (<><Loader2 size={20} className="animate-spin" /><span>{t('nav.generating')}</span></>) : (<><Layers size={20} className="animate-pulse" /><span>{t('btn.queue')}</span></>))}</div>) : (<div className="flex items-center gap-2">{mode === AppMode.IMAGE ? <ImageIcon size={20} /> : <VideoIcon size={20} />}<span>{params.inputVideoUri ? t('btn.extend') : t('btn.generate')} {mode === AppMode.IMAGE ? (params.numberOfImages || 1) : ''}</span></div>)}
            {!isCoolingDown && <span className="text-[10px] font-normal opacity-70">{t('msg.cost_warning')}</span>}
          </button>
        </div>
      )}
    </div>
  );
};
