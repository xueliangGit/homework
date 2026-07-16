import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { db, Class, User, generateStudentUsername } from '../db';
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
  const { name, username, password, addExisting } = req.body;
  const teacherId = req.user!.id;

  try {
    const classes = await db.getCollection('classes');
    const targetClass = classes.find(c => c.id === classId && c.teacherId === teacherId);

    if (!targetClass) {
      return res.status(404).json({ message: '未找到指定班级，或您不是该班级的任课老师' });
    }

    const users = await db.getCollection('users');

    // 学号留空时自动生成全局唯一学号（P2-学生账号体验）
    let finalUsername = (username || '').trim();
    if (!finalUsername) {
      finalUsername = generateStudentUsername(users);
    }

    const existUser = users.find(u => u.username === finalUsername);

    if (existUser) {
      if (existUser.role !== 'student') {
        return res.status(400).json({ message: '该账号不是学生账号，无法加入班级' });
      }
      if (addExisting) {
        // 显式「并入已有账号」：允许跨班（如兴趣班）共用同一学生
        if (targetClass.studentIds.includes(existUser.id)) {
          return res.status(400).json({ message: '该学生已经在班级里啦，无需重复添加' });
        }
        targetClass.studentIds.push(existUser.id);
        await db.saveCollection('classes', classes);
        return res.status(200).json({
          message: `已将已有学生【${existUser.name}】并入本班！该生现在同时属于多个班级 ✅`,
          student: { id: existUser.id, username: existUser.username, name: existUser.name },
        });
      }
      // 新建账号却撞号：明确报错，不再静默并入（P2-学生账号体验）
      return res.status(400).json({
        message: `学号「${finalUsername}」已被其他同学占用啦，请换一个，或勾选"已有账号"并入本班`,
      });
    }

    // 1. 创建学生用户（同时生成 6 位绑定码，供家长安全绑定，防止串绑）
    if (!name || !password) {
      return res.status(400).json({ message: '请提供学生姓名和登录密码' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const bindCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newStudent: User = {
      id: generateId(),
      username: finalUsername,
      passwordHash,
      role: 'student',
      name,
      bindCode,
      mustChangePassword: true, // P2-15 首次登录强制改密
    };

    users.push(newStudent);
    await db.saveCollection('users', users);

    // 2. 将学生加入班级
    targetClass.studentIds.push(newStudent.id);
    await db.saveCollection('classes', classes);

    const autoGen = finalUsername !== (username || '').trim();
    res.status(201).json({
      message: `成功为学生【${name}】创建账号并加入班级！${autoGen ? `系统已自动生成学号：${finalUsername}` : ''}`,
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

// 教师：将学生移出班级（退班）。仅移除班级关联，不删除学生账号。
export const removeStudentFromClass = async (req: AuthRequest, res: Response) => {
  const { classId, studentId } = req.params;
  const teacherId = req.user!.id;

  try {
    const classes = await db.getCollection('classes');
    const targetClass = classes.find(c => c.id === classId && c.teacherId === teacherId);
    if (!targetClass) {
      return res.status(404).json({ message: '未找到指定班级，或您不是该班级的任课老师' });
    }
    if (!targetClass.studentIds.includes(studentId)) {
      return res.status(404).json({ message: '该学生不在本班级中' });
    }

    targetClass.studentIds = targetClass.studentIds.filter(id => id !== studentId);
    await db.saveCollection('classes', classes);
    res.json({ message: '已将学生移出本班级 ✅' });
  } catch (error) {
    console.error('移除学生错误：', error);
    res.status(500).json({ message: '移出学生失败，请稍后重试' });
  }
};
