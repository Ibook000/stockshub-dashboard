// One IndexedDB read/write transaction per personal-state update, including imports.
export class BrowserStore {
  constructor(db) {
    this.db = db;
  }
  static open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('stockshub-research-v2', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onerror = () =>
        reject(new Error('浏览器无法保存数据。请允许网站存储，或使用本机版。'));
      request.onblocked = () =>
        reject(new Error('其他标签页阻止了数据库更新，请关闭旧标签页后重试。'));
      request.onsuccess = () => resolve(new BrowserStore(request.result));
    });
  }
  get(key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('records', 'readonly');
      const request = tx.objectStore('records').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('无法读取本地数据。'));
    });
  }
  update(key, callback) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('records', 'readwrite');
      const store = tx.objectStore('records');
      let result, error;
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const updated = callback(request.result);
          result = updated.result;
          store.put(updated.value, key);
        } catch (exc) {
          error = exc;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(error ?? new Error('保存失败，可能存储空间不足。请导出备份。'));
    });
  }
  put(key, value) {
    return this.update(key, () => ({ value, result: value }));
  }
  async state() {
    return (await this.get('personal')) ?? { watchlist: [], journals: [] };
  }
  mutate(callback) {
    return this.update('personal', (value) => {
      const state = value ?? { watchlist: [], journals: [] };
      const result = callback(state);
      return { value: state, result };
    });
  }
}
