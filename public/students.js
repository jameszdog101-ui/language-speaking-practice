import { showVocabulary } from './learning.js';

export async function studentPortal(app, request, esc, join, history) {
  let account;
  try { account=(await request('/api/student/me')).student; } catch {}
  if (!account) {
    app.innerHTML=`<section class="panel"><h2>學生登入</h2><p>請使用教師提供的帳號與初始密碼。</p><form id="studentLogin"><label>帳號<input name="username" required autocomplete="username"></label><label>密碼<input name="password" type="password" required autocomplete="current-password"></label><p id="studentMessage" role="status"></p><button>登入</button></form><button id="guestEntry" class="secondary">免登入進入網站</button></section>`;
    app.querySelector('#guestEntry').onclick=()=>join(true);
    app.querySelector('form').onsubmit=async e=>{e.preventDefault(); try{await request('/api/student/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))}); await studentPortal(app,request,esc,join,history);}catch(error){app.querySelector('#studentMessage').textContent=error.message;}};
    return;
  }
  if(account.mustChangePassword) { passwordForm(app,request,()=>studentPortal(app,request,esc,join,history)); return; }
  app.innerHTML=`<section class="panel wide student-dashboard"><div class="row"><div><h2>我的作業</h2><p>${esc(account.displayName)}｜${esc(account.username)}</p></div><div class="actions"><button id="joinAssignment">輸入作業代碼</button><button id="changePassword" class="secondary">修改密碼</button><button id="studentLogout" class="secondary">登出</button></div></div><div id="studentHistory"></div></section>`;
  app.querySelector('#joinAssignment').onclick=()=>join(false,account);
  app.querySelector('#changePassword').onclick=()=>passwordForm(app,request,()=>studentPortal(app,request,esc,join,history));
  app.querySelector('#studentLogout').onclick=async()=>{await request('/api/student/logout',{method:'POST'}); studentPortal(app,request,esc,join,history);};
  const historyRoot = app.querySelector('#studentHistory');
  const tabs = document.createElement('div');
  tabs.className = 'actions';
  tabs.innerHTML = '<button type="button" class="secondary my-assignments">我的作業</button><button type="button" class="secondary my-vocabulary">單字庫</button>';
  historyRoot.before(tabs);
  const assignmentsView = async () => {
    const assigned = document.createElement('div'), submissions = document.createElement('div');
    historyRoot.replaceChildren(assigned, submissions);
    const pending = (async () => {
      try {
        const { assignments } = await request('/api/student/assigned');
        if (!assignments.length) return;
        assigned.innerHTML = '<h3>老師指派的作業</h3>' + assignments.map(row => `<div class="item row"><span><b>${esc(row.title)}</b> · ${esc(row.teacher_name || '')} <span class="assignment-state ${row.completed_at ? 'is-complete' : 'is-open'}">${row.completed_at ? '已完成' : '未完成'}</span></span><button type="button" class="secondary" data-code="${esc(row.code)}">開啟作業</button></div>`).join('');
        assigned.querySelectorAll('[data-code]').forEach(button => button.onclick = () => join(false, account, button.dataset.code));
      } catch (error) { assigned.textContent = error.message; }
    })();
    await Promise.all([pending, history?.(submissions, request, esc)]);
  };
  tabs.querySelector('.my-assignments').onclick = assignmentsView;
  tabs.querySelector('.my-vocabulary').onclick = () => showVocabulary(historyRoot, request);
  await assignmentsView();
}
function passwordForm(app,request,done) {
  app.innerHTML='<section class="panel"><h2>設定新密碼</h2><p>首次登入或教師重設後，需要修改密碼才能繼續。</p><form><label>目前／初始密碼<input name="currentPassword" type="password" required autocomplete="current-password"></label><label>新密碼<input name="password" type="password" minlength="8" maxlength="128" required autocomplete="new-password"></label><label>再次輸入新密碼<input name="confirmPassword" type="password" required autocomplete="new-password"></label><p role="status"></p><button>儲存密碼</button></form></section>';
  app.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));try{if(b.password!==b.confirmPassword)throw Error('兩次新密碼不一致');await request('/api/student/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});done();}catch(error){app.querySelector('[role=status]').textContent=error.message;}};
}

function confirmStudentDeletion(root, student, request, done) {
  const dialog = document.createElement('dialog');
  dialog.className = 'student-delete-dialog';
  dialog.setAttribute('aria-labelledby', 'student-delete-title');
  dialog.innerHTML = `<form>
    <h3 id="student-delete-title">永久刪除學生帳號</h3>
    <p class="student-delete-name"></p>
    <p>帳號、與帳號關聯的作答、口說錄音、錄音評語和單字收藏將永久刪除，無法復原。</p>
    <label>請輸入上方的學生帳號以確認
      <input name="confirmUsername" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" required>
    </label>
    <p role="status"></p>
    <div class="actions"><button type="button" class="secondary" autofocus>取消</button><button type="submit" class="danger" disabled>確認永久刪除</button></div>
  </form>`;
  dialog.querySelector('.student-delete-name').textContent = `${student.display_name}｜${student.username}`;
  const form = dialog.querySelector('form'), input = form.elements.confirmUsername;
  const cancel = form.querySelector('.secondary'), submit = form.querySelector('[type="submit"]');
  const status = form.querySelector('[role="status"]');
  let deleting = false;
  input.oninput = () => { submit.disabled = input.value !== student.username; status.textContent = ''; };
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (deleting) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  form.onsubmit = async event => {
    event.preventDefault();
    if (deleting || input.value !== student.username) return;
    deleting = true;
    cancel.disabled = submit.disabled = input.disabled = true;
    status.textContent = '正在刪除帳號及錄音…';
    try {
      const result = await request(`/api/teacher/students/${encodeURIComponent(student.id)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmUsername: input.value }),
      });
      dialog.close();
      done(result.audioPending);
    } catch (error) {
      deleting = false;
      cancel.disabled = submit.disabled = input.disabled = false;
      status.textContent = error.message;
    }
  };
  root.append(dialog);
  dialog.showModal();
}

export async function manageStudents(app,request,esc,back) {
  app.innerHTML='<section class="panel wide"><button id="back" class="secondary">返回教師工作台</button><h2>學生帳號管理</h2><form id="newStudent"><div class="row"><label>帳號<input name="username" maxlength="80" required autocomplete="off"></label><label>姓名<input name="displayName" maxlength="100" required></label><label>學號（選填）<input name="studentNumber" maxlength="80"></label></div><label>初始密碼<input name="password" type="password" minlength="8" maxlength="128" required autocomplete="new-password"></label><p role="status"></p><button>建立學生帳號</button></form><div id="students"></div></section>';
  app.querySelector('#back').onclick=back;
  app.querySelector('form').onsubmit=async e=>{e.preventDefault();try{await request('/api/teacher/students',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});await manageStudents(app,request,esc,back);}catch(error){app.querySelector('[role=status]').textContent=error.message;}};
  try {
    const data=await request('/api/teacher/students');
    const list = app.querySelector('#students');
    const result = document.createElement('p');
    result.setAttribute('role', 'status');
    list.before(result);
    list.innerHTML=data.students.map(s=>`<details class="item"><summary>${esc(s.display_name)}｜${esc(s.username)} — ${s.disabled_at?'已停用':s.must_change_password?'待首次修改密碼':'使用中'}</summary><form class="resetStudent" data-id="${esc(s.id)}"><label>重設臨時密碼<input name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label><button>重設密碼</button></form><div class="actions"><button type="button" class="secondary toggleStudent" data-id="${esc(s.id)}" data-disabled="${!s.disabled_at}">${s.disabled_at?'啟用':'停用'}帳號</button>${s.can_delete ? `<button type="button" class="danger deleteStudent" data-id="${esc(s.id)}">刪除帳號與口說錄音</button>` : '<small>帳號若涉及其他教師，請由最高管理員刪除。</small>'}</div></details>`).join('') || '<p>尚未建立學生帳號。</p>';
    const students = new Map(data.students.map(student => [student.id, student]));
    list.querySelectorAll('.deleteStudent').forEach(button => button.onclick = () => {
      const student = students.get(button.dataset.id);
      confirmStudentDeletion(app, student, request, audioPending => {
        button.closest('details').remove();
        if (!list.childElementCount) list.innerHTML = '<p>尚未建立學生帳號。</p>';
        result.textContent = audioPending ? '帳號已刪除。剩餘音檔將由系統重試清除。' : '帳號及相關口說錄音已永久刪除。';
        (list.querySelector('summary') || app.querySelector('#back'))?.focus();
      });
    });
    const update=async(id,body)=>{await request(`/api/teacher/students/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await manageStudents(app,request,esc,back);};
    app.querySelectorAll('.resetStudent').forEach(form=>form.onsubmit=async e=>{e.preventDefault();if(!confirm('重設後會登出此學生，並要求下次登入修改密碼。'))return;try{await update(form.dataset.id,Object.fromEntries(new FormData(form)));}catch(error){alert(error.message);}});
    app.querySelectorAll('.toggleStudent').forEach(btn=>btn.onclick=async()=>{try{await update(btn.dataset.id,{disabled:btn.dataset.disabled==='true'});}catch(error){alert(error.message);}});
  } catch(error){app.querySelector('#students').textContent=error.message;}
}
