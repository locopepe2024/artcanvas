import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryAgentService } from "./in-memory-agent-service.js";
import { MockRuntimeAdapter } from "./mock-runtime.js";

test("streams monotonic events and resumes after an event cursor", async () => {
    const service = new InMemoryAgentService([new MockRuntimeAdapter()]);
    const session = await service.createSession({ workspaceId: "workspace-1", runtimeKey: "mock", title: "测试" });
    const run = service.startRun({ sessionId: session.id, messages: [{ role: "user", text: "hello" }], metadata: { chunks: ["one", "two"] } });
    assert.equal((await service.waitForRun(run.id)).status, "succeeded");
    const events = service.listEvents(run.id);
    assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
    assert.equal(new Set(events.map((event) => event.eventId)).size, events.length);
    assert.deepEqual(service.listEvents(run.id, events[1].eventId), events.slice(2));
    assert.throws(() => service.listEvents(run.id, "missing-event"), /event cursor not found/);
    assert.equal(service.getSession(session.id).status, "idle");
});

test("keeps tool request approval result and artifact as separate events", async () => {
    const service = new InMemoryAgentService([new MockRuntimeAdapter()]);
    const session = await service.createSession({ workspaceId: "workspace-1", runtimeKey: "mock", title: "审批" });
    const run = service.startRun({ sessionId: session.id, messages: [{ role: "user", text: "render" }], metadata: { requireApproval: true, artifact: true } });
    const approval = await waitForApproval(service, run.id);
    assert.equal(service.getRun(run.id).status, "waiting_approval");
    await service.resolveApproval(approval.id, "approved");
    assert.equal((await service.waitForRun(run.id)).status, "succeeded");
    assert.equal(service.listApprovals(run.id)[0].status, "approved");
    assert.equal(service.listArtifacts(run.id).length, 1);
    const types = service.listEvents(run.id).map((event) => event.type);
    assert.ok(types.indexOf("tool.requested") < types.indexOf("approval.requested"));
    assert.ok(types.indexOf("approval.resolved") < types.indexOf("tool.started"));
    assert.ok(types.indexOf("tool.completed") < types.indexOf("run.completed"));
});

test("rejected approval never executes the tool", async () => {
    const service = new InMemoryAgentService([new MockRuntimeAdapter()]);
    const session = await service.createSession({ workspaceId: "workspace-1", runtimeKey: "mock", title: "拒绝" });
    const run = service.startRun({ sessionId: session.id, messages: [{ role: "user", text: "render" }], metadata: { requireApproval: true } });
    const approval = await waitForApproval(service, run.id);
    await service.resolveApproval(approval.id, "rejected");
    assert.equal((await service.waitForRun(run.id)).status, "succeeded");
    assert.equal(service.listEvents(run.id).some((event) => event.type === "tool.started" || event.type === "tool.completed"), false);
});

test("cancels a running mock run without producing success", async () => {
    const service = new InMemoryAgentService([new MockRuntimeAdapter()]);
    const session = await service.createSession({ workspaceId: "workspace-1", runtimeKey: "mock", title: "取消" });
    const run = service.startRun({ sessionId: session.id, messages: [{ role: "user", text: "slow" }], metadata: { chunks: ["one", "two", "three"], pauseMs: 20 } });
    await waitForEvent(service, run.id, "run.started");
    await service.cancelRun(run.id);
    assert.equal((await service.waitForRun(run.id)).status, "cancelled");
    assert.equal(service.listEvents(run.id).some((event) => event.type === "run.completed"), false);
});

test("cancelling an approval wait also terminalizes the pending approval", async () => {
    const service = new InMemoryAgentService([new MockRuntimeAdapter()]);
    const session = await service.createSession({ workspaceId: "workspace-1", runtimeKey: "mock", title: "审批取消" });
    const run = service.startRun({ sessionId: session.id, messages: [{ role: "user", text: "render" }], metadata: { requireApproval: true } });
    const approval = await waitForApproval(service, run.id);
    await service.cancelRun(run.id);
    assert.equal((await service.waitForRun(run.id)).status, "cancelled");
    assert.equal(service.listApprovals(run.id)[0].status, "cancelled");
    assert.equal(service.listEvents(run.id).some((event) => event.type === "tool.started"), false);
    await assert.rejects(service.resolveApproval(approval.id, "approved"), /approval not pending/);
});

test("records an explicit runtime failure as the run and session terminal state", async () => {
    const service = new InMemoryAgentService([new MockRuntimeAdapter()]);
    const session = await service.createSession({ workspaceId: "workspace-1", runtimeKey: "mock", title: "失败" });
    const run = service.startRun({ sessionId: session.id, messages: [{ role: "user", text: "fail" }], metadata: { fail: true } });
    const terminal = await service.waitForRun(run.id);
    assert.equal(terminal.status, "failed");
    assert.equal(terminal.error, "mock runtime failure");
    assert.equal(service.getSession(session.id).status, "failed");
    assert.equal(service.listEvents(run.id).at(-1)?.type, "run.failed");
});

async function waitForApproval(service: InMemoryAgentService, runId: string) {
    for (let index = 0; index < 100; index++) {
        const approval = service.listApprovals(runId)[0];
        if (approval) return approval;
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
    throw new Error("approval timeout");
}

async function waitForEvent(service: InMemoryAgentService, runId: string, type: string) {
    for (let index = 0; index < 100; index++) {
        if (service.listEvents(runId).some((event) => event.type === type)) return;
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
    throw new Error(`event timeout: ${type}`);
}
