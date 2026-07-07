import { jsPDF } from 'jspdf';

export interface ReportCardInput {
  studentName: string;
  score: number;
  comment: string;
  examTitle: string;
  submittedAt?: number;
  dimensionScores?: { key: string; label: string; score: number; full: number }[];
  shareCode?: string;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 绘制超清 1080x1920 竖版成长荣誉明信片（含能力雷达图 + 防伪分享码）
export function drawReportCardCanvas(input: ReportCardInput): HTMLCanvasElement {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // 背景渐变
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#FFE8EC');
  bg.addColorStop(1, '#E0F2FE');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 白色内卡
  const m = 50;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, m, m, W - 2 * m, H - 2 * m, 40);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 标题
  ctx.fillStyle = '#2D3748';
  ctx.font = 'bold 44px "Nunito", "PingFang SC", sans-serif';
  ctx.fillText('🏆 快乐成长荣誉明信片 🏆', W / 2, 130);

  // 彩虹分割线
  const rg = ctx.createLinearGradient(W / 2 - 200, 0, W / 2 + 200, 0);
  ['#FF8A93', '#FFC800', '#58CC02', '#1899D6', '#B87CF8'].forEach((c, i, arr) => {
    rg.addColorStop(i / (arr.length - 1), c);
  });
  ctx.fillStyle = rg;
  ctx.fillRect(W / 2 - 200, 170, 400, 6);

  // 学生姓名
  ctx.textAlign = 'left';
  ctx.fillStyle = '#3C3C3C';
  ctx.font = 'bold 34px "Nunito", "PingFang SC", sans-serif';
  ctx.fillText(`亲爱的宝贝【 ${input.studentName} 】小朋友：`, 110, 250);

  ctx.font = '600 24px "Nunito", "PingFang SC", sans-serif';
  ctx.fillStyle = '#555555';
  ctx.fillText(`在《 ${input.examTitle} 》中表现杰出，顺利通关！`, 130, 310);
  if (input.submittedAt) {
    ctx.fillText(`交卷时间：${new Date(input.submittedAt).toLocaleString('zh-CN')}`, 130, 350);
  }

  // 大得分红印章
  const stampX = W - 200;
  const stampY = 320;
  ctx.beginPath();
  ctx.arc(stampX, stampY, 120, 0, Math.PI * 2);
  ctx.fillStyle = '#FFF5F5';
  ctx.fill();
  ctx.strokeStyle = '#FF8A93';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(stampX, stampY, 104, 0, Math.PI * 2);
  ctx.strokeStyle = '#FFB3B3';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#EA2B2B';
  ctx.font = '900 72px "Nunito", "PingFang SC", sans-serif';
  ctx.fillText(`${input.score}`, stampX, stampY - 14);
  ctx.font = 'bold 24px "Nunito", "PingFang SC", sans-serif';
  ctx.fillText('分', stampX, stampY + 44);

  // 能力雷达图
  const dims = input.dimensionScores && input.dimensionScores.length >= 3
    ? input.dimensionScores
    : (input.dimensionScores && input.dimensionScores.length > 0
        ? input.dimensionScores
        : [{ key: 'total', label: '综合', score: input.score, full: 100 }]);

  const radarCx = W / 2;
  const radarCy = 620;
  const radarR = 230;
  drawRadar(ctx, dims, radarCx, radarCy, radarR);

  // 老师评语
  const boxY = 980;
  ctx.fillStyle = '#FFFDF0';
  roundRect(ctx, 120, boxY, W - 240, 220, 24);
  ctx.fill();
  ctx.strokeStyle = '#FDE047';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#E07D00';
  ctx.font = 'bold 22px "Nunito", "PingFang SC", sans-serif';
  ctx.fillText('👩‍🏫 老师有话说：', 150, boxY + 40);
  ctx.fillStyle = '#4A5568';
  ctx.font = 'bold 20px "Nunito", "PingFang SC", sans-serif';
  wrapText(ctx, input.comment || '真棒！继续加油！', 150, boxY + 85, W - 300, 32);

  // 防伪分享码
  const codeY = 1300;
  ctx.fillStyle = '#F0FDF4';
  roundRect(ctx, 120, codeY, W - 240, 280, 24);
  ctx.fill();
  ctx.strokeStyle = '#BBF7D0';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#16A34A';
  ctx.font = 'bold 22px "Nunito", "PingFang SC", sans-serif';
  ctx.fillText('🔒 防伪分享码（扫码/核验收藏）', W / 2, codeY + 40);

  // 伪二维码方块（由分享码派生，仅作视觉防伪）
  const code = (input.shareCode || 'SHARE').replace(/[^A-Z0-9]/g, '');
  drawFauxQR(ctx, code, W / 2 - 90, codeY + 70, 180);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#15803D';
  ctx.font = 'bold 28px "Nunito", "PingFang SC", sans-serif';
  ctx.fillText(input.shareCode || 'N/A', W / 2, codeY + 250);

  // 水印
  ctx.textAlign = 'right';
  ctx.fillStyle = '#AFAFAF';
  ctx.font = 'bold 16px "Nunito", "PingFang SC", sans-serif';
  ctx.fillText('快乐作业考试本 · 亲子陪伴频道 ©2026', W - 80, H - 80);

  return canvas;
}

function drawRadar(
  ctx: CanvasRenderingContext2D,
  dims: { label: string; score: number; full: number }[],
  cx: number,
  cy: number,
  R: number
) {
  const N = dims.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / N;

  // 网格圈
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  for (let ring = 1; ring <= 4; ring++) {
    const r = (R * ring) / 4;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = angle(i % N);
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 轴线 + 标签
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 20px "Nunito", "PingFang SC", sans-serif';
  for (let i = 0; i < N; i++) {
    const a = angle(i);
    const x = cx + R * Math.cos(a);
    const y = cy + R * Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
    const lx = cx + (R + 28) * Math.cos(a);
    const ly = cy + (R + 28) * Math.sin(a);
    ctx.textAlign = Math.abs(Math.cos(a)) < 0.3 ? 'center' : (Math.cos(a) > 0 ? 'left' : 'right');
    ctx.textBaseline = 'middle';
    ctx.fillText(dims[i].label, lx, ly);
  }

  // 数据多边形
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const idx = i % N;
    const frac = Math.max(0, Math.min(1, dims[idx].score / (dims[idx].full || 100)));
    const a = angle(idx);
    const x = cx + R * frac * Math.cos(a);
    const y = cy + R * frac * Math.sin(a);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(88, 204, 2, 0.28)';
  ctx.fill();
  ctx.strokeStyle = '#37A169';
  ctx.lineWidth = 3;
  ctx.stroke();

  // 顶点
  for (let i = 0; i < N; i++) {
    const frac = Math.max(0, Math.min(1, dims[i].score / (dims[i].full || 100)));
    const a = angle(i);
    const x = cx + R * frac * Math.cos(a);
    const y = cy + R * frac * Math.sin(a);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#37A169';
    ctx.fill();
  }
}

function drawFauxQR(ctx: CanvasRenderingContext2D, code: string, x: number, y: number, size: number) {
  const cells = 11;
  const cell = size / cells;
  // 简单确定性伪随机
  let seed = 0;
  for (const ch of code) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#166534';
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (rand() > 0.5) ctx.fillRect(x + c * cell, y + r * cell, cell, cell);
    }
  }
  // 定位角
  const corner = (ox: number, oy: number) => {
    ctx.fillStyle = '#166534';
    ctx.fillRect(ox, oy, cell * 3, cell * 3);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(ox + cell, oy + cell, cell, cell);
    ctx.fillStyle = '#166534';
    ctx.fillRect(ox + cell * 1.4, oy + cell * 1.4, cell * 0.2, cell * 0.2);
  };
  corner(x, y);
  corner(x + size - cell * 3, y);
  corner(x, y + size - cell * 3);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  let line = '';
  let yy = y;
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, yy);
      line = ch;
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

export function downloadReportPng(canvas: HTMLCanvasElement, filename: string) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export function downloadReportPdf(canvas: HTMLCanvasElement, filename: string) {
  const img = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [canvas.width, canvas.height] });
  pdf.addImage(img, 'PNG', 0, 0, canvas.width, canvas.height);
  pdf.save(filename);
}
