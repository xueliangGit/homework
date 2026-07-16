import React, { useState, useEffect } from 'react';

// ============ 轻量全局 Toast + 自定义确认（替代原生 alert/confirm，适配 Pad/儿童风） ============

type ToastType = 'success' | 'error' | 'info' | 'warn';
interface ToastItem { id: number; msg: string; type: ToastType }
type Listener = (t: ToastItem) => void;

let listeners: Listener[] = [];
let seq = 0;

export function showToast(msg: string, type: ToastType = 'info'): void {
  const item: ToastItem = { id: ++seq, msg, type };
  listeners.forEach((l) => l(item));
}

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const onAdd: Listener = (t) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 3200);
    };
    listeners.push(onAdd);
    return () => {
      listeners = listeners.filter((l) => l !== onAdd);
    };
  }, []);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 items-center pointer-events-none">
      {items.map((t) => (
        <div key={t.id} className={`px-4 py-2 rounded-2xl font-extrabold text-sm shadow-lg ${toastClass(t.type)}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

function toastClass(t: ToastType): string {
  switch (t) {
    case 'success':
      return 'bg-green-500 text-white';
    case 'error':
      return 'bg-red-500 text-white';
    case 'warn':
      return 'bg-amber-500 text-white';
    default:
      return 'bg-purple-500 text-white';
  }
}

// ---- 自定义确认弹层（替代 window.confirm，返回 Promise<boolean>） ----
interface ConfirmState {
  message: string;
  okText: string;
  cancelText: string;
}
type Resolver = (v: boolean) => void;

let resolver: Resolver | null = null;
let setConfirmState: React.Dispatch<React.SetStateAction<ConfirmState | null>> = () => {};

export function confirmAsync(message: string, okText = '确定', cancelText = '再想想'): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    resolver = resolve;
    setConfirmState({ message, okText, cancelText });
  });
}

export function ConfirmContainer() {
  const [state, setState] = useState<ConfirmState | null>(null);
  useEffect(() => {
    setConfirmState = setState;
    return () => {
      setConfirmState = () => {};
      resolver = null;
    };
  }, []);

  if (!state) return null;

  const close = (result: boolean) => {
    setState(null);
    const r = resolver;
    resolver = null;
    r?.(result);
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 p-4">
      <div className="card-jelly bg-white max-w-[420px] w-full p-6 flex flex-col gap-5">
        <p className="font-black text-gray-800 text-center text-base leading-relaxed">{state.message}</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => close(false)}
            className="btn-3d font-black py-2.5 px-6 text-sm"
          >
            {state.cancelText}
          </button>
          <button
            onClick={() => close(true)}
            className="btn-3d btn-3d-purple font-black py-2.5 px-6 text-sm"
            style={{ boxShadow: '0 4px 0 var(--color-purple-depth)' }}
          >
            {state.okText}
          </button>
        </div>
      </div>
    </div>
  );
}
