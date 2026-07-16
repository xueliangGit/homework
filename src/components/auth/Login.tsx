import React, { useState } from 'react';
import { api, authApi } from '../../api';
import { LogIn, UserPlus, Sparkles } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (user: any) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [isLogin, setIsLogin] = useState<boolean>(true);
  const [role, setRole] = useState<'teacher' | 'student' | 'parent'>('student');
  
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // P2-15 找回密码：学号 + 老师下发绑定码自助重置
  const [showReset, setShowReset] = useState<boolean>(false);
  const [resetUsername, setResetUsername] = useState<string>('');
  const [resetBindCode, setResetBindCode] = useState<string>('');
  const [resetNewP, setResetNewP] = useState<string>('');
  const [resetMsg, setResetMsg] = useState<string>('');

  // 智能纠正角色，根除注册死锁
  const switchMode = () => {
    setIsLogin(prev => {
      const nextIsLogin = !prev;
      if (!nextIsLogin && role === 'student') {
        setRole('teacher');
      }
      return nextIsLogin;
    });
    setErrorMsg('');
    setSuccessMsg('');
    setUsername('');
    setPassword('');
    setName('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setErrorMsg('要写完学号/账号和密码才能进去哦 ✏️');
      return;
    }

    setErrorMsg('');
    setLoading(true);

    try {
      const data = await api.post<{ token: string; user: any }>('/api/auth/login', {
        username,
        password,
      });
      
      localStorage.setItem('kaoshi_token', data.token);
      localStorage.setItem('kaoshi_user', JSON.stringify(data.user));
      
      onLoginSuccess(data.user);
    } catch (err: any) {
      setErrorMsg(err.message || '登录失败，请检查账号密码');
    } finally {
      setLoading(false);
    }
  };

  // P2-15 找回密码：学号 + 老师下发的绑定码自助重置
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUsername || !resetBindCode || !resetNewP) {
      setResetMsg('请把学号、绑定码和新密码都填上哦');
      return;
    }
    setResetMsg('');
    setLoading(true);
    try {
      const data = await authApi.resetPassword({
        username: resetUsername,
        bindCode: resetBindCode,
        newPassword: resetNewP,
      });
      setResetMsg('🎉 ' + (data.message || '密码已重置，去登录吧'));
      setTimeout(() => {
        setShowReset(false);
        setResetUsername('');
        setResetBindCode('');
        setResetNewP('');
      }, 1800);
    } catch (err: any) {
      setResetMsg(err.message || '找回失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || !name) {
      setErrorMsg('请把全部空格都填满再点我 ✏️');
      return;
    }

    if (role === 'student') {
      setErrorMsg('学生小朋友不能自己注册哦，快让老师给你们发账号吧！🎒');
      return;
    }

    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const data = await api.post<{ message: string }>('/api/auth/register', {
        username,
        password,
        role,
        name,
      });

      setSuccessMsg(data.message || '注册成功！正在为你跳回登录面...');
      setTimeout(() => {
        setIsLogin(true);
        setErrorMsg('');
        setSuccessMsg('');
        setPassword('');
      }, 2000);
    } catch (err: any) {
      setErrorMsg(err.message || '注册失败，请换一个用户名试试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-[85vh] px-4 py-8 relative">
      {/* 🪐 棉花糖慢速漂浮彩色发光球大背景 */}
      <div className="jelly-glow-bg-container">
        <div className="jelly-glow-ball-1" />
        <div className="jelly-glow-ball-2" />
      </div>

      {/* 🚀 3D 软糖塑料实体游戏盒登录卡 */}
      <div className="card-jelly login-card-double">
        
        {/* 🎨 左侧：温润樱花粉大卡纸底板 + 3D 萌宠恐龙呼吸浮游 Banner (Duolingo 史诗级美学) */}
        <div className="login-banner-left">
          {/* Logo 标题徽章 */}
          <div className="flex items-center gap-2.5 z-10">
            <span style={{ fontSize: '34px' }} className="jelly-jump">📚</span>
            <div className="flex flex-col">
              <span className="text-lg font-black tracking-widest text-gray-800 leading-none">快乐作业考试本</span>
              <span className="text-[9px] text-[#AFAFAF] font-black uppercase tracking-wider mt-1">DUOLINGO JELLY STYLE</span>
            </div>
          </div>

          {/* 吉祥物 3D 恐龙大插画 (注入 3D 微波浮动呼吸动画) */}
          <div className="z-10 flex flex-col items-center justify-center my-auto py-4 jelly-mascot-breath">
            <div className="relative">
              {/* 3D 霓虹温柔背光板 */}
              <div 
                style={{
                  position: 'absolute',
                  width: '260px',
                  height: '260px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255, 138, 147, 0.15)',
                  filter: 'blur(30px)',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 0,
                }}
              />
              <img 
                src="/cute_mascot.png" 
                alt="多邻国风格恐龙萌宠吉祥物" 
                className="w-64 h-64 object-contain relative z-10 transition-transform duration-500 hover:scale-105"
                style={{
                  filter: 'drop-shadow(0 20px 30px rgba(224, 108, 117, 0.15))',
                }}
              />
            </div>

            <div className="flex items-center gap-1.5 mt-5">
              <Sparkles size={16} className="text-yellow-500 fill-current animate-pulse" />
              <h3 className="text-xl font-black tracking-wide text-gray-800">
                写写画画，快乐闯关！
              </h3>
            </div>
            
            <p className="text-xs font-extrabold text-gray-500 leading-relaxed max-w-xs text-center mt-2.5 px-4">
              欢迎来到手写涂鸦世界！这里支持 PDF 文件魔法一键导入，红墨水随机小印章批阅，还有宝贝成长荣誉卡片分享哦！
            </p>
          </div>

          {/* 底部小水印 */}
          <div className="z-10 text-[10px] text-gray-400 font-extrabold tracking-wider pl-1 text-center sm:text-left">
            <span>📚 快乐教研少儿伴读频道 · 陪伴成长 ©2026</span>
          </div>
        </div>

        {/* 📝 右侧：舒缓大气的水果软糖登录表单 */}
        <div className="login-form-right">
          <h2 className="text-2xl font-black text-left mb-6 flex items-center gap-2 text-gray-800">
            {isLogin ? (
              <>
                <LogIn size={26} className="text-blue-500" />
                <span>进入快乐大本营 🎒</span>
              </>
            ) : (
              <>
                <UserPlus size={26} className="text-green-500" />
                <span>注册新助手 📝</span>
              </>
            )}
          </h2>

          {errorMsg && (
            <div 
              className="mb-5 p-4 rounded-2xl border text-sm animate-bounce" 
              style={{ backgroundColor: '#FFF5F5', borderColor: '#FFA3A3', color: '#E53E3E', fontWeight: 'bold' }}
            >
              🍎 {errorMsg}
            </div>
          )}

          {successMsg && (
            <div 
              className="mb-5 p-4 rounded-2xl border text-sm" 
              style={{ backgroundColor: '#F0FFF4', borderColor: '#9AE6B4', color: '#38A169', fontWeight: 'bold' }}
            >
              🎉 {successMsg}
            </div>
          )}

          <form onSubmit={isLogin ? handleLogin : handleRegister} className="flex flex-col gap-5">
            {/* 3D 水果软糖圆扣角色切换 (Jelly Dome Tabs) */}
            <div className="flex flex-col gap-2">
              <label className="font-extrabold text-xs text-gray-400">请选择您的身份：</label>
              <div className="grid grid-cols-3 gap-3">
                {(['student', 'teacher', 'parent'] as const).map((r) => {
                  const isSelected = role === r;
                  let label = '学生 🎒';
                  if (r === 'teacher') label = '老师 👩‍🏫';
                  if (r === 'parent') label = '家长 👨‍👩‍👧';
                  
                  const disabled = !isLogin && r === 'student';

                  // 针对不同角色选项卡注入专属的温和水果高亮配色与按压厚度影子变量
                  const customStyles = isSelected ? {
                    '--border-color': 
                      r === 'student' ? 'var(--color-primary-depth)' :
                      r === 'teacher' ? 'var(--color-secondary-depth)' : 'var(--color-purple-depth)',
                    '--tab-bg':
                      r === 'student' ? 'var(--color-primary)' :
                      r === 'teacher' ? 'var(--color-secondary)' : 'var(--color-purple)',
                    '--tab-text': '#FFFFFF',
                    '--shadow-color':
                      r === 'student' ? 'var(--color-primary-depth)' :
                      r === 'teacher' ? 'var(--color-secondary-depth)' : 'var(--color-purple-depth)',
                  } as React.CSSProperties : undefined;

                  return (
                    <button
                      key={r}
                      type="button"
                      disabled={disabled}
                      onClick={() => setRole(r)}
                      className={`btn-jelly-tab ${disabled ? 'btn-3d-disabled' : ''}`}
                      style={customStyles}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 姓名输入（仅限注册时展示，升级为 3D 凹陷槽） */}
            {!isLogin && (
              <div className="flex flex-col gap-1.5 mt-1">
                <label className="font-extrabold text-xs text-gray-400">称呼 / 真实姓名：</label>
                <input
                  type="text"
                  placeholder={role === 'teacher' ? '如：王老师' : '如：小明妈妈'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-jelly-inset text-sm"
                  required
                />
              </div>
            )}

            {/* 账号 (升级为 3D 凹陷槽) */}
            <div className="flex flex-col gap-1.5">
              <label className="font-extrabold text-xs text-gray-400">登录账号 / 学号：</label>
              <input
                type="text"
                placeholder={isLogin ? "请输入学号或账号" : "请输入唯一的英文或数字账号"}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-jelly-inset text-sm"
                required
              />
            </div>

            {/* 密码 (升级为 3D 凹陷槽) */}
            <div className="flex flex-col gap-1.5">
              <label className="font-extrabold text-xs text-gray-400">登录密码：</label>
              <input
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-jelly-inset text-sm"
                required
              />
            </div>

            {/* 3D 蜜桔软糖大提交按钮 */}
            <button
              type="submit"
              disabled={loading}
              className="btn-3d font-black py-4 mt-3 text-sm shadow-md"
              style={{
                fontSize: '15px',
                backgroundColor: 'var(--color-orange)',
                borderColor: 'var(--color-orange-depth)',
                color: '#FFFFFF',
                boxShadow: '0 6px 0 var(--color-orange-depth)',
              }}
            >
              {loading ? '飞速加载中...' : isLogin ? '快乐出发 🚀' : '立即注册 📝'}
            </button>
          </form>

          {/* 翻转切换 */}
          <div className="text-center mt-6 border-t border-dashed border-gray-200 pt-5 flex flex-col gap-3">
            <button
              type="button"
              onClick={switchMode}
              className="text-xs font-black text-gray-500 hover:text-blue-500 cursor-pointer bg-transparent border-none underline transition-colors"
            >
              {isLogin ? '没有账号？家长或老师点这里注册 ✏' : '已有账号？去登录大厅吧 🎒'}
            </button>

            {isLogin && (
              <>
                <button
                  type="button"
                  onClick={() => setShowReset(v => !v)}
                  className="text-xs font-black text-blue-500 hover:text-blue-700 cursor-pointer bg-transparent border-none underline transition-colors"
                >
                  忘记密码？用学号 + 绑定码找回 🔑
                </button>

                {showReset && (
                  <form onSubmit={handleReset} className="flex flex-col gap-3 mt-2 p-4 bg-amber-50 rounded-2xl border border-amber-200 text-left">
                    <input
                      type="text"
                      placeholder="学号"
                      value={resetUsername}
                      onChange={(e) => setResetUsername(e.target.value)}
                      className="input-jelly text-sm"
                      required
                    />
                    <input
                      type="text"
                      placeholder="绑定码（老师下发，6 位）"
                      value={resetBindCode}
                      onChange={(e) => setResetBindCode(e.target.value.toUpperCase())}
                      className="input-jelly text-sm"
                      maxLength={6}
                      required
                    />
                    <input
                      type="password"
                      placeholder="新密码（至少 4 位）"
                      value={resetNewP}
                      onChange={(e) => setResetNewP(e.target.value)}
                      className="input-jelly text-sm"
                      required
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="btn-3d font-black py-2.5 text-sm"
                      style={{ backgroundColor: 'var(--color-orange)', borderColor: 'var(--color-orange-depth)', color: '#fff', boxShadow: '0 4px 0 var(--color-orange-depth)' }}
                    >
                      {loading ? '重置中...' : '重置密码 🔑'}
                    </button>
                    {resetMsg && (
                      <div className={`p-2.5 rounded-xl border text-xs font-extrabold ${resetMsg.startsWith('🎉') ? 'bg-green-50 border-green-200 text-green-600' : 'bg-red-50 border-red-200 text-red-600'}`}>
                        {resetMsg}
                      </div>
                    )}
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
