import { PROMPTS, prepareFirst, prepareFinal, selectMainCharacters } from './core.js';

const supported = new Set(['normal', 'regenerate', 'swipe', 'continue']);

export function installRuntime({ context, settings, nativeWI, openai, powerUser, renderEntry, onStatus = () => {} }) {
    let active = null, sequence = 0, processed = null, activated = [], last = null;
    const ctx = context, bus = ctx().eventSource, events = ctx().eventTypes;
    const report = (phase, message, extra = {}) => {
        last = { ...(last || {}), phase, message, ...extra }; onStatus(structuredClone(last));
    };
    const current = run => active === run && !run.controller.signal.aborted && ctx().chat === run.chat
        && ctx().chatMetadata === run.metadata && ctx().chatId === run.chatId && ctx().mainApi === 'openai';
    function assertCurrent(run) {
        if (!current(run)) throw new DOMException('Сцена изменилась или генерация остановлена.', 'AbortError');
    }
    function stop(reason = 'Остановлено') {
        if (!active) return;
        active.controller.abort(new Error(reason));
        report('stopped', reason);
    }

    function started(type, _args, dryRun) {
        if (dryRun || !supported.has(type) || !settings().enabled) return;
        if (active) stop('Начата другая генерация.');
        const c = ctx();
        active = { id: ++sequence, type, chat: c.chat, metadata: c.chatMetadata, chatId: c.chatId,
            controller: new AbortController(), phase: 'assembling', first: false, second: false,
            // Native Regenerate removes its old reply before assembling. Keep it
            // only until this turn succeeds, for restoration after an API error.
            previous: type === 'regenerate' && c.chat.at(-1) && !c.chat.at(-1).is_user ? structuredClone(c.chat.at(-1)) : null,
            prefix: type === 'regenerate' ? c.chat.slice(0, -1).map(m => m.sc_message_id || m.extra?.sc_message_id || m.mes) : null };
        activated = []; processed = null;
        report('assembling', 'Сборка истории и WI…', { calls: 0, cast: [], mode: null });
    }

    function intercept(chat, _budget, abort, type) {
        const run = active;
        if (!run || !supported.has(type) || !settings().enabled) return;
        if (ctx().mainApi !== 'openai') { report('blocked', 'Scene Director требует Chat Completion.'); run.controller.abort(); abort(true); return; }
        if (ctx().groupId || openai.oai_settings.function_calling || powerUser.auto_swipe || powerUser.auto_continue?.enabled || Number(openai.oai_settings.n) > 1) {
            report('blocked', 'Для двух проходов отключите group chat, tools, auto-continue, auto-swipe и несколько вариантов n>1. Настройки ST не изменены.');
            run.controller.abort(); abort(true); return;
        }
        processed = chat;
        // Manifest interceptors run in load order. WorldMemory has already
        // installed/reordered its final fill; our hook must follow it.
        bus.makeLast(events.GENERATE_AFTER_DATA, prepare);
        bus.makeLast(events.CHAT_COMPLETION_SETTINGS_READY, modifyRequest);
    }

    function scan(args) {
        if (!active || active.phase !== 'assembling' || args?.state?.next) return;
        // Keep the native map reference so later listeners (WorldMemory) can
        // finish placement and duplicate suppression before we read it.
        activated = args?.activated?.entries || new Map();
    }

    function profiles() { return ctx().extensionSettings.connectionManager?.profiles || []; }
    function profile(id) {
        const p = profiles().find(p => p.id === id);
        if (!p || ctx().CONNECT_API_MAP[p.api]?.selected !== 'openai') throw new Error('Выбранный профиль Chat Completion недоступен.');
        return structuredClone(p);
    }
    function connectionFor(run, pass) {
        const s = run.config, id = s[`${pass}Profile`], model = s[`${pass}Model`]?.trim();
        const p = id ? profile(id) : null;
        const source = p ? ctx().CONNECT_API_MAP[p.api].source : openai.oai_settings.chat_completion_source;
        if (source !== openai.oai_settings.chat_completion_source) throw new Error('Профиль прохода должен использовать тот же тип Chat Completion API, что и открытый чат. Для разных совместимых эндпоинтов используйте два Custom-профиля.');
        const proxy = p?.proxy ? openai.proxies.find(proxy => proxy.name === p.proxy) : null;
        return { p, model: model || p?.model || null, override: p ? {
            chat_completion_source: source, secret_id: p['secret-id'], custom_url: p['api-url'],
            vertexai_region: p['api-url'], zai_endpoint: p['api-url'], siliconflow_endpoint: p['api-url'],
            minimax_endpoint: p['api-url'], pollinations_endpoint: p['api-url'],
            reverse_proxy: proxy?.url || '', proxy_password: proxy?.password || '',
            custom_prompt_post_processing: p['prompt-post-processing'],
        } : {} };
    }

    async function modifyRequest(payload) {
        const run = active;
        // ST filters the message array, creating a new array but keeping message
        // objects. Our final service message identifies only this turn's request;
        // unrelated WorldMemory background requests remain untouched.
        const first = run?.firstTransport && payload.messages?.includes(run.firstTransport.at(-1));
        const final = run?.nativePrompt && payload.messages?.includes(run.nativePrompt.at(-1));
        if (!run || (!first && !final)) return;
        const connection = first ? run.firstConnection : run.finalConnection;
        try {
        assertCurrent(run);
        const preset = connection.p?.preset && ctx().getPresetManager('openai')?.getCompletionPresetByName(connection.p.preset);
        const limit = (first && Number(run.config.firstMaxTokens) > 0 ? Number(run.config.firstMaxTokens) : 0)
            || Number(preset?.openai_max_tokens) || payload.max_completion_tokens || payload.max_tokens;
        const overrides = { ...connection.override, messages: structuredClone(first ? run.firstPrompt : run.finalPrompt),
            stream: payload.stream, type: payload.type, n: 1, model: connection.model || payload.model };
        // Rebuild parameters for the actual model, then replace the object:
        // stale fields from the native model must not survive a profile switch.
        const rebuilt = await ctx().ChatCompletionService.presetToGeneratePayload(preset || {},
            { chat_completion_source: openai.oai_settings.chat_completion_source }, overrides);
        if (rebuilt.max_completion_tokens !== undefined) { rebuilt.max_completion_tokens = limit; delete rebuilt.max_tokens; }
        else rebuilt.max_tokens = limit;
        assertCurrent(run);
        // Preparation is deliberately text-only, with no tool rounds or n>1.
        if (first) { delete rebuilt.tools; delete rebuilt.tool_choice; rebuilt.stream = false; }
        for (const key of Object.keys(payload)) delete payload[key];
        Object.assign(payload, rebuilt);
        if (first) run.first = true; else run.second = true;
        report(first ? 'first' : 'final', first ? 'Проход 1/2 — подготовка…' : 'Проход 2/2 — итоговая сцена…',
            { calls: Number(run.first) + Number(run.second), firstModel: run.firstConnection.model || null, finalModel: run.finalConnection.model || null });
        } catch (error) {
            run.failed = true; report('error', error.message); run.controller.abort(error); ctx().stopGeneration();
        }
    }

    async function prepare(data, dryRun) {
        const run = active;
        if (dryRun || !run || run.phase !== 'assembling' || !settings().enabled || ctx().mainApi !== 'openai' || !Array.isArray(data?.prompt)) return;
        run.phase = 'first'; run.config = structuredClone(settings());
        try {
            assertCurrent(run);
            run.firstConnection = connectionFor(run, 'first'); run.finalConnection = connectionFor(run, 'final');
            const base = structuredClone(data.prompt);
            const entries = activated instanceof Map ? [...activated.values()] : activated;
            const cast = selectMainCharacters(entries, processed || ctx().chat, base,
                { parseRegex: nativeWI.parseRegexFromString, substitute: ctx().substituteParams, caseSensitive: nativeWI.world_info_case_sensitive, renderEntry });
            const prompts = { ...PROMPTS, ...run.config.prompts };
            report('first', cast.length ? 'Проход 1/2 — позиции главных персонажей…' : 'Проход 1/2 — черновик сцены…',
                { mode: cast.length ? 'characters' : 'draft-edit', cast: cast.map(e => e.name) });
            run.firstPrompt = prepareFirst(base, cast, prompts);
            if (run.type === 'continue') run.firstPrompt.push({ role: 'system', content: 'Continue mode: the latest assistant text is an unfinished post. Prepare only the continuation; do not repeat or rewrite its existing prefix.' });
            run.firstTransport = structuredClone(run.firstPrompt);
            const response = await ctx().sendGenerationRequest('quiet', { prompt: run.firstTransport });
            assertCurrent(run);
            run.firstReturnedModel = typeof response?.model === 'string' ? response.model : null;
            const text = ctx().extractMessageFromData(response, 'openai');
            if (typeof text !== 'string' || !text.trim()) throw new Error('Первый проход не вернул текст. Проверьте модель и лимит ответа.');
            run.finalPrompt = prepareFinal(base, cast, text, prompts);
            if (run.type === 'continue') run.finalPrompt.push({ role: 'system', content: 'Continue mode: return only the continuation suffix of the unfinished assistant post. Its existing prefix is retained by the application. Do not repeat it.' });
            assertCurrent(run);
            // Native itemized prompts persist data.prompt. Keep that snapshot
            // free of drafts/positions and attach service notes only to the
            // outbound payload in CHAT_COMPLETION_SETTINGS_READY.
            run.nativePrompt = structuredClone(base);
            data.prompt = run.nativePrompt; run.firstPrompt = null; run.firstTransport = null;
            run.phase = 'final';
            report('final', 'Проход 2/2 — итоговая сцена…');
        } catch (error) {
            if (active === run) {
                run.failed = true;
                report(run.controller.signal.aborted ? 'stopped' : 'error', error.message);
                // Native EventEmitter catches listener exceptions. Abort the
                // native request explicitly; never silently fall back to one shot.
                run.controller.abort(error); ctx().stopGeneration();
            }
        }
    }

    function received(messageId) {
        const run = active;
        if (run?.phase !== 'final' || !run.second || ctx().chat !== run.chat) return;
        const message = run.chat[Number.isInteger(messageId) ? messageId : run.chat.length - 1];
        if (!message || message.is_user || message.is_system) return;
        run.committed = true;
        message.extra ??= {};
        if (run.finalConnection.model) message.extra.model = run.finalConnection.model;
        // Transport provenance only. Drafts/positions never enter message metadata.
        message.extra.sceneDirector = { mode: last?.mode, firstModel: run.firstConnection.model,
            firstReturnedModel: run.firstReturnedModel, finalModel: run.finalConnection.model || message.extra.model || null };
    }
    async function ended() {
        const run = active;
        if (!run) return;
        // Native streaming partial final replies keep native semantics. Restore
        // only the reply Regenerate removed when no replacement was committed.
        if (!run.committed && run.previous && ctx().chat === run.chat && ctx().chatMetadata === run.metadata) {
            const keys = run.chat.map(m => m.sc_message_id || m.extra?.sc_message_id || m.mes);
            if (JSON.stringify(keys) === JSON.stringify(run.prefix)) {
                run.chat.push(run.previous); ctx().addOneMessage(run.previous); await ctx().saveChat();
            }
        }
        if (active !== run) return;
        if (run.committed) report('ready', 'Готово · два прохода, в истории только итоговый пост.', { calls: Number(run.first) + Number(run.second) });
        else if (!['stopped', 'error', 'blocked'].includes(last?.phase)) report('error', 'Итоговый ответ не получен. Служебный материал в чат не записан.');
        active = null; processed = null; activated = [];
    }
    const invalidated = () => { if (active && active.phase !== 'assembling') { stop('История или настройки сцены изменились.'); ctx().stopGeneration(); } };
    bus.on(events.GENERATION_STARTED, started);
    bus.on(events.WORLDINFO_SCAN_DONE, scan);
    bus.on(events.CHAT_COMPLETION_SETTINGS_READY, modifyRequest);
    bus.on(events.GENERATE_AFTER_DATA, prepare);
    bus.on(events.GENERATION_STOPPED, () => stop());
    bus.on(events.GENERATION_ENDED, ended);
    bus.on(events.MESSAGE_RECEIVED, received);
    for (const event of [events.CHAT_CHANGED, events.MESSAGE_EDITED, events.MESSAGE_DELETED, events.MESSAGE_SWIPED,
        events.MAIN_API_CHANGED, events.CHATCOMPLETION_SOURCE_CHANGED, events.CHATCOMPLETION_MODEL_CHANGED].filter(Boolean)) bus.on(event, invalidated);
    return { intercept, stop: () => { stop(); ctx().stopGeneration(); }, inspect: () => structuredClone(last),
        settingsChanged: invalidated };
}
