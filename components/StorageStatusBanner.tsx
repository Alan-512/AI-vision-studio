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

    // Check if already dismissed this session
    useEffect(() => {
        if (sessionStorage.getItem('storage_banner_dismissed') === 'true') {
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
                                : (isZh ? '数据存储提醒' : 'Storage Notice')
                            }
                        </h4>

                        <p className="text-xs text-gray-400 leading-relaxed mb-3">
                            {status === 'not_persisted' ? (
                                isZh
                                    ? '浏览器可能在空间不足时自动清理您的数据。请授权持久化存储以保护您的作品。'
                                    : 'Your browser may automatically clear your data when storage is low. Grant persistent storage to protect your work.'
                            ) : status === 'denied' ? (
                                isZh
                                    ? '浏览器拒绝了持久化请求。请尝试：将网站添加到书签、安装为应用、或使用其他浏览器。'
                                    : 'Browser denied persistence. Try: bookmarking this site, installing as an app, or using a different browser.'
                            ) : (
                                isZh
                                    ? '您的浏览器不支持持久化存储 API。数据可能在浏览器清理时丢失。'
                                    : 'Your browser does not support the Storage Persistence API. Data may be lost when browser clears storage.'
                            )}
                        </p>

                        {status === 'not_persisted' && (
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
                                    {isZh ? '授权持久化' : 'Grant Permission'}
                                </button>
                                <button
                                    onClick={handleDismiss}
                                    className="px-3 py-1.5 text-gray-500 hover:text-gray-300 text-xs transition-colors"
                                >
                                    {isZh ? '稍后提醒' : 'Remind Later'}
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
