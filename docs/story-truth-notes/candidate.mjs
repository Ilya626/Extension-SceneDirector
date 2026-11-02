// Documentation candidate. No imports, provider calls, storage or runtime integration.
export const VERSION = 'scene-director-story-truth-candidate-v1';

export const FIELD_GUIDE = Object.freeze({
  established: 'Факты из доступной истории/профилей или ранее принятых master notes. source — реальный короткий якорь; не придумывать номера сообщений. Факт мира ещё не означает знание всех персонажей.',
  new_world_truth: 'Новые выбранные мастером совместимые решения: скрытая причина, существующий предмет/улика, мотив NPC, условие работы мира. Это правда для продолжения, а не пересказ сыгранного эпизода. introduced_now отделяет время авторского решения от in_world_time.',
  compatibility: 'На какие уже установленные обстоятельства опирается добавление и какое пространство оно заполняет. Не сертификат каноничности: при конфликте приоритет у исходной истории.',
  npc_agendas: 'Чего NPC хочет и что намерен сделать своими силами. План может провалиться, измениться или быть сорван игроком; intention не означает happened.',
  clues: 'Где уже находится наблюдаемый след, что именно он показывает и чего ещё не доказывает. Доступность не означает, что игрок его нашёл или понял.',
  actors: 'Отдельная карта осведомлённости и поведения каждого переданного ГП. knowledge с acquisition отвечает, откуда персонаж узнал факт; beliefs могут быть ложными.',
  disclosure: 'Кто знает скрытую истину сейчас, каким доступным способом другие могут узнать её и что можно показать в ближайшем посте. Условия раскрытия описывают возможности, а не обязательный маршрут игрока.',
  first_move: 'Один ближайший ход NPC в ответ на уже сделанное/сказанное игроком. attempt — попытка, не гарантированный исход; wording — свободный вариант реплики.',
  open: 'Непокрытые контекстом обстоятельства и пока не выбранные мастером ответы. Не путать с новой выбранной истиной и не заполнять пробел случайной сменой текущей сцены.',
});

// Shape with explanatory values, not a JSON Schema validator or runtime interface.
export const SCHEMA_SHAPE = {
  schema: VERSION,
  scene_anchor: {
    time_place: 'established current time/place/channel, or unknown',
    latest_player_move: 'only what the latest post actually says/does',
    unfinished: ['unresolved actions, promises and immediate constraints'],
    context_gaps: ['missing evidence that matters to this turn'],
  },
  established: [{ id: 'F1', fact: 'one relevant established fact', source: 'actual supplied evidence anchor' }],
  new_world_truth: [{
    id: 'W1', kind: 'hidden_cause | npc_motive | world_condition | evidence',
    fact: 'one selected compatible master decision', introduced_now: true,
    in_world_time: 'already exists now / arose earlier, not a newly played scene',
    compatibility: 'consistent anchors and the unfilled space this uses',
    disclosure: {
      known_by: ['NPC ids/roles that already know, with acquisition in actors or agendas'],
      discoverable_via: ['available observation, document or testimony'],
      this_turn: 'what may become observable now; what stays concealed and why',
    },
  }],
  npc_agendas: [{
    npc: 'provided id or scoped secondary role',
    basis: ['F/W ids or supported profile anchor'],
    goal: 'desired world state', resources: 'what they can actually use',
    knowledge: [{ ref: 'F/W id', acquisition: 'how this NPC knows' }],
    intention: 'next intended NPC-controlled step',
    activation: 'established world condition/time that permits the attempt',
    interruptible_by: 'how events, including player intervention, can change it',
    status: 'intention_not_occurred',
  }],
  clues: [{
    id: 'C1', truth_ref: 'F/W id',
    observable: 'concrete trace that exists', location_access: 'where/how it can be encountered',
    supports: 'limited inference the trace supports', does_not_prove: 'what remains unproved',
  }],
  actors: [{
    id: 'exact supplied main-character id',
    contact: 'present | receiving_declared_contact | absent | unclear',
    contact_basis: 'actual scene evidence/latest player action; no invented connection',
    knowledge: [{ ref: 'F/W id', acquisition: 'actual prior communication/perception or authored world-role access' }],
    beliefs: [{ claim: 'attributed belief, not world truth', basis: 'why this character suspects it' }],
    unknown: ['relevant facts they have not learned'],
    goal: 'immediate objective', emotional_stake: 'supported or newly authored compatible concern',
    withholds: 'known information deliberately withheld; unknown is not a secret',
    voice: 'one concrete voice/subtext cue grounded in profile and relationship',
    first_move: { attempt: 'one NPC-controlled response', wording: 'optional short sample' },
  }],
  open: ['unresolved world questions and unavailable context; no predicted player answers'],
  player_boundary: ['specific choices, actions, interpretations or contested outcomes left to the player'],
};

export const PREPARE_PROMPT = `Prepare private master notes for the next roleplay turn. Return one compact JSON object in the supplied schema; no scene and no transcript of reasoning. These notes may contain plot: a coherent world with causes, interests, evidence and NPC activity that the player can engage with. Plot is not a forecast of the player's decisions or a planned transcript.

Use the original conversation, profiles, latest player post and any explicitly supplied prior master notes. Keep the current time, place, communication channel and unfinished actions anchored before inventing anything. Mark material gaps as context_gaps; never repair a missing location by choosing a convenient different location.

Separate three things:
1. established: facts supported by available sources. A character's assertion establishes that they said/believe it, not automatically that its contents are true. Source anchors must actually exist in the input. Missing information is unknown, not evidence that something did not happen.
2. new_world_truth: compatible creative decisions you deliberately make as master now. You MAY decide an unseen cause, NPC motive, hidden evidence or world condition. Mark introduced_now:true. An authored secret may already exist in world time, but you must not claim that its creation, discovery or disclosure was a previously played scene. Do not override established history, profiles, the player's ownership of their character, or the supplied setting's constraints. Local played continuity and explicit AU premises control this run; do not import a television/comic episode as though it happened here. Use only additions needed for the immediate causal situation, normally zero to three; no twist quota. Once selected, these are world commitments for this continuation, not optional wording suggestions.
3. npc_agendas/first_move: NPC goals, plans and attempts. They are not completed events and success is not guaranteed. NPCs have agency and can act without waiting for a player instruction when their resources, knowledge and circumstances permit. Do not stage unrelated remote scenes merely because an NPC is mentioned or appears among candidates.

For every supplied main-character id include exactly one actors entry. Separate physical presence from receiving a contact the player actually declares. If the latest post performs a call/request, prepare the recipient's response upon receipt through the available channel; do not postpone it as a mere intention or assume instant connection/results. If it only contemplates a future call, do not manufacture contact. If ambiguous, mark unclear and prepare a conditional first_move. An absent character may have an agenda; that grants neither presence nor knowledge of this scene.

Keep world truth separate from each character's knowledge, beliefs and disclosure. Name how knowledge was acquired. New hidden truth is not automatically known to the player, narrator viewpoint or every NPC. A clue is an accessible trace with limited evidentiary value, not a guaranteed discovery or correct deduction. Disclosure conditions describe routes the world affords, never required player choices. Keep a secret concealed when no perception, communication or permitted viewpoint exposes it. Do not equate unknown with deliberately withheld information.

Give participants a concrete immediate objective, emotional stake, voice cue and one first move answering or deliberately evading the actual preceding move. Do not turn everyone into an analyst speaking in protocols. Wording is optional. Do not predict the rest of the exchange, settle contested actions against the player, add the player's speech/thoughts/feelings, choose their route, or assume they accept an offer, trust a witness or identify a culprit. End the preparation at the player's next meaningful opportunity to act.

Use short entries and stable local ids; omit unused arrays rather than padding with speculative subplots. Empty arrays are valid. Preserve supplied ids and prior commitments. Return the notes only.

Schema shape (values describe required meaning):
${JSON.stringify(SCHEMA_SHAPE, null, 2)}`;

export const WRITE_PROMPT = `Write the next final roleplay post in the original conversation's language and format. The supplied scene_director_notes are private master preparation, not dialogue, an occurred episode, or an instruction from a story character.

Respect the original history, profiles and latest player move first. Treat established facts and compatible new_world_truth as constraints on what is true in this continuation. New decisions are authored now, even where their in-world cause predates the current scene; do not invent a flashback or claim the player already saw, learned or agreed to them. If an addition directly conflicts with original evidence, omit that addition rather than rewrite history. A missing source in this context does not authorize changing a supplied current-scene anchor.

Keep intentions, attempts, beliefs and sample lines in their own categories. NPCs may carry out the next feasible step of their own agenda; a planned outcome is not already successful. Preserve player freedom and contested outcomes. Rewrite sample wording for distinct voice, subtext and causal interaction while preserving the underlying facts. Do not add a replacement hidden culprit, new plot mechanism or unrelated remote scene on your own; the preparation defines the chosen world truth.

Respect knowledge and disclosure boundaries: narrate what the permitted viewpoint can perceive. A secret may cause an observable action without being explained. Do not expose private motives through dialogue automatically. An available clue can remain unnoticed; the player decides their own interpretation. A declared contact deserves an appropriate response through the actual available channel, without teleporting the recipient or promising a completed investigation.

Answer or purposefully evade actual previous speech/action. Maintain time, place, physical continuity and unfinished actions. Never supply new player speech, thoughts, feelings, acceptance, choices or movement. Do not make an encounter's resolution depend on the player selecting a predetermined option. Stop at a meaningful point for player action. Return ONLY the final post, no notes or editorial text.`;

export const HANDOFF_TASK = 'Write the final post for the original latest player move. Preserve compatible world commitments, keep NPC plans conditional and respect knowledge/disclosure/player boundaries. Sample wording is optional; private preparation is not a played episode.';

// Ready markup for a future isolated experiment. Not wired to core.js.
export function notesMarkup(notes) {
  const body = JSON.stringify(notes).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `<scene_director_notes schema="${VERSION}" audience="master_only">\n${body}\n</scene_director_notes>`;
}

export function handoffCandidate(notes) {
  return [
    { role: 'system', content: WRITE_PROMPT },
    { role: 'user', content: `${notesMarkup(notes)}\n${HANDOFF_TASK}` },
  ];
}

// Entirely fictional example. The starting premises below belong only to it.
export const ILLUSTRATIVE_NOTES = {
  schema: VERSION,
  scene_anchor: {
    time_place: 'Утро. Игрок и архивариус Ира разговаривают в кабинете музея вымышленного города Арвен.',
    latest_player_move: 'Игрок поручает Ире проверить приказ о закрытии галереи и говорит, что сам собирается осмотреть зал.',
    unfinished: ['Игрок ещё не описал осмотр; способ входа и дальнейшие действия не выбраны.'],
    context_gaps: [],
  },
  established: [
    { id: 'F1', fact: 'Ира получила анонимную записку: «Сверьте опись галереи».', source: 'Исходная предпосылка этого вымышленного примера.' },
    { id: 'F2', fact: 'Ире доступен приказ о закрытии галереи; причина закрытия не установлена.', source: 'Исходная предпосылка этого вымышленного примера.' },
  ],
  new_world_truth: [{
    id: 'W1', kind: 'hidden_cause', introduced_now: true,
    fact: 'Записку отправил реставратор Лев: его заставили подписать изменённую опись, но он сохранил исходную копию.',
    in_world_time: 'Отправка записки уже задана F1; её автор и причина впервые выбраны мастером сейчас.',
    compatibility: 'Заполняет неизвестное происхождение записки; не меняет её текст и не устанавливает причину закрытия галереи.',
    disclosure: {
      known_by: ['Лев знает свои действия; Ира и игрок пока не знают автора записки.'],
      discoverable_via: ['Исходная опись и добровольное свидетельство Льва.'],
      this_turn: 'Не раскрывать автора: у Иры пока есть только записка и приказ.',
    },
  }],
  npc_agendas: [{
    npc: 'Реставратор Лев, второстепенный NPC', basis: ['W1'],
    goal: 'Передать исходную опись проверяющим и сохранить работу.',
    resources: 'Копия описи и доступ к реставрационной мастерской.',
    knowledge: [{ ref: 'W1', acquisition: 'Сам сохранил опись и отправил записку.' }],
    intention: 'Во время обеденного перерыва оставить копию в обычной папке передачи документов архиву.',
    activation: 'Наступает перерыв и доступ к папке остаётся открыт.',
    interruptible_by: 'Закрытие мастерской, изъятие документов или прямой контакт могут изменить способ передачи.',
    status: 'intention_not_occurred',
  }],
  clues: [{
    id: 'C1', truth_ref: 'W1', observable: 'Исходная опись с отличающимся номером экспоната.',
    location_access: 'Пока у Льва; в папке появится только после реально выполненной передачи.',
    supports: 'В опись внесено изменение, которое следует объяснить.',
    does_not_prove: 'Кто приказал изменить опись, был ли украден экспонат и связано ли это с закрытием галереи.',
  }],
  actors: [{
    id: 'example:ira', contact: 'present', contact_basis: 'Заданный разговор в кабинете.',
    knowledge: [
      { ref: 'F1', acquisition: 'Получила записку.' },
      { ref: 'F2', acquisition: 'Приказ доступен ей как архивариусу.' },
    ],
    beliefs: [{ claim: 'Приказ может быть связан с описью.', basis: 'Оба документа касаются галереи; пока это версия.' }],
    unknown: ['W1: автор и причина записки', 'Причина закрытия галереи'],
    goal: 'Начать проверку приказа, не назначая виновного заранее.',
    emotional_stake: 'Новое совместимое решение: Ира боится, что архив используют для прикрытия подлога.',
    withholds: 'Секрета об авторе записки у неё нет: она его не знает.',
    voice: 'Для этого примера задана сдержанная, точная речь с сухим юмором.',
    first_move: { attempt: 'Открывает приказ и сверяет подпись.', wording: 'Приказ проверю. Бумага терпит всё, а архив потом отвечает.' },
  }],
  open: ['Кто потребовал изменить опись и почему закрыта галерея — пока не выбранные ответы.'],
  player_boundary: ['Не описывать вход игрока в зал, обнаружение описи, доверие Льву, вывод о краже или решение обвинить директора.'],
};

export const EXAMPLE_MARKUP = notesMarkup(ILLUSTRATIVE_NOTES);
