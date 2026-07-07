import React from 'react';
import { Undo, Trash2, Pencil, Eraser } from 'lucide-react';

interface CanvasToolbarProps {
  tool: 'pen' | 'eraser';
  setTool: (tool: 'pen' | 'eraser') => void;
  brushColor: string;
  setBrushColor: (color: string) => void;
  brushWidth: number;
  setBrushWidth: (width: number) => void;
  mode: 'draw' | 'grade' | 'readonly';
  historyLength: number;
  handleUndo: () => void;
  handleClear: () => void;
  activeStamp?: string | null;
  onClearStamp?: () => void;
}

export const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
  tool,
  setTool,
  brushColor,
  setBrushColor,
  brushWidth,
  setBrushWidth,
  mode,
  historyLength,
  handleUndo,
  handleClear,
  activeStamp,
  onClearStamp,
}) => {
  const handleSelectTool = (newTool: 'pen' | 'eraser') => {
    setTool(newTool);
    if (onClearStamp) {
      onClearStamp();
    }
  };

  return (
    <div 
      className="flex flex-wrap items-center gap-5 px-6 py-3.5 bg-[#FFFDF7]"
      style={{
        border: '2px solid var(--color-gray-border)',
        borderRadius: '24px',
        boxShadow: '0 12px 24px rgba(100,110,130,0.05), 0 4px 0 var(--color-gray-border)',
      }}
    >
      {/* 工具选择 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleSelectTool('pen')}
          className={`btn-3d p-2 border-2 text-xs font-black ${
            tool === 'pen' && !activeStamp 
              ? 'btn-3d-primary' 
              : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'
          }`}
          style={{
            padding: '10px',
            boxShadow: tool === 'pen' && !activeStamp ? undefined : '0 3px 0 #E5E5E5',
          }}
          title="写字画笔"
        >
          <Pencil size={18} />
        </button>
        <button
          onClick={() => handleSelectTool('eraser')}
          className={`btn-3d p-2 border-2 text-xs font-black ${
            tool === 'eraser' && !activeStamp 
              ? 'btn-3d-secondary' 
              : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'
          }`}
          style={{
            padding: '10px',
            boxShadow: tool === 'eraser' && !activeStamp ? undefined : '0 3px 0 #E5E5E5',
          }}
          title="橡皮擦"
        >
          <Eraser size={18} />
        </button>
      </div>

      {/* 粗细选择 */}
      <div className="flex items-center gap-2.5" style={{ borderLeft: '2px solid var(--color-gray-border)', paddingLeft: '16px' }}>
        <span style={{ fontSize: '13px', fontWeight: '900', color: 'var(--color-text)' }}>
          {tool === 'eraser' ? '橡皮大小:' : '笔触粗细:'}
        </span>
        <input
          type="range"
          min="2"
          max="15"
          value={brushWidth}
          onChange={(e) => setBrushWidth(Number(e.target.value))}
          style={{ cursor: 'pointer', accentColor: 'var(--color-blue)' }}
        />
        <span className="badge-jelly text-xs font-black px-2 py-0.5" style={{ minWidth: '24px', textAlign: 'center' }}>
          {brushWidth}
        </span>
      </div>

      {/* 调色盘 (仅学生绘制模式下，支持彩色选择，老师默认使用严肃红笔) */}
      {mode === 'draw' && tool === 'pen' && !activeStamp && (
        <div className="flex gap-2" style={{ borderLeft: '2px solid var(--color-gray-border)', paddingLeft: '16px' }}>
          {['#3A86FF', '#58CC02', '#FF8A93', '#3C3C3C'].map((color) => {
            const isSelected = brushColor === color;
            return (
              <button
                key={color}
                onClick={() => setBrushColor(color)}
                className="transition-transform active:scale-90"
                style={{
                  backgroundColor: color,
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  border: isSelected ? '2px solid #000' : '2px solid rgba(255,255,255,0.8)',
                  boxShadow: isSelected ? '0 2px 6px rgba(0,0,0,0.3)' : '0 2px 4px rgba(0,0,0,0.08)',
                  cursor: 'pointer',
                }}
              />
            );
          })}
        </div>
      )}

      {/* 快捷红印章状态显示提示 */}
      {activeStamp && (
        <div 
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black animate-bounce shadow-[0_3px_0_#E06C75]"
          style={{
            backgroundColor: 'var(--color-secondary)',
            color: '#FFFFFF',
            border: '2px solid var(--color-secondary-depth)',
          }}
        >
          <span>印章中: {activeStamp}</span>
        </div>
      )}

      {/* 历史操作 */}
      <div className="flex items-center gap-2" style={{ borderLeft: '2px solid var(--color-gray-border)', paddingLeft: '16px', marginLeft: 'auto' }}>
        <button
          onClick={handleUndo}
          disabled={historyLength === 0}
          className={`btn-3d p-2 border-2 text-xs ${
            historyLength === 0 
              ? 'btn-3d-disabled' 
              : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'
          }`}
          style={{
            padding: '10px',
            boxShadow: historyLength === 0 ? undefined : '0 3px 0 #E5E5E5',
          }}
          title="撤销一步"
        >
          <Undo size={16} />
        </button>
        <button
          onClick={handleClear}
          className="btn-3d p-2 border-2 bg-white text-red-500 border-red-200 shadow-[0_3px_0_#FFB7B2]"
          style={{
            padding: '10px',
            boxShadow: '0 3px 0 #FFB7B2',
          }}
          title="全部擦除"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
};
