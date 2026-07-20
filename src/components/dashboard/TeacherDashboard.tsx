import React, { useState, useEffect } from 'react';
import type { Class, Exam } from '../../types';
import { Users, Plus, Upload, Edit3, ClipboardList } from 'lucide-react';
import { convertPdfToImages } from '../../utils/pdfParser';
import { api, classesApi, statsApi, usersApi } from '../../api';
import { confirmAsync } from '../../utils/toast';
import * as XLSX from 'xlsx';

interface TeacherDashboardProps {
  onGradeExam: (examId: string, studentId: string, submissionId: string) => void;
  onViewReport: (examId: string, studentId: string) => void;
  onOpenPapers: () => void;
  onOpenLogs: () => void;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  onGradeExam,
  onViewReport,
  onOpenPapers,
  onOpenLogs,
}) => {
  const [classes, setClasses] = useState<Class[]>([]);
  const [activeClassId, setActiveClassId] = useState<string>('');
  
  // 建班表单
  const [newClassName, setNewClassName] = useState<string>('');
  
  // 添加学生表单
  const [studentName, setStudentName] = useState<string>('');
  const [studentUsername, setStudentUsername] = useState<string>('');
  const [studentPassword, setStudentPassword] = useState<string>('');
  const [addExistingMode, setAddExistingMode] = useState<boolean>(false);
  // 学号实时查重状态（P2-学生账号体验）
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'taken' | 'ok'>('idle');

  // 批量粘贴学号模式
  const [batchMode, setBatchMode] = useState<boolean>(false);
  const [batchText, setBatchText] = useState<string>('');
  // 转班：当前正在转班的学生 + 目标班级
  const [transferStudentId, setTransferStudentId] = useState<string>('');
  const [transferTargetClassId, setTransferTargetClassId] = useState<string>('');

  // 发卷表单
  const [examTitle, setExamTitle] = useState<string>('');
  const [examPages, setExamPages] = useState<string[]>([]);
  
  // 选中的试卷提交大厅监控
  const [examsList, setExamsList] = useState<Exam[]>([]);
  const [activeExamId, setActiveExamId] = useState<string>('');
  const [submissionsList, setSubmissionsList] = useState<any[]>([]);

  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // P2-12 教师待批改/迟交/完成率统计（用于大厅角标、看板与催交）
  const [stats, setStats] = useState<{
    stats: Record<string, {
      total: number;
      submitted: number;
      pending: number;
      late: number;
      notSubmitted: number;
      completionRate: number;
      notSubmittedNames: string[];
    }>;
    totalPending: number;
    totalLate: number;
    grandTotal: number;
    grandSubmitted: number;
    grandCompletionRate: number;
  }>({ stats: {}, totalPending: 0, totalLate: 0, grandTotal: 0, grandSubmitted: 0, grandCompletionRate: 0 });

  // 获取该教师的所有班级
  const loadClasses = async () => {
    try {
      const data = await api.get<Class[]>('/api/classes');
      setClasses(data);
      if (data.length > 0 && !activeClassId) {
        setActiveClassId(data[0].id);
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  // P2-12 加载待批改/迟交统计（每次进入控制台刷新一次）
  const loadStats = async () => {
    try {
      const data = await statsApi.teacher();
      setStats(data);
    } catch {
      /* 统计失败不影响主流程 */
    }
  };

  useEffect(() => {
    loadClasses();
    loadStats();
  }, []);

  // 切换班级时，获取该班级的试题列表
  useEffect(() => {
    if (activeClassId) {
      loadClassExams(activeClassId);
    }
  }, [activeClassId]);

  // 切换选中试题时，获取全班的答卷提交进度
  useEffect(() => {
    if (activeExamId) {
      loadExamSubmissions(activeExamId);
    }
  }, [activeExamId]);

  const loadClassExams = async (classId: string) => {
    try {
      const data = await api.get<Exam[]>(`/api/exams/class/${classId}`);
      setExamsList(data);
      if (data.length > 0) {
        setActiveExamId(data[0].id);
      } else {
        setActiveExamId('');
        setSubmissionsList([]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadExamSubmissions = async (examId: string) => {
    const currentClass = classes.find(c => c.id === activeClassId);
    if (!currentClass || !currentClass.students) return;

    try {
      const studentSubmissions: any[] = [];
      
      for (const student of currentClass.students) {
        try {
          const detail = await api.get<any>(`/api/exams/${examId}/submission/${student.id}`);
          studentSubmissions.push({
            studentId: student.id,
            studentName: student.name,
            username: student.username,
            submission: detail.submission,
          });
        } catch (e) {
          studentSubmissions.push({
            studentId: student.id,
            studentName: student.name,
            username: student.username,
            submission: null,
          });
        }
      }
      setSubmissionsList(studentSubmissions);
    } catch (error) {
      console.error(error);
    }
  };

  // 一键软删除撤回试卷
  const handleWithdrawExam = async (examId: string) => {
    const exam = examsList.find(e => e.id === examId);
    if (!exam) return;

    const ok = await confirmAsync(`老师，确认要撤回试卷【${exam.title}】吗？\n撤回后此试卷将被永久撤销，学生将无法继续答题！🗑️`);
    if (!ok) return;
    try {
      await api.delete(`/api/exams/${examId}`);
      setMessage({ type: 'success', text: `成功撤回试卷：${exam.title}！🗑️` });
      loadClassExams(activeClassId);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '撤回试卷失败，请稍后重试' });
    }
  };

  // 创建班级
  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassName) return;

    try {
      await api.post('/api/classes', { name: newClassName });
      setNewClassName('');
      setMessage({ type: 'success', text: `成功创建班级：${newClassName}！🎓` });
      loadClasses();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  // 学号实时查重：输入防抖后调用后端校验（P2-学生账号体验）
  useEffect(() => {
    if (addExistingMode || !studentUsername.trim()) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    const t = setTimeout(async () => {
      try {
        const res = await usersApi.checkUsername(studentUsername.trim());
        setUsernameStatus(res.data.available ? 'ok' : 'taken');
      } catch {
        setUsernameStatus('idle');
      }
    }, 400);
    return () => clearTimeout(t);
  }, [studentUsername, addExistingMode]);

  // 🎲 一键自动生成唯一学号（P2-学生账号体验）
  const handleSuggestUsername = async () => {
    try {
      const res = await usersApi.suggestUsername();
      setStudentUsername(res.data.username);
      setUsernameStatus('ok');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '自动生成学号失败，请稍后再试' });
    }
  };

  // 在班级里添加学生
  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeClassId) return;
    if (addExistingMode) {
      if (!studentUsername.trim()) return;
    } else {
      if (!studentName.trim() || !studentPassword.trim()) return;
      // 新建账号模式下，若学号被占用则直接拦截（服务端也会再校验一次）
      if (usernameStatus === 'taken') return;
    }

    try {
      const res = await api.post<any>(`/api/classes/${activeClassId}/students`, {
        name: studentName,
        username: studentUsername,
        password: studentPassword,
        addExisting: addExistingMode,
      });

      const finalUsername = res?.data?.student?.username || studentUsername;
      setMessage({
        type: 'success',
        text: addExistingMode
          ? `已将已有学生【${studentUsername}】并入本班！该生现在同时属于多个班级 ✅`
          : `成功将学生【${studentName}】添加至班级！学号：${finalUsername}（请告知学生，首次登录需改密）`,
      });
      setStudentName('');
      setStudentUsername('');
      setStudentPassword('');
      setAddExistingMode(false);
      setUsernameStatus('idle');
      loadClasses();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  // 将学生移出本班级（退班）
  const handleRemoveStudent = async (studentId: string) => {
    const stu = activeClass?.students?.find(s => s.id === studentId);
    const ok = await confirmAsync(`确认将学生【${stu?.name || studentId}】移出本班级吗？`);
    if (!ok) return;
    try {
      await classesApi.removeStudent(activeClassId, studentId);
      setMessage({ type: 'success', text: `已将学生【${stu?.name || ''}】移出本班` });
      loadClasses();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '移出失败，请重试' });
    }
  };

  // 转班：从原班移除 + 并入目标班（一键升班/调班）
  const handleTransferConfirm = async () => {
    if (!transferStudentId || !transferTargetClassId || !activeClassId) return;
    const stu = activeClass?.students?.find(s => s.id === transferStudentId);
    const targetName = classes.find(c => c.id === transferTargetClassId)?.name || '';
    try {
      await classesApi.removeStudent(activeClassId, transferStudentId); // 原班移除
      await classesApi.addExisting(transferTargetClassId, stu?.username || ''); // 并入目标班
      setMessage({ type: 'success', text: `✅ 已把【${stu?.name || ''}】从本班转入【${targetName}】` });
      setTransferStudentId('');
      setTransferTargetClassId('');
      loadClasses();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '转班失败，请重试' });
    }
  };

  // 批量粘贴学号：逐行并入本班（适用于已建好账号、按学号批量入班场景）
  const handleBatchAdd = async () => {
    if (!batchText.trim() || !activeClassId) return;
    const lines = batchText.split('\n').map(l => l.trim()).filter(Boolean);
    let ok = 0;
    let fail = 0;
    for (const username of lines) {
      try {
        await classesApi.addExisting(activeClassId, username);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setMessage({
      type: 'success',
      text: `📋 批量并入完成：成功 ${ok} 人${fail ? `，失败 ${fail} 人（可能已在本班或非学生账号）` : ''}`,
    });
    setBatchText('');
    loadClasses();
  };

  // 魔法转换：处理图片与 PDF 文件的读取并统一解析为 Base64 PNG 图片集
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setLoading(true);
    setMessage({ type: 'success', text: '🔮 哇！正在把你的 PDF 试卷魔幻解析为可爱图片中，请稍候哦...' });

    try {
      const results: string[] = [];
      for (const file of Array.from(files)) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const pdfImages = await convertPdfToImages(file);
          results.push(...pdfImages);
        } else {
          // 普通图片文件处理
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          results.push(base64);
        }
      }
      setExamPages(prev => [...prev, ...results]);
      setMessage({ type: 'success', text: `🎉 成功解析并导入 ${results.length} 页试卷页面！` });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '导入文件失败，请重试' });
    } finally {
      setLoading(false);
    }
  };

  // 发布试卷
  const handlePublishExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!examTitle || examPages.length === 0 || !activeClassId) {
      setMessage({ type: 'error', text: '必须填写标题并至少选择一张试卷图片哦' });
      return;
    }

    setLoading(true);
    try {
      await api.post('/api/exams', {
        title: examTitle,
        classId: activeClassId,
        pages: examPages,
      });

      setMessage({ type: 'success', text: `🎉 试卷【${examTitle}】发布成功！全班可以开始答题了。` });
      setExamTitle('');
      setExamPages([]);
      loadClassExams(activeClassId);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  // 导出本班成绩汇总为 Excel（后端聚合，前台用 xlsx 生成文件并触发下载）
  const handleExportGrades = async () => {
    if (!activeClassId) return;
    try {
      const res = await classesApi.exportGrades(activeClassId);
      const { className, rows } = res.data;
      const aoa = [
        ['学生姓名', '学号账号', '状态', '得分', '老师评语', '交卷时间', '批改时间', '防伪分享码'],
        ...rows.map((r: any) => [
          r.studentName,
          r.username,
          r.status === 'graded' ? '已批改' : r.status === 'submitted' ? '待批改' : '未开始',
          r.score ?? '',
          r.comment || '',
          r.submittedAt ? new Date(r.submittedAt).toLocaleString('zh-CN') : '',
          r.gradedAt ? new Date(r.gradedAt).toLocaleString('zh-CN') : '',
          r.shareCode || '',
        ]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '成绩汇总');
      XLSX.writeFile(wb, `${className}_成绩汇总.xlsx`);
      setMessage({ type: 'success', text: `📊 已导出【${className}】成绩汇总 Excel！` });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '导出成绩失败，请稍后重试' });
    }
  };

  const activeClass = classes.find(c => c.id === activeClassId);

  return (
    <div className="flex flex-col gap-8 w-full max-w-[1550px] mx-auto p-6 md:p-8">
      <h1 className="text-2xl font-black flex items-center gap-2 text-gray-800">
        <span className="jelly-jump">👩‍🏫</span> 班级与教研控制台
      </h1>

      {/* 快捷入口 */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={onOpenPapers}
          className="btn-3d btn-3d-primary text-sm py-2.5 px-5"
        >
          📚 试卷库（预存试卷）
        </button>
        <button
          onClick={onOpenLogs}
          className="btn-3d text-sm py-2.5 px-5 bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]"
        >
          🧾 记录中心
        </button>
        <button
          onClick={handleExportGrades}
          disabled={!activeClassId}
          className="btn-3d text-sm py-2.5 px-5 bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          📊 导出成绩(Excel)
        </button>
      </div>

      {message && (
        <div 
          className={`p-4 rounded-2xl border text-sm font-extrabold transition-all cursor-pointer ${
            message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
          }`}
          onClick={() => setMessage(null)}
        >
          {message.type === 'success' ? '🎉' : '🍎'} {message.text} (点击关闭)
        </div>
      )}

      {/* 班级导航条 */}
      <div className="flex flex-wrap gap-3 items-center">
        <span className="font-extrabold text-sm text-gray-500">选择班级：</span>
        {classes.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setActiveClassId(c.id);
              setMessage(null);
            }}
            className={`btn-3d text-xs py-2 px-4 ${
              activeClassId === c.id ? 'btn-3d-primary' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'
            }`}
            style={{
              boxShadow: activeClassId === c.id ? undefined : '0 3px 0 #E5E5E5',
            }}
          >
            {c.name} ({c.studentIds.length} 人)
          </button>
        ))}

        {/* 新建班级表单 */}
        <form onSubmit={handleCreateClass} className="flex items-center gap-2 ml-auto">
          <input
            type="text"
            placeholder="如：四年级二班"
            value={newClassName}
            onChange={(e) => setNewClassName(e.target.value)}
            className="input-jelly text-xs py-2 px-3"
            style={{ width: '180px' }}
            required
          />
          <button 
            type="submit" 
            className="btn-3d btn-3d-yellow text-xs py-2 px-4"
            style={{
              boxShadow: '0 3px 0 var(--color-yellow-depth)',
            }}
          >
            <Plus size={14} />
            <span>建新班</span>
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* 左侧：班级学生管理 */}
        <div className="card-jelly flex flex-col gap-4">
          <h3 className="text-md font-black border-b-2 border-gray-border pb-3 flex items-center gap-2 text-gray-700">
            <Users size={20} className="text-blue-500" />
            <span>学生花名册</span>
          </h3>

          {activeClass ? (
            <>
              <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-1">
                {activeClass.students && activeClass.students.length > 0 ? (
                  activeClass.students.map((student: any) => (
                    <div
                      key={student.id}
                      className="p-3 border border-gray-border rounded-xl bg-gray-50 flex flex-col gap-2 text-xs font-black text-gray-700"
                    >
                      <div className="flex justify-between items-center gap-2">
                        <div className="flex flex-col gap-0.5">
                          <span>{student.name}</span>
                          <span className="text-[10px] text-gray-400 font-bold">学号: {student.username}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-extrabold px-2 py-1 rounded-lg bg-purple-50 text-purple-600 border border-purple-200" title="将此绑定码发给孩子家长用于安全绑定">
                            绑定码: {student.bindCode || '—'}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveStudent(student.id)}
                            className="btn-3d text-[10px] py-1 px-2"
                            style={{ backgroundColor: '#FEE2E2', color: '#DC2626', boxShadow: '0 2px 0 #FCA5A5' }}
                            title="移出本班"
                          >
                            🚪 移出
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTransferStudentId(transferStudentId === student.id ? '' : student.id);
                              setTransferTargetClassId('');
                            }}
                            className="btn-3d text-[10px] py-1 px-2"
                            style={{ backgroundColor: '#F3E8FF', color: '#7E22CE', boxShadow: '0 2px 0 #D8B4FE' }}
                            title="转到其他班级"
                          >
                            🔄 {transferStudentId === student.id ? '收起' : '转班'}
                          </button>
                        </div>
                      </div>

                      {transferStudentId === student.id && (
                        <div className="flex items-center gap-2 border-t border-dashed border-gray-300 pt-2">
                          <select
                            value={transferTargetClassId}
                            onChange={(e) => setTransferTargetClassId(e.target.value)}
                            className="input-jelly text-xs py-1.5 flex-1 bg-white"
                          >
                            <option value="">选择目标班级…</option>
                            {classes.filter(c => c.id !== activeClassId).map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={handleTransferConfirm}
                            disabled={!transferTargetClassId}
                            className="btn-3d btn-3d-purple text-[10px] py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            确认转班
                          </button>
                          <button
                            type="button"
                            onClick={() => { setTransferStudentId(''); setTransferTargetClassId(''); }}
                            className="btn-3d text-[10px] py-1.5 px-3"
                          >
                            取消
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <span className="text-xs text-gray-400 font-extrabold text-center py-6">该班级还没有学生小朋友，快去添加吧！</span>
                )}
              </div>

              {/* 添加学生表单 */}
              {batchMode ? (
                <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-2.5 border-t border-dashed border-gray-300 pt-4 mt-2">
                  <label className="flex items-center gap-2 text-[10px] font-extrabold text-gray-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={batchMode}
                      onChange={(e) => setBatchMode(e.target.checked)}
                      className="w-3.5 h-3.5 accent-blue-500"
                    />
                    📋 批量粘贴学号（每行一个，自动并入本班）
                  </label>
                  <textarea
                    value={batchText}
                    onChange={(e) => setBatchText(e.target.value)}
                    placeholder={'每行粘贴一个学号，如：\ndawei01\nlili02\nxiaoming03'}
                    className="input-jelly text-xs py-2 h-24 resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleBatchAdd}
                      disabled={!batchText.trim()}
                      className="btn-3d btn-3d-blue text-xs py-2 font-black flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ boxShadow: '0 3px 0 var(--color-blue-depth)' }}
                    >
                      批量并入本班 🎒
                    </button>
                    <button
                      type="button"
                      onClick={() => setBatchMode(false)}
                      className="btn-3d text-xs py-2 px-3"
                    >
                      单条
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleAddStudent} className="flex flex-col gap-2.5 border-t border-dashed border-gray-300 pt-4 mt-2">
                  <label className="flex items-center gap-2 text-[10px] font-extrabold text-gray-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={addExistingMode}
                      onChange={(e) => setAddExistingMode(e.target.checked)}
                      className="w-3.5 h-3.5 accent-blue-500"
                    />
                    该生已有账号（仅填学号即可并入本班，如跨兴趣班）
                  </label>
                  <label className="flex items-center gap-2 text-[10px] font-extrabold text-gray-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={batchMode}
                      onChange={(e) => setBatchMode(e.target.checked)}
                      className="w-3.5 h-3.5 accent-blue-500"
                    />
                    📋 切换批量粘贴学号模式
                  </label>
                  {!addExistingMode && (
                    <input
                      type="text"
                      placeholder="姓名 (如: 张大伟)"
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      className="input-jelly text-xs py-2"
                    />
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="登录学号 (留空将自动生成，或点🎲)"
                      value={studentUsername}
                      onChange={(e) => setStudentUsername(e.target.value)}
                      className="input-jelly text-xs py-2 flex-1"
                    />
                    {!addExistingMode && (
                      <button
                        type="button"
                        onClick={handleSuggestUsername}
                        title="自动生成一个唯一学号"
                        className="btn-3d text-xs py-2 px-3 whitespace-nowrap"
                      >
                        🎲 自动生成
                      </button>
                    )}
                  </div>
                  {!addExistingMode && usernameStatus === 'checking' && (
                    <span className="text-[10px] text-gray-400 font-bold">正在检查学号是否可用…</span>
                  )}
                  {!addExistingMode && usernameStatus === 'taken' && (
                    <span className="text-[10px] text-red-500 font-bold">⚠️ 该学号已被占用，请换一个或点🎲</span>
                  )}
                  {!addExistingMode && usernameStatus === 'ok' && studentUsername.trim() && (
                    <span className="text-[10px] text-green-600 font-bold">✓ 学号可用</span>
                  )}
                  {!addExistingMode && (
                    <input
                      type="text"
                      placeholder="初始登录密码"
                      value={studentPassword}
                      onChange={(e) => setStudentPassword(e.target.value)}
                      className="input-jelly text-xs py-2"
                    />
                  )}
                  <button 
                    type="submit" 
                    disabled={!addExistingMode && usernameStatus === 'taken'}
                    className="btn-3d btn-3d-blue text-xs py-2 font-black mt-1 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      boxShadow: '0 3px 0 var(--color-blue-depth)',
                    }}
                  >
                    <span>{addExistingMode ? '并入本班 🎒' : '加入本班 🎒'}</span>
                  </button>
                </form>
              )}
            </>
          ) : (
            <span className="text-xs text-gray-400 font-extrabold text-center py-12">请先在上方建立一个属于您的班级吧！🎓</span>
          )}
        </div>

        {/* 中间：发布试卷区 */}
        <div className="card-jelly flex flex-col gap-4">
          <h3 className="text-md font-black border-b-2 border-gray-border pb-3 flex items-center gap-2 text-gray-700">
            <Upload size={20} className="text-green-500" />
            <span>发布新试题/作业</span>
          </h3>

          {activeClass ? (
            <form onSubmit={handlePublishExam} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-extrabold text-gray-500">试题标题：</label>
                <input
                  type="text"
                  placeholder="如：三年级第二单元口算测试"
                  value={examTitle}
                  onChange={(e) => setExamTitle(e.target.value)}
                  className="input-jelly text-xs py-2"
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-extrabold text-gray-500">上传试卷图片（可多选）：</label>
                <div 
                  className="p-5 border-2 border-dashed border-gray-300 rounded-2xl bg-gray-50 flex flex-col items-center justify-center cursor-pointer hover:bg-green-50 hover:border-green-300 transition-colors"
                  onClick={() => document.getElementById('exam-upload-input')?.click()}
                >
                  <Upload size={26} className="text-gray-400 mb-1" />
                  <span className="text-xs font-black text-gray-600">选择图片文件导入</span>
                  <input
                    id="exam-upload-input"
                    type="file"
                    multiple
                    accept="image/*,.pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>
              </div>

              {examPages.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-extrabold text-green-600">已导入：{examPages.length} 页试卷</span>
                  <div className="flex gap-2 overflow-x-auto py-1">
                    {examPages.map((p, idx) => (
                      <img 
                        key={idx} 
                        src={p} 
                        className="w-12 h-16 object-cover border border-gray-border rounded-lg shadow-sm" 
                        alt="试卷页面" 
                      />
                    ))}
                  </div>
                </div>
              )}

              <button 
                type="submit" 
                disabled={loading}
                className="btn-3d btn-3d-primary font-black py-2.5 mt-2"
                style={{
                  boxShadow: '0 4px 0 var(--color-primary-depth)',
                }}
              >
                {loading ? '发布中...' : '发布试卷至全班 🚀'}
              </button>
            </form>
          ) : (
            <span className="text-xs text-gray-400 font-extrabold text-center py-12">请选择班级以发布作业。</span>
          )}
        </div>

        {/* 右侧：试卷监控与批改中心 */}
        <div className="card-jelly flex flex-col gap-4">
          <h3 className="text-md font-black border-b-2 border-gray-border pb-3 flex items-center gap-2 text-gray-700">
            <ClipboardList size={20} className="text-yellow-500" />
            <span>试卷与批改中心</span>
            <span className="badge-jelly text-[10px] bg-sky-100 text-sky-700 border-sky-200">
              总完成率 {stats.grandCompletionRate}%
            </span>
            {(stats.totalPending > 0 || stats.totalLate > 0) && (
              <span className="badge-jelly text-[10px] bg-amber-100 text-amber-700 border-amber-200">
                待批改 {stats.totalPending} ｜ 迟交 {stats.totalLate}
              </span>
            )}
          </h3>

          {examsList.length > 0 ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-extrabold text-gray-500">选择班级试题：</label>
                <div className="flex items-center gap-2">
                  <select
                    value={activeExamId}
                    onChange={(e) => setActiveExamId(e.target.value)}
                    className="input-jelly text-xs py-2 bg-white flex-1"
                  >
                    {examsList.map(e => {
                      const st = stats.stats[e.id];
                      return (
                        <option key={e.id} value={e.id}>
                          {e.title}
                          {st ? ` (已交${st.submitted}/${st.total}·${st.completionRate}%)` : ''}
                          {st?.pending ? ` ·待批${st.pending}` : ''}
                        </option>
                      );
                    })}
                  </select>
                  {activeExamId && (
                    <button
                      type="button"
                      onClick={() => handleWithdrawExam(activeExamId)}
                      className="btn-3d bg-red-50 border-red-300 text-red-600 text-xs py-2 px-3 flex items-center justify-center font-black"
                      style={{
                        top: 0,
                        boxShadow: '0 3px 0 #E06C75',
                        borderWidth: '2px',
                      }}
                      title="撤回该试卷"
                    >
                      <span>撤回 🗑️</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto border-t border-dashed border-gray-300 pt-4 mt-2">
                {(() => {
                  const st = stats.stats[activeExamId];
                  if (!st) return null;
                  return (
                    <div className="flex flex-col gap-1.5 mb-1">
                      <div className="flex items-center justify-between text-xs font-extrabold text-gray-600">
                        <span>学生作答进度监控</span>
                        <span className={st.completionRate === 100 ? 'text-green-600' : 'text-sky-600'}>
                          已交 {st.submitted}/{st.total}（{st.completionRate}%）
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className="h-full bg-green-400 transition-all duration-500"
                          style={{ width: `${st.completionRate}%` }}
                        />
                      </div>
                      {st.notSubmittedNames.length > 0 && (
                        <div className="text-[11px] text-amber-600 font-semibold leading-snug">
                          待催交（{st.notSubmittedNames.length}人）：{st.notSubmittedNames.join('、')}
                        </div>
                      )}
                    </div>
                  );
                })()}
                
                {submissionsList.length > 0 ? (
                  submissionsList.map((item) => {
                    const sub = item.submission;
                    let badgeBg = 'bg-gray-100 text-gray-500';
                    let statusLabel = '未开始 📝';

                    if (sub) {
                      if (sub.status === 'submitted') {
                        badgeBg = 'bg-yellow-50 text-yellow-600 border-yellow-200';
                        statusLabel = sub.isLate ? '待批改·迟 ⏰🖍️' : '待批改 🖍️';
                      } else if (sub.status === 'graded') {
                        badgeBg = 'bg-green-50 text-green-600 border-green-200';
                        statusLabel = `已批改: ${sub.score}分 🎉`;
                      }
                    }

                    return (
                      <div 
                        key={item.studentId}
                        className="p-3 border border-gray-border rounded-xl flex items-center justify-between text-xs bg-gray-50"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-extrabold text-gray-700">{item.studentName}</span>
                          <span className="text-[9px] text-gray-400 font-bold">@{item.username}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 border rounded-full font-extrabold text-[10px] ${badgeBg}`}>
                            {statusLabel}
                          </span>
                          
                          {sub && sub.status === 'submitted' && (
                            <button
                              onClick={() => onGradeExam(activeExamId, item.studentId, sub.id)}
                              className="btn-3d btn-3d-secondary text-[10px] py-1 px-2"
                              style={{
                                boxShadow: '0 2px 0 var(--color-secondary-depth)',
                              }}
                            >
                              <Edit3 size={10} />
                              <span>批改</span>
                            </button>
                          )}

                          {sub && sub.status === 'graded' && (
                            <button
                              onClick={() => onViewReport(activeExamId, item.studentId)}
                              className="btn-3d btn-3d-blue text-[10px] py-1 px-2"
                              style={{
                                boxShadow: '0 2px 0 var(--color-blue-depth)',
                              }}
                            >
                              <span>详情</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <span className="text-xs text-gray-400 font-extrabold text-center py-6">本班目前尚无学生，无法监控。</span>
                )}
              </div>
            </div>
          ) : (
            <span className="text-xs text-gray-400 font-extrabold text-center py-12">当前班级还没有发布试卷作业哦。</span>
          )}
        </div>
      </div>
    </div>
  );
};
