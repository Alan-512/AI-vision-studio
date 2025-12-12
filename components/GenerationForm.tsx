import React, { useRef, useState, useEffect } from 'react';
import { AppMode, AspectRatio, GenerationParams, ImageResolution, VideoResolution, ImageModel, VideoModel, ImageStyle, VideoStyle, VideoDuration, ChatMessage, AssetItem, SmartAsset } from '../types';
import { Settings2, Sparkles, Image as ImageIcon, Video as VideoIcon, Upload, X, Camera, Palette, Film, RefreshCw, MessageSquare, Layers, ChevronDown, ChevronUp, SlidersHorizontal, Monitor, Eye, Lock, Dice5, Type, User, ScanFace, Frame, ArrowRight, Loader2, Clock, BookTemplate, Clapperboard, XCircle, Search, AlertTriangle, Briefcase, Layout, Brush } from 'lucide-react';
import { ChatInterface } from './ChatInterface';
import { extractPromptFromHistory, optimizePrompt, describeImage, AgentAction } from '../services/geminiService';
import { PromptBuilder } from './PromptBuilder';
import { useLanguage } from '../contexts/LanguageContext';

interface GenerationFormProps {
  mode: AppMode;
  params: GenerationParams;
  setParams: React.Dispatch<React.SetStateAction<GenerationParams>>;
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
  // Agent & Context Props
  onToolCall?: (action: AgentAction) => void;
  projectContextSummary?: string;
  projectSummaryCursor?: number;
  onUpdateProjectContext?: (summary: string, cursor: number) => void;
}

const VIDEO_TEMPLATES = [
    { label: "Cinematic Drone", text: "A drone shot of [Subject], flying over [Environment], cinematic lighting, 4k, smooth motion." },
    { label: "Character Reveal", text: "Close up of [Subject]'s face, turning to look at the camera, slow motion, dramatic lighting, high detail." },
    { label: "Cyberpunk Action", text: "[Subject] running through a neon-lit cyberpunk city, tracking shot, rain, reflections, high speed." },
    { label: "Nature Documentary", text: "Wide shot of [Subject] in a natural habitat, golden hour sun, national geographic style, slow movement." },
    { label: "Product Showcase", text: "Studio shot of [Subject], rotating on a turntable, clean background, soft studio lighting, 4k, macro lens." }
];

export const GenerationForm: React.FC<GenerationFormProps> = ({ 
  mode, 
  params, 
  setParams, 
  isGenerating, 
  startTime,
  onGenerate,
  onVerifyVeo,
  veoVerified,
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
  onUpdateProjectContext
}) => {
  const { t } = useLanguage();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isDescribing, setIsDescribing] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isWarningExpanded, setIsWarningExpanded] = useState(false);
  
  // Video Mode Tabs
  const [activeVideoTab, setActiveVideoTab] = useState<'keyframes' | 'style'>('keyframes');

  // Drag State
  const [dragTarget, setDragTarget] = useState<'smart' | 'videoStart' | 'videoEnd' | 'videoStyle' | null>(null);

  // Refs for file inputs
  const startFrameInputRef = useRef<HTMLInputElement>(null);
  const endFrameInputRef = useRef<HTMLInputElement>(null);
  const videoStyleRefsInputRef = useRef<HTMLInputElement>(null);
  const smartAssetInputRef = useRef<HTMLInputElement>(null);
  
  // Timer State
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // AUTO-MIGRATE LEGACY PARAMS TO SMART ASSETS
  useEffect(() => {
    if (mode === AppMode.IMAGE && (!params.smartAssets || params.smartAssets.length === 0)) {
        const migratedAssets: SmartAsset[] = [];
        
        // 1. Structure (Base Image / Reference)
        if (params.referenceImage && params.referenceImageMimeType) {
            migratedAssets.push({
                id: crypto.randomUUID(),
                data: params.referenceImage,
                mimeType: params.referenceImageMimeType,
                type: 'STRUCTURE',
                isAnnotated: params.isAnnotatedReference
            });
        }
        
        // 2. Identity (Subject References)
        if (params.subjectReferences && params.subjectReferences.length > 0) {
            params.subjectReferences.forEach(ref => {
                migratedAssets.push({
                    id: crypto.randomUUID(),
                    data: ref.data,
                    mimeType: ref.mimeType,
                    type: 'IDENTITY'
                });
            });
        }
        
        // 3. Style (Style References)
        if (params.styleReferences && params.styleReferences.length > 0) {
            params.styleReferences.forEach(ref => {
                migratedAssets.push({
                    id: crypto.randomUUID(),
                    data: ref.data,
                    mimeType: ref.mimeType,
                    type: 'STYLE'
                });
            });
        }
        
        if (migratedAssets.length > 0) {
            setParams(prev => ({
                ...prev,
                smartAssets: migratedAssets,
                // Clear legacy to avoid duplication logic later, though service handles priority
                referenceImage: undefined,
                referenceImageMimeType: undefined,
                subjectReferences: [],
                styleReferences: []
            }));
        }
    }
  }, [mode, projectId]); // Run once when project/mode changes

  // Enforce valid Aspect Ratio for Video (Auto-correction)
  useEffect(() => {
    if (mode === AppMode.VIDEO) {
       const validRatios = [AspectRatio.LANDSCAPE, AspectRatio.PORTRAIT];
       if (!validRatios.includes(params.aspectRatio)) {
           setParams(prev => ({ ...prev, aspectRatio: AspectRatio.LANDSCAPE }));
       }
    }
  }, [mode, params.aspectRatio, setParams]);

  // Enforce valid Resolution for Image Flash Model
  useEffect(() => {
    if (mode === AppMode.IMAGE && params.imageModel === ImageModel.FLASH) {
       if (params.imageResolution !== ImageResolution.RES_1K) {
           setParams(prev => ({ ...prev, imageResolution: ImageResolution.RES_1K }));
       }
    }
  }, [mode, params.imageModel, params.imageResolution, setParams]);

  // Persistent Timer Logic
  useEffect(() => {
    let intervalId: any;

    const updateTimer = () => {
        const now = Date.now();
        // Generation Timer
        if (isGenerating && startTime) {
            const diff = Math.max(0, Math.floor((now - startTime) / 1000));
            setElapsedSeconds(diff);
        } else {
            setElapsedSeconds(0);
        }
        
        // Cooldown Timer
        if (cooldownEndTime > now) {
            const remaining = Math.ceil((cooldownEndTime - now) / 1000);
            setCooldownRemaining(remaining);
        } else {
            setCooldownRemaining(0);
        }
    };

    updateTimer();
    intervalId = setInterval(updateTimer, 1000);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isGenerating, startTime, cooldownEndTime]);

  // Close template dropdown on click outside
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

  const handleApplyPrompt = (prompt: string) => {
    setParams(prev => ({ ...prev, prompt }));
    onTabChange('studio');
  };

  const handleOptimizePrompt = async () => {
    if (!params.prompt.trim()) return;
    setIsOptimizing(true);
    try {
      // Pass smartAssets to the optimizer so it knows context!
      const optimized = await optimizePrompt(params.prompt, mode, params.smartAssets);
      setParams(prev => ({ ...prev, prompt: optimized }));
    } catch (e) {
      console.error("Optimization failed", e);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleDescribeImage = async () => {
    // Describe the first STRUCTURE asset found
    const structureAsset = params.smartAssets?.find(a => a.type === 'STRUCTURE');
    if (!structureAsset) {
      alert("Please upload a Structure/Composition image first.");
      return;
    }
    setIsDescribing(true);
    try {
      const desc = await describeImage(structureAsset.data, structureAsset.mimeType);
      setParams(prev => ({ ...prev, prompt: desc }));
    } catch(e) {
      console.error(e);
      alert("Failed to describe image.");
    } finally {
      setIsDescribing(false);
    }
  };

  const handleAppendTag = (tag: string) => {
     setParams(prev => {
         const current = prev.prompt.trim();
         if (current.includes(tag)) return prev; 
         return {
            ...prev,
            prompt: current ? `${current}, ${tag}` : tag
         };
      });
  };
  
  const applyTemplate = (text: string) => {
      setParams(prev => ({ ...prev, prompt: text }));
      setShowTemplates(false);
  };

  const handleRandomizeSeed = () => setParams(prev => ({ ...prev, seed: undefined }));
  
  const handleLockSeed = () => {
    if (params.seed === undefined) {
      setParams(prev => ({ ...prev, seed: Math.floor(Math.random() * 10000000) }));
    } else {
      setParams(prev => ({ ...prev, seed: undefined }));
    }
  };

  // Helper: Strict Image Validation
  const isValidImage = (file: File) => {
      const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!validTypes.includes(file.type)) {
          console.warn(`Blocked invalid file type: ${file.type}`);
          return false;
      }
      return true;
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>, field: 'smart' | 'start' | 'end' | 'videoStyle') => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const processFile = (file: File) => new Promise<{data: string, mimeType: string}>((resolve, reject) => {
        // Security Check: MIME Type
        if (!isValidImage(file)) {
            alert(`File ${file.name} is not a supported image type. Please use PNG, JPEG, or WebP.`);
            reject('Invalid type');
            return;
        }

        const MAX_SIZE = 20 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            alert(`File ${file.name} too large.`);
            reject('Too large');
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            const result = event.target?.result as string;
            const matches = result.match(/^data:(.+);base64,(.+)$/);
            if (matches) {
                resolve({ mimeType: matches[1], data: matches[2] });
            } else {
                reject('Invalid format');
            }
        };
        reader.readAsDataURL(file);
    });

    if (field === 'smart') {
        const validFiles = Array.from(files).filter(isValidImage);
        Promise.all(validFiles.map(processFile)).then(results => {
            setParams(prev => {
                const newAssets: SmartAsset[] = results.map(r => ({
                    id: crypto.randomUUID(),
                    data: r.data,
                    mimeType: r.mimeType,
                    type: 'STRUCTURE' // Default type to Structure (Composition)
                }));
                return { ...prev, smartAssets: [...(prev.smartAssets || []), ...newAssets] };
            });
        });
    } else if (field === 'videoStyle') {
        const currentCount = params.videoStyleReferences?.length || 0;
        const availableSlots = 3 - currentCount;
        const validFiles = Array.from(files).filter(isValidImage).slice(0, availableSlots);
        
        Promise.all(validFiles.map(processFile)).then(results => {
            setParams(prev => ({ ...prev, videoStyleReferences: [...(prev.videoStyleReferences || []), ...results] }));
        });
    } else {
        if (!isValidImage(files[0])) {
            alert("Invalid file type. Please upload PNG, JPEG, or WebP.");
            return;
        }
        processFile(files[0]).then(({data, mimeType}) => {
             setParams(prev => {
                if (field === 'start') return { ...prev, videoStartImage: data, videoStartImageMimeType: mimeType };
                if (field === 'end') return { ...prev, videoEndImage: data, videoEndImageMimeType: mimeType };
                return prev;
             });
        });
    }
    e.target.value = '';
  };

  const removeImage = (field: 'start' | 'end') => {
    setParams(prev => {
      if (field === 'start') return { ...prev, videoStartImage: undefined, videoStartImageMimeType: undefined };
      if (field === 'end') return { ...prev, videoEndImage: undefined, videoEndImageMimeType: undefined };
      return prev;
    });
  };

  const removeVideoStyleRef = (index: number) => setParams(prev => ({...prev, videoStyleReferences: prev.videoStyleReferences?.filter((_, i) => i !== index)}));

  // Smart Asset Actions
  const updateSmartAsset = (id: string, updates: Partial<SmartAsset>) => {
      setParams(prev => ({
          ...prev,
          smartAssets: prev.smartAssets?.map(a => a.id === id ? { ...a, ...updates } : a)
      }));
  };

  const toggleSmartAssetTag = (id: string, tag: string) => {
      setParams(prev => ({
          ...prev,
          smartAssets: prev.smartAssets?.map(a => {
              if (a.id === id) {
                  const currentTags = a.selectedTags || [];
                  const newTags = currentTags.includes(tag) 
                      ? currentTags.filter(t => t !== tag)
                      : [...currentTags, tag];
                  return { ...a, selectedTags: newTags };
              }
              return a;
          })
      }));
  };

  const removeSmartAsset = (id: string) => {
      setParams(prev => ({
          ...prev,
          smartAssets: prev.smartAssets?.filter(a => a.id !== id),
          seed: undefined // Auto-unlock seed when an asset is removed to reset "Remix" state
      }));
  };

  const handleGenerateClick = async () => {
    if (activeTab === 'chat') {
      setIsAnalyzing(true);
      try {
        const chatPrompt = await extractPromptFromHistory(chatHistory, mode);
        if (chatPrompt) {
            onGenerate({ prompt: chatPrompt });
        } else {
            const lastUserMsg = [...chatHistory].reverse().find(m => m.role === 'user');
            if (lastUserMsg && lastUserMsg.content) {
                onGenerate({ prompt: lastUserMsg.content });
            }
        }
      } catch (e) {
        console.error("Failed to extract prompt from chat", e);
      } finally {
        setIsAnalyzing(false);
      }
    } else {
      onGenerate();
    }
  };
  
  const handleDragOver = (e: React.DragEvent, target: 'smart' | 'videoStart' | 'videoEnd' | 'videoStyle') => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragTarget(target);
  };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragTarget(null); };
  
  const handleDrop = async (e: React.DragEvent, target: 'smart' | 'videoStart' | 'videoEnd' | 'videoStyle') => {
    e.preventDefault();
    setDragTarget(null);

    try {
       // 1. Try internal asset drop first
       const assetStr = e.dataTransfer.getData('application/lumina-asset');
       if (assetStr) {
          const asset: AssetItem = JSON.parse(assetStr);
          
          let data = '';
          let mimeType = '';

          if (asset.url.startsWith('data:')) {
             const matches = asset.url.match(/^data:(.+);base64,(.+)$/);
             if (matches) {
                mimeType = matches[1];
                data = matches[2];
             }
          } else {
             const resp = await fetch(asset.url);
             const blob = await resp.blob();
             const reader = new FileReader();
             await new Promise<void>((resolve) => {
                reader.onload = () => {
                   const res = reader.result as string;
                   const matches = res.match(/^data:(.+);base64,(.+)$/);
                   if (matches) {
                      mimeType = matches[1];
                      data = matches[2];
                   }
                   resolve();
                };
                reader.readAsDataURL(blob);
             });
          }

          if (data && mimeType) {
             const newItem = { data, mimeType };
             if (target === 'smart') {
                 setParams(prev => ({
                     ...prev,
                     smartAssets: [...(prev.smartAssets || []), {
                         id: crypto.randomUUID(),
                         data,
                         mimeType,
                         type: 'STRUCTURE' // Default to Structure
                     }]
                 }));
             }
             else if (target === 'videoStyle') setParams(prev => ({ ...prev, videoStyleReferences: [...(prev.videoStyleReferences || []), newItem].slice(0, 3) }));
             else if (target === 'videoStart') setParams(prev => ({ ...prev, videoStartImage: data, videoStartImageMimeType: mimeType }));
             else if (target === 'videoEnd') setParams(prev => ({ ...prev, videoEndImage: data, videoEndImageMimeType: mimeType }));
          }
       } else {
          // 2. Handle External Files Drop
          const files = Array.from(e.dataTransfer.files) as File[];
          const validFiles = files.filter(isValidImage);
          
          if (validFiles.length > 0) {
             const processFile = (file: File) => new Promise<{data: string, mimeType: string}>((resolve, reject) => {
                 const reader = new FileReader();
                 reader.onload = (ev) => {
                    const res = ev.target?.result as string;
                    const matches = res.match(/^data:(.+);base64,(.+)$/);
                    if (matches) resolve({ mimeType: matches[1], data: matches[2] });
                    else reject();
                 };
                 reader.readAsDataURL(file);
             });

             const results = await Promise.all(validFiles.map(processFile));
             
             if (target === 'smart') {
                 setParams(prev => ({
                     ...prev,
                     smartAssets: [...(prev.smartAssets || []), ...results.map(r => ({
                         id: crypto.randomUUID(),
                         data: r.data,
                         mimeType: r.mimeType,
                         type: 'STRUCTURE' as const // Default to Structure
                     }))]
                 }));
             }
             else if (target === 'videoStyle') setParams(prev => ({ ...prev, videoStyleReferences: [...(prev.videoStyleReferences || []), ...results].slice(0, 3) }));
             else if (target === 'videoStart' && results[0]) setParams(prev => ({ ...prev, videoStartImage: results[0].data, videoStartImageMimeType: results[0].mimeType }));
             else if (target === 'videoEnd' && results[0]) setParams(prev => ({ ...prev, videoEndImage: results[0].data, videoEndImageMimeType: results[0].mimeType }));
          }
       }
    } catch (error) {
       console.error("Drop failed", error);
    }
  };

  const renderRatioVisual = (ratio: AspectRatio) => {
    let width = 16, height = 16;
    const enumKey = Object.keys(AspectRatio).find(k => AspectRatio[k as keyof typeof AspectRatio] === ratio) as string;
    const label = t(`ratio.${enumKey}` as any) || ratio;

    switch(ratio) {
      case AspectRatio.SQUARE: width = 16; height = 16; break;
      case AspectRatio.LANDSCAPE: width = 24; height = 14; break;
      case AspectRatio.PORTRAIT: width = 14; height = 24; break;
      case AspectRatio.FOUR_THIRDS: width = 20; height = 15; break;
      case AspectRatio.THREE_FOURTHS: width = 15; height = 20; break;
    }
    const isSelected = params.aspectRatio === ratio;
    return (
      <button
        key={ratio}
        onClick={() => handleRatioChange(ratio)}
        className={`relative flex flex-col items-center justify-center p-2 rounded-lg border transition-all gap-2 group h-20 ${
          isSelected ? 'border-brand-500 bg-brand-500/10' : 'border-dark-border bg-dark-surface hover:bg-white/5 hover:border-gray-500'
        }`}
        title={label}
      >
        <div className={`border-2 rounded-sm transition-colors ${isSelected ? 'border-brand-400 bg-brand-400/20' : 'border-gray-500 bg-gray-500/10 group-hover:border-gray-400'}`} style={{ width: `${width}px`, height: `${height}px` }} />
        <span className={`text-[10px] font-medium text-center ${isSelected ? 'text-brand-400' : 'text-gray-500 group-hover:text-gray-300'}`}>{label}</span>
      </button>
    );
  };
  
  const isVideoGenerating = mode === AppMode.VIDEO && isGenerating;
  const isCoolingDown = cooldownRemaining > 0;
  
  const isBtnDisabled = (activeTab === 'studio' 
    ? !params.prompt.trim() 
    : (chatHistory.length === 0 || isAnalyzing)) || isVideoGenerating || isCoolingDown;

  const displayedRatios = mode === AppMode.VIDEO 
    ? [AspectRatio.LANDSCAPE, AspectRatio.PORTRAIT]
    : Object.values(AspectRatio);
  
  const isVeoHQ = params.videoModel === VideoModel.VEO_HQ;
  const isVideoExtension = !!params.inputVideoData;

  const handleVideoTabSwitch = (tab: 'keyframes' | 'style') => {
      setActiveVideoTab(tab);
      if (tab === 'keyframes') {
          setParams(prev => ({ ...prev, videoStyleReferences: [] }));
      } else {
          setParams(prev => ({ ...prev, videoStartImage: undefined, videoStartImageMimeType: undefined, videoEndImage: undefined, videoEndImageMimeType: undefined }));
      }
  };

  const cancelVideoExtension = () => {
      setParams(prev => ({ ...prev, inputVideoData: undefined, inputVideoMimeType: undefined }));
  };

  const getAssetTypeIcon = (type: string) => {
      switch(type) {
          case 'IDENTITY': return <ScanFace size={12} className="text-brand-400"/>;
          case 'STRUCTURE': return <Layout size={12} className="text-blue-400"/>;
          case 'STYLE': return <Palette size={12} className="text-purple-400"/>;
          default: return <Briefcase size={12}/>;
      }
  };

  const getTypeDescription = (type: string) => {
      switch (type) {
          case 'IDENTITY': return t('desc.identity' as any);
          case 'STRUCTURE': return t('desc.structure' as any);
          case 'STYLE': return t('desc.style' as any);
          default: return '';
      }
  };

  const getPresetTags = (type: string) => {
      switch (type) {
          case 'IDENTITY': return ['tag.person', 'tag.face', 'tag.product', 'tag.clothing', 'tag.background'];
          case 'STRUCTURE': return ['tag.layout', 'tag.pose', 'tag.depth', 'tag.sketch'];
          case 'STYLE': return ['tag.artstyle', 'tag.color', 'tag.lighting', 'tag.texture'];
          default: return [];
      }
  };

  return (
    <div className="w-[400px] flex-shrink-0 flex flex-col border-r border-dark-border bg-dark-panel z-20 h-full">
      <div className="h-16 flex items-center px-4 border-b border-dark-border gap-2 shrink-0 justify-between">
         <h2 className="text-xl font-bold text-brand-500 mr-4">
           {mode === AppMode.VIDEO ? t('nav.video') : t('nav.image')}
         </h2>
         {isGenerating && (
           <div className="flex items-center gap-1.5 px-2 py-1 bg-brand-500/10 rounded-full border border-brand-500/20 animate-pulse">
             <div className="w-2 h-2 rounded-full border border-brand-400 border-t-transparent animate-spin"/>
             <span className="text-[10px] text-brand-400 font-mono">{formatTime(elapsedSeconds)}</span>
           </div>
         )}
         {isCoolingDown && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/10 rounded-full border border-yellow-500/20">
               <Clock size={10} className="text-yellow-500" />
               <span className="text-[10px] text-yellow-500 font-mono">Cooldown {cooldownRemaining}s</span>
            </div>
         )}
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
             params={params}
             setParams={setParams}
             mode={mode}
             onToolCall={onToolCall}
             projectContextSummary={projectContextSummary}
             projectSummaryCursor={projectSummaryCursor}
             onUpdateProjectContext={onUpdateProjectContext}
          />
        </div>
        {/* ... Rest of Studio Tab ... */}
        
        <div className={`absolute inset-0 overflow-y-auto p-6 space-y-6 custom-scrollbar ${activeTab === 'studio' ? 'z-10 opacity-100 pointer-events-auto' : 'z-0 opacity-0 pointer-events-none'}`}>
          {/* Model Selection */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('lbl.model')}</label>
            <div className="relative">
              {mode === AppMode.IMAGE ? (
                <select value={params.imageModel} onChange={(e) => setParams(prev => ({...prev, imageModel: e.target.value as ImageModel}))} className="w-full bg-dark-surface border border-dark-border rounded-xl px-4 py-3 text-sm text-white appearance-none focus:border-brand-500 focus:outline-none transition-colors">
                  <option value={ImageModel.FLASH}>{t('model.flash')}</option>
                  <option value={ImageModel.PRO}>{t('model.pro')}</option>
                </select>
              ) : (
                <select value={params.videoModel} onChange={(e) => setParams(prev => ({...prev, videoModel: e.target.value as VideoModel}))} className="w-full bg-dark-surface border border-dark-border rounded-xl px-4 py-3 text-sm text-white appearance-none focus:border-brand-500 focus:outline-none transition-colors">
                  <option value={VideoModel.VEO_FAST}>{t('model.veo_fast')}</option>
                  <option value={VideoModel.VEO_HQ}>{t('model.veo_hq')}</option>
                </select>
              )}
              <Settings2 className="absolute right-3 top-3.5 text-gray-500 pointer-events-none" size={16} />
            </div>
            
            {/* Search Grounding Toggle */}
            {mode === AppMode.IMAGE && params.imageModel === ImageModel.PRO && (
               <div className="flex flex-col gap-2 p-3 bg-dark-surface border border-dark-border rounded-xl animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col flex-1 min-w-0">
                          <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5 cursor-pointer select-none" onClick={() => setParams(prev => ({...prev, useGrounding: !prev.useGrounding}))}>
                              <Search size={12} className={params.useGrounding ? "text-brand-400" : "text-gray-500"} />
                              {t('lbl.use_search')}
                          </label>
                          <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{t('help.search_desc')}</p>
                      </div>
                      <button 
                           onClick={() => setParams(prev => ({...prev, useGrounding: !prev.useGrounding}))}
                           className={`w-9 h-5 rounded-full transition-colors relative flex items-center shrink-0 ${params.useGrounding ? 'bg-brand-500' : 'bg-gray-700'}`}
                      >
                           <div className={`w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-all absolute ${params.useGrounding ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                      </button>
                  </div>
                  
                  {params.useGrounding && (
                      <div className="mt-1 border-t border-dark-border pt-2">
                          <button 
                            onClick={() => setIsWarningExpanded(!isWarningExpanded)}
                            className="flex items-center gap-1.5 w-full text-left group"
                          >
                              <AlertTriangle size={10} className="text-yellow-500 shrink-0" />
                              <span className="text-[10px] font-medium text-yellow-500/90 group-hover:text-yellow-500 transition-colors flex-1">
                                  {t('warn.cost_title')}
                              </span>
                              {isWarningExpanded ? <ChevronUp size={10} className="text-gray-500"/> : <ChevronDown size={10} className="text-gray-500"/>}
                          </button>
                          
                          {isWarningExpanded && (
                              <p className="text-[10px] text-gray-400 leading-relaxed mt-1.5 pl-4 animate-in slide-in-from-top-1 fade-in">
                                  {t('warn.search_cost')}
                              </p>
                          )}
                      </div>
                  )}
               </div>
            )}
          </div>

          {/* Prompt & Inputs */}
          <div className="space-y-3">
            <PromptBuilder onAppend={handleAppendTag} mode={mode} />
            
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('lbl.prompt')}</label>
              <div className="flex gap-2 relative">
                 {/* Video Templates Dropdown */}
                 {mode === AppMode.VIDEO && (
                     <div className="relative template-dropdown">
                        <button 
                            onClick={() => setShowTemplates(!showTemplates)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg text-[10px] font-medium transition-colors border border-white/10"
                        >
                            <BookTemplate size={12} />
                            {t('tmpl.select')}
                        </button>
                        {showTemplates && (
                            <div className="absolute top-full right-0 mt-2 w-64 bg-dark-surface border border-dark-border rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                                <div className="p-2 text-[10px] font-bold text-gray-500 uppercase border-b border-dark-border">
                                    {t('tmpl.select')}
                                </div>
                                <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                    {VIDEO_TEMPLATES.map((tmpl, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => applyTemplate(tmpl.text)}
                                            className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-white/10 hover:text-white transition-colors border-b border-dark-border/30 last:border-0"
                                        >
                                            <div className="font-bold mb-0.5 text-brand-400">{tmpl.label}</div>
                                            <div className="text-[10px] text-gray-500 line-clamp-2 leading-tight">{tmpl.text}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                     </div>
                 )}

                 {params.smartAssets?.find(a => a.type === 'STRUCTURE') && (
                    <button onClick={handleDescribeImage} disabled={isDescribing} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-lg text-[10px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-indigo-500/20">
                      {isDescribing ? <div className="w-3 h-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin"/> : <Eye size={12} />}
                      {isDescribing ? 'Analyzing...' : t('btn.describe')}
                    </button>
                 )}
                 <button onClick={handleOptimizePrompt} disabled={isOptimizing || !params.prompt.trim()} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 rounded-lg text-[10px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-brand-500/20">
                   {isOptimizing ? <div className="w-3 h-3 rounded-full border-2 border-brand-400 border-t-transparent animate-spin"/> : <Sparkles size={12} />}
                   {isOptimizing ? 'Enhancing...' : t('btn.magic_enhance')}
                 </button>
              </div>
            </div>
            
            <textarea 
                value={params.prompt} 
                onChange={(e) => setParams(prev => ({...prev, prompt: e.target.value}))} 
                placeholder={mode === AppMode.IMAGE ? t('ph.prompt.image') : t('ph.prompt.video')} 
                className="w-full h-32 bg-dark-surface border border-dark-border rounded-xl p-4 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none resize-none transition-colors" 
            />
          </div>

          {/* ADVANCED SETTINGS (Collapsible) */}
          <div className="border border-dark-border rounded-xl overflow-hidden bg-dark-surface/30">
            <button 
                onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                className="w-full flex items-center justify-between p-3 text-xs font-bold text-gray-400 uppercase tracking-wider hover:bg-white/5 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <SlidersHorizontal size={14} />
                    {t('lbl.advanced')}
                </div>
                {isAdvancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            
            {isAdvancedOpen && (
                <div className="p-3 pt-0 space-y-4 animate-in slide-in-from-top-2">
                    {/* Negative Prompt */}
                    <div className="space-y-2">
                       <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('lbl.negative_prompt')}</label>
                       <textarea 
                         value={params.negativePrompt || ''}
                         onChange={(e) => setParams(prev => ({...prev, negativePrompt: e.target.value}))}
                         placeholder={t('ph.negative')}
                         className="w-full h-20 bg-dark-surface border border-dark-border rounded-lg p-3 text-xs text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none resize-none"
                       />
                    </div>

                    {/* Seed (Image Mode Only) */}
                    {mode === AppMode.IMAGE && (
                        <div className="space-y-2">
                           <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('lbl.seed')}</label>
                           <div className="flex gap-2">
                              <div className="relative flex-1">
                                 <input 
                                   type="number" 
                                   value={params.seed !== undefined ? params.seed : ''}
                                   onChange={(e) => setParams(prev => ({...prev, seed: e.target.value ? parseInt(e.target.value) : undefined}))}
                                   placeholder={t('ph.seed_random')}
                                   className="w-full bg-dark-surface border border-dark-border rounded-lg pl-3 pr-10 py-2 text-xs text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                 />
                                 {params.seed !== undefined && (
                                    <button onClick={handleRandomizeSeed} className="absolute right-2 top-2 text-gray-500 hover:text-white">
                                       <X size={14} />
                                    </button>
                                 )}
                              </div>
                              <button onClick={handleLockSeed} className={`p-2 rounded-lg border transition-colors ${params.seed !== undefined ? 'bg-brand-500/20 border-brand-500 text-brand-400' : 'bg-dark-surface border-dark-border text-gray-400 hover:text-white'}`} title="Randomize / Lock Seed">
                                 {params.seed !== undefined ? <Lock size={18} /> : <Dice5 size={18} />}
                              </button>
                           </div>
                           <p className="text-[10px] text-gray-500">{t('help.seed_desc')}</p>
                        </div>
                    )}
                </div>
            )}
          </div>

          {/* SMART ASSETS (UNIFIED VISUAL CONTROL) - IMAGE MODE ONLY */}
          {mode === AppMode.IMAGE && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-5">
               <div className="flex items-center gap-2 mb-2">
                  <div className="h-px bg-white/10 flex-1" />
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{t('lbl.smart_assets')}</span>
                  <div className="h-px bg-white/10 flex-1" />
               </div>
               
               <p className="text-[10px] text-gray-500">{t('help.smart_assets')}</p>

               {/* Asset List */}
               <div className="space-y-2">
                   {params.smartAssets?.map((asset, index) => (
                       <div key={asset.id} className="bg-dark-surface border border-dark-border rounded-lg p-2 flex gap-3 items-start animate-in fade-in slide-in-from-right-2">
                           {/* Thumbnail */}
                           <div className="relative w-16 h-16 shrink-0 rounded-md overflow-hidden bg-black border border-dark-border group">
                               <img src={`data:${asset.mimeType};base64,${asset.data}`} alt="Asset" className="w-full h-full object-cover" />
                               {asset.isAnnotated && (
                                   <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                                       <Brush size={12} className="text-red-500" />
                                   </div>
                               )}
                           </div>
                           
                           {/* Controls */}
                           <div className="flex-1 min-w-0 flex flex-col gap-2">
                               <div className="flex items-center justify-between gap-2">
                                   <div className="flex-1">
                                       <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 block">{t('lbl.asset_type')}</label>
                                       <div className="relative">
                                           <select 
                                               value={asset.type}
                                               onChange={(e) => updateSmartAsset(asset.id, { type: e.target.value as any })}
                                               className="w-full bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-[10px] text-white appearance-none focus:border-brand-500 outline-none"
                                           >
                                               <option value="STRUCTURE">{t('type.structure')}</option>
                                               <option value="IDENTITY">{t('type.identity')}</option>
                                               <option value="STYLE">{t('type.style')}</option>
                                           </select>
                                           <div className="absolute right-2 top-1.5 pointer-events-none">
                                               {getAssetTypeIcon(asset.type)}
                                           </div>
                                       </div>
                                       {/* Type Description */}
                                       <p className="text-[10px] text-gray-500 mt-1 leading-tight">
                                           {getTypeDescription(asset.type)}
                                       </p>
                                   </div>
                                   <button 
                                       onClick={() => removeSmartAsset(asset.id)}
                                       className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors self-start"
                                       title="Remove Asset"
                                   >
                                       <X size={14} />
                                   </button>
                               </div>
                               
                               <div>
                                   <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 block">{t('lbl.asset_label')}</label>
                                   
                                   {/* Preset Label Chips (Multi-Select) */}
                                   <div className="flex flex-wrap gap-1.5 mb-2">
                                       {getPresetTags(asset.type).map(tagKey => {
                                           const isSelected = asset.selectedTags?.includes(tagKey);
                                           return (
                                               <button
                                                   key={tagKey}
                                                   onClick={() => toggleSmartAssetTag(asset.id, tagKey)}
                                                   className={`px-2 py-0.5 rounded text-[9px] border transition-colors ${
                                                       isSelected 
                                                       ? 'bg-brand-500 text-white border-brand-500' 
                                                       : 'bg-dark-bg text-gray-400 border-dark-border hover:text-white hover:border-gray-500'
                                                   }`}
                                               >
                                                   {t(tagKey as any)}
                                               </button>
                                           );
                                       })}
                                   </div>

                                   {/* Custom Input */}
                                   <input 
                                       type="text"
                                       value={asset.label || ''}
                                       onChange={(e) => updateSmartAsset(asset.id, { label: e.target.value })}
                                       placeholder={t('ph.label')} // "e.g. Jacket, Background"
                                       className="w-full bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-[10px] text-white placeholder-gray-600 focus:border-brand-500 outline-none"
                                   />
                               </div>
                           </div>
                       </div>
                   ))}
               </div>

               {/* Upload Area */}
               <div 
                  className={`w-full h-24 border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all ${dragTarget === 'smart' ? 'border-brand-500 bg-brand-500/10' : 'border-dark-border hover:border-brand-500 hover:bg-white/5'}`}
                  onClick={() => smartAssetInputRef.current?.click()}
                  onDragOver={(e) => handleDragOver(e, 'smart')}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, 'smart')}
               >
                  <Briefcase className="text-gray-500 mb-2" size={20} />
                  <span className="text-xs text-gray-400 font-medium">{t('help.upload')}</span>
                  <span className="text-[10px] text-gray-600 mt-1">Multi-file supported</span>
               </div>
               <input ref={smartAssetInputRef} type="file" multiple accept="image/png, image/jpeg, image/webp" className="hidden" onChange={(e) => handleUpload(e, 'smart')} />

               {/* Text Render */}
               <div className="space-y-3 pt-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                     <Type size={14} className="text-green-400" />
                     {t('lbl.text_render')}
                  </label>
                  <input 
                    type="text" 
                    value={params.textToRender || ''}
                    onChange={(e) => setParams(prev => ({...prev, textToRender: e.target.value}))}
                    placeholder={t('ph.text_render')}
                    className="w-full bg-dark-surface border border-dark-border rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
                  />
               </div>
            </div>
          )}

          {/* VIDEO SPECIFIC CONTROLS */}
          {mode === AppMode.VIDEO && (
             <div className="space-y-4 animate-in fade-in slide-in-from-bottom-5">
                <div className="flex items-center gap-2 mb-2">
                   <div className="h-px bg-white/10 flex-1" />
                   <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{t('lbl.video_controls')}</span>
                   <div className="h-px bg-white/10 flex-1" />
                </div>
                
                {/* VIDEO EXTENSION BANNER */}
                {isVideoExtension ? (
                   <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 relative overflow-hidden">
                       <div className="flex items-start gap-3">
                           <div className="p-2 bg-purple-500/20 rounded-lg shrink-0">
                               <Clapperboard size={20} className="text-purple-400" />
                           </div>
                           <div className="flex-1 min-w-0">
                               <h4 className="text-xs font-bold text-purple-200 uppercase mb-1">{t('lbl.video_extend')}</h4>
                               <p className="text-[10px] text-gray-400 leading-relaxed mb-2">
                                  You are extending an existing video. The model will generate the next 5-7 seconds based on your prompt.
                                </p>
                               <button 
                                 onClick={cancelVideoExtension}
                                 className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded border border-white/10 text-[10px] text-gray-300 transition-colors"
                               >
                                  <XCircle size={12} /> Cancel Extension
                               </button>
                           </div>
                       </div>
                   </div>
                ) : (
                    /* NORMAL VIDEO GENERATION */
                    <>
                        {/* Tab Switcher for Veo HQ */}
                        {isVeoHQ && (
                            <div className="flex bg-dark-bg p-1 rounded-lg border border-dark-border mb-3">
                                <button
                                    onClick={() => handleVideoTabSwitch('keyframes')}
                                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
                                        activeVideoTab === 'keyframes' ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30' : 'text-gray-500 hover:text-gray-300'
                                    }`}
                                >
                                    {t('lbl.video_keyframes')}
                                </button>
                                <button
                                    onClick={() => handleVideoTabSwitch('style')}
                                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
                                        activeVideoTab === 'style' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'text-gray-500 hover:text-gray-300'
                                    }`}
                                >
                                    {t('lbl.video_subject_ref')}
                                </button>
                            </div>
                        )}

                        {/* KEYFRAMES TAB */}
                        {(!isVeoHQ || activeVideoTab === 'keyframes') && (
                            <div className="space-y-3 animate-in fade-in slide-in-from-right-2">
                                <p className="text-[10px] text-gray-500">{t('help.video_frames')}</p>
                                <div className="grid grid-cols-2 gap-3">
                                   {/* Start Frame */}
                                   <div className="space-y-2">
                                      <label className="text-[10px] font-bold text-gray-400 uppercase">Start Frame</label>
                                      {params.videoStartImage ? (
                                         <div className="relative aspect-video rounded-lg overflow-hidden border border-dark-border group">
                                            <img src={`data:${params.videoStartImageMimeType};base64,${params.videoStartImage}`} className="w-full h-full object-cover" />
                                            <button onClick={() => removeImage('start')} className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100">
                                               <X size={12} />
                                            </button>
                                         </div>
                                      ) : (
                                         <div 
                                           className={`aspect-video border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer ${dragTarget === 'videoStart' ? 'border-brand-500 bg-brand-500/10' : 'border-dark-border hover:border-brand-500 hover:bg-white/5'}`}
                                           onClick={() => startFrameInputRef.current?.click()}
                                           onDragOver={(e) => handleDragOver(e, 'videoStart')}
                                           onDragLeave={handleDragLeave}
                                           onDrop={(e) => handleDrop(e, 'videoStart')}
                                         >
                                            <ArrowRight size={16} className="text-gray-500 mb-1" />
                                            <span className="text-[10px] text-gray-500">Start</span>
                                         </div>
                                      )}
                                      <input ref={startFrameInputRef} type="file" accept="image/png, image/jpeg, image/webp" className="hidden" onChange={(e) => handleUpload(e, 'start')} />
                                   </div>

                                   {/* End Frame */}
                                   <div className="space-y-2">
                                      <label className="text-[10px] font-bold text-gray-400 uppercase">End Frame</label>
                                      {params.videoEndImage ? (
                                         <div className="relative aspect-video rounded-lg overflow-hidden border border-dark-border group">
                                            <img src={`data:${params.videoEndImageMimeType};base64,${params.videoEndImage}`} className="w-full h-full object-cover" />
                                            <button onClick={() => removeImage('end')} className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100">
                                               <X size={12} />
                                            </button>
                                         </div>
                                      ) : (
                                         <div 
                                           className={`aspect-video border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer ${dragTarget === 'videoEnd' ? 'border-brand-500 bg-brand-500/10' : 'border-dark-border hover:border-brand-500 hover:bg-white/5'}`}
                                           onClick={() => endFrameInputRef.current?.click()}
                                           onDragOver={(e) => handleDragOver(e, 'videoEnd')}
                                           onDragLeave={handleDragLeave}
                                           onDrop={(e) => handleDrop(e, 'videoEnd')}
                                         >
                                            <Frame size={16} className="text-gray-500 mb-1" />
                                            <span className="text-[10px] text-gray-500">End</span>
                                         </div>
                                      )}
                                      <input ref={endFrameInputRef} type="file" accept="image/png, image/jpeg, image/webp" className="hidden" onChange={(e) => handleUpload(e, 'end')} />
                                   </div>
                                </div>
                            </div>
                        )}

                        {/* STYLE REF TAB (Veo HQ Only) */}
                        {isVeoHQ && activeVideoTab === 'style' && (
                             <div className="space-y-3 animate-in fade-in slide-in-from-right-2">
                                 <p className="text-[10px] text-gray-500">{t('help.video_subject_desc')}</p>
                                 
                                 <div className="grid grid-cols-3 gap-2">
                                     {params.videoStyleReferences?.map((ref, idx) => (
                                        <div key={idx} className="relative aspect-square rounded-lg border border-dark-border overflow-hidden group">
                                           <img src={`data:${ref.mimeType};base64,${ref.data}`} alt="ref" className="w-full h-full object-cover" />
                                           <button onClick={() => removeVideoStyleRef(idx)} className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                              <X size={12} />
                                           </button>
                                        </div>
                                     ))}
                                     {(params.videoStyleReferences?.length || 0) < 3 && (
                                        <div 
                                           className={`aspect-square border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors ${dragTarget === 'videoStyle' ? 'border-purple-500 bg-purple-500/10' : 'border-dark-border hover:border-purple-500 hover:bg-white/5'}`}
                                           onClick={() => videoStyleRefsInputRef.current?.click()}
                                           onDragOver={(e) => handleDragOver(e, 'videoStyle')}
                                           onDragLeave={handleDragLeave}
                                           onDrop={(e) => handleDrop(e, 'videoStyle')}
                                        >
                                           <ScanFace size={20} className="text-gray-500 mb-1" />
                                           <span className="text-[10px] text-gray-500 text-center">{t('help.upload')}</span>
                                        </div>
                                     )}
                                  </div>
                                  <input ref={videoStyleRefsInputRef} type="file" multiple accept="image/png, image/jpeg, image/webp" className="hidden" onChange={(e) => handleUpload(e, 'videoStyle')} />
                                  <div className="p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-[10px] text-yellow-500">
                                      {t('note.video_ref_limit')}
                                  </div>
                             </div>
                        )}
                    </>
                )}
             </div>
          )}

          {/* PRIMARY SETTINGS (Moved to Bottom) */}
          <div className="space-y-4 pt-4 border-t border-dark-border/30">
            {/* Aspect Ratio */}
            <div className="space-y-3">
               <div className="flex justify-between">
                   <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('lbl.aspect_ratio')}</label>
                   {(isVeoHQ && params.videoStyleReferences && params.videoStyleReferences.length > 0) && (
                       <span className="text-[10px] text-purple-400 flex items-center gap-1"><Lock size={8}/> {t('lbl.locked_subject')}</span>
                   )}
                   {isVideoExtension && (
                       <span className="text-[10px] text-purple-400 flex items-center gap-1"><Lock size={8}/> Locked (Extension)</span>
                   )}
               </div>
               <div className={`grid gap-2 ${mode === AppMode.VIDEO ? 'grid-cols-2' : 'grid-cols-5'} ${
                   (isVeoHQ && params.videoStyleReferences?.length) || isVideoExtension ? 'opacity-50 pointer-events-none' : ''
               }`}>
                  {displayedRatios.map(renderRatioVisual)}
               </div>
            </div>

            {/* Style Selector */}
            <div className="space-y-3">
               <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('lbl.style')}</label>
               <div className="relative">
                  <select 
                    value={mode === AppMode.IMAGE ? (params.imageStyle || ImageStyle.NONE) : (params.videoStyle || VideoStyle.NONE)}
                    onChange={(e) => setParams(prev => mode === AppMode.IMAGE ? ({...prev, imageStyle: e.target.value as ImageStyle}) : ({...prev, videoStyle: e.target.value as VideoStyle}))}
                    className="w-full bg-dark-surface border border-dark-border rounded-lg px-3 py-2 text-xs text-white appearance-none focus:border-brand-500 focus:outline-none transition-colors"
                  >
                     {mode === AppMode.IMAGE ? (
                        Object.entries(ImageStyle).map(([key, value]) => (
                           <option key={key} value={value}>{t(`style.${key}` as any) || value}</option>
                        ))
                     ) : (
                        Object.entries(VideoStyle).map(([key, value]) => (
                           <option key={key} value={value}>{t(`style.${key}` as any) || value}</option>
                        ))
                     )}
                  </select>
                  <Palette size={14} className="absolute right-3 top-2.5 text-gray-500 pointer-events-none" />
               </div>
            </div>

            {/* Resolution & Count */}
            <div className={`grid gap-4 ${mode === AppMode.IMAGE ? 'grid-cols-2' : 'grid-cols-1'}`}>
               <div className="space-y-2">
                  <div className="flex justify-between">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('lbl.resolution')}</label>
                      {(isVeoHQ && params.videoStyleReferences && params.videoStyleReferences.length > 0) && (
                           <span className="text-[10px] text-purple-400 flex items-center gap-1"><Lock size={8}/> Locked to 720p</span>
                       )}
                  </div>
                  <div className={`relative ${
                       (isVeoHQ && params.videoStyleReferences?.length) || isVideoExtension ? 'opacity-50 pointer-events-none' : ''
                  }`}>
                     <select 
                       value={mode === AppMode.IMAGE ? params.imageResolution : params.videoResolution}
                       onChange={(e) => setParams(prev => mode === AppMode.IMAGE ? ({...prev, imageResolution: e.target.value as ImageResolution}) : ({...prev, videoResolution: e.target.value as VideoResolution}))}
                       className="w-full bg-dark-surface border border-dark-border rounded-lg px-3 py-2 text-xs text-white appearance-none focus:border-brand-500 focus:outline-none"
                     >
                        {mode === AppMode.IMAGE ? (
                           <>
                             <option value={ImageResolution.RES_1K}>1K (Standard)</option>
                             <option value={ImageResolution.RES_2K} disabled={params.imageModel === ImageModel.FLASH}>2K (Pro Only)</option>
                             <option value={ImageResolution.RES_4K} disabled={params.imageModel === ImageModel.FLASH}>4K (Pro Only)</option>
                           </>
                        ) : (
                           <>
                             <option value={VideoResolution.RES_720P}>720p HD</option>
                             <option value={VideoResolution.RES_1080P}>1080p FHD</option>
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
                        {[1, 2, 3, 4].map(num => (
                           <button
                             key={num}
                             onClick={() => setParams(prev => ({ ...prev, numberOfImages: num }))}
                             className={`py-2 rounded-lg border text-xs font-medium transition-all ${
                               (params.numberOfImages || 1) === num 
                                  ? 'border-brand-500 bg-brand-500/20 text-brand-400' 
                                  : 'border-dark-border bg-dark-surface text-gray-500 hover:border-gray-500'
                             }`}
                           >
                             {num}
                           </button>
                        ))}
                     </div>
                  </div>
               )}
            </div>
          </div>
          
          <div className="pb-6" />
        </div>
      </div>
      
      {/* Footer Button - Fixed at Bottom - Only show in Studio Tab */}
      {activeTab === 'studio' && (
        <div className="p-4 bg-dark-panel border-t border-dark-border z-20 shrink-0">
            <button
              onClick={handleGenerateClick}
              disabled={isBtnDisabled}
              className={`w-full py-4 font-bold rounded-xl shadow-lg transition-all transform hover:-translate-y-0.5 flex flex-col items-center justify-center gap-1 ${
                isBtnDisabled
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed transform-none' 
                  : 'bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white shadow-brand-900/20'
              }`}
            >
              {isCoolingDown ? (
                <div className="flex items-center gap-2 text-yellow-400">
                    <Clock size={20} className="animate-pulse" />
                    <span>System Busy (Wait {cooldownRemaining}s)</span>
                </div>
              ) : isGenerating || isAnalyzing ? (
                <div className="flex items-center gap-2">
                  {isAnalyzing ? (
                      <>
                        <Sparkles size={20} className="animate-pulse" />
                        <span>{t('btn.analyzing')}</span>
                      </>
                  ) : (
                      mode === AppMode.VIDEO ? (
                        <>
                            <Loader2 size={20} className="animate-spin" />
                            <span>{t('nav.generating')}</span>
                        </>
                      ) : (
                        <>
                            <Layers size={20} className="animate-pulse" />
                            <span>{t('btn.queue')}</span>
                        </>
                      )
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {mode === AppMode.IMAGE ? <ImageIcon size={20} /> : <VideoIcon size={20} />}
                  <span>{params.inputVideoData ? t('btn.extend') : t('btn.generate')} {mode === AppMode.IMAGE ? (params.numberOfImages || 1) : ''}</span>
                </div>
              )}
              {!isCoolingDown && <span className="text-[10px] font-normal opacity-70">{t('msg.cost_warning')}</span>}
            </button>
        </div>
      )}
    </div>
  );
};