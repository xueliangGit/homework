import fs from 'fs';
import path from 'path';

// 轻量加载 .env（不引入额外依赖）：在导入其他模块前于 index.ts 顶部执行，
// 确保 JWT_SECRET / CORS_ORIGIN 等环境变量在其他模块读取前就绪。
try {
  const envPath = path.join(process.cwd(), '.env');
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
} catch {
  // 无 .env 文件时忽略，使用代码内默认值
}

export {};
