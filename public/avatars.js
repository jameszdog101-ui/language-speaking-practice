export function setAvatar(element, url) {
  element.replaceChildren();
  if (!url) return;
  const photo = document.createElement('img');
  photo.alt = '';
  photo.src = url;
  photo.onerror = () => photo.remove();
  element.append(photo);
}

function squarePhoto(source, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  const size = Math.min(width, height);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 256, 256);
  context.drawImage(source, (width - size) / 2, (height - size) / 2, size, size, 0, 0, 256, 256);
  return new Promise((resolve, reject) => canvas.toBlob(photo => {
    if (photo) resolve(photo);
    else reject(Error('無法處理這張圖片，請重新選擇。'));
  }, 'image/jpeg', 0.88));
}

export function editAvatar(root, path, current, done) {
  const dialog = document.createElement('dialog');
  dialog.className = 'avatar-dialog';
  dialog.setAttribute('aria-label', '設定頭像');
  dialog.innerHTML = `<h3>設定頭像</h3>
    <div class="avatar-stage">
      <div class="profile-avatar avatar-preview" aria-hidden="true"></div>
      <video playsinline muted hidden aria-label="相機預覽"></video>
    </div>
    <div class="actions avatar-source-actions">
      <button type="button" class="secondary choose-avatar">從相簿選擇</button>
      <input type="file" accept="image/*" hidden aria-label="從相簿選擇頭像">
      <button type="button" class="secondary open-camera">開啟相機</button>
      <button type="button" class="take-avatar" hidden disabled>拍照</button>
    </div>
    <p role="status"></p>
    <div class="actions avatar-dialog-actions">
      <button type="button" class="secondary cancel-avatar" autofocus>取消</button>
      <button type="button" class="danger remove-avatar">移除頭像</button>
      <button type="button" class="save-avatar" disabled>儲存頭像</button>
    </div>`;
  const preview = dialog.querySelector('.avatar-preview');
  const file = dialog.querySelector('input');
  const video = dialog.querySelector('video');
  const choose = dialog.querySelector('.choose-avatar');
  const camera = dialog.querySelector('.open-camera');
  const take = dialog.querySelector('.take-avatar');
  const save = dialog.querySelector('.save-avatar');
  const remove = dialog.querySelector('.remove-avatar');
  const cancel = dialog.querySelector('.cancel-avatar');
  const status = dialog.querySelector('[role="status"]');
  let stream, previewUrl, photo, busy = false, selection = 0;
  setAvatar(preview, current);
  remove.hidden = !current;

  function stopCamera() {
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    video.hidden = take.hidden = true;
    take.disabled = true;
    camera.disabled = busy;
  }
  function release() {
    selection++;
    observer.disconnect();
    stopCamera();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    dialog.remove();
  }
  const observer = new MutationObserver(() => { if (!dialog.isConnected) release(); });
  dialog.addEventListener('close', release, { once: true });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  cancel.onclick = () => dialog.close();

  async function prepare(source, width, height, selected) {
    const cropped = await squarePhoto(source, width, height);
    if (!dialog.open || selected !== selection) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    photo = cropped;
    previewUrl = URL.createObjectURL(photo);
    setAvatar(preview, previewUrl);
    save.disabled = false;
    status.textContent = '';
  }
  choose.onclick = () => file.click();
  file.onchange = async () => {
    const image = file.files[0];
    if (!image) return;
    file.value = '';
    const selected = ++selection;
    stopCamera();
    save.disabled = true;
    const url = URL.createObjectURL(image);
    try {
      const source = new Image();
      source.src = url;
      await source.decode();
      await prepare(source, source.naturalWidth, source.naturalHeight, selected);
    } catch {
      if (selected === selection) { status.textContent = '無法開啟這張圖片，請重新選擇。'; save.disabled = !photo; }
    } finally { URL.revokeObjectURL(url); }
  };
  camera.onclick = async () => {
    const selected = ++selection;
    camera.disabled = true;
    save.disabled = true;
    status.textContent = '正在開啟相機…';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error();
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (!dialog.open || selected !== selection) { next.getTracks().forEach(track => track.stop()); return; }
      stream = next;
      video.srcObject = next;
      video.hidden = take.hidden = false;
      await video.play();
      if (!dialog.open || selected !== selection) return;
      take.disabled = !video.videoWidth;
      status.textContent = '';
    } catch {
      if (!dialog.open || selected !== selection) return;
      stopCamera();
      save.disabled = !photo;
      status.textContent = '無法開啟相機，請確認相機權限，或從相簿選擇。';
    }
  };
  take.onclick = async () => {
    const selected = ++selection;
    take.disabled = true;
    try { await prepare(video, video.videoWidth, video.videoHeight, selected); }
    catch (error) { if (selected === selection) { status.textContent = error.message; save.disabled = !photo; } }
    finally { if (selected === selection) stopCamera(); }
  };

  async function submit(method) {
    if (busy) return;
    busy = true;
    selection++;
    stopCamera();
    choose.disabled = remove.disabled = save.disabled = cancel.disabled = true;
    status.textContent = '正在儲存…';
    try {
      const reply = await fetch(path, method === 'PUT' ? { method, body: photo } : { method });
      const data = await reply.json();
      if (!reply.ok) throw Error(data.error);
      if (dialog.open) {
        dialog.close();
        done(data.avatarUrl ? `${data.avatarUrl}?v=${Date.now()}` : null);
      }
    } catch (error) {
      busy = false;
      choose.disabled = camera.disabled = remove.disabled = cancel.disabled = false;
      save.disabled = !photo;
      status.textContent = error.message;
    }
  }
  save.onclick = () => { if (photo) submit('PUT'); };
  remove.onclick = () => submit('DELETE');
  root.append(dialog);
  observer.observe(root, { childList: true });
  dialog.showModal();
}
