
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Image as ImageIcon, Video, LayoutGrid, Folder, Sparkles, Settings, Star, CheckSquare, MoveHorizontal, Brush, X, Languages, Trash2, Recycle } from 'lucide-react';
import { AppMode, AspectRatio, GenerationParams, AssetItem, ImageResolution, VideoResolution, ImageModel, VideoModel, ImageStyle, Project, ChatMessage, BackgroundTask } from './types';
import { GenerationForm } from './components/GenerationForm';
import { AssetCard } from './components/AssetCard';
import { ProjectSidebar } from './components/ProjectSidebar';
import { SettingsDialog } from './components/SettingsDialog';
import { LightboxViewer } from './components/LightboxViewer';
import { TaskCenter } from './components/TaskCenter';
import { ComparisonView } from './components/ComparisonView';
import { CanvasEditor } from './components/CanvasEditor';
import { ToastContainer, ToastMessage } from './components/Toast';
import { ConfirmDialog } from './components/ConfirmDialog';
import { generateImage, generateVideo, resumeVideoGeneration, promptForVeoKey, checkVeoAuth, generateProjectName, getUserApiKey } from './services/geminiService';
import { initDB, loadProjects, loadAssets, saveProject, saveAsset, updateAsset, deleteProjectFromDB, permanentlyDeleteAssetFromDB, softDeleteAssetInDB, restoreAssetInDB } from './services/storageService';
import { useLanguage } from './contexts/LanguageContext';

const DEFAULT_PARAMS: GenerationParams = {
  prompt: '',
  aspectRatio: AspectRatio.SQUARE,
  continuousMode: false,
  imageModel: ImageModel.FLASH,
  imageResolution: ImageResolution.RES_1K,
  imageStyle: ImageStyle.NONE,
  videoModel: VideoModel.VEO_FAST,
  videoResolution: VideoResolution.RES_720P,
  isAnnotatedReference: false,
  numberOfImages: 1
};

const playSuccessSound = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1046.5, t);
    gain1.gain.setValueAtTime(0, t);
    gain1.gain.linearRampToValueAtTime(0.15, t + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc1.start(t);
    osc1.stop(t + 0.2);
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1318.5, t + 0.12);
    gain2.gain.setValueAtTime(0, t + 0.12);
    gain2.gain.linearRampToValueAtTime(0.15, t + 0.14);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    osc2.start(t + 0.12);
    osc2.stop(t + 0.8);
  } catch (e) {
    console.warn("Audio notification failed", e);
  }
};

const playErrorSound = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.4);
    
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
    
    osc.start(t);
    osc.stop(t + 0.4);
  } catch (e) {
    console.warn("Audio notification failed", e);
  }
};

export function App() {
  const { t, language, setLanguage } = useLanguage();

  const [isLoaded, setIsLoaded] = useState(false);
  const [mode, setMode] = useState<AppMode>(AppMode.IMAGE);
  const [activeTab, setActiveTab] = useState<'studio' | 'chat'>('studio'); 
  const [viewMode, setViewMode] = useState<'GALLERY' | 'TRASH'>('GALLERY');
  
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const taskControllers = useRef<Record<string, AbortController>>({});
  
  // Global Video Cooldown
  const [videoCooldownEndTime, setVideoCooldownEndTime] = useState<number>(0);

  const generatingStates = useMemo(() => {
    const states: Record<string, number> = {};
    tasks.forEach(task => {
      if ((task.status === 'GENERATING' || task.status === 'QUEUED') && !states[task.projectId]) {
        states[task.projectId] = task.executionStartTime || task.startTime;
      }
    });
    return states;
  }, [tasks]);
  
  const [veoVerified, setVeoVerified] = useState(() => !!getUserApiKey());
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [showProjects, setShowProjects] = useState(false); 
  const [showSettings, setShowSettings] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatSelectedImages, setChatSelectedImages] = useState<string[]>([]); 
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<AssetItem | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [comparisonAssets, setComparisonAssets] = useState<[AssetItem, AssetItem] | null>(null);
  const [canvasAsset, setCanvasAsset] = useState<AssetItem | null>(null);

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean; title: string; message: string; action: () => void; isDestructive: boolean; confirmLabel: string; cancelLabel: string;
  }>({ isOpen: false, title: '', message: '', action: () => {}, isDestructive: false, confirmLabel: '', cancelLabel: '' });

  const [params, setParams] = useState<GenerationParams>(DEFAULT_PARAMS);
  const promptCache = useRef<Record<string, string>>({});
  const activeProjectIdRef = useRef(activeProjectId);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

  useEffect(() => {
    const initialize = async () => {
      try {
        await initDB();
        const [loadedProjects, loadedAssets] = await Promise.all([loadProjects(), loadAssets()]);

        if (loadedProjects.length > 0) {
          loadedProjects.sort((a, b) => b.updatedAt - a.updatedAt);
          setProjects(loadedProjects);
          const lastActive = loadedProjects[0];
          setActiveProjectId(lastActive.id);
          if (lastActive.savedParams) setParams(lastActive.savedParams);
          if (lastActive.savedMode) {
             setMode(lastActive.savedMode);
             if (lastActive.savedMode === AppMode.VIDEO) setChatHistory(lastActive.videoChatHistory || []);
             else setChatHistory(lastActive.chatHistory || []);
          }
          promptCache.current = { [lastActive.savedMode || AppMode.IMAGE]: lastActive.savedParams?.prompt || '' };
        } else {
          createNewProject(true); 
        }
        setAssets(loadedAssets);

        const pendingVideos = loadedAssets.filter(a => a.status === 'GENERATING' && a.operationName);
        if (pendingVideos.length > 0) {
            console.log(`[Lumina] Found ${pendingVideos.length} pending video tasks. Recovering...`);
            pendingVideos.forEach(asset => {
                const taskId = asset.id;
                setTasks(prev => [...prev, {
                    id: taskId,
                    projectId: asset.projectId,
                    projectName: loadedProjects.find(p => p.id === asset.projectId)?.name || 'Project',
                    type: 'VIDEO',
                    status: 'GENERATING',
                    startTime: asset.createdAt,
                    executionStartTime: asset.createdAt,
                    prompt: asset.prompt
                }]);

                resumeVideoGeneration(asset.operationName!)
                    .then(async (url) => {
                        const updates = { status: 'COMPLETED' as const, url };
                        await updateAsset(asset.id, updates);
                        setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, ...updates } : a));
                        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'COMPLETED' } : t));
                        addToast('success', 'Video Recovered', 'A background video generation has finished.');
                        playSuccessSound();
                    })
                    .catch(async (err) => {
                        const updates = { status: 'FAILED' as const };
                        await updateAsset(asset.id, updates);
                        setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, ...updates } : a));
                        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'FAILED', error: err.message } : t));
                        playErrorSound();
                        
                        // If recovery failed with quota, trigger cooldown
                        if (err.message.includes('429') || err.message.includes('Quota')) {
                           setVideoCooldownEndTime(Date.now() + 60000);
                        }
                    });
            });
        }
      } catch (e) {
        console.error("Storage Init Failed:", e);
        createNewProject(true);
      } finally {
        setIsLoaded(true);
      }
    };
    initialize();
  }, []);

  useEffect(() => {
    if (!isLoaded || !activeProjectId) return;
    const currentId = activeProjectId;
    setProjects(prev => prev.map(p => 
      p.id === currentId ? { 
        ...p, savedParams: params, savedMode: mode, 
        chatHistory: mode === AppMode.IMAGE ? chatHistory : p.chatHistory,
        videoChatHistory: mode === AppMode.VIDEO ? chatHistory : p.videoChatHistory
      } : p
    ));
    const handler = setTimeout(() => {
      const currentProject = projects.find(p => p.id === currentId);
      if (currentProject) {
         saveProject({ 
           ...currentProject, savedParams: params, savedMode: mode, 
           chatHistory: mode === AppMode.IMAGE ? chatHistory : currentProject.chatHistory,
           videoChatHistory: mode === AppMode.VIDEO ? chatHistory : currentProject.videoChatHistory
         }).catch(console.error);
      }
    }, 1000);
    return () => clearTimeout(handler);
  }, [params, mode, activeProjectId, isLoaded, chatHistory]); 

  const addToast = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    setToasts(prev => [...prev, { id: crypto.randomUUID(), type, title, message }]);
  };
  const removeToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  const handleModeSwitch = (targetMode: AppMode) => {
    setViewMode('GALLERY'); 
    if (mode === targetMode) return;
    promptCache.current[mode] = params.prompt;
    setProjects(prev => prev.map(p => p.id === activeProjectId ? {
       ...p, chatHistory: mode === AppMode.IMAGE ? chatHistory : p.chatHistory, videoChatHistory: mode === AppMode.VIDEO ? chatHistory : p.videoChatHistory
      } : p));
    const nextPrompt = promptCache.current[targetMode] ?? '';
    const currentProject = projects.find(p => p.id === activeProjectId);
    const nextHistory = (currentProject && targetMode === AppMode.VIDEO ? currentProject.videoChatHistory : currentProject?.chatHistory) || [];
    setMode(targetMode);
    setParams(prev => ({ ...prev, prompt: nextPrompt }));
    setChatHistory(nextHistory);
  };

  const createNewProject = (isInit = false) => {
    const newProject: Project = {
      id: crypto.randomUUID(), name: t('nav.new_project'), createdAt: Date.now(), updatedAt: Date.now(),
      savedParams: DEFAULT_PARAMS, savedMode: AppMode.IMAGE, chatHistory: [], videoChatHistory: []
    };
    if (isInit) {
      setProjects([newProject]); setActiveProjectId(newProject.id); saveProject(newProject);
      promptCache.current = { [AppMode.IMAGE]: '' };
    } else {
      setProjects(prev => [newProject, ...prev]); saveProject(newProject); switchProject(newProject.id, newProject); setShowProjects(true);
    }
    setViewMode('GALLERY');
  };

  const switchProject = (projectId: string, targetProjectOverride?: Project) => {
    const targetProject = targetProjectOverride || projects.find(p => p.id === projectId);
    if (!targetProject) return;
    setActiveProjectId(projectId);
    setParams(targetProject.savedParams || DEFAULT_PARAMS);
    setMode(targetProject.savedMode || AppMode.IMAGE);
    setChatHistory((targetProject.savedMode === AppMode.VIDEO ? targetProject.videoChatHistory : targetProject.chatHistory) || []);
    setChatSelectedImages([]);
    promptCache.current = { [targetProject.savedMode || AppMode.IMAGE]: targetProject.savedParams?.prompt || '' };
    setSelectedAssetIds(new Set());
    setIsSelectionMode(false);
    setViewMode('GALLERY');
  };

  const handleAuthVerify = async () => {
    const userKey = getUserApiKey();
    if (userKey) { setVeoVerified(true); return; }
    try { await promptForVeoKey(); setVeoVerified(true); } catch { setShowSettings(true); }
  };

  const toggleAssetSelection = (asset: AssetItem) => {
     if (selectedAssetIds.has(asset.id)) {
        setSelectedAssetIds(prev => { const next = new Set(prev); next.delete(asset.id); return next; });
     } else {
        if (selectedAssetIds.size >= 2) { addToast('info', 'Comparison Limit', 'You can only select up to 2 images to compare.'); return; }
        setSelectedAssetIds(prev => { const next = new Set(prev); next.add(asset.id); return next; });
     }
  };

  const handleCompare = () => {
     const selected = assets.filter(a => selectedAssetIds.has(a.id));
     if (selected.length !== 2) { addToast('info', 'Comparison', 'Please select exactly 2 items to compare.'); return; }
     setComparisonAssets([selected[0], selected[1]]);
  };

  const handleCanvasSave = (dataUrl: string) => {
     handleUseAsReference({ ...canvasAsset!, url: dataUrl }, true); 
     setParams(prev => ({ ...prev, prompt: `Edit the area marked in red: [Describe change here]`, isAnnotatedReference: true }));
     setCanvasAsset(null);
  };

  const handleUseAsReference = (asset: AssetItem, isAnnotated = false) => {
    if (asset.type !== 'IMAGE') return;
    if (mode !== AppMode.IMAGE) handleModeSwitch(AppMode.IMAGE);
    const matches = asset.url.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
      setActiveTab('studio');
      setParams(prev => ({
        ...prev, referenceImageMimeType: matches[1], referenceImage: matches[2],
        prompt: isAnnotated ? prev.prompt : asset.prompt, isAnnotatedReference: isAnnotated
      }));
      if (!isAnnotated) promptCache.current[AppMode.IMAGE] = asset.prompt;
    }
  };

  const handleVideoContinue = async (imageData: string, mimeType: string) => {
      if (mode !== AppMode.VIDEO) handleModeSwitch(AppMode.VIDEO);
      setActiveTab('studio');
      setParams(prev => ({ ...prev, videoStartImage: imageData, videoStartImageMimeType: mimeType, prompt: `${prev.prompt} . Continue the scene smoothly` }));
      addToast('info', 'Video Continuation', 'Captured frame set as Start Frame. Adjust prompt to continue.');
  };

  const handleGenerate = async (overrideParams?: Partial<GenerationParams>) => {
    // 1. Check Global Cooldown
    if (Date.now() < videoCooldownEndTime) {
       addToast('error', 'System Cooled Down', 'Please wait for the timer to finish before generating again.');
       return;
    }

    const userKey = getUserApiKey();
    if (!process.env.API_KEY && !userKey) { setShowSettings(true); return; }
    
    const activeParams = { ...params, ...overrideParams };
    const currentProjectId = activeProjectId;
    const currentMode = mode;

    const project = projects.find(p => p.id === currentProjectId);
    if (project && (project.name === 'New Project' || project.name === t('nav.new_project')) && activeParams.prompt) {
       generateProjectName(activeParams.prompt).then(name => {
          setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, name } : p));
          saveProject({ ...project, name }).catch(console.error);
       });
    }
    
    const launchTask = async (index: number, taskSeed?: number) => {
       const taskId = crypto.randomUUID();
       const controller = new AbortController();
       taskControllers.current[taskId] = controller;
       
       setTasks(prev => [...prev, {
          id: taskId, projectId: currentProjectId, projectName: projects.find(p=>p.id===currentProjectId)?.name||'Project',
          type: currentMode === AppMode.IMAGE ? 'IMAGE' : 'VIDEO', status: 'QUEUED', startTime: Date.now(), prompt: activeParams.prompt
       }]);

       try {
         const onStart = () => { setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'GENERATING', executionStartTime: Date.now() } : t)); };

         let asset: AssetItem;
         const genParams = { ...activeParams, seed: taskSeed };

         if (currentMode === AppMode.IMAGE) {
            asset = await generateImage(genParams, currentProjectId, onStart, controller.signal);
            await saveAsset(asset);
            setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'COMPLETED' } : t));
            setAssets(prev => [asset, ...prev]);
         } else {
            // Video Persistence
            const tempAssetId = taskId;
            const tempAsset: AssetItem = {
                id: tempAssetId, projectId: currentProjectId, type: 'VIDEO', url: '', prompt: activeParams.prompt, createdAt: Date.now(), status: 'GENERATING', 
                metadata: { aspectRatio: activeParams.aspectRatio, model: activeParams.videoModel, style: activeParams.videoStyle, duration: activeParams.videoDuration, resolution: activeParams.videoResolution }
            };
            
            await saveAsset(tempAsset);
            setAssets(prev => [tempAsset, ...prev]);
            
            const videoUrl = await generateVideo(
                genParams, 
                async (operationName) => { await updateAsset(tempAssetId, { operationName }); },
                onStart, 
                controller.signal
            );

            const updates = { status: 'COMPLETED' as const, url: videoUrl };
            await updateAsset(tempAssetId, updates);
            setAssets(prev => prev.map(a => a.id === tempAssetId ? { ...a, ...updates } : a));
            setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'COMPLETED' } : t));
            asset = { ...tempAsset, ...updates }; 
         }

         playSuccessSound();

         if (activeParams.continuousMode && asset.type === 'IMAGE') {
            handleUseAsReference(asset, false);
         }

       } catch (error: any) {
         if (error.message === 'Cancelled' || error.name === 'AbortError') {
             setTasks(prev => prev.filter(t => t.id !== taskId));
             if (currentMode === AppMode.VIDEO) {
                 try { await updateAsset(taskId, { status: 'FAILED' }); setAssets(prev => prev.map(a => a.id === taskId ? { ...a, status: 'FAILED' } : a)); } catch {}
             }
         } else {
             setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'FAILED', error: error.message } : t));
             
             if (currentMode === AppMode.VIDEO) {
                 try { await updateAsset(taskId, { status: 'FAILED' }); setAssets(prev => prev.map(a => a.id === taskId ? { ...a, status: 'FAILED' } : a)); } catch {}
             }
             
             playErrorSound();

             // GLOBAL COOLDOWN TRIGGER
             if (error.message.includes('429') || error.message.includes('Quota') || error.message.includes('RESOURCE_EXHAUSTED')) {
                const cooldownDuration = 60000; // 60s
                setVideoCooldownEndTime(Date.now() + cooldownDuration);
                addToast('error', 'Server Busy', 'Quota Limit reached. System is cooling down for 60 seconds.');
             } else {
                addToast('error', 'Generation Failed', error.message);
             }
         }
       } finally {
         delete taskControllers.current[taskId];
       }
    };

    const count = activeParams.numberOfImages || 1;
    const baseSeed = activeParams.seed;
    const tasksToLaunch = [];
    for (let i = 0; i < count; i++) {
        let taskSeed = baseSeed;
        if (taskSeed === undefined) taskSeed = Math.floor(Math.random() * 2147483647);
        tasksToLaunch.push(launchTask(i, taskSeed));
    }
    await Promise.all(tasksToLaunch);
  };

  const handleCancelTask = (taskId: string) => { if (taskControllers.current[taskId]) taskControllers.current[taskId].abort(); };
  const handleClearCompletedTasks = () => { setTasks(prev => prev.filter(t => t.status === 'GENERATING' || t.status === 'QUEUED')); };

  const handleDeleteProject = async (projectId: string) => {
    await deleteProjectFromDB(projectId);
    setProjects(prev => prev.filter(p => p.id !== projectId));
    setAssets(prev => prev.filter(a => a.projectId !== projectId));
    if (activeProjectId === projectId) {
      const remaining = projects.filter(p => p.id !== projectId);
      if (remaining.length > 0) switchProject(remaining[0].id, remaining[0]);
      else createNewProject(true);
    }
  };

  const openConfirmDelete = (assetId: string) => {
    setConfirmDialog({
      isOpen: true, title: t('confirm.delete.title'), message: t('confirm.delete.desc'), confirmLabel: t('btn.delete'), cancelLabel: t('btn.cancel'), isDestructive: true,
      action: async () => {
         const asset = assets.find(a => a.id === assetId);
         if (asset) { await softDeleteAssetInDB(asset); setAssets(prev => prev.map(a => a.id === assetId ? { ...a, deletedAt: Date.now() } : a)); }
         setConfirmDialog(prev => ({ ...prev, isOpen: false }));
         if (selectedAsset?.id === assetId) setSelectedAsset(null);
      }
    });
  };

  const handleRestoreAsset = async (assetId: string) => {
      const asset = assets.find(a => a.id === assetId);
      if (asset) { await restoreAssetInDB(asset); setAssets(prev => prev.map(a => a.id === assetId ? { ...a, deletedAt: undefined } : a)); }
  };

  const openConfirmDeleteForever = (assetId: string) => {
    setConfirmDialog({
      isOpen: true, title: t('confirm.delete_forever.title'), message: t('confirm.delete_forever.desc'), confirmLabel: t('btn.delete_forever'), cancelLabel: t('btn.cancel'), isDestructive: true,
      action: async () => { await permanentlyDeleteAssetFromDB(assetId); setAssets(prev => prev.filter(a => a.id !== assetId)); setConfirmDialog(prev => ({ ...prev, isOpen: false })); }
    });
  };

  const openConfirmEmptyTrash = () => {
    setConfirmDialog({
      isOpen: true, title: t('confirm.empty_trash.title'), message: t('confirm.empty_trash.desc'), confirmLabel: t('btn.empty_trash'), cancelLabel: t('btn.cancel'), isDestructive: true,
      action: async () => {
         const trashAssets = assets.filter(a => a.deletedAt !== undefined);
         for (const asset of trashAssets) await permanentlyDeleteAssetFromDB(asset.id);
         setAssets(prev => prev.filter(a => a.deletedAt === undefined));
         setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  if (!isLoaded) return <div className="h-screen w-screen bg-dark-bg text-white flex items-center justify-center">Loading Studio...</div>;

  const allTrashAssets = assets.filter(a => a.deletedAt !== undefined);
  const currentProjectAssets = assets.filter(a => a.projectId === activeProjectId && a.deletedAt === undefined);
  const displayedAssets = viewMode === 'TRASH' ? allTrashAssets : (showFavoritesOnly ? currentProjectAssets.filter(a => a.isFavorite) : currentProjectAssets);

  return (
    <div className="flex h-screen bg-dark-bg text-gray-200 font-sans overflow-hidden selection:bg-brand-500/30">
      <div className="w-20 flex flex-col items-center py-6 bg-dark-panel border-r border-dark-border z-30 shrink-0">
        <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-indigo-600 rounded-xl shadow-lg shadow-brand-500/20 mb-8 flex items-center justify-center">
          <Sparkles className="text-white" size={24} />
        </div>
        <div className="flex flex-col gap-4 w-full px-2">
           <button onClick={() => setShowProjects(true)} className="flex flex-col items-center gap-1 p-3 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-all group relative">
             <Folder size={24} className={showProjects ? 'text-brand-500' : ''} />
             <span className="text-[10px] font-medium text-center">{t('nav.projects')}</span>
           </button>
           <div className="w-full h-px bg-white/5 my-2" />
           <button onClick={() => handleModeSwitch(AppMode.IMAGE)} className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${mode === AppMode.IMAGE && viewMode === 'GALLERY' ? 'bg-brand-500/10 text-brand-400 shadow-inner' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
             <ImageIcon size={24} />
             <span className="text-[10px] font-medium text-center">{t('nav.image')}</span>
           </button>
           <button onClick={() => handleModeSwitch(AppMode.VIDEO)} className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${mode === AppMode.VIDEO && viewMode === 'GALLERY' ? 'bg-purple-500/10 text-purple-400 shadow-inner' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
             <Video size={24} />
             <span className="text-[10px] font-medium text-center">{t('nav.video')}</span>
           </button>
           <div className="w-full h-px bg-white/5 my-2" />
           <button onClick={() => setViewMode('TRASH')} className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${viewMode === 'TRASH' ? 'bg-red-500/10 text-red-400 shadow-inner' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
             <Trash2 size={24} />
             <span className="text-[10px] font-medium text-center">{t('nav.trash')}</span>
           </button>
        </div>
        <div className="mt-auto flex flex-col gap-4 w-full px-2">
           <button onClick={() => setShowSettings(true)} className="flex flex-col items-center gap-1 p-3 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-all"><Settings size={24} /></button>
        </div>
      </div>

      <ProjectSidebar 
        isOpen={showProjects}
        onClose={() => setShowProjects(false)}
        projects={projects}
        activeProjectId={activeProjectId}
        generatingStates={generatingStates}
        onSelectProject={(id) => switchProject(id)}
        onCreateProject={() => createNewProject()}
        onRenameProject={(id, name) => { const p = projects.find(p => p.id === id); if (p) { const updated = { ...p, name }; setProjects(prev => prev.map(prj => prj.id === id ? updated : prj)); saveProject(updated); } }}
        onDeleteProject={handleDeleteProject}
      />

      <div className="flex-1 flex overflow-hidden relative">
         {viewMode === 'GALLERY' && (
             <GenerationForm 
               mode={mode} 
               params={params} 
               setParams={setParams}
               isGenerating={tasks.some(t => t.projectId === activeProjectId && (t.status === 'GENERATING' || t.status === 'QUEUED'))}
               startTime={generatingStates[activeProjectId]}
               onGenerate={handleGenerate}
               onVerifyVeo={handleAuthVerify}
               veoVerified={veoVerified}
               chatHistory={chatHistory}
               setChatHistory={setChatHistory}
               activeTab={activeTab}
               onTabChange={setActiveTab}
               chatSelectedImages={chatSelectedImages}
               setChatSelectedImages={setChatSelectedImages}
               projectId={activeProjectId}
               cooldownEndTime={videoCooldownEndTime}
             />
         )}

         <div className="flex-1 bg-dark-bg flex flex-col min-w-0 relative">
            <div className={`h-16 border-b border-dark-border flex items-center justify-between px-6 shrink-0 bg-dark-bg/80 backdrop-blur z-10 ${viewMode === 'TRASH' ? 'bg-red-950/20' : ''}`}>
               <div className="flex items-center gap-4">
                  {viewMode === 'TRASH' ? (
                     <div className="flex items-center gap-3">
                        <Trash2 size={20} className="text-red-400" />
                        <h1 className="text-xl font-bold text-white">{t('header.trash')}</h1>
                        {displayedAssets.length > 0 && (
                          <button onClick={openConfirmEmptyTrash} className="ml-4 px-3 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold hover:bg-red-500 hover:text-white transition-all flex items-center gap-2"><Trash2 size={12} /> {t('btn.empty_trash')}</button>
                        )}
                     </div>
                  ) : (
                     <h1 className="text-xl font-bold text-white flex items-center gap-2">{projects.find(p => p.id === activeProjectId)?.name}</h1>
                  )}
                  {viewMode === 'GALLERY' && (
                     isSelectionMode ? (
                        <div className="flex items-center gap-2 animate-in slide-in-from-left-5 fade-in">
                           <span className="px-2 py-1 bg-brand-500/20 text-brand-400 text-xs font-bold rounded-lg border border-brand-500/30">{selectedAssetIds.size} {t('header.selected')}</span>
                           {selectedAssetIds.size === 2 && (
                              <button onClick={handleCompare} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-medium transition-colors"><MoveHorizontal size={14} /> {t('header.compare')}</button>
                           )}
                           <button onClick={() => { setIsSelectionMode(false); setSelectedAssetIds(new Set()); }} className="p-1.5 text-gray-400 hover:text-white"><X size={16} /></button>
                        </div>
                     ) : (
                        <div className="flex items-center gap-2">
                           <button onClick={() => setShowFavoritesOnly(!showFavoritesOnly)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${showFavoritesOnly ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30' : 'text-gray-400 hover:bg-white/5'}`}><Star size={14} fill={showFavoritesOnly ? "currentColor" : "none"} /> {t('header.favorites')}</button>
                           <button onClick={() => setIsSelectionMode(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:bg-white/5 transition-all"><MoveHorizontal size={14} /> {t('header.compare')}</button>
                        </div>
                     )
                  )}
               </div>
               <div className="flex items-center gap-4">
                  <div className="text-xs text-gray-500 font-medium">{displayedAssets.length} {viewMode === 'TRASH' ? t('header.trash_count') : t('header.assets')}</div>
                  <button onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all" title={language === 'en' ? 'Switch to Chinese' : 'Switch to English'}><Languages size={16} />{language === 'en' ? 'EN' : 'CN'}</button>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
               {displayedAssets.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-600 opacity-50">
                     {viewMode === 'TRASH' ? (
                        <>
                           <Recycle size={48} className="mb-4 text-green-500/50" />
                           <p className="text-lg font-medium">{t('msg.no_trash')}</p>
                        </>
                     ) : (
                        <>
                           <LayoutGrid size={48} className="mb-4" />
                           <p className="text-lg font-medium">{t('msg.no_assets')}</p>
                           <p className="text-sm">{t('msg.generate_something')}</p>
                        </>
                     )}
                  </div>
               ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-20">
                     {displayedAssets.map(asset => (
                        <AssetCard 
                           key={asset.id} 
                           asset={asset} 
                           onClick={(a) => setSelectedAsset(a)}
                           onUseAsReference={handleUseAsReference}
                           onDelete={() => viewMode === 'TRASH' ? openConfirmDeleteForever(asset.id) : openConfirmDelete(asset.id)}
                           onAddToChat={(a) => { setActiveTab('chat'); setChatSelectedImages(prev => [...prev, a.url]); }}
                           onToggleFavorite={(a) => { const updated = { ...a, isFavorite: !a.isFavorite }; setAssets(prev => prev.map(item => item.id === a.id ? updated : item)); saveAsset(updated); }}
                           isSelectionMode={isSelectionMode}
                           isSelected={selectedAssetIds.has(asset.id)}
                           onToggleSelection={toggleAssetSelection}
                           isTrashMode={viewMode === 'TRASH'}
                           onRestore={() => handleRestoreAsset(asset.id)}
                        />
                     ))}
                  </div>
               )}
            </div>
         </div>
      </div>

      <TaskCenter tasks={tasks} onRemoveTask={handleCancelTask} onClearCompleted={handleClearCompletedTasks} />
      <SettingsDialog isOpen={showSettings} onClose={() => setShowSettings(false)} onApiKeyChange={() => setVeoVerified(!!getUserApiKey())} />
      <ConfirmDialog isOpen={confirmDialog.isOpen} title={confirmDialog.title} message={confirmDialog.message} onConfirm={confirmDialog.action} onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))} confirmLabel={confirmDialog.confirmLabel} cancelLabel={confirmDialog.cancelLabel} isDestructive={confirmDialog.isDestructive} />
      {selectedAsset && <LightboxViewer asset={selectedAsset} onClose={() => setSelectedAsset(null)} onUseAsReference={viewMode === 'TRASH' ? undefined : handleUseAsReference} onExtendVideo={viewMode === 'TRASH' ? undefined : handleVideoContinue} onDelete={() => { if (viewMode === 'TRASH') openConfirmDeleteForever(selectedAsset.id); else openConfirmDelete(selectedAsset.id); setSelectedAsset(null); }} onAddToChat={viewMode === 'TRASH' ? undefined : (a) => { setActiveTab('chat'); setChatSelectedImages(prev => [...prev, a.url]); }} onInpaint={viewMode === 'TRASH' ? undefined : (asset) => setCanvasAsset(asset)} />}
      {comparisonAssets && <ComparisonView assetA={comparisonAssets[0]} assetB={comparisonAssets[1]} onClose={() => setComparisonAssets(null)} />}
      {canvasAsset && <CanvasEditor imageUrl={canvasAsset.url} onSave={handleCanvasSave} onClose={() => setCanvasAsset(null)} />}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
