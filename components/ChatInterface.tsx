
import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Sparkles, ChevronDown, ChevronRight, BrainCircuit, Zap, X, SlidersHorizontal, ChevronUp, Copy, Check, Plus, Layers, Clock, MonitorPlay, Palette, Film, RefreshCw, Trash2, Bot, Square, Crop } from 'lucide-react';
import { ChatMessage, ChatModel, GenerationParams, ImageStyle, ImageResolution, AppMode, ImageModel, VideoResolution, VideoDuration, VideoModel, VideoStyle, AspectRatio } from '../types';
import { streamChatResponse } from '../services/geminiService';
import { useLanguage } from '../contexts/LanguageContext';
import ReactMarkdown from 'react-markdown';

interface ChatInterfaceProps {
  history: ChatMessage[];
  setHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onApplyPrompt: (prompt: string) => void;
  selectedImages: string[];
  setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>;
  projectId: string;
  params: GenerationParams;
  setParams: React.Dispatch<React.SetStateAction<GenerationParams>>;
  mode: AppMode;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  history, 
  setHistory, 
  selectedImages, 
  setSelectedImages,
  projectId,
  params,
  setParams,
  mode
}) => {
  const { t } = useLanguage();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ChatModel>(ChatModel.GEMINI_3_PRO_FAST);
  
  // Popover States
  const [showSettings, setShowSettings] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  
  // Track the current project ID to prevent cross-posting when switching projects
  const projectIdRef = useRef(projectId);
  // Track abort controller
  const abortControllerRef = useRef<AbortController | null>(null);

  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

  const getRatioLabel = (r: AspectRatio) => {
    // Dynamically lookup translation for ratio enum key
    const enumKey = Object.keys(AspectRatio).find(k => AspectRatio[k as keyof typeof AspectRatio] === r);
    return t(`ratio.${enumKey}` as any) || r;
  };

  // Update ref when prop changes and reset local state
  useEffect(() => {
    projectIdRef.current = projectId;
    setIsLoading(false);
    setInput('');
    setShowSettings(false);
    setShowModelSelector(false);
  }, [projectId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, isLoading, selectedImages.length]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      // Max height increased to approx 160px (approx 6-7 lines)
      const maxHeight = 160; 
      const newHeight = Math.min(inputRef.current.scrollHeight, maxHeight);
      inputRef.current.style.height = `${newHeight}px`;
      
      // Toggle overflow based on whether we hit the max height
      inputRef.current.style.overflowY = inputRef.current.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  }, [input]);

  // Click outside to close popovers
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.settings-popover') && !target.closest('.settings-trigger')) {
        setShowSettings(false);
      }
      if (!target.closest('.model-popover') && !target.closest('.model-trigger')) {
        setShowModelSelector(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const processFiles = async (files: File[]) => {
    // Validate size
    for (let i = 0; i < files.length; i++) {
        if (files[i].size > MAX_FILE_SIZE) {
            alert(`File ${files[i].name} is too large. Please upload an image under 20MB.`);
            return;
        }
    }

    const readers: Promise<string>[] = [];
    files.forEach(file => {
        readers.push(new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target?.result as string);
            reader.readAsDataURL(file);
        }));
    });

    try {
        const results = await Promise.all(readers);
        setSelectedImages(prev => [...prev, ...results]);
    } catch (error) {
        console.error("Error reading files", error);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    await processFiles(Array.from(files));
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const files: File[] = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      await processFiles(files);
    }
  };

  const removeSelectedImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    
    // Force mark last message as done thinking
    setHistory(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last.role === 'model' && last.isThinking) {
        updated[updated.length - 1] = { ...last, isThinking: false };
      }
      return updated;
    });
  };

  const handleSend = async () => {
    if ((!input.trim() && selectedImages.length === 0) || isLoading) return;

    const sendingProjectId = projectId;
    const userMsg: ChatMessage = { 
      role: 'user', 
      content: input.trim(), 
      timestamp: Date.now(),
      images: selectedImages.length > 0 ? [...selectedImages] : undefined
    };

    const newHistory = [...history, userMsg];
    setHistory(newHistory);
    setInput('');
    if (inputRef.current) {
        inputRef.current.style.height = 'auto'; // Reset height immediately
    }
    setSelectedImages([]);
    setIsLoading(true);
    
    // Setup AbortController
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const tempAiMsg: ChatMessage = { role: 'model', content: '', timestamp: Date.now(), isThinking: true };
      setHistory(prev => [...prev, tempAiMsg]);

      await streamChatResponse(newHistory, userMsg.content, (chunkText) => {
         if (projectIdRef.current !== sendingProjectId) return;

         setHistory(prev => {
           const updated = [...prev];
           // Keep isThinking TRUE during streaming to ensure UI knows we are active
           updated[updated.length - 1] = { 
             ...updated[updated.length - 1], 
             content: chunkText
             // do NOT set isThinking: false here
           };
           return updated;
         });
      }, selectedModel, mode, abortController.signal);
    } catch (error: any) {
       if (error.message === 'Cancelled' || error.name === 'AbortError') {
         console.log('Chat generation stopped by user');
       } else {
         console.error("Chat Error:", error);
       }
    } finally {
      if (projectIdRef.current === sendingProjectId) {
        setIsLoading(false);
        abortControllerRef.current = null;
        // Mark last message as done thinking ONLY at the very end
        setHistory(prev => {
             const updated = [...prev];
             const last = updated[updated.length - 1];
             if (last.role === 'model') {
                 updated[updated.length - 1] = { ...last, isThinking: false };
             }
             return updated;
        });
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-dark-panel relative min-h-0">
      {/* Chat History */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 min-h-0 scroll-smooth" ref={scrollRef}>
        {history.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-500 opacity-60">
             <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${mode === AppMode.VIDEO ? 'bg-purple-900/20 text-purple-400' : 'bg-brand-900/20 text-brand-400'}`}>
                {mode === AppMode.VIDEO ? <Film size={32} /> : <Sparkles size={32} />}
             </div>
             <p className="text-lg font-medium text-gray-300">
               {mode === AppMode.VIDEO ? t('chat.welcome_video') : t('chat.welcome_image')}
             </p>
             <p className="text-sm mt-2 max-w-xs">
               {mode === AppMode.VIDEO 
                 ? t('chat.desc_video')
                 : t('chat.desc_image')
               }
             </p>
          </div>
        ) : (
          history.map((msg, idx) => (
            <ChatBubble key={idx} message={msg} />
          ))
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-dark-panel border-t border-dark-border z-20">
        <div className="flex flex-col gap-2">
           {/* Selected Images Preview */}
           {selectedImages.length > 0 && (
             <div className="flex gap-2 overflow-x-auto pb-2">
               {selectedImages.map((img, idx) => (
                 <div key={idx} className="relative w-16 h-16 shrink-0 group">
                   <img src={img} alt="upload" className="w-full h-full object-cover rounded-lg border border-dark-border" />
                   <button 
                     onClick={() => removeSelectedImage(idx)}
                     className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                   >
                     <X size={12} />
                   </button>
                 </div>
               ))}
             </div>
           )}

           {/* Modern Stacked Input */}
           <div className="flex flex-col bg-dark-surface border border-dark-border rounded-2xl p-3 shadow-inner transition-colors relative gap-2">
              
              {/* Top: Text Area */}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={t('chat.placeholder')}
                className="w-full bg-transparent border-0 focus:ring-0 text-sm text-gray-200 placeholder-gray-500 resize-none overflow-hidden px-1 py-1 leading-relaxed"
                rows={1}
                style={{ minHeight: '32px' }}
              />
              
              {/* Bottom: Toolbar */}
              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                 
                 {/* Left Actions: Upload & Settings */}
                 <div className="flex items-center gap-1">
                     <button 
                       onClick={() => fileInputRef.current?.click()}
                       className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                       title={t('chat.upload')}
                     >
                       <Plus size={20} />
                     </button>
                     
                     {/* Tools Button - Hidden in Video Mode */}
                     {mode !== AppMode.VIDEO && (
                        <div className="relative">
                          <button 
                            className="settings-trigger p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors flex items-center gap-1.5"
                            onClick={() => setShowSettings(!showSettings)}
                            title="Generation Settings"
                          >
                            <SlidersHorizontal size={18} />
                            <span className="text-xs font-medium">{t('chat.tools')}</span>
                          </button>
                          
                          {/* Settings Popover */}
                          {showSettings && (
                            <div className="settings-popover absolute bottom-12 left-0 w-64 bg-dark-surface border border-dark-border rounded-xl shadow-xl p-4 z-50 animate-in slide-in-from-bottom-2 fade-in">
                                <div className="flex items-center justify-between mb-3 pb-2 border-b border-dark-border">
                                  <span className="text-xs font-bold text-gray-400 uppercase">{t('nav.settings')}</span>
                                  <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-white"><X size={14}/></button>
                                </div>
                                
                                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                                  {/* Model Selection */}
                                  <div className="space-y-1.5">
                                      <label className="text-[10px] text-gray-400 font-bold flex items-center gap-1"><Bot size={10} /> {t('lbl.model').toUpperCase()}</label>
                                      <select 
                                        value={mode === AppMode.IMAGE ? params.imageModel : params.videoModel}
                                        onChange={(e) => setParams(prev => mode === AppMode.IMAGE ? ({...prev, imageModel: e.target.value as ImageModel}) : ({...prev, videoModel: e.target.value as VideoModel}))}
                                        className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs text-white"
                                      >
                                        {mode === AppMode.IMAGE ? (
                                          <>
                                            <option value={ImageModel.FLASH}>{t('model.flash')}</option>
                                            <option value={ImageModel.PRO}>{t('model.pro')}</option>
                                          </>
                                        ) : (
                                          <>
                                            <option value={VideoModel.VEO_FAST}>{t('model.veo_fast')}</option>
                                            <option value={VideoModel.VEO_HQ}>{t('model.veo_hq')}</option>
                                          </>
                                        )}
                                      </select>
                                  </div>

                                  {/* Aspect Ratio */}
                                  <div className="space-y-1.5">
                                      <label className="text-[10px] text-gray-400 font-bold flex items-center gap-1"><Crop size={10} /> {t('lbl.aspect_ratio').toUpperCase()}</label>
                                      <select 
                                        value={params.aspectRatio}
                                        onChange={(e) => setParams(prev => ({...prev, aspectRatio: e.target.value as AspectRatio}))}
                                        className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs text-white"
                                      >
                                        {Object.values(AspectRatio).map(ratio => (
                                          <option key={ratio} value={ratio}>{getRatioLabel(ratio)}</option>
                                        ))}
                                      </select>
                                  </div>

                                  {/* Style */}
                                  <div className="space-y-1.5">
                                      <label className="text-[10px] text-gray-400 font-bold flex items-center gap-1"><Palette size={10} /> {t('lbl.style').toUpperCase()}</label>
                                      <select 
                                        value={mode === AppMode.IMAGE ? params.imageStyle : params.videoStyle}
                                        onChange={(e) => setParams(prev => mode === AppMode.IMAGE ? ({...prev, imageStyle: e.target.value as ImageStyle}) : ({...prev, videoStyle: e.target.value as VideoStyle}))}
                                        className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs text-white"
                                      >
                                        {mode === AppMode.IMAGE 
                                          ? Object.entries(ImageStyle).map(([k, v]) => <option key={k} value={v}>{t(`style.${k}` as any) || v}</option>)
                                          : Object.entries(VideoStyle).map(([k, v]) => <option key={k} value={v}>{t(`style.${k}` as any) || v}</option>)
                                        }
                                      </select>
                                  </div>

                                  {/* Resolution */}
                                  <div className="space-y-1.5">
                                      <label className="text-[10px] text-gray-400 font-bold flex items-center gap-1"><MonitorPlay size={10} /> {t('lbl.resolution').toUpperCase()}</label>
                                      <select 
                                        value={mode === AppMode.IMAGE ? params.imageResolution : params.videoResolution}
                                        onChange={(e) => setParams(prev => mode === AppMode.IMAGE ? ({...prev, imageResolution: e.target.value as ImageResolution}) : ({...prev, videoResolution: e.target.value as VideoResolution}))}
                                        className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs text-white"
                                      >
                                        {mode === AppMode.IMAGE ? (
                                          <>
                                            <option value={ImageResolution.RES_1K}>1K</option>
                                            <option value={ImageResolution.RES_2K}>2K (Pro)</option>
                                            <option value={ImageResolution.RES_4K}>4K (Pro)</option>
                                          </>
                                        ) : (
                                          <>
                                            <option value={VideoResolution.RES_720P}>720p</option>
                                            <option value={VideoResolution.RES_1080P}>1080p</option>
                                          </>
                                        )}
                                      </select>
                                  </div>

                                  {/* Count / Duration */}
                                  <div className="space-y-1.5">
                                      <label className="text-[10px] text-gray-400 font-bold flex items-center gap-1">
                                        {mode === AppMode.IMAGE ? <Layers size={10} /> : <Clock size={10} />}
                                        {mode === AppMode.IMAGE ? t('lbl.count').toUpperCase() : t('lbl.duration').toUpperCase()}
                                      </label>
                                      {mode === AppMode.IMAGE ? (
                                        <div className="grid grid-cols-4 gap-1">
                                          {[1, 2, 3, 4].map(num => (
                                            <button
                                              key={num}
                                              onClick={() => setParams(prev => ({ ...prev, numberOfImages: num }))}
                                              className={`py-1 rounded border text-xs font-medium transition-all ${
                                                (params.numberOfImages || 1) === num 
                                                    ? 'border-brand-500 bg-brand-500/20 text-brand-400' 
                                                    : 'border-dark-border bg-dark-bg text-gray-500 hover:border-gray-500'
                                              }`}
                                            >
                                              {num}
                                            </button>
                                          ))}
                                        </div>
                                      ) : (
                                        <select 
                                          value={params.videoDuration}
                                          onChange={(e) => setParams(prev => ({...prev, videoDuration: e.target.value as VideoDuration}))}
                                          className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs text-white"
                                        >
                                          <option value={VideoDuration.SHORT}>5s</option>
                                          <option value={VideoDuration.LONG}>10s (Pro)</option>
                                        </select>
                                      )}
                                  </div>
                                </div>
                            </div>
                          )}
                        </div>
                     )}
                 </div>

                 {/* Right Actions: Model & Send */}
                 <div className="flex items-center gap-3">
                     <div className="relative">
                       <button 
                          className="model-trigger flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
                          onClick={() => setShowModelSelector(!showModelSelector)}
                       >
                         {selectedModel === ChatModel.GEMINI_3_PRO_FAST ? 'Flash' : 'Thinking'}
                         <ChevronDown size={14} />
                       </button>

                       {/* Model Popover */}
                       {showModelSelector && (
                          <div className="model-popover absolute bottom-12 right-0 w-56 bg-dark-surface border border-dark-border rounded-xl shadow-xl p-1 z-50 animate-in slide-in-from-bottom-2 fade-in">
                             <button 
                               onClick={() => { setSelectedModel(ChatModel.GEMINI_3_PRO_FAST); setShowModelSelector(false); }}
                               className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors ${selectedModel === ChatModel.GEMINI_3_PRO_FAST ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
                             >
                                <Zap size={16} className="text-yellow-400" />
                                <div>
                                   <div className="text-xs font-bold">Flash</div>
                                   <div className="text-[10px] opacity-70">Gemini 2.5 Flash</div>
                                </div>
                                {selectedModel === ChatModel.GEMINI_3_PRO_FAST && <Check size={14} className="ml-auto" />}
                             </button>
                             <button 
                               onClick={() => { setSelectedModel(ChatModel.GEMINI_3_PRO_REASONING); setShowModelSelector(false); }}
                               className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors ${selectedModel === ChatModel.GEMINI_3_PRO_REASONING ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
                             >
                                <BrainCircuit size={16} className="text-purple-400" />
                                <div>
                                   <div className="text-xs font-bold">Thinking</div>
                                   <div className="text-[10px] opacity-70">Gemini 3 Pro</div>
                                </div>
                                {selectedModel === ChatModel.GEMINI_3_PRO_REASONING && <Check size={14} className="ml-auto" />}
                             </button>
                          </div>
                       )}
                     </div>

                     {isLoading ? (
                       <button 
                         onClick={handleStop}
                         className="p-2.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500 text-red-400 rounded-xl shadow-lg transition-all"
                         title={t('chat.stop')}
                       >
                         <Square size={18} fill="currentColor" />
                       </button>
                     ) : (
                       <button 
                         onClick={handleSend}
                         disabled={(!input.trim() && selectedImages.length === 0)}
                         className="p-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                       >
                         <Send size={18} />
                       </button>
                     )}
                 </div>
              </div>
           </div>
        </div>
        <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*" onChange={handleFileSelect} />
      </div>
    </div>
  );
};

const ChatBubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const { t } = useLanguage();
  const isUser = message.role === 'user';
  const [isThoughtOpen, setIsThoughtOpen] = useState(true);
  const [isCopied, setIsCopied] = useState(false);

  // Auto-collapse when thinking finishes
  useEffect(() => {
    if (!message.isThinking && message.role === 'model') {
      setIsThoughtOpen(false);
    }
  }, [message.isThinking, message.role]);

  // Robust parsing of thoughts
  let thoughtContent = '';
  let finalContent = message.content;
  
  // Check for open thought tag first (streaming) - case insensitive and allowing spaces
  const openMatch = message.content.match(/<\s*thought\s*>([\s\S]*)/i);
  let hasThoughtTag = false;

  if (openMatch) {
     hasThoughtTag = true;
     // Check for closed tag
     const closedMatch = message.content.match(/<\s*thought\s*>([\s\S]*?)<\s*\/\s*thought\s*>/i);
     if (closedMatch) {
        // Complete thought block found
        thoughtContent = closedMatch[1].trim();
        finalContent = message.content.replace(/<\s*thought\s*>[\s\S]*?<\s*\/\s*thought\s*>/i, '').trim();
     } else {
        // Still open / streaming
        thoughtContent = openMatch[1].trim();
        // Allow showing text *before* the thought tag if any
        if (openMatch.index !== undefined && openMatch.index > 0) {
            finalContent = message.content.substring(0, openMatch.index).trim();
        } else {
            // Otherwise hide main content until thought is closed
            finalContent = ''; 
        }
     }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(finalContent);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };
  
  // Custom Markdown Components
  const MarkdownComponents = {
    p: ({children}: any) => <p className="mb-2 last:mb-0">{children}</p>,
    ul: ({children}: any) => <ul className="list-disc ml-4 mb-2 space-y-1">{children}</ul>,
    ol: ({children}: any) => <ol className="list-decimal ml-4 mb-2 space-y-1">{children}</ol>,
    li: ({children}: any) => <li>{children}</li>,
    h1: ({children}: any) => <h1 className="text-lg font-bold mb-2 mt-4 first:mt-0">{children}</h1>,
    h2: ({children}: any) => <h2 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h2>,
    h3: ({children}: any) => <h3 className="text-sm font-bold mb-1 mt-2">{children}</h3>,
    blockquote: ({children}: any) => <blockquote className="border-l-2 border-gray-500 pl-3 italic my-2 text-gray-400">{children}</blockquote>,
    strong: ({children}: any) => <strong className="font-bold text-white">{children}</strong>,
    code: ({node, inline, className, children, ...props}: any) => {
      return inline ? (
        <code className="bg-white/10 px-1.5 py-0.5 rounded font-mono text-xs text-brand-200" {...props}>{children}</code>
      ) : (
        <div className="bg-black/40 rounded-lg my-2 overflow-hidden border border-white/5">
           <div className="bg-white/5 px-3 py-1.5 border-b border-white/5 text-[10px] text-gray-500 font-mono flex items-center gap-2">
              <div className="flex gap-1">
                 <div className="w-2 h-2 rounded-full bg-red-500/50" />
                 <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
                 <div className="w-2 h-2 rounded-full bg-green-500/50" />
              </div>
              Code
           </div>
           <div className="p-3 overflow-x-auto">
              <code className="font-mono text-xs text-gray-300 block whitespace-pre" {...props}>{children}</code>
           </div>
        </div>
      )
    },
    a: ({href, children}: any) => <a href={href} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">{children}</a>
  };

  return (
    <div className={`flex gap-4 ${isUser ? 'flex-row-reverse' : ''} group`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-gray-700' : 'bg-brand-600'}`}>
        {isUser ? <User size={16} className="text-gray-300" /> : <Sparkles size={16} className="text-white" />}
      </div>
      
      <div className={`flex flex-col gap-2 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        
        {/* Images */}
        {message.images && message.images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-1">
             {message.images.map((img, i) => (
                <img key={i} src={img} alt="attachment" className="w-32 h-32 object-cover rounded-lg border border-dark-border" />
             ))}
          </div>
        )}
        {/* Legacy single image support */}
        {!message.images && message.image && (
           <img src={message.image} alt="attachment" className="w-48 rounded-lg border border-dark-border mb-1" />
        )}

        {/* Thought Accordion (Only for Model) - Show if thought text exists OR if we detected a tag (even if empty content) */}
        {!isUser && (thoughtContent || hasThoughtTag) && (
           <div className="w-full bg-dark-surface/50 border border-dark-border/50 rounded-lg overflow-hidden mb-1 animate-in fade-in slide-in-from-top-1">
              <button 
                onClick={() => setIsThoughtOpen(!isThoughtOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 bg-black/20"
              >
                 <BrainCircuit size={12} className={message.isThinking ? "animate-pulse text-brand-400" : ""} />
                 <span>{t('chat.thinking')}</span>
                 {isThoughtOpen ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
              </button>
              {isThoughtOpen && (
                 <div className="p-3 text-xs text-gray-500 font-mono border-t border-dark-border/30 whitespace-pre-wrap">
                    {thoughtContent || (message.isThinking ? "..." : "")}
                    {message.isThinking && <span className="inline-block w-1.5 h-3 ml-1 bg-brand-500 animate-pulse align-middle"/>}
                 </div>
              )}
           </div>
        )}

        {/* Text Bubble */}
        <div className={`relative px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
           isUser 
             ? 'bg-dark-surface text-gray-100 rounded-tr-none' 
             : 'bg-transparent border border-dark-border text-gray-200 rounded-tl-none'
        }`}>
           {/* Thinking Indicator: Only show if NO content (thought tag or final text) is visible yet */}
           {message.isThinking && !finalContent && !thoughtContent && !hasThoughtTag ? (
              <div className="flex gap-1 items-center h-5">
                 <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                 <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                 <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" />
              </div>
           ) : (
              <div className="markdown-content">
                {isUser ? (
                  <div className="whitespace-pre-wrap">{finalContent}</div>
                ) : (
                  <ReactMarkdown components={MarkdownComponents}>
                    {finalContent}
                  </ReactMarkdown>
                )}
              </div>
           )}

           {/* Copy Button (Group Hover) */}
           {!message.isThinking && finalContent && (
              <div className={`absolute -bottom-8 ${isUser ? 'right-0' : 'left-0'} opacity-0 group-hover:opacity-100 transition-opacity`}>
                 <button 
                   onClick={handleCopy}
                   className="flex items-center gap-1.5 px-2 py-1 bg-dark-surface border border-dark-border rounded-md text-[10px] text-gray-400 hover:text-white transition-colors shadow-lg"
                 >
                    {isCopied ? <Check size={10} className="text-green-500" /> : <Copy size={10} />}
                    {isCopied ? t('chat.copied') : 'Copy'}
                 </button>
              </div>
           )}
        </div>
      </div>
    </div>
  );
};
