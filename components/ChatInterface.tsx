
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, User, Sparkles, ChevronDown, BrainCircuit, Zap, X, Box, Copy, Check, Plus, MonitorPlay, Palette, Film, Bot, Square, Crop, CheckCircle2, Globe, Brain, CircuitBoard, Wrench, Image as ImageIcon, CircleDashed, Terminal, Clapperboard, AudioWaveform, Move3d, RefreshCw, AlertCircle, Search } from 'lucide-react';
import { ChatMessage, GenerationParams, ImageStyle, ImageResolution, AppMode, ImageModel, VideoResolution, VideoModel, VideoStyle, AspectRatio, SmartAsset, APP_LIMITS, AgentAction, TextModel } from '../types';
import { streamChatResponse } from '../services/geminiService';
import { AgentStateMachine, AgentState, createInitialAgentState, PendingAction, createGenerateAction } from '../services/agentService';
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
  projectContextSummary?: string;
  projectSummaryCursor?: number;
  onUpdateProjectContext?: (summary: string, cursor: number) => void;
  onToolCall?: (action: AgentAction) => void;
  agentContextAssets?: SmartAsset[];
  onRemoveContextAsset?: (assetId: string) => void;
  onClearContextAssets?: () => void;
  // Draft images from generateImage (构思图)
  thoughtImages?: Array<{ id: string; data: string; mimeType: string; isFinal: boolean; timestamp: number }>;
  setThoughtImages?: React.Dispatch<React.SetStateAction<Array<{ id: string; data: string; mimeType: string; isFinal: boolean; timestamp: number }>>>;
}


// Improved Parser for Streaming Thoughts and Tools
interface AgentStep { type: 'ORCHESTRATOR' | 'PLANNER' | 'TOOL' | 'PROTOCOL' | 'SYSTEM' | 'THOUGHT'; title: string; content: string; isComplete: boolean; timestamp: number; }

const parseAgentSteps = (rawText: string): { steps: AgentStep[], finalContent: string } => {
  const steps: AgentStep[] = [];
  let remainingText = rawText;

  // 1. Handle Thought Tags <thought>...</thought>
  const openTagRegex = /<\s*thought\s*>/i;
  const closeTagRegex = /<\s*\/\s*thought\s*>/i;

  const openMatch = remainingText.match(openTagRegex);
  if (openMatch) {
    const startIndex = openMatch.index!;
    const closeMatch = remainingText.match(closeTagRegex);

    let content = '';
    let endIndex = remainingText.length;
    let isComplete = false;

    if (closeMatch && closeMatch.index! > startIndex) {
      endIndex = closeMatch.index! + closeMatch[0].length;
      content = remainingText.substring(startIndex + openTagRegex.source.length - 1, closeMatch.index);
      // Fix regex mapping for dynamic content
      const actualStart = remainingText.indexOf('>', startIndex) + 1;
      content = remainingText.substring(actualStart, closeMatch.index);
      isComplete = true;
    } else {
      const actualStart = remainingText.indexOf('>', startIndex) + 1;
      content = remainingText.substring(actualStart);
      isComplete = false;
    }

    steps.push({
      type: 'THOUGHT',
      title: 'Thinking Process',
      content: content.trim(),
      isComplete: isComplete,
      timestamp: Date.now()
    });

    // For streaming, we don't remove if not complete to keep context
    if (isComplete) {
      remainingText = remainingText.substring(0, startIndex) + remainingText.substring(endIndex);
    } else {
      remainingText = remainingText.substring(0, startIndex);
    }
  }

  // 2. Handle JSON Tool Blocks
  const jsonCodeBlockRegex = /(```json\s*(\{\s*"action":\s*"(?:img_gen|generate_image)"[\s\S]*?\})\s*```)/g;

  let jsonMatch;
  while ((jsonMatch = jsonCodeBlockRegex.exec(remainingText)) !== null) {
    const jsonContent = jsonMatch[2];
    const isImageGen = jsonContent.includes('img_gen') || jsonContent.includes('generate_image');

    let displayContent = jsonContent;
    try {
      const parsed = JSON.parse(jsonContent);
      const args = parsed.action_input || parsed.args || parsed;
      displayContent = JSON.stringify(args, null, 2);
    } catch (e) {
      // FIX: Log parsing errors for debugging
      console.debug('[ChatInterface] Failed to parse tool JSON:', e);
    }

    steps.push({
      type: 'TOOL',
      title: isImageGen ? 'Generating Media' : 'Executing Tool',
      content: `\`\`\`json\n${displayContent}\n\`\`\``,
      isComplete: true,
      timestamp: Date.now()
    });
  }
  remainingText = remainingText.replace(jsonCodeBlockRegex, '').trim();

  const tagRegex = /(\.\.\. \[Orchestrator\]:|\[PLANNER\]:|\[Using Tool:|\[PROTOCOL:|\[SYSTEM_CALLBACK\]:|(?:!!!|! ! !|!\s*!\s*!)\s*GENERATE_IMAGE|\[googleSearch\])([\s\S]*?)(?=(\.\.\. \[Orchestrator\]:|\[PLANNER\]:|\[Using Tool:|\[PROTOCOL:|\[SYSTEM_CALLBACK\]:|(?:!!!|! ! !|!\s*!\s*!)\s*GENERATE_IMAGE|\[googleSearch\]|$))/g;

  let match;
  while ((match = tagRegex.exec(remainingText)) !== null) {
    const tag = match[1];
    const content = match[2].trim();
    let type: AgentStep['type'] = 'SYSTEM';
    let title = 'System Process';

    if (tag.includes('Orchestrator')) { type = 'ORCHESTRATOR'; title = 'Intent Analysis'; }
    else if (tag.includes('PLANNER')) { type = 'PLANNER'; title = 'Developing Plan'; }
    else if (tag.includes('Using Tool') || tag.includes('GENERATE_IMAGE') || tag.includes('googleSearch')) {
      type = 'TOOL';
      title = tag.includes('googleSearch') ? 'Searching Web' : (tag.includes('GENERATE_IMAGE') ? 'Generating Media' : 'Executing Tool');
    }
    else if (tag.includes('PROTOCOL')) { type = 'PROTOCOL'; title = 'Protocol Check'; }

    let displayContent = content.replace(/(?:!!!|! ! !)$/, '').trim();

    if (tag.includes('Using Tool')) {
      const parts = content.split(']');
      title = `Tool: ${parts[0]}`;
      if (parts.length > 1) displayContent = parts.slice(1).join(']').trim();
      else displayContent = '';
    }

    steps.push({ type, title, content: displayContent, isComplete: true, timestamp: Date.now() });
  }

  let cleanContent = remainingText.replace(tagRegex, '').trim();
  cleanContent = cleanContent.replace(/\n{3,}/g, '\n\n').trim();

  return { steps, finalContent: cleanContent };
};

const AgentStepItem: React.FC<{ step: AgentStep; isLast: boolean; isThinking: boolean }> = ({ step }) => {
  const [isOpen, setIsOpen] = useState(!step.isComplete);

  useEffect(() => {
    if (step.isComplete) {
      setIsOpen(false);
    } else {
      setIsOpen(true);
    }
  }, [step.isComplete]);

  let Icon = CircuitBoard;
  let colorClass = "text-blue-400";
  let bgClass = "bg-blue-500/10 border-blue-500/20";
  let statusIcon = null;

  switch (step.type) {
    case 'ORCHESTRATOR': Icon = Brain; colorClass = "text-purple-400"; bgClass = "bg-purple-500/10 border-purple-500/20"; break;
    case 'PLANNER': Icon = Wrench; colorClass = "text-indigo-400"; bgClass = "bg-indigo-500/10 border-indigo-500/20"; break;
    case 'TOOL': Icon = ImageIcon; if (step.title.toLowerCase().includes('search')) Icon = Globe; colorClass = "text-amber-400"; bgClass = "bg-amber-500/10 border-amber-500/20"; break;
    case 'THOUGHT': Icon = BrainCircuit; colorClass = "text-gray-400"; bgClass = "bg-gray-500/10 border-gray-500/20"; break;
  }

  const isActive = !step.isComplete;
  if (isActive) { statusIcon = <CircleDashed size={14} className="text-brand-400 animate-spin" />; }
  else { statusIcon = <CheckCircle2 size={14} className="text-green-500" />; }

  return (
    <div className={`rounded-lg border ${bgClass} overflow-hidden mb-2 animate-in fade-in slide-in-from-top-1 transition-all`}>
      <button onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/5 transition-colors">
        <div className={`p-1.5 rounded-full bg-black/20 shrink-0`}> <Icon size={14} className={colorClass} /> </div>
        <div className="flex-1 min-w-0 flex items-center justify-between">
          <div className={`text-xs font-bold ${colorClass} flex items-center gap-2`}>
            {step.title} {isActive && <span className="text-[10px] opacity-70 font-normal hidden sm:inline">Processing...</span>}
          </div>
          <div className="flex items-center gap-2">
            {statusIcon}
            {step.content && (<ChevronDown size={14} className={`text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />)}
          </div>
        </div>
      </button>
      {isOpen && step.content && (
        <div className="px-3 pb-3 pt-0 text-xs text-gray-300 font-mono border-t border-white/5 mt-1 bg-black/20">
          <div className="pt-2 whitespace-pre-wrap break-words opacity-90 leading-relaxed max-h-60 overflow-y-auto custom-scrollbar">
            <ReactMarkdown
              components={{
                code: ({ node, inline, className, children, ...props }: any) => (
                  <code className="bg-transparent text-gray-400 text-[10px]" {...props}>{children}</code>
                ),
                pre: ({ children }: any) => <pre className="bg-transparent p-0 m-0 overflow-x-auto">{children}</pre>
              }}
            >
              {step.content}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
};

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  history,
  setHistory,
  selectedImages,
  setSelectedImages,
  projectId,
  params,
  setParams,
  mode,
  projectContextSummary,
  projectSummaryCursor,
  onUpdateProjectContext,
  onToolCall,
  agentContextAssets,
  onRemoveContextAsset,
  onClearContextAssets,
  // thoughtImages removed - not used in this component
  setThoughtImages
}) => {
  const { t, language } = useLanguage();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<TextModel>(TextModel.FLASH);
  const [useSearch, setUseSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const projectIdRef = useRef(projectId);
  const abortControllerRef = useRef<AbortController | null>(null);

  // NEW: Track LLM thinking process text
  const [thinkingText, setThinkingText] = useState<string>('');
  const thinkingTextRef = useRef<string>(''); // Ref to hold latest value for finally block

  // NEW: Track search streaming content
  const [searchContent, setSearchContent] = useState<string>('');
  const [searchIsComplete, setSearchIsComplete] = useState(false);
  const [searchIsCollapsed, setSearchIsCollapsed] = useState(false);
  const searchScrollRef = useRef<HTMLDivElement>(null);

  // NEW: Track active tool call status for UI display
  const [toolCallStatus, setToolCallStatus] = useState<{
    isActive: boolean;
    toolName: string;
    model?: string;
    prompt?: string;
  } | null>(null);
  const [toolCallExpanded, setToolCallExpanded] = useState(false);

  // NEW: Agent state machine for workflow management and retry
  const [agentState, setAgentState] = useState<AgentState>(createInitialAgentState());

  // FIX: Use ref to hold onToolCall so agentMachine doesn't recreate when prop changes
  // This prevents resetting internal state on every parent re-render
  const onToolCallRef = useRef(onToolCall);
  onToolCallRef.current = onToolCall; // Always keep ref up-to-date

  // Create stable agent machine instance - only created once (no dependencies)
  const agentMachine = useMemo(() => new AgentStateMachine(
    createInitialAgentState(),
    {
      onStateChange: (newState) => setAgentState(newState),
      onExecuteAction: async (action: PendingAction) => {
        console.log('[Agent] onExecuteAction called:', action.type, 'hasOnToolCall:', !!onToolCallRef.current);
        // Execute the action via onToolCall (read from ref for latest value)
        if (onToolCallRef.current && action.type === 'GENERATE_IMAGE') {
          console.log('[Agent] Calling onToolCall with params:', action.params);
          return new Promise((resolve, reject) => {
            try {
              onToolCallRef.current!({ toolName: 'generate_image', args: action.params });
              resolve({ success: true });
            } catch (error) {
              reject(error);
            }
          });
        }
        console.warn('[Agent] onExecuteAction condition not met');
        throw new Error(`Unknown action type: ${action.type}`);
      }
    }
  ), []); // Empty deps - machine is stable for component lifetime

  // Tool call handler with retry support
  const handleToolCallWithRetry = async (action: AgentAction) => {
    // Merge AI args with user's manual settings based on Auto Mode
    const isAutoMode = params.isAutoMode ?? true;

    let finalArgs = action.args;
    if (!isAutoMode) {
      // Manual mode: user's selections override AI's choices
      finalArgs = {
        ...action.args,
        model: params.imageModel,
        aspectRatio: params.aspectRatio,
        resolution: params.imageResolution,
        negativePrompt: params.negativePrompt || action.args.negativePrompt,
        numberOfImages: params.numberOfImages || action.args.numberOfImages || 1,
        useGrounding: params.useGrounding ?? action.args.useGrounding ?? false,
      };
    } else {
      // Auto mode: use AI's choices but ensure valid model value
      const validModels = Object.values(ImageModel);
      if (!validModels.includes(finalArgs.model)) {
        finalArgs = { ...finalArgs, model: ImageModel.FLASH };
      }
    }

    const pendingAction = createGenerateAction(
      finalArgs,
      `Generate: ${action.args.prompt?.slice(0, 50)}...`,
      false // Don't require UI confirmation, use conversation-based HITL
    );

    // Set the action and let state machine handle execution with retry
    // Since requiresConfirmation=false, setPendingAction will auto-execute
    try {
      console.log('[Agent] Setting pending action (will auto-execute)');
      // Show tool call status in UI (collapsed by default)
      const modelName = finalArgs.model === ImageModel.PRO ? 'Nano Banana Pro' : 'Nano Banana';
      setToolCallStatus({
        isActive: true,
        toolName: 'generate_image',
        model: modelName,
        prompt: finalArgs.prompt || ''
      });
      setToolCallExpanded(false); // Start collapsed
      await agentMachine.setPendingAction(pendingAction);
      console.log('[Agent] Action execution completed');
    } catch (error) {
      console.error('[Agent] Action failed after retries:', error);
      // State machine will have transitioned to ERROR state
    } finally {
      // Clear tool call status after completion
      setToolCallStatus(null);
    }
  };

  const isAutoMode = params.isAutoMode ?? true;
  const getRatioLabel = (r: AspectRatio) => { const enumKey = Object.keys(AspectRatio).find(k => AspectRatio[k as keyof typeof AspectRatio] === r); return t(`ratio.${enumKey}` as any) || r; };
  useEffect(() => {
    projectIdRef.current = projectId;
    setIsLoading(false);
    setInput('');
    setShowSettings(false);
    setShowModelSelector(false);
    agentMachine.reset();
  }, [projectId, agentMachine]);
  useEffect(() => { if (scrollRef.current) { scrollRef.current.scrollTop = scrollRef.current.scrollHeight; } }, [history, isLoading, selectedImages.length]);
  useEffect(() => { if (inputRef.current) { inputRef.current.style.height = 'auto'; const maxHeight = 160; const newHeight = Math.min(inputRef.current.scrollHeight, maxHeight); inputRef.current.style.height = `${newHeight}px`; inputRef.current.style.overflowY = inputRef.current.scrollHeight > maxHeight ? 'auto' : 'hidden'; } }, [input]);
  useEffect(() => { const handleClickOutside = (event: MouseEvent) => { const target = event.target as HTMLElement; if (!target.closest('.settings-popover') && !target.closest('.settings-trigger')) { setShowSettings(false); } if (!target.closest('.model-popover') && !target.closest('.model-trigger')) { setShowModelSelector(false); } }; document.addEventListener('mousedown', handleClickOutside); return () => document.removeEventListener('mousedown', handleClickOutside); }, []);

  const processFiles = async (files: File[]) => {
    if (selectedImages.length + files.length > APP_LIMITS.MAX_IMAGE_COUNT) { alert(t('msg.upload_limit_count')); return; }
    for (let i = 0; i < files.length; i++) { if (files[i].size > APP_LIMITS.MAX_FILE_SIZE_BYTES) { alert(`${files[i].name}: ${t('msg.upload_limit_size')}`); return; } }
    const readers: Promise<string>[] = [];
    files.forEach(file => { readers.push(new Promise((resolve) => { const reader = new FileReader(); reader.onload = (ev) => resolve(ev.target?.result as string); reader.readAsDataURL(file); })); });
    try { const results = await Promise.all(readers); setSelectedImages(prev => [...prev, ...results]); } catch (error) { console.error("Error reading files", error); }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => { const files = e.target.files; if (!files || files.length === 0) return; await processFiles(Array.from(files)); if (fileInputRef.current) fileInputRef.current.value = ''; };
  const handlePaste = async (e: React.ClipboardEvent) => { const items = e.clipboardData.items; const files: File[] = []; for (let i = 0; i < items.length; i++) { if (items[i].type.indexOf('image') !== -1) { const file = items[i].getAsFile(); if (file) files.push(file); } } if (files.length > 0) { e.preventDefault(); await processFiles(files); } };
  const removeSelectedImage = (index: number) => { setSelectedImages(prev => prev.filter((_, i) => i !== index)); };
  const handleStop = () => {
    if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null; }
    setIsLoading(false);
    setHistory(prev => { const updated = [...prev]; const last = updated[updated.length - 1]; if (last.role === 'model' && last.isThinking) { updated[updated.length - 1] = { ...last, isThinking: false }; } return updated; });
  };

  const handleSend = async (customText?: string) => {
    const textToSend = customText || input.trim();
    console.log('[Chat] handleSend called, isLoading:', isLoading, 'text:', textToSend?.slice(0, 30));
    if ((!textToSend && selectedImages.length === 0) || isLoading) {
      console.log('[Chat] Message blocked - early return');
      return;
    }

    const sendingProjectId = projectId;
    // Merge selectedImages with agentContextAssets (convert to data URLs)
    const contextImageUrls = (agentContextAssets || []).map(a => `data:${a.mimeType};base64,${a.data}`);
    const allImages = [...contextImageUrls, ...selectedImages];
    const userMsg: ChatMessage = { role: 'user', content: textToSend, timestamp: Date.now(), images: allImages.length > 0 ? allImages : undefined };
    const newHistory = [...history, userMsg];
    setHistory(newHistory);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setSelectedImages([]);
    // Clear context assets from UI immediately after sending
    // Images are already merged into userMsg.images and will be in chatHistory
    onClearContextAssets?.();
    setThoughtImages?.([]); // Clear previous thought images
    setIsLoading(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let collectedSignatures: Array<{ partIndex: number; signature: string }> = [];

    try {
      const tempAiMsg: ChatMessage = { role: 'model', content: '', timestamp: Date.now(), isThinking: true };
      setThinkingText(''); // Clear previous thinking text
      thinkingTextRef.current = ''; // Clear ref too
      // Clear search state for new message
      setSearchContent('');
      setSearchIsComplete(false);
      setSearchIsCollapsed(false);
      setHistory(prev => [...prev, tempAiMsg]);

      await streamChatResponse(
        newHistory,
        userMsg.content,
        (chunkText) => {
          if (projectIdRef.current !== sendingProjectId) return;
          setHistory(prev => { const updated = [...prev]; updated[updated.length - 1] = { ...updated[updated.length - 1], content: chunkText }; return updated; });
        },
        selectedModel,
        mode,
        abortController.signal,
        projectContextSummary,
        projectSummaryCursor,
        onUpdateProjectContext,
        handleToolCallWithRetry, // Use Agent state machine with retry logic
        useSearch,
        params,
        agentContextAssets,
        (signatures) => { collectedSignatures = signatures; },
        // Callback for thought images (构思图)
        setThoughtImages ? (imageData) => {
          if (projectIdRef.current !== sendingProjectId) return;
          setThoughtImages(prev => [...prev, {
            id: crypto.randomUUID(),
            ...imageData,
            timestamp: Date.now()
          }]);
        } : undefined,
        // Callback for thinking process text (思考过程)
        (text) => {
          if (projectIdRef.current !== sendingProjectId) return;
          thinkingTextRef.current += text;
          setThinkingText(prev => prev + text);
        },
        // NEW: Callback for search streaming (搜索过程)
        (text, isComplete) => {
          if (projectIdRef.current !== sendingProjectId) return;
          setSearchContent(text);
          if (isComplete) {
            setSearchIsComplete(true);
            // Auto-collapse after 2 seconds
            setTimeout(() => {
              setSearchIsCollapsed(true);
            }, 2000);
          }
          // Auto-scroll search content
          if (searchScrollRef.current) {
            searchScrollRef.current.scrollTop = searchScrollRef.current.scrollHeight;
          }
        }
      );
    } catch (error: any) {
      if (error.message === 'Cancelled' || error.name === 'AbortError') {
        console.log('Chat generation stopped by user');
      } else {
        console.error("Chat Error:", error);
        if (projectIdRef.current === sendingProjectId) {
          setHistory(prev => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'model') {
              const currentContent = updated[lastIdx].content;
              const errorMsg = `\n\n*[System Error: ${error.message || "Connection timed out"}]*`;
              updated[lastIdx] = { ...updated[lastIdx], content: currentContent ? currentContent + errorMsg : errorMsg, isThinking: false };
            }
            return updated;
          });
        }
      }
    } finally {
      if (projectIdRef.current === sendingProjectId) {
        setIsLoading(false);
        abortControllerRef.current = null;
        // Store thinkingText in the message for persistence after completion
        const finalThinkingContent = thinkingTextRef.current; // Use ref to get latest value
        setHistory(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'model') {
            updated[updated.length - 1] = {
              ...last,
              isThinking: false,
              thinkingContent: finalThinkingContent || undefined, // Persist thinking content
              thoughtSignatures: collectedSignatures.length > 0 ? collectedSignatures : undefined
            };
          }
          return updated;
        });
      }
    }
  };
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  const VEO_TIPS = [
    { icon: <Clapperboard size={12} />, title: language === 'zh' ? '时序动作' : 'Temporal Flow', desc: language === 'zh' ? '用“首先...然后...”描述动作变化' : 'Describe transitions with "First... then..."', prompt: language === 'zh' ? '教我如何描述一个角色的动作先后顺序' : 'Tell me how to describe a sequence of character actions' },
    { icon: <AudioWaveform size={12} />, title: language === 'zh' ? '听觉锚点' : 'Sound Cues', desc: language === 'zh' ? '加入声音关键词增强材质真实感' : 'Add sound words to enhance physical realism', prompt: language === 'zh' ? '为什么提示词里要写声音？举几个例子' : 'Why include sounds in prompts? Give some examples' },
    { icon: <Move3d size={12} />, title: language === 'zh' ? '专业运镜' : 'Pro Camera', desc: language === 'zh' ? '指定推拉摇移等电影级镜头语言' : 'Specify cinematic motions like Dolly Zoom', prompt: language === 'zh' ? '推荐几个适合科幻大片的运镜描述' : 'Suggest some cinematic camera movements for sci-fi' }
  ];

  return (
    <div className="flex flex-col h-full bg-dark-panel relative min-h-0">
      <div className="flex-1 overflow-y-auto p-4 space-y-6 min-h-0 scroll-smooth" ref={scrollRef}>
        {history.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-gray-500">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-6 shadow-2xl ${mode === AppMode.VIDEO ? 'bg-purple-600/20 text-purple-400' : 'bg-brand-600/20 text-brand-400'}`}>
              {mode === AppMode.VIDEO ? <Film size={32} /> : <Sparkles size={32} />}
            </div>
            <h2 className="text-xl font-bold text-gray-200 mb-2">
              {mode === AppMode.VIDEO ? t('chat.welcome_video') : t('chat.welcome_image')}
            </h2>
            <p className="text-sm text-gray-500 text-center max-w-sm mb-8 leading-relaxed">
              {mode === AppMode.VIDEO ? t('chat.desc_video') : t('chat.desc_image')}
            </p>

            {mode === AppMode.VIDEO && (
              <div className="grid grid-cols-1 gap-3 w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
                <div className="text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1 text-center">Veo 3.1 Prompting Tips</div>
                {VEO_TIPS.map((tip, i) => (
                  <button
                    key={i}
                    onClick={() => handleSend(tip.prompt)}
                    className="flex items-start gap-3 p-3 bg-dark-surface border border-dark-border rounded-xl hover:border-purple-500/50 hover:bg-white/5 transition-all text-left group"
                  >
                    <div className="mt-0.5 p-2 bg-purple-500/10 text-purple-400 rounded-lg group-hover:bg-purple-500/20">{tip.icon}</div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-gray-300 mb-0.5">{tip.title}</div>
                      <div className="text-[10px] text-gray-500 leading-tight">{tip.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {history.map((msg, idx) => {
              // Find the last AI message index for tool call display (ES5 compatible)
              let lastAiIdx = -1;
              for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].role === 'model') { lastAiIdx = i; break; }
              }
              const isLastAiMessage = idx === lastAiIdx;
              const isStreaming = isLastAiMessage && msg.isThinking;

              return (
                <ChatBubble
                  key={idx}
                  message={msg}
                  nativeThinkingText={isStreaming ? thinkingText : undefined}
                  // Pass search/tool data to last AI message (regardless of isThinking)
                  searchContent={isLastAiMessage ? searchContent : undefined}
                  searchIsComplete={isLastAiMessage ? searchIsComplete : undefined}
                  searchIsCollapsed={isLastAiMessage ? searchIsCollapsed : undefined}
                  onSearchToggle={isLastAiMessage ? () => setSearchIsCollapsed(!searchIsCollapsed) : undefined}
                  toolCallStatus={isLastAiMessage ? toolCallStatus : undefined}
                  toolCallExpanded={isLastAiMessage ? toolCallExpanded : undefined}
                  onToolCallToggle={isLastAiMessage ? () => setToolCallExpanded(!toolCallExpanded) : undefined}
                />
              );
            })}
          </>
        )}

        {/* Agent Status Indicator - 重试/错误状态 */}
        {(agentState.phase === 'RETRYING' || agentState.phase === 'ERROR') && (
          <div className={`mt-4 p-3 rounded-lg border animate-in fade-in ${agentState.phase === 'ERROR'
            ? 'bg-red-500/10 border-red-500/30'
            : 'bg-amber-500/10 border-amber-500/30'
            }`}>
            <div className="flex items-center gap-2">
              {agentState.phase === 'RETRYING' ? (
                <>
                  <RefreshCw size={14} className="text-amber-400 animate-spin" />
                  <span className="text-xs text-amber-300">
                    {language === 'zh'
                      ? `重试中 (${agentState.retryCount}/${agentState.maxRetries})...`
                      : `Retrying (${agentState.retryCount}/${agentState.maxRetries})...`}
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle size={14} className="text-red-400" />
                  <span className="text-xs text-red-300">
                    {agentState.error || (language === 'zh' ? '操作失败' : 'Action failed')}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-dark-panel border-t border-dark-border z-20">
        <div className="flex flex-col gap-2">
          {/* Preview area for uploaded images and context assets */}
          {(selectedImages.length > 0 || (agentContextAssets && agentContextAssets.length > 0)) && (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {/* Context assets from editor (with edit badge) */}
              {agentContextAssets?.map((asset) => (
                <div key={asset.id} className="relative w-16 h-16 shrink-0 group">
                  <img src={`data:${asset.mimeType};base64,${asset.data}`} alt="context" className="w-full h-full object-cover rounded-lg border-2 border-brand-500/50" />
                  <div className="absolute top-0 left-0 bg-brand-500 text-white text-[8px] font-bold px-1 rounded-br rounded-tl">编辑</div>
                  {onRemoveContextAsset && (
                    <button onClick={() => onRemoveContextAsset(asset.id)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"><X size={12} /></button>
                  )}
                </div>
              ))}
              {/* User uploaded images */}
              {selectedImages.map((img, idx) => (
                <div key={idx} className="relative w-16 h-16 shrink-0 group">
                  <img src={img} alt="upload" className="w-full h-full object-cover rounded-lg border border-dark-border" />
                  <button onClick={() => removeSelectedImage(idx)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col bg-dark-surface border border-dark-border rounded-2xl p-3 shadow-inner transition-colors relative gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={t('chat.placeholder')}
              className="w-full bg-transparent border-0 focus:ring-0 focus:outline-none outline-none text-sm text-gray-200 placeholder-gray-500 resize-none overflow-hidden px-1 py-1 leading-relaxed"
              rows={1}
              style={{ minHeight: '32px' }}
            />

            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <div className="flex items-center gap-1">
                <button onClick={() => fileInputRef.current?.click()} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors" title={t('chat.upload')}><Plus size={20} /></button>
                <button onClick={() => setUseSearch(!useSearch)} className={`p-2 rounded-full transition-colors flex items-center gap-1.5 ${useSearch ? 'text-brand-400 bg-brand-500/10' : 'text-gray-400 hover:text-white hover:bg-white/10'}`} title={useSearch ? t('chat.search_on') : t('chat.search_off')}><Globe size={18} /></button>
                {mode !== AppMode.VIDEO && (
                  <div className="relative">
                    <button className="settings-trigger p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors flex items-center justify-center" onClick={() => setShowSettings(!showSettings)} title={t('chat.settings_tooltip')}><Box size={20} /></button>
                    {showSettings && (
                      <div className="settings-popover absolute bottom-12 left-0 w-64 bg-dark-surface border border-dark-border rounded-xl shadow-xl p-4 z-50 animate-in slide-in-from-bottom-2 fade-in">
                        <div className="flex items-center justify-between mb-3 pb-2 border-b border-dark-border">
                          <span className="text-xs font-bold text-gray-400 uppercase">{t('nav.settings')}</span>
                          <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-white"><X size={14} /></button>
                        </div>
                        <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                          <div className="flex items-center justify-between p-2 rounded-lg bg-black/20 border border-dark-border">
                            <span className="text-xs font-bold text-brand-400">Auto Mode</span>
                            <button onClick={() => setParams(prev => ({ ...prev, isAutoMode: !prev.isAutoMode }))} className={`w-8 h-4 rounded-full transition-colors relative flex items-center shrink-0 ${isAutoMode ? 'bg-brand-500' : 'bg-gray-700'}`}><div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-all absolute ${isAutoMode ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} /></button>
                          </div>
                          <div className={`space-y-4 transition-opacity ${isAutoMode ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="space-y-1.5"><label className="text-[10px] text-gray-400 font-bold flex items-center gap-1"><Bot size={10} /> {t('lbl.model').toUpperCase()}</label><select value={mode === AppMode.IMAGE ? params.imageModel : params.videoModel} onChange={(e) => setParams(prev => mode === AppMode.IMAGE ? ({ ...prev, imageModel: e.target.value as ImageModel }) : ({ ...prev, videoModel: e.target.value as VideoModel }))} className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs text-white">{mode === AppMode.IMAGE ? (<><option value={ImageModel.FLASH}>{t('model.flash')}</option><option value={ImageModel.PRO}>{t('model.pro')}</option></>) : (<><option value={VideoModel.VEO_FAST}>{t('model.veo_fast')}</option><option value={VideoModel.VEO_HQ}>{t('model.veo_hq')}</option></>)}</select></div>
                            <div className="space-y-1.5"><label className="text-[10px] text-gray-400 font-bold flex items-center gap-1"><Crop size={10} /> {t('lbl.aspect_ratio').toUpperCase()}</label><select value={params.aspectRatio} onChange={(e) => setParams(prev => ({ ...prev, aspectRatio: e.target.value as AspectRatio }))} className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs text-white">{Object.values(AspectRatio).map(ratio => (<option key={ratio} value={ratio}>{getRatioLabel(ratio)}</option>))}</select></div>
                            <div className="space-y-1.5"><label className="text-[10px] text-gray-400 font-bold flex items-center gap-1"><Palette size={10} /> {t('lbl.style').toUpperCase()}</label><select value={mode === AppMode.IMAGE ? params.imageStyle : params.videoStyle} onChange={(e) => setParams(prev => mode === AppMode.IMAGE ? ({ ...prev, imageStyle: e.target.value as ImageStyle }) : ({ ...prev, videoStyle: e.target.value as VideoStyle }))} className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs text-white">{mode === AppMode.IMAGE ? Object.entries(ImageStyle).map(([k, v]) => <option key={k} value={v}>{t(`style.${k}` as any) || v}</option>) : Object.entries(VideoStyle).map(([k, v]) => <option key={k} value={v}>{t(`style.${k}` as any) || v}</option>)}</select></div>
                            <div className="space-y-1.5"><label className="text-[10px] text-gray-400 font-bold flex items-center gap-1"><MonitorPlay size={10} /> {t('lbl.resolution').toUpperCase()}</label><select value={mode === AppMode.IMAGE ? params.imageResolution : params.videoResolution} onChange={(e) => setParams(prev => mode === AppMode.IMAGE ? ({ ...prev, imageResolution: e.target.value as ImageResolution }) : ({ ...prev, videoResolution: e.target.value as VideoResolution }))} className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs text-white">{mode === AppMode.IMAGE ? (<><option value={ImageResolution.RES_1K}>1K</option><option value={ImageResolution.RES_2K}>2K (Pro)</option><option value={ImageResolution.RES_4K}>4K (Pro)</option></>) : (<><option value={VideoResolution.RES_720P}>720p</option><option value={VideoResolution.RES_1080P}>1080p</option></>)}</select></div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <button className="model-trigger flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors" onClick={() => setShowModelSelector(!showModelSelector)}>{selectedModel === TextModel.FLASH ? 'Flash' : 'Thinking'}<ChevronDown size={14} /></button>
                  {showModelSelector && (
                    <div className="model-popover absolute bottom-12 right-0 w-56 bg-dark-surface border border-dark-border rounded-xl shadow-xl p-1 z-50 animate-in slide-in-from-bottom-2 fade-in">
                      <button onClick={() => { setSelectedModel(TextModel.FLASH); setShowModelSelector(false); }} className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors ${selectedModel === TextModel.FLASH ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}><Zap size={16} className="text-yellow-400" /><div><div className="text-xs font-bold">Flash</div><div className="text-[10px] opacity-70">Gemini 3 Flash</div></div>{selectedModel === TextModel.FLASH && <Check size={14} className="ml-auto" />}</button>
                      <button onClick={() => { setSelectedModel(TextModel.PRO); setShowModelSelector(false); }} className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors ${selectedModel === TextModel.PRO ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}><BrainCircuit size={16} className="text-purple-400" /><div><div className="text-xs font-bold">Thinking</div><div className="text-[10px] opacity-70">Gemini 3 Pro</div></div>{selectedModel === TextModel.PRO && <Check size={14} className="ml-auto" />}</button>
                    </div>
                  )}
                </div>
                {isLoading ? (<button onClick={handleStop} className="p-2.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500 text-red-400 rounded-xl shadow-lg transition-all" title={t('chat.stop')}><Square size={18} fill="currentColor" /></button>) : (<button onClick={() => handleSend()} disabled={(!input.trim() && selectedImages.length === 0)} className="p-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"><Send size={18} /></button>)}
              </div>
            </div>
          </div>
        </div>
        <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*" onChange={handleFileSelect} />
      </div>
    </div>
  );
};

interface ChatBubbleProps {
  message: ChatMessage;
  nativeThinkingText?: string;
  // Search flow props (only passed for current AI message during loading)
  searchContent?: string;
  searchIsComplete?: boolean;
  searchIsCollapsed?: boolean;
  onSearchToggle?: () => void;
  // Tool call flow props
  toolCallStatus?: { isActive: boolean; toolName: string; model?: string; prompt?: string } | null;
  toolCallExpanded?: boolean;
  onToolCallToggle?: () => void;
}

const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  nativeThinkingText,
  searchContent,
  searchIsComplete,
  searchIsCollapsed,
  onSearchToggle,
  toolCallStatus,
  toolCallExpanded,
  onToolCallToggle
}) => {
  const { t, language } = useLanguage();
  const isUser = message.role === 'user';
  const isSystem = message.isSystem;
  const isFeedback = message.content.startsWith('[SYSTEM_FEEDBACK]');
  const [isCopied, setIsCopied] = useState(false);

  // NEW: Collapsible thinking section - expanded during thinking, auto-collapse when done
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(!!message.isThinking);

  // Auto-collapse when thinking completes
  useEffect(() => {
    if (!message.isThinking && isThinkingExpanded) {
      // Delay to let user see final content briefly
      const timer = setTimeout(() => setIsThinkingExpanded(false), 500);
      return () => clearTimeout(timer);
    }
    if (message.isThinking) {
      setIsThinkingExpanded(true);
    }
  }, [message.isThinking]);

  // Parse Content
  const { steps, finalContent } = isUser ? { steps: [], finalContent: message.content } : parseAgentSteps(message.content);

  const handleCopy = () => {
    navigator.clipboard.writeText(finalContent || message.content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const MarkdownComponents = {
    p: ({ children }: any) => <p className="mb-2 last:mb-0 break-words whitespace-pre-wrap">{children}</p>,
    ul: ({ children }: any) => <ul className="list-disc ml-4 mb-2 space-y-1">{children}</ul>,
    ol: ({ children }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1">{children}</ol>,
    li: ({ children }: any) => <li>{children}</li>,
    h1: ({ children }: any) => <h1 className="text-lg font-bold mb-2 mt-4 first:mt-0">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-sm font-bold mb-1 mt-2">{children}</h3>,
    blockquote: ({ children }: any) => <blockquote className="border-l-2 border-gray-500 pl-3 italic my-2 text-gray-400">{children}</blockquote>,
    strong: ({ children }: any) => <strong className="font-bold text-white">{children}</strong>,
    table: ({ children }: any) => <div className="overflow-x-auto my-2 border border-dark-border rounded-lg bg-black/20"><table className="min-w-full divide-y divide-dark-border text-left text-xs">{children}</table></div>,
    thead: ({ children }: any) => <thead className="bg-white/5">{children}</thead>,
    tbody: ({ children }: any) => <tbody className="divide-y divide-dark-border/30">{children}</tbody>,
    tr: ({ children }: any) => <tr>{children}</tr>,
    th: ({ children }: any) => <th className="px-3 py-2 font-semibold text-gray-200">{children}</th>,
    td: ({ children }: any) => <td className="px-3 py-2 text-gray-400 whitespace-pre-wrap break-words">{children}</td>,
    code: ({ node, inline, className, children, ...props }: any) => { return inline ? (<code className="bg-white/10 px-1.5 py-0.5 rounded font-mono text-xs text-brand-200 break-words whitespace-pre-wrap" {...props}>{children}</code>) : (<div className="bg-black/40 rounded-lg my-2 overflow-hidden border border-white/5"> <div className="bg-white/5 px-3 py-1.5 border-b border-white/5 text-[10px] text-gray-500 font-mono flex items-center gap-2"> <div className="flex gap-1"><div className="w-2 h-2 rounded-full bg-red-500/50" /><div className="w-2 h-2 rounded-full bg-yellow-500/50" /><div className="w-2 h-2 rounded-full bg-green-500/50" /></div> Code </div> <div className="p-3 overflow-x-auto"><code className="font-mono text-xs text-gray-300 block whitespace-pre-wrap break-words" {...props}>{children}</code></div> </div>) },
    a: ({ href, children }: any) => <a href={href} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">{children}</a>
  };

  return (
    <div className={`flex gap-4 ${isUser && !isSystem ? 'flex-row-reverse' : ''} group animate-in fade-in slide-in-from-bottom-2`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isSystem && isFeedback ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
        isSystem ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
          isUser ? 'bg-gray-700' : 'bg-brand-600'
        }`}>
        {isSystem ? (isFeedback ? <CheckCircle2 size={16} /> : <Terminal size={16} />) : isUser ? <User size={16} className="text-gray-300" /> : <Sparkles size={16} className="text-white" />}
      </div>

      <div className={`flex flex-col gap-2 max-w-[85%] ${isUser && !isSystem ? 'items-end' : 'items-start'} min-w-0`}>

        {message.images && message.images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-1">
            {message.images.map((img, i) => (
              <img key={i} src={img} alt="attachment" className="w-32 h-32 object-cover rounded-lg border border-dark-border" />
            ))}
          </div>
        )}
        {!message.images && message.image && (<img src={message.image} alt="attachment" className="w-48 rounded-lg border border-dark-border mb-1" />)}

        {/* AGENT STEPS VIEW (Timeline) */}
        {!isUser && steps.length > 0 && (
          <div className="w-full max-w-md relative pl-2">
            {steps.length > 1 && (
              <div className="absolute left-[26px] top-4 bottom-4 w-0.5 bg-white/5 -z-10" />
            )}

            {steps.map((step, idx) => (
              <AgentStepItem key={idx} step={step} isLast={idx === steps.length - 1} isThinking={!!message.isThinking} />
            ))}
          </div>
        )}

        {/* SEARCH SECTION - Shows during search phase */}
        {!isUser && !isSystem && searchContent && (
          <div className={`w-full min-w-full max-w-md mb-2 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-xl overflow-hidden transition-all duration-300 ${searchIsCollapsed ? 'max-h-10' : 'max-h-48'}`}>
            <button
              onClick={onSearchToggle}
              className="w-full flex items-center justify-between px-3 py-2 text-xs text-blue-300 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Search size={14} className={searchIsComplete ? '' : 'animate-pulse'} />
                <span>{searchIsComplete ? (language === 'zh' ? '搜索完成' : 'Search Complete') : (language === 'zh' ? '正在搜索...' : 'Searching...')}</span>
              </div>
              <ChevronDown size={14} className={`transition-transform ${searchIsCollapsed ? '' : 'rotate-180'}`} />
            </button>
            {!searchIsCollapsed && (
              <div className="px-3 pb-3 max-h-32 overflow-y-auto text-xs text-gray-400 font-mono whitespace-pre-wrap custom-scrollbar">
                {searchContent}
              </div>
            )}
          </div>
        )}

        {/* COLLAPSIBLE THINKING SECTION - For streaming AI reasoning */}
        {!isUser && !isSystem && (message.isThinking || finalContent) && (
          <div className="w-full min-w-full max-w-md">
            {/* Thinking toggle header - show if there's NATIVE thinking content (streaming or persisted) */}
            {((nativeThinkingText && nativeThinkingText.length > 0) || message.thinkingContent) && (
              <button
                onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                className={`w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border transition-all ${isThinkingExpanded
                  ? 'bg-gray-500/10 border-gray-500/30'
                  : 'bg-transparent border-gray-500/20 hover:bg-gray-500/5'
                  }`}
              >
                <BrainCircuit size={14} className={`${message.isThinking ? 'text-brand-400 animate-pulse' : 'text-gray-400'}`} />
                <span className="text-xs font-medium text-gray-300 flex-1 text-left">
                  {message.isThinking
                    ? (language === 'zh' ? '思考中...' : 'Thinking...')
                    : (language === 'zh' ? '查看思考过程' : 'View thinking process')
                  }
                </span>
                <ChevronDown size={14} className={`text-gray-500 transition-transform duration-200 ${isThinkingExpanded ? 'rotate-180' : ''}`} />
              </button>
            )}

            {/* Expanded thinking content - shows NATIVE thinking summaries from Gemini */}
            {/* Uses streaming content OR persisted content from message */}
            {isThinkingExpanded && (nativeThinkingText || message.thinkingContent) && (
              <div className="mb-3 p-3 bg-gray-500/5 border border-gray-500/20 rounded-lg text-xs text-gray-300 font-mono max-h-60 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-top-2">
                <ReactMarkdown components={MarkdownComponents}>
                  {nativeThinkingText || message.thinkingContent || ''}
                </ReactMarkdown>
              </div>
            )}

            {/* Final answer - Show during streaming AND after completion */}
            {finalContent && !isFeedback && (
              <div className={`relative px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm bg-transparent border border-dark-border text-gray-200 rounded-tl-none`}>
                <div className="markdown-content w-full min-w-0 break-words">
                  <ReactMarkdown components={MarkdownComponents}>
                    {finalContent}
                  </ReactMarkdown>
                  {/* Show streaming cursor when still thinking */}
                  {message.isThinking && <span className="inline-block w-2 h-4 bg-brand-400 animate-pulse ml-1" />}
                </div>

                {!message.isThinking && finalContent && !isSystem && (
                  <div className={`absolute -bottom-8 left-0 opacity-0 group-hover:opacity-100 transition-opacity`}>
                    <button onClick={handleCopy} className="flex items-center gap-1.5 px-2 py-1 bg-dark-surface border border-dark-border rounded-md text-[10px] text-gray-400 hover:text-white transition-colors shadow-lg">
                      {isCopied ? <Check size={10} className="text-green-500" /> : <Copy size={10} />}
                      {isCopied ? t('chat.copied') : 'Copy'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TOOL CALL SECTION - Shows when AI is calling a tool */}
        {!isUser && !isSystem && toolCallStatus && toolCallStatus.isActive && (
          <div className="w-full max-w-md mt-2 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-xl overflow-hidden animate-in fade-in">
            <button
              onClick={onToolCallToggle}
              className="w-full flex items-center gap-3 p-3 hover:bg-white/5 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
                <ImageIcon size={16} className="text-purple-400 animate-pulse" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2 text-xs font-medium text-purple-300">
                  <span>{language === 'zh' ? '正在生成图像' : 'Generating Image'}</span>
                  <span className="px-1.5 py-0.5 bg-purple-500/20 rounded text-[10px]">
                    {toolCallStatus.model}
                  </span>
                </div>
              </div>
              <div className="w-4 h-4 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin shrink-0" />
              <ChevronDown size={14} className={`text-purple-400 transition-transform shrink-0 ${toolCallExpanded ? 'rotate-180' : ''}`} />
            </button>
            {toolCallExpanded && toolCallStatus.prompt && (
              <div className="px-3 pb-3 border-t border-purple-500/20">
                <div className="mt-2 max-h-24 overflow-y-auto text-xs text-gray-400 whitespace-pre-wrap custom-scrollbar">
                  {toolCallStatus.prompt}
                </div>
              </div>
            )}
          </div>
        )}

        {/* User and System messages - Original display */}
        {(isUser || isSystem) && (finalContent || isUser) && !isFeedback && (
          <div className={`relative px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${isSystem
            ? 'bg-amber-900/10 border border-amber-500/20 text-amber-200/90 rounded-tl-none font-mono text-xs'
            : 'bg-dark-surface text-gray-100 rounded-tr-none'
            }`}>
            <div className="markdown-content w-full min-w-0 break-words">
              <ReactMarkdown components={MarkdownComponents}>
                {finalContent || "..."}
              </ReactMarkdown>
            </div>

            {!message.isThinking && finalContent && !isSystem && (
              <div className={`absolute -bottom-8 ${isUser ? 'right-0' : 'left-0'} opacity-0 group-hover:opacity-100 transition-opacity`}>
                <button onClick={handleCopy} className="flex items-center gap-1.5 px-2 py-1 bg-dark-surface border border-dark-border rounded-md text-[10px] text-gray-400 hover:text-white transition-colors shadow-lg">
                  {isCopied ? <Check size={10} className="text-green-500" /> : <Copy size={10} />}
                  {isCopied ? t('chat.copied') : 'Copy'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Thinking Indicator if no steps and no content yet */}
        {!isUser && message.isThinking && steps.length === 0 && !finalContent && (
          <div className="flex gap-1 items-center h-5 ml-2">
            <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
            <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
            <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" />
          </div>
        )}
      </div>
    </div>
  );
};
