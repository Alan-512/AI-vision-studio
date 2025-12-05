
import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ 
  isOpen, 
  title, 
  message, 
  confirmLabel, 
  cancelLabel, 
  isDestructive = false,
  onConfirm, 
  onCancel 
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-dark-panel border border-dark-border rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 text-center">
           <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isDestructive ? 'bg-red-500/20 text-red-500' : 'bg-brand-500/20 text-brand-500'}`}>
              <AlertTriangle size={24} />
           </div>
           <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
           <p className="text-sm text-gray-400">{message}</p>
        </div>
        
        <div className="flex border-t border-dark-border">
           <button 
             onClick={onCancel}
             className="flex-1 py-3 text-sm font-medium text-gray-400 hover:bg-white/5 transition-colors"
           >
             {cancelLabel}
           </button>
           <div className="w-px bg-dark-border" />
           <button 
             onClick={onConfirm}
             className={`flex-1 py-3 text-sm font-bold transition-colors ${isDestructive ? 'text-red-500 hover:bg-red-500/10' : 'text-brand-500 hover:bg-brand-500/10'}`}
           >
             {confirmLabel}
           </button>
        </div>
      </div>
    </div>
  );
};
