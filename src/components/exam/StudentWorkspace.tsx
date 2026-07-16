import React, { useState, useEffect, useRef } from 'react';
import { api, examsApi } from '../../api';
import { CanvasDraw } from '../shared/CanvasDraw';
import { ArrowLeft, ChevronLeft, ChevronRight, Check, Timer, Cloud } from 'lucide-react';
import confetti from 'canvas-confetti';
import {
  getLocalDraft,
  saveLocalDraft,
  removeLocalDraft,
} from '../../utils/localDraft';
import type { LocalDraft } from '../../utils/localDraft';
import { showToast, confirmAsync } from '../../utils/toast';

interface StudentWorkspaceProps {
  examId: string;
  isRedo?: boolean;
  onBack: () => void;
}

function fmtRemaining(ms: number): string {
  if (ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function currentStudentId(): string {
  try {
    const userStr = localStorage.getItem('kaoshi_user');
    return userStr ? JSON.parse(userStr).id : '';
  } catch {
    return '';
  }
}

export const StudentWorkspace: React.FC<StudentWorkspaceProps> = ({
  examId,
  isRedo = false,
  onBack,
}) => {
  const [examTitle, setExamTitle] = useState<string>('');
  const [pages, setPages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [answersMap, setAnswersMap] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // 云端同步状态：syncedAt=最近一次同步时间；dirty=本地有未同步改动
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState<boolean>(false);
  const syncedAtRef = useRef<number | null>(null);

  const [timePolicy, setTimePolicy] = useState<any>(null);
  const [closed, setClosed] = useState<boolean>(false);
  const [now, setNow] = useState<number>(Date.now());
  const startedAtRef = useRef<number>(Date.now());
  const autoSubmittedRef = useRef<boolean>(false);

  // 标记是否已经提示过恢复草稿，防止因 answersMap 变更导致重复弹窗
  const draftPromptedRef = useRef<boolean>(false);

  // 并发锁：记录本地已知的服务端草稿/答卷版本，提交与同步时带回以检测多设备冲突
  const clientVersionRef = useRef<number>(0);

  const loadExamDetail = async () => {
    try {
      setLoading(true);
      const studentId = currentStudentId();
      const localKey = `${studentId}::${examId}`;

      const detailUrl = isRedo
        ? `/api/exams/${examId}/submission/${studentId}?redo=1`
        : `/api/exams/${examId}/submission/${studentId}`;
      const data = await api.get<any>(detailUrl);

      setExamTitle(data.exam.title);
      setPages(data.exam.pages);
      setTimePolicy(data.exam.timePolicy || null);
      setClosed(!!data.exam.closed);
      clientVersionRef.current = data.submission?.version ?? 0;

      // 订正模式：以空白作答区开始，不直接复用原卷笔迹
      if (isRedo) {
        setAnswersMap({});
        return;
      }

      // 1. 优先从本地 IndexedDB 恢复（本地为权威，同设备续写）
      let initialAnswers: Record<number, string> = {};
      let localRestored = false;
      try {
        const local = await getLocalDraft(localKey);
        if (local && local.answers && Object.keys(local.answers).length > 0) {
          initialAnswers = local.answers;
          localRestored = true;
          if (local.syncedAt) {
            syncedAtRef.current = local.syncedAt;
            setSyncedAt(local.syncedAt);
          }
        }
      } catch {
        /* IndexedDB 不可用则退化为云端恢复 */
      }

      // 2. 本地无草稿，但云端有已同步草稿（换设备续写）→ 提示从云端恢复
      const cloudAnswers: Record<number, string> = {};
      if (!localRestored && data.submission && Array.isArray(data.submission.answers)) {
        data.submission.answers.forEach((ans: any) => {
          if (ans && typeof ans.canvasData === 'string' && ans.canvasData !== '') {
            cloudAnswers[ans.pageIndex] = ans.canvasData;
          }
        });
      }
      const hasCloud = Object.keys(cloudAnswers).length > 0;
      if (!localRestored && hasCloud && !draftPromptedRef.current) {
        draftPromptedRef.current = true;
        const ts = data.submission?.lastSavedAt;
        if (ts) {
          syncedAtRef.current = ts;
          setSyncedAt(ts);
        }
        const ok = await confirmAsync('☁️ 检测到云端有你之前同步的草稿，要从云端恢复继续写吗？');
        setAnswersMap(ok ? cloudAnswers : {});
        return; // 已决定初始笔迹，结束加载
      }

      setAnswersMap(initialAnswers);
    } catch (err: any) {
      setErrorMsg(err.message || '获取作业详情失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExamDetail();
  }, [examId]);

  // 3. 本地自动存盘（IndexedDB，按 studentId+examId 隔离）。永不自动上云。
  const saveLocal = async (answers: Record<number, string>, page: number) => {
    const studentId = currentStudentId();
    if (!studentId) return;
    try {
      const draft: LocalDraft = {
        key: `${studentId}::${examId}`,
        studentId,
        examId,
        answers,
        currentPage: page,
        updatedAt: Date.now(),
        syncedAt: syncedAtRef.current ?? undefined,
      };
      await saveLocalDraft(draft);
    } catch {
      /* IndexedDB 不可用则忽略，下次重试 */
    }
  };

  // 4. 手动「同步到云端」：把本地草稿上传（仅此一处写云端草稿）
  const syncToCloud = async () => {
    const answers = Object.keys(answersMap)
      .map((k) => ({ pageIndex: Number(k), canvasData: answersMap[Number(k)] }))
      .filter((a) => a.canvasData !== '');
    if (answers.length === 0) return;

    setSyncing(true);
    try {
      const res = await examsApi.saveDraft(examId, { answers, currentPage, clientVersion: clientVersionRef.current, redo: isRedo });
      const ts = res?.data?.lastSavedAt || Date.now();
      if (typeof res?.data?.version === 'number') clientVersionRef.current = res.data.version;
      syncedAtRef.current = ts;
      setSyncedAt(ts);
      setDirty(false);
      // 把同步时间写回本地草稿，避免提示重复
      await saveLocal(answersMap, currentPage);
    } catch (err: any) {
      if (err?.status === 409 && err?.data?.conflict) {
        const ok = await confirmAsync(err.message || '云端已有更新的保存，是否用当前内容覆盖？', '覆盖', '再想想');
        if (ok) {
          try {
            const res = await examsApi.saveDraft(examId, { answers, currentPage, clientVersion: clientVersionRef.current, redo: isRedo, force: true });
            const ts2 = res?.data?.lastSavedAt || Date.now();
            if (typeof res?.data?.version === 'number') clientVersionRef.current = res.data.version;
            syncedAtRef.current = ts2;
            setSyncedAt(ts2);
            setDirty(false);
            await saveLocal(answersMap, currentPage);
            showToast('已用当前内容覆盖云端草稿 ☁️', 'success');
          } catch (e2: any) {
            showToast(e2?.message || '覆盖失败，请稍后再试', 'error');
          }
        }
        return;
      }
      showToast(err.message || '同步到云端失败了，请稍后再试一次吧！', 'error');
    } finally {
      setSyncing(false);
    }
  };

  // 4b. 静默同步（离开工作区时自动触发：不弹窗、不切换 UI，失败也静默，本地 IndexedDB 仍是权威）
  const syncToCloudSilent = async () => {
    const answers = Object.keys(answersMap)
      .map((k) => ({ pageIndex: Number(k), canvasData: answersMap[Number(k)] }))
      .filter((a) => a.canvasData !== '');
    if (answers.length === 0) return;
    try {
      const res = await examsApi.saveDraft(examId, { answers, currentPage, clientVersion: clientVersionRef.current, redo: isRedo });
      const ts = res?.data?.lastSavedAt || Date.now();
      if (typeof res?.data?.version === 'number') clientVersionRef.current = res.data.version;
      syncedAtRef.current = ts;
      setSyncedAt(ts);
      setDirty(false);
      await saveLocal(answersMap, currentPage);
    } catch {
      /* 静默：离开时的自动同步失败不打扰 */
    }
  };

  // 5. 防抖自动存盘（落笔停顿 4 秒即写入本地 IndexedDB）
  useEffect(() => {
    if (Object.keys(answersMap).length === 0) return;
    setDirty(true);
    const t = setTimeout(() => {
      void saveLocal(answersMap, currentPage);
    }, 4000);
    return () => clearTimeout(t);
  }, [answersMap, currentPage, examId]);

  // 5b. 退出/切后台兜底：始终持有最新笔迹引用，页面隐藏或卸载前立即落盘，避免丢末笔
  const latestRef = useRef<{ answers: Record<number, string>; page: number }>({
    answers: {},
    page: 0,
  });
  useEffect(() => {
    latestRef.current = { answers: answersMap, page: currentPage };
  }, [answersMap, currentPage]);

  useEffect(() => {
    const flush = () => {
      void saveLocal(latestRef.current.answers, latestRef.current.page);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [examId]);

  // 6. 时限倒计时：每秒刷新，严格模式到点自动收卷
  useEffect(() => {
    if (!timePolicy) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timePolicy]);

  // 计算剩余时间（取截止时间与倒计时时长中较早者）
  const effectiveEnd = (() => {
    if (!timePolicy) return null;
    const ends: number[] = [];
    if (typeof timePolicy.deadline === 'number') ends.push(timePolicy.deadline);
    if (typeof timePolicy.durationMin === 'number') ends.push(startedAtRef.current + timePolicy.durationMin * 60_000);
    if (ends.length === 0) return null;
    return Math.min(...ends);
  })();
  const remainingMs = effectiveEnd !== null ? effectiveEnd - now : null;
  const expired = remainingMs !== null && remainingMs <= 0;
  const isStrict = timePolicy?.mode === 'strict';

  // 当前是否处于「每日可作答时段」内（未设时段视为随时可作答）
  const inDailyWindow = (() => {
    const w = timePolicy?.dailyWindow;
    if (!w || !w.start || !w.end) return true;
    const toMin = (s: string) => {
      const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const s = toMin(w.start);
    const e = toMin(w.end);
    if (s === null || e === null) return true;
    const d = new Date(now);
    const cur = d.getHours() * 60 + d.getMinutes();
    return s <= e ? cur >= s && cur <= e : cur >= s || cur <= e;
  })();

  // 严格模式且到点：自动收卷一次（不弹确认框）
  useEffect(() => {
    if (expired && isStrict && !autoSubmittedRef.current && !submitting) {
      autoSubmittedRef.current = true;
      handleSubmit(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired, isStrict]);

  const handleCanvasChange = (dataUrl: string) => {
    setAnswersMap(prev => ({
      ...prev,
      [currentPage]: dataUrl,
    }));
  };

  const handlePrev = () => {
    if (currentPage > 0) {
      void saveLocal(answersMap, currentPage); // 离开本页前先存盘，避免笔迹丢失
      setCurrentPage(prev => prev - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < pages.length - 1) {
      void saveLocal(answersMap, currentPage); // 离开本页前先存盘，避免笔迹丢失
      setCurrentPage(prev => prev + 1);
    }
  };

  const doSubmit = async (force: boolean, auto: boolean) => {
    const answers = Object.keys(answersMap).map((key) => ({
      pageIndex: Number(key),
      canvasData: answersMap[Number(key)],
    })).filter(ans => ans.canvasData !== '');

    const res = await examsApi.submit(examId, {
      answers,
      startedAt: startedAtRef.current,
      clientVersion: clientVersionRef.current,
      redo: isRedo,
      force,
    });
    if (res?.data?.submission?.version) clientVersionRef.current = res.data.submission.version;

    // 交卷成功后，安全销毁本地临时草稿，防止二次冗余恢复
    const studentId = currentStudentId();
    if (studentId) await removeLocalDraft(`${studentId}::${examId}`);
    setDirty(false);

    confetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.6 }
    });

    showToast(auto ? '⏰ 时间到，作业本已自动交卷啦！你真棒！' : '🎉 恭喜你！作业本成功交上去了！你真棒！', 'success');
    setTimeout(() => {
      onBack();
    }, 1500);
  };

  const handleSubmit = async (auto = false) => {
    if (!auto) {
      const ok = await confirmAsync('小朋友，确认全部写完，要把作业本交给老师批改了吗？🎉', '交作业');
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      await doSubmit(false, auto);
    } catch (err: any) {
      if (err?.status === 409 && err?.data?.conflict) {
        const ok = await confirmAsync(err.message || '检测到其他设备有更新的提交，是否用当前设备的内容覆盖？', '覆盖保存', '再想想');
        if (ok) {
          try {
            await doSubmit(true, auto);
          } catch (e2: any) {
            showToast(e2?.message || '覆盖提交失败，请稍后再试一次吧！', 'error');
          }
          return;
        }
        return;
      }
      showToast(err.message || '提交失败了，请稍后再试一次吧！', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // 主动离开工作区：先确保本地最新笔迹落盘，再尝试静默同步到云端（失败不打扰），最后返回大厅
  const handleBack = async () => {
    await saveLocal(answersMap, currentPage);
    if (dirty && hasAnswers && !closed && !expired) {
      try {
        await syncToCloudSilent();
      } catch {
        /* 静默失败，本地草稿已存盘 */
      }
    }
    onBack();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div style={{ fontSize: '50px' }} className="jelly-jump">🎒</div>
        <span className="font-extrabold text-sm text-gray-400 mt-3">作业本疯狂翻页中...</span>
      </div>
    );
  }

  const totalPages = pages.length;
  const hasAnswers = Object.keys(answersMap).length > 0;

  return (
    <div className="flex flex-col gap-4 w-full max-w-[1550px] mx-auto p-4 pb-12">
      {/* 沉浸式工作区头部 */}
      <div className="flex items-center justify-between border-b-2 border-gray-border pb-3">
        <button 
          onClick={handleBack} 
          className="btn-3d btn-3d-blue text-xs py-2 px-3.5"
          style={{
            boxShadow: '0 3px 0 var(--color-blue-depth)',
          }}
        >
          <ArrowLeft size={15} />
          <span className="font-extrabold">回大厅</span>
        </button>

        <h2 className="text-xl font-black text-center text-gray-800">
          ✏️ 正在写作业: {examTitle}
        </h2>

        <div className="flex items-center gap-2">
          {timePolicy && remainingMs !== null && (
            <div
              className="badge-jelly text-xs font-black py-1.5 px-3 flex items-center gap-1"
              style={{
                backgroundColor: expired ? '#FEE2E2' : remainingMs < 60_000 ? '#FFEDD5' : '#ECFDF5',
                color: expired ? '#DC2626' : remainingMs < 60_000 ? '#EA580C' : '#16A34A',
                borderColor: 'rgba(0,0,0,0.05)',
              }}
            >
              <Timer size={13} />
              {expired ? '时间到' : fmtRemaining(remainingMs)}
            </div>
          )}
          {closed && (
            <div className="badge-jelly text-xs font-black py-1.5 px-3 bg-gray-200 text-gray-500">已关闭</div>
          )}
          {timePolicy?.dailyWindow && (
            <div
              className="badge-jelly text-xs font-black py-1.5 px-3 flex items-center gap-1"
              style={{
                backgroundColor: inDailyWindow ? '#ECFDF5' : '#FEF3C7',
                color: inDailyWindow ? '#16A34A' : '#B45309',
                borderColor: 'rgba(0,0,0,0.05)',
              }}
            >
              🕐 每日 {timePolicy.dailyWindow.start}-{timePolicy.dailyWindow.end} {inDailyWindow ? '可交卷' : '未到时间'}
            </div>
          )}
          <div 
            className="badge-jelly text-xs font-black py-1.5 px-3" 
            style={{ backgroundColor: '#FAF5FF', color: '#7E22CE', borderColor: '#E9D5FF' }}
          >
            {currentPage + 1} / {totalPages} 页
          </div>

          {/* 同步到云端 + 本地提示 */}
          {dirty && hasAnswers && (
            <div className="flex flex-col items-end gap-0.5">
              <button
                onClick={syncToCloud}
                disabled={syncing}
                className="btn-3d text-xs py-1.5 px-3 flex items-center gap-1"
                style={{ boxShadow: '0 3px 0 #E5E5E5', backgroundColor: '#FFFFFF', color: '#185FA5' }}
              >
                <Cloud size={13} />
                {syncing ? '同步中…' : '同步到云端'}
              </button>
              <span className="text-[10px] font-extrabold text-amber-600 leading-tight">
                ⚠️ 答题进度仅存在本地，清理浏览器缓存会丢失
              </span>
            </div>
          )}
          {syncedAt && (
            <div
              className="badge-jelly text-xs font-black py-1.5 px-3 flex items-center gap-1"
              style={{ backgroundColor: '#EFF6FF', color: '#185FA5', borderColor: 'rgba(0,0,0,0.05)' }}
              title="你的笔迹已经安全存到云端，换设备也能接着写"
            >
              ☁️ 已同步 {new Date(syncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm font-extrabold text-center text-red-600">
          🍎 {errorMsg}
        </div>
      )}

      {closed && (
        <div className="p-3 bg-gray-100 border border-gray-300 rounded-xl text-sm font-extrabold text-center text-gray-500">
          🔒 老师已关闭本作业，暂时无法提交。
        </div>
      )}

      {timePolicy?.dailyWindow && !inDailyWindow && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm font-extrabold text-center text-amber-700">
          🕐 现在不在可作答时段（每日 {timePolicy.dailyWindow.start}-{timePolicy.dailyWindow.end}），到点才能交卷哦
        </div>
      )}

      {/* 画板绘制核心区域 */}
      <div className="flex justify-center w-full my-2">
        <CanvasDraw
          key={`${currentPage}`}
          backgroundImage={pages[currentPage]}
          initialData={answersMap[currentPage]}
          mode="draw"
          onChange={handleCanvasChange}
        />
      </div>

      {/* 工作区底部翻页与提交工具栏 */}
      <div className="flex justify-between items-center w-full max-w-[1200px] mx-auto mt-4 px-2">
        <button
          onClick={handlePrev}
          disabled={currentPage === 0}
          className={`btn-3d btn-3d-blue text-xs ${currentPage === 0 ? 'btn-3d-disabled' : ''}`}
          style={{ padding: '10px 16px', boxShadow: currentPage === 0 ? undefined : '0 3px 0 var(--color-blue-depth)' }}
        >
          <ChevronLeft size={16} />
          <span className="font-extrabold">上一页</span>
        </button>

        {currentPage === totalPages - 1 ? (
          <button
            onClick={() => handleSubmit(false)}
            disabled={submitting || closed || (expired && isStrict) || !inDailyWindow}
            className="btn-3d btn-3d-secondary font-black py-3 px-6 text-sm"
            style={{ 
              boxShadow: '0 4px 0 var(--color-secondary-depth)',
              transform: 'scale(1.03)',
            }}
          >
            <Check size={16} />
            <span>{closed ? '已关闭' : (expired && isStrict) ? '已截止' : !inDailyWindow ? '未到作答时间' : '完成作业并提交老师 🎉'}</span>
          </button>
        ) : (
          <span className="text-xs text-gray-400 font-extrabold">
            写完这一页，点击"下一页"继续哦
          </span>
        )}

        <button
          onClick={handleNext}
          disabled={currentPage === totalPages - 1}
          className={`btn-3d btn-3d-blue text-xs ${currentPage === totalPages - 1 ? 'btn-3d-disabled' : ''}`}
          style={{ padding: '10px 16px', boxShadow: currentPage === totalPages - 1 ? undefined : '0 3px 0 var(--color-blue-depth)' }}
        >
          <span className="font-extrabold">下一页</span>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};
