import React, { useEffect, useState } from 'react';
import { logsApi } from '../../api';
import type { LogItem } from '../../types';
import { showToast } from '../../utils/toast';

const ACTION_LABELS: Record<string, { text: string; color: string }> = {
  create_paper: { text: '新建试卷', color: '#16A34A' },
  update_paper: { text: '编辑试卷', color: '#0891B2' },
  delete_paper: { text: '移入回收站', color: '#DC2626' },
  publish_assignment: { text: '发布作业', color: '#7C3AED' },
  close_assignment: { text: '关闭作业', color: '#6B7280' },
  reopen_assignment: { text: '重开作业', color: '#DB2777' },
  submit: { text: '学生提交', color: '#2563EB' },
  grade: { text: '老师批改', color: '#EA580C' },
  revise_grade: { text: '修正成绩', color: '#D97706' },
};

const ROLE_LABELS: Record<string, string> = {
  teacher: '教师',
  student: '学生',
  parent: '家长',
};

export const RecordCenter: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await logsApi.list();
      setLogs(res.data || []);
    } catch (e: any) {
      showToast(e.message || '加载记录失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const detailText = (l: LogItem): string => {
    if (!l.detail) return '';
    if (typeof l.detail === 'string') return l.detail;
    if (l.detail.examTitle) return l.detail.examTitle;
    if (l.detail.title) return l.detail.title;
    if (l.detail.score !== undefined) return `得分 ${l.detail.score} · ${l.detail.examTitle || ''}`;
    return '';
  };

  return (
    <div className="flex flex-col gap-5 w-full max-w-4xl mx-auto p-6 md:p-8">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="btn-3d text-sm py-2 px-4 bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]">
          ← 返回控制台
        </button>
        <h1 className="text-2xl font-black flex items-center gap-2 text-gray-800">
          🧾 全链路记录中心
        </h1>
        <button onClick={load} className="btn-3d text-sm py-2 px-4 bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]">
          🔄 刷新
        </button>
      </div>

      <div className="text-xs text-gray-400 font-extrabold">
        这里记录着试卷、作业、提交与批改的每一次关键操作，方便追溯与核对 ✅
      </div>

      {loading && <div className="text-center text-gray-400 font-bold py-10">加载中…</div>}

      {!loading && logs.length === 0 && (
        <div className="text-center text-gray-400 font-extrabold py-16">
          还没有任何操作记录，去发一份作业试试吧 🚀
        </div>
      )}

      <div className="flex flex-col gap-2">
        {logs.map((l) => {
          const meta = ACTION_LABELS[l.action] || { text: l.action, color: '#64748B' };
          return (
            <div
              key={l.id}
              className="card-jelly bg-white flex items-center gap-3"
              style={{ padding: '12px 16px' }}
            >
              <span
                className="badge-jelly text-[10px] font-black whitespace-nowrap"
                style={{ backgroundColor: meta.color + '1A', color: meta.color }}
              >
                {meta.text}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-700 truncate">
                  {detailText(l) || '—'}
                </div>
                <div className="text-[10px] text-gray-400 font-bold mt-0.5">
                  {ROLE_LABELS[l.role || ''] || l.role || ''} ·{' '}
                  {new Date(l.at).toLocaleString('zh-CN')}
                  {l.ip ? ` · IP ${l.ip}` : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
