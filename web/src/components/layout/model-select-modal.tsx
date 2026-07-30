import { App, Button, Checkbox, Input, Modal, Tabs } from "antd";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchChannelModels } from "@/services/api/image";
import { guessCapability, type ChannelModel, type ModelChannel } from "@/stores/use-config-store";

// 选择渠道模型弹窗：拉取上游模型列表或手动增加，勾选后才会进入渠道模型列表。
export function ModelSelectModal({ open, channel, selectedModels, onConfirm, onClose }: { open: boolean; channel: ModelChannel | null; selectedModels: ChannelModel[]; onConfirm: (models: ChannelModel[]) => void; onClose: () => void }) {
    const { message } = App.useApp();
    const [existing, setExisting] = useState<ChannelModel[]>([]);
    const [fetched, setFetched] = useState<ChannelModel[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState("new");
    const [search, setSearch] = useState("");
    const [manual, setManual] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        setExisting(selectedModels);
        setFetched([]);
        setSelected(new Set(selectedModels.map((model) => model.name)));
        setActiveTab(selectedModels.length ? "existing" : "new");
        setSearch("");
        setManual("");
    }, [open, selectedModels]);

    const currentModels = activeTab === "new" ? fetched : existing;
    const currentList = currentModels.map((model) => model.name);
    const visibleList = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        return keyword ? currentList.filter((name) => name.toLowerCase().includes(keyword)) : currentList;
    }, [currentList, search]);
    const visibleSelectedCount = visibleList.filter((name) => selected.has(name)).length;

    const toggle = (name: string, checked: boolean) =>
        setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(name);
            else next.delete(name);
            return next;
        });

    const selectVisible = (checked: boolean) =>
        setSelected((current) => {
            const next = new Set(current);
            visibleList.forEach((name) => (checked ? next.add(name) : next.delete(name)));
            return next;
        });

    const addManual = () => {
        const name = manual.trim();
        if (!name) return;
        if (!fetched.some((model) => model.name === name) && !existing.some((model) => model.name === name)) setFetched((current) => [{ name, capability: guessCapability(name) }, ...current]);
        setSelected((current) => new Set(current).add(name));
        setManual("");
        setActiveTab("new");
    };

    const fetchModels = async () => {
        if (!channel) return;
        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error("请先填写接口地址和 API Key");
            return;
        }
        setLoading(true);
        try {
            const models = await fetchChannelModels(channel);
            setFetched(models);
            setActiveTab("new");
            message.success(`已拉取 ${models.length} 个模型`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "拉取模型失败");
        } finally {
            setLoading(false);
        }
    };

    const confirm = () => {
        const ordered = Array.from(new Map([...existing, ...fetched].map((model) => [model.name, model])).values()).filter((model) => selected.has(model.name));
        onConfirm(ordered);
        onClose();
    };

    return (
        <Modal
            open={open}
            width={880}
            centered
            onCancel={onClose}
            title={
                <span>
                    选择渠道模型 <span className="ml-2 text-xs font-normal text-stone-500">已选择 {selected.size} / {new Set([...existing, ...fetched].map((model) => model.name)).size}</span>
                </span>
            }
            styles={{ body: { maxHeight: "62vh", overflowY: "auto" } }}
            footer={[
                <Button key="cancel" onClick={onClose}>
                    取消
                </Button>,
                <Button key="confirm" type="primary" onClick={confirm}>
                    确定
                </Button>,
            ]}
        >
            <div className="flex flex-wrap items-center gap-3">
                <Input className="min-w-[200px] flex-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索模型" prefix={<Search className="size-4 text-stone-400" />} allowClear />
                <Input className="min-w-[180px] flex-1" value={manual} onChange={(event) => setManual(event.target.value)} onPressEnter={addManual} placeholder="输入模型名称" />
                <Button onClick={addManual}>增加模型</Button>
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void fetchModels()}>
                    拉取模型列表
                </Button>
            </div>
            <div className="mt-2 text-xs text-stone-500">如果上游不提供 OpenAI /models 模型列表接口，请在这里手动增加模型名称。</div>

            <Tabs
                className="mt-3"
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                    { key: "new", label: `新获取的模型 (${fetched.length})` },
                    { key: "existing", label: `已有的模型 (${existing.length})` },
                ]}
            />

            <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs text-stone-500">当前列表已选择 {visibleSelectedCount} / {visibleList.length}</span>
                <div className="flex gap-2">
                    <Button size="small" disabled={!visibleList.length} onClick={() => selectVisible(true)}>
                        全选当前列表
                    </Button>
                    <Button size="small" disabled={!visibleSelectedCount} onClick={() => selectVisible(false)}>
                        取消当前列表
                    </Button>
                </div>
            </div>

            {visibleList.length ? (
                <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
                    {visibleList.map((name) => (
                        <Checkbox key={name} checked={selected.has(name)} onChange={(event) => toggle(name, event.target.checked)}>
                            <span className="truncate" title={name}>
                                {name}
                            </span>
                        </Checkbox>
                    ))}
                </div>
            ) : (
                <div className="py-8 text-center text-sm text-stone-500">{activeTab === "new" ? "点击「拉取模型列表」获取上游模型，或手动增加模型名称。" : "暂无已选择的模型。"}</div>
            )}
        </Modal>
    );
}
