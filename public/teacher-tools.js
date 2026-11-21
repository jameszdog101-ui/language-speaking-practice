const json = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const optionalNumber = value => value === '' ? null : Number(value);

export function limitsEditor(form, assignment = {}) {
  const box = document.createElement('fieldset');
  box.className = 'assignment-settings';
  box.innerHTML = `<legend>整份作業預設</legend><div class="assignment-settings-grid"><label>每次錄音上限（秒）<input name="recordingSeconds" required type="number" min="1" max="180" value="${assignment.recordingSeconds ?? 180}"></label><label>每題錄製次數<input name="maxAttempts" required type="number" min="1" max="10" value="${assignment.maxAttempts ?? 2}"></label><label><span class="vocabulary-level-label">語塊例句與相似詞程度</span><select name="cefr">${['A1','A2','B1','B2','C1','C2'].map(level => `<option value="${level}" ${level === (assignment.cefr || 'A2') ? 'selected' : ''}>${level}</option>`).join('')}</select></label></div><div class="assignment-settings-foot"><button type="button" class="secondary apply-limits">全部題目使用整份預設</button></div>`;
  form.querySelector('.question-editor').before(box);
  const chunkSize = document.createElement('label');
  chunkSize.innerHTML = `AI 語塊範圍<select name="chunkSize">
    <option value="small">小｜每個語塊最多 2 詞</option>
    <option value="medium">中｜每個語塊最多 3 詞</option>
    <option value="large">大｜每個語塊最多 5 詞</option>
  </select>`;
  box.querySelector('.assignment-settings-grid').append(chunkSize);
  form.elements.chunkSize.value = assignment.chunkSize || 'small';
  const language = form.elements.language;
  const descriptor = box.querySelector('.vocabulary-level-label');
  const labels = ['入門', '基礎', '進階', '高階', '流利', '精通'];
  const updateLevel = () => {
    const mandarin = language.value === 'zh-TW';
    descriptor.textContent = mandarin ? '華語程度（例句與相似詞）' : '英文 CEFR（例句與相似詞）';
    Array.from(form.elements.cefr.options).forEach((option, index) => {
      option.textContent = mandarin ? option.value + ' · ' + labels[index] : option.value;
    });
  };
  language.addEventListener('change', updateLevel);
  updateLevel();

  box.querySelector('.apply-limits').onclick = () => {
    for (const input of form.querySelectorAll('.question-override')) input.value = '';
  };
  return () => ({
    recordingSeconds: Number(form.elements.recordingSeconds.value),
    maxAttempts: Number(form.elements.maxAttempts.value),
    cefr: form.elements.cefr.value,
    chunkSize: form.elements.chunkSize.value,
  });
}

export function questionsEditor(root, request, esc, assignment, isPublished) {
  const questions = root.querySelector('.question-cards');
  let dragged;
  const update = () => [...questions.children].forEach((card, index, cards) => {
    card.querySelector('.question-order').textContent = `題目 ${index + 1}`;
    card.querySelector('.move-up').disabled = index === 0;
    card.querySelector('.move-down').disabled = index === cards.length - 1;
    const remove = card.querySelector('.remove');
    if (remove) remove.disabled = cards.length === 1;
  });
  questions.ondragover = event => {
    if (!dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };
  questions.ondrop = event => {
    const target = event.target.closest('.question-builder');
    if (!dragged || !target || target === dragged) return;
    event.preventDefault();
    const bounds = target.getBoundingClientRect();
    if (event.clientY < bounds.top + bounds.height / 2) target.before(dragged);
    else target.after(dragged);
    update();
  };
  function add(question = {}) {
    const override = assignment?.questionOverrides?.[question.id] || {};
    const card = document.createElement('div');
    card.className = 'question-builder';
    card.dataset.id = isPublished ? question.id || '' : '';
    card.innerHTML = `<div class="row"><b class="question-order"></b><div class="question-order-controls"><span class="question-grip" draggable="true" title="拖曳調整題目順序" aria-hidden="true">⠿</span><button type="button" class="secondary move-up">上移</button><button type="button" class="secondary move-down">下移</button>${card.dataset.id ? '' : '<button type="button" class="danger remove">移除</button>'}</div></div>
      <label>朗讀文字<textarea class="qtext notranslate" translate="no" required rows="2">${esc(question.text || '')}</textarea></label>
      <label>拼音／發音提示<input class="qpinyin notranslate" translate="no" value="${esc(question.pinyin || '')}"></label>
      <div class="row"><label>本題錄音上限（秒）<input class="qseconds question-override" type="number" min="1" max="180" placeholder="沿用整份預設" value="${override.recordingSeconds ?? ''}"></label>
      <label>本題錄製次數<input class="qattempts question-override" type="number" min="1" max="10" placeholder="沿用整份預設" value="${override.maxAttempts ?? ''}"></label></div>
      <label>題目朗讀音檔（選填）<input class="qaudio" type="file" accept="audio/*"></label>`;
    const grip = card.querySelector('.question-grip');
    grip.ondragstart = event => {
      dragged = card;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.querySelector('.question-order').textContent);
      event.dataTransfer.setDragImage(card, 25, 20);
    };
    grip.ondragend = () => { dragged = null; };
    card.querySelector('.move-up').onclick = () => { card.previousElementSibling?.before(card); update(); };
    card.querySelector('.move-down').onclick = () => { card.nextElementSibling?.after(card); update(); };
    const remove = card.querySelector('.remove');
    if (remove) remove.onclick = () => { card.remove(); update(); };
    questions.append(card);
    update();
    return card;
  }
  root.querySelector('.add-question').onclick = () => {
    const card = add();
    card.scrollIntoView({ block: 'center' });
    card.querySelector('.qtext').focus({ preventScroll: true });
  };
  if (assignment?.sentences.length) assignment.sentences.forEach(add);
  else add();
  return {
    replaceWithText(texts) {
      questions.replaceChildren();
      texts.forEach(text => add({ text }));
    },
    read: () => [...questions.children].map(card => ({
      id: card.dataset.id || undefined,
      text: card.querySelector('.qtext').value, pinyin: card.querySelector('.qpinyin').value,
      maxAttempts: optionalNumber(card.querySelector('.qattempts').value),
      recordingSeconds: optionalNumber(card.querySelector('.qseconds').value),
    })),
    files: () => [...questions.children].map(card => card.querySelector('.qaudio').files[0]),
    async upload(savedQuestions, revision, files) {
      for (const [index, file] of files.entries()) {
        if (!file || !savedQuestions[index]) continue;
        await request(`/api/teacher/question-audio/${savedQuestions[index].id}?revision=${revision}`, {
          method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
        });
      }
    },
  };
}

export function assignmentsPicker(form, request, esc, initial = [], assignmentId) {
  const box = document.createElement('fieldset');
  box.className = 'assignment-settings';
  box.innerHTML = '<legend>學生指派（選填）</legend><div class="assignment-picker-bar"><button type="button" class="secondary" aria-expanded="false">作業布置給</button><span class="selection-count"></span></div><div class="student-checklist" hidden></div>';
  form.querySelector('.question-editor').before(box);
  const selected = new Set(initial);
  const list = box.querySelector('.student-checklist'), toggle = box.querySelector('button');
  const update = () => {
    const anonymous = form.elements.identityMode.value === 'anonymous';
    toggle.disabled = anonymous;
    list.querySelectorAll('input').forEach(input => { input.disabled = anonymous; });
    box.querySelector('.selection-count').textContent = anonymous ? '匿名作業以代碼進入' : `已選 ${selected.size} 人`;
  };
  form.addEventListener('change', update);
  toggle.onclick = async () => {
    list.hidden = !list.hidden;
    toggle.setAttribute('aria-expanded', String(!list.hidden));
    if (list.hidden || list.dataset.loaded) return;
    list.textContent = '讀取學生名單…';
    try {
      const path = '/api/teacher/assignment-recipients' + (assignmentId ? `?assignment=${encodeURIComponent(assignmentId)}` : '');
      const { students } = await request(path);
      list.innerHTML = students.map(s => `<label class="check"><input type="checkbox" value="${esc(s.id)}" ${selected.has(s.id) ? 'checked' : ''}> ${esc(s.name)}${s.disabled_at ? '（已停用）' : ''}</label>`).join('') || '<p>目前沒有可指派的學生。</p>';
      list.querySelectorAll('input').forEach(input => input.onchange = () => {
        if (input.checked) selected.add(input.value);
        else selected.delete(input.value);
        update();
      });
      list.dataset.loaded = 'true';
      update();
    } catch (error) { list.textContent = error.message; }
  };
  update();
  return () => form.elements.identityMode.value === 'anonymous' ? [] : [...selected];
}

export function assignmentSplitter(form, request, editor) {
  const box = document.createElement('fieldset');
  box.className = 'assignment-settings assignment-splitter';
  box.innerHTML = `<legend>AI 分題</legend>
    <label>原文<textarea class="split-source notranslate" translate="no" rows="5" maxlength="12000" placeholder="貼上要分成多題的朗讀原文"></textarea></label>
    <div class="split-options">
      <label>要切成幾題（1–30）<input class="split-count" type="text" inputmode="numeric" maxlength="2" value="4"></label>
      <label>特殊需求（選填）<textarea class="split-requirements" rows="2" maxlength="1500" placeholder="例如：保留對話段落，或讓各題長度接近"></textarea></label>
    </div>
    <div class="split-actions">
      <button type="button" class="secondary split-run">AI 分題並帶入題目</button>
      <small class="muted">分題會使用你的 Gemini 設定與專案配額。</small>
    </div>
    <p class="split-status" role="status"></p>`;
  const questionArea = form.querySelector('.question-editor');
  questionArea.before(box);
  const publish = form.querySelector('button:not([type])');
  const source = box.querySelector('.split-source');
  const countField = box.querySelector('.split-count');
  const requirements = box.querySelector('.split-requirements');
  const status = box.querySelector('.split-status');
  const run = box.querySelector('.split-run');
  let busy = false;
  run.onclick = async () => {
    if (busy || publish.disabled) return;
    const text = source.value.trim();
    const count = Number(countField.value.trim());
    if (!text) { status.textContent = '請貼上原文。'; source.focus(); return; }
    if (!/^\d{1,2}$/.test(countField.value.trim()) || count < 1 || count > 30) {
      status.textContent = '請輸入 1–30 題。'; countField.focus(); return;
    }
    const hasContent = editor.read().some(q => q.text.trim() || q.pinyin.trim() || q.maxAttempts !== null || q.recordingSeconds !== null)
      || editor.files().some(Boolean);
    if (hasContent && !confirm('分題成功後會取代目前的題目、發音提示、各題錄音設定和已選音檔。確定繼續？')) return;
    busy = box.disabled = publish.disabled = questionArea.inert = true;
    status.textContent = '正在分題…';
    try {
      const { questions } = await request('/api/teacher/assignments/split', {
        method: 'POST', ...json({ text, count, requirements: requirements.value, language: form.elements.language.value }),
      });
      if (!form.isConnected) return;
      editor.replaceWithText(questions);
      status.textContent = `已帶入 ${questions.length} 題，可在下方確認或修改。`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = box.disabled = publish.disabled = questionArea.inert = false;
    }
  };
  return () => busy;
}

export async function individualAssignments(app, request, esc, back) {
  app.innerHTML = '<section class="panel wide"><button type="button" class="secondary">返回教師工作台</button><h2>學生個別作業區</h2><div class="student-folders">讀取中…</div></section>';
  app.querySelector('button').onclick = back;
  const root = app.querySelector('.student-folders');
  try {
    const { students } = await request('/api/teacher/student-assignments');
    root.innerHTML = students.map(student => `<details class="item"><summary>${esc(student.name)}${student.disabled ? '（已停用）' : ''} · ${student.assignments.length} 份作業</summary><ul class="student-assignment-list">${student.assignments.map(a => `<li><a href="#teacher/assignment/${encodeURIComponent(a.id)}">${esc(a.title)}</a> <span class="assignment-state ${a.completedAt ? 'is-complete' : 'is-open'}">${a.completedAt ? '已完成' : '未完成'}</span> <small>${new Date(a.createdAt).toLocaleDateString('zh-TW')}</small></li>`).join('') || '<li>尚無作業</li>'}</ul></details>`).join('') || '<p>尚未建立學生帳號。</p>';
  } catch (error) { root.textContent = error.message; }
}

export async function editGemini(app, request, back) {
  app.innerHTML = `<section class="panel"><button type="button" class="secondary">返回教師工作台</button><h2>我的 Gemini 設定</h2>
    <form><label>模型 ID<input name="model" placeholder="留空使用預設模型" autocapitalize="none" spellcheck="false"></label><label>推理程度<input name="effort" placeholder="default、low、high 或模型的 token 預算"></label>
    <label>新的 Gemini API Key<input name="apiKey" type="password" autocomplete="off" spellcheck="false" maxlength="256"></label>
    <label class="check"><input name="clearKey" type="checkbox">移除已儲存的金鑰</label><p class="key-state"></p><p role="status"></p><div class="actions"><button type="submit">儲存</button><button type="button" class="secondary check-gemini">驗證金鑰與模型</button></div></form></section>`;
  app.querySelector('button').onclick = back;
  const form = app.querySelector('form'), status = form.querySelector('[role=status]');
  const save = form.querySelector('[type=submit]'), check = form.querySelector('.check-gemini');
  const busy = value => { save.disabled = check.disabled = value; };
  const update = settings => {
    form.querySelector('.key-state').textContent = settings.configured ? '已設定金鑰。欄位留空時保留現有金鑰。' : '尚未設定金鑰。';
    form.elements.model.value = settings.model;
    form.elements.effort.value = settings.effort;
  };
  busy(true);
  try {
    update(await request('/api/teacher/gemini'));
  } catch (error) { status.textContent = error.message; }
  finally { busy(false); }
  form.onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    busy(true);
    try {
      update(await request('/api/teacher/gemini', { method: 'PUT', ...json({ ...data, clearKey: data.clearKey === 'on' }) }));
      if (form.elements.apiKey.value === data.apiKey) form.elements.apiKey.value = '';
      form.elements.clearKey.checked = false;
      status.textContent = '已儲存';
    } catch (error) { status.textContent = error.message; }
    finally { busy(false); }
  };
  check.onclick = async () => {
    const data = Object.fromEntries(new FormData(form));
    busy(true);
    status.textContent = '正在向 Google 查詢模型…';
    try {
      const result = await request('/api/teacher/gemini/check', { method: 'POST', ...json(data) });
      status.textContent = `金鑰可查詢 ${result.model} 的模型資訊。正式生成仍取決於 Google 專案權限與配額。`;
    } catch (error) { status.textContent = error.message; }
    finally { busy(false); }
  };
}
