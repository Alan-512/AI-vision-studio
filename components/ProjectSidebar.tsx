
import React, { useState, useRef, useEffect } from 'react';
import { Project } from '../types';
import { Plus, MessageSquare, Trash2, Clock, X, Loader2, Pencil } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface ProjectSidebarProps {
  projects: Project[];
  activeProjectId: string;
  generatingStates?: Record<string, number>; // Maps projectId -> startTime
  onSelectProject: (projectId: string) => void;
  onCreateProject: () => void;
  onRenameProject: (projectId: string, newName: string) => void;
  onDeleteProject: (projectId: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  projects,
  activeProjectId,
  generatingStates,
  onSelectProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  isOpen,
  onClose
}) => {
  const { t } = useLanguage();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingId]);

  if (!isOpen) return null;

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const handleStartEditing = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setEditingId(project.id);
    setEditName(project.name);
  };

  const handleSaveRename = (projectId: string) => {
    if (editName.trim() && editName.trim() !== '') {
      onRenameProject(projectId, editName);
    }
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, projectId: string) => {
    if (e.key === 'Enter') {
      handleSaveRename(projectId);
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  return (
    <>
      {/* Invisible backdrop to capture clicks outside the sidebar */}
      <div 
        className="fixed inset-0 z-40 bg-transparent"
        onClick={onClose}
      />
      
      <div 
        className="absolute top-0 bottom-0 left-24 w-72 bg-dark-panel border-r border-dark-border z-50 shadow-2xl shadow-black/50 flex flex-col animate-in slide-in-from-left-5 fade-in duration-200"
        onClick={(e) => e.stopPropagation()} // Prevent clicks inside from closing
      >
        <div className="p-4 border-b border-dark-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider">{t('nav.projects')}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
        
        <div className="p-4 border-b border-dark-border">
          <button
            onClick={() => {
              onCreateProject();
            }}
            className="w-full py-2.5 px-3 bg-brand-600 hover:bg-brand-500 text-white rounded-lg flex items-center justify-center gap-2 transition-colors font-medium text-sm shadow-lg shadow-brand-900/20"
          >
            <Plus size={16} />
            {t('nav.new_project')}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {projects.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-500">
              {t('msg.no_assets')}
            </div>
          ) : (
            projects.sort((a,b) => b.updatedAt - a.updatedAt).map(project => {
              const isGenerating = generatingStates ? !!generatingStates[project.id] : false;
              const isEditing = editingId === project.id;

              return (
                <div
                  key={project.id}
                  className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border ${
                    project.id === activeProjectId && !isEditing
                      ? 'bg-brand-500/10 text-white border-brand-500/30 shadow-sm'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border-transparent'
                  }`}
                  onClick={() => !isEditing && onSelectProject(project.id)}
                >
                  <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0 mr-2">
                    <div className="relative shrink-0">
                       <MessageSquare size={18} className={project.id === activeProjectId && !isEditing ? 'text-brand-500' : 'text-gray-600'} />
                       {isGenerating && (
                          <div className="absolute -top-1 -right-1 bg-dark-panel rounded-full p-[1px]">
                             <Loader2 size={10} className="text-brand-500 animate-spin" />
                          </div>
                       )}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      {isEditing ? (
                        <input 
                          ref={editInputRef}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={() => handleSaveRename(project.id)}
                          onKeyDown={(e) => handleKeyDown(e, project.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full bg-black/40 border border-brand-500/50 rounded px-1.5 py-0.5 text-sm text-white focus:outline-none focus:border-brand-500"
                        />
                      ) : (
                        <>
                          <span className="text-sm font-medium truncate">
                            {project.name}
                          </span>
                          <span className="text-[10px] text-gray-600 flex items-center gap-1">
                            <Clock size={10} />
                            {formatDate(project.updatedAt)}
                            {isGenerating && <span className="text-brand-500 ml-1">{t('nav.generating')}</span>}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => handleStartEditing(e, project)}
                        className="p-1.5 hover:bg-white/10 text-gray-500 hover:text-white rounded transition-colors"
                        title="Rename Project"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isGenerating) {
                            alert(t('nav.delete_error'));
                            return;
                          }
                          if (confirm(t('nav.delete_confirm'))) {
                            onDeleteProject(project.id);
                          }
                        }}
                        className="p-1.5 hover:bg-red-500/20 text-gray-500 hover:text-red-500 rounded transition-colors"
                        title="Delete Project"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        
        <div className="p-3 bg-black/20 text-[10px] text-gray-600 text-center border-t border-dark-border">
          Context is saved automatically.
        </div>
      </div>
    </>
  );
};
