import type { StateStorage } from "zustand/middleware";
import { coreStore } from "@/services/browser-kv-storage";

const appStateStore = coreStore("app_state");

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            return (await appStateStore.getItem<string>(name)) || null;
        } catch {
            return window.localStorage.getItem(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            await appStateStore.setItem(name, value);
        } catch {
            window.localStorage.setItem(name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await appStateStore.removeItem(name);
        } catch {
            window.localStorage.removeItem(name);
        }
    },
};
