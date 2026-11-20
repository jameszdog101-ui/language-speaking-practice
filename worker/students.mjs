const managedStudent = `(?='super_admin' OR EXISTS (
  SELECT 1 FROM teacher_students ts WHERE ts.student_id=s.id AND ts.teacher_id=?
))`;
const studentDeletionAllowed = `(?='super_admin' OR (
  EXISTS (SELECT 1 FROM teacher_students ts WHERE ts.student_id=s.id AND ts.teacher_id=?)
  AND NOT EXISTS (SELECT 1 FROM teacher_students ts WHERE ts.student_id=s.id AND ts.teacher_id<>?)
  AND NOT EXISTS (SELECT 1 FROM sessions se JOIN assignments a ON a.id=se.assignment_id
    WHERE se.student_account_id=s.id AND a.teacher_id IS NOT ?)
  AND NOT EXISTS (SELECT 1 FROM assignment_recipients r JOIN assignments a ON a.id=r.assignment_id
    WHERE r.student_id=s.id AND a.teacher_id IS NOT ?)
))`;
const deletionBindings = t => [t.role, t.id, t.id, t.id, t.id];
const maxAvatarBytes = 128 * 1024;

export async function purgeStudentAudio(env, studentId = null) {
  const where = studentId ? 'WHERE student_id=?' : '';
  const bindings = studentId ? [studentId] : [];
  for (let batch = 0; batch < 20; batch++) {
    const { results } = await env.DB.prepare(`SELECT r2_key FROM student_audio_deletions ${where} ORDER BY r2_key LIMIT 100`)
      .bind(...bindings).all();
    if (!results.length) return true;
    const keys = results.map(row => row.r2_key);
    await env.AUDIO.delete(keys);
    await env.DB.prepare('DELETE FROM student_audio_deletions WHERE r2_key IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(keys)).run();
  }
  return false;
}

export function studentServices(h) {
  const { response, fail, id, token, hash, passwordHash, cookie, teacher, bodyJson } = h;
  const authCookie = (value, secure, age=604800) => `student_session=${encodeURIComponent(value)}; Path=/; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=${age}`;
  const publicStudent = s => ({ id:s.id, username:s.username, displayName:s.display_name, studentNumber:s.student_number,
    mustChangePassword:!!s.must_change_password, avatarUrl:s.has_avatar ? '/api/student/avatar' : null });
  async function student(req, env, allowInitial=false) {
    const raw = cookie(req, 'student_session'); if (!raw) return null;
    const s = await env.DB.prepare(`SELECT s.*,EXISTS(SELECT 1 FROM student_avatars sa WHERE sa.student_id=s.id) has_avatar
      FROM student_logins l JOIN students s ON s.id=l.student_id WHERE l.token_hash=? AND l.expires_at>? AND s.disabled_at IS NULL`)
      .bind(await hash(raw), new Date().toISOString()).first();
    return s && (allowInitial || !s.must_change_password) ? s : null;
  }
  async function avatar(req, env, studentId) {
    if (req.method === 'GET') {
      const row = await env.DB.prepare('SELECT image FROM student_avatars WHERE student_id=?').bind(studentId).first();
      return row ? new Response(new Uint8Array(row.image), { headers: {
        'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
      } }) : fail('尚未設定頭像', 404);
    }
    if (req.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM student_avatars WHERE student_id=?').bind(studentId).run();
      return response({ avatarUrl: null });
    }
    if (req.method !== 'PUT') return fail('不支援此操作', 405);
    if (req.headers.get('Content-Type') !== 'image/jpeg' || !req.body) return fail('請上傳 JPEG 頭像', 415);
    if (Number(req.headers.get('Content-Length')) > maxAvatarBytes) return fail('頭像大小不能超過 128 KB', 413);
    const reader = req.body.getReader(), image = new Uint8Array(maxAvatarBytes);
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > image.length) {
        await reader.cancel();
        return fail('頭像大小不能超過 128 KB', 413);
      }
      image.set(value, size);
      size += value.length;
    }
    if (size < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff || image[size - 2] !== 0xff || image[size - 1] !== 0xd9)
      return fail('無法辨識頭像，請重新選擇圖片');
    const saved = await env.DB.prepare(`INSERT INTO student_avatars(student_id,image)
      SELECT id,? FROM students WHERE id=?
      ON CONFLICT(student_id) DO UPDATE SET image=excluded.image`).bind(image.slice(0, size).buffer, studentId).run();
    return saved.meta.changes ? response({ avatarUrl: new URL(req.url).pathname }) : fail('找不到學生帳號', 404);
  }
  async function routes(req, env, url) {
    const path = url.pathname;
    if (path === '/api/student/login' && req.method === 'POST') {
      const b = await bodyJson(req), username = String(b.username || '').trim();
      const key = await hash(`${req.headers.get('cf-connecting-ip') || 'local'}:${username.toLowerCase()}`);
      const limit = await env.DB.prepare('SELECT * FROM student_login_limits WHERE key=?').bind(key).first();
      if (limit && limit.reset_at > Date.now() && limit.failures >= 8) return fail('登入嘗試過多，請 15 分鐘後重試',429);
      const s = await env.DB.prepare(`SELECT s.*,EXISTS(SELECT 1 FROM student_avatars sa WHERE sa.student_id=s.id) has_avatar
        FROM students s WHERE username=?`).bind(username).first();
      if (!s || s.disabled_at || await passwordHash(String(b.password || '').slice(0,256), s.password_salt) !== s.password_hash) {
        await env.DB.prepare('INSERT INTO student_login_limits(key,failures,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN reset_at<=? THEN 1 ELSE failures+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END').bind(key,Date.now()+900000,Date.now(),Date.now()).run();
        return fail('帳號或密碼錯誤，或帳號已停用',401);
      }
      await env.DB.prepare('DELETE FROM student_login_limits WHERE key=?').bind(key).run();
      const value = token();
      await env.DB.prepare('INSERT INTO student_logins(token_hash,student_id,expires_at) VALUES(?,?,?)').bind(await hash(value),s.id,new Date(Date.now()+604800000).toISOString()).run();
      return response({student:publicStudent(s)},200,{'set-cookie':authCookie(value,url.protocol==='https:')});
    }
    if(path === '/api/student/logout' && req.method === 'POST') {
      const raw = cookie(req,'student_session');
      if(raw) await env.DB.prepare('DELETE FROM student_logins WHERE token_hash=?').bind(await hash(raw)).run();
      return response({ok:true},200,{'set-cookie':authCookie('',url.protocol==='https:',0)});
    }
    if(path === '/api/student/me' && req.method === 'GET') {
      const s = await student(req,env,true); return s ? response({student:publicStudent(s)}) : fail('請先登入學生帳號',401);
    }
    if (path === '/api/student/avatar') {
      const s = await student(req, env);
      return s ? avatar(req, env, s.id) : fail('請先登入學生帳號', 401);
    }
    if(path === '/api/student/password' && req.method === 'POST') {
      const s = await student(req,env,true); if(!s) return fail('請先登入',401);
      const b=await bodyJson(req), password=String(b.password || '');
      if(password.length<8 || password.length>128) return fail('密碼需為 8–128 個字元');
      if(await passwordHash(String(b.currentPassword || ''),s.password_salt)!==s.password_hash) return fail('目前密碼錯誤',403);
      if(password === b.currentPassword) return fail('新密碼不可與目前密碼相同');
      const salt=token(16),value=token();
      await env.DB.batch([
        env.DB.prepare('UPDATE students SET password_hash=?,password_salt=?,must_change_password=0 WHERE id=?').bind(await passwordHash(password,salt),salt,s.id),
        env.DB.prepare('DELETE FROM student_logins WHERE student_id=?').bind(s.id),
        env.DB.prepare('INSERT INTO student_logins(token_hash,student_id,expires_at) VALUES(?,?,?)').bind(await hash(value),s.id,new Date(Date.now()+604800000).toISOString())
      ]);
      return response({ok:true},200,{'set-cookie':authCookie(value,url.protocol==='https:')});
    }
    const stageAvatar = /^\/api\/teacher\/session-avatar\/([^/]+)$/.exec(path);
    if(!path.startsWith('/api/teacher/students') && !stageAvatar) return null;
    const t=await teacher(req,env); if(!t) return fail('請先登入教師帳號',401);
    if (stageAvatar && req.method === 'GET') {
      const row = await env.DB.prepare(`SELECT s.student_account_id FROM sessions s JOIN assignments a ON a.id=s.assignment_id
        WHERE s.id=? AND s.student_account_id IS NOT NULL AND s.anonymous_id IS NULL AND a.anonymous=0 AND a.identity_mode<>'anonymous'
          AND s.deleted_at IS NULL AND a.deleted_at IS NULL AND (a.teacher_id=? OR ?='super_admin')`)
        .bind(stageAvatar[1], t.id, t.role).first();
      return row ? avatar(req, env, row.student_account_id) : fail('找不到頭像', 404);
    }
    const managedAvatar = /^\/api\/teacher\/students\/([^/]+)\/avatar$/.exec(path);
    if (managedAvatar) {
      const s = await env.DB.prepare(`SELECT s.id FROM students s WHERE s.id=? AND ${managedStudent}`)
        .bind(managedAvatar[1], t.role, t.id).first();
      return s ? avatar(req, env, s.id) : fail('找不到學生帳號', 404);
    }
    if(path === '/api/teacher/students' && req.method === 'GET') {
      const rows = await env.DB.prepare(`SELECT s.id,s.username,s.display_name,s.student_number,s.disabled_at,s.must_change_password,
        ${studentDeletionAllowed} can_delete, EXISTS(SELECT 1 FROM student_avatars sa WHERE sa.student_id=s.id) has_avatar
        FROM students s WHERE ${managedStudent} ORDER BY s.created_at DESC`)
        .bind(...deletionBindings(t), t.role, t.id).all();
      return response({students:rows.results});
    }
    if(path === '/api/teacher/students' && req.method === 'POST') {
      const b=await bodyJson(req), username=String(b.username || '').trim(), name=String(b.displayName || '').trim(), password=String(b.password || '');
      if(!username || username.length>80 || /[\x00-\x1f]/.test(username) || !name || name.length>100 || password.length<8 || password.length>128) return fail('請填寫帳號、姓名及 8–128 字元的初始密碼');
      if(await env.DB.prepare('SELECT id FROM students WHERE username=?').bind(username).first()) return fail('帳號已存在，請使用其他帳號',409);
      const studentId=id('student'),salt=token(16);
      await env.DB.batch([
        env.DB.prepare('INSERT INTO students(id,username,display_name,student_number,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?)').bind(studentId,username,name,String(b.studentNumber || '').slice(0,80),await passwordHash(password,salt),salt,new Date().toISOString()),
        env.DB.prepare('INSERT INTO teacher_students(teacher_id,student_id) VALUES(?,?)').bind(t.id,studentId)
      ]);
      return response({id:studentId},201);
    }
    const match=/^\/api\/teacher\/students\/([^/]+)$/.exec(path);
    if (match && req.method === 'DELETE') {
      const studentId = match[1];
      const s = await env.DB.prepare(`SELECT s.username,${studentDeletionAllowed} can_delete FROM students s
        WHERE s.id=? AND ${managedStudent}`).bind(...deletionBindings(t), studentId, t.role, t.id).first();
      if (!s) return fail('找不到學生帳號', 404);
      if (!s.can_delete) return fail('此帳號有其他教師的指派或作答關聯，請由最高管理員刪除', 403);
      const body = await bodyJson(req);
      if (body?.confirmUsername !== s.username) return fail('請輸入完整且相符的學生帳號以確認刪除');
      const deleted = await env.DB.prepare(`DELETE FROM students AS s WHERE s.id=? AND s.username COLLATE BINARY=?
        AND ${studentDeletionAllowed}`).bind(studentId, body.confirmUsername, ...deletionBindings(t)).run();
      if (!deleted.meta.changes) return fail('帳號資料或存取權限已變更，請重新整理後再試', 409);
      let audioDeleted = false;
      try { audioDeleted = await purgeStudentAudio(env, studentId); }
      catch { /* The scheduled handler retries pending R2 deletions. */ }
      return response({ ok: true, audioPending: !audioDeleted });
    }
    if(match && req.method === 'PATCH') {
      const s=await env.DB.prepare(`SELECT s.id FROM students s WHERE s.id=? AND ${managedStudent}`).bind(match[1],t.role,t.id).first();
      if(!s) return fail('找不到學生帳號',404);
      const b=await bodyJson(req), statements=[];
      if(b.password !== undefined) {
        const password=String(b.password); if(password.length<8 || password.length>128) return fail('密碼需為 8–128 個字元');
        const salt=token(16);
        statements.push(env.DB.prepare('UPDATE students SET password_hash=?,password_salt=?,must_change_password=1 WHERE id=?').bind(await passwordHash(password,salt),salt,s.id));
      }
      if(typeof b.disabled === 'boolean') statements.push(env.DB.prepare('UPDATE students SET disabled_at=? WHERE id=?').bind(b.disabled ? new Date().toISOString() : null,s.id));
      if(!statements.length) return fail('未指定操作');
      statements.push(env.DB.prepare('DELETE FROM student_logins WHERE student_id=?').bind(s.id));
      await env.DB.batch(statements); return response({ok:true});
    }
    return fail('路徑不存在',404);
  }
  return { student, routes };
}
