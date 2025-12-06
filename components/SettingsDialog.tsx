
import React, { useState, useEffect } from 'react';
import { X, Save, Key, Trash2, ExternalLink, AlertTriangle, Activity, CheckCircle, AlertCircle, HardDrive } from 'lucide-react';
import { saveUserApiKey, getUserApiKey, removeUserApiKey, testConnection } from '../services/geminiService';
import { getStorageEstimate } from '../services/storageService';
import { useLanguage } from '../contexts/LanguageContext';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApiKeyChange?: () => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose, onApiKeyChange }) => {
  const { t } = useLanguage();
  const [apiKey, setApiKey] = useState('');
  const [savedKey, setSavedKey] = useState<string | null>(null);
  
  // Test Connection State
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Storage State
  const [storageInfo, setStorageInfo] = useState<{ usage: number; quota: number; percentage: number } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const key = getUserApiKey();
      setSavedKey(key);
      setApiKey(key || '');
      setTestResult(null);
      setTestStatus('idle');
      
      // Check storage
      getStorageEstimate().then(setStorageInfo);
    }
  }, [isOpen]);

  const handleSave = () => {
    if (!apiKey.trim()) return;
    saveUserApiKey(apiKey.trim());
    setSavedKey(apiKey.trim());
    if (onApiKeyChange) onApiKeyChange();
    onClose();
    alert("API Key saved successfully.");
  };

  const handleRemove = () => {
    if (confirm("Are you sure you want to remove your API Key?")) {
      removeUserApiKey();
      setSavedKey(null);
      setApiKey('');
      setTestResult(null);
      setTestStatus('idle');
      if (onApiKeyChange) onApiKeyChange();
    }
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim()) return;
    
    setIsTesting(true);
    setTestResult(null);
    setTestStatus('idle');
    
    try {
      await testConnection(apiKey.trim());
      setTestStatus('success');
      setTestResult(t('msg.connection_success'));
    } catch (error) {
      setTestStatus('error');
      setTestResult(error instanceof Error ? error.message : t('msg.connection_failed'));
    } finally {
      setIsTesting(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-dark-panel border border-dark-border rounded-2xl w-full max-w-md shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-dark-border flex items-center justify-between bg-dark-surface/50">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Key size={18} className="text-brand-500" />
            {t('settings.title')}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* API Key Section */}
          <div className="space-y-4">
            <label className="block text-sm font-medium text-gray-300">
              {t('settings.key_label')}
            </label>
            
            <div className="relative">
              <input 
                type="password" 
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-dark-bg border border-dark-border rounded-xl p-3 pl-10 text-sm text-white focus:border-brand-500 focus:outline-none transition-colors font-mono"
              />
              <Key size={16} className="absolute left-3 top-3.5 text-gray-500" />
            </div>

            <p className="text-xs text-gray-400 leading-relaxed">
              {t('settings.key_desc')}
            </p>

            <a 
              href="https://aistudio.google.com/app/apikey" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 hover:underline"
            >
              {t('settings.get_key')} <ExternalLink size={10} />
            </a>
          </div>

          {savedKey && (
             <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex items-start gap-3">
                <AlertTriangle size={16} className="text-yellow-500 shrink-0 mt-0.5" />
                <div className="text-xs text-yellow-200/80">
                   {t('settings.custom_key_alert')}
                </div>
             </div>
          )}
          
          {/* Test Result Feedback */}
          {testStatus !== 'idle' && (
             <div className={`p-3 border rounded-lg flex items-start gap-3 ${
                testStatus === 'success' 
                  ? 'bg-green-500/10 border-green-500/20 text-green-200' 
                  : 'bg-red-500/10 border-red-500/20 text-red-200'
             }`}>
                {testStatus === 'success' ? <CheckCircle size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}
                <div className="text-xs">
                   {testResult}
                </div>
             </div>
          )}

          <div className="h-px bg-white/5 my-2" />

          {/* Storage Section */}
          <div className="space-y-3">
             <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
                <HardDrive size={16} className={storageInfo && storageInfo.percentage > 80 ? "text-red-500" : "text-gray-500"} />
                {t('settings.storage_title')}
             </div>
             
             {storageInfo ? (
                <div className="space-y-2">
                   <div className="w-full h-2 bg-dark-bg rounded-full overflow-hidden border border-white/5">
                      <div 
                         className={`h-full transition-all duration-500 ${storageInfo.percentage > 90 ? 'bg-red-500' : storageInfo.percentage > 75 ? 'bg-yellow-500' : 'bg-brand-500'}`} 
                         style={{ width: `${storageInfo.percentage}%` }}
                      />
                   </div>
                   <div className="flex justify-between text-[10px] text-gray-400">
                      <span>{t('settings.used')}: {formatBytes(storageInfo.usage)}</span>
                      <span>{t('settings.free')}: {formatBytes(storageInfo.quota - storageInfo.usage)}</span>
                   </div>
                   {storageInfo.percentage > 80 && (
                      <div className="text-[10px] text-red-400 font-medium">
                         {t('settings.storage_full')}
                      </div>
                   )}
                </div>
             ) : (
                <div className="text-xs text-gray-500 italic">{t('settings.calculating')}</div>
             )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-dark-border bg-dark-bg/50 flex justify-between items-center shrink-0">
          {savedKey ? (
            <button 
              onClick={handleRemove}
              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={14} /> {t('btn.remove_key')}
            </button>
          ) : <div></div>}
          
          <div className="flex gap-3">
             <button 
              onClick={handleTestConnection}
              disabled={!apiKey.trim() || isTesting}
              className="px-4 py-2 bg-dark-surface hover:bg-dark-panel border border-dark-border text-gray-200 text-sm font-semibold rounded-lg flex items-center gap-2 transition-all disabled:opacity-50"
            >
              {isTesting ? <div className="w-3 h-3 rounded-full border-2 border-gray-400 border-t-white animate-spin"/> : <Activity size={16} />}
              {t('btn.test_connection')}
            </button>
            <button 
              onClick={handleSave}
              disabled={!apiKey.trim()}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg flex items-center gap-2 shadow-lg shadow-brand-900/20 transition-all"
            >
              <Save size={16} />
              {t('btn.save_key')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
