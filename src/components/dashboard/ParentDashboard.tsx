import React, { useState, useEffect } from 'react';
import { api } from '../../api';
import type { ChildReportItem } from '../../types';
import { Heart, FileText } from 'lucide-react';

interface ParentDashboardProps {
  onViewReport: (examId: string, studentId: string) => void;
  initialChildId?: string;
  childIds?: string[];
  onBindSuccess: (newChildId: string, newChildIds?: string[]) => void;
}

export const ParentDashboard: React.FC<ParentDashboardProps> = ({
  onViewReport,
  initialChildId,
  onBindSuccess,
}) => {
  const [childId, setChildId] = useState<string | undefined>(initialChildId);
  const [selectedChildId, setSelectedChildId] = useState<string | undefined>(initialChildId);
  const [childUsername, setChildUsername] = useState<string>(''); // 绑定的孩子账号
  const [bindCode, setBindCode] = useState<string>(''); // 老师下发的绑定码
  
  const [reports, setReports] = useState<ChildReportItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [showBindForm, setShowBindForm] = useState<boolean>(false);

  // 多孩：从报表中聚合出已绑定的孩子列表，并筛选当前选中孩子的报表
  const children = Array.from(
    new Map(reports.map((r) => [r.studentId, r.childName])).entries()
  ).map(([id, name]) => ({ id, name }));
  const activeChildId =
    selectedChildId && children.some((c) => c.id === selectedChildId)
      ? selectedChildId
      : children[0]?.id;
  const visibleReports = activeChildId
    ? reports.filter((r) => r.studentId === activeChildId)
    : reports;

  const loadChildReports = async () => {
    if (!childId) return;
    try {
      setLoading(true);
      const data = await api.get<ChildReportItem[]>('/api/parents/child/submissions');
      setReports(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (childId) {
      loadChildReports();
    }
  }, [childId]);

  const handleBind = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!childUsername) return;

    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const data = await api.post<{ message: string; childId: string; childIds?: string[] }>('/api/auth/parent/bind', {
        childUsername,
        bindCode,
      });

      setSuccessMsg(data.message);
      setChildId(data.childId);
      setSelectedChildId(data.childId);
      setShowBindForm(false); // 绑定成功后收起表单，回到报告区
      onBindSuccess(data.childId, data.childIds);
    } catch (err: any) {
      setErrorMsg(err.message || '绑定失败，请核对学号是否输入正确');
    } finally {
      setLoading(false);
    }
  };

  // 绑定孩子表单（首次绑定与「继续绑定另一个宝贝」复用同一套状态与逻辑）
  const renderBindForm = () => (
    <div className="card-jelly bg-white max-w-[500px] mx-auto w-full mt-2">
      <h3 className="text-lg font-black mb-4 flex items-center gap-2 text-gray-800">
        <Heart size={22} className="text-red-500 fill-current animate-pulse" />
        <span>{childId ? '继续绑定另一个宝贝 🎒' : '第一步：绑定您的宝贝孩子 🎒'}</span>
      </h3>

      {errorMsg && (
        <div className="mb-4 p-3 rounded-2xl border text-sm font-extrabold bg-red-50 border-red-200 text-red-600">
          🍎 {errorMsg}
        </div>
      )}

      {successMsg && !childId && (
        <div className="mb-4 p-3 rounded-2xl border text-sm font-extrabold bg-green-50 border-green-200 text-green-600">
          🎉 {successMsg}
        </div>
      )}

      <form onSubmit={handleBind} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-extrabold text-gray-400">请输入您家孩子的登录账号/学号：</label>
          <input
            type="text"
            placeholder="如: std001"
            value={childUsername}
            onChange={(e) => setChildUsername(e.target.value)}
            className="input-jelly"
            required
          />
          <span className="text-[10px] text-gray-400 font-extrabold mt-1">
            提示：请向孩子所在班级的任课老师索取专属的学生学号/登录账号。
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-extrabold text-gray-400">请输入老师提供的 6 位绑定码：</label>
          <input
            type="text"
            placeholder="如: A1B2C3"
            value={bindCode}
            onChange={(e) => setBindCode(e.target.value.toUpperCase())}
            className="input-jelly"
            maxLength={6}
            required
          />
          <span className="text-[10px] text-gray-400 font-extrabold mt-1">
            绑定码由老师在学生列表查看并发送给您，用于确认亲子关系、防止串绑。
          </span>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="btn-3d btn-3d-purple font-black py-3 mt-2"
          style={{
            boxShadow: '0 4px 0 var(--color-purple-depth)',
          }}
        >
          {loading ? '正在飞速连接中...' : (childId ? '绑定这个宝贝 🤝' : '开始绑定 🤝')}
        </button>
      </form>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto p-4">
      {/* 头部亲子横幅 */}
      <div
        className="card-jelly p-6 flex flex-col md:flex-row items-center gap-4 text-white"
        style={{
          background: 'linear-gradient(135deg, var(--color-purple) 0%, #9F58F8 100%)',
          border: '2px solid var(--color-purple-depth)',
          boxShadow: '0 8px 0 var(--color-purple-depth)',
        }}
      >
        <div style={{ fontSize: '48px' }} className="jelly-jump">👨‍👩‍👧</div>
        <div className="text-center md:text-left">
          <h2 className="text-xl font-black">家长陪伴站 🍀</h2>
          <p className="text-sm font-extrabold text-purple-50 opacity-90 mt-1">
            在这里，您可以绑定您家宝贝的登录账号，实时陪伴并查看孩子的每一次作业、手写答题笔迹，以及任课老师的红笔批改与成绩。
          </p>
        </div>
      </div>

      {!childId ? (
        renderBindForm()
      ) : (
        // 已绑定状态：展示学习报告
        <div className="flex flex-col gap-4">
          {/* 多孩切换 tab（仅在绑定超过一个孩子时显示） */}
          {children.length > 1 && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs font-extrabold text-gray-400">切换宝贝：</span>
              {children.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedChildId(c.id)}
                  className={`btn-3d font-black py-2 px-4 text-xs ${activeChildId === c.id ? 'btn-3d-purple' : ''}`}
                >
                  👧 {c.name}
                </button>
              ))}
            </div>
          )}

          <div className="flex justify-between items-center flex-wrap gap-2">
            <h3 className="text-lg font-black flex items-center gap-2 text-gray-800">
              <FileText size={22} className="text-purple-500" />
              <span>宝贝的快乐学习成长报告大厅 📊</span>
            </h3>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowBindForm((v) => !v)}
                className="btn-3d btn-3d-blue font-black py-1.5 px-3 text-xs"
                style={{ boxShadow: '0 3px 0 var(--color-blue-depth)' }}
              >
                {showBindForm ? '收起绑定' : '＋ 继续绑定另一个宝贝'}
              </button>
              <span className="badge-jelly text-xs font-black py-1.5 px-3" style={{ backgroundColor: '#FFFDF0', color: '#854D0E', borderColor: '#FDE047' }}>
                🌸 已锁定宝贝专属频道
              </span>
            </div>
          </div>

          {successMsg && (
            <div className="p-3 rounded-2xl border text-sm font-extrabold bg-green-50 border-green-200 text-green-600">
              🎉 {successMsg}
            </div>
          )}

          {showBindForm && renderBindForm()}

          {loading ? (
            <div className="flex flex-col items-center justify-center p-12">
              <div style={{ fontSize: '40px' }} className="jelly-jump">🍎</div>
              <span className="font-extrabold text-sm text-gray-400 mt-2">正在载入宝贝的历史足迹...</span>
            </div>
          ) : visibleReports.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {visibleReports.map((report) => {
                const isGraded = report.status === 'graded';
                return (
                  <div
                    key={report.submissionId}
                    className="card-jelly card-jelly-hover flex flex-col gap-4 justify-between bg-white"
                  >
                    <div>
                      <div className="flex justify-between items-start">
                        {children.length > 1 ? null : (
                          <span className="badge-jelly text-[10px] font-black py-0.5 px-2.5 mb-2" style={{ backgroundColor: '#F3E8FF', color: '#7E22CE', borderColor: '#E9D5FF' }}>
                            宝贝: {report.childName}
                          </span>
                        )}

                        {isGraded ? (
                          <span className="text-lg font-black text-red-500 bg-white border-2 border-red-300 rounded-2xl px-3 py-0.5 rotate-[-5deg] shadow-[0_3px_0_#FF8A93]">
                            💯 {report.score}分
                          </span>
                        ) : (
                          <span className="badge-jelly px-2.5 py-0.5 font-extrabold text-[10px] bg-yellow-50 text-yellow-600 border-yellow-200">
                            等待批改中 💤
                          </span>
                        )}
                      </div>

                      <h3 className="text-md font-black text-gray-800 mt-1">{report.examTitle}</h3>
                      <p className="text-[10px] text-gray-400 mt-2 font-extrabold">
                        提交时间: {new Date(report.submittedAt).toLocaleDateString()}
                      </p>

                      {isGraded && report.comment && (
                        <div className="mt-3 p-3 bg-yellow-50 border border-dashed border-yellow-300 rounded-xl text-xs font-extrabold text-gray-500">
                          👩‍🏫 老师有话说: "{report.comment}"
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => onViewReport(report.examId, report.studentId)}
                      className="btn-3d btn-3d-blue font-black py-2.5 w-full mt-3 text-xs"
                      style={{
                        boxShadow: '0 3px 0 var(--color-blue-depth)',
                      }}
                    >
                      <span>陪伴孩子查看红笔阅兵答卷 📖</span>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 card-jelly bg-white">
              <span style={{ fontSize: '48px' }}>🌱</span>
              <h4 className="font-black text-lg mt-2 text-gray-800">宝贝目前还没有提交任何答卷作业哦！</h4>
              <p className="text-sm text-gray-400 font-extrabold mt-1">请督促孩子按时完成老师发布的纸上涂鸦题吧！</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
