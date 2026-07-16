import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, User, generateStudentUsername } from '../db';
import { JWT_SECRET, AuthRequest } from '../middleware/auth';

const generateId = () => Math.random().toString(36).substring(2, 11);

export const register = async (req: Request, res: Response) => {
  const { username, password, role, name } = req.body;

  if (!username || !password || !role || !name) {
    return res.status(400).json({ message: '请提供完整的注册信息' });
  }

  if (role === 'student') {
    return res.status(400).json({ message: '学生账号请由班级老师直接添加生成，无需自行注册' });
  }

  try {
    const users = await db.getCollection('users');
    const existUser = users.find(u => u.username === username);
    if (existUser) {
      return res.status(400).json({ message: '该用户名已被使用，请换一个吧' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser: User = {
      id: generateId(),
      username,
      passwordHash,
      role: role as 'teacher' | 'parent',
      name,
    };

    users.push(newUser);
    await db.saveCollection('users', users);

    res.status(201).json({ message: '注册成功！快去登录吧' });
  } catch (error) {
    console.error('注册错误：', error);
    res.status(500).json({ message: '注册失败，请稍后重试' });
  }
};

export const login = async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: '请提供用户名和密码' });
  }

  try {
    const user = await db.findUserByUsername(username);
    if (!user) {
      return res.status(400).json({ message: '用户名或密码不正确' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ message: '用户名或密码不正确' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
        childId: user.childId,
        childIds: user.childIds,
        mustChangePassword: user.mustChangePassword || false,
      },
    });
  } catch (error) {
    console.error('登录错误：', error);
    res.status(500).json({ message: '登录失败，请稍后重试' });
  }
};

export const getMe = async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!authReq.user) {
    return res.status(401).json({ message: '未登录' });
  }

  try {
    const user = await db.findUserById(authReq.user.id);
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      childId: user.childId,
      childIds: user.childIds,
    });
  } catch (error) {
    console.error('获取用户信息错误：', error);
    res.status(500).json({ message: '获取用户信息失败' });
  }
};

export const parentBindChild = async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { childUsername, bindCode } = req.body;

  if (!childUsername || !bindCode) {
    return res.status(400).json({ message: '请提供您孩子的登录账号和绑定码' });
  }

  try {
    const users = await db.getCollection('users');
    const child = users.find(u => u.username === childUsername && u.role === 'student');

    if (!child) {
      return res.status(404).json({ message: '未找到该学生账号，请核对学号/账号是否输入正确' });
    }

    // 安全校验：绑定码必须匹配（由教师下发），防止家长串绑他人孩子
    if (!child.bindCode || child.bindCode !== String(bindCode).trim().toUpperCase()) {
      return res.status(403).json({ message: '绑定码不正确，请向孩子的老师索取正确的绑定码' });
    }

    const parent = users.find(u => u.id === authReq.user!.id);
    if (!parent) {
      return res.status(404).json({ message: '当前家长账户不存在' });
    }

    // 多孩：把新孩子追加进 childIds（去重），同时保留 childId 兼容旧端
    const childIds = Array.isArray(parent.childIds) ? [...parent.childIds] : [];
    if (!childIds.includes(child.id)) childIds.push(child.id);
    parent.childIds = childIds;
    parent.childId = childIds[childIds.length - 1]; // 最新绑定者作为默认单孩字段
    await db.saveCollection('users', users);

    res.json({
      message: `成功绑定孩子：${child.name}！`,
      childId: child.id,
      childIds,
    });
  } catch (error) {
    console.error('绑定孩子错误：', error);
    res.status(500).json({ message: '绑定失败，请稍后重试' });
  }
};

// 学生首次登录后强制改密（P2-15）
export const changePassword = async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: '请填写旧密码和新密码' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ message: '新密码至少 4 位哦' });
  }
  try {
    const users = await db.getCollection('users');
    const user = users.find(u => u.id === authReq.user!.id);
    if (!user) return res.status(404).json({ message: '用户不存在' });
    const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isMatch) return res.status(400).json({ message: '旧密码不正确' });
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.mustChangePassword = false;
    await db.saveCollection('users', users);
    res.json({ message: '密码修改成功！下次用新密码登录即可 🔑' });
  } catch (error) {
    console.error('改密错误：', error);
    res.status(500).json({ message: '修改密码失败，请稍后重试' });
  }
};

// 找回密码（P2-15）：学号 + 老师下发的绑定码，自助重置
export const resetPassword = async (req: Request, res: Response) => {
  const { username, bindCode, newPassword } = req.body;
  if (!username || !bindCode || !newPassword) {
    return res.status(400).json({ message: '请填写学号、绑定码和新密码' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ message: '新密码至少 4 位哦' });
  }
  try {
    const users = await db.getCollection('users');
    const child = users.find(u => u.username === username && u.role === 'student');
    if (!child) return res.status(404).json({ message: '未找到该学生账号' });
    if (!child.bindCode || child.bindCode !== String(bindCode).trim().toUpperCase()) {
      return res.status(403).json({ message: '绑定码不正确，请向老师索取正确的绑定码' });
    }
    child.passwordHash = await bcrypt.hash(newPassword, 10);
    await db.saveCollection('users', users);
    res.json({ message: '密码已重置成功，现在可以用新密码登录啦 🔑' });
  } catch (error) {
    console.error('找回密码错误：', error);
    res.status(500).json({ message: '重置失败，请稍后重试' });
  }
};

// 学号查重：返回该学号是否可用（实时查重用，P2-学生账号体验）
export const checkUsername = async (req: Request, res: Response) => {
  const username = String(req.query.username || '').trim();
  if (!username) return res.status(400).json({ message: '请提供要检查的学号' });
  try {
    const users = await db.getCollection('users');
    const taken = users.some((u: any) => u.username === username);
    res.json({ data: { available: !taken } });
  } catch (error) {
    console.error('查重错误：', error);
    res.status(500).json({ message: '检查学号失败，请稍后重试' });
  }
};

// 学号自动生成：返回一个全局唯一的学号建议（P2-学生账号体验）
export const suggestUsername = async (req: Request, res: Response) => {
  try {
    const users = await db.getCollection('users');
    const username = generateStudentUsername(users);
    res.json({ data: { username } });
  } catch (error) {
    console.error('生成学号错误：', error);
    res.status(500).json({ message: '生成学号失败，请稍后重试' });
  }
};
