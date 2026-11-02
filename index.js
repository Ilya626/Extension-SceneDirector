import { VERSION, PROMPTS } from './core.js';
import { installRuntime } from './runtime.js';
import { installWIEditor, setCharacterRole } from './wi-editor.js';

const KEY = 'sceneDirector';
const defaults = { enabled: false, firstProfile: '', finalProfile: '', firstModel: '', finalModel: '', firstMaxTokens: 0, prompts: {} };
const context = () => SillyTavern.getContext();
function settings() {
    const s = context().extensionSettings[KEY] ??= {};
    for (const [key, value] of Object.entries(defaults)) if (s[key] === undefined) s[key] = structuredClone(value);
    return s;
}
async function init() {
    const c = context(), nativeWI = await import('/scripts/world-info.js'), openai = await import('/scripts/openai.js');
    const { power_user: powerUser } = await import('/scripts/power-user.js');
    const { getRegexedString, regex_placement } = await import('/scripts/extensions/regex/engine.js');
    const html = await c.renderExtensionTemplateAsync('third-party/Extension-SceneDirector', 'settings', { version: VERSION });
    $('#extensions_settings2').append(html);
    const status = info => {
        document.getElementById('sd_status').textContent = info.message;
        document.getElementById('sd_route').textContent = info.mode === 'characters' ? `ГП → сцена: ${info.cast.join(', ')}`
            : info.mode === 'draft-edit' ? 'Без ГП: черновик → редактор' : '';
        document.getElementById('sd_calls').textContent = `RP-вызовы: ${info.calls || 0} / 2`;
        document.getElementById('sd_models_status').textContent = `Первый: ${info.firstModel || settings().firstModel || 'ST'}; второй: ${info.finalModel || settings().finalModel || 'ST'}`;
    };
    const runtime = installRuntime({ context, settings, nativeWI, openai, powerUser,
        renderEntry: entry => getRegexedString(entry.content, regex_placement.WORLD_INFO,
            { depth: entry.position === nativeWI.world_info_position.atDepth ? entry.depth ?? 4 : null, isMarkdown: false, isPrompt: true }), onStatus: status });
    globalThis.sceneDirectorPrepare = runtime.intercept;
    installWIEditor({ nativeWI, onChange: () => runtime.settingsChanged() });
    const save = () => { runtime.settingsChanged(); c.saveSettingsDebounced(); };
    for (const key of ['firstProfile', 'finalProfile', 'firstModel', 'finalModel', 'firstMaxTokens', 'enabled']) {
        const node = document.getElementById(`sd_${key}`);
        if (key === 'enabled') node.checked = settings()[key]; else node.value = settings()[key];
        node.addEventListener('change', () => {
            settings()[key] = key === 'enabled' ? node.checked : key === 'firstMaxTokens' ? Math.max(0, Math.floor(Number(node.value) || 0)) : node.value.trim();
            save();
        });
    }
    function profiles() {
        for (const pass of ['first', 'final']) {
            const select = document.getElementById(`sd_${pass}Profile`), value = settings()[`${pass}Profile`];
            select.replaceChildren(new Option('Текущее подключение ST', ''));
            for (const p of context().extensionSettings.connectionManager?.profiles || []) {
                if (context().CONNECT_API_MAP[p.api]?.selected === 'openai') select.append(new Option(`${p.name} · ${p.model || p.api}`, p.id));
            }
            if (value && ![...select.options].some(o => o.value === value)) select.append(new Option('Сохранённый профиль недоступен — выберите другой', value));
            select.value = value;
        }
    }
    profiles();
    for (const event of [c.eventTypes.CONNECTION_PROFILE_CREATED, c.eventTypes.CONNECTION_PROFILE_UPDATED, c.eventTypes.CONNECTION_PROFILE_DELETED]) if (event) c.eventSource.on(event, profiles);
    const names = { actors: '1 · ГП: подготовка позиций', scene: '2 · ГП: цельная сцена', draft: '1 · без ГП: черновик', edit: '2 · без ГП: редактор' };
    for (const [key, prompt] of Object.entries(PROMPTS)) {
        const row = document.createElement('details'), title = document.createElement('summary'), input = document.createElement('textarea'), origin = document.createElement('small');
        title.textContent = names[key]; input.className = 'text_pole'; input.rows = 8;
        input.value = settings().prompts[key] ?? prompt;
        origin.textContent = settings().prompts[key] ? 'Источник: ваша правка' : 'Источник: встроенный Scene Director';
        input.addEventListener('change', () => {
            if (!input.value.trim()) { input.value = settings().prompts[key] ?? prompt; return; }
            settings().prompts[key] = input.value.trim(); origin.textContent = 'Источник: ваша правка'; save();
        });
        const reset = document.createElement('button'); reset.className = 'menu_button'; reset.textContent = 'Сбросить этот промпт';
        reset.addEventListener('click', () => { delete settings().prompts[key]; input.value = prompt; origin.textContent = 'Источник: встроенный Scene Director'; save(); });
        row.append(title, origin, input, reset); document.getElementById('sd_prompts').append(row);
    }
    document.getElementById('sd_stop').addEventListener('click', runtime.stop);
    globalThis.SceneDirector = Object.freeze({ version: VERSION, inspect: runtime.inspect, stop: runtime.stop,
        setCharacterRole: (world, uid, main) => setCharacterRole(nativeWI, world, uid, main),
        inspectPrompts: () => structuredClone({ ...PROMPTS, ...settings().prompts }) });
    status({ message: settings().enabled ? 'Готово. Два прохода при следующем игровом ответе.' : 'Выключен. Настройте модели и включите два прохода.', calls: 0 });
}
init().catch(error => { console.error('[Scene Director]', error); toastr.error(error.message, 'Scene Director'); });
