import React, { useEffect, useRef, useState } from 'react';
import { papersApi, assignmentsApi, classesApi } from '../../api';
import type { AssignmentItem, TimePolicy, SplitConfig } from '../../types';
import { SEGMENT_LABELS, SUBJECT_LABELS, type Segment, type Subject } from '../../theme/ThemeContext';
import { convertPdfToImages } from '../../utils/pdfParser';
import { showToast, confirmAsync } from '../../utils/toast';

const SEGMENTS: Segment[] = ['you', 'xiao', 'zhong'];
const SUBJECTS: Subject[] = ['general', 'chinese', 'math', 'english', 'science'];

// 计算分页分堆（与后端 buildPageGroups 对齐）：返回每堆 [start,end]（0-based 闭区间）
function previewGroups(
  total: number,
  split: { mode: 'uniform' | 'custom'; size: number; sizes: number[] }
): { start: number; end: number }[] {
  const groups: { start: number; end: number }[] = [];
  if (split.mode === 'custom' && split.sizes.length > 0) {
    let cursor = 0;
    for (const n of split.sizes) {
      if (cursor >= total) break;
      const take = Math.min(n, total - cursor);
      groups.push({ start: cursor, end: cursor + take - 1 });
      cursor += take;
    }
    if (cursor < total) groups.push({ start: cursor, end: total - 1 });
  } else {
    const size = Math.max(1, split.size || 1);
    for (let c = 0; c < total; c += size) groups.push({ start: c, end: Math.min(c + size - 1, total - 1) });
  }
  return groups;
}

// 默认起始日：明天 20:00（本地），返回 datetime-local 字符串
function defaultStartLocal(): string {
  const d = new Date(Date.now() + 86_400_000);
  d.setHours(20, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface PaperSummary {
  id: string;
  title: string;
  segment: Segment;
  subject: Subject;
  tags: string[];
  pageCount: number;
  updatedAt: number;
}

export const PaperLibrary: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [tab, setTab] = useState<'mine' | 'archived' | 'assignments'>('mine');
  const [list, setList] = useState<PaperSummary[]>([]);
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [publishPaperId, setPublishPaperId] = useState<string | null>(null);

  const loadPapers = async () => {
    setLoading(true);
    try {
      const res = tab === 'mine' ? await papersApi.list() : await papersApi.archived();
      setList(res.data || []);
    } catch (e: any) {
      showToast(e.message || '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadAssignments = async () => {
    setLoading(true);
    try {
      const res = await assignmentsApi.list();
      setAssignments(res.data || []);
    } catch (e: any) {
      showToast(e.message || '加载作业失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'assignments') loadAssignments();
    else loadPapers();
  }, [tab]);

  const handleDelete = async (id: string) => {
    const ok = await confirmAsync('确定把这份试卷移入回收站吗？', '移入回收站', '再想想');
    if (!ok) return;
    await papersApi.remove(id);
    loadPapers();
  };
  const handleRestore = async (id: string) => {
    await papersApi.restore(id);
    loadPapers();
  };

  const handleToggleAssignment = async (a: AssignmentItem) => {
    try {
      if (a.status === 'published') {
        const ok = await confirmAsync(`关闭「${a.title}」？学生将不能再作答。`, '关闭作业', '再想想');
        if (!ok) return;
        await assignmentsApi.close(a.id);
      } else {
        await assignmentsApi.reopen(a.id);
      }
      loadAssignments();
    } catch (e: any) {
      showToast(e.message || '操作失败', 'error');
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1200px] mx-auto p-6 md:p-8">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="btn-3d text-sm py-2 px-4 bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]">
          ← 返回控制台
        </button>
        <h1 className="text-2xl font-black flex items-center gap-2 text-gray-800">
          📚 试卷库（预存试卷）
        </h1>
        {tab !== 'assignments' && (
          <button
            onClick={() => {
              setEditingId(null);
              setEditorOpen(true);
            }}
            className="btn-3d btn-3d-primary text-sm py-2.5 px-5"
          >
            ＋ 新建试卷
          </button>
        )}
        {tab === 'assignments' && <div style={{ width: 96 }} />}
      </div>

      <div className="flex gap-3 flex-wrap">
        {([
          ['mine', '我的试卷'],
          ['assignments', '已发布作业'],
          ['archived', '回收站'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`btn-3d text-xs py-2 px-4 ${
              tab === k ? 'btn-3d-primary' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'
            }`}
          >
            {label}
            {k === 'assignments' && assignments.length > 0 && ` (${assignments.length})`}
          </button>
        ))}
      </div>

      {loading && <div className="text-center text-gray-400 font-bold py-10">加载中…</div>}

      {!loading && tab === 'assignments' && (
        <AssignmentList items={assignments} onToggle={handleToggleAssignment} />
      )}

      {!loading && tab !== 'assignments' && list.length === 0 && (
        <div className="text-center text-gray-400 font-extrabold py-16">
          {tab === 'mine' ? '还没有预存试卷，点右上角「新建试卷」开始吧 📝' : '回收站是空的'}
        </div>
      )}

      {!loading && tab !== 'assignments' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((p) => (
            <div key={p.id} className="card-jelly flex flex-col gap-3" style={{ padding: 20 }}>
              <div className="text-lg font-black text-gray-800 line-clamp-2">{p.title}</div>
              <div className="flex flex-wrap gap-2">
                <span className="badge-jelly text-[10px] bg-green-100 text-green-700">{SEGMENT_LABELS[p.segment]}</span>
                <span className="badge-jelly text-[10px] bg-blue-100 text-blue-700">{SUBJECT_LABELS[p.subject]}</span>
                <span className="badge-jelly text-[10px] bg-gray-100 text-gray-500">{p.pageCount} 页</span>
              </div>
              <div className="text-xs text-gray-400 font-bold">
                {new Date(p.updatedAt).toLocaleString('zh-CN')}
              </div>
              <div className="flex flex-wrap gap-2 mt-auto">
                {tab === 'mine' ? (
                  <>
                    <button
                      onClick={() => setPublishPaperId(p.id)}
                      className="btn-3d btn-3d-primary text-xs py-1.5 px-3"
                    >
                      发布作业
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(p.id);
                        setEditorOpen(true);
                      }}
                      className="btn-3d text-xs py-1.5 px-3 bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="btn-3d text-xs py-1.5 px-3 bg-red-50 text-red-600 border-red-300"
                      style={{ boxShadow: '0 3px 0 #E06C75' }}
                    >
                      删除
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleRestore(p.id)}
                    className="btn-3d btn-3d-primary text-xs py-1.5 px-3"
                  >
                    恢复
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editorOpen && (
        <PaperEditor
          paperId={editingId}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            loadPapers();
          }}
        />
      )}

      {publishPaperId && (
        <PublishModal paperId={publishPaperId} onClose={() => setPublishPaperId(null)} onPublished={() => {
          setPublishPaperId(null);
          setTab('assignments');
        }} />
      )}
    </div>
  );
};

// ============ 已发布作业管理 ============
const AssignmentList: React.FC<{
  items: AssignmentItem[];
  onToggle: (a: AssignmentItem) => void;
}> = ({ items, onToggle }) => {
  if (items.length === 0) {
    return (
      <div className="text-center text-gray-400 font-extrabold py-16">
        还没有发布过作业，去「我的试卷」点「发布作业」试试 🚀
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {items.map((a) => (
        <div key={a.id} className="card-jelly bg-white" style={{ padding: 18 }}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-black text-gray-800">{a.title}</span>
                <span className={`badge-jelly text-[10px] ${a.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                  {a.status === 'published' ? '进行中' : '已关闭'}
                </span>
                <span className={`badge-jelly text-[10px] ${a.timePolicy.mode === 'strict' ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}>
                  {a.timePolicy.mode === 'strict' ? '严格限时' : '宽松迟交'}
                </span>
              </div>
              <div className="text-xs text-gray-400 font-bold mt-1">
                发布于 {new Date(a.createdAt).toLocaleString('zh-CN')}
              </div>
            </div>
            <button
              onClick={() => onToggle(a)}
              className={`btn-3d text-xs py-1.5 px-3 ${a.status === 'published' ? 'bg-red-50 text-red-600 border-red-300' : 'btn-3d-primary'}`}
              style={a.status === 'published' ? { boxShadow: '0 3px 0 #E06C75' } : undefined}
            >
              {a.status === 'published' ? '关闭作业' : '重新开放'}
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mt-2">
            {a.classNames.map((cn, i) => (
              <span key={i} className="badge-jelly text-[10px] bg-blue-50 text-blue-600">{cn}</span>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 mt-2 text-xs font-extrabold text-gray-500">
            {a.timePolicy.deadline && (
              <span>⏰ 截止：{new Date(a.timePolicy.deadline).toLocaleString('zh-CN')}</span>
            )}
            {a.timePolicy.durationMin && <span>⏱ 限时：{a.timePolicy.durationMin} 分钟</span>}
            {!a.timePolicy.deadline && !a.timePolicy.durationMin && <span>🕊 无时限</span>}
            <span>📊 已交：{a.submittedCount} 份</span>
          </div>
        </div>
      ))}
    </div>
  );
};

// ============ 发布作业弹窗 ============
const PublishModal: React.FC<{ paperId: string; onClose: () => void; onPublished: () => void }> = ({
  paperId,
  onClose,
  onPublished,
}) => {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<'strict' | 'grace'>('grace');
  const [deadline, setDeadline] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [latePenalty, setLatePenalty] = useState('');
  const [allowRedo, setAllowRedo] = useState(true);
  const [saving, setSaving] = useState(false);

  // 每日可作答时段（不勾则当天随时可做）
  const [useWindow, setUseWindow] = useState(false);
  const [winStart, setWinStart] = useState('19:00');
  const [winEnd, setWinEnd] = useState('20:00');

  // 分页批量发布相关状态
  const [splitMode, setSplitMode] = useState<'single' | 'paged'>('single');
  const [pagingType, setPagingType] = useState<'uniform' | 'custom'>('uniform');
  const [uniformSize, setUniformSize] = useState('3');
  const [customSizes, setCustomSizes] = useState('');
  const [startDate, setStartDate] = useState(defaultStartLocal());
  const [intervalDays, setIntervalDays] = useState('1');
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const list = await classesApi.list();
        setClasses(list.map((c: any) => ({ id: c.id, name: c.name })));
        const paper = await papersApi.get(paperId);
        setTitle(paper.data.title);
        setPageCount(paper.data.pages?.length || 0);
      } catch (e: any) {
        showToast(e.message || '加载试卷失败', 'error');
      }
    })();
  }, [paperId]);

  const toggleClass = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const handlePublish = async () => {
    if (selected.length === 0) { showToast('请至少选择一个发布班级', 'warn'); return; }
    const tp: TimePolicy = { mode };
    if (deadline) {
      const ms = new Date(deadline).getTime();
      if (!isNaN(ms)) tp.deadline = ms;
    }
    if (durationMin && Number(durationMin) > 0) tp.durationMin = Number(durationMin);
    if (latePenalty && Number(latePenalty) >= 0) tp.latePenalty = Number(latePenalty);
    if (useWindow) tp.dailyWindow = { start: winStart, end: winEnd };

    const body: any = { paperId, classIds: selected, title, timePolicy: tp, allowRedo };
    if (splitMode === 'paged') {
      const sizes = customSizes
        .split(/[,\s]+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => n > 0);
      const split: SplitConfig = {
        mode: pagingType,
        size: Math.max(1, parseInt(uniformSize, 10) || 1),
        sizes,
        intervalDays: Math.max(0, parseInt(intervalDays, 10) || 1),
      };
      if (startDate) {
        const ms = new Date(startDate).getTime();
        if (!isNaN(ms)) split.startDate = ms;
      }
      body.split = split;
    }

    setSaving(true);
    try {
      const res = await assignmentsApi.publish(body);
      showToast(res.message || '已发布', 'success');
      onPublished();
    } catch (e: any) {
      showToast(e.message || '发布失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="card-jelly bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto"
        style={{ padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black text-gray-800">🚀 发布作业</h2>
          <button onClick={onClose} className="text-gray-400 font-bold text-sm">✕ 关闭</button>
        </div>

        <div className="flex flex-col gap-3">
          <input className="input-jelly" placeholder="作业标题" value={title} onChange={(e) => setTitle(e.target.value)} />

          <div>
            <div className="text-xs font-extrabold text-gray-500 mb-1">选择发布班级</div>
            {classes.length === 0 ? (
              <div className="text-xs text-gray-400 font-bold">尚未创建班级，请先去控制台创建班级</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {classes.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => toggleClass(c.id)}
                    className={`btn-3d text-xs py-1.5 px-3 ${selected.includes(c.id) ? 'btn-3d-primary' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 发布方式切换 */}
          <div>
            <div className="text-xs font-extrabold text-gray-500 mb-1">发布方式</div>
            <div className="flex gap-2">
              <button
                onClick={() => setSplitMode('single')}
                className={`btn-3d text-xs py-1.5 px-3 flex-1 ${splitMode === 'single' ? 'btn-3d-primary' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'}`}
              >
                整卷一份
              </button>
              <button
                onClick={() => setSplitMode('paged')}
                className={`btn-3d text-xs py-1.5 px-3 flex-1 ${splitMode === 'paged' ? 'btn-3d-primary' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'}`}
              >
                分页批量（按页分堆·自动排期）
              </button>
            </div>
          </div>

          {/* 作答时限策略（两种发布方式通用） */}
          <div>
            <div className="text-xs font-extrabold text-gray-500 mb-1">作答时限策略</div>
            <div className="flex gap-2">
              <button
                onClick={() => setMode('strict')}
                className={`btn-3d text-xs py-1.5 px-3 flex-1 ${mode === 'strict' ? 'btn-3d-primary' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'}`}
              >
                严格限时（到点锁死）
              </button>
              <button
                onClick={() => setMode('grace')}
                className={`btn-3d text-xs py-1.5 px-3 flex-1 ${mode === 'grace' ? 'btn-3d-primary' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'}`}
              >
                宽松迟交（可迟交并标记）
              </button>
            </div>
          </div>

          {/* 每日可作答时段 */}
          <div>
            <label className="flex items-center gap-2 text-sm font-bold text-gray-600 mb-1">
              <input type="checkbox" checked={useWindow} onChange={(e) => setUseWindow(e.target.checked)} />
              限定每日可作答时段（不勾则当天随时可做）
            </label>
            {useWindow && (
              <div className="flex gap-3 mt-1">
                <label className="flex-1 text-xs font-extrabold text-gray-500 flex flex-col gap-1">
                  每日开始时间
                  <input type="time" className="input-jelly" value={winStart} onChange={(e) => setWinStart(e.target.value)} />
                </label>
                <label className="flex-1 text-xs font-extrabold text-gray-500 flex flex-col gap-1">
                  每日结束时间
                  <input type="time" className="input-jelly" value={winEnd} onChange={(e) => setWinEnd(e.target.value)} />
                </label>
              </div>
            )}
          </div>

          {splitMode === 'single' ? (
            <div className="flex gap-3">
              <label className="flex-1 text-xs font-extrabold text-gray-500 flex flex-col gap-1">
                截止时间（可选）
                <input type="datetime-local" className="input-jelly" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </label>
              <label className="flex-1 text-xs font-extrabold text-gray-500 flex flex-col gap-1">
                倒计时时长（分钟，可选）
                <input type="number" min={1} className="input-jelly" placeholder="如 30" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
              </label>
            </div>
          ) : (
            <PagedPublishControls
              pageCount={pageCount}
              pagingType={pagingType}
              setPagingType={setPagingType}
              uniformSize={uniformSize}
              setUniformSize={setUniformSize}
              customSizes={customSizes}
              setCustomSizes={setCustomSizes}
              startDate={startDate}
              setStartDate={setStartDate}
              intervalDays={intervalDays}
              setIntervalDays={setIntervalDays}
            />
          )}

          {splitMode === 'paged' && (
            <PagedPublishPreview
              pageCount={pageCount}
              pagingType={pagingType}
              uniformSize={uniformSize}
              customSizes={customSizes}
              startDate={startDate}
              intervalDays={intervalDays}
            />
          )}

          <label className="text-xs font-extrabold text-gray-500 flex flex-col gap-1">
            迟交扣分（0=仅标记不扣分）
            <input type="number" min={0} className="input-jelly" placeholder="0" value={latePenalty} onChange={(e) => setLatePenalty(e.target.value)} />
          </label>

          <label className="flex items-center gap-2 text-sm font-bold text-gray-600">
            <input type="checkbox" checked={allowRedo} onChange={(e) => setAllowRedo(e.target.checked)} />
            允许学生在批改前重做
          </label>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={handlePublish} disabled={saving} className="btn-3d btn-3d-primary flex-1 py-3">
            {saving ? '发布中…' : '确认发布'}
          </button>
          <button onClick={onClose} className="btn-3d text-sm py-3 px-5 bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]">
            取消
          </button>
        </div>
      </div>
    </div>
  );
};

// ============ 分页批量发布：控件 ============
const PagedPublishControls: React.FC<{
  pageCount: number;
  pagingType: 'uniform' | 'custom';
  setPagingType: (v: 'uniform' | 'custom') => void;
  uniformSize: string;
  setUniformSize: (v: string) => void;
  customSizes: string;
  setCustomSizes: (v: string) => void;
  startDate: string;
  setStartDate: (v: string) => void;
  intervalDays: string;
  setIntervalDays: (v: string) => void;
}> = (p) => (
  <div className="flex flex-col gap-3">
    <div>
      <div className="text-xs font-extrabold text-gray-500 mb-1">分页方式</div>
      <div className="flex gap-2">
        <button
          onClick={() => p.setPagingType('uniform')}
          className={`btn-3d text-xs py-1.5 px-3 flex-1 ${p.pagingType === 'uniform' ? 'btn-3d-primary' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'}`}
        >
          均等分页（每 N 页一份）
        </button>
        <button
          onClick={() => p.setPagingType('custom')}
          className={`btn-3d text-xs py-1.5 px-3 flex-1 ${p.pagingType === 'custom' ? 'btn-3d-primary' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'}`}
        >
          自定义序列（如 3,5）
        </button>
      </div>
    </div>

    {p.pagingType === 'uniform' ? (
      <label className="text-xs font-extrabold text-gray-500 flex flex-col gap-1">
        每几页一份
        <input type="number" min={1} className="input-jelly" value={p.uniformSize} onChange={(e) => p.setUniformSize(e.target.value)} />
      </label>
    ) : (
      <label className="text-xs font-extrabold text-gray-500 flex flex-col gap-1">
        每堆页数序列（逗号分隔，如 3,5,3）
        <input className="input-jelly" placeholder="3,5,3" value={p.customSizes} onChange={(e) => p.setCustomSizes(e.target.value)} />
      </label>
    )}

    <div className="flex gap-3">
      <label className="flex-1 text-xs font-extrabold text-gray-500 flex flex-col gap-1">
        第一份截止日
        <input type="datetime-local" className="input-jelly" value={p.startDate} onChange={(e) => p.setStartDate(e.target.value)} />
      </label>
      <label className="flex-1 text-xs font-extrabold text-gray-500 flex flex-col gap-1">
        间隔天数（每日一份填 1）
        <input type="number" min={0} className="input-jelly" value={p.intervalDays} onChange={(e) => p.setIntervalDays(e.target.value)} />
      </label>
    </div>
  </div>
);

// ============ 分页批量发布：实时预览 ============
const PagedPublishPreview: React.FC<{
  pageCount: number;
  pagingType: 'uniform' | 'custom';
  uniformSize: string;
  customSizes: string;
  startDate: string;
  intervalDays: string;
}> = (p) => {
  const sizes = p.customSizes
    .split(/[,\s]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => n > 0);
  const groups = previewGroups(p.pageCount, {
    mode: p.pagingType,
    size: Math.max(1, parseInt(p.uniformSize, 10) || 1),
    sizes,
  });
  if (p.pageCount === 0) {
    return <div className="text-xs text-gray-400 font-bold">该试卷暂无页面，无法分页。</div>;
  }
  const startMs = p.startDate ? new Date(p.startDate).getTime() : NaN;
  const intervalMs = Math.max(0, parseInt(p.intervalDays, 10) || 1) * 86_400_000;
  return (
    <div className="card-jelly bg-gray-50" style={{ padding: 12 }}>
      <div className="text-xs font-extrabold text-gray-500 mb-1">
        将自动拆分为 {groups.length} 份作业（每份独立，可分别关闭 / 导出）
      </div>
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {groups.map((g, i) => {
          const dl = isNaN(startMs)
            ? '（未设起始日 → 默认明天起）'
            : new Date(startMs + i * intervalMs).toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });
          return (
            <div key={i} className="text-xs font-bold text-gray-600 flex justify-between gap-2">
              <span>
                第{i + 1}份：第{g.start + 1}-{g.end + 1}页
              </span>
              <span className="text-orange-600 whitespace-nowrap">截止 {dl}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============ 试卷编辑器（手绘 / 上传 / PDF 导入）============
const PaperEditor: React.FC<{ paperId: string | null; onClose: () => void; onSaved: () => void }> = ({
  paperId,
  onClose,
  onSaved,
}) => {
  const [title, setTitle] = useState('');
  const [segment, setSegment] = useState<Segment>('xiao');
  const [subject, setSubject] = useState<Subject>('general');
  const [pages, setPages] = useState<string[]>([]);
  const [source, setSource] = useState<'draw' | 'upload' | 'pdf'>('draw');
  const [saving, setSaving] = useState(false);
  const [pdfProgress, setPdfProgress] = useState('');

  // 载入已有试卷
  useEffect(() => {
    if (!paperId) return;
    (async () => {
      try {
        const res = await papersApi.get(paperId);
        const p = res.data;
        setTitle(p.title);
        setSegment(p.segment);
        setSubject(p.subject);
        setPages(p.pages || []);
      } catch (e: any) {
        showToast(e.message || '加载失败', 'error');
      }
    })();
  }, [paperId]);

  const handleSave = async () => {
    if (!title.trim()) { showToast('请填写试卷标题', 'warn'); return; }
    if (pages.length === 0) { showToast('请至少添加一页内容', 'warn'); return; }
    setSaving(true);
    try {
      if (paperId) {
        await papersApi.update(paperId, { title, segment, subject, pages });
      } else {
        await papersApi.create({ title, segment, subject, pages, status: 'draft' });
      }
      onSaved();
    } catch (e: any) {
      showToast(e.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="card-jelly bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        style={{ padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black text-gray-800">{paperId ? '编辑试卷' : '新建试卷'}</h2>
          <button onClick={onClose} className="text-gray-400 font-bold text-sm">✕ 关闭</button>
        </div>

        <div className="flex flex-col gap-3 mb-4">
          <input className="input-jelly" placeholder="试卷标题" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="flex gap-3">
            <select className="input-jelly flex-1" value={segment} onChange={(e) => setSegment(e.target.value as Segment)}>
              {SEGMENTS.map((s) => (
                <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>
              ))}
            </select>
            <select className="input-jelly flex-1" value={subject} onChange={(e) => setSubject(e.target.value as Subject)}>
              {SUBJECTS.map((s) => (
                <option key={s} value={s}>{SUBJECT_LABELS[s]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 来源切换 */}
        <div className="flex gap-2 mb-3">
          {([
            ['draw', '✏️ 手绘'],
            ['upload', '🖼️ 上传图片'],
            ['pdf', '📄 PDF 导入'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSource(k)}
              className={`btn-3d text-xs py-2 px-3 ${source === k ? 'btn-3d-primary' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {source === 'draw' && <DrawSource onAddPage={(dataUrl) => setPages((p) => [...p, dataUrl])} />}
        {source === 'upload' && <UploadSource onAddPages={(urls) => setPages((p) => [...p, ...urls])} />}
        {source === 'pdf' && (
          <PdfSource
            onAddPages={(urls) => setPages((p) => [...p, ...urls])}
            onProgress={setPdfProgress}
          />
        )}

        {/* 已添加页预览 */}
        <div className="mt-4">
          <div className="text-xs font-extrabold text-gray-400 mb-2">已添加 {pages.length} 页</div>
          <div className="flex flex-wrap gap-2">
            {pages.map((pg, i) => (
              <div key={i} className="relative" style={{ width: 90 }}>
                <img src={pg} alt={`page ${i + 1}`} className="w-full rounded-lg border border-gray-200" />
                <button
                  onClick={() => setPages((p) => p.filter((_, idx) => idx !== i))}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs"
                >
                  ✕
                </button>
                <span className="absolute bottom-1 left-1 bg-black/50 text-white text-[10px] px-1 rounded">{i + 1}</span>
              </div>
            ))}
          </div>
        </div>

        {pdfProgress && <div className="text-xs text-blue-500 font-bold mt-2">{pdfProgress}</div>}

        <div className="flex gap-3 mt-6">
          <button onClick={handleSave} disabled={saving} className="btn-3d btn-3d-primary flex-1 py-3">
            {saving ? '保存中…' : '保存到试卷库'}
          </button>
          <button onClick={onClose} className="btn-3d text-sm py-3 px-5 bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]">
            取消
          </button>
        </div>
      </div>
    </div>
  );
};

// 手绘来源
const DrawSource: React.FC<{ onAddPage: (dataUrl: string) => void }> = ({ onAddPage }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const history = useRef<string[]>([]);
  const [color, setColor] = useState('#222222');

  const pos = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
    };
  };

  const start = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const ctx = c.getContext('2d')!;
    history.current.push(c.toDataURL());
    drawing.current = true;
    last.current = pos(e);
    ctx.beginPath();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const c = canvasRef.current!;
    const ctx = c.getContext('2d')!;
    const p = pos(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const end = () => {
    drawing.current = false;
    last.current = null;
  };
  const clear = () => {
    const c = canvasRef.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    history.current = [];
  };
  const undo = () => {
    const c = canvasRef.current!;
    const ctx = c.getContext('2d')!;
    history.current.pop();
    const prev = history.current[history.current.length - 1];
    if (prev) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = prev;
    } else {
      ctx.clearRect(0, 0, c.width, c.height);
    }
  };
  const savePage = () => {
    const c = canvasRef.current!;
    if (c.toDataURL().length < 5000) { showToast('请先画点内容', 'warn'); return; }
    onAddPage(c.toDataURL('image/png'));
    clear();
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={800}
        height={1000}
        className="w-full bg-white rounded-xl border-2 border-gray-200 touch-none"
        style={{ aspectRatio: '4 / 5', touchAction: 'none' }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="flex items-center gap-2 flex-wrap">
        {['#222222', '#EA2B2B', '#1899D6', '#16B364', '#FF9600'].map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className="w-7 h-7 rounded-full border-2"
            style={{ background: c, borderColor: color === c ? '#000' : '#ccc' }}
          />
        ))}
        <button onClick={undo} className="btn-3d text-xs py-1.5 px-3 bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]">↩ 撤销</button>
        <button onClick={clear} className="btn-3d text-xs py-1.5 px-3 bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]">🧹 清空</button>
        <button onClick={savePage} className="btn-3d btn-3d-primary text-xs py-1.5 px-3 ml-auto">＋ 保存本页</button>
      </div>
      <div className="text-xs text-gray-400 font-bold">在画板上手绘，点「保存本页」加入试卷，可多次添加多页。</div>
    </div>
  );
};

// 上传图片来源
const UploadSource: React.FC<{ onAddPages: (urls: string[]) => void }> = ({ onAddPages }) => {
  const readFiles = (files: FileList) => {
    const urls: string[] = [];
    Array.from(files).forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => urls.push(reader.result as string);
      reader.readAsDataURL(f);
    });
    // 简单等待（小图足够）
    setTimeout(() => onAddPages(urls), 300 * files.length);
  };
  return (
    <div className="flex flex-col gap-2">
      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => e.target.files && readFiles(e.target.files)}
        className="input-jelly"
      />
      <div className="text-xs text-gray-400 font-bold">选择一张或多张试卷图片，自动按页加入。</div>
    </div>
  );
};

// PDF 导入来源
const PdfSource: React.FC<{ onAddPages: (urls: string[]) => void; onProgress: (s: string) => void }> = ({
  onAddPages,
  onProgress,
}) => {
  const [busy, setBusy] = useState(false);
  const handle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    onProgress('PDF 解析中…');
    try {
      const imgs = await convertPdfToImages(file, (cur, total) => onProgress(`已解析 ${cur}/${total} 页`));
      onAddPages(imgs);
      onProgress(`导入完成，共 ${imgs.length} 页`);
    } catch (err: any) {
      onProgress('导入失败：' + (err.message || ''));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <input type="file" accept="application/pdf" onChange={handle} className="input-jelly" disabled={busy} />
      <div className="text-xs text-gray-400 font-bold">选择 PDF 试卷，按页自动拆成图片加入（需联网加载 PDF.js）。</div>
    </div>
  );
};
