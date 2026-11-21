const cache = new Map();
let popup, selected, generation = 0;
let activeQuestion;
const questionRateKey = 'questionPlaybackRate';
const minQuestionRate = 0.5, maxQuestionRate = 2;
let questionRate = Number(localStorage.getItem(questionRateKey)) || 1;
if (questionRate < minQuestionRate || questionRate > maxQuestionRate) questionRate = 1;

function changeQuestionRate(value, commit, source) {
  questionRate = Math.round(Math.max(minQuestionRate, Math.min(maxQuestionRate, value)) * 100) / 100;
  for (const player of document.querySelectorAll('.question-player')) {
    player.dispatchEvent(new CustomEvent('questionrate', { detail: { commit, source } }));
  }
  if (commit) localStorage.setItem(questionRateKey, String(questionRate));
}

export function stopSpeech() {
  const current = activeQuestion;
  activeQuestion = null;
  current?.pause();
  window.speechSynthesis?.cancel();
}
export function closeWord() {
  generation++;
  popup?.remove(); popup = null;
  selected?.classList.remove('word-selected'); selected?.setAttribute('aria-expanded', 'false'); selected = null;
}
export function speak(text, language) {
  if (!window.speechSynthesis) { alert('此瀏覽器未提供朗讀功能'); return; }
  if (document.querySelector('.record.live,.record-feedback.live')) return;
  stopSpeech();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === 'en' ? 'en-US' : language;
  utterance.onerror = event => { if (!['interrupted', 'canceled'].includes(event.error)) alert('目前無法播放語音，請確認裝置的語音設定'); };
  window.speechSynthesis.speak(utterance);
}
async function showWord(button) {
  closeWord(); selected = button;
  const ticket = generation;
  button.classList.add('word-selected'); button.setAttribute('aria-expanded', 'true');
  popup = document.createElement('aside');
  popup.className = 'word-popup notranslate'; popup.setAttribute('translate', 'no'); popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', '單字解釋');
  const head = document.createElement('div'); head.className = 'word-popup-head';
  const titleWrap = document.createElement('div'); titleWrap.className = 'word-popup-title';
  const heading = document.createElement('strong'); heading.textContent = button.textContent;
  const play = document.createElement('button'); play.type = 'button'; play.className = 'secondary word-popup-play'; play.textContent = '▶ English'; play.onclick = () => speak(button.textContent, 'en');
  titleWrap.append(heading, play);
  const actions = document.createElement('div'); actions.className = 'word-popup-actions';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'word-popup-close'; close.textContent = '×'; close.setAttribute('aria-label','關閉單字解釋'); close.onclick = () => { const target = selected; closeWord(); target?.focus(); };
  actions.append(close);
  head.append(titleWrap, actions);
  const content = document.createElement('div'); content.className = 'word-popup-body'; content.textContent = '讀取詞義…';
  popup.append(head, content);
  (document.fullscreenElement || document.body).append(popup);
  const rect = button.getBoundingClientRect();
  popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - popup.offsetWidth - 8))}px`;
  popup.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - popup.offsetHeight - 8))}px`;
  const language = localStorage.getItem('platformLanguage') || 'zh-TW';
  const key = `${button.textContent.toLowerCase()}:${language}`;
  try {
    let data = cache.get(key);
    if (!data) {
      const response = await fetch(`/api/dictionary?word=${encodeURIComponent(button.textContent)}&language=${encodeURIComponent(language)}`);
      data = await response.json(); if (!response.ok) throw new Error(data.error);
      cache.set(key, data);
    }
    if (ticket !== generation) return;
    content.replaceChildren();
    for (const meaning of data.meanings) { const p = document.createElement('p'); p.textContent = meaning; content.append(p); }
    const source = document.createElement('a'); source.textContent = data.source || '詞義來源'; source.href=data.sourceUrl; source.target='_blank'; source.rel='noopener noreferrer'; content.append(source);
    const note=document.createElement('small');note.textContent=data.note || (language==='en'?'':' · MyMemory 翻譯，供參考');content.append(note);
  } catch(e) { if (ticket === generation) content.textContent = e.message || '詞義暫時無法載入，請稍後重試'; }
}
function contextualCard(button, card, entry) {
  closeWord();
  selected = button;
  button.classList.add('word-selected');
  button.setAttribute('aria-expanded', 'true');
  popup = document.createElement('aside');
  popup.className = 'word-popup notranslate';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', '語境語塊卡');
  popup.setAttribute('translate', 'no');
  const head = document.createElement('div');
  head.className = 'word-popup-head';
  const titleWrap = document.createElement('div');
  titleWrap.className = 'word-popup-title';
  const title = document.createElement('strong');
  title.textContent = card.phrase || card.word;
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'secondary word-popup-play';
  play.textContent = '▶ 發音';
  play.onclick = () => speak(card.phrase || card.word, card.language);
  titleWrap.append(title, play);
  const actions = document.createElement('div');
  actions.className = 'word-popup-actions';
  let status;
  if (entry.allowSave) {
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'word-popup-save';
    save.textContent = '收藏單字';
    status = document.createElement('small');
    status.className = 'word-popup-status';
    status.setAttribute('role', 'status');
    save.onclick = async () => {
      save.disabled = true;
      status.textContent = '';
      try {
        await learningRequest('/api/student/vocabulary', { ...learningContext(entry), cardId: card.id }, entry.sessionToken);
        save.textContent = '已收藏';
        save.classList.add('is-saved');
      } catch (error) { status.textContent = error.message; save.disabled = false; }
    };
    actions.append(save);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'word-popup-close';
  close.textContent = '×';
  close.setAttribute('aria-label', '關閉單字卡');
  close.onclick = () => { closeWord(); button.focus(); };
  actions.append(close);
  head.append(titleWrap, actions);
  const body = document.createElement('div');
  body.className = 'word-popup-body';
  if (status) body.append(status);
  body.append(cardDetails(card));
  if (entry.onVocabularyEdited) {
    const teacherSection = document.createElement('div');
    teacherSection.className = 'word-popup-teacher';
    if (card.reviewFields?.length) {
      const review = document.createElement('p');
      review.className = 'word-card-review';
      review.textContent = '待教師補充：' + card.reviewFields.join('、');
      teacherSection.append(review);
    }
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'secondary';
    edit.textContent = '編輯語塊卡';
    edit.onclick = () => {
      edit.replaceWith(vocabularyForm(card, entry));
      popup.querySelector('input')?.focus({ preventScroll: true });
    };
    teacherSection.append(edit);
    body.append(teacherSection);
  }
  popup.append(head, body);
  (document.fullscreenElement || document.body).append(popup);
  const rect = button.getBoundingClientRect();
  popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - popup.offsetWidth - 8))}px`;
  popup.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - popup.offsetHeight - 8))}px`;
}

function vocabularyForm(card, entry) {
  const form = document.createElement('form');
  form.className = 'vocabulary-card-edit';
  const input = (name, label, value, multiline = false, limit = 350, required = true) => {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const control = document.createElement(multiline ? 'textarea' : 'input');
    control.name = name;
    control.value = value;
    control.maxLength = limit;
    if (multiline) control.rows = 3;
    control.required = required;
    wrapper.append(control);
    form.append(wrapper);
  };
  input('pronunciation', card.language === 'en' ? 'KK 音標' : '漢語拼音', card.pronunciation, false, 180);
  input('partOfSpeech', '詞性', card.partOfSpeech || '', false, 80, Boolean(card.partOfSpeech));
  input('baseForm', '原形', card.baseForm || '', false, 180, card.language === 'en' && Boolean(card.baseForm));
  if (card.language === 'en') {
    input('wordFamily', '詞族（每行一項：詞形｜詞性｜英文例句（中文翻譯））',
      (card.wordFamily || []).map(item => typeof item === 'string' ? item : [item.word, item.partOfSpeech, item.example].join('｜')).join('\n'),
      true, 3700, false);
    input('verbForms', '動詞三態（依序每行填寫原形、過去式、過去分詞）', (card.verbForms || []).join('\n'), true, 550, false);
  }
  input('meaning', '語境翻譯', card.meaning);
  input('usage', card.language === 'en' ? '英文使用情境' : '使用情境', card.usage || '');
  if (card.language === 'en') input('usageZh', '使用情境的中文解釋', card.usageZh || '', false, 350, Boolean(card.usageZh));
  input('examples', card.language === 'en' ? '例句（每行一個，英文後加上括號中文翻譯）' : '例句（每行一個）',
    card.examples.join('\n'), true, 1200, false);
  input('similar', '相似詞（每行一個）', card.similar.join('\n'), true, 1200, false);
  const save = document.createElement('button');
  save.textContent = '儲存語塊卡';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  form.append(save, status);
  form.onsubmit = async event => {
    event.preventDefault();
    save.disabled = true;
    const fields = Object.fromEntries(new FormData(form));
    try {
      const reply = await fetch('/api/teacher/question-vocabulary/' + encodeURIComponent(entry.questionId), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, revision: entry.revision, cardId: card.id,
          examples: fields.examples.split('\n'), similar: fields.similar.split('\n'),
          wordFamily: (fields.wordFamily || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
            const [word, partOfSpeech, ...example] = line.split('｜');
            return partOfSpeech === undefined ? line : { word, partOfSpeech, example: example.join('｜') };
          }),
          verbForms: (fields.verbForms || '').split('\n').filter(line => line.trim()) }),
      });
      const result = await reply.json();
      if (!reply.ok) throw Error(result.error || '無法儲存語塊卡');
      closeWord();
      entry.onVocabularyEdited(result.revision);
    } catch (error) {
      status.textContent = error.message;
      save.disabled = false;
    }
  };
  return form;
}

function cardDetails(card) {
  const container = document.createElement('div');
  container.className = 'word-card-details';

  const meta = document.createElement('div');
  meta.className = 'word-card-meta';
  const addChip = (label, value, accent = '') => {
    if (!value) return;
    const chip = document.createElement('span');
    chip.className = 'word-card-chip' + (accent ? ` ${accent}` : '');
    const key = document.createElement('span');
    key.className = 'word-card-chip-label';
    key.textContent = label;
    const text = document.createElement('span');
    text.textContent = value;
    chip.append(key, text);
    meta.append(chip);
  };
  addChip(card.language === 'en' ? 'KK 音標' : '拼音', card.pronunciation, 'is-pron');
  addChip('詞性', card.partOfSpeech, 'is-pos');
  addChip('原形', card.baseForm);
  addChip('動詞三態', card.verbForms?.join(' – '));
  if (meta.childElementCount) container.append(meta);

  const meaningSection = document.createElement('div');
  meaningSection.className = 'word-card-section word-card-meaning';
  const appendLine = (parent, label, value, cls = '') => {
    if (!value) return;
    const line = document.createElement('p');
    if (cls) line.className = cls;
    const title = document.createElement('b');
    title.textContent = label;
    const text = document.createElement('span');
    text.textContent = value;
    line.append(title, text);
    parent.append(line);
  };
  appendLine(meaningSection, card.language === 'en' ? '上下文中文意思' : '上下文英文意思', card.meaning, 'word-card-primary-meaning');
  appendLine(meaningSection, card.language === 'en' ? '英文使用情境' : '中文使用情境', card.usage);
  if (card.language === 'en') appendLine(meaningSection, '使用情境的中文解釋', card.usageZh);
  if (meaningSection.childElementCount) container.append(meaningSection);

  if (card.examples.length) {
    const section = document.createElement('div');
    section.className = 'word-card-section word-card-examples';
    const label = document.createElement('b');
    label.className = 'word-card-section-title';
    label.textContent = `例句（${card.cefr}）`;
    const list = document.createElement('ul');
    list.setAttribute('aria-label', `例句（${card.cefr}）`);
    for (const example of card.examples) {
      const item = document.createElement('li');
      item.textContent = example;
      list.append(item);
    }
    section.append(label, list);
    container.append(section);
  }

  if (card.wordFamily?.length) {
    const section = document.createElement('div');
    section.className = 'word-card-section word-card-family';
    const title = document.createElement('b');
    title.className = 'word-card-section-title';
    title.textContent = '詞族與詞形變化';
    const list = document.createElement('ul');
    for (const family of card.wordFamily) {
      const item = document.createElement('li');
      if (typeof family === 'string') item.textContent = family;
      else {
        const word = document.createElement('b');
        word.textContent = `${family.word}（${family.partOfSpeech}）`;
        const example = document.createElement('div');
        example.className = 'word-card-family-example';
        example.textContent = family.example;
        item.append(word, example);
      }
      list.append(item);
    }
    section.append(title, list);
    container.append(section);
  }

  if (card.similar?.length) {
    const section = document.createElement('div');
    section.className = 'word-card-section word-card-similar';
    const label = document.createElement('b');
    label.className = 'word-card-section-title';
    label.textContent = `相似詞（${card.cefr}）`;
    const chips = document.createElement('div');
    chips.className = 'word-card-similar-list';
    for (const item of card.similar) {
      const tag = document.createElement('span');
      tag.className = 'word-card-similar-chip';
      tag.textContent = item;
      chips.append(tag);
    }
    section.append(label, chips);
    container.append(section);
  }

  return container;
}

function learningContext(entry) {
  return { questionId: entry.questionId, code: entry.code, sessionId: entry.sessionId };
}

async function learningRequest(path, data, token) {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Session-Token': token } : {}) },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '無法載入單字卡');
  return result;
}

const audioPreviews = new Map();
const audioObserver = new MutationObserver(() => {
  if (activeQuestion && !activeQuestion.element.isConnected) stopSpeech();
  for (const [element, url] of audioPreviews) if (!element.isConnected) { element.pause(); URL.revokeObjectURL(url); audioPreviews.delete(element); }
});
audioObserver.observe(document.body, { childList: true, subtree: true });

function questionPlayer(text, language, words, highlight) {
  const element = document.createElement('span');
  element.className = 'question-player';
  const sentenceEnds = Array.from(new Intl.Segmenter(language, { granularity: 'sentence' }).segment(text),
    sentence => sentence.index + sentence.segment.length);
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'question-read';
  const seek = document.createElement('input');
  seek.type = 'range'; seek.min = 0; seek.max = words.length; seek.step = 1;
  seek.setAttribute('aria-label', '即時朗讀字詞進度');
  const progress = document.createElement('span');
  const speed = document.createElement('span');
  speed.className = 'question-rate';
  const rateLabel = document.createElement('label');
  rateLabel.textContent = '語速 ';
  const rate = document.createElement('input');
  rate.type = 'number';
  rate.inputMode = 'decimal';
  rateLabel.append(rate, '×');
  const rateSlider = document.createElement('input');
  rateSlider.type = 'range';
  rateSlider.setAttribute('aria-label', '語速滑桿');
  for (const input of [rate, rateSlider]) {
    input.min = minQuestionRate;
    input.max = maxQuestionRate;
    input.step = '0.01';
    input.value = questionRate;
  }
  rate.oninput = () => {
    if (rate.valueAsNumber >= minQuestionRate && rate.valueAsNumber <= maxQuestionRate)
      changeQuestionRate(rate.valueAsNumber, false, rate);
  };
  const saveTypedRate = () => changeQuestionRate(Number.isFinite(rate.valueAsNumber) ? rate.valueAsNumber : questionRate, true);
  rate.onchange = saveTypedRate;
  rate.onkeydown = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    saveTypedRate();
    rate.blur();
  };
  rateSlider.oninput = () => changeQuestionRate(rateSlider.valueAsNumber, false);
  rateSlider.onchange = () => changeQuestionRate(rateSlider.valueAsNumber, true);
  speed.append(rateLabel, rateSlider);
  let position = 0, utterance, estimateTimer, resumeAfterSeek = false, tracking = false;
  const playback = { element, pause() { clearInterval(estimateTimer); utterance = null; update(); } };
  function update() {
    const playing = activeQuestion === playback;
    play.textContent = playing ? 'Ⅱ' : '▶';
    play.setAttribute('aria-label', playing ? '暫停題目朗讀' : '播放題目朗讀');
    seek.value = position;
    progress.textContent = `${tracking ? Math.min(position + 1, words.length) : 0} / ${words.length} 詞`;
    seek.setAttribute('aria-valuetext', progress.textContent);
    highlight(tracking ? Math.min(position, words.length - 1) : -1);
  }
  function read(offset = position === 0 ? 0 : words[position]) {
    // Give the voice enough context for natural phrasing. Only break between sentences.
    let sentence = sentenceEnds.findIndex(end => end > offset);
    while (sentenceEnds[sentence + 1] - offset <= 180) sentence++;
    const endOffset = sentenceEnds[sentence] ?? text.length;
    let end = position;
    while (end < words.length && words[end] < endOffset) end++;
    const phrase = new SpeechSynthesisUtterance(text.slice(offset, endOffset));
    phrase.lang = language === 'en' ? 'en-US' : language;
    phrase.rate = questionRate;
    utterance = phrase;
    const start = position;
    const wordStarts = [0];
    for (let index = start; index < end - 1; index++) {
      const span = text.slice(words[index], words[index + 1]);
      const letters = (span.match(/[\p{L}\p{N}]/gu) || []).length;
      const estimate = language === 'en' ? 210 + 38 * letters : 205 * Math.max(1, letters);
      const pause = /[.!?。！？]/u.test(span) ? 230 : /[,，、;；]/u.test(span) ? 110 : 0;
      wordStarts.push(wordStarts.at(-1) + (estimate + pause) / phrase.rate);
    }
    phrase.onstart = () => {
      if (utterance !== phrase) return;
      const started = performance.now();
      estimateTimer = setInterval(() => {
        if (utterance !== phrase) return;
        const elapsed = performance.now() - started;
        let next = position;
        while (next + 1 < end && wordStarts[next + 1 - start] <= elapsed) next++;
        if (next !== position) { position = next; update(); }
      }, 65);
    };
    phrase.onboundary = event => {
      if (utterance !== phrase || (event.name && event.name !== 'word') || !Number.isInteger(event.charIndex)) return;
      let next = start;
      while (next + 1 < end && words[next + 1] <= offset + event.charIndex) next++;
      if (next === start) return;
      clearInterval(estimateTimer);
      position = next;
      update();
    };
    phrase.onend = () => {
      if (utterance !== phrase) return;
      clearInterval(estimateTimer);
      position = end;
      if (endOffset < text.length && end < words.length && element.isConnected) { update(); read(endOffset); }
      else stopSpeech();
    };
    phrase.onerror = event => {
      if (utterance !== phrase) return;
      stopSpeech();
      if (!['interrupted', 'canceled'].includes(event.error)) progress.textContent = '即時朗讀暫時無法播放';
    };
    window.speechSynthesis.speak(phrase);
  }
  function start() {
    if (!window.speechSynthesis) { progress.textContent = '瀏覽器未提供即時朗讀'; return; }
    if (document.querySelector('.record.live,.record-feedback.live')) return;
    stopSpeech();
    activeQuestion = playback;
    tracking = true;
    element.dispatchEvent(new Event('questionplay', { bubbles: true }));
    update();
    read();
  }
  play.onclick = () => {
    if (activeQuestion === playback) { stopSpeech(); return; }
    if (position === words.length) position = 0;
    start();
  };
  seek.oninput = () => {
    position = Number(seek.value);
    tracking = true;
    if (activeQuestion === playback) { resumeAfterSeek = true; stopSpeech(); }
    update();
  };
  seek.onchange = () => {
    if (resumeAfterSeek && position < words.length) start();
    resumeAfterSeek = false;
  };
  const controls = { element, play, seek, progress, words, highlight,
    applyRate(commit) {
      if (commit && activeQuestion === playback && Math.abs(utterance.rate - questionRate) > 0.0001) start();
    } };
  element.addEventListener('questionrate', ({ detail }) => {
    if (detail.source !== rate) rate.value = questionRate;
    rateSlider.value = questionRate;
    rateSlider.setAttribute('aria-valuetext', `${questionRate}×`);
    controls.applyRate(detail.commit);
  });
  rateSlider.setAttribute('aria-valuetext', `${questionRate}×`);
  element.append(play, seek, progress, speed);
  update();
  return controls;
}

function installQuestionAudio(controls, url, token) {
  const { element, play, seek, progress, words, highlight } = controls;
  const audio = document.createElement('audio');
  audio.hidden = true;
  audio.preload = 'metadata';
  audio.dataset.playbackReady = 'true';
  const playback = { element, pause: () => audio.pause() };
  let scrubbing = false;
  const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  function showPosition(position) {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    seek.disabled = !duration;
    seek.max = duration;
    seek.value = position;
    progress.textContent = `${time(position)} / ${time(duration)}`;
    seek.setAttribute('aria-valuetext', progress.textContent);
    highlight(duration ? Math.min(words.length - 1, Math.floor(position / duration * words.length)) : -1);
  }
  function showPlayback() {
    play.textContent = audio.paused ? '▶' : 'Ⅱ';
    play.setAttribute('aria-label', audio.paused ? '播放題目朗讀音檔' : '暫停題目朗讀音檔');
  }
  audio.onplay = () => {
    if (activeQuestion === playback) return;
    stopSpeech();
    activeQuestion = playback;
    element.dispatchEvent(new Event('questionplay', { bubbles: true }));
    showPlayback();
  };
  audio.onpause = () => {
    if (activeQuestion === playback && audio.paused) activeQuestion = null;
    showPlayback();
  };
  audio.ontimeupdate = audio.ondurationchange = () => { if (!scrubbing) showPosition(audio.currentTime); };
  audio.onerror = () => { progress.textContent = '無法播放朗讀音檔'; };
  seek.step = 'any';
  seek.setAttribute('aria-label', '題目朗讀音檔播放進度');
  seek.oninput = () => { scrubbing = true; showPosition(Number(seek.value)); };
  seek.onchange = () => { audio.currentTime = Number(seek.value); scrubbing = false; };
  const note = document.createElement('small');
  note.textContent = '音檔對應字詞為約略定位';
  element.append(audio, note);
  showPosition(0);
  const playAudio = async () => {
    if (!audio.paused) { audio.pause(); return; }
    try { await audio.play(); }
    catch (error) {
      progress.textContent = error.name === 'NotAllowedError' ? '音檔已載入，請再按一次播放' : '無法播放朗讀音檔';
    }
  };
  const install = source => {
    audio.src = source;
    audio.playbackRate = questionRate;
    play.onclick = playAudio;
    showPlayback();
  };
  if (activeQuestion?.element === element) stopSpeech();
  controls.applyRate = () => { audio.playbackRate = questionRate; };
  if (!token) { install(url); return; }
  play.setAttribute('aria-label', '載入題目朗讀音檔');
  progress.textContent = '播放後可拖曳進度';
  play.onclick = async () => {
    play.disabled = true;
    try {
      const response = await fetch(url, { headers: { 'X-Session-Token': token } });
      if (!response.ok) throw Error('無法載入題目朗讀音檔');
      const blob = await response.blob();
      if (!play.isConnected) return;
      const objectUrl = URL.createObjectURL(blob);
      audioPreviews.set(audio, objectUrl);
      install(objectUrl);
      await playAudio();
    } catch (error) { progress.textContent = error.message; }
    finally { play.disabled = false; }
  };
}

export async function showVocabulary(root, request) {
  const view = document.createElement('section');
  view.textContent = '讀取單字庫…';
  root.replaceChildren(view);
  try {
    const { cards } = await request('/api/student/vocabulary');
    if (!root.contains(view)) return;
    view.innerHTML = `<div class="vocabulary-toolbar">
      <label>搜尋單字<input type="search" placeholder="輸入部分拼寫，例如 ad" spellcheck="false"></label>
      <label>排序<select>
        <option value="recent">收藏日期：新到舊</option>
        <option value="oldest">收藏日期：舊到新</option>
        <option value="az">拼寫：A 到 Z</option>
        <option value="za">拼寫：Z 到 A</option>
        <option value="shortest">長度：短到長</option>
        <option value="longest">長度：長到短</option>
      </select></label>
    </div><p class="vocabulary-results muted" role="status"></p><div class="vocabulary-list"></div>`;
    const search = view.querySelector('input'), sort = view.querySelector('select');
    const status = view.querySelector('.vocabulary-results'), list = view.querySelector('.vocabulary-list');
    const collator = new Intl.Collator(['en', 'zh-TW'], { sensitivity: 'base', numeric: true });
    const dateFormat = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeZone: 'Asia/Taipei' });
    const normalize = value => value.normalize('NFKC').toLowerCase();
    const entries = new Map(cards.map(card => {
      const label = card.phrase || card.word || '';
      const key = normalize(label);
      const length = (key.match(/[\p{L}\p{N}]/gu) || []).length;
      const saved = Date.parse(card.savedAt);
      const row = document.createElement('details');
      row.className = 'item vocabulary-item';
      const title = document.createElement('summary');
      const word = document.createElement('span');
      word.className = 'vocabulary-word';
      word.textContent = label;
      const meta = document.createElement('small');
      meta.className = 'muted vocabulary-meta';
      meta.textContent = Number.isFinite(saved) ? `${dateFormat.format(saved)} · ${length} 字元` : `${length} 字元`;
      title.append(word, meta);
      const body = document.createElement('div');
      body.className = 'vocabulary-item-body';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger';
      remove.textContent = '移除收藏';
      remove.onclick = async () => {
        remove.disabled = true;
        try {
          await request('/api/student/vocabulary?card=' + encodeURIComponent(card.id), { method: 'DELETE' });
          entries.delete(card.id);
          render();
        } catch (error) { alert(error.message); remove.disabled = false; }
      };
      const footer = document.createElement('div');
      footer.className = 'vocabulary-item-actions';
      footer.append(remove);
      body.append(cardDetails(card), footer);
      row.append(title, body);
      return [card.id, { row, label, key, length, saved: Number.isFinite(saved) ? saved : 0 }];
    }));
    const comparators = {
      recent: (a, b) => b.saved - a.saved,
      oldest: (a, b) => a.saved - b.saved,
      az: (a, b) => collator.compare(a.label, b.label),
      za: (a, b) => collator.compare(b.label, a.label),
      shortest: (a, b) => a.length - b.length,
      longest: (a, b) => b.length - a.length,
    };
    function render() {
      const query = normalize(search.value.trim());
      const compare = comparators[sort.value] || comparators.recent;
      const matched = Array.from(entries.values()).filter(entry => entry.key.includes(query))
        .sort((a, b) => compare(a, b) || collator.compare(a.label, b.label) || b.saved - a.saved);
      list.replaceChildren(...matched.map(entry => entry.row));
      status.textContent = matched.length ? `顯示 ${matched.length} / ${entries.size} 筆收藏`
        : entries.size ? '找不到相符的單字。' : '尚無收藏的單字。';
    }
    search.addEventListener('input', render);
    sort.addEventListener('change', render);
    render();
  } catch (error) { view.textContent = error.message; }
}

export function enhanceQuestion(element, language = 'en', entry) {
  if (!element || element.dataset.enhanced) return;
  element.dataset.enhanced = 'true'; element.classList.add('notranslate'); element.setAttribute('translate','no');
  const text = element.textContent;
  element.replaceChildren();
  const segments = Array.from(new Intl.Segmenter(language, { granularity: 'word' }).segment(text)).filter(segment => segment.isWordLike);
  const words = segments.length ? segments.map(segment => segment.index) : [0];
  let marks = [], activeWord = -1;
  function highlight(index) {
    for (const mark of marks[activeWord] || []) mark.classList.remove('question-current-word');
    activeWord = index;
    for (const mark of marks[index] || []) mark.classList.add('question-current-word');
  }
  function wordSlice(start, end) {
    const nodes = [];
    let cursor = start;
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      if (segment.index >= end) break;
      const left = Math.max(start, segment.index), right = Math.min(end, segment.index + segment.segment.length);
      if (left >= right) continue;
      if (cursor < left) nodes.push(document.createTextNode(text.slice(cursor, left)));
      const span = document.createElement('span');
      span.textContent = text.slice(left, right);
      if (index === activeWord) span.classList.add('question-current-word');
      (marks[index] ||= []).push(span);
      nodes.push(span);
      cursor = right;
    }
    if (cursor < end) nodes.push(document.createTextNode(text.slice(cursor, end)));
    return nodes;
  }
  const player = questionPlayer(text, language, words, highlight);
  element.append(player.element);
  if (entry?.questionId) {
    element.append(...wordSlice(0, text.length));
    learningRequest('/api/learning/context', learningContext(entry), entry.sessionToken).then(({ cards, audioUrl }) => {
      if (!element.isConnected) return;
      const nodes = [player.element];
      const entries = new Map();
      let offset = 0;
      marks = [];
      for (const card of cards) {
        if (card.start < offset || text.slice(card.start, card.end) !== card.word) continue;
        nodes.push(...wordSlice(offset, card.start));
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'question-word';
        button.append(...wordSlice(card.start, card.end));
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');
        button.onclick = () => {
          if (!button.getAttribute('aria-expanded') || button.getAttribute('aria-expanded') === 'false')
            contextualCard(button, card, entry);
        };
        entries.set(button, card);
        nodes.push(button);
        offset = card.end;
      }
      nodes.push(...wordSlice(offset, text.length));
      element.replaceChildren(...nodes);
      if (entries.size) element.addEventListener('pointerup', () => {
        const selection = window.getSelection();
        if (!selection?.rangeCount || selection.isCollapsed || !selection.toString().trim()) return;
        const range = selection.getRangeAt(0);
        if (!element.contains(range.commonAncestorContainer)) return;
        const matches = [...entries].filter(([button]) => range.intersectsNode(button));
        if (matches.length !== 1) return;
        const [button, card] = matches[0];
        if (card.word.toLocaleLowerCase().includes(selection.toString().trim().toLocaleLowerCase()))
          contextualCard(button, card, entry);
      });
      if (audioUrl) installQuestionAudio(player, audioUrl, entry.sessionToken);
    }).catch(() => {});
    return;
  }
  let offset = 0;
  for (const match of language === 'en' ? text.matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) : []) {
    const end = match.index + match[0].length;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'question-word'; button.append(...wordSlice(match.index, end)); button.setAttribute('aria-haspopup','dialog'); button.setAttribute('aria-expanded','false'); button.onclick = () => showWord(button);
    element.append(...wordSlice(offset, match.index), button);
    offset = end;
  }
  element.append(...wordSlice(offset, text.length));
}
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeWord(); });
document.addEventListener('pointerdown', e => { if(popup && !popup.contains(e.target) && !selected?.contains(e.target)) closeWord(); });
window.addEventListener('scroll', event => {
  if (!(event.target instanceof Node) || !popup?.contains(event.target)) closeWord();
}, true);
window.addEventListener('resize', closeWord);
