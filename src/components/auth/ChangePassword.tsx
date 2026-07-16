import React, { useState } from 'react';
import { authApi } from '../../api';

interface ChangePasswordProps {
  user: any;
  onChanged: () => void;
}

// 学生首次登录强制改密（P2-15）：用老师下发的初始密码登录后，必须设置自己的新密码
export const ChangePassword: React.FC<ChangePasswordProps> = ({ user, onChanged }) => {
  const [oldP, setOldP] = useState<string>('');
  const [newP, setNewP] = useState<string>('');
  const [err, setErr] = useState<string>('');
  const [ok, setOk] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldP || !newP) {
      setErr('请填写旧密码和新密码哦');
      return;
    }
    setErr('');
    setOk('');
    setLoading(true);
    try {
      await authApi.changePassword({ oldPassword: oldP, newPassword: newP });
      setOk('密码修改成功！马上就能继续使用啦 🔑');
      setTimeout(() => {
        const updated = { ...user, mustChangePassword: false };
        localStorage.setItem('kaoshi_user', JSON.stringify(updated));
        onChanged();
      }, 1200);
    } catch (e: any) {
      setErr(e.message || '修改失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-[85vh] px-4">
      <div className="card-jelly bg-white w-full max-w-[420px] p-8 flex flex-col gap-5">
        <div className="text-center">
          <div style={{ fontSize: '40px' }} className="jelly-jump">🔑</div>
          <h2 className="text-xl font-black mt-2 text-gray-800">首次登录，先设置你的专属密码</h2>
          <p className="text-xs text-gray-400 font-extrabold mt-1">
            {user.name}，先用一下老师给的初始密码，然后换成你自己记得住的密码吧~
          </p>
        </div>

        {err && (
          <div className="p-3 rounded-2xl border text-sm font-extrabold bg-red-50 border-red-200 text-red-600">
            🍎 {err}
          </div>
        )}
        {ok && (
          <div className="p-3 rounded-2xl border text-sm font-extrabold bg-green-50 border-green-200 text-green-600">
            🎉 {ok}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="password"
            placeholder="旧密码（老师给的初始密码）"
            value={oldP}
            onChange={(e) => setOldP(e.target.value)}
            className="input-jelly text-sm"
            required
          />
          <input
            type="password"
            placeholder="新密码（至少 4 位）"
            value={newP}
            onChange={(e) => setNewP(e.target.value)}
            className="input-jelly text-sm"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="btn-3d font-black py-3 text-sm"
            style={{
              fontSize: '15px',
              backgroundColor: 'var(--color-orange)',
              borderColor: 'var(--color-orange-depth)',
              color: '#FFFFFF',
              boxShadow: '0 5px 0 var(--color-orange-depth)',
            }}
          >
            {loading ? '保存中...' : '设置新密码 🔑'}
          </button>
        </form>
      </div>
    </div>
  );
};
