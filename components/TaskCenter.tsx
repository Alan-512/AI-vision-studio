
import React, { useState, useEffect } from 'react';
import { BackgroundTask } from '../types';
import { Loader2, CheckCircle, AlertCircle, Maximize2, Minimize2, Image, Video, Clock, X, ChevronUp, ChevronDown, List } from 'lucide-react';

interface TaskCenterProps {
  tasks: BackgroundTask[];
  onClearCompleted: () => void;
  onRemoveTask: (taskId: string) => void;
}

export const TaskCenter: React.FC<TaskCenterProps> = ({ tasks, onClearCompleted, onRemoveTask }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Update timers every second
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const activeTasks = tasks.filter(t => t.status === 'QUEUED' || t.status === 'GENERATING');
  const failedTasks = tasks.filter(t => t.status === 'FAILED');
  const completedTasks = tasks.filter(t => t.status === 'COMPLETED' || t.status === 'FAILED');
  
  // Sort tasks: Newest first
  const sortedTasks = [...tasks].sort((a, b) => b.startTime - a.startTime);

  if (tasks.length === 0) return null;

  const formatDuration = (start: number) => {
    const diff = Math.floor((now - start) / 1000);
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  const hasActive = activeTasks.length > 0;
  const hasFailed = failedTasks.length > 0;

  return (
    <div className={`fixed bottom-6 right-6 z-50 transition-all duration-300 ${isExpanded ? 'w-80' : 'w-auto'}`}>
      
      {/* Collapsed Pill */}
      {!isExpanded && (
        <button 
          onClick={() => setIsExpanded(true)}
          className={`flex items-center gap-3 bg-dark-panel border border-dark-border shadow-2xl shadow-black/50 rounded-full px-4 py-3 hover:bg-dark-surface transition-colors group animate-in slide-in-from-bottom-5 fade-in ${
             hasFailed && !hasActive ? 'border-red-500/50' : ''
          }`}
        >
          <div className="relative">
             {hasActive ? (
               <>
                 <div className="w-2.5 h-2.5 bg-brand-500 rounded-full animate-pulse" />
                 <div className="absolute inset-0 bg-brand-500 rounded-full animate-ping opacity-75" />
               </>
             ) : hasFailed ? (
                <AlertCircle size={16} className="text-red-500" />
             ) : (
                <CheckCircle size={16} className="text-green-500" />
             )}
          </div>
          <div className="flex flex-col items-start">
             <span className={`text-xs font-bold leading-none ${hasFailed && !hasActive ? 'text-red-400' : 'text-white'}`}>
               {hasActive 
                  ? `${activeTasks.length} Active Tasks` 
                  : hasFailed 
                     ? 'Generation Failed' 
                     : 'Tasks Complete'
               }
             </span>
             {activeTasks.length > 0 && (
               <span className="text-[10px] text-gray-400 leading-none mt-1">
                  {activeTasks.some(t => t.status === 'GENERATING') ? 'Processing...' : 'Queued'}
               </span>
             )}
          </div>
          <ChevronUp size={16} className="text-gray-500 group-hover:text-white ml-2" />
        </button>
      )}

      {/* Expanded Panel */}
      {isExpanded && (
        <div className="bg-dark-panel border border-dark-border shadow-2xl shadow-black/50 rounded-xl overflow-hidden animate-in slide-in-from-bottom-5 fade-in flex flex-col max-h-96">
          {/* Header */}
          <div className="flex items-center justify-between p-3 bg-dark-surface/50 border-b border-dark-border">
            <div className="flex items-center gap-2">
               <List size={16} className="text-brand-500" />
               <span className="text-xs font-bold text-white uppercase tracking-wider">Task Center</span>
            </div>
            <div className="flex gap-1">
               {completedTasks.length > 0 && (
                 <button 
                   onClick={(e) => { e.stopPropagation(); onClearCompleted(); }}
                   className="p-1 hover:bg-white/10 rounded text-[10px] text-gray-400 hover:text-white transition-colors"
                   title="Clear Completed"
                 >
                   Clear Done
                 </button>
               )}
               <button onClick={() => setIsExpanded(false)} className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white transition-colors">
                  <ChevronDown size={16} />
               </button>
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto p-2 space-y-2 custom-scrollbar">
            {sortedTasks.map(task => {
              const isActive = task.status === 'QUEUED' || task.status === 'GENERATING';
              return (
                <div key={task.id} className="bg-black/20 rounded-lg p-3 border border-dark-border/50 relative group">
                  <div className="flex items-start justify-between gap-3">
                     {/* Icon */}
                     <div className="mt-0.5 shrink-0">
                        {task.status === 'GENERATING' && <Loader2 size={16} className="text-brand-500 animate-spin" />}
                        {task.status === 'QUEUED' && <Clock size={16} className="text-yellow-500" />}
                        {task.status === 'COMPLETED' && <CheckCircle size={16} className="text-green-500" />}
                        {task.status === 'FAILED' && <AlertCircle size={16} className="text-red-500" />}
                     </div>
                     
                     {/* Content */}
                     <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                           {task.type === 'IMAGE' ? <Image size={10} className="text-gray-500"/> : <Video size={10} className="text-gray-500"/>}
                           <span className="text-xs font-medium text-gray-300 truncate">{task.projectName}</span>
                        </div>
                        <p className="text-[10px] text-gray-500 line-clamp-1 mb-1.5">{task.prompt}</p>
                        
                        <div className="flex items-center justify-between">
                           <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${getStatusColor(task.status)}`}>
                              {task.status === 'GENERATING' ? `Running ${formatDuration(task.executionStartTime || task.startTime)}` : task.status}
                           </span>
                           {task.status === 'QUEUED' && (
                               <span className="text-[10px] text-gray-600">Waiting for slot...</span>
                           )}
                        </div>
                     </div>

                     {/* Remove/Cancel Button */}
                     <button 
                       onClick={() => onRemoveTask(task.id)}
                       className={`absolute top-2 right-2 p-1 rounded transition-all ${isActive ? 'text-gray-400 hover:text-red-400 bg-white/5 hover:bg-red-500/10' : 'text-gray-600 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100'}`}
                       title={isActive ? "Cancel Task" : "Remove"}
                     >
                        <X size={14} />
                     </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const getStatusColor = (status: string) => {
  switch(status) {
    case 'GENERATING': return 'bg-brand-500/10 text-brand-400';
    case 'QUEUED': return 'bg-yellow-500/10 text-yellow-400';
    case 'COMPLETED': return 'bg-green-500/10 text-green-400';
    case 'FAILED': return 'bg-red-500/10 text-red-400';
    default: return 'bg-gray-800 text-gray-500';
  }
};
