/**
 * Memory Editor Component
 * 
 * Settings page for managing AI memory
 * Provides preview, edit, rollback, and export/import capabilities
 */

import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Save, Download, Upload, Trash2,
  Edit3, AlertTriangle, Check, X,
  FileText
} from 'lucide-react';
import {
  getGlobalMemory,
  getProjectMemory,
  updateMemoryContent,
  getMemoryHistory,
  exportMemoryBundle,
  importMemoryBundle,
  softDeleteMemory,
  validateMemoryContent,
  MemoryDoc,
  MemoryOp
} from '../services/memoryService';

interface MemoryEditorProps {
  projectId?: string | null;
  onClose?: () => void;
}

type MemoryTab = 'global' | 'project';

export const MemoryEditor: React.FC<MemoryEditorProps> = ({
  projectId,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<MemoryTab>(projectId ? 'project' : 'global');
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [previewContent, setPreviewContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [history, setHistory] = useState<MemoryOp[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load memory content
  const loadMemory = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      let doc: MemoryDoc | null;
      if (activeTab === 'global') {
        doc = await getGlobalMemory();
      } else if (projectId) {
        doc = await getProjectMemory(projectId);
      } else {
        doc = null;
      }

      if (doc) {
        setPreviewContent(doc.content);
        setEditContent(doc.content);

        // Load history
        const ops = await getMemoryHistory(
          activeTab,
          activeTab === 'global' ? 'default' : projectId!
        );
        setHistory(ops);
      }
    } catch (e: any) {
      console.error('Failed to load memory:', e);
      setError(`加载记忆失败: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, projectId]);

  useEffect(() => {
    loadMemory();
  }, [loadMemory]);

  // Handle save
  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Validate before save
      const validation = validateMemoryContent(editContent);
      if (!validation.valid) {
        setError(validation.errors.join(', '));
        setIsSaving(false);
        return;
      }

      await updateMemoryContent(
        activeTab,
        activeTab === 'global' ? 'default' : projectId!,
        editContent,
        'manual_edit'
      );

      setPreviewContent(editContent);
      setIsEditing(false);
      setSuccess('保存成功');

      // Reload history
      const ops = await getMemoryHistory(
        activeTab,
        activeTab === 'global' ? 'default' : projectId!
      );
      setHistory(ops);

      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      console.error('Failed to save memory:', e);
      setError(`保存失败: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle cancel edit
  const handleCancel = () => {
    setEditContent(previewContent);
    setIsEditing(false);
    setError(null);
  };

  // Handle export
  const handleExport = async () => {
    try {
      const bundle = await exportMemoryBundle();
      const blob = new Blob([bundle], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-vision-studio-memory-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccess('导出成功');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(`导出失败: ${e.message}`);
    }
  };

  // Handle import
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = await importMemoryBundle(text);

      if (result.errors.length > 0) {
        setError(`导入完成，有 ${result.errors.length} 个错误`);
      } else {
        setSuccess(`成功导入 ${result.imported} 条记忆`);
      }

      // Reload memory
      await loadMemory();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(`导入失败: ${e.message}`);
    }

    // Reset input
    e.target.value = '';
  };

  // Handle delete (soft delete)
  const handleDelete = async () => {
    if (!confirm('确定要删除这段记忆吗？可以在回收站中恢复。')) {
      return;
    }

    try {
      await softDeleteMemory(
        activeTab,
        activeTab === 'global' ? 'default' : projectId!
      );
      setSuccess('记忆已删除');
      onClose?.();
    } catch (e: any) {
      setError(`删除失败: ${e.message}`);
    }
  };



  // Render loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tabs - Modern Pill Style */}
      <div className="px-6 py-4 flex items-center justify-between border-b border-dark-border bg-dark-surface/30">
        <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
          <button
            onClick={() => { setActiveTab('global'); setIsEditing(false); }}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'global'
              ? 'bg-brand-500 text-white shadow-lg shadow-brand-900/20'
              : 'text-gray-500 hover:text-gray-300'
              }`}
          >
            全局记忆
          </button>
          {projectId && (
            <button
              onClick={() => { setActiveTab('project'); setIsEditing(false); }}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'project'
                ? 'bg-brand-500 text-white shadow-lg shadow-brand-900/20'
                : 'text-gray-500 hover:text-gray-300'
                }`}
            >
              项目记忆
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isEditing && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`p-2 rounded-lg transition-all ${showHistory ? 'bg-brand-500/20 text-brand-400' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
              title="历史记录"
            >
              <FileText size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Error/Success Messages */}
      <div className="px-6 space-y-2 mt-4 empty:mt-0">
        {error && (
          <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 animate-in slide-in-from-top-2 duration-300">
            <AlertTriangle size={18} className="text-red-400 shrink-0" />
            <span className="text-sm text-red-200/90">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto p-1 hover:bg-white/10 rounded-lg">
              <X size={14} className="text-red-400" />
            </button>
          </div>
        )}
        {success && (
          <div className="px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center gap-3 animate-in slide-in-from-top-2 duration-300">
            <Check size={18} className="text-green-400 shrink-0" />
            <span className="text-sm text-green-200/90">{success}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 flex flex-col min-h-0">
        {isEditing ? (
          <div className="flex-1 flex flex-col bg-dark-bg rounded-2xl border border-dark-border overflow-hidden focus-within:border-brand-500/50 transition-colors shadow-inner">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="flex-1 w-full p-4 bg-transparent text-gray-200 font-mono text-sm resize-none focus:outline-none custom-scrollbar"
              placeholder="在此编辑记忆内容..."
              autoFocus
            />
          </div>
        ) : (
          <div className="flex-1 overflow-auto custom-scrollbar bg-dark-surface/30 rounded-2xl border border-dark-border p-6 shadow-inner">
            <div className="prose prose-invert prose-brand prose-sm max-w-none">
              <ReactMarkdown>{previewContent || '*暂无记忆内容*'}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {/* History Panel */}
      {showHistory && history.length > 0 && (
        <div className="mx-6 mb-4 p-4 bg-dark-surface/50 border border-dark-border rounded-2xl max-h-48 overflow-auto custom-scrollbar animate-in slide-in-from-bottom-2 duration-300">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">历史记录</h3>
          <div className="space-y-3">
            {history.slice(0, 10).map((op) => (
              <div key={op.id} className="text-xs text-gray-500 border-l-2 border-dark-border pl-3 py-0.5">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-gray-300 font-medium">{op.reason === 'manual_edit' ? '手动编辑' : op.operation}</span>
                  <span className="text-[10px] text-gray-600">{new Date(op.timestamp).toLocaleString()}</span>
                </div>
                {op.key && <span className="text-gray-600 italic">{op.key}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions Footer */}
      <div className="px-6 py-5 border-t border-dark-border bg-dark-bg/50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          {isEditing ? (
            <>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-brand-900/20"
              >
                {isSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={16} />}
                保存更改
              </button>
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-5 py-2.5 bg-dark-surface hover:bg-dark-panel border border-dark-border text-gray-300 text-sm font-bold rounded-xl transition-all"
              >
                <X size={16} />
                取消
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-brand-900/20"
              >
                <Edit3 size={16} />
                编辑记忆
              </button>
              <div className="w-px h-6 bg-white/10 mx-1" />
              <label className="flex items-center gap-2 px-4 py-2.5 bg-dark-surface hover:bg-dark-panel border border-dark-border text-gray-300 text-sm font-semibold rounded-xl transition-all cursor-pointer">
                <Upload size={16} />
                导入
                <input type="file" accept=".json" onChange={handleImport} className="hidden" />
              </label>
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2.5 bg-dark-surface hover:bg-dark-panel border border-dark-border text-gray-300 text-sm font-semibold rounded-xl transition-all"
              >
                <Download size={16} />
                导出
              </button>
            </>
          )}
        </div>

        {!isEditing && (
          <button
            onClick={handleDelete}
            className="flex items-center gap-2 px-4 py-2.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-all text-sm font-bold"
          >
            <Trash2 size={16} />
            清空
          </button>
        )}
      </div>
    </div>
  );
};

export default MemoryEditor;
