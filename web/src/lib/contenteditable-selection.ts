export function removeMentionBeforeCaret() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const end = selection.getRangeAt(0);
    const text = textBeforeCaret(end);
    const match = /@([^\s@]*)$/.exec(text);
    if (!match) return;
    const editor = closestEditor(end.startContainer) as HTMLElement | null;
    if (!editor) return;

    const textNodes = collectTextNodes(editor);
    const position = resolveCaretTextPosition(end, textNodes);
    if (!position) return;
    let index = position.index;
    let offset = position.offset;
    let remaining = match[0].length;
    const deletion = document.createRange();
    deletion.setEnd(end.startContainer, end.startOffset);

    while (remaining > 0 && index >= 0) {
        const node = textNodes[index];
        if (isAtomicReference(node)) break;
        const take = Math.min(remaining, offset);
        if (take > 0) {
            deletion.setStart(node, offset - take);
            remaining -= take;
        }
        if (!remaining) break;
        index -= 1;
        if (index < 0 || isAtomicReference(textNodes[index])) break;
        offset = textNodes[index].data.length;
    }
    if (!remaining) deletion.deleteContents();
}

function textBeforeCaret(range: Range) {
    const editor = closestEditor(range.startContainer);
    if (!editor) return "";
    const before = range.cloneRange();
    before.setStart(editor, 0);
    return before.toString();
}

function closestEditor(node: Node) {
    const element = node instanceof Element ? node : node.parentElement;
    return element?.closest("[contenteditable='true']") || null;
}

function collectTextNodes(editor: HTMLElement) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let current: Node | null = walker.nextNode();
    while (current) {
        nodes.push(current as Text);
        current = walker.nextNode();
    }
    return nodes;
}

function resolveCaretTextPosition(range: Range, nodes: Text[]) {
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
        const index = nodes.indexOf(range.startContainer as Text);
        return index >= 0 ? { index, offset: range.startOffset } : null;
    }
    const container = range.startContainer;
    const children = Array.from(container.childNodes);
    for (let i = Math.min(range.startOffset - 1, children.length - 1); i >= 0; i -= 1) {
        const node = lastTextNode(children[i]);
        if (node) return { index: nodes.indexOf(node), offset: node.data.length };
    }
    return nodes.length ? { index: 0, offset: 0 } : null;
}

function lastTextNode(node: Node): Text | null {
    if (node.nodeType === Node.TEXT_NODE) return node as Text;
    for (let i = node.childNodes.length - 1; i >= 0; i -= 1) {
        const text = lastTextNode(node.childNodes[i]);
        if (text) return text;
    }
    return null;
}

function isAtomicReference(node: Text) {
    return Boolean(node.parentElement?.closest("[data-ref-label], [data-reference-node-id]"));
}
