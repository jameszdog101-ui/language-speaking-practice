import { enhanceQuestion, closeWord, stopSpeech } from './learning.js';
import { prepareRecording } from './recording.js';

export function openLocalPractice(app, assignment, entry, { back, esc }) {
  const clips = new Map();
  let index = 0, disposed = false, capture, url, stream, limitTimer;
  const stop = () => {
    clearTimeout(limitTimer);
    if (capture?.state === 'recording') {
      capture.onstop = null;
      capture.stop();
    }
    stream?.getTracks().forEach(track => track.stop());
    app.querySelectorAll('audio').forEach(audio => audio.pause());
    if (url) URL.revokeObjectURL(url);
    url = null;
    closeWord();
    stopSpeech();
  };
  const close = () => { disposed = true; stop(); clips.clear(); };
  function draw(review = false) {
    stop();
    const question = assignment.sentences[index];
    app.innerHTML = `<section class="panel wide"><div class="row"><h2>${esc(assignment.title)} · 練習</h2><button type="button" class="secondary practice-back">結束練習</button></div><p>練習錄音只在此裝置暫存，結束後清除。登入後可將不熟悉的單字收藏到帳號。</p>
      ${review ? '<h3>複習題目與收藏單字</h3><div class="practice-review"></div>' : `<p>第 ${index + 1}／${assignment.sentences.length} 題</p><div class="sentence"><h3 class="practice-text">${esc(question.text)}</h3><p>${esc(question.pinyin || '')}</p><button type="button" class="record" aria-label="開始練習錄音">●</button><p class="practice-status" role="status"></p><div class="practice-audio"></div></div>`}
      <div class="actions">${review ? '<button type="button" class="secondary continue-practice">繼續練習</button>' : `<button type="button" class="secondary prev-practice" ${index ? '' : 'disabled'}>上一題</button><button type="button" class="secondary next-practice" ${index < assignment.sentences.length - 1 ? '' : 'disabled'}>下一題</button><button type="button" class="review-practice">複習與收藏</button>`}</div></section>`;
    app.querySelector('.practice-back').onclick = () => { close(); back(); };
    if (review) {
      const root = app.querySelector('.practice-review');
      for (const [position, item] of assignment.sentences.entries()) {
        const card = document.createElement('article');
        card.className = 'item practice-review-item';
        const badge = document.createElement('span');
        badge.className = 'tag';
        badge.textContent = `第 ${position + 1} 題`;
        const row = document.createElement('h4');
        row.className = 'practice-review-text';
        row.textContent = item.text;
        row.setAttribute('aria-label', `第 ${position + 1} 題`);
        card.append(badge, row);
        root.append(card);
        enhanceQuestion(row, assignment.language, { ...entry, questionId: item.id });
      }
      app.querySelector('.continue-practice').onclick = () => draw();
      return;
    }
    enhanceQuestion(app.querySelector('.practice-text'), assignment.language, { ...entry, questionId: question.id });
    const button = app.querySelector('.record'), status = app.querySelector('.practice-status');
    const previous = app.querySelector('.prev-practice'), next = app.querySelector('.next-practice');
    const reviewButton = app.querySelector('.review-practice');
    const busy = value => {
      previous.disabled = value || index === 0;
      next.disabled = value || index === assignment.sentences.length - 1;
      reviewButton.disabled = value;
    };
    const playback = () => {
      const clip = clips.get(question.id);
      if (!clip) return;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(clip);
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = url;
      app.querySelector('.practice-audio').replaceChildren(audio);
    };
    playback();
    previous.onclick = () => { index--; draw(); };
    next.onclick = () => { index++; draw(); };
    reviewButton.onclick = () => draw(true);
    button.onclick = async () => {
      if (capture?.state === 'recording') { button.disabled = true; capture.stop(); return; }
      button.disabled = true;
      busy(true);
      app.querySelectorAll('audio').forEach(audio => audio.pause());
      stopSpeech();
      closeWord();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (disposed) { stream.getTracks().forEach(track => track.stop()); return; }
        const pieces = [];
        capture = new MediaRecorder(stream);
        capture.ondataavailable = event => { if (event.data.size) pieces.push(event.data); };
        const startedAt = performance.now();
        const secondsLimit = question.recordingSeconds || 180;
        capture.onstop = async () => {
          clearTimeout(limitTimer);
          stream.getTracks().forEach(track => track.stop());
          if (disposed) return;
          const blob = new Blob(pieces, { type: capture.mimeType });
          button.classList.remove('live');
          status.textContent = '正在準備練習錄音…';
          try {
            const seconds = Math.min(secondsLimit, (performance.now() - startedAt) / 1000 + 0.75);
            const recording = await prepareRecording(blob, seconds);
            if (disposed) return;
            clips.set(question.id, recording);
            playback();
            status.textContent = '練習錄音已準備，可播放確認。';
          } catch {
            if (disposed) return;
            status.textContent = '無法讀取本次練習錄音，請再試一次。';
          }
          button.disabled = false;
          button.setAttribute('aria-label', '開始練習錄音');
          button.textContent = '●';
          busy(false);
        };
        capture.start();
        limitTimer = setTimeout(() => { if (capture.state === 'recording') capture.stop(); }, secondsLimit * 1000);
        button.disabled = false;
        button.classList.add('live');
        button.setAttribute('aria-label', '停止練習錄音');
        button.textContent = '■';
        status.textContent = '錄音中';
      } catch (error) {
        stream?.getTracks().forEach(track => track.stop());
        if (!disposed) status.textContent = error.message;
        button.disabled = false;
        busy(false);
      }
    };
  }
  draw();
  return close;
}
