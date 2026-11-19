const cache = new Map();
let popup, selected, generation = 0;
export function stopSpeech() { window.speechSynthesis?.cancel(); }
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
  const heading = document.createElement('strong'); heading.textContent = button.textContent;
  const play = document.createElement('button'); play.textContent = '▶ English'; play.onclick = () => speak(button.textContent, 'en');
  const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label','關閉單字解釋'); close.onclick = () => { const target = selected; closeWord(); target?.focus(); };
  const content = document.createElement('div'); content.textContent = '讀取詞義…';
  popup.append(heading, play, close, content);
  (document.fullscreenElement || document.body).append(popup);
  const rect = button.getBoundingClientRect();
  popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - popup.offsetWidth - 8))}px`;
  popup.style.top = `${Math.min(rect.bottom + 8, Math.max(8, innerHeight - 280))}px`;
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
  const title = document.createElement('strong');
  title.textContent = card.phrase || card.word;
  const play = document.createElement('button');
  play.textContent = '▶ 發音';
  play.onclick = () => speak(card.phrase || card.word, card.language);
  const close = document.createElement('button');
  close.textContent = '×';
  close.setAttribute('aria-label', '關閉單字卡');
  close.onclick = () => { closeWord(); button.focus(); };
  popup.append(title, play, close, cardDetails(card));
  if (entry.onVocabularyEdited) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'secondary';
    edit.textContent = '編輯語塊卡';
    edit.onclick = () => {
      edit.replaceWith(vocabularyForm(card, entry));
      popup.querySelector('input')?.focus({ preventScroll: true });
    };
    popup.append(edit);
  }
  if (entry.allowSave) {
    const save = document.createElement('button');
    save.textContent = '收藏單字';
    const status = document.createElement('small');
    status.setAttribute('role', 'status');
    save.onclick = async () => {
      save.disabled = true;
      try {
        await learningRequest('/api/student/vocabulary', { ...learningContext(entry), cardId: card.id }, entry.sessionToken);
        save.textContent = '已收藏';
      } catch (error) { status.textContent = error.message; save.disabled = false; }
    };
    popup.append(save, status);
  }
  (document.fullscreenElement || document.body).append(popup);
  const rect = button.getBoundingClientRect();
  popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - popup.offsetWidth - 8))}px`;
  popup.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - popup.offsetHeight - 8))}px`;
}

function vocabularyForm(card, entry) {
  const form = document.createElement('form');
  form.className = 'vocabulary-card-edit';
  const input = (name, label, value, multiline = false, limit = 350) => {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const control = document.createElement(multiline ? 'textarea' : 'input');
    control.name = name;
    control.value = value;
    control.maxLength = limit;
    if (multiline) control.rows = 3;
    control.required = name !== 'similar';
    wrapper.append(control);
    form.append(wrapper);
  };
  input('pronunciation', card.language === 'en' ? 'KK 音標' : '漢語拼音', card.pronunciation, false, 180);
  input('meaning', '語境翻譯', card.meaning);
  input('usage', '使用情境', card.usage || '');
  input('examples', '例句（每行一個）', card.examples.join('\n'), true, 1200);
  input('similar', '相似詞（每行一個）', card.similar.join('\n'), true, 1200);
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
          examples: fields.examples.split('\n'), similar: fields.similar.split('\n') }),
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
  const append = (label, value) => {
    if (!value) return;
    const line = document.createElement('p');
    const title = document.createElement('b');
    title.textContent = `${label}　`;
    line.append(title, value);
    container.append(line);
  };
  append(card.language === 'en' ? 'KK 音標' : '拼音', card.pronunciation);
  append(card.language === 'en' ? '上下文中文意思' : '上下文英文意思', card.meaning);
  append(card.language === 'en' ? '英文使用情境' : '中文使用情境', card.usage);
  if (card.examples.length) {
    const list = document.createElement('ul');
    list.setAttribute('aria-label', `例句（${card.cefr}）`);
    for (const example of card.examples) {
      const item = document.createElement('li');
      item.textContent = example;
      list.append(item);
    }
    const label = document.createElement('b');
    label.textContent = `例句（${card.cefr}）`;
    container.append(label, list);
  }
  append(`相似詞（${card.cefr}）`, card.similar.join('、'));
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
  for (const [element, url] of audioPreviews) if (!element.isConnected) { element.pause(); URL.revokeObjectURL(url); audioPreviews.delete(element); }
});
audioObserver.observe(document.body, { childList: true, subtree: true });

function installQuestionAudio(read, url, token) {
  const audio = document.createElement('audio');
  audio.className = 'question-audio';
  audio.controls = true;
  audio.preload = 'none';
  audio.dataset.playbackReady = 'true';
  audio.setAttribute('aria-label', '題目朗讀音檔');
  if (!token) {
    audio.src = url;
    read.replaceWith(audio);
    return;
  }
  read.setAttribute('aria-label', '載入題目朗讀音檔');
  read.onclick = async () => {
    read.disabled = true;
    try {
      const response = await fetch(url, { headers: { 'X-Session-Token': token } });
      if (!response.ok) throw Error('無法載入題目朗讀音檔');
      const blob = await response.blob();
      if (!read.isConnected) return;
      const objectUrl = URL.createObjectURL(blob);
      audioPreviews.set(audio, objectUrl);
      audio.src = objectUrl;
      read.replaceWith(audio);
      await audio.play().catch(() => {});
    } catch (error) { read.disabled = false; read.title = error.message; }
  };
}

export async function showVocabulary(root, request) {
  root.textContent = '讀取單字庫…';
  try {
    const { cards } = await request('/api/student/vocabulary');
    root.replaceChildren();
    if (!cards.length) { root.textContent = '尚無收藏的單字。'; return; }
    for (const card of cards) {
      const row = document.createElement('details');
      row.className = 'item';
      const title = document.createElement('summary');
      title.textContent = card.phrase || card.word;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = '移除收藏';
      remove.onclick = async () => {
        try {
          await request('/api/student/vocabulary?card=' + encodeURIComponent(card.id), { method: 'DELETE' });
          row.remove();
          if (!root.childElementCount) root.textContent = '尚無收藏的單字。';
        } catch (error) { alert(error.message); }
      };
      row.append(title, cardDetails(card), remove);
      root.append(row);
    }
  } catch (error) { root.textContent = error.message; }
}

export function enhanceQuestion(element, language = 'en', entry) {
  if (!element || element.dataset.enhanced) return;
  element.dataset.enhanced = 'true'; element.classList.add('notranslate'); element.setAttribute('translate','no');
  const text = element.textContent;
  element.replaceChildren();
  const read = document.createElement('button'); read.className = 'question-read'; read.type = 'button'; read.textContent = '▶'; read.setAttribute('aria-label','朗讀題目'); read.onclick = () => { if (window.speechSynthesis?.speaking) stopSpeech(); else speak(text, language); };
  element.append(read);
  if (entry?.questionId) {
    element.append(document.createTextNode(text));
    learningRequest('/api/learning/context', learningContext(entry), entry.sessionToken).then(({ cards, audioUrl }) => {
      if (!element.isConnected) return;
      const nodes = [read];
      const entries = new Map();
      let offset = 0;
      for (const card of cards) {
        if (card.start < offset || text.slice(card.start, card.end) !== card.word) continue;
        nodes.push(document.createTextNode(text.slice(offset, card.start)));
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'question-word';
        button.textContent = card.word;
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
      nodes.push(document.createTextNode(text.slice(offset)));
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
      if (audioUrl) installQuestionAudio(read, audioUrl, entry.sessionToken);
    }).catch(() => {});
    return;
  }
  for (const part of text.split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/)) {
    if (language === 'en' && /^[A-Za-z]/.test(part)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'question-word'; button.textContent = part; button.setAttribute('aria-haspopup','dialog'); button.setAttribute('aria-expanded','false'); button.onclick = () => showWord(button); element.append(button);
    } else element.append(document.createTextNode(part));
  }
}
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeWord(); });
document.addEventListener('pointerdown', e => { if(popup && !popup.contains(e.target) && !selected?.contains(e.target)) closeWord(); });
window.addEventListener('scroll', event => {
  if (!(event.target instanceof Node) || !popup?.contains(event.target)) closeWord();
}, true);
window.addEventListener('resize', closeWord);
