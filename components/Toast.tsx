
import React, { useEffect } from 'react';
import { CheckCircle, AlertCircle, X, Info } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed top-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage, onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, 3000); // Auto dismiss after 3s (industry standard)
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className="pointer-events-auto bg-dark-panel border border-dark-border rounded-xl shadow-2xl shadow-black/50 p-4 w-80 animate-in slide-in-from-right-10 fade-in duration-300 flex gap-3 relative overflow-hidden">
      {/* Status Bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${toast.type === 'success' ? 'bg-green-500' : toast.type === 'error' ? 'bg-red-500' : 'bg-blue-500'
        }`} />

      <div className={`mt-0.5 shrink-0 ${toast.type === 'success' ? 'text-green-500' : toast.type === 'error' ? 'text-red-500' : 'text-blue-500'
        }`}>
        {toast.type === 'success' ? <CheckCircle size={20} /> : toast.type === 'error' ? <AlertCircle size={20} /> : <Info size={20} />}
      </div>

      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-bold text-gray-200">{toast.title}</h4>
        <p className="text-xs text-gray-400 mt-1 leading-relaxed line-clamp-2">{toast.message}</p>
      </div>

      <button
        onClick={() => onDismiss(toast.id)}
        className="text-gray-500 hover:text-white transition-colors shrink-0 self-start"
      >
        <X size={16} />
      </button>
    </div>
  );
};
