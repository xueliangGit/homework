import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { db, Class, User } from '../db';
import { AuthRequest } from '../middleware/auth';

// 教师：导出某班级的成绩汇总（供前端生成 Excel / PDF）
export const exportClassGrades = async (req: AuthRequest, res: Response) => {
  const { classId } = req.params;
  const teacherId = req.user!.id;
  try {
    const classes = await db.getCollection('classes');
    const target = classes.find((c) => c.id === classId && c.teacherId === teacherId);
    if (!target) return res.status(404).json({ message: '未找到该班级' });

    const exams = (await db.getCollection('exams')) as any[];
    const classExamIds = exams.filter((e) => e.classId === classId).map((e) => e.id);
    const submissions = (await db.getCollection('submissions')) as any[];
    const users = await db.getCollection('users');

    const rows = target.studentIds.map((sid) => {
      const student = users.find((u) => u.id === sid);
      // 取该生在本班最新的已提交记录
      const subs = submissions
        .filter((s) => s.studentId === sid && classExamIds.includes(s.examId))
        .sort((a: any, b: any) => (b.submittedAt || 0) - (a.submittedAt || 0));
      const latest = subs[0];
      return {
        studentName: student?.name || '未知',
        username: student?.username || '',
        status: latest ? latest.status : 'unstarted',
        score: latest?.score ?? null,
        comment: latest?.comment || '',
        submittedAt: latest?.submittedAt || null,
        gradedAt: latest?.gradedAt || null,
        dimensionScores: latest?.dimensionScores || null,
        shareCode: latest?.shareCode || '',
      };
    });

    res.json({ data: { className: target.name, rows } });
  } catch (e) {
    console.error('导出成绩错误：', e);
    res.status(500).json({ message: '导出失败' });
  }
};

const generateId = () => Math.random().toString(36).substring(2, 11);

export const createClass = async (req: AuthRequest, res: Response) => {
  const { name } = req.body;
  const teacherId = req.user!.id;

  if (!name) {
    return res.status(400).json({ message: '班级名称不能为空' });
  }

  try {
    const classes = await db.getCollection('classes');
    
    // 检查是否已有同名班级
    const existClass = classes.find(c => c.name === name && c.teacherId === teacherId);
    if (existClass) {
      return res.status(400).json({ message: '您已创建过同名班级，换个名字吧' });
    }

    const newClass: Class = {
      id: generateId(),
      name,
      teacherId,
      studentIds: [],
    };

    classes.push(newClass);
    await db.saveCollection('classes', classes);

    res.status(201).json({ message: '班级创建成功！', data: newClass });
  } catch (error) {
    console.error('创建班级错误：', error);
    res.status(500).json({ message: '创建班级失败，请稍后重试' });
  }
};

export const getClasses = async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const role = req.user!.role;

  try {
    const classes = await db.getCollection('classes');
    
    if (role === 'teacher') {
      // 教师返回其创建的班级，并附带班级里的学生详情
      const teacherClasses = classes.filter(c => c.teacherId === userId);
      const users = await db.getCollection('users');
      
      const detailedClasses = teacherClasses.map(c => {
        const students = c.studentIds.map(sid => {
          const u = users.find(user => user.id === sid);
          return u ? { id: u.id, username: u.username, name: u.name, bindCode: u.bindCode } : null;
        }).filter(Boolean);

        return { ...c, students };
      });

      return res.json(detailedClasses);
    } else if (role === 'student') {
      // 学生返回其加入的班级
      const studentClasses = classes.filter(c => c.studentIds.includes(userId));
      return res.json(studentClasses);
    } else {
      return res.status(403).json({ message: '家长角色无法直接获取班级列表' });
    }
  } catch (error) {
    console.error('获取班级错误：', error);
    res.status(500).json({ message: '获取班级列表失败，请稍后重试' });
  }
};

export const addStudentToClass = async (req: AuthRequest, res: Response) => {
  const { classId } = req.params;
  const { name, username, password } = req.body;
  const teacherId = req.user!.id;

  if (!name || !username || !password) {
    return res.status(400).json({ message: '请提供学生姓名、学号账号和登录密码' });
  }

  try {
    const classes = await db.getCollection('classes');
    const targetClass = classes.find(c => c.id === classId && c.teacherId === teacherId);

    if (!targetClass) {
      return res.status(404).json({ message: '未找到指定班级，或您不是该班级的任课老师' });
    }

    const users = await db.getCollection('users');
    const existUser = users.find(u => u.username === username);

    if (existUser) {
      return res.status(400).json({ message: '该学生账号/学号已被注册，请更换一个唯一的账号' });
    }

    // 1. 创建学生用户（同时生成 6 位绑定码，供家长安全绑定，防止串绑）
    const passwordHash = await bcrypt.hash(password, 10);
    const bindCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newStudent: User = {
      id: generateId(),
      username,
      passwordHash,
      role: 'student',
      name,
      bindCode,
    };

    users.push(newStudent);
    await db.saveCollection('users', users);

    // 2. 将学生加入班级
    targetClass.studentIds.push(newStudent.id);
    await db.saveCollection('classes', classes);

    res.status(201).json({
      message: `成功为学生【${name}】创建账号并加入班级！`,
      student: {
        id: newStudent.id,
        username: newStudent.username,
        name: newStudent.name,
      },
    });
  } catch (error) {
    console.error('添加学生错误：', error);
    res.status(500).json({ message: '添加学生失败，请稍后重试' });
  }
};
