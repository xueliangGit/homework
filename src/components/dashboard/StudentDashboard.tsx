import React, { useState, useEffect } from 'react';
import { api } from '../../api';
import type { StudentExamItem } from '../../types';
import { listLocalDraftsByStudent } from '../../utils/localDraft';
import type { LocalDraft } from '../../utils/localDraft';
import { BookOpen, Clock, BookOpenCheck, Save } from 'lucide-react';

interface StudentDashboardProps {
  onStartExam: (examId: string, redo?: boolean) => void;
  onViewReport: (examId: string, studentId: string) => void;
  studentId: string;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  onStartExam,
  onViewReport,
  studentId,
}) => {
  const [exams, setExams] = useState<StudentExamItem[]>([]);
  const [activeTab, setActiveTab] = useState<'todo' | 'draft' | 'pending' | 'done'>('todo');
  const [loading, setLoading] = useState<boolean>(true);
  const [localDrafts, setLocalDrafts] = useState<LocalDraft[]>([]);

  const loadExams = async () => {
    try {
      setLoading(true);
      const data = await api.get<StudentExamItem[]>('/api/exams/student');
      setExams(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // 本地草稿（IndexedDB）按当前学生聚合，用于「草稿箱」展示进度
  const loadLocalDrafts = async () => {
    try {
      const data = await listLocalDraftsByStudent(studentId);
      setLocalDrafts(data);
    } catch {
      /* IndexedDB 不可用时忽略 */
    }
  };

  useEffect(() => {
    loadExams();
    loadLocalDrafts();
  }, []);

  // 切换到草稿箱时刷新本地草稿，确保刚保存的笔迹立即可见
  useEffect(() => {
    if (activeTab === 'draft') loadLocalDrafts();
  }, [activeTab, studentId]);

  const todoExams = exams.filter(e => e.status === 'unstarted');
  const pendingExams = exams.filter(e => e.status === 'submitted');
  const doneExams = exams.filter(e => e.status === 'graded');

  // 草稿箱 = 本地 IndexedDB 草稿 ∪ 服务器 drafting（跨设备已同步），本地优先
  const localMap = new Map(localDrafts.map((d) => [d.examId, d]));
  const draftItems = exams
    .filter((e) => e.status === 'drafting' || localMap.has(e.id))
    .map((e) => {
      const local = localMap.get(e.id);
      if (local) {
        return {
          exam: e,
          source: 'local' as const,
          draftPages: Object.keys(local.answers).length,
          savedAt: local.updatedAt,
          syncedAt: local.syncedAt,
        };
      }
      return {
        exam: e,
        source: 'cloud' as const,
        draftPages: e.draftPages,
        savedAt: e.lastSavedAt,
        syncedAt: e.lastSavedAt,
      };
    });
  const draftCount = draftItems.length;

  // —— 多班分组辅助：同一学生可属于多个班，作业按班级归组展示 ——
  const groupByClass = <T,>(list: T[], getClassName: (item: T) => string) => {
    const order: string[] = [];
    const map = new Map<string, T[]>();
    list.forEach((item) => {
      const key = getClassName(item) || '未知班级';
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key)!.push(item);
    });
    return order.map((k) => [k, map.get(k)!] as const);
  };

  const renderGrouped = <T,>(
    groups: readonly (readonly [string, T[]])[],
    renderCard: (item: T) => React.ReactNode
  ) => (
    <div className="flex flex-col gap-6 w-full">
      {groups.map(([className, items]) => (
        <div key={className}>
          <div className="flex items-center gap-2 mb-3 px-1">
            <span
              className="badge-jelly text-xs font-black py-1 px-3"
              style={{ backgroundColor: '#EEF2FF', color: '#4338CA', borderColor: '#C7D2FE' }}
            >
              🏫 {className}
            </span>
            <span className="text-xs text-gray-400 font-extrabold">{items.length} 份</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {items.map(renderCard)}
          </div>
        </div>
      ))}
    </div>
  );

  type DraftItem = { exam: StudentExamItem; source: 'local' | 'cloud'; draftPages?: number; savedAt?: number; syncedAt?: number };

  const renderTodoCard = (exam: StudentExamItem) => (
    <div key={exam.id} className="card-jelly card-jelly-hover flex flex-col gap-4 justify-between bg-white">
      <div>
        <span className="text-xs text-gray-400 font-extrabold">共 {exam.totalPages} 页试卷</span>
        <h3 className="text-lg font-black mt-1 text-gray-800">{exam.title}</h3>
        <div className="flex flex-wrap gap-2 mt-2">
          {exam.timePolicy?.deadline && (
            <span className="badge-jelly text-[10px] bg-amber-100 text-amber-700">⏰ 截止 {new Date(exam.timePolicy.deadline).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          )}
          {exam.timePolicy?.durationMin && (
            <span className="badge-jelly text-[10px] bg-sky-100 text-sky-700">⏱ 限时 {exam.timePolicy.durationMin} 分钟</span>
          )}
          {exam.timePolicy?.dailyWindow && (
            <span className="badge-jelly text-[10px] bg-violet-100 text-violet-700">🕐 每日 {exam.timePolicy.dailyWindow.start}-{exam.timePolicy.dailyWindow.end} 可作答</span>
          )}
          {!exam.timePolicy && !exam.closed && (
            <span className="badge-jelly text-[10px] bg-gray-100 text-gray-500">🕊 无时限</span>
          )}
          {exam.closed && (
            <span className="badge-jelly text-[10px] bg-gray-200 text-gray-500">🔒 已关闭</span>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-2 font-extrabold">发布时间: {new Date(exam.createdAt).toLocaleDateString()}</p>
      </div>
      <button onClick={() => onStartExam(exam.id)} className="btn-3d btn-3d-primary font-black py-2.5 w-full mt-3" style={{ boxShadow: '0 4px 0 var(--color-primary-depth)' }}>
        <span>开始答题 🖌️</span>
      </button>
    </div>
  );

  const renderDraftCard = (item: DraftItem) => (
    <div key={item.exam.id} className="card-jelly card-jelly-hover flex flex-col gap-4 justify-between bg-white">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400 font-extrabold">共 {item.exam.totalPages} 页试卷</span>
          <span className="badge-jelly text-[10px] bg-amber-100 text-amber-700">📝 未完成</span>
        </div>
        <h3 className="text-lg font-black mt-1 text-gray-800">{item.exam.title}</h3>
        <p className="text-xs text-gray-400 mt-2 font-extrabold">
          {item.draftPages ? `已写到第 ${item.draftPages} 页` : '已开始作答'} ·{' '}
          最近保存: {item.savedAt ? new Date(item.savedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '刚刚'}
        </p>
        {item.source === 'local' && !item.syncedAt && (
          <p className="text-[11px] font-extrabold text-amber-600 mt-1">⚠️ 进度仅存在本机，清理浏览器缓存会丢失</p>
        )}
        {item.syncedAt && (
          <p className="text-[11px] font-extrabold text-sky-600 mt-1">☁️ 已同步云端 {new Date(item.syncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</p>
        )}
      </div>
      <button onClick={() => onStartExam(item.exam.id)} className="btn-3d btn-3d-primary font-black py-2.5 w-full mt-3" style={{ boxShadow: '0 4px 0 var(--color-primary-depth)' }}>
        <span>继续答题 ✏️</span>
      </button>
    </div>
  );

  const renderPendingCard = (exam: StudentExamItem) => (
    <div key={exam.id} className="card-jelly flex flex-col gap-4 justify-between bg-white opacity-95">
      <div>
        <h3 className="text-lg font-black text-gray-800 mt-1">{exam.title}</h3>
        <p className="text-xs text-gray-400 mt-2 font-extrabold">提交时间: {new Date(exam.createdAt).toLocaleDateString()}</p>
      </div>
      <div className="p-4 rounded-2xl border text-center text-xs font-extrabold" style={{ backgroundColor: '#FFFDF0', borderColor: '#FDE047', color: '#854D0E' }}>
        🚀 已经成功投递！老师正在飞速批阅，耐心等一下下哦
      </div>
      <button onClick={() => onViewReport(exam.id, studentId)} className="btn-3d text-xs py-2.5 w-full mt-3 flex items-center justify-center gap-1.5 bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]">
        <span>查看我的作答 🔍</span>
      </button>
    </div>
  );

  const renderDoneCard = (exam: StudentExamItem) => (
    <div key={exam.id} className="card-jelly card-jelly-hover flex flex-col gap-4 justify-between bg-white">
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-gray-800 mt-1">{exam.title}</h3>
          <span className="text-xl font-black text-red-500 bg-white border-2 border-red-300 rounded-2xl px-3 py-1 rotate-[-5deg] shadow-[0_4px_0_#FF8A93]">💯 {exam.score}分</span>
        </div>
        {exam.isLate && (
          <span className="badge-jelly text-[10px] bg-orange-100 text-orange-600 mt-2">⏰ 迟交</span>
        )}
        {exam.comment && (
          <div className="mt-3 p-3 bg-yellow-50 border border-dashed border-yellow-300 rounded-xl text-xs font-extrabold text-gray-500">👩‍🏫 老师寄语: "{exam.comment}"</div>
        )}
      </div>
      <button onClick={() => onViewReport(exam.id, studentId)} className="btn-3d btn-3d-purple font-black py-2.5 w-full mt-3" style={{ boxShadow: '0 4px 0 var(--color-purple-depth)' }}>
        <span>错题回顾与大阅兵 📖</span>
      </button>
      {exam.canRedo && (
        <button onClick={() => onStartExam(exam.id, true)} className="btn-3d font-black py-2.5 w-full mt-2 flex items-center justify-center gap-1.5 bg-white text-rose-600 shadow-[0_3px_0_#F43F5E]" style={{ borderColor: '#F43F5E' }}>
          <span>🔄 订正错题</span>
        </button>
      )}
    </div>
  );

  const renderEmpty = (tab: 'todo' | 'draft' | 'pending' | 'done') => {
    if (tab === 'todo') return (<div className="col-span-2 text-center py-12 card-jelly bg-white"><span style={{ fontSize: '48px' }}>🎉</span><h4 className="font-black text-lg mt-2 text-gray-800">太厉害了！没有要写的作业啦！</h4><p className="text-sm text-gray-400 font-extrabold mt-1">快去户外奔跑一下，或者看看已通关的题目进行错题回顾吧！</p></div>);
    if (tab === 'draft') return (<div className="col-span-2 text-center py-12 card-jelly bg-white"><span style={{ fontSize: '48px' }}>📭</span><h4 className="font-black text-lg mt-2 text-gray-800">草稿箱空空如也</h4><p className="text-sm text-gray-400 font-extrabold mt-1">开始写一个新作业，写到一半也不怕丢啦！</p></div>);
    if (tab === 'pending') return (<div className="col-span-2 text-center py-12 card-jelly bg-white"><span style={{ fontSize: '40px' }}>💤</span><p className="font-extrabold text-sm text-gray-400 mt-2">目前没有正在排队等待批改的作业。</p></div>);
    return (<div className="col-span-2 text-center py-12 card-jelly bg-white"><span style={{ fontSize: '40px' }}>🏆</span><p className="font-extrabold text-sm text-gray-400 mt-2">还没有批改完成的试卷，加油通关吧！</p></div>);
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto p-4">
      {/* 欢迎彩虹顶饰 */}
      <div 
        className="card-jelly p-6 flex flex-col md:flex-row items-center gap-4 text-white"
        style={{
          background: 'linear-gradient(135deg, var(--color-primary) 0%, #4CD137 100%)',
          border: '2px solid var(--color-primary-depth)',
          boxShadow: '0 8px 0 var(--color-primary-depth)',
        }}
      >
        <div style={{ fontSize: '48px' }} className="jelly-jump">🎒</div>
        <div className="text-center md:text-left">
          <h2 className="text-xl font-black">哈罗！欢迎来到快乐作业岛 🏝️</h2>
          <p className="text-sm font-extrabold text-green-50 opacity-90 mt-1">这里有你所有的纸质作业图片，直接用手指或触控笔就可以在上面写字画圈答题哦！快去完成它们通关吧！</p>
        </div>
      </div>

      {/* 状态分类切换大标签 */}
      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={() => setActiveTab('todo')}
          className={`btn-3d text-xs py-2.5 px-4 flex items-center gap-2 ${
            activeTab === 'todo' ? 'btn-3d-yellow' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'
          }`}
          style={{
            boxShadow: activeTab === 'todo' ? undefined : '0 3px 0 #E5E5E5',
          }}
        >
          <BookOpen size={15} />
          <span>待写作业 ({todoExams.length}) ✏️</span>
        </button>

        <button
          onClick={() => setActiveTab('draft')}
          className={`btn-3d text-xs py-2.5 px-4 flex items-center gap-2 ${
            activeTab === 'draft' ? 'btn-3d-primary' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'
          }`}
          style={{
            boxShadow: activeTab === 'draft' ? undefined : '0 3px 0 #E5E5E5',
          }}
        >
          <Save size={15} />
          <span>草稿箱 ({draftCount}) 📝</span>
        </button>

        <button
          onClick={() => setActiveTab('pending')}
          className={`btn-3d text-xs py-2.5 px-4 flex items-center gap-2 ${
            activeTab === 'pending' ? 'btn-3d-blue' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'
          }`}
          style={{
            boxShadow: activeTab === 'pending' ? undefined : '0 3px 0 #E5E5E5',
          }}
        >
          <Clock size={15} />
          <span>等待批改 ({pendingExams.length}) 💤</span>
        </button>

        <button
          onClick={() => setActiveTab('done')}
          className={`btn-3d text-xs py-2.5 px-4 flex items-center gap-2 ${
            activeTab === 'done' ? 'btn-3d-purple' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'
          }`}
          style={{
            boxShadow: activeTab === 'done' ? undefined : '0 3px 0 #E5E5E5',
          }}
        >
          <BookOpenCheck size={15} />
          <span>已通关成就 ({doneExams.length}) 🏆</span>
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center p-12">
          <div style={{ fontSize: '40px' }} className="jelly-jump">🍎</div>
          <span className="font-extrabold text-sm text-gray-400 mt-2">试卷飞奔派发中，请稍后...</span>
        </div>
      ) : (
        <>
          {activeTab === 'todo' && (todoExams.length ? renderGrouped(groupByClass(todoExams, (e) => e.className), renderTodoCard) : renderEmpty('todo'))}
          {activeTab === 'draft' && (draftItems.length ? renderGrouped(groupByClass(draftItems, (d) => d.exam.className), renderDraftCard) : renderEmpty('draft'))}
          {activeTab === 'pending' && (pendingExams.length ? renderGrouped(groupByClass(pendingExams, (e) => e.className), renderPendingCard) : renderEmpty('pending'))}
          {activeTab === 'done' && (doneExams.length ? renderGrouped(groupByClass(doneExams, (e) => e.className), renderDoneCard) : renderEmpty('done'))}
        </>
      )}
    </div>
  );
};
