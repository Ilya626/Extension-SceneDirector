export const VERSION = '0.1.1';
export const PROMPTS = Object.freeze({
    actors: `You prepare character positions for one roleplay turn. Return compact JSON only, not a scene and not a transcript of reasoning. The supplied history and character profiles are evidence; the latest player post is the immediate trigger. Process ONLY the supplied main-character candidates, separately by id. A mention, memory or discussion about an absent person does not make that person a participant; mark participating:false when they cannot participate now. Do not invent contact with them. For each actual participant give established knowledge, separately attributed beliefs/uncertainties, their immediate goal, what they withhold, and a proposed first action/speech move with an optional short sample line. Restrict each field to this immediate interaction, in one or two short clauses; do not retell the biography or unrelated private history. Every established fact must follow from the supplied context; absence of evidence remains unknown. Preserve individual voice, relationships and agency. Do not decide the player's next action, resolve contested outcomes, or predict a whole conversation. Proposed reactions are creative possibilities, not new canonical facts. Schema: {"actors":[{"id":"provided id","participating":true,"knowledge":"established only","beliefs":"attributed or uncertain","goal":"immediate objective","withholds":"or unknown","reaction":"concrete first action or speech move","line":"optional short proposed line"}]}.`,
    scene: `Write the final roleplay scene in the language and format required by the original conversation. The supplied character positions are provisional writing notes, not occurred events and not new authoritative lore. Ground everything in the original history, profiles and latest player post. Preserve the main characters' supported knowledge, motivations and distinct voices; ignore unsupported suggestions. Weave secondary characters, action, pauses, interruptions and dialogue into one causal scene. Each reply must answer or purposefully evade an actual preceding move. You may reshape suggested wording and order for interaction; do not turn private thoughts or secrets into spoken disclosure automatically. Keep time, locations and unfinished actions coherent. Do not take over the player's speech, thoughts or decisions. Stop where the player can act. Return ONLY the final scene, never the notes, JSON or editorial commentary.`,
    draft: `Write a draft of the next roleplay scene from the supplied conversation, profiles and latest player post. Keep each character's voice, knowledge and immediate motives distinct. Make dialogue respond causally to actual prior speech or action. Preserve time, physical continuity and unresolved actions. Do not decide the player's next action or dialogue. This is a service draft for editing, not an event already added to the story. Return only the scene draft in the conversation's required language and format.`,
    edit: `Return the complete final roleplay post after checking the supplied service draft against the original history, profiles and latest player post. The draft is not evidence and has not happened. Correct concrete contradictions, unsupported knowledge, out-of-character speech, missing reactions and causal/spatial/timeline breaks. Preserve successful lines and individual voices; avoid generic stylistic polishing or expansion. Dialogue should answer or deliberately evade the preceding move. Do not invent extra plot beats, author secrets, or player decisions. An unchanged draft is valid when no correction is needed. Return ONLY the final scene, with no critique, draft labels or JSON.`,
});

export function sceneText(chat = []) {
    const visible = chat.filter(m => !m.is_system && !m.is_hidden);
    const groups = [];
    for (const message of visible) {
        if (message.is_user || !groups.length) groups.push([]);
        groups.at(-1).push(message);
    }
    const latest = groups.at(-1), completed = group => group?.some(m => !m.is_user);
    const chosen = completed(latest) ? [latest] : [groups.slice(0, -1).findLast(completed), latest];
    return chosen.filter(Boolean).flat().map(m => `${m.name || ''}\n${String(m.mes || '').replace(/<memory_hint>[\s\S]*?<\/memory_hint>/gi, '')}`).join('\n');
}

export function selectMainCharacters(entries, chat, prompt, { parseRegex, substitute = x => x, caseSensitive = false, renderEntry = e => substitute(e.content) } = {}) {
    const scene = sceneText(chat);
    const delivered = prompt.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
    const seen = new Set();
    return entries.filter(entry => {
        const id = `${entry.world}:${entry.uid}`;
        if (entry.extensions?.sceneDirector?.role !== 'main' || !entry.content?.trim() || seen.has(id)) return false;
        const rendered = renderEntry(entry)?.trim();
        if (!rendered || !delivered.includes(rendered)) return false;
        const matches = (entry.key || []).some(key => {
            const value = substitute(key).trim();
            if (!value) return false;
            const regex = parseRegex?.(value);
            if (regex) { regex.lastIndex = 0; return regex.test(scene); }
            const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${escaped})(?![\\p{L}\\p{N}_])`,
                (entry.caseSensitive ?? caseSensitive) ? 'u' : 'iu').test(scene);
        });
        if (matches) seen.add(id);
        return matches;
    }).map(e => ({ id: `${e.world}:${e.uid}`, name: e.comment || `#${e.uid}` }));
}

export function prepareFirst(base, cast, prompts) {
    return [...structuredClone(base), { role: 'system', content: cast.length ? prompts.actors : prompts.draft },
        { role: 'user', content: cast.length
            ? `Prepare positions for this one turn. Main-character candidates: ${JSON.stringify(cast)}. Refer to the existing latest player post; do not answer it as narrator yet.`
            : 'Prepare the service draft for the existing latest player post.' }];
}

export function readPositions(text, cast) {
    const raw = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const result = JSON.parse(raw), known = new Set(cast.map(e => e.id)), used = new Set();
    if (!Array.isArray(result.actors)) throw new Error('Первый проход не вернул actors. Финальный запрос остановлен.');
    for (const actor of result.actors) {
        if (!actor || !known.has(actor.id) || used.has(actor.id) || typeof actor.participating !== 'boolean') throw new Error('Неверный или повторный персонаж в первом проходе.');
        used.add(actor.id);
        if (actor.participating && ['knowledge', 'beliefs', 'goal', 'withholds', 'reaction'].some(key => typeof actor[key] !== 'string' || !actor[key].trim()))
            throw new Error('Позиция участвующего ГП неполная. Финальный запрос остановлен.');
        for (const key of ['knowledge', 'beliefs', 'goal', 'withholds', 'reaction', 'line']) {
            if (actor[key] !== undefined && typeof actor[key] !== 'string') throw new Error(`Неверное поле ${key} в первом проходе.`);
        }
    }
    if (used.size !== known.size) throw new Error('Первый проход пропустил ГП; финальный запрос остановлен.');
    return result;
}

export function prepareFinal(base, cast, text, prompts) {
    const auxiliary = cast.length ? JSON.stringify(readPositions(text, cast)) : text.trim();
    if (!auxiliary) throw new Error('Первый проход вернул пустой ответ.');
    return [...structuredClone(base), { role: 'system', content: cast.length ? prompts.scene : prompts.edit },
        { role: 'user', content: JSON.stringify({ service_material_not_story: true, kind: cast.length ? 'character_positions' : 'draft', material: auxiliary,
            task: 'Return the final scene for the original latest player post, using the service material only as provisional suggestions.' }) }];
}
