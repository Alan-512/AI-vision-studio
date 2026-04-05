import { useState, useEffect, useRef, useMemo } from 'react';
import { Image as ImageIcon, Video, LayoutGrid, Folder, Sparkles, Settings, Star, CheckSquare, MoveHorizontal, Languages, Trash2, Recycle, Download, RotateCcw, ArrowRight, Key, X } from 'lucide-react';
import { AppMode, AspectRatio, GenerationParams, AssetItem, ImageResolution, VideoResolution, ImageModel, VideoModel, ImageStyle, Project, ChatMessage, BackgroundTask, SmartAsset, VideoDuration, VideoStyle, AgentAction, EditRegion, SearchPolicy, AssistantMode, SmartAssetRole, ThinkingLevel, AgentJob, JobStep, JobArtifact, AgentToolResult, ToolCallRecord, ConsistencyProfile } from './types';
import { GenerationForm } from './components/GenerationForm';
import { AssetCard } from './components/AssetCard';
import { ProjectSidebar } from './components/ProjectSidebar';
import { ToastContainer, ToastMessage } from './components/Toast';
import { TaskCenter } from './components/TaskCenter';
import { SettingsDialog } from './components/SettingsDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ComparisonView } from './components/ComparisonView';
import { CanvasEditor } from './components/CanvasEditor';
import { CanvasView } from './components/CanvasView';
import { generateImage, generateVideo, getUserApiKey, generateTitle } from './services/geminiService';
import { compressImageForContext, normalizeImageUrlForChat } from './services/imageUtils';
import { buildImageCriticContext } from './services/imageCriticService';
import {
    SelectedReferenceRecord,
    extractSearchContextFromProgress,
    selectReferenceRecords,
} from './services/agentRuntime';
import { deriveBackgroundTaskView, dismissTaskViewsByIds, planTaskViewSyncForJob } from './services/taskReadModel';
import { applyTaskViewProjectionResult, createTaskViewDismissalController, createTaskViewProjectionController } from './services/taskProjectionPersistence';
import { reviewGeneratedAsset } from './services/assetReviewRuntime';
import { createGenerationTaskLaunchController } from './services/generationTaskLaunchController';
import { executeAutoRevisionAttempt, executeGenerationAttempt } from './services/generationExecutionRuntime';
import { executeAutoRevisionFlow } from './services/generationAutoRevisionRuntime';
import { resolveGenerationFailure } from './services/generationFailureRuntime';
import { executeAutoRevisionReview, executePrimaryReview } from './services/generationReviewRuntime';
import { resolveAutoRevision, resolvePrimaryReview } from './services/generationResolutionRuntime';
import { createAppGenerationTaskFlowDepsBuilder } from './services/appGenerationTaskFlowDepsRuntime';
import { prepareAppGenerationRequest } from './services/appGenerationPreflightRuntime';
import { executeAppGenerationRequest } from './services/appGenerationRequestRuntime';
import { executeAppGenerationFlow } from './services/appGenerationRuntime';
import { createAppHandleGenerate } from './services/appHandleGenerateRuntime';
import { createAppHandleGenerateContextBuilder } from './services/appHandleGenerateContextRuntime';
import { createAppAgentToolExecutor } from './services/appAgentToolRuntime';
import { createAppAgentToolCallHandler } from './services/appAgentToolCallRuntime';
import { createAppGenerationFormSurfaceProps } from './services/appGenerationFormSurfaceRuntime';
import { executeAppCancelJob } from './services/appCancelJobRuntime';
import { executeAppResolveRequiresAction } from './services/appResolveRequiresActionRuntime';
import { executeAppResumeJob } from './services/appResumeJobRuntime';
import { executeAppStartGeneration } from './services/appStartGenerationRuntime';
import { executeAppSubmitUserTurn } from './services/appSubmitTurnRuntime';
import { createAppTaskViewController } from './services/appTaskViewRuntime';
import { recoverPersistedTaskViews } from './services/appInitializationRuntime';
import { resolveKeepCurrentAction } from './services/appRequiresActionRuntime';
import { createAppAgentKernel } from './services/appAgentKernelRuntime';
import { executeChatStreamingTurn } from './services/chatStreamingRuntime';
import { buildDefaultRefinePromptRequiresAction, buildEditPrompt, normalizeGenerationParamsForExecution, prepareGenerationLaunch } from './services/generationOrchestrator';
import { resolveToolCallRecordStatus } from './services/requiresActionRuntime';
import {
    initDB, loadProjects, saveProject, saveAsset, loadAssets, updateAsset, updateProject,
    deleteProjectFromDB, softDeleteAssetInDB, restoreAssetInDB,
    permanentlyDeleteAssetFromDB, bulkPermanentlyDeleteAssets, bulkSoftDeleteAssets, recoverOrphanedProjects,
    releaseBlobUrl, saveTask, loadTasks, deleteTask, loadAgentJobs, loadAgentJobsByProject, saveAgentJob
} from './services/storageService';
import { runMemoryExtractionTask } from './services/memoryExtractor';
import { runConsolidation } from './services/memoryConsolidator';
import { useLanguage } from './contexts/LanguageContext';

// Surface/composition root only.
// App wires kernel commands, runtimes, and projections together, but should avoid
// owning durable lifecycle semantics directly.

const DEFAULT_PARAMS: GenerationParams = {
    prompt: '',
    savedImagePrompt: '',
    savedVideoPrompt: '',
    aspectRatio: AspectRatio.SQUARE,
    imageModel: ImageModel.FLASH_3_1,
    videoModel: VideoModel.VEO_FAST,
    imageStyle: ImageStyle.NONE,
    videoStyle: VideoStyle.NONE,
    imageResolution: ImageResolution.RES_1K,
    videoResolution: VideoResolution.RES_720P,
    videoDuration: VideoDuration.SHORT,
    useGrounding: false, // Explicit default for search grounding
    searchPolicy: SearchPolicy.LLM_ONLY,
};
const CHAT_DEFAULT_PARAMS: GenerationParams = {
    ...DEFAULT_PARAMS,
    continuousMode: false,
    isAutoMode: true,
    smartAssets: []
};

// Shared Audio Context to bypass browser autoplay restrictions
let globalAudioCtx: AudioContext | null = null;

const getAudioContext = () => {
    if (!globalAudioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
            globalAudioCtx = new AudioContextClass();
        }
    }
    return globalAudioCtx;
};

// Helper: Sanitize Image Model
const sanitizeImageModel = (model: string | undefined): ImageModel => {
    if (model === ImageModel.PRO || model === ImageModel.FLASH_3_1) return model;
    return ImageModel.FLASH_3_1;
};

type PlaybookDefaults = {
    aspectRatio?: AspectRatio;
    imageStyle?: ImageStyle;
    imageResolution?: ImageResolution;
    thinkingLevel?: ThinkingLevel;
    negativePrompt?: string;
    referenceMode?: string;
};

const normalizeAssistantMode = (value: unknown): AssistantMode | undefined => {
    if (typeof value !== 'string') return undefined;
    return Object.values(AssistantMode).includes(value as AssistantMode)
        ? (value as AssistantMode)
        : undefined;
};

const getPlaybookDefaults = (assistantMode: AssistantMode | undefined): PlaybookDefaults => {
    const defaults: PlaybookDefaults = {};
    switch (assistantMode) {
        case AssistantMode.CREATE_NEW:
            defaults.referenceMode = 'NONE';
            break;
        case AssistantMode.STYLE_TRANSFER:
            defaults.referenceMode = 'USER_UPLOADED_ONLY';
            break;
        case AssistantMode.EDIT_LAST:
            defaults.referenceMode = 'LAST_GENERATED';
            break;
        case AssistantMode.COMBINE_REFS:
            defaults.referenceMode = 'ALL_USER_UPLOADED';
            break;
        case AssistantMode.PRODUCT_SHOT:
            defaults.aspectRatio = AspectRatio.FOUR_FIFTHS;
            defaults.imageStyle = ImageStyle.PHOTOREALISTIC;
            defaults.negativePrompt = 'text, watermark, logo, cluttered background, low quality';
            break;
        case AssistantMode.POSTER:
            defaults.aspectRatio = AspectRatio.THREE_FOURTHS;
            defaults.negativePrompt = 'blurry, low contrast, watermark, illegible text';
            break;
        default:
            break;
    }
    return defaults;
};

const createResumeActionStep = (stepId: string, jobId: string, prompt: string, actionType?: string): JobStep => ({
    id: stepId,
    kind: 'system',
    name: 'resume_requires_action',
    status: 'success',
    input: {
        jobId,
        actionType: actionType || 'resume_job',
        prompt
    },
    output: {
        resumedAt: Date.now(),
        prompt
    }
});

const dedupeStrings = (values: Array<string | undefined | null>, limit = 8): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const normalized = value.trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
        if (result.length >= limit) break;
    }
    return result;
};

const buildConsistencyProfile = (
    assistantMode: AssistantMode | undefined,
    selectedReferences: SelectedReferenceRecord[],
    searchContext?: AgentJob['searchContext'],
    existing?: ConsistencyProfile
): ConsistencyProfile => {
    const modePreserveMap: Partial<Record<AssistantMode, string[]>> = {
        [AssistantMode.EDIT_LAST]: ['current composition', 'lighting direction', 'subject identity'],
        [AssistantMode.STYLE_TRANSFER]: ['style language', 'palette', 'visual texture'],
        [AssistantMode.PRODUCT_SHOT]: ['product silhouette', 'clean background', 'commercial clarity'],
        [AssistantMode.POSTER]: ['layout hierarchy', 'negative space', 'graphic direction'],
        [AssistantMode.COMBINE_REFS]: ['shared reference cues', 'overall composition balance']
    };
    const modeConstraintsMap: Partial<Record<AssistantMode, string[]>> = {
        [AssistantMode.EDIT_LAST]: ['preserve the current shot structure unless a fix clearly requires change'],
        [AssistantMode.PRODUCT_SHOT]: ['keep the product commercially recognizable'],
        [AssistantMode.POSTER]: ['preserve poster readability and layout intent']
    };

    const preserveSignals = dedupeStrings([
        ...(existing?.preserveSignals || []),
        ...((assistantMode && modePreserveMap[assistantMode]) || []),
        ...(selectedReferences.length > 0 ? ['reference-guided subject/style consistency'] : [])
    ]);
    const hardConstraints = dedupeStrings([
        ...(existing?.hardConstraints || []),
        ...((assistantMode && modeConstraintsMap[assistantMode]) || []),
        ...((searchContext?.facts || []).slice(0, 4).map(fact => `respect known fact: ${fact.item}`))
    ]);
    const preferredContinuity = dedupeStrings([
        ...(existing?.preferredContinuity || []),
        ...preserveSignals
    ]);

    return {
        preserveSignals,
        hardConstraints,
        preferredContinuity,
        updatedAt: Date.now(),
        referenceCount: selectedReferences.length,
        assistantMode
    };
};

const findLastModelMessageIndex = (messages: ChatMessage[]): number => {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'model') return i;
    }
    return -1;
};


// --- SYNTHETIC SOUND EFFECTS (Web Audio API) ---

const playSuccessSound = () => {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        // Ensure context is running (required for late-triggered sounds after long generation)
        if (ctx.state === 'suspended') ctx.resume();

        const now = ctx.currentTime;
        const playNote = (freq: number, startTime: number, duration: number) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(0, startTime);
            // Fix: linearRampToValueAtTime is a method of AudioParam (gain.gain), not GainNode
            gain.gain.linearRampToValueAtTime(0.08, startTime + 0.01);
            // Fix: exponentialRampToValueAtTime is a method of AudioParam (gain.gain), not GainNode
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            osc.start(startTime);
            osc.stop(startTime + duration);
        };
        // Light "ding-ding" sound
        playNote(1046.50, now, 0.3); // C6
        playNote(1318.51, now + 0.1, 0.5); // E6
    } catch (e) {
        console.warn("Failed to play success sound", e);
    }
};

const playErrorSound = () => {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        if (ctx.state === 'suspended') ctx.resume();

        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(150, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.3);
        gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.3);
    } catch (e) {
        console.warn("Failed to play error sound", e);
    }
};

export function App() {
    const { t, language, setLanguage } = useLanguage();

    // State
    const [mode, setMode] = useState<AppMode>(AppMode.IMAGE);
    const [rightPanelMode, setRightPanelMode] = useState<'GALLERY' | 'TRASH' | 'CANVAS'>('GALLERY');
    const [params, setParams] = useState<GenerationParams>(DEFAULT_PARAMS);
    const [chatParams, setChatParams] = useState<GenerationParams>(CHAT_DEFAULT_PARAMS);
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [assets, setAssets] = useState<AssetItem[]>([]);
    const [trashAssets, setTrashAssets] = useState<AssetItem[]>([]);
    const assetBlobUrlsRef = useRef<Set<string>>(new Set());
    const [projects, setProjects] = useState<Project[]>([]);
    const [trashProjects, setTrashProjects] = useState<Project[]>([]);
    const [activeProjectId, setActiveProjectId] = useState<string>('');
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [tasks, setTasks] = useState<BackgroundTask[]>([]);
    // FIX: Derive generatingStates from tasks instead of never-updating useState
    // This enables ProjectSidebar to show generation indicators and GenerationForm to get accurate startTime
    const generatingStates = useMemo(() => {
        const states: Record<string, number> = {};
        tasks.forEach(task => {
            if (task.status === 'GENERATING' || task.status === 'QUEUED' || task.status === 'REVIEWING') {
                // Use executionStartTime if available, otherwise startTime
                if (!states[task.projectId] || (task.executionStartTime && task.executionStartTime < states[task.projectId])) {
                    states[task.projectId] = task.executionStartTime || task.startTime;
                }
            }
        });
        return states;
    }, [tasks]);
    const [veoVerified, setVeoVerified] = useState(false);

    // UI State
    const [activeTab, setActiveTab] = useState<'studio' | 'chat'>('studio');
    const [chatSelectedImages, setChatSelectedImages] = useState<string[]>([]);
    const [videoCooldownEndTime, setVideoCooldownEndTime] = useState(0);
    const [contextSummary, setContextSummary] = useState<string>('');
    const [summaryCursor, setSummaryCursor] = useState<number>(0);
    const [agentContextAssets, setAgentContextAssets] = useState<SmartAsset[]>([]);

    // AI Assistant's ISOLATED edit mode parameters (separate from params config page)
    const [chatEditParams, setChatEditParams] = useState<{
        editBaseImage?: SmartAsset;
        editMask?: SmartAsset;
        editRegions?: EditRegion[];
    }>({});

    // NEW: Track draft images (构思图) from image generation
    const [thoughtImages, setThoughtImages] = useState<Array<{
        id: string;
        data: string;
        mimeType: string;
        isFinal: boolean;
        timestamp: number;
    }>>([]);

    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
    const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

    const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean, title: string, message: string, confirmLabel: string, cancelLabel: string, isDestructive?: boolean, action: () => void }>({
        isOpen: false, title: '', message: '', confirmLabel: '', cancelLabel: '', action: () => { }
    });

    const [showSettings, setShowSettings] = useState(false);
    const [apiKeyTooltipDismissed, setApiKeyTooltipDismissed] = useState(false);
    const [showProjects, setShowProjects] = useState(false);
    const [activeCanvasAsset, setActiveCanvasAsset] = useState<AssetItem | null>(null);
    const [editorAsset, setEditorAsset] = useState<AssetItem | null>(null);
    const [comparisonAssets, setComparisonAssets] = useState<[AssetItem, AssetItem] | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    const activeProjectIdRef = useRef(activeProjectId);
    const tasksRef = useRef<BackgroundTask[]>([]);
    const taskControllers = useRef<Record<string, AbortController>>({});
    // Ref to prevent updatedAt update during project initialization
    const isInitializingRef = useRef(false);
    // FIX: Prevent duplicate tool calls
    const processingToolCallRef = useRef<Set<string>>(new Set());
    // FIX: AbortController for project asset loading to prevent race conditions
    const assetLoadAbortRef = useRef<AbortController | null>(null);

    // Initialization
    useEffect(() => {
        tasksRef.current = tasks;
    }, [tasks]);

    const taskViewDismissal = createTaskViewDismissalController({
        taskViewsRef: tasksRef,
        setTaskViews: setTasks,
        deleteTaskView: deleteTask
    });

    useEffect(() => {
        let isMounted = true;

        const initializeApp = async (retryCount = 0) => {
            try {
                await initDB();
                await recoverOrphanedProjects();
                const loadedProjects = await loadProjects().then(p => p.filter(proj => !proj.deletedAt));

                if (!isMounted) return;

                // Initial sort: Newest modification first
                loadedProjects.sort((a, b) => b.updatedAt - a.updatedAt);

                if (loadedProjects.length === 0) {
                    const newProject: Project = {
                        id: crypto.randomUUID(), name: 'New Project', createdAt: Date.now(), updatedAt: Date.now(),
                        savedMode: AppMode.IMAGE, chatHistory: [], videoChatHistory: []
                    };
                    await saveProject(newProject);
                    setProjects([newProject]);
                    setActiveProjectId(newProject.id);
                } else {
                    setProjects(loadedProjects);
                    setActiveProjectId(loadedProjects[0].id);
                }

                // Load persisted tasks and recover any that were interrupted
                const persistedTasks = await loadTasks();

                const persistedAgentJobs = await loadAgentJobs();

                if (isMounted) {
                    const { recoveredAgentJobs, recoveredTaskViews } = await recoverPersistedTaskViews({
                        persistedTaskViews: persistedTasks,
                        persistedAgentJobs,
                        projects: loadedProjects,
                        saveAgentJobSnapshot: saveAgentJob,
                        saveTaskView: saveTask,
                        deleteTaskView: deleteTask
                    });
                    setTasks(recoveredTaskViews);
                    if (recoveredAgentJobs.length > 0) {
                        console.log(`[App] Recovered ${recoveredAgentJobs.length} persisted agent jobs`);
                    }
                    setIsLoaded(true);
                }
            } catch (error) {
                console.error(`[App] Initialization failed (attempt ${retryCount + 1}):`, error);

                // V2.2.3: Exponential backoff instead of creating a blank project on failure
                if (retryCount < 5 && isMounted) {
                    const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
                    console.warn(`[App] Retrying initialization in ${delay}ms...`);
                    setTimeout(() => initializeApp(retryCount + 1), delay);
                } else if (isMounted) {
                    // We failed completely. To avoid silent complete wipes, we don't init a blank project
                    // but we do allow the app to load into a broken state so the user can see errors / refresh.
                    console.error("[App] Fatal database failure. Cannot load workspace.");
                    setIsLoaded(true);
                }
            }
        };

        initializeApp();
        return () => { isMounted = false; };
    }, []);

    // V2.2: Daily consolidation at startup (runs at most once per calendar day)
    useEffect(() => {
        if (!isLoaded || !activeProjectId) return;
        // Fire-and-forget: daily guard inside runConsolidation prevents redundant runs
        runConsolidation(activeProjectId).catch(err => {
            console.error('[App] Daily consolidation failed:', err);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoaded]);

    // CRASH PROTECTION: Warn user before closing if tasks are in progress
    useEffect(() => {
        const hasActiveTasks = tasks.some(t => t.status === 'GENERATING' || t.status === 'QUEUED' || t.status === 'REVIEWING');

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (hasActiveTasks) {
                e.preventDefault();
                // Modern browsers require returnValue to be set
                e.returnValue = '';
                return '';
            }
        };

        if (hasActiveTasks) {
            window.addEventListener('beforeunload', handleBeforeUnload);
        }

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [tasks]);

    // Blob URL tracking for assets to avoid revoking active URLs
    useEffect(() => {
        const nextUrls = new Set<string>();
        assets.forEach(asset => {
            if (asset.url && asset.url.startsWith('blob:')) {
                nextUrls.add(asset.url);
            }
        });

        assetBlobUrlsRef.current.forEach((url) => {
            if (!nextUrls.has(url)) {
                releaseBlobUrl(url);
            }
        });

        assetBlobUrlsRef.current = nextUrls;
    }, [assets]);

    // Load all deleted assets globally when switching to TRASH mode
    useEffect(() => {
        if (rightPanelMode === 'TRASH') {
            loadAssets().then(allAssets => {
                const deletedAssets = allAssets.filter(a => a.deletedAt !== undefined);
                setTrashAssets(deletedAssets);
            });
        }
    }, [rightPanelMode]);

    // Project Switch Logic
    useEffect(() => {
        activeProjectIdRef.current = activeProjectId;
        if (activeProjectId) {
            const project = projects.find(p => p.id === activeProjectId);
            if (project) {
                // Mark as initializing to prevent 'Save' effect from bumping the updatedAt
                isInitializingRef.current = true;

                // FIX: Cancel any pending asset load to prevent race conditions
                if (assetLoadAbortRef.current) {
                    assetLoadAbortRef.current.abort();
                }
                assetLoadAbortRef.current = new AbortController();
                const currentLoadId = activeProjectId;

                loadAssets(activeProjectId).then(async loadedAssets => {
                    // Only update if this is still the active project
                    if (activeProjectIdRef.current === currentLoadId) {
                        // Clean up interrupted assets (GENERATING/PENDING) - delete from DB, don't show
                        const interruptedAssets = loadedAssets.filter(a => a.status === 'GENERATING' || a.status === 'PENDING');
                        const validAssets = loadedAssets.filter(a => a.status !== 'GENERATING' && a.status !== 'PENDING');

                        // Delete interrupted assets from DB silently
                        for (const asset of interruptedAssets) {
                            permanentlyDeleteAssetFromDB(asset.id).catch(console.debug);
                        }

                        setAssets(validAssets);
                    }
                });
                if (project.savedParams) {
                    let loadedParams = { ...project.savedParams };
                    if (project.savedMode === AppMode.IMAGE) {
                        if (!loadedParams.savedImagePrompt && loadedParams.prompt) loadedParams.savedImagePrompt = loadedParams.prompt;
                        loadedParams.prompt = loadedParams.savedImagePrompt || loadedParams.prompt || '';
                    } else if (project.savedMode === AppMode.VIDEO) {
                        if (!loadedParams.savedVideoPrompt && loadedParams.prompt) loadedParams.savedVideoPrompt = loadedParams.prompt;
                        loadedParams.prompt = loadedParams.savedVideoPrompt || loadedParams.prompt || '';
                    }
                    setParams(loadedParams);
                }
                if (project.savedMode) setMode(project.savedMode);
                setChatHistory(project.savedMode === AppMode.VIDEO ? (project.videoChatHistory || []) : (project.chatHistory || []));
                setContextSummary(project.contextSummary || '');
                setSummaryCursor(project.summaryCursor || 0);

                // Re-enable save updates after a brief delay to ensure state has propagated
                setTimeout(() => {
                    isInitializingRef.current = false;
                }, 100);
            }
        }
    }, [activeProjectId]);


    // Load deleted projects when entering trash mode
    useEffect(() => {
        if (rightPanelMode === 'TRASH') {
            loadProjects().then(allProjects => {
                setTrashProjects(allProjects.filter(p => p.deletedAt !== undefined));
            });
        }
    }, [rightPanelMode]);
    // Project Auto-Save Logic
    useEffect(() => {
        if (!isLoaded || !activeProjectId) return;

        const project = projects.find(p => p.id === activeProjectId);
        if (!project) return;

        const paramsToSave = { ...params };
        if (mode === AppMode.IMAGE) paramsToSave.savedImagePrompt = params.prompt;
        else paramsToSave.savedVideoPrompt = params.prompt;

        // Only update time if NOT in initialization phase
        const newUpdatedAt = isInitializingRef.current ? project.updatedAt : Date.now();

        const updates: Partial<Project> = {
            updatedAt: newUpdatedAt,
            savedParams: paramsToSave,
            savedMode: mode,
            chatHistory: mode === AppMode.IMAGE ? chatHistory : undefined,
            videoChatHistory: mode === AppMode.VIDEO ? chatHistory : undefined,
            contextSummary: contextSummary, summaryCursor: summaryCursor
        };

        updateProject(activeProjectId, updates);

    }, [params, chatHistory, contextSummary, summaryCursor, mode]);

    const addToast = (type: 'success' | 'error' | 'info', title: string, message: string) => {
        setToasts(prev => [...prev, { id: crypto.randomUUID(), type, title, message }]);
    };
    const removeToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

    const updateLastModelMessage = (updater: (message: ChatMessage) => ChatMessage) => {
        setChatHistory(prev => {
            const updated = [...prev];
            const lastModelIndex = findLastModelMessageIndex(updated);
            if (lastModelIndex === -1) return prev;
            updated[lastModelIndex] = updater(updated[lastModelIndex]);
            return updated;
        });
    };

    const upsertLastModelToolCall = (toolCallId: string, updater: (record: ToolCallRecord | undefined) => ToolCallRecord) => {
        updateLastModelMessage(message => {
            const existingRecords = message.toolCalls || [];
            const existingRecord = existingRecords.find(record => record.id === toolCallId);
            const nextRecord = updater(existingRecord);
            const nextRecords = existingRecord
                ? existingRecords.map(record => record.id === toolCallId ? nextRecord : record)
                : [...existingRecords, nextRecord];
            return { ...message, toolCalls: nextRecords };
        });
    };

    const handleKeepCurrentAction = async (toolCall: ToolCallRecord): Promise<void> => {
        await resolveKeepCurrentAction({
            toolCall,
            activeProjectId: activeProjectIdRef.current,
            loadAgentJobsByProject,
            dispatchKernelCommand: command => appAgentKernel.dispatchCommand(command),
            saveAgentJobSnapshot: saveAgentJob,
            tasksRef,
            setTaskViews: setTasks,
            saveTaskView: saveTask,
            deleteTaskView: deleteTask,
            projects
        });
    };

    const handleAuthVerify = async () => {
        if (window.aistudio) {
            const hasKey = await window.aistudio.hasSelectedApiKey();
            setVeoVerified(hasKey);
            if (!hasKey) await window.aistudio.openSelectKey();
        }
    };

    const handleModeSwitch = (newMode: AppMode) => {
        setParams(prev => {
            const newState = { ...prev };
            if (mode === AppMode.IMAGE) newState.savedImagePrompt = prev.prompt;
            else newState.savedVideoPrompt = prev.prompt;
            if (newMode === AppMode.IMAGE) newState.prompt = newState.savedImagePrompt || '';
            else newState.prompt = newState.savedVideoPrompt || '';
            return newState;
        });
        setMode(newMode);
        setRightPanelMode('GALLERY');
        const project = projects.find(p => p.id === activeProjectId);
        if (project) setChatHistory(newMode === AppMode.IMAGE ? (project.chatHistory || []) : (project.videoChatHistory || []));
    };

    const createNewProject = async (_force = false) => {
        const newProject: Project = {
            id: crypto.randomUUID(), name: t('nav.new_project'), createdAt: Date.now(), updatedAt: Date.now(),
            savedMode: AppMode.IMAGE, chatHistory: [], videoChatHistory: []
        };
        await saveProject(newProject);
        setProjects(prev => [newProject, ...prev]); // Prepend new project
        setActiveProjectId(newProject.id);
        setParams(DEFAULT_PARAMS);
        setChatHistory([]);
        setAssets([]);
        setShowProjects(false);
    };

    const switchProject = (id: string, _project?: Project) => {
        setActiveProjectId(id);
        setShowProjects(false);
    };

    const handleUseAsReference = async (asset: AssetItem, navigateToStudio = true) => {
        if (asset.type !== 'IMAGE') return;
        try {
            let data = ''; let mimeType = '';
            const normalizedUrl = await normalizeImageUrlForChat(asset.url);
            const matches = normalizedUrl.match(/^data:(.+);base64,(.+)$/);
            if (matches) { mimeType = matches[1]; data = matches[2]; }
            if (data && mimeType) {
                const newSmartAsset: SmartAsset = {
                    id: crypto.randomUUID(), data, mimeType, role: SmartAssetRole.EDIT_BASE
                };
                setParams(prev => ({ ...prev, smartAssets: [...(prev.smartAssets || []), newSmartAsset] }));
                if (navigateToStudio) setActiveTab('studio');
                // AUDIT: Removed redundant Reference Added toast
            } else {
                addToast('error', 'Error', 'Failed to load asset as reference.');
            }
        } catch (e) {
            console.error(e);
            addToast('error', 'Error', 'Failed to load asset as reference.');
        }
    };

    const handleAddAssetToChat = (asset: AssetItem) => {
        if (asset.type !== 'IMAGE') return;
        setActiveTab('chat');
        void (async () => {
            try {
                const normalizedUrl = await normalizeImageUrlForChat(asset.url);
                if (!normalizedUrl) {
                    addToast('error', 'Error', 'Failed to add image to chat.');
                    return;
                }
                setChatSelectedImages(prev => [...prev, normalizedUrl]);
            } catch (e) {
                console.error(e);
                addToast('error', 'Error', 'Failed to add image to chat.');
            }
        })();
    };

    const handleAgentToolCall = createAppAgentToolCallHandler({
        mode,
        processingToolCallKeys: processingToolCallRef.current,
        upsertLastModelToolCall,
        updateLastModelMessage,
        setChatHistory,
        handleModeSwitch,
        addToast,
        handleGenerate,
        normalizeAssistantMode,
        getPlaybookDefaults,
        loadAgentJobsByProject,
        activeProjectId,
        chatParams,
        chatHistory,
        chatEditParams,
        setRightPanelMode,
        setThoughtImages,
        setChatEditParams,
        setAgentContextAssets,
        extractSearchContextFromProgress,
        selectReferenceRecords,
        latestSearchProgress: [...chatHistory]
            .reverse()
            .find(m => m.role === 'model' && m.searchProgress?.status === 'complete')
            ?.searchProgress,
        compressImageForContext,
        resolveToolCallRecordStatus
    });

    const executeAppToolCalls = createAppAgentToolExecutor({
        executeToolCall: handleAgentToolCall
    });

    const getFriendlyError = (err: string) => {
        const e = err.toLowerCase();
        if (e.includes('quota') || e.includes('429') || e.includes('resource_exhausted')) return t('err.quota');
        if (e.includes('safety') || e.includes('blocked') || e.includes('refused')) return t('err.safety');
        if (e.includes('network') || e.includes('fetch')) return t('err.network');
        if (e.includes('api key') || e.includes('401') || e.includes('403')) return t('err.api_key');
        if (e.includes('storage_quota_exceeded')) return t('err.storage');
        return t('err.unknown');
    };
    const appHandleGenerate = createAppHandleGenerate({
        prepareRequest: (fullParams, options) => prepareAppGenerationRequest({
            fullParams,
            useParamsAsBase: options?.useParamsAsBase === true,
            params,
            mode: options?.modeOverride || mode,
            activeProjectId,
            projects,
            historyOverride: options?.historyOverride as ChatMessage[] | undefined,
            videoCooldownEndTime,
            getUserApiKey,
            sanitizeImageModel,
            setThoughtImages,
            addToast,
            setShowSettings,
            generateTitle,
            setProjects,
            saveProject,
            jobSource: options?.jobSource as AgentJob['source'] | undefined,
            resolveNewProjectLabel: () => t('nav.new_project')
        }),
        buildTaskFlowDepsBuilder: ({ currentMode, activeParams, userKey, toolCall, historyOverride }) => () => createAppGenerationTaskFlowDepsBuilder({
            currentMode,
            activeParams,
            normalizeGenerationParamsForExecution,
            translateTag: tagKey => t(tagKey as any) || tagKey,
            executeGenerationAttempt,
            executePrimaryReview,
            executeAutoRevisionFlow,
            resolvePrimaryReview,
            resolveAutoRevision,
            resolveGenerationFailure,
            generateImageImpl: (params, projectId, onStartCb, signal, taskIdArg, historyArg, onThoughtImage) => generateImage(
                params,
                projectId,
                onStartCb,
                signal,
                taskIdArg,
                historyArg,
                (imageData) => {
                    setThoughtImages(prev => [...prev, {
                        id: crypto.randomUUID(),
                        ...imageData,
                        timestamp: Date.now()
                    }]);
                    onThoughtImage?.(imageData);
                }
            ),
            generateVideoImpl: (params, onUpdate, onStartCb, signal) => generateVideo(params, onUpdate, onStartCb, signal),
            normalizeAssistantMode,
            buildImageCriticContext: ({
                assistantMode,
                negativePrompt,
                selectedReferences,
                consistencyProfile,
                searchContext
            }) => buildImageCriticContext({
                assistantMode: normalizeAssistantMode(assistantMode),
                negativePrompt,
                selectedReferences: selectedReferences as SelectedReferenceRecord[],
                consistencyProfile,
                searchContext
            }),
            reviewGeneratedAsset,
            buildDefaultRefinePromptRequiresAction,
            toolCall: toolCall as AgentAction | undefined,
            historyOverride: historyOverride as ChatMessage[] | undefined,
            chatHistory,
            userKey,
            runMemoryExtractionTask,
            addToast,
            handleUseAsReference,
            playSuccessSound,
            playErrorSound,
            setVideoCooldownEndTime,
            getFriendlyError,
            language
        }),
        executeGenerationFlow: executeAppGenerationFlow,
        getProjectName: projectId => projects.find(p => p.id === projectId)?.name || 'Project',
        computeHistoryForGeneration: ({ currentMode, activeParams, historyOverride }) => {
            const isEditMode = currentMode === AppMode.IMAGE && !!activeParams.editBaseImage && !!activeParams.editMask;
            return !isEditMode && currentMode === AppMode.IMAGE ? historyOverride : undefined;
        }
    });
    const buildAppHandleGenerateContext = createAppHandleGenerateContextBuilder({
        tasksRef,
        setTaskViews: setTasks,
        saveTaskView: saveTask,
        deleteTaskView: deleteTask,
        activeProjectIdRef,
        setAssets,
        saveAsset,
        updateAsset,
        deleteAssetPermanently: permanentlyDeleteAssetFromDB,
        saveAgentJobSnapshot: saveAgentJob,
        loadAgentJobsByProject,
        taskControllers,
        createGenerationTaskLaunchController,
        executeAppGenerationRequest,
        dispatchKernelCommand: command => appAgentKernel.dispatchCommand(command),
        createResumeActionStep,
        buildConsistencyProfile,
        normalizeAssistantMode,
        prepareGenerationLaunch,
        playSuccessSound
    });
    const handleGenerate = async (
        fullParams: GenerationParams,
        options?: {
            modeOverride?: AppMode;
            onPreview?: (asset: AssetItem) => void;
            onSuccess?: (asset: AssetItem) => void;
            historyOverride?: ChatMessage[];
            useParamsAsBase?: boolean;
            jobSource?: AgentJob['source'];
            toolCall?: AgentAction;
            selectedReferenceRecords?: SelectedReferenceRecord[];
            searchContextOverride?: AgentJob['searchContext'];
            resumeJobId?: string;
            resumeActionType?: string;
        }
    ): Promise<AgentToolResult[]> => {
        const audioCtx = getAudioContext();
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(console.warn);
        }

        console.log('[handleGenerate] ENTRY - smartAssets:', {
            fromFullParams: fullParams.smartAssets?.length || 0
        });

        return appHandleGenerate(fullParams, options, {
            ...buildAppHandleGenerateContext({
                onPreview: options?.onPreview,
                onSuccess: options?.onSuccess
            })
        });
    };

    const appAgentKernel = useMemo(() => createAppAgentKernel({
        executeResolveRequiresAction: command => executeAppResolveRequiresAction({
            command,
            activeProjectId: activeProjectIdRef.current,
            loadAgentJobsByProject,
            saveAgentJobSnapshot: saveAgentJob,
            tasksRef,
            setTaskViews: setTasks,
            saveTaskView: saveTask,
            deleteTaskView: deleteTask,
            projects
        }),
        executeCancelJob: command => executeAppCancelJob({
            command,
            activeProjectId: activeProjectIdRef.current,
            loadAgentJobsByProject,
            saveAgentJobSnapshot: saveAgentJob,
            tasksRef,
            setTaskViews: setTasks,
            saveTaskView: saveTask,
            deleteTaskView: deleteTask,
            projects
        }),
        executeResumeJob: command => executeAppResumeJob({
            command,
            activeProjectId: activeProjectIdRef.current,
            loadAgentJobsByProject,
            saveAgentJobSnapshot: saveAgentJob,
            tasksRef,
            setTaskViews: setTasks,
            saveTaskView: saveTask,
            deleteTaskView: deleteTask,
            projects
        }),
        executeStartGeneration: payload => executeAppStartGeneration({
            ...payload,
            createGenerationTaskLaunchController,
            executeAppGenerationRequest
        }),
        executeSubmitUserTurn: payload => executeAppSubmitUserTurn({
            payload,
            executeStreamingTurn: executeChatStreamingTurn
        }),
        executeToolCalls: command => executeAppToolCalls(command)
    }), [projects, executeAppToolCalls]);

    // Wrapper for Params Config page - merges with params state (backward compatible)
    const handleParamsGenerate = async (overrideParams?: Partial<GenerationParams>) => {
        await handleGenerate({ ...params, ...overrideParams } as GenerationParams, {
            useParamsAsBase: true
        });
    };
    const generationFormSurfaceProps = createAppGenerationFormSurfaceProps({
        contextSummary,
        summaryCursor,
        setContextSummary,
        setSummaryCursor,
        onToolCall: handleAgentToolCall,
        dispatchKernelCommand: (command: any) => appAgentKernel.dispatchCommand(command),
        onKeepCurrentAction: handleKeepCurrentAction,
        mode,
        agentContextAssets,
        setAgentContextAssets
    });

    const appTaskViewController = createAppTaskViewController({
        taskViewDismissal,
        taskControllers,
        deleteAssetPermanently: permanentlyDeleteAssetFromDB,
        activeProjectIdRef,
        getActiveProjectId: () => activeProjectId,
        setAssets,
        dispatchKernelCommand: command => appAgentKernel.dispatchCommand(command)
    });
    const openConfirmDeleteProject = (projectId: string) => {
        const project = projects.find(p => p.id === projectId);
        setConfirmDialog({
            isOpen: true,
            title: t('confirm.delete.title'),
            message: `"${project?.name || 'Project'}" - ${t('confirm.delete.desc')}`,
            confirmLabel: t('btn.delete') || 'Delete',
            cancelLabel: t('btn.cancel') || 'Cancel',
            isDestructive: true,
            action: async () => {
                // Soft delete: set deletedAt timestamp
                if (project) {
                    const deletedProject = { ...project, deletedAt: Date.now() };
                    await saveProject(deletedProject);
                }
                setProjects(prev => prev.filter(p => p.id !== projectId));
                setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                if (activeProjectId === projectId) {
                    const remaining = projects.filter(p => p.id !== projectId);
                    if (remaining.length > 0) switchProject(remaining[0].id, remaining[0]);
                    else createNewProject(true);
                }
            }
        });
    };
    const openConfirmDelete = (assetId: string) => { setConfirmDialog({ isOpen: true, title: t('confirm.delete.title'), message: t('confirm.delete.desc'), confirmLabel: t('btn.delete'), cancelLabel: t('btn.cancel'), isDestructive: true, action: async () => { const asset = assets.find(a => a.id === assetId); if (asset) { await softDeleteAssetInDB(asset); setAssets(prev => prev.map(a => a.id === assetId ? { ...a, deletedAt: Date.now() } : a)); } setConfirmDialog(prev => ({ ...prev, isOpen: false })); if (activeCanvasAsset?.id === assetId) setActiveCanvasAsset(null); } }); };
    const handleRestoreAsset = async (assetId: string) => { const asset = trashAssets.find(a => a.id === assetId) || assets.find(a => a.id === assetId); if (asset) { await restoreAssetInDB(asset); setAssets(prev => prev.map(a => a.id === assetId ? { ...a, deletedAt: undefined } : a)); setTrashAssets(prev => prev.filter(a => a.id !== assetId)); } };
    const openConfirmDeleteForever = (assetId: string) => { setConfirmDialog({ isOpen: true, title: t('confirm.delete_forever.title'), message: t('confirm.delete_forever.desc'), confirmLabel: t('btn.delete_forever'), cancelLabel: t('btn.cancel'), isDestructive: true, action: async () => { await permanentlyDeleteAssetFromDB(assetId); setAssets(prev => prev.filter(a => a.id !== assetId)); setTrashAssets(prev => prev.filter(a => a.id !== assetId)); setConfirmDialog(prev => ({ ...prev, isOpen: false })); } }); };
    const openConfirmEmptyTrash = () => {
        setConfirmDialog({
            isOpen: true,
            title: t('confirm.empty_trash.title'),
            message: t('confirm.empty_trash.desc'),
            confirmLabel: t('btn.empty_trash'),
            cancelLabel: t('btn.cancel'),
            isDestructive: true,
            action: async () => {
                // Delete assets in trash
                const trashAssetIds = trashAssets.map(a => a.id);
                if (trashAssetIds.length > 0) {
                    await bulkPermanentlyDeleteAssets(trashAssetIds);
                }
                // Delete projects in trash
                for (const project of trashProjects) {
                    await deleteProjectFromDB(project.id);
                }
                // Update UI state
                setAssets(prev => prev.filter(a => a.deletedAt === undefined));
                setTrashAssets([]);
                setTrashProjects([]);
                setConfirmDialog(prev => ({ ...prev, isOpen: false }));
            }
        });
    };
    // Project restore and permanent delete
    const handleRestoreProject = async (projectId: string) => {
        const project = trashProjects.find(p => p.id === projectId);
        if (project) {
            const restoredProject = { ...project, deletedAt: undefined };
            await saveProject(restoredProject);
            setProjects(prev => [...prev, restoredProject]);
            setTrashProjects(prev => prev.filter(p => p.id !== projectId));
        }
    };
    const openConfirmDeleteProjectForever = (projectId: string) => {
        const project = trashProjects.find(p => p.id === projectId);
        setConfirmDialog({
            isOpen: true,
            title: t('confirm.delete_forever.title'),
            message: `"${project?.name || 'Project'}" - ${t('confirm.delete_forever.desc')}`,
            confirmLabel: t('btn.delete_forever'),
            cancelLabel: t('btn.cancel'),
            isDestructive: true,
            action: async () => {
                await deleteProjectFromDB(projectId);
                setTrashProjects(prev => prev.filter(p => p.id !== projectId));
                setConfirmDialog(prev => ({ ...prev, isOpen: false }));
            }
        });
    };
    const handleBulkDelete = () => {
        if (selectedAssetIds.size === 0) return;
        setConfirmDialog({
            isOpen: true,
            title: t('confirm.delete_bulk.title'),
            message: `${selectedAssetIds.size} items`,
            confirmLabel: t('btn.delete'),
            cancelLabel: t('btn.cancel'),
            isDestructive: true,
            action: async () => {
                const assetsToDelete = assets.filter(a => selectedAssetIds.has(a.id));
                await bulkSoftDeleteAssets(assetsToDelete);
                const deletedAt = Date.now();
                setAssets(prev => prev.map(a => selectedAssetIds.has(a.id) ? { ...a, deletedAt } : a));
                setSelectedAssetIds(new Set());
                setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                setIsSelectionMode(false);
            }
        });
    };
    const handleBulkDownload = () => { selectedAssetIds.forEach(id => { const asset = assets.find(a => a.id === id); if (asset) { const link = document.createElement('a'); link.href = asset.url; link.download = `ai-vision-studio-export-${asset.id}.${asset.type === 'IMAGE' ? 'png' : 'mp4'}`; link.click(); } }); };
    const toggleAssetSelection = (asset: AssetItem) => { const newSet = new Set(selectedAssetIds); if (newSet.has(asset.id)) newSet.delete(asset.id); else newSet.add(asset.id); setSelectedAssetIds(newSet); };
    // FIX: Only allow image comparison (ComparisonView doesn't support video)
    const handleCompare = () => {
        if (selectedAssetIds.size !== 2) return;
        const items = assets.filter(a => selectedAssetIds.has(a.id));
        // Check that both are images
        if (items.some(a => a.type !== 'IMAGE')) {
            addToast('error', 'Comparison Error', 'Only images can be compared. Please select two images.');
            return;
        }
        if (items.length === 2) setComparisonAssets([items[0], items[1]]);
    };
    // FIX: handleVideoContinue now accepts videoUri for Veo API video extension
    const handleVideoContinue = (videoUri: string) => {
        setParams(prev => ({ ...prev, inputVideoUri: videoUri }));
        setMode(AppMode.VIDEO);
        setActiveTab('studio');
        setRightPanelMode('GALLERY');
        addToast('info', 'Video Extension', t('help.extend_desc'));
    };

    const handleRemix = (asset: AssetItem) => {
        setParams(prev => ({ ...prev, prompt: asset.prompt || '' }));
        if (asset.type === 'IMAGE') handleUseAsReference(asset);
    };
    const handleCanvasSaveToConfig = async (payload: {
        baseImageDataUrl: string;
        previewDataUrl: string;
        mergedMaskDataUrl: string;
        regions: Array<{ id: string; color: string; instruction: string; maskDataUrl: string }>;
    }) => {
        const baseMatch = payload.baseImageDataUrl.match(/^data:(.+);base64,(.+)$/);
        const maskMatch = payload.mergedMaskDataUrl.match(/^data:(.+);base64,(.+)$/);
        const previewMatch = payload.previewDataUrl.match(/^data:(.+);base64,(.+)$/);
        if (!baseMatch || !maskMatch) return;

        const baseAsset: SmartAsset = {
            id: crypto.randomUUID(),
            data: baseMatch[2],
            mimeType: baseMatch[1]
        };

        const maskAsset: SmartAsset = {
            id: crypto.randomUUID(),
            data: maskMatch[2],
            mimeType: maskMatch[1]
        };

        const editRegions = payload.regions
            .map(region => {
                const regionMatch = region.maskDataUrl.match(/^data:(.+);base64,(.+)$/);
                if (!regionMatch) return null;
                const entry: EditRegion = {
                    id: region.id,
                    color: region.color,
                    instruction: region.instruction,
                    maskData: regionMatch[2],
                    maskMimeType: regionMatch[1]
                };
                return entry;
            })
            .filter((region): region is EditRegion => region !== null);

        setParams(prev => ({
            ...prev,
            editBaseImage: baseAsset,
            editMask: maskAsset,
            editRegions: editRegions.length > 0 ? editRegions : undefined,
            editPreviewImage: previewMatch ? previewMatch[2] : prev.editPreviewImage,
            editPreviewMimeType: previewMatch ? previewMatch[1] : prev.editPreviewMimeType
        }));
        setRightPanelMode('GALLERY');
        setActiveTab('studio');
        setEditorAsset(null);
        addToast('success', '编辑已准备', '图片已添加到快速生成的重绘编辑区');
    };

    const handleCanvasSaveToChat = async (payload: {
        baseImageDataUrl: string;
        previewDataUrl: string;
        mergedMaskDataUrl: string;
        regions: Array<{ id: string; color: string; instruction: string; maskDataUrl: string }>;
    }) => {
        // Add the preview image (with annotations) to user's pending upload area for display
        const previewMatch = payload.previewDataUrl.match(/^data:(.+);base64,(.+)$/);
        if (!previewMatch) return;

        const newAsset: SmartAsset = {
            id: crypto.randomUUID(),
            data: previewMatch[2],
            mimeType: previewMatch[1]
        };

        // REPLACE (not append) - clear old context assets and add new preview for display
        setAgentContextAssets([newAsset]);

        // Save FULL edit params to chatEditParams (isolated from params config page)
        const baseMatch = payload.baseImageDataUrl.match(/^data:(.+);base64,(.+)$/);
        const maskMatch = payload.mergedMaskDataUrl.match(/^data:(.+);base64,(.+)$/);

        if (baseMatch && maskMatch) {
            setChatEditParams({
                editBaseImage: { id: 'chat-base', mimeType: baseMatch[1], data: baseMatch[2] },
                editMask: { id: 'chat-mask', mimeType: maskMatch[1], data: maskMatch[2] },
                editRegions: payload.regions.map(r => {
                    const regionMaskMatch = r.maskDataUrl.match(/^data:(.+);base64,(.+)$/);
                    return {
                        id: r.id,
                        color: r.color,
                        instruction: r.instruction,
                        maskData: regionMaskMatch ? regionMaskMatch[2] : '',
                        maskMimeType: regionMaskMatch ? regionMaskMatch[1] : 'image/png'
                    };
                })
            });
        }

        setActiveTab('chat');
        setEditorAsset(null);
        addToast('success', '已添加', '编辑模式已启用，发送消息时将进行局部重绘');
    };

    if (!isLoaded) return <div className="h-screen w-screen bg-dark-bg text-white flex items-center justify-center">Loading Studio...</div>;

    const currentProjectAssets = assets.filter(a => a.projectId === activeProjectId && a.deletedAt === undefined);
    const displayedAssets = rightPanelMode === 'TRASH' ? trashAssets : (showFavoritesOnly ? currentProjectAssets.filter(a => a.isFavorite) : currentProjectAssets);

    const handleAssetClick = (asset: AssetItem) => {
        if (asset.isNew) {
            const updated = { ...asset, isNew: false };
            updateAsset(asset.id, { isNew: false });
            setAssets(prev => prev.map(item => item.id === asset.id ? updated : item));
            setActiveCanvasAsset(updated);
        } else setActiveCanvasAsset(asset);
        setRightPanelMode('CANVAS');
    };

    return (
        <div className="flex h-screen bg-dark-bg text-gray-200 font-sans overflow-hidden selection:bg-brand-500/30">
            <div className="w-24 flex flex-col items-center py-6 bg-dark-panel border-r border-dark-border z-30 shrink-0">
                <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-indigo-600 rounded-xl shadow-lg shadow-brand-500/20 mb-8 flex items-center justify-center">
                    <Sparkles className="text-white" size={24} />
                </div>
                <div className="flex flex-col gap-4 w-full px-2">
                    <button onClick={() => setShowProjects(true)} className="flex flex-col items-center gap-1 p-3 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-all group relative">
                        <Folder size={24} className={showProjects ? 'text-brand-500' : ''} />
                        <span className="text-[10px] font-medium text-center">{t('nav.projects')}</span>
                    </button>
                    <div className="w-full h-px bg-white/5 my-2" />
                    <button onClick={() => handleModeSwitch(AppMode.IMAGE)} className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${mode === AppMode.IMAGE && rightPanelMode !== 'TRASH' ? 'bg-brand-500/10 text-brand-400 shadow-inner' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
                        <ImageIcon size={24} />
                        <span className="text-[10px] font-medium text-center">{t('nav.image')}</span>
                    </button>
                    <button onClick={() => handleModeSwitch(AppMode.VIDEO)} className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${mode === AppMode.VIDEO && rightPanelMode !== 'TRASH' ? 'bg-purple-500/10 text-purple-400 shadow-inner' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
                        <Video size={24} />
                        <span className="text-[10px] font-medium text-center">{t('nav.video')}</span>
                    </button>
                    <div className="w-full h-px bg-white/5 my-2" />
                    <button onClick={() => setRightPanelMode('TRASH')} className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${rightPanelMode === 'TRASH' ? 'bg-red-500/10 text-red-400 shadow-inner' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
                        <Trash2 size={24} />
                        <span className="text-[10px] font-medium text-center">{t('nav.trash')}</span>
                    </button>
                </div>
                <div className="mt-auto flex flex-col gap-4 w-full px-2 relative">
                    {/* API Key Reminder Tooltip */}
                    {!getUserApiKey() && !showSettings && !apiKeyTooltipDismissed && (
                        <div className="absolute bottom-2 left-full ml-3 w-52 animate-in fade-in slide-in-from-left-2 duration-300">
                            <div className="relative bg-dark-surface border border-dark-border rounded-xl p-3 shadow-xl">
                                <div className="absolute top-1/2 -left-2 -translate-y-1/2 w-0 h-0 border-t-8 border-b-8 border-r-8 border-t-transparent border-b-transparent border-r-dark-border"></div>
                                <button
                                    onClick={() => setApiKeyTooltipDismissed(true)}
                                    className="absolute top-2 right-2 text-gray-500 hover:text-white transition-colors"
                                >
                                    <X size={14} />
                                </button>
                                <div className="flex items-center gap-2 mb-2">
                                    <Key size={14} className="text-brand-400" />
                                    <span className="text-xs font-bold text-white">
                                        {language === 'zh' ? '设置 API Key' : 'Set API Key'}
                                    </span>
                                </div>
                                <p className="text-[11px] text-gray-400 leading-relaxed mb-3">
                                    {language === 'zh' ? '请先设置您的 API Key 以开始创作' : 'Set your API Key to start creating'}
                                </p>
                                <button
                                    onClick={() => setShowSettings(true)}
                                    className="w-full py-2 bg-brand-500 hover:bg-brand-600 rounded-lg text-xs font-bold text-white transition-colors flex items-center justify-center gap-2"
                                >
                                    <Sparkles size={12} />
                                    {language === 'zh' ? '去设置' : 'Set Now'}
                                    <ArrowRight size={12} />
                                </button>
                            </div>
                        </div>
                    )}
                    <button onClick={() => setShowSettings(true)} className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${!getUserApiKey() ? 'text-brand-400 animate-pulse' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}><Settings size={24} /></button>
                </div>
            </div>

            <ProjectSidebar isOpen={showProjects} onClose={() => setShowProjects(false)} projects={projects} activeProjectId={activeProjectId} generatingStates={generatingStates} onSelectProject={(id) => switchProject(id)} onCreateProject={() => createNewProject()} onRenameProject={(id, name) => { const p = projects.find(p => p.id === id); if (p) { const updated = { ...p, name }; setProjects(prev => prev.map(prj => prj.id === id ? updated : prj)); updateProject(id, { name }); } }} onDeleteProject={openConfirmDeleteProject} />

            <div className="flex-1 flex overflow-hidden relative">
                <GenerationForm mode={mode} params={params} setParams={setParams} chatParams={chatParams} setChatParams={setChatParams} isGenerating={tasks.some(t => t.projectId === activeProjectId && (t.status === 'GENERATING' || t.status === 'QUEUED' || t.status === 'REVIEWING'))} startTime={generatingStates[activeProjectId]} onGenerate={handleParamsGenerate} onVerifyVeo={handleAuthVerify} veoVerified={veoVerified} chatHistory={chatHistory} setChatHistory={setChatHistory} activeTab={activeTab} onTabChange={setActiveTab} chatSelectedImages={chatSelectedImages} setChatSelectedImages={setChatSelectedImages} projectId={activeProjectId} cooldownEndTime={videoCooldownEndTime} thoughtImages={thoughtImages} setThoughtImages={setThoughtImages} {...(generationFormSurfaceProps as any)} />

                <div className="flex-1 bg-dark-bg flex flex-col min-w-0 relative">
                    {rightPanelMode === 'CANVAS' && activeCanvasAsset ? (
                        <CanvasView asset={activeCanvasAsset} onClose={() => setRightPanelMode('GALLERY')} onAddToChat={handleAddAssetToChat} onInpaint={(asset) => setEditorAsset(asset)} onExtendVideo={handleVideoContinue} onRemix={handleRemix} onDelete={() => openConfirmDelete(activeCanvasAsset.id)} />
                    ) : (
                        <>
                            <div className={`h-16 border-b border-dark-border flex items-center justify-between px-6 shrink-0 bg-dark-bg/80 backdrop-blur z-10 ${rightPanelMode === 'TRASH' ? 'bg-red-950/20' : ''}`}>
                                <div className="flex items-center gap-4">
                                    {rightPanelMode === 'TRASH' ? (
                                        <div className="flex items-center gap-3"><Trash2 size={20} className="text-red-400" /><h1 className="text-xl font-bold text-white">{t('header.trash')}</h1>{displayedAssets.length > 0 && (<button onClick={openConfirmEmptyTrash} className="ml-4 px-3 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold hover:bg-red-500 hover:text-white transition-all flex items-center gap-2"><Trash2 size={12} /> {t('btn.empty_trash')}</button>)}</div>
                                    ) : (
                                        <h1 className="text-xl font-bold text-white flex items-center gap-2">{projects.find(p => p.id === activeProjectId)?.name}</h1>
                                    )}
                                    {rightPanelMode !== 'TRASH' && (
                                        isSelectionMode ? (
                                            <div className="flex items-center gap-2 animate-in slide-in-from-left-5 fade-in">
                                                <span className="px-2 py-1 bg-brand-500/20 text-brand-400 text-xs font-bold rounded-lg border border-brand-500/30">{selectedAssetIds.size} {t('header.selected')}</span>
                                                {selectedAssetIds.size === 2 && (<button onClick={handleCompare} aria-label={t('header.compare')} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-medium transition-colors" title={t('header.compare')}><MoveHorizontal size={14} /></button>)}
                                                {selectedAssetIds.size > 0 && (<><button onClick={handleBulkDownload} aria-label={t('btn.download_selected')} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-medium transition-colors" title={t('btn.download_selected')}><Download size={14} /></button><button onClick={handleBulkDelete} aria-label={t('btn.delete_selected')} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-xs font-medium transition-colors" title={t('btn.delete_selected')}><Trash2 size={14} /></button></>)}
                                                <button onClick={() => { setIsSelectionMode(false); setSelectedAssetIds(new Set()); }} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg text-xs font-medium transition-colors">{t('btn.cancel')}</button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => setShowFavoritesOnly(!showFavoritesOnly)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${showFavoritesOnly ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30' : 'text-gray-400 hover:bg-white/5'}`}><Star size={14} fill={showFavoritesOnly ? "currentColor" : "none"} /> {t('header.favorites')}</button>
                                                <button onClick={() => setIsSelectionMode(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:bg-white/5 transition-all"><CheckSquare size={14} /> {t('header.select_mode')}</button>
                                            </div>
                                        )
                                    )}
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="text-xs text-gray-500 font-medium">{displayedAssets.length} {rightPanelMode === 'TRASH' ? t('header.trash_count') : t('header.assets')}</div>
                                    <button onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all" title={language === 'en' ? 'Switch to Chinese' : 'Switch to English'}><Languages size={16} />{language === 'en' ? 'EN' : 'CN'}</button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                                {rightPanelMode === 'TRASH' && (displayedAssets.length === 0 && trashProjects.length === 0) ? (
                                    <div className="h-full flex flex-col items-center justify-center text-gray-600 opacity-50">
                                        <Recycle size={48} className="mb-4 text-green-500/50" /><p className="text-lg font-medium">{t('msg.no_trash')}</p>
                                    </div>
                                ) : displayedAssets.length === 0 && rightPanelMode !== 'TRASH' ? (
                                    <div className="h-full flex flex-col items-center justify-center text-gray-600 opacity-50">
                                        <LayoutGrid size={48} className="mb-4" /><p className="text-lg font-medium">{t('msg.no_assets')}</p><p className="text-sm">{t('msg.generate_something')}</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-20">
                                        {rightPanelMode === 'TRASH' && trashProjects.map(project => (
                                            <div key={project.id} className="group relative bg-dark-surface rounded-xl overflow-hidden border border-transparent hover:border-brand-500 transition-all duration-300 shadow-lg aspect-square opacity-80 hover:opacity-100 grayscale-[0.3] hover:grayscale-0 cursor-pointer">
                                                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-amber-500/10 to-orange-500/10 p-4">
                                                    <Folder size={48} className="text-amber-500/70 mb-2" />
                                                    <span className="text-sm text-white font-medium text-center truncate w-full px-2">{project.name}</span>
                                                    <span className="text-[10px] text-gray-500 mt-1">{new Date(project.deletedAt || 0).toLocaleDateString()}</span>
                                                </div>
                                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3 z-10">
                                                    <p className="text-xs text-white line-clamp-2 mb-2 font-medium pointer-events-none">{project.name}</p>
                                                    <div className="flex gap-2 justify-end z-20">
                                                        <button onClick={() => handleRestoreProject(project.id)} className="p-1.5 bg-green-500/80 hover:bg-green-600 rounded-lg text-white backdrop-blur-md transition-colors" title="Restore"><RotateCcw size={16} /></button>
                                                        <button onClick={() => openConfirmDeleteProjectForever(project.id)} className="p-1.5 bg-red-500/80 hover:bg-red-600 rounded-lg text-white backdrop-blur-md transition-colors" title="Delete Permanently"><Trash2 size={16} /></button>
                                                    </div>
                                                </div>
                                                <div className="absolute top-2 left-2 flex gap-1 pointer-events-none">
                                                    <div className="px-2 py-0.5 backdrop-blur-sm rounded text-[10px] font-bold text-white uppercase tracking-wider bg-black/50">PROJECT</div>
                                                </div>
                                            </div>
                                        ))}
                                        {displayedAssets.map(asset => (
                                            <AssetCard key={asset.id} asset={asset} onClick={handleAssetClick} onUseAsReference={handleUseAsReference} onDelete={() => rightPanelMode === 'TRASH' ? openConfirmDeleteForever(asset.id) : openConfirmDelete(asset.id)} onAddToChat={handleAddAssetToChat} onToggleFavorite={(a) => { const updated = { ...a, isFavorite: !a.isFavorite }; setAssets(prev => prev.map(item => item.id === a.id ? updated : item)); updateAsset(a.id, { isFavorite: !a.isFavorite }); }} isSelectionMode={isSelectionMode} isSelected={selectedAssetIds.has(asset.id)} onToggleSelection={toggleAssetSelection} isTrashMode={rightPanelMode === 'TRASH'} onRestore={() => handleRestoreAsset(asset.id)} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            <TaskCenter tasks={tasks} onTaskIntent={appTaskViewController.handleTaskViewIntent} onClearCompleted={appTaskViewController.clearCompletedTasks} />
            <SettingsDialog isOpen={showSettings} onClose={() => setShowSettings(false)} onApiKeyChange={() => setVeoVerified(!!getUserApiKey())} projectId={activeProjectId} />
            <ConfirmDialog isOpen={confirmDialog.isOpen} title={confirmDialog.title} message={confirmDialog.message} onConfirm={confirmDialog.action} onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))} confirmLabel={confirmDialog.confirmLabel} cancelLabel={confirmDialog.cancelLabel} isDestructive={confirmDialog.isDestructive} />
            {comparisonAssets && <ComparisonView assetA={comparisonAssets[0]} assetB={comparisonAssets[1]} onClose={() => setComparisonAssets(null)} />}
            {editorAsset && <CanvasEditor
                imageUrl={editorAsset.url}
                onSaveToConfig={handleCanvasSaveToConfig}
                onSaveToChat={handleCanvasSaveToChat}
                onClose={() => setEditorAsset(null)}
                originalMetadata={{
                    model: editorAsset.metadata?.model,
                    aspectRatio: editorAsset.metadata?.aspectRatio,
                    resolution: editorAsset.metadata?.resolution
                }}
                onDirectGenerate={(payload, options) => {
                    // Build edit params from payload
                    const baseMatch = payload.baseImageDataUrl.match(/^data:(.+);base64,(.+)$/);
                    const maskMatch = payload.mergedMaskDataUrl.match(/^data:(.+);base64,(.+)$/);
                    if (!baseMatch || !maskMatch) return;

                    const editBaseImage = { id: 'direct-base', mimeType: baseMatch[1], data: baseMatch[2] };
                    const editMask = { id: 'direct-mask', mimeType: maskMatch[1], data: maskMatch[2] };
                    const editRegions = payload.regions.map(r => {
                        const regionMatch = r.maskDataUrl.match(/^data:(.+);base64,(.+)$/);
                        return {
                            id: r.id,
                            color: r.color,
                            instruction: r.instruction,
                            maskData: regionMatch ? regionMatch[2] : '',
                            maskMimeType: regionMatch ? regionMatch[1] : 'image/png'
                        };
                    });

                    // Build prompt from region instructions (already formatted)
                    const regionInstructions = editRegions
                        .filter(r => r.instruction?.trim())
                        .map(r => `Region ${r.id}: ${r.instruction.trim()}`)
                        .join('\n');
                    const editPrompt = buildEditPrompt(regionInstructions || 'Apply edits to marked areas');

                    // Generate with full params
                    handleGenerate({
                        prompt: editPrompt,
                        aspectRatio: options.aspectRatio,
                        imageModel: options.imageModel,
                        imageResolution: options.imageResolution,
                        videoModel: params.videoModel,
                        editBaseImage,
                        editMask,
                        editRegions,
                        numberOfImages: 1,
                        continuousMode: false
                    } as GenerationParams, {
                        modeOverride: AppMode.IMAGE,  // FIX: Always use IMAGE mode for inpainting
                        useParamsAsBase: false
                    });
                }}
            />}
            <ToastContainer toasts={toasts} onDismiss={removeToast} />
        </div>
    );
}
