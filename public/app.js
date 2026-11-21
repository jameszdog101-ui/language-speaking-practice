import { installPlayback } from './playback.js';
import { showStudentFeedback } from './feedback-view.js';
import { bindFeedback, disposeFeedbackRecording } from './feedback.js';
import { showHistory } from './history.js';
import { studentPortal, manageStudents } from './students.js';
import { enhanceQuestion, stopSpeech, closeWord } from './learning.js';
import { submissionList, bindSubmissions, submissionTrash } from './submissions.js';
import { transformRecording } from "./audio-transform.js";
import { prepareRecording, MAX_RECORDING_SECONDS } from './recording.js';
import { VOICE_PROFILES, VOICE_TRANSFORM_VERSION } from "./voice-profiles.js";
import { openClassroom } from "./classroom.js";
import { openLocalPractice } from "./local-practice.js";
import { limitsEditor, questionsEditor, assignmentsPicker, assignmentSplitter, individualAssignments, editGemini } from "./teacher-tools.js";

const app = document.querySelector("#app");
const state = {
  assignment: null,
  testBlob: null,
  testUrl: null,
  stream: null,
  audioContext: null,
  session: null,
  index: 0,
  questionProgress: new Map(),
  teacher: null,
};
const esc = (s = "") =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const steps = (n, total = 4) =>
  `<div class="steps">${Array.from({ length: total }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</div>`;
async function request(url, options = {}) {
  const token = state.session?.sessionToken;
  if (token && url.startsWith("/api/sessions/"))
    options.headers = { ...(options.headers || {}), "X-Session-Token": token };
  const r = await fetch(url, options);
  const data = await r.json();
  if (!r.ok) throw Object.assign(new Error(data.error || "操作失敗"), { status: r.status });
  return data;
}
function message(text, bad = false) {
  return `<div class="notice ${bad ? "error" : ""}" role="${bad ? "alert" : "status"}">${esc(text)}</div>`;
}
const languageDialog = document.querySelector("#languageDialog"),
  languageSelect = document.querySelector("#platformLanguage");
window.googleTranslateElementInit = () =>
  new google.translate.TranslateElement(
    {
      pageLanguage: "zh-TW",
      includedLanguages: "zh-TW,zh-CN,en,ja,ko,vi,id,ms,th,es,fr",
      autoDisplay: false,
    },
    "google_translate_element",
  );
if (window.google?.translate?.TranslateElement)
  window.googleTranslateElementInit();
document.querySelector("#languageButton").onclick = () =>
  languageDialog.showModal();
document.querySelector("#applyLanguage").onclick = () => {
  const target = languageSelect.value,
    combo = document.querySelector(".goog-te-combo");
  localStorage.setItem("platformLanguage", target);
  if (target === "zh-TW") {
    document.cookie = "googtrans=; Max-Age=0; Path=/";
    document.cookie =
      "googtrans=; Max-Age=0; Path=/; Domain=" + location.hostname;
    location.reload();
    return;
  }
  if (!combo) {
    document.querySelector("#applyLanguage").textContent =
      "翻譯工具載入中，請稍後重試";
    return;
  }
  combo.value = target;
  combo.dispatchEvent(new Event("change"));
  languageDialog.close();
};
languageSelect.value = localStorage.getItem("platformLanguage") || "zh-TW";

function home() {
  cleanupTest();
  const bars = [38, 64, 48, 86, 56, 94, 70, 44, 78, 92, 60, 40, 82, 66, 90, 52, 74, 46].map((h) => `<i style="height:${h}%"></i>`).join("");
  app.innerHTML = `<section class="hero"><div class="hero-copy"><div class="eyebrow">LANGUAGE, ONE SENTENCE AT A TIME</div><h1>一句一句，<br><span class="hero-highlight">說出自信。</span></h1><p>適用中文與英文語言訓練。先確認設備，再安心練習；每一次正式錄音都清楚計次，讓學生專注在自己的聲音，也讓教師掌握學習歷程。</p><div class="actions"><a class="btn" href="#student">我是學生</a><a class="btn secondary" href="#teacher">教師登入</a></div><div class="hero-pills"><span>✓ 4 秒設備先行測試</span><span>✓ 逐題清楚計次</span><span>✓ 支援聲音去識別化</span></div></div><div class="hero-art" aria-hidden="true"><img class="hero-ring" src="/logo-mark.svg?v=20261020" alt=""><div class="studio-card"><div class="studio-head"><span class="studio-badge">SPEAKING STUDIO</span><span class="studio-meta">第 1／3 題 · 剩餘 2 次</span></div><div class="studio-prompt"><div class="studio-han">你好，很高興認識你。</div><div class="studio-pin">Nǐ hǎo, hěn gāoxìng rènshi nǐ.</div></div><div class="studio-player"><span class="studio-mic">●</span><div class="studio-wave">${bars}</div><span class="studio-time">0:04</span></div><div class="studio-foot"><span>✓ 設備檢測通過</span><span>★ 教師五分制語音評語</span></div></div></div></section><section class="hero-features" aria-label="平台核心流程"><article class="feature-card"><span class="feature-step">STEP 01</span><h3>設備先行檢測</h3><p>正式作答前先進行 4 秒本機試音，確認麥克風音量與清晰度，測試音檔不會上傳。</p></article><article class="feature-card"><span class="feature-step">STEP 02</span><h3>逐句朗讀與即時查詞</h3><p>清楚顯示各題錄製額度，內建中英文語音朗讀與英文單字即點即查，可選聲音去識別化。</p></article><article class="feature-card"><span class="feature-step">STEP 03</span><h3>五分制評語與課堂舞台</h3><p>教師可提供逐題與總評文字、語音回饋，並一鍵切換「上課互動式演示」聲音舞台。</p></article></section>`;
}
let closeLocalPractice;
function showLocalPractice(assignment, entry, back = student) {
  closeLocalPractice?.();
  disposeRecording?.();
  cleanupTest();
  closeLocalPractice = openLocalPractice(app, assignment, entry, { back, esc });
}
function student() {
  closeLocalPractice?.();
  closeLocalPractice = null;
  return studentPortal(app, request, esc, studentJoin,
    (root, request, esc) => showHistory(root, request, esc, showStudentFeedback, showLocalPractice, resumeStudentAssignment));
}
async function resumeStudentAssignment(sessionId) {
  const session = await request('/api/student/resume/' + encodeURIComponent(sessionId), { method: 'POST' });
  state.session = session;
  state.assignment = session.assignment;
  state.guestMode = false;
  state.studentAccount = session.student;
  state.questionProgress = new Map(session.progress.map(q => [q.id, q]));
  state.index = Math.max(0, session.progress.findIndex(q => !q.accepted));
  practice();
}
function studentJoin(guestMode = false, account = null, code = "") {
  cleanupTest();
  app.innerHTML = `<section class="panel">${steps(0)}<div class="eyebrow">STEP 1</div><button id="backToStudent" class="secondary">返回學生入口</button><h2>進入課程</h2><p>輸入教師提供的六位課程代碼。</p><form id="join"><label>課程代碼</label><input name="code" maxlength="6" autocomplete="off" placeholder="例如 ABC123" required><div id="msg"></div><button>繼續</button></form></section>`;
  document.querySelector("#backToStudent").onclick = student;
  const form = document.querySelector("#join");
  const codeInput = form.elements.code;
  const feedback = form.querySelector("#msg");
  const submit = form.querySelector("button");
  codeInput.value = code;
  codeInput.setAttribute("aria-describedby", feedback.id);
  codeInput.oninput = () => {
    codeInput.removeAttribute("aria-invalid");
    feedback.replaceChildren();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const rawCode = codeInput.value.trim();
    if (!/^[A-Za-z0-9]{6}$/.test(rawCode)) {
      feedback.innerHTML = message("請輸入 6 位英文字母或數字的課程代碼。", true);
      codeInput.setAttribute("aria-invalid", "true");
      codeInput.focus();
      return;
    }
    submit.disabled = true;
    feedback.replaceChildren();
    try {
      const assignment = await request("/api/assignments/code/" + rawCode.toUpperCase());
      if (!form.isConnected) return;
      state.assignment = assignment;
      state.guestMode = guestMode;
      state.studentAccount = account;
      app.innerHTML = '<section class="panel"><button type="button" class="secondary back-to-code">返回作業入口</button><h2>' + esc(assignment.title) + '</h2><p>' + esc(assignment.instructions || '') + '</p><div class="actions"><button type="button" class="begin-device">開始正式作業</button><button type="button" class="secondary begin-local">只練習</button></div><p role="status"></p></section>';
      app.querySelector('.back-to-code').onclick = () => studentJoin(guestMode, account);
      app.querySelector('.begin-local').onclick = () => showLocalPractice(assignment, { code: assignment.code, allowSave: Boolean(account) }, () => studentJoin(guestMode, account, assignment.code));
      const formal = app.querySelector('.begin-device'), now = Date.now();
      if (assignment.startsAt && Date.parse(assignment.startsAt) > now) {
        formal.disabled = true;
        app.querySelector('[role=status]').textContent = '作業尚未開放，仍可練習。';
      } else if (assignment.endsAt && Date.parse(assignment.endsAt) <= now) {
        formal.disabled = true;
        app.querySelector('[role=status]').textContent = '作業已截止，仍可練習。';
      }
      formal.onclick = device;
    } catch (error) {
      if (!form.isConnected) return;
      const missing = error.status === 404;
      feedback.innerHTML = message(missing
        ? "找不到這個課程代碼，請核對老師提供的代碼。"
        : "暫時無法查詢作業，請稍後再試。", true);
      if (missing) {
        codeInput.setAttribute("aria-invalid", "true");
        codeInput.focus();
      }
    } finally {
      submit.disabled = false;
    }
  };
}
async function getMic() {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "此瀏覽器不支援麥克風錄音，請改用最新版 Chrome、Edge 或 Safari",
    );
  return navigator.mediaDevices.getUserMedia({ audio: true });
}
function device() {
  app.innerHTML = `<section class="panel">${steps(1)}<div class="eyebrow">STEP 2</div><h2>開始之前，先確認您的錄音設備</h2><p>測試音訊只存在這個瀏覽器頁面，不會上傳，也不計入正式錄製次數。</p><div id="deviceStatus" class="notice">等待取得麥克風權限</div><div class="meter"><b id="level"></b></div><button id="test">開始測試錄音（4 秒）</button><div id="play"></div><button id="confirm" disabled>確認設備正常，開始作業</button></section>`;
  setupDevice();
}
async function setupDevice() {
  const status = document.querySelector("#deviceStatus");
  try {
    const stream = await getMic();
    if (!status.isConnected) { stream.getTracks().forEach(track => track.stop()); return; }
    state.stream = stream;
    status.textContent = "✓ 已偵測到麥克風，可開始測試";
    state.audioContext = new AudioContext();
    const analyser = state.audioContext.createAnalyser();
    state.audioContext.createMediaStreamSource(state.stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let peak = 0;
    const tick = () => {
      if (!state.stream) return;
      analyser.getByteFrequencyData(data);
      const level = Math.max(...data) / 255;
      peak = Math.max(peak, level);
      const el = document.querySelector("#level");
      if (el) el.style.width = `${Math.max(2, level * 100)}%`;
      requestAnimationFrame(tick);
    };
    tick();
    document.querySelector("#test").onclick = () => recordTest(peak);
  } catch (e) {
    status.className = "notice error";
    status.innerHTML =
      "無法使用麥克風。請在瀏覽器網址列的權限設定允許麥克風，確認輸入裝置後重新整理。<br>" +
      esc(e.message);
  }
}
function recordTest() {
  const btn = document.querySelector("#test"),
    status = document.querySelector("#deviceStatus");
  const chunks = [];
  let recorder;
  try {
    recorder = new MediaRecorder(state.stream);
  } catch {
    status.innerHTML = "瀏覽器無法建立錄音，請改用最新版瀏覽器。";
    status.className = "notice error";
    return;
  }
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.onstop = () => {
    state.testBlob = new Blob(chunks, { type: recorder.mimeType });
    if (state.testUrl) URL.revokeObjectURL(state.testUrl);
    state.testUrl = URL.createObjectURL(state.testBlob);
    document.querySelector("#play").innerHTML =
      `<label>播放測試錄音並自行確認聲音是否清楚</label><audio controls src="${state.testUrl}"></audio>`;
    status.textContent =
      state.testBlob.size > 100
        ? "✓ 已取得可播放的測試音訊，請播放確認"
        : "未偵測到有效聲音，請檢查麥克風與輸入來源後重試";
    status.className = state.testBlob.size > 100 ? "notice" : "notice error";
    document.querySelector("#confirm").disabled = state.testBlob.size <= 100;
    btn.disabled = false;
    btn.textContent = "重新測試";
  };
  btn.disabled = true;
  status.textContent = "錄音中…請說一小段話";
  recorder.start();
  setTimeout(() => recorder.state === "recording" && recorder.stop(), 4000);
  document.querySelector("#confirm").onclick = identity;
}
function cleanupTest() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  if (state.audioContext) {
    state.audioContext.close();
    state.audioContext = null;
  }
  if (state.testUrl) {
    URL.revokeObjectURL(state.testUrl);
    state.testUrl = null;
  }
  state.testBlob = null;
}
function identity() {
  cleanupTest();
  const a = state.assignment,
    mode = a.identityMode || (a.anonymous ? "anonymous" : "full"),
    fullyAnonymous = mode === "anonymous",
    nameOnly = mode === "name_only";
  app.innerHTML = `<section class="panel">${steps(2)}<div class="eyebrow">STEP 3</div><h2>${fullyAnonymous ? "匿名作業" : "學生資料"}</h2><p>${fullyAnonymous ? "本作業不蒐集姓名與學號，系統會產生匿名編號。" : nameOnly ? "本作業只蒐集姓名，不要求學號。" : "資料僅供教師辨識本次作答。"}</p><form id="identity">${mode === "full" ? `<label>姓名</label><input name="name" required><label>學號</label><input name="studentId" required>` : nameOnly ? `<label>姓名</label><input name="name" required>` : ""}${a.deidentifyVoice ? `<div class="notice"><b>本作業已啟用聲音去識別化</b><br>原始聲音只在此裝置處理，不會上傳；系統只儲存轉換後的版本。此處理用於降低聲音被辨識的風險，不保證完全匿名。</div><label>生理性別（僅用於選擇固定聲音轉換設定）</label><select name="voiceProfile" required><option value="">請選擇</option><option value="PROFILE_A_M">男性</option><option value="PROFILE_A_F">女性</option></select>` : ""}<div id="msg"></div><button>閱讀作業說明</button></form></section>`;
  if(state.studentAccount && !fullyAnonymous) { const name=document.querySelector("#identity [name=name]"); if(name){name.value=state.studentAccount.displayName; name.readOnly=true;} const number=document.querySelector("#identity [name=studentId]"); if(number && state.studentAccount.studentNumber){number.value=state.studentAccount.studentNumber; number.readOnly=true;} }
  document.querySelector("#identity").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      state.session = await request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, code: a.code, deviceTestPassed: true, guest: state.guestMode === true }),
      });
      state.assignment = state.session.assignment;
      state.questionProgress = new Map();
      intro();
    } catch (x) {
      document.querySelector("#msg").innerHTML = message(x.message, true);
    }
  };
}
function intro() {
  const a = state.assignment;
  app.innerHTML = `<section class="panel">${steps(3)}<div class="eyebrow">STEP 4</div><h2>${esc(a.title)}</h2><p>${esc(a.instructions || "請朗讀每一個句子。")}</p><div class="notice">共 ${a.sentences.length} 題｜各題錄製上限：${a.sentences.map((q, i) => `${i + 1}：${q.maxAttempts} 次`).join("、")}<br>可自由切換題目。每題採用一份錄音後即可繳交。</div>${a.deidentifyVoice ? '<div class="notice">🔒 正式錄音會先在此裝置完成去識別化，原始錄音不會上傳。</div>' : ""}<button id="begin">開始正式錄音</button></section>`;
  document.querySelector("#begin").onclick = () => {
    state.index = 0;
    practice();
  };
}
let disposeRecording;
async function practice() {
  disposeRecording?.();
  const a = state.assignment,
    q = a.sentences[state.index];
  closeWord();
  stopSpeech();
  const progress = state.questionProgress.get(q.id) || { attempts: 0, accepted: false };
  const secondsLimit = q.recordingSeconds || MAX_RECORDING_SECONDS;
  const canSubmit = a.sentences.every(item => state.questionProgress.get(item.id)?.accepted);
  app.innerHTML = `<section class="panel wide"><div class="steps question-progress" aria-label="作答進度">${a.sentences.map(item => '<i class="' + (state.questionProgress.get(item.id)?.accepted ? 'on' : '') + '"></i>').join('')}</div>
    <div class="row"><b>第 ${state.index + 1}／${a.sentences.length} 題</b><span id="count" class="counter"></span></div>
    <div class="sentence"><div class="han">${esc(q.text)}</div><div class="pin notranslate" translate="no">${esc(q.pinyin)}</div><button id="record" class="record" aria-label="開始錄音">●</button><div id="status" role="status"></div><div id="preview"></div><div id="msg"></div></div>
    <div class="actions"><button type="button" class="secondary previous-question">上一題</button><button type="button" class="secondary next-question">下一題</button><button type="button" class="submit-assignment">繳交作業</button></div></section>`;
  enhanceQuestion(app.querySelector('.han'), a.language, { questionId: q.id, sessionId: state.session.sessionId, sessionToken: state.session.sessionToken, allowSave: Boolean(state.studentAccount) });
  const previous = app.querySelector('.previous-question'), next = app.querySelector('.next-question'), submit = app.querySelector('.submit-assignment');
  const button = app.querySelector('#record'), status = app.querySelector('#status'), preview = app.querySelector('#preview');
  const setBusy = busy => {
    previous.disabled = busy || state.index === 0;
    next.disabled = busy || state.index >= a.sentences.length - 1;
    submit.disabled = busy || !canSubmit;
  };
  previous.onclick = () => { state.index--; practice(); };
  next.onclick = () => { state.index++; practice(); };
  submit.onclick = async () => {
    setBusy(true);
    try { await complete(); }
    catch (error) { if (!disposed) { app.querySelector('#msg').innerHTML = message(error.message, true); setBusy(false); } }
  };
  let timer, limitTimer, startedAt, previewUrl;
  let stream,
    recorder,
    chunks = [];
  let disposed = false;
  disposeRecording = () => {
    disposed = true;
    app.querySelectorAll("audio").forEach(audio => audio.pause());
    clearInterval(timer); clearTimeout(limitTimer);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (recorder) { recorder.onstop = null; if (recorder.state === 'recording') recorder.stop(); }
    stream?.getTracks().forEach(t => t.stop());
  };
  function renderProgress(showRecord = false) {
    const remaining = q.maxAttempts - progress.attempts;
    app.querySelector('#count').textContent = '已錄製 ' + progress.attempts + '／' + q.maxAttempts + ' 次｜剩餘 ' + remaining + ' 次';
    const hasRecording = Boolean(progress.blob || progress.audioUrl);
    button.disabled = progress.accepted || remaining <= 0 || (hasRecording && !showRecord);
    status.textContent = progress.accepted ? '已採用本題錄音' : progress.blob && !showRecord ? '請播放確認後採用或重新錄製' : '點擊紅色按鈕錄音，上限 ' + secondsLimit + ' 秒';
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    preview.replaceChildren();
    if (!hasRecording || showRecord) return;
    const addAudio = () => {
      previewUrl = URL.createObjectURL(progress.blob);
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = previewUrl;
      preview.prepend(audio);
    };
    if (progress.blob) addAudio();
    else {
      const load = document.createElement('button');
      load.type = 'button';
      load.className = 'secondary';
      load.textContent = '載入上次錄音';
      load.onclick = async () => {
        load.disabled = true;
        try {
          const response = await fetch(progress.audioUrl, { headers: { 'X-Session-Token': state.session.sessionToken } });
          if (!response.ok) throw Error('無法載入上次錄音');
          progress.blob = await response.blob();
          if (!load.isConnected) return;
          load.remove();
          addAudio();
        } catch (error) {
          load.disabled = false;
          load.textContent = error.message + '，點此重試';
        }
      };
      preview.append(load);
    }
    if (progress.accepted) return;
    const acceptButton = document.createElement('button');
    acceptButton.type = 'button';
    acceptButton.textContent = '採用這次錄音';
    acceptButton.onclick = async () => {
      acceptButton.disabled = true;
      setBusy(true);
      try {
        await request('/api/sessions/' + state.session.sessionId + '/sentences/' + q.id + '/accept', { method: 'POST' });
        if (disposed) return;
        progress.accepted = true;
        state.questionProgress.set(q.id, progress);
        const nextIndex = a.sentences.findIndex((question, i) => i > state.index && !state.questionProgress.get(question.id)?.accepted);
        if (nextIndex !== -1) state.index = nextIndex;
        practice();
      } catch (error) {
        if (!disposed) {
          app.querySelector('#msg').innerHTML = message(error.message, true);
          acceptButton.disabled = false;
          setBusy(false);
        }
      }
    };
    preview.append(acceptButton);
    if (remaining) {
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'secondary';
      again.textContent = '重新錄製';
      again.onclick = () => renderProgress(true);
      preview.append(again);
    }
  }
  setBusy(false);
  renderProgress();
  document.querySelector("#record").onclick = async () => {
    const btn = document.querySelector("#record");
    if (recorder?.state === "recording") {
      btn.disabled = true;
      recorder.stop();
      return;
    }
    try {
      btn.disabled = true;
      setBusy(true);
      app.querySelectorAll("audio").forEach(audio => audio.pause());
      stopSpeech(); closeWord();
      stream = await getMic();
      if (disposed) { stream.getTracks().forEach(t => t.stop()); return; }
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        if (disposed) return;
        clearInterval(timer);
        clearTimeout(limitTimer);
        btn.disabled = true;
        btn.classList.remove("live");
        btn.textContent = "●";
        stream.getTracks().forEach((t) => t.stop());
        const rawBlob = new Blob(chunks, { type: recorder.mimeType });
        document.querySelector("#status").textContent = a.deidentifyVoice
          ? "正在裝置內進行聲音去識別化…"
          : "正在安全儲存錄音…";
        try {
          const profile = a.deidentifyVoice
            ? VOICE_PROFILES[state.session.voiceProfile]
            : null;
          const elapsedLimit = Math.min(secondsLimit, (performance.now() - startedAt) / 1000 + 0.75);
          const normalized = await prepareRecording(rawBlob, elapsedLimit);
          const processed = profile
            ? await transformRecording(normalized, profile)
            : normalized;
          const blob = profile ? await prepareRecording(processed, elapsedLimit) : processed;
          if (disposed) return;
          const result = await request(
            `/api/sessions/${state.session.sessionId}/sentences/${q.id}/attempts`,
            {
              method: "POST",
              headers: {
                "Content-Type": blob.type,
                ...(profile
                  ? {
                      "X-Transform-Profile": profile.id,
                      "X-Transform-Version": VOICE_TRANSFORM_VERSION,
                    }
                  : {}),
              },
              body: blob,
            },
          );
          if (disposed) return;
          progress.attempts = result.attempt;
          progress.blob = blob;
          state.questionProgress.set(q.id, progress);
          renderProgress();
          setBusy(false);
        } catch (e) {
          if (disposed) return;
          btn.disabled = false;
          setBusy(false);
          if (progress.blob) renderProgress();
          document.querySelector("#msg").innerHTML = message(e.message, true);
          document.querySelector("#status").textContent = a.deidentifyVoice
            ? "處理或上傳失敗，原始錄音未上傳，本次不計次"
            : "上傳失敗，本次不計次，可重新嘗試";
        }
      };
      recorder.start();
      btn.disabled = false;
      startedAt = performance.now();
      const updateClock = () => {
        const seconds = Math.min(secondsLimit, Math.floor((performance.now() - startedAt) / 1000));
        document.querySelector('#status').textContent = `錄音中 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} / ${Math.floor(secondsLimit / 60)}:${String(secondsLimit % 60).padStart(2, "0")}，點擊停止`;
        if (seconds >= secondsLimit && recorder.state === 'recording') recorder.stop();
      };
      timer = setInterval(updateClock, 200);
      limitTimer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, secondsLimit * 1000);
      btn.classList.add("live");
      btn.textContent = "■";
      document.querySelector("#status").textContent = "錄音中，點擊停止";
    } catch (e) {
      btn.disabled = false;
      stream?.getTracks().forEach(t => t.stop());
      if (disposed) return;
      setBusy(false);
      document.querySelector("#msg").innerHTML = message(
        "錄音啟動失敗，本次不計次：" + e.message,
        true,
      );
    }
  };
}
async function complete() {
    const r = await request(
      `/api/sessions/${state.session.sessionId}/complete`,
      { method: "POST" },
    );
    const identityLabel = r.name
      ? r.studentId
        ? `${r.name}（${r.studentId}）`
        : r.name
      : r.anonymousId;
    disposeRecording?.();
    state.questionProgress.clear();
    app.innerHTML = `<section class="panel" style="text-align:center"><div style="font-size:58px">✓</div><h2>作業已完成</h2><p>${esc(identityLabel)}<br>完成時間：${new Date(r.completedAt).toLocaleString("zh-TW")}</p><button id="afterComplete" class="btn">${(state.guestMode || !state.studentAccount || state.assignment.identityMode === "anonymous") ? "回到首頁" : "查看我的作業"}</button> <button type="button" class="secondary" id="practiceAgain">練習與複習單字</button></section>`;
    document.querySelector("#afterComplete").onclick = () => (state.guestMode || !state.studentAccount || state.assignment.identityMode === "anonymous") ? home() : student();
    document.querySelector("#practiceAgain").onclick = () => showLocalPractice(state.assignment, {
      sessionId: state.session.sessionId, sessionToken: state.session.sessionToken, allowSave: Boolean(state.studentAccount),
    });
}
async function teacher() {
  cleanupTest();
  try {
    state.teacher = (await request("/api/auth/me")).teacher;
    teacherDashboard();
  } catch {
    teacherAuth();
  }
}
function teacherAuth(register = false) {
  app.innerHTML = `<section class="panel"><div class="eyebrow">TEACHER PORTAL</div><h2>${register ? "建立教師帳號" : "教師登入"}</h2><p>登入後可集中管理中文與英文課程作業。</p><form id="auth">${register ? '<label>教師姓名</label><input name="displayName" required autocomplete="name">' : ""}<label>Email</label><input name="email" type="email" required autocomplete="email"><label>密碼</label><input name="password" type="password" minlength="8" required autocomplete="${register ? "new-password" : "current-password"}"><div id="msg"></div><button>${register ? "註冊並進入工作台" : "登入"}</button></form><p><button id="switch" class="secondary">${register ? "已有帳號？登入" : "第一次使用？建立帳號"}</button></p></section>`;
  document.querySelector("#switch").onclick = () => teacherAuth(!register);
  document.querySelector("#auth").onsubmit = async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.target));
    try {
      const result = await request(
        `/api/auth/${register ? "register" : "login"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
      );
      state.teacher = result.teacher;
      teacherDashboard();
    } catch (x) {
      document.querySelector("#msg").innerHTML = message(x.message, true);
    }
  };
}
async function teacherDashboard() {
  const admin = state.teacher?.role === "super_admin";
  app.innerHTML = `<section class="panel wide"><div class="row"><div><div class="eyebrow">${admin ? "SUPER ADMIN" : "TEACHER"}</div><h2>作業管理</h2><small>${esc(state.teacher?.displayName)}｜${esc(state.teacher?.email)}</small></div><div class="actions" style="justify-content:flex-end">${admin ? '<button id="manageTeachers" class="secondary">教師管理</button>' : ""}<button id="trash" class="secondary">作業垃圾桶</button><button id="studentAssignments" class="secondary">學生個別作業區</button><button id="geminiSettings" class="secondary">Gemini 設定</button><button id="manageStudents" class="secondary">學生帳號</button><button id="submissionTrash" class="secondary">提交垃圾桶</button><button id="createNew">＋ 建立新作業</button><button id="logout" class="secondary">登出</button></div></div><div class="toolbar filters"><input id="search" placeholder="搜尋作業名稱、說明或題目文字"><select id="language"><option value="">全部語言</option><option value="zh-TW">中文課</option><option value="en">英文課</option></select><select id="days"><option value="">全部時間</option><option value="3">3 日內</option><option value="7">7 日內</option><option value="15">15 日內</option><option value="30">30 日內</option></select><select id="status"><option value="">全部狀態</option><option value="draft">發布草稿</option><option value="upcoming">尚未開放</option><option value="ongoing">進行中</option><option value="ended">已結束</option></select><button id="find">搜尋</button></div>${admin ? '<div class="admin-batch"><button id="selectEnded" class="secondary">一鍵選取本頁已截止作業</button><button id="trashAll" class="danger">資料與音檔移至垃圾桶</button><button id="trashAudio" class="danger">僅音檔移至垃圾桶</button></div>' : ""}<div id="assignmentList"></div></section>`;
  document.querySelector("#manageStudents").onclick = () => manageStudents(app, request, esc, teacherDashboard);
  document.querySelector("#submissionTrash").onclick = () => submissionTrash(app, request, esc, teacherDashboard);
  document.querySelector("#trash").onclick = adminTrash;
  document.querySelector("#studentAssignments").onclick = () => individualAssignments(app, request, esc, teacherDashboard);
  document.querySelector("#geminiSettings").onclick = () => editGemini(app, request, teacherDashboard);
  document.querySelector("#createNew").onclick = () => teacherCreate();
  document.querySelector("#logout").onclick = async () => {
    await request("/api/auth/logout", { method: "POST" });
    teacherAuth();
  };
  document.querySelector("#find").onclick = () => loadAssignments(1);
  if (admin) {
    document.querySelector("#manageTeachers").onclick = adminTeachers;
    document.querySelector("#selectEnded").onclick = () =>
      document
        .querySelectorAll('.assignment-check[data-ended="true"]')
        .forEach((x) => (x.checked = true));
    document.querySelector("#trashAll").onclick = () =>
      moveSelectedToTrash("all");
    document.querySelector("#trashAudio").onclick = () =>
      moveSelectedToTrash("audio");
  }
  document.querySelector("#search").onkeydown = (e) => {
    if (e.key === "Enter") loadAssignments(1);
  };
  loadAssignments(1);
}
const statusLabel = (s) =>
  s === "draft" ? "發布草稿" : s === "upcoming" ? "尚未開放" : s === "ended" ? "已結束" : "進行中";
async function loadAssignments(page = 1) {
  const box = document.querySelector("#assignmentList"),
    q = document.querySelector("#search").value,
    language = document.querySelector("#language").value,
    days = document.querySelector("#days").value,
    status = document.querySelector("#status").value;
  try {
    const data = await request(
      `/api/teacher/assignments?q=${encodeURIComponent(q)}&language=${encodeURIComponent(language)}&days=${days}&status=${status}&page=${page}`,
    );
    box.innerHTML = `<div class="list">${data.assignments.map((a) => `<article class="item clickable" data-id="${a.id}">${state.teacher?.role === "super_admin" && a.status === "ended" ? `<input class="assignment-check" data-ended="true" data-assignment="${a.id}" type="checkbox" aria-label="選取 ${esc(a.title)}">` : ""}<div class="row"><div><span class="tag">${a.language === "en" ? "英文課" : "中文課"}</span> <span class="tag status-${a.status}">${statusLabel(a.status)}</span> <span class="tag">${a.identityMode === "name_only" ? "不匿名（姓名）" : a.identityMode === "anonymous" ? "匿名" : "不匿名（姓名、學號）"}</span> ${a.deidentifyVoice ? '<span class="tag">🔒 聲音去識別化</span>' : ""} <span class="tag">教師：${esc(a.teacherName)}</span><h3>${esc(a.title)}</h3></div><div style="text-align:right"><b>${a.submissions}</b> 份作答<br><span class="muted">${a.sentenceCount} 題</span></div></div><p>${esc(a.instructions || "無作業說明")}</p><p class="muted">開放：${a.startsAt ? new Date(a.startsAt).toLocaleString("zh-TW") : "立即"} ～ ${a.endsAt ? new Date(a.endsAt).toLocaleString("zh-TW") : "不限"}</p>${a.publicationState === "draft" ? "" : `<span class="code" style="font-size:18px">${a.code}</span>`}</article>`).join("") || '<div class="notice">找不到符合條件的作業。</div>'}</div><div class="pagination"><button id="prev" class="secondary" ${data.pagination.page <= 1 ? "disabled" : ""}>上一頁</button><span>第 ${data.pagination.page}／${data.pagination.pages} 頁｜共 ${data.pagination.total} 份</span><button id="next" class="secondary" ${data.pagination.page >= data.pagination.pages ? "disabled" : ""}>下一頁</button></div>`;
    box.querySelectorAll("[data-id]").forEach(
      (el) =>
        (el.onclick = (event) => {
          if (!event.target.matches("input")) location.hash = `teacher/assignment/${encodeURIComponent(el.dataset.id)}`;
        }),
    );
    box.querySelectorAll("article[data-id]").forEach((el) => {
      if (el.querySelector(".status-draft")) return;
      const button = document.createElement("button");
      button.className = "classroom-entry";
      button.textContent = "✦ 上課互動式演示";
      button.onclick = (event) => {
        event.stopPropagation();
        location.hash = `classroom/${encodeURIComponent(el.dataset.id)}`;
      };
      el.append(button);
    });
    document.querySelector("#prev").onclick = () =>
      loadAssignments(data.pagination.page - 1);
    document.querySelector("#next").onclick = () =>
      loadAssignments(data.pagination.page + 1);
  } catch (x) {
    if (x.message === "請先登入") return teacherAuth();
    box.innerHTML = message(x.message, true);
  }
}
async function moveSelectedToTrash(scope) {
  const assignmentIds = [
    ...document.querySelectorAll(".assignment-check:checked"),
  ].map((x) => x.dataset.assignment);
  if (!assignmentIds.length) return alert("請先選取已截止作業");
  const label = scope === "all" ? "全部作業資料與學生音檔" : "學生音檔";
  if (!confirm(`確定將選取作業的${label}移至垃圾桶？30 天後會永久刪除。`))
    return;
  try {
    await request("/api/admin/trash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentIds, scope }),
    });
    await loadAssignments(1);
  } catch (error) {
    alert(error.message);
  }
}
async function adminTeachers() {
  app.innerHTML = `<section class="panel wide"><button id="back" class="secondary">← 回已發布作業</button><div class="eyebrow" style="margin-top:24px">SUPER ADMIN</div><h2>教師帳號與邀請</h2><form id="invite"><div class="row"><div><label>受邀教師 Email</label><input name="email" type="email" required></div><div><label>啟用時間</label><input name="activeFrom" type="datetime-local"></div><div><label>停用時間</label><input name="activeUntil" type="datetime-local"></div></div><button>新增／更新邀請</button><span id="inviteMsg"></span></form><div id="teachers">載入中…</div></section>`;
  document.querySelector("#back").onclick = teacherDashboard;
  document.querySelector("#invite").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await request("/api/admin/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: f.get("email"),
          activeFrom: f.get("activeFrom")
            ? new Date(f.get("activeFrom")).toISOString()
            : null,
          activeUntil: f.get("activeUntil")
            ? new Date(f.get("activeUntil")).toISOString()
            : null,
        }),
      });
      e.target.reset();
      document.querySelector("#inviteMsg").textContent = " ✓ 邀請已建立";
      loadTeachers();
    } catch (x) {
      document.querySelector("#inviteMsg").textContent = " " + x.message;
    }
  };
  loadTeachers();
}
async function loadTeachers() {
  try {
    const data = await request("/api/admin/teachers"),
      box = document.querySelector("#teachers");
    box.innerHTML = `<h3>已建立帳號</h3><div class="list">${data.teachers.map((t) => `<div class="item"><div class="row"><div><b>${esc(t.displayName)}</b><br>${esc(t.email)} <span class="tag">${t.role === "super_admin" ? "最高管理員" : t.disabledAt ? "已停用" : "教師"}</span></div>${t.role === "teacher" ? `<button class="secondary edit-teacher" data-id="${t.id}">設定期限／停用</button>` : ""}</div><p class="muted">啟用：${t.activeFrom ? new Date(t.activeFrom).toLocaleString("zh-TW") : "立即"} ～ ${t.activeUntil ? new Date(t.activeUntil).toLocaleString("zh-TW") : "不限"}</p></div>`).join("")}</div><h3>尚未註冊的邀請</h3><div class="list">${data.invites.map((i) => `<div class="item"><b>${esc(i.email)}</b><p class="muted">啟用：${i.activeFrom ? new Date(i.activeFrom).toLocaleString("zh-TW") : "立即"} ～ ${i.activeUntil ? new Date(i.activeUntil).toLocaleString("zh-TW") : "不限"}</p></div>`).join("") || '<div class="notice">目前沒有待註冊邀請。</div>'}</div>`;
    box.querySelectorAll(".edit-teacher").forEach(
      (btn) =>
        (btn.onclick = () => {
          const t = data.teachers.find((x) => x.id === btn.dataset.id),
            activeFrom = prompt("啟用時間（ISO 或留空）", t.activeFrom || ""),
            activeUntil = prompt("停用時間（ISO 或留空）", t.activeUntil || "");
          if (activeFrom === null || activeUntil === null) return;
          const disabled = confirm(
            "按「確定」會立即停用；按「取消」會保持／恢復啟用。",
          );
          request(`/api/admin/teachers/${t.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              activeFrom: activeFrom || null,
              activeUntil: activeUntil || null,
              disabled,
            }),
          })
            .then(loadTeachers)
            .catch((e) => alert(e.message));
        }),
    );
  } catch (x) {
    document.querySelector("#teachers").innerHTML = message(x.message, true);
  }
}
async function adminTrash() {
  app.innerHTML = `<section class="panel wide"><button id="back" class="secondary">← 回已發布作業</button><div class="eyebrow" style="margin-top:24px">30-DAY TRASH</div><h2>垃圾桶</h2><p>到期後由 Cloudflare 排程永久清除 D1 資料與 R2 音檔。</p><div class="actions"><button id="emptyAssignments" class="danger">清空全部作業資料</button><button id="emptyAudio" class="danger">清空全部音檔</button></div><div id="trashList">載入中…</div></section>`;
  document.querySelector("#back").onclick = teacherDashboard;
  document.querySelector("#emptyAssignments").onclick = () =>
    purgeTrash("all", true);
  document.querySelector("#emptyAudio").onclick = () =>
    purgeTrash("audio", true);
  if (state.teacher?.role !== "super_admin") {
    document.querySelector("#emptyAssignments").parentElement.hidden = true;
  }
  loadTrash();
}
async function loadTrash() {
  try {
    const d = await request("/api/admin/trash"),
      box = document.querySelector("#trashList");
    const group = (rows, scope) =>
      rows
        .map(
          (x) =>
            `<div class="item"><input class="trash-check" data-id="${x.id || x.assignment_id}" data-scope="${scope}" type="checkbox"> <b>${esc(x.title)}</b><p>${x.audio_count || 0} 個音檔｜預計永久刪除：${new Date(x.purge_after).toLocaleString("zh-TW")}</p><button class="secondary restore" data-id="${x.id || x.assignment_id}" data-scope="${scope}">還原</button> <button class="danger purge-one" data-id="${x.id || x.assignment_id}" data-scope="${scope}">立即永久刪除</button></div>`,
        )
        .join("");
    box.innerHTML = `<h3>完整作業資料</h3><div class="list">${group(d.assignments, "all") || '<div class="notice">無</div>'}</div><h3>僅音檔</h3><div class="list">${group(d.audio, "audio") || '<div class="notice">無</div>'}</div>`;
    box
      .querySelectorAll(".restore")
      .forEach(
        (b) =>
          (b.onclick = async () => {
            try { await trashAction("/api/admin/trash/restore", b.dataset.scope, [b.dataset.id]); }
            catch (error) { alert(error.message); }
          }),
      );
    if (state.teacher?.role !== "super_admin") box.querySelectorAll(".purge-one").forEach(button => button.remove());
    box
      .querySelectorAll(".purge-one")
      .forEach(
        (b) =>
          (b.onclick = () =>
            purgeTrash(b.dataset.scope, false, [b.dataset.id])),
      );
  } catch (e) {
    document.querySelector("#trashList").innerHTML = message(e.message, true);
  }
}
async function trashAction(url, scope, assignmentIds) {
  await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, assignmentIds }),
  });
  loadTrash();
}
async function purgeTrash(scope, all = false, assignmentIds = []) {
  if (!confirm("永久刪除後無法復原，確定繼續？")) return;
  try {
    await request("/api/admin/trash/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, all, assignmentIds }),
    });
    loadTrash();
  } catch (e) {
    alert(e.message);
  }
}
function teacherCreate(source) {
  app.innerHTML = `<section class="panel wide"><button id="back" class="secondary">← 回作業清單</button><div class="eyebrow" style="margin-top:24px">NEW ASSIGNMENT</div><h2>建立新作業</h2><form id="create"><fieldset class="identity-options"><legend>學生身分資料</legend><label class="check"><input name="identityMode" type="radio" value="name_only">不匿名作業（姓名）</label><small>只蒐集姓名，不要求學號。</small><label class="check"><input name="identityMode" type="radio" value="full" checked>不匿名作業（姓名、學號）</label><small>蒐集姓名與學號。</small><label class="check"><input name="identityMode" type="radio" value="anonymous">匿名作業（不蒐集姓名、學號）</label><small>姓名與學號皆不蒐集，改用匿名編號。</small></fieldset><label class="check"><input name="deidentifyVoice" type="checkbox">啟用聲音去識別化（原始錄音不會上傳，只保存裝置內轉換後的 WAV）</label><p class="muted">採用 PROFILE_A v2.0.1，用於降低聲音被辨識的風險，不保證完全匿名。</p><label>課程語言</label><select name="language" required><option value="zh-TW">中文課</option><option value="en">英文課</option></select><div class="row"><div><label>作業開始時間</label><input name="startsAt" type="datetime-local"></div><div><label>作業結束時間</label><input name="endsAt" type="datetime-local"></div></div><label>作業名稱</label><input name="title" required placeholder="例：第一課課文朗讀"><label>作業說明</label><textarea name="instructions" placeholder="請用自然的速度朗讀"></textarea><div class="question-editor"><h3>練習題目</h3><div class="question-cards"></div><div class="question-add-row"><button type="button" class="secondary add-question">＋ 增加題目</button></div></div><div id="msg"></div><button>建立並發布</button></form></section>`;
  document.querySelector("#back").onclick = source ? () => teacherDetail(source.id) : teacherDashboard;
  const form = document.querySelector("#create");
  if (source) {
    form.elements.title.value = `${source.title}（副本）`;
    form.elements.instructions.value = source.instructions || "";
    form.elements.language.value = source.language;
    form.elements.identityMode.value = source.identityMode;
    form.elements.deidentifyVoice.checked = source.deidentifyVoice;
  }
  const limits = limitsEditor(form, source);
  const pick = assignmentsPicker(form, request, esc);
  const editor = questionsEditor(form, request, esc, source, false);
  const splitting = assignmentSplitter(form, request, editor);
  const creationKey = crypto.randomUUID();
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (splitting()) return;
    const button = form.querySelector('button:not([type])');
    button.disabled = true;
    const f = new FormData(form);
    const files = editor.files();
    try {
      const a = await request("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: f.get("title"),
          instructions: f.get("instructions"),
          language: f.get("language"),
          startsAt: f.get("startsAt")
            ? new Date(f.get("startsAt")).toISOString()
            : null,
          endsAt: f.get("endsAt")
            ? new Date(f.get("endsAt")).toISOString()
            : null,
          identityMode: f.get("identityMode"),
          deidentifyVoice: f.get("deidentifyVoice") === "on",
          ...limits(),
          generateOnPublish: true,
          creationKey,
          recipientIds: pick(),
          sentences: editor.read(),
        }),
      });
      if (a.publicationState === "published") {
        if (form.isConnected) created(a);
        return;
      }
      const draftRoute = "teacher/assignment/" + encodeURIComponent(a.id);
      try {
        form.querySelector("#msg").textContent = "草稿已儲存，正在準備題目音檔與語塊卡…";
        await editor.upload(a.sentences, a.revision, files);
        const published = await request("/api/teacher/assignments/" + a.id + "/publish", { method: "POST" });
        if (!form.isConnected) return;
        if (published.published) created(a);
        else location.hash = draftRoute;
      } catch (error) {
        if (!form.isConnected) return;
        if (location.hash === "#" + draftRoute) await teacherDetail(a.id, error.message);
        else {
          location.hash = draftRoute;
          if (!error.status || error.status !== 422) alert("草稿已儲存。" + error.message);
        }
      }
    } catch (x) {
      form.querySelector("#msg").innerHTML = message(x.message, true);
      button.disabled = false;
    }
  };
}
function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
async function teacherDetail(id, notice = "") {
  app.innerHTML = `<section class="panel wide"><button id="back" class="secondary">← 回作業清單</button><div id="detail">載入中…</div></section>`;
  document.querySelector("#back").onclick = () => { location.hash = "teacher"; };
  const detail = document.querySelector("#detail");
  try {
    const data = await request(`/api/teacher/assignments/${id}`),
      a = data.assignment,
      map = Object.fromEntries(a.sentences.map((s) => [s.id, s]));
    if (!detail.isConnected) return;
    const isDraft = a.publicationState === "draft";
    const ownAssignment = a.teacherId === state.teacher?.id;
    detail.innerHTML =
      `<div class="eyebrow" style="margin-top:24px">${a.language === "en" ? "ENGLISH" : "CHINESE"} COURSE｜教師：${esc(a.teacherName)}</div><h2>${esc(a.title)}</h2><div class="notice">${isDraft ? "發布草稿" : `課程代碼：<b>${a.code}</b>`}｜${a.sentences.length} 題${a.deidentifyVoice ? "｜🔒 聲音去識別化 " + esc(a.transformVersion) : ""}</div><div class="detail-tabs" role="tablist" aria-label="作業管理"><button type="button" class="detail-tab active" role="tab" aria-selected="true" aria-controls="settingsPanel" data-tab="settingsPanel">題目與設定</button><button type="button" class="detail-tab" role="tab" aria-selected="false" aria-controls="submissionsPanel" data-tab="submissionsPanel">學生提交與批改 <span>${data.sessions.length}</span></button></div><section id="settingsPanel" class="detail-tab-panel" role="tabpanel"><form id="schedule"><label>作業名稱</label><input name="title" required value="${esc(a.title)}"><label>作業說明</label><textarea name="instructions">${esc(a.instructions || "")}</textarea><label>課程語言</label><select name="language"><option value="zh-TW" ${a.language === "zh-TW" ? "selected" : ""}>中文課</option><option value="en" ${a.language === "en" ? "selected" : ""}>英文課</option></select><label>學生身分資料模式</label><select name="identityMode" ${a.hasSubmissions ? "disabled" : ""}><option value="name_only" ${a.identityMode === "name_only" ? "selected" : ""}>不匿名作業（姓名）</option><option value="full" ${a.identityMode === "full" ? "selected" : ""}>不匿名作業（姓名、學號）</option><option value="anonymous" ${a.identityMode === "anonymous" ? "selected" : ""}>匿名作業（不蒐集姓名、學號）</option></select><label class="check"><input name="deidentifyVoice" type="checkbox" ${a.deidentifyVoice ? "checked" : ""} ${a.hasSubmissions ? "disabled" : ""}>啟用聲音去識別化${a.hasSubmissions ? "（已有學生作答，設定已鎖定）" : ""}</label><div class="row"><div><label>作業開始時間</label><input name="startsAt" type="datetime-local" value="${toLocalInput(a.startsAt)}"></div><div><label>作業結束時間</label><input name="endsAt" type="datetime-local" value="${toLocalInput(a.endsAt)}"></div></div><div class="question-editor"><h3>練習題目</h3><div class="question-cards"></div><div class="question-add-row"><button type="button" class="secondary add-question">＋ 增加題目</button></div></div><button>儲存作業修改</button><span id="scheduleMsg"></span></form></section><section id="submissionsPanel" class="detail-tab-panel" role="tabpanel" hidden><h3>學生提交（${data.sessions.length}）</h3><p class="muted">勾選測試或無效提交即可快速移到垃圾桶；展開提交後可在每一題錄音下方批改。</p>${data.sessions.length?'<div class="submission-tools"><button type="button" id="selectAllSubmissions" class="secondary">勾選全部</button><button type="button" id="trashSelectedSubmissions" class="danger" disabled>勾選後移到垃圾桶</button></div>':''}<div class="list">${submissionList(data.sessions, map, esc)}</div></section>`;
    const demoLink = document.createElement("a");
    demoLink.className = "btn classroom-entry";
    demoLink.href = `#classroom/${encodeURIComponent(id)}`;
    demoLink.textContent = "✦ 上課互動式演示";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "secondary";
    copy.textContent = "複製作業";
    copy.onclick = () => teacherCreate(a);
    const trash = document.createElement("button");
    trash.type = "button";
    trash.className = "danger";
    trash.textContent = "作業移入垃圾桶";
    trash.onclick = async () => {
      if (!confirm("移入後立即停止收件。30 天內可還原作業及錄音。")) return;
      trash.disabled = true;
      try {
        await request("/api/admin/trash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "all", assignmentIds: [a.id] }) });
        location.hash = "teacher";
      } catch (error) { alert(error.message); trash.disabled = false; }
    };
    const generate = document.createElement("button");
    generate.type = "button";
    generate.className = "secondary";
    generate.textContent = isDraft ? "生成語塊並發布" : a.vocabularyReady ? "重新生成語塊卡" : "補建語塊卡";
    generate.disabled = a.vocabularyGenerating;
    generate.hidden = !ownAssignment;
    const generationStatus = document.createElement("span");
    generationStatus.setAttribute("role", "status");
    const backgroundMessage = "正在背景生成語塊卡，可以離開此頁。";
    const vocabularyPath = "/api/teacher/assignments/" + encodeURIComponent(id) + "/vocabulary";
    generationStatus.textContent = a.vocabularyGenerating ? backgroundMessage : a.vocabularyError || (a.vocabularyReady ? "語塊卡已就緒。" : "");
    function watchVocabulary() {
      setTimeout(async () => {
        if (!detail.isConnected) return;
        try {
          const status = await request(vocabularyPath);
          if (!detail.isConnected) return;
          if (status.generating) { watchVocabulary(); return; }
          generate.disabled = false;
          if (status.error) { generationStatus.textContent = status.error; return; }
          if (isDraft && status.published) { await teacherDetail(id, "作業已發布"); return; }
          if (status.revision === a.revision + 1) a.revision = status.revision;
          if (status.ready) {
            a.vocabularyReady = true;
            generate.textContent = "重新生成語塊卡";
          }
          generationStatus.textContent = "語塊卡已更新。";
        } catch (error) {
          if (!detail.isConnected) return;
          generationStatus.textContent = "暫時無法查詢語塊進度。";
          if (error.status !== 401 && error.status !== 404) watchVocabulary();
          else generate.disabled = false;
        }
      }, 3000);
    }
    if (ownAssignment && a.vocabularyGenerating) watchVocabulary();
    generate.onclick = async () => {
      const message = !isDraft && a.vocabularyReady
        ? "將整份題目送給 Gemini 並使用你的專案配額。新版會取代目前的語塊卡（含手動修改）。已開始的作答及已收藏的卡片保留原版。"
        : "將已儲存的整份題目送給 Gemini，使用你的專案配額？";
      if (!confirm(message)) return;
      generate.disabled = true;
      generationStatus.textContent = "正在送出生成工作…";
      try {
        const url = isDraft ? "/api/teacher/assignments/" + encodeURIComponent(id) + "/publish" : vocabularyPath;
        const result = await request(url, { method: "POST" });
        if (!detail.isConnected) return;
        if (result.published) await teacherDetail(id, isDraft ? "作業已發布" : "語塊卡已建立");
        else {
          generationStatus.textContent = backgroundMessage;
          watchVocabulary();
        }
      } catch (error) { generationStatus.textContent = error.message; generate.disabled = false; }
    };
    const actions = document.createElement("div");
    actions.className = "actions";
    if (!isDraft) actions.append(demoLink);
    actions.append(copy, trash, generate, generationStatus);
    detail.prepend(actions);
    document.querySelectorAll(".detail-tab").forEach((tab) => tab.onclick = () => {
      document.querySelectorAll(".detail-tab").forEach((button) => { const active = button === tab; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); });
      document.querySelectorAll(".detail-tab-panel").forEach((panel) => { panel.hidden = panel.id !== tab.dataset.tab; });
    });
    bindFeedback(document.querySelector("#detail"), data.sessions, map, request, esc);
    bindSubmissions(document.querySelector("#detail"), request, async () => { await teacherDetail(id); document.querySelector('[data-tab="submissionsPanel"]')?.click(); });
    const form = detail.querySelector("#schedule");
    form.querySelector("#scheduleMsg").textContent = notice;
    const limits = limitsEditor(form, a);
    const pick = assignmentsPicker(form, request, esc, a.recipientIds, a.id);
    const editor = questionsEditor(form, request, esc, a, true);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(form), status = form.querySelector("#scheduleMsg");
      const files = editor.files();
      const button = form.querySelector('button:not([type])');
      button.disabled = true;
      status.textContent = isDraft ? "正在儲存草稿…" : "正在儲存作業，如有改題將先更新語塊卡…";
      try {
        const result = await request(`/api/teacher/assignments/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: f.get("title"),
            instructions: f.get("instructions"),
            language: f.get("language"),
            deidentifyVoice: a.hasSubmissions
              ? a.deidentifyVoice
              : f.get("deidentifyVoice") === "on",
            identityMode: a.hasSubmissions
              ? a.identityMode
              : f.get("identityMode"),
            startsAt: f.get("startsAt")
              ? new Date(f.get("startsAt")).toISOString()
              : null,
            endsAt: f.get("endsAt")
              ? new Date(f.get("endsAt")).toISOString()
              : null,
            ...limits(),
            revision: a.revision,
            generateVocabulary: ownAssignment,
            recipientIds: pick(),
            sentences: editor.read(),
          }),
        });
        let savedNotice = "已儲存作業";
        try { await editor.upload(result.sentences, result.revision, files); }
        catch (error) { savedNotice += "。朗讀音檔待重傳。" + error.message; }
        if (detail.isConnected) await teacherDetail(id, savedNotice);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    };
  } catch (x) {
    detail.innerHTML = message(x.message, true);
  }
}
function created(a) {
  app.innerHTML = `<section class="panel" style="text-align:center"><div class="eyebrow">作業已建立｜${a.language === "en" ? "英文課" : "中文課"}</div><h2>${esc(a.title)}</h2><p>請將課程代碼提供給學生</p><div class="code">${a.code}</div><div class="notice">作業已加入「已發布作業」，並依開始與結束時間自動控制提交。</div><button id="dashboard">回已發布作業</button></section>`;
  document.querySelector("#dashboard").onclick = () => {
    if (location.hash === "#teacher") teacherDashboard();
    else location.hash = "teacher";
  };
}
let closeClassroom;
function route() {
  closeLocalPractice?.();
  closeLocalPractice = null;
  disposeFeedbackRecording();
  stopSpeech(); closeWord();
  disposeRecording?.();
  closeClassroom?.();
  closeClassroom = null;
  const page = location.hash.slice(1) || "home";
  if (page === "classroom-preview" || page.startsWith("classroom/")) {
    closeClassroom = openClassroom(app, { preview: page === "classroom-preview", id: page.split("/")[1], request });
    return;
  }
  if (page.startsWith("teacher/assignment/")) {
    const id = page.split("/")[2];
    if (state.teacher) teacherDetail(id);
    else request("/api/auth/me").then(({ teacher }) => { if (location.hash.slice(1) === page) { state.teacher = teacher; teacherDetail(id); } }).catch(() => { if (location.hash.slice(1) === page) location.hash = "teacher"; });
    return;
  }
  (({ home, student, teacher })[page] || home)();
}
window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", cleanupTest);
route();
