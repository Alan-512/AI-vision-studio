import type { Dispatch, SetStateAction } from 'react';
import { AppMode, ImageModel, type AgentJob, type ChatMessage, type GenerationParams, type Project } from '../types';

type ThoughtImage = {
  id: string;
  data: string;
  mimeType: string;
  isFinal: boolean;
  timestamp: number;
};

export const prepareAppGenerationRequest = async ({
  fullParams,
  useParamsAsBase,
  params,
  mode,
  activeProjectId,
  projects,
  historyOverride,
  videoCooldownEndTime,
  getUserApiKey,
  sanitizeImageModel,
  setThoughtImages,
  addToast,
  setShowSettings,
  generateTitle,
  setProjects,
  saveProject,
  jobSource,
  resolveNewProjectLabel,
  now = () => Date.now()
}: {
  fullParams: GenerationParams;
  useParamsAsBase: boolean;
  params: GenerationParams;
  mode: AppMode;
  activeProjectId: string;
  projects: Project[];
  historyOverride?: ChatMessage[];
  videoCooldownEndTime: number;
  getUserApiKey: () => string | null;
  sanitizeImageModel: (model: string | undefined) => ImageModel;
  setThoughtImages: Dispatch<SetStateAction<ThoughtImage[]>>;
  addToast: (type: 'success' | 'error' | 'info', title: string, message: string) => void;
  setShowSettings: (visible: boolean) => void;
  generateTitle?: (prompt: string) => Promise<string>;
  setProjects?: Dispatch<SetStateAction<Project[]>>;
  saveProject?: (project: Project) => Promise<void>;
  jobSource?: AgentJob['source'];
  resolveNewProjectLabel?: () => string;
  now?: () => number;
}) => {
  if (now() < videoCooldownEndTime) {
    addToast('error', 'System Cooled Down', 'Please wait for the timer to finish before generating again.');
    return null;
  }

  const userKey = getUserApiKey();
  if (!userKey) {
    setShowSettings(true);
    return null;
  }

  setThoughtImages([]);

  const activeParams = useParamsAsBase ? { ...params, ...fullParams } : { ...fullParams };
  activeParams.imageModel = sanitizeImageModel(activeParams.imageModel);

  const currentProjectId = activeProjectId;
  const currentMode = mode;
  const resolvedJobSource: AgentJob['source'] = jobSource || (historyOverride ? 'chat' : 'studio');
  const triggerMessageTimestamp = historyOverride
    ? [...historyOverride].reverse().find(message => message.role === 'user')?.timestamp
    : undefined;

  const project = projects.find(item => item.id === currentProjectId);
  const newProjectLabel = resolveNewProjectLabel?.() || 'New Project';
  if (
    project &&
    (project.name === 'New Project' || project.name === newProjectLabel) &&
    activeParams.prompt &&
    generateTitle &&
    setProjects &&
    saveProject
  ) {
    generateTitle(activeParams.prompt).then(name => {
      setProjects(prev => prev.map(item => item.id === currentProjectId ? { ...item, name } : item));
      saveProject({ ...project, name }).catch(console.error);
    });
  }

  return {
    userKey,
    activeParams,
    currentProjectId,
    currentMode,
    resolvedJobSource,
    triggerMessageTimestamp
  };
};
