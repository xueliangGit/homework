// 统一封装原生 Fetch API，实现轻量级 API 请求客户端
const BASE_URL = '';

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const token = localStorage.getItem('kaoshi_token');
  
  // 默认头配置
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    options.body = JSON.stringify(options.body);
  }

  // 拼接 query 参数
  let finalUrl = url;
  if (options.params) {
    const searchParams = new URLSearchParams(options.params);
    finalUrl += `?${searchParams.toString()}`;
  }

  const response = await fetch(`${BASE_URL}${finalUrl}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // 鉴权失效，清除 token 并跳转
    localStorage.removeItem('kaoshi_token');
    localStorage.removeItem('kaoshi_user');
    window.dispatchEvent(new Event('auth_change'));
    throw new Error('登录会话已过期，请重新登录 ✏️');
  }

  const data = await response.json();

  if (!response.ok) {
    const err: any = new Error(data.message || '网络连接有些不听话，请稍后再试一次吧！');
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data as T;
}

export const api = {
  get: <T>(url: string, params?: Record<string, string>, options?: RequestOptions) => 
    request<T>(url, { ...options, method: 'GET', params }),
    
  post: <T>(url: string, body?: any, options?: RequestOptions) => 
    request<T>(url, { ...options, method: 'POST', body }),
    
  put: <T>(url: string, body?: any, options?: RequestOptions) => 
    request<T>(url, { ...options, method: 'PUT', body }),
    
  delete: <T>(url: string, options?: RequestOptions) => 
    request<T>(url, { ...options, method: 'DELETE' }),
};

// 预存试卷库
export const papersApi = {
  list: () => api.get<{ data: any[] }>('/api/papers'),
  archived: () => api.get<{ data: any[] }>('/api/papers/archived'),
  get: (id: string) => api.get<{ data: any }>(`/api/papers/${id}`),
  create: (body: any) => api.post<{ data: any }>('/api/papers', body),
  update: (id: string, body: any) => api.put<{ data: any }>(`/api/papers/${id}`, body),
  remove: (id: string) => api.delete(`/api/papers/${id}`),
  restore: (id: string) => api.post(`/api/papers/${id}/restore`),
};

// 发布作业 / 时限策略
export const assignmentsApi = {
  publish: (body: any) => api.post<any>('/api/assignments', body),
  list: () => api.get<{ data: any[] }>('/api/assignments'),
  close: (id: string) => api.post(`/api/assignments/${id}/close`),
  reopen: (id: string) => api.post(`/api/assignments/${id}/reopen`),
};

// 班级（教师用于发布作业时选择）
export const classesApi = {
  list: () => api.get<any[]>('/api/classes'),
  exportGrades: (classId: string) => api.get<{ data: { className: string; rows: any[] } }>(`/api/classes/${classId}/export`),
  // 将已有学生并入本班（多班/跨兴趣班场景）：仅传学号，显式标记 addExisting
  addExisting: (classId: string, username: string) => api.post<any>(`/api/classes/${classId}/students`, { username, addExisting: true }),
  // 将学生移出班级（退班）
  removeStudent: (classId: string, studentId: string) => api.delete(`/api/classes/${classId}/students/${studentId}`),
};

// 学生作答：提交 / 云端草稿自动存盘
export const examsApi = {
  submit: (examId: string, body: any) => api.post<any>(`/api/exams/${examId}/submit`, body),
  saveDraft: (examId: string, body: any) => api.post<any>(`/api/exams/${examId}/draft`, body),
};

// 鉴权：改密 / 找回（P2-15）
export const authApi = {
  changePassword: (body: { oldPassword: string; newPassword: string }) =>
    api.post<any>('/api/auth/change-password', body),
  resetPassword: (body: { username: string; bindCode: string; newPassword: string }) =>
    api.post<any>('/api/auth/reset-password', body),
};

// 教师作业统计（待批改 / 迟交角标，P2-12）
export const statsApi = {
  teacher: () =>
    api.get<{
      stats: Record<string, { pending: number; late: number }>;
      totalPending: number;
      totalLate: number;
    }>('/api/teacher/stats'),
};

// 全链路操作留痕
export const logsApi = {
  list: () => api.get<{ data: any[] }>('/api/logs'),
};

// 学号：查重 + 自动生成建议（教师端添加学生用，P2-学生账号体验）
export const usersApi = {
  checkUsername: (username: string) =>
    api.get<{ data: { available: boolean } }>('/api/users/check-username', { username }),
  suggestUsername: () =>
    api.get<{ data: { username: string } }>('/api/users/suggest-username'),
};
