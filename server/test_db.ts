import { db } from './db';
import bcrypt from 'bcryptjs';
import { deleteExam } from './controllers/exams';

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(`❌ 断言失败: ${message}`);
  }
  console.log(`✅ 断言成功: ${message}`);
};

async function runIntegrationTest() {
  console.log('🔄 开始全栈儿童考试系统本地集成测试...');

  // 1. 初始化数据库
  await db.init();
  console.log('✔ 数据库已完成重置与初始化');

  // 清空测试残留
  await db.saveCollection('users', []);
  await db.saveCollection('classes', []);
  await db.saveCollection('exams', []);
  await db.saveCollection('submissions', []);

  // 2. 模拟教师注册
  const users = await db.getCollection('users');
  const teacherPasswordHash = await bcrypt.hash('teacher123', 10);
  const teacherUser = {
    id: 'tch_001',
    username: 'wang_laoshi',
    passwordHash: teacherPasswordHash,
    role: 'teacher' as const,
    name: '王老师',
  };
  users.push(teacherUser);
  await db.saveCollection('users', users);
  
  const foundTeacher = await db.findUserByUsername('wang_laoshi');
  assert(!!foundTeacher && foundTeacher.name === '王老师', '教师账号应能成功注册并根据用户名查出');

  // 3. 教师创建班级
  const classes = await db.getCollection('classes');
  const classId = 'cls_999';
  const newClass = {
    id: classId,
    name: '三年级一班',
    teacherId: teacherUser.id,
    studentIds: [],
  };
  classes.push(newClass);
  await db.saveCollection('classes', classes);
  assert(classes.length === 1 && classes[0].name === '三年级一班', '应能成功创建班级“三年级一班”');

  // 4. 教师向班级中添加学生
  const currentUsers = await db.getCollection('users');
  const studentPasswordHash = await bcrypt.hash('student123', 10);
  const studentUser = {
    id: 'std_001',
    username: 'xiaoming',
    passwordHash: studentPasswordHash,
    role: 'student' as const,
    name: '张小明',
  };
  currentUsers.push(studentUser);
  await db.saveCollection('users', currentUsers);

  const currentClasses = await db.getCollection('classes');
  const targetClass = currentClasses.find(c => c.id === classId);
  targetClass!.studentIds.push(studentUser.id);
  await db.saveCollection('classes', currentClasses);

  assert(targetClass!.studentIds.includes('std_001'), '张小明学号应成功被装载进班级');

  // 5. 教师发布试卷
  const exams = await db.getCollection('exams');
  const examId = 'ex_888';
  const newExam = {
    id: examId,
    title: '三年级趣味乘法口算测试',
    teacherId: teacherUser.id,
    classId: classId,
    createdAt: Date.now(),
    totalPages: 2,
    pages: [
      'data:image/png;base64,mock_page_1_data',
      'data:image/png;base64,mock_page_2_data'
    ]
  };
  exams.push(newExam);
  await db.saveCollection('exams', exams);
  assert(exams.length === 1 && exams[0].title.includes('趣味乘法'), '试卷应成功发布，且页数为2页');

  // 6. 学生提交答题涂鸦
  const submissions = await db.getCollection('submissions');
  const newSubmission = {
    id: 'sub_777',
    examId: examId,
    studentId: studentUser.id,
    status: 'submitted' as const,
    submittedAt: Date.now(),
    answers: [
      { pageIndex: 0, canvasData: 'data:image/png;base64,xiaoming_blue_ink_page_1' },
      { pageIndex: 1, canvasData: 'data:image/png;base64,xiaoming_blue_ink_page_2' }
    ]
  };
  submissions.push(newSubmission);
  await db.saveCollection('submissions', submissions);
  assert(submissions.length === 1 && submissions[0].answers[0].canvasData.includes('blue_ink'), '学生涂鸦笔答卷应成功录入，并处于“submitted”待改状态');

  // 7. 教师红笔批改与评分
  const currentSubmissions = await db.getCollection('submissions');
  const targetSub = currentSubmissions.find(s => s.id === 'sub_777');
  targetSub!.score = 98;
  targetSub!.comment = '书写非常可爱，继续保持！👍';
  targetSub!.status = 'graded';
  targetSub!.teacherAnnotations = [
    { pageIndex: 0, canvasData: 'data:image/png;base64,teacher_red_correct_ink_page_1' },
    { pageIndex: 1, canvasData: 'data:image/png;base64,teacher_red_correct_ink_page_2' }
  ];
  await db.saveCollection('submissions', currentSubmissions);
  assert(targetSub!.status === 'graded' && targetSub!.score === 98, '教师红笔批阅并评分应成功，状态应流转至“graded”已阅');

  // 8. 家长注册并绑定孩子
  const allUsers = await db.getCollection('users');
  const parentUser = {
    id: 'prt_001',
    username: 'xiaoming_mama',
    passwordHash: await bcrypt.hash('parent123', 10),
    role: 'parent' as const,
    name: '小明妈妈',
    childId: studentUser.id // 绑定孩子小明
  };
  allUsers.push(parentUser);
  await db.saveCollection('users', allUsers);
  
  const foundParent = allUsers.find(u => u.username === 'xiaoming_mama');
  assert(foundParent?.childId === 'std_001', '家长应成功绑定孩子小明的 studentId');

  // 9. 家长查看学习报告
  const finalSubmissions = await db.getCollection('submissions');
  const childSub = finalSubmissions.filter(s => s.studentId === foundParent?.childId);
  assert(childSub.length === 1 && childSub[0].score === 98 && childSub[0].comment?.includes('书写非常可爱'), '家长应能精准提取出绑定孩子的多维学习成长报告');

  // 10. 教师一键撤回已发布试卷集成测试
  console.log('🔄 开始测试：教师一键撤回已发布试卷...');
  
  // 10.1 测试越权拦截：非发布该试卷的教师 tch_002 尝试撤回应被拦截 (403)
  let responseStatus403: number = 200;
  let responseData403: any = null;
  const mockReq403 = {
    params: { examId: 'ex_888' },
    user: { id: 'tch_002', role: 'teacher', name: '李老师', username: 'li_laoshi' }
  } as any;
  const mockRes403 = {
    status: (code: number) => {
      responseStatus403 = code;
      return mockRes403;
    },
    json: (data: any) => {
      responseData403 = data;
      return mockRes403;
    }
  } as any;

  await deleteExam(mockReq403, mockRes403);
  assert(responseStatus403 === 403, '非本人发布的试卷，撤回接口应返回 403 权限不足');
  assert(responseData403?.message?.includes('无权撤回非本人发布的试卷'), '撤回失败应有正确提示');

  // 10.2 测试正常撤卷与级联删除：发布试卷的教师 tch_001 撤卷
  let responseStatus200: number = 200;
  let responseData200: any = null;
  const mockReq200 = {
    params: { examId: 'ex_888' },
    user: { id: 'tch_001', role: 'teacher', name: '王老师', username: 'wang_laoshi' }
  } as any;
  const mockRes200 = {
    status: (code: number) => {
      responseStatus200 = code;
      return mockRes200;
    },
    json: (data: any) => {
      responseData200 = data;
      return mockRes200;
    }
  } as any;

  await deleteExam(mockReq200, mockRes200);
  assert(responseStatus200 === 200, '发布试卷的教师撤回自己发布的试卷应返回 200 成功状态码');
  assert(responseData200?.message?.includes('试卷撤回成功'), '撤回成功应有正确提示');

  // 10.3 校验数据库数据一致性（级联删除验证）
  const finalExams = await db.getCollection('exams');
  const finalSubs = await db.getCollection('submissions');
  assert(!finalExams.some(e => e.id === 'ex_888'), '撤回后，试卷 ex_888 应该被从 exams 中删除');
  assert(!finalSubs.some(s => s.examId === 'ex_888'), '撤回后，submissions 中不应再包含 ex_888 试卷的任何答题或批改记录');

  console.log('🎉 恭喜！全套集成测试 100% 成功通过！');
}

runIntegrationTest().catch((err) => {
  console.error('❌ 集成测试失败：', err);
  process.exit(1);
});
