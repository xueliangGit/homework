import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, User } from '../db';
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

    parent.childId = child.id;
    await db.saveCollection('users', users);

    res.json({
      message: `成功绑定孩子：${child.name}！`,
      childId: child.id,
    });
  } catch (error) {
    console.error('绑定孩子错误：', error);
    res.status(500).json({ message: '绑定失败，请稍后重试' });
  }
};
