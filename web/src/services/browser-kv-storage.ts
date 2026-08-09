const DATABASE_NAME = "infinite-canvas";

export const CORE_STORE_NAMES = [
    "app_state",
    "image_files",
    "media_files",
    "agent_chat_messages",
    "image_generation_logs",
    "video_generation_logs",
    "prompt_cache",
] as const;

export type CoreStoreName = (typeof CORE_STORE_NAMES)[number];

export type BrowserKeyValueStore = {
    setItem<T>(key: string, value: T): Promise<T>;
    getItem<T>(key: string): Promise<T | null>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
    iterate<T, U>(callback: (value: T, key: string, iterationNumber: number) => U | void): Promise<U | undefined>;
};

let databasePromise: Promise<IDBDatabase> | null = null;
const stores = new Map<CoreStoreName, BrowserKeyValueStore>();

export function coreStore(name: CoreStoreName): BrowserKeyValueStore {
    const existing = stores.get(name);
    if (existing) return existing;
    const store: BrowserKeyValueStore = {
        setItem: async <T>(key: string, value: T) => {
            await runRequest(name, "readwrite", (objectStore) => objectStore.put(value, key));
            return value;
        },
        getItem: async <T>(key: string) => {
            const value = await runRequest<T | undefined>(name, "readonly", (objectStore) => objectStore.get(key));
            return value === undefined ? null : value;
        },
        removeItem: async (key: string) => {
            await runRequest(name, "readwrite", (objectStore) => objectStore.delete(key));
        },
        clear: async () => {
            await runRequest(name, "readwrite", (objectStore) => objectStore.clear());
        },
        iterate: async <T, U>(callback: (value: T, key: string, iterationNumber: number) => U | void) => runCursor(name, callback),
    };
    stores.set(name, store);
    return store;
}

export function missingCoreStores(existing: Iterable<string>) {
    const names = new Set(existing);
    return CORE_STORE_NAMES.filter((name) => !names.has(name));
}

async function getDatabase() {
    if (typeof indexedDB === "undefined") throw new Error("当前浏览器不支持 IndexedDB，无法保存本地数据");
    databasePromise ||= openManagedDatabase();
    try {
        return await databasePromise;
    } catch (error) {
        databasePromise = null;
        throw storageError("打开 IndexedDB 失败", error);
    }
}

async function openManagedDatabase() {
    const current = await openDatabase();
    const missing = missingCoreStores(current.objectStoreNames);
    if (!missing.length) return bindLifecycle(current);

    const nextVersion = current.version + 1;
    current.close();
    const upgraded = await openDatabase(nextVersion, (database) => {
        for (const name of CORE_STORE_NAMES) {
            if (!database.objectStoreNames.contains(name)) database.createObjectStore(name);
        }
    });
    const stillMissing = missingCoreStores(upgraded.objectStoreNames);
    if (stillMissing.length) {
        upgraded.close();
        throw new Error(`IndexedDB schema 升级不完整，缺少：${stillMissing.join(", ")}`);
    }
    return bindLifecycle(upgraded);
}

function openDatabase(version?: number, upgrade?: (database: IDBDatabase) => void) {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = version === undefined ? indexedDB.open(DATABASE_NAME) : indexedDB.open(DATABASE_NAME, version);
        request.onupgradeneeded = () => upgrade?.(request.result);
        request.onblocked = () => reject(new Error("IndexedDB schema 升级被其他标签页阻塞，请关闭旧的画布标签页后重试"));
        request.onerror = () => reject(request.error || new Error("IndexedDB open request failed"));
        request.onsuccess = () => resolve(request.result);
    });
}

function bindLifecycle(database: IDBDatabase) {
    database.onversionchange = () => {
        database.close();
        databasePromise = null;
    };
    database.onclose = () => {
        if (databasePromise) databasePromise = null;
    };
    return database;
}

async function runRequest<T>(storeName: CoreStoreName, mode: IDBTransactionMode, createRequest: (store: IDBObjectStore) => IDBRequest<T>, retry = true): Promise<T> {
    try {
        const database = await getDatabase();
        return await new Promise<T>((resolve, reject) => {
            let transaction: IDBTransaction;
            let request: IDBRequest<T>;
            let result: T;
            try {
                transaction = database.transaction(storeName, mode);
                request = createRequest(transaction.objectStore(storeName));
            } catch (error) {
                reject(error);
                return;
            }
            request.onsuccess = () => {
                result = request.result;
            };
            request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
            transaction.oncomplete = () => resolve(result);
            transaction.onerror = () => reject(transaction.error || request.error || new Error("IndexedDB transaction failed"));
            transaction.onabort = () => reject(transaction.error || request.error || new Error("IndexedDB transaction aborted"));
        });
    } catch (error) {
        if (retry && isStaleConnectionError(error)) {
            databasePromise = null;
            return runRequest(storeName, mode, createRequest, false);
        }
        throw storageError(`IndexedDB ${storeName} 写入或读取失败`, error);
    }
}

async function runCursor<T, U>(storeName: CoreStoreName, callback: (value: T, key: string, iterationNumber: number) => U | void, retry = true): Promise<U | undefined> {
    try {
        const database = await getDatabase();
        return await new Promise<U | undefined>((resolve, reject) => {
            let request: IDBRequest<IDBCursorWithValue | null>;
            try {
                request = database.transaction(storeName, "readonly").objectStore(storeName).openCursor();
            } catch (error) {
                reject(error);
                return;
            }
            let iterationNumber = 1;
            request.onerror = () => reject(request.error || new Error("IndexedDB cursor failed"));
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) return resolve(undefined);
                const result = callback(cursor.value as T, String(cursor.key), iterationNumber++);
                if (result !== undefined) return resolve(result);
                cursor.continue();
            };
        });
    } catch (error) {
        if (retry && isStaleConnectionError(error)) {
            databasePromise = null;
            return runCursor(storeName, callback, false);
        }
        throw storageError(`IndexedDB ${storeName} 遍历失败`, error);
    }
}

function isStaleConnectionError(error: unknown) {
    const name = error instanceof DOMException ? error.name : error && typeof error === "object" && "name" in error ? String(error.name) : "";
    return name === "InvalidStateError" || name === "TransactionInactiveError" || name === "NotFoundError";
}

function storageError(prefix: string, error: unknown) {
    const name = error instanceof DOMException ? error.name : error && typeof error === "object" && "name" in error ? String(error.name) : "Error";
    const message = error instanceof Error ? error.message : String(error || "unknown error");
    return new Error(`${prefix}: ${name}: ${message}`, { cause: error });
}
