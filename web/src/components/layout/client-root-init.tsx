import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { fetchChannelModels } from "@/services/api/image";
import { createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const refreshedCapabilityKey = useRef("");
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    usePromptSourceScheduler();

    useEffect(() => {
        const refreshableChannels = config.channels.filter((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.some((model) => model.capability === "video"));
        if (!refreshableChannels.length) return;
        const refreshKey = refreshableChannels.map((channel) => `${channel.id}|${channel.baseUrl}|${channel.models.map((model) => model.name).sort().join(",")}`).sort().join(";");
        if (refreshedCapabilityKey.current === refreshKey) return;
        refreshedCapabilityKey.current = refreshKey;
        let active = true;

        void Promise.all(
            refreshableChannels.map(async (channel) => {
                try {
                    return { channelId: channel.id, models: await fetchChannelModels(channel) };
                } catch {
                    return null;
                }
            }),
        ).then((results) => {
            if (!active) return;
            const refreshed = new Map(results.filter((result) => result !== null).map((result) => [result.channelId, new Map(result.models.map((model) => [model.name, model]))]));
            if (!refreshed.size) return;
            const currentChannels = useConfigStore.getState().config.channels;
            const nextChannels = currentChannels.map((channel) => {
                const models = refreshed.get(channel.id);
                if (!models) return channel;
                return {
                    ...channel,
                    models: channel.models.map((model) => {
                        const latest = models.get(model.name);
                        return latest ? { ...latest, script: model.script } : model;
                    }),
                };
            });
            useConfigStore.getState().updateConfig("channels", nextChannels);
        });

        return () => {
            active = false;
        };
    }, [config.channels]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success("已导入本地直连配置");
    }, [config.channels, message, openConfigDialog, updateConfig]);

    return <>{children}</>;
}
