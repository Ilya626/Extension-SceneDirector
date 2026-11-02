const PANEL_CLASS = 'scene-director-wi-role';
const entryRole = entry => entry?.extensions?.sceneDirector?.role === 'main' ? 'main' : 'secondary';

/** Save an independent actor priority without changing native activation rules. */
export async function setCharacterRole(nativeWI, world, uid, main) {
    const data = await nativeWI.loadWorldInfo(world);
    const entry = data?.entries?.[uid];
    if (!entry) throw new Error(`WI entry not found: ${world} / ${uid}`);
    const role = main === true ? 'main' : 'secondary';
    entry.extensions ??= {};
    entry.extensions.sceneDirector = { ...entry.extensions.sceneDirector, role };

    // Imported character books retain their original card representation.
    const original = data.originalData?.entries?.find(candidate => String(candidate.id ?? candidate.uid) === String(uid));
    if (original) {
        original.extensions ??= {};
        original.extensions.sceneDirector = { ...original.extensions.sceneDirector, role };
    }
    await nativeWI.saveWorldInfo(world, data, true);
    return { world, uid: entry.uid ?? uid, role, main: role === 'main' };
}

/** Decorate the native WI editor. onChange receives { world, uid, role, main }. */
export function installWIEditor({ nativeWI, onChange = () => {} }) {
    let timer;
    let revision = 0;
    let disposed = false;
    const controls = new WeakMap();
    const panels = new Set();
    const context = globalThis.SillyTavern?.getContext?.();
    const updatedEvent = context?.eventTypes?.WORLDINFO_UPDATED;

    function currentWorld() {
        const select = document.getElementById('world_editor_select');
        return select && select.value !== '' ? nativeWI.world_names?.[Number(select.value)] : undefined;
    }

    function refresh() {
        if (disposed) return;
        const request = ++revision;
        clearTimeout(timer);
        timer = setTimeout(() => {
            render(request).catch(error => console.error('[Scene Director WI editor]', error));
        }, 80);
    }

    async function render(request) {
        const world = currentWorld();
        if (!world) return;
        const data = await nativeWI.loadWorldInfo(world);
        if (disposed || request !== revision || currentWorld() !== world) return;
        for (const row of document.querySelectorAll('#world_popup_entries_list .world_entry[uid]')) {
            const uid = row.getAttribute('uid');
            const entry = data?.entries?.[uid];
            const host = row.querySelector('[name="WIEntryBottomControls"]') || row.querySelector('.world_entry_edit');
            if (!entry || !host) continue;
            let control = controls.get(row);
            if (!control || !control.panel.isConnected) {
                if (control) panels.delete(control.panel);
                const panel = document.createElement('div');
                panel.className = `${PANEL_CLASS} flex-container flexFlowColumn`;
                const label = document.createElement('label');
                label.className = 'checkbox flex-container';
                label.title = 'Scene Director: при участии в сцене персонаж получает подготовку позиции перед общим ответом.';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.setAttribute('aria-label', 'Главный персонаж');
                const text = document.createElement('span');
                text.textContent = 'Главный персонаж';
                const notice = document.createElement('small');
                notice.setAttribute('role', 'status');
                label.append(input, text);
                panel.append(label, notice);
                host.append(panel);
                control = { panel, input, notice, pending: false, world, uid };
                controls.set(row, control);
                panels.add(panel);
                input.addEventListener('change', async event => {
                    event.stopPropagation();
                    if (disposed || control.pending) return;
                    const savedWorld = control.world, savedUid = control.uid;
                    control.pending = true;
                    input.disabled = true;
                    notice.textContent = 'Сохранение…';
                    try {
                        const result = await setCharacterRole(nativeWI, savedWorld, savedUid, input.checked);
                        if (!disposed && panel.isConnected) notice.textContent = result.main ? 'Главный' : 'Вторичный';
                        if (!disposed) await onChange(result);
                    } catch (error) {
                        if (!disposed && panel.isConnected) notice.textContent = `Ошибка: ${error.message}`;
                        console.error('[Scene Director WI role]', error);
                    } finally {
                        control.pending = false;
                        input.disabled = false;
                        refresh();
                    }
                });
            }
            control.world = world;
            control.uid = uid;
            if (!control.pending) {
                control.input.checked = entryRole(entry) === 'main';
                // Keep a failed-save notice visible until the next edit.
                if (!control.notice.textContent.startsWith('Ошибка:')) {
                    control.notice.textContent = control.input.checked ? 'Главный' : 'Вторичный';
                }
            }
        }
        for (const panel of panels) if (!panel.isConnected) panels.delete(panel);
    }

    const selectionChanged = event => {
        if (event.target?.id === 'world_editor_select') refresh();
    };
    document.addEventListener('change', selectionChanged);
    const observer = new MutationObserver(records => {
        if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1
            && !node.closest(`.${PANEL_CLASS}`)
            && (node.matches('.world_entry, .world_entry_edit') || node.querySelector('.world_entry, .world_entry_edit'))))) refresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    if (updatedEvent) context.eventSource.on(updatedEvent, refresh);
    refresh();

    return {
        refresh,
        dispose() {
            disposed = true;
            revision++;
            clearTimeout(timer);
            observer.disconnect();
            document.removeEventListener('change', selectionChanged);
            if (updatedEvent) context.eventSource.removeListener(updatedEvent, refresh);
            for (const panel of panels) panel.remove();
            panels.clear();
        },
    };
}
