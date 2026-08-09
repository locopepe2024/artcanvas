type BlobStore = {
    setItem<T>(key: string, value: T): Promise<T>;
    getItem<T>(key: string): Promise<T | null>;
    removeItem(key: string): Promise<void>;
};

export async function persistBlobWithMemoryFallback(store: BlobStore, memory: Map<string, Blob>, key: string, blob: Blob) {
    try {
        await store.setItem(key, blob);
        memory.delete(key);
        return true;
    } catch {
        memory.set(key, blob);
        return false;
    }
}

export async function readBlobWithMemoryFallback(store: BlobStore, memory: Map<string, Blob>, key: string) {
    return memory.get(key) || (await store.getItem<Blob>(key));
}

export async function removeBlobWithMemoryFallback(store: BlobStore, memory: Map<string, Blob>, key: string) {
    memory.delete(key);
    try {
        await store.removeItem(key);
    } catch {
        // A disabled or quota-failed persistent store must not prevent cleanup
        // of the current-session fallback.
    }
}
