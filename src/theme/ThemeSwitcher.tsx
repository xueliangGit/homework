import { useState } from 'react';
import { useTheme, SEGMENT_LABELS, SUBJECT_LABELS, type Segment, type Subject } from './ThemeContext';

const SEGMENTS: Segment[] = ['you', 'xiao', 'zhong'];
const SUBJECTS: Subject[] = ['general', 'chinese', 'math', 'english', 'science'];

// 主题选择面板（两种形态共用）
function ThemePanel() {
  const { theme, subject, setTheme, setSubject } = useTheme();
  return (
    <div
      className="card-jelly bg-white p-4 rounded-2xl w-64 shadow-jelly-card"
      style={{ border: '2px solid var(--color-gray-border)' }}
    >
      <div className="text-xs font-extrabold text-gray-400 mb-2">学段主题</div>
      <div className="flex gap-2 mb-3">
        {SEGMENTS.map((s) => (
          <button
            key={s}
            onClick={() => setTheme(s)}
            className="flex-1 py-2 rounded-xl text-sm font-bold transition-transform active:scale-95"
            style={
              theme === s
                ? {
                    background: 'var(--color-primary)',
                    color: '#fff',
                    boxShadow: '0 3px 0 var(--color-primary-depth)',
                  }
                : { background: 'var(--color-gray-bg)', color: 'var(--color-text)' }
            }
          >
            {SEGMENT_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="text-xs font-extrabold text-gray-400 mb-2">学科氛围</div>
      <div className="flex flex-wrap gap-2">
        {SUBJECTS.map((s) => (
          <button
            key={s}
            onClick={() => setSubject(s)}
            className="px-3 py-1.5 rounded-full text-xs font-bold transition-transform active:scale-95"
            style={
              subject === s
                ? {
                    background: 'var(--color-secondary)',
                    color: '#fff',
                    boxShadow: '0 2px 0 var(--color-secondary-depth)',
                  }
                : { background: 'var(--color-gray-bg)', color: 'var(--color-text)' }
            }
          >
            {SUBJECT_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ThemeSwitcher({ variant = 'inline' }: { variant?: 'floating' | 'inline' }) {
  const [open, setOpen] = useState(false);

  if (variant === 'floating') {
    // 右下角悬浮按钮（备用）
    return (
      <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
        {open && <ThemePanel />}
        <button
          onClick={() => setOpen((o) => !o)}
          className="btn-3d w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-jelly-card"
          style={{ color: 'var(--color-primary)' }}
          aria-label="切换主题"
          title="切换主题 / 学科氛围"
        >
          <span style={{ fontSize: '20px' }}>🎨</span>
        </button>
      </div>
    );
  }

  // 头部内联按钮：放在「版本」徽章旁边
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="badge-jelly py-1.5 px-3 flex items-center gap-1.5 cursor-pointer transition-transform hover:scale-[1.03] active:scale-95"
        style={{
          background: 'var(--color-gray-bg)',
          color: 'var(--color-text)',
          borderColor: 'var(--color-gray-border)',
        }}
        aria-label="切换主题"
        title="切换主题 / 学科氛围"
      >
        <span style={{ fontSize: '15px' }}>🎨</span>
        <span className="text-xs font-extrabold">主题</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 z-[60]">
          <ThemePanel />
        </div>
      )}
    </div>
  );
}
