import React, { useState, useEffect } from 'react';
import { AlertTriangle, Shield, X, CheckCircle } from 'lucide-react';
import { initStoragePersistence } from '../services/storageService';
import { useLanguage } from '../contexts/LanguageContext';

interface StorageStatusBannerProps {
    onDismiss?: () => void;
}

export const StorageStatusBanner: React.FC<StorageStatusBannerProps> = ({ onDismiss }) => {
    const { language } = useLanguage();
    const [status, setStatus] = useState<'checking' | 'persisted' | 'not_persisted' | 'denied' | 'unsupported' | 'dismissed'>('checking');
    const [isRequesting, setIsRequesting] = useState(false);

    useEffect(() => {
        checkPersistenceStatus();
    }, []);

    const checkPersistenceStatus = async () => {
        // Check if Storage API is supported
        if (!navigator.storage || !navigator.storage.persisted) {
            setStatus('unsupported');
            return;
        }

        try {
            const isPersisted = await navigator.storage.persisted();
            setStatus(isPersisted ? 'persisted' : 'not_persisted');
        } catch (e) {
            console.warn('Failed to check persistence status:', e);
            setStatus('unsupported');
        }
    };

    const requestPersistence = async () => {
        setIsRequesting(true);
        try {
            const granted = await initStoragePersistence();
            if (granted) {
                setStatus('persisted');
            } else {
                // Browser denied the request silently - show feedback
                setStatus('denied');
            }
        } catch (e) {
            console.error('Failed to request persistence:', e);
            setStatus('denied');
        } finally {
            setIsRequesting(false);
        }
    };

    const handleDismiss = () => {
        setStatus('dismissed');
        // Remember dismissal for this session
        sessionStorage.setItem('storage_banner_dismissed', 'true');
        onDismiss?.();
    };

    // Handle "don't remind again" - permanent dismissal
    const handleDontRemindAgain = () => {
        setStatus('dismissed');
        localStorage.setItem('storage_banner_never_show', 'true');
        onDismiss?.();
    };

    // Check if already dismissed this session or permanently
    useEffect(() => {
        if (localStorage.getItem('storage_banner_never_show') === 'true') {
            setStatus('dismissed');
        } else if (sessionStorage.getItem('storage_banner_dismissed') === 'true') {
            setStatus('dismissed');
        }
    }, []);

    // Don't show if persisted, dismissed, or still checking
    if (status === 'persisted' || status === 'dismissed' || status === 'checking') {
        return null;
    }

    const isZh = language === 'zh';
    const isDeniedOrUnsupported = status === 'denied' || status === 'unsupported';

    return (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div className={`rounded-xl border shadow-2xl backdrop-blur-sm p-4 ${status === 'not_persisted'
                ? 'bg-yellow-500/10 border-yellow-500/30'
                : status === 'denied'
                    ? 'bg-orange-500/10 border-orange-500/30'
                    : 'bg-gray-500/10 border-gray-500/30'
                }`}>
                <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg shrink-0 ${status === 'not_persisted'
                        ? 'bg-yellow-500/20'
                        : status === 'denied'
                            ? 'bg-orange-500/20'
                            : 'bg-gray-500/20'
                        }`}>
                        {status === 'not_persisted' ? (
                            <AlertTriangle size={20} className="text-yellow-500" />
                        ) : status === 'denied' ? (
                            <AlertTriangle size={20} className="text-orange-500" />
                        ) : (
                            <Shield size={20} className="text-gray-500" />
                        )}
                    </div>

                    <div className="flex-1 min-w-0">
                        <h4 className={`text-sm font-bold mb-1 ${status === 'not_persisted' ? 'text-yellow-200'
                            : status === 'denied' ? 'text-orange-200'
                                : 'text-gray-300'
                            }`}>
                            {status === 'denied'
                                ? (isZh ? '授权被拒绝' : 'Permission Denied')
                                : (isZh ? '保护您的作品' : 'Protect Your Work')
                            }
                        </h4>

                        <p className="text-xs text-gray-400 leading-relaxed mb-3">
                            {status === 'not_persisted' ? (
                                isZh
                                    ? '您的创作保存在浏览器本地。开启"数据保护"后，即使磁盘空间不足，浏览器也不会自动清理您的作品。'
                                    : 'Your creations are saved locally. Enable "Data Protection" to prevent automatic cleanup even when storage is low.'
                            ) : status === 'denied' ? (
                                isZh
                                    ? '浏览器拒绝了请求。建议：将网站添加到书签、安装为应用、或使用 Chrome/Edge。'
                                    : 'Browser denied the request. Try: bookmarking this site, installing as an app, or using Chrome/Edge.'
                            ) : (
                                isZh
                                    ? '您的浏览器不支持数据保护功能。建议定期导出重要作品。'
                                    : 'Your browser does not support data protection. Consider exporting important work regularly.'
                            )}
                        </p>

                        {status === 'not_persisted' && (
                            <div className="flex flex-col gap-2">
                                <div className="flex gap-2">
                                    <button
                                        onClick={requestPersistence}
                                        disabled={isRequesting}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 text-xs font-medium rounded-lg border border-yellow-500/30 transition-colors disabled:opacity-50"
                                    >
                                        {isRequesting ? (
                                            <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                            <Shield size={12} />
                                        )}
                                        {isZh ? '开启保护' : 'Enable Protection'}
                                    </button>
                                    <button
                                        onClick={handleDismiss}
                                        className="px-3 py-1.5 text-gray-500 hover:text-gray-300 text-xs transition-colors"
                                    >
                                        {isZh ? '下次再说' : 'Maybe Later'}
                                    </button>
                                </div>
                                <button
                                    onClick={handleDontRemindAgain}
                                    className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors text-left"
                                >
                                    {isZh ? '不再提醒' : "Don't remind me again"}
                                </button>
                            </div>
                        )}

                        {isDeniedOrUnsupported && (
                            <button
                                onClick={handleDismiss}
                                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${status === 'denied'
                                    ? 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border-orange-500/30'
                                    : 'bg-gray-500/20 hover:bg-gray-500/30 text-gray-400 border-gray-500/30'
                                    }`}
                            >
                                {isZh ? '我知道了' : 'I Understand'}
                            </button>
                        )}
                    </div>

                    <button
                        onClick={handleDismiss}
                        className="p-1 text-gray-500 hover:text-gray-300 transition-colors shrink-0"
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
};

// Success toast when persistence is granted
export const PersistenceGrantedToast: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { language } = useLanguage();
    const isZh = language === 'zh';

    useEffect(() => {
        const timer = setTimeout(onClose, 3000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-center gap-3 shadow-2xl backdrop-blur-sm">
                <div className="p-2 bg-green-500/20 rounded-lg">
                    <CheckCircle size={20} className="text-green-500" />
                </div>
                <div>
                    <h4 className="text-sm font-bold text-green-200">
                        {isZh ? '存储已保护' : 'Storage Protected'}
                    </h4>
                    <p className="text-xs text-gray-400">
                        {isZh ? '您的数据将不会被自动清理' : 'Your data will not be automatically cleared'}
                    </p>
                </div>
            </div>
        </div>
    );
};
