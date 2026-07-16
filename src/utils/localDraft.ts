// 本地草稿存储（IndexedDB），按 studentId+examId 隔离。
// 用于「答题做一半退出后在同一设备续写、查看进度」，永不自动上云；
// 仅在用户主动点「同步到云端」时由调用方上传到服务端。

const DB_NAME = 'kaoshi_local_drafts';
const STORE = 'drafts';
const VERSION = 1;

export interface LocalDraft {
  key: string; // `${studentId}::${examId}`
  studentId: string;
  examId: string;
  answers: Record<number, string>; // pageIndex -> canvasData(Base64 PNG)
  currentPage: number;
  updatedAt: number; // 最近一次本地保存
  syncedAt?: number; // 最近一次成功同步到云端的时间（用于区分是否已同步）
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalDraft(draft: LocalDraft): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(draft);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLocalDraft(key: string): Promise<LocalDraft | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as LocalDraft) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function removeLocalDraft(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listLocalDraftsByStudent(studentId: string): Promise<LocalDraft[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const all = (req.result as LocalDraft[]) || [];
      resolve(all.filter((d) => d.studentId === studentId));
    };
    req.onerror = () => reject(req.error);
  });
}
