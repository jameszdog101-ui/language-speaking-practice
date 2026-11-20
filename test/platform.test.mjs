import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { encodeWavMono } from '../public/audio-dsp.js';
import { purgeSubmissions } from '../worker/submissions.mjs';
import { purgeStudentAudio } from '../worker/students.mjs';

test('student accounts, ownership, feedback snapshots, ranges and submission trash', {timeout:120000}, async()=>{
  await mkdir('.wrangler/tests',{recursive:true});
  await build({entryPoints:['worker/entry.mjs'],outfile:'.wrangler/tests/worker.mjs',bundle:true,format:'esm',platform:'browser',external:['cloudflare:*'],logLevel:'silent'});
  const geminiKey = 'AQ.TEST_teacher_key_000001';
  let generationRequests = 0;
  let omitToken = false;
  let generationGate;
  const mf=new Miniflare(convertV4MiniflareOptions({
    modules:true,scriptPath:'.wrangler/tests/worker.mjs',compatibilityDate:'2026-10-13',d1Databases:['DB'],r2Buckets:['AUDIO'],
    bindings: { GEMINI_ENCRYPTION_KEY: 'a'.repeat(64) },
    workflows: { VOCABULARY_WORKFLOW: { name: 'test-vocabulary', className: 'VocabularyWorkflow' } },
    outboundService: async request => {
      const url = new URL(request.url);
      assert.equal(url.hostname, 'generativelanguage.googleapis.com');
      if (request.method === 'GET') {
        assert.equal(url.search, '');
        if (![geminiKey, 'TEST_legacy_teacher_key_000001'].includes(request.headers.get('x-goog-api-key'))) {
          return Response.json({ error: { message: 'private Google response', details: [{ reason: 'API_KEY_INVALID' }] } }, { status: 400 });
        }
        if (url.pathname !== '/v1beta/models/gemini-3.6-flash') return Response.json({}, { status: 404 });
        return Response.json({ supportedGenerationMethods: ['generateContent'] });
      }
      assert.equal(request.headers.get('x-goog-api-key'), geminiKey);
      const body = await request.json();
      const input = JSON.parse(body.contents[0].parts[0].text);
      if (input.parts) {
        assert.equal(input.language, 'en');
        assert.equal(input.parts.map(([, text]) => text).join(''), 'First sentence. “Second sentence.”');
        assert.equal(input.parts[2][1], '“Second ');
        assert.equal(body.generationConfig.responseJsonSchema.properties.starts.minItems, input.count - 1);
        const starts = input.count === 2 ? [2] : [2, 2];
        return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ starts }) }] } }] });
      }
      generationRequests++;
      if (generationGate) await generationGate;
      const english = input.language === 'en';
      if (english) {
        assert.equal(input.cefr, 'B1');
        assert.equal(input.questions.length, 2);
      }
      const questions = input.questions.map(question => {
        assert.equal(question.lastToken, question.tokens.length - 1);
        const tokens = question.tokens.map(([index, word], position) => {
          assert.equal(index, position);
          return word;
        });
        const incompleteTokens = [];
        const cards = tokens.flatMap((word, index) => {
          if (word === 'frag') { incompleteTokens.push(index); return []; }
          if ((omitToken && index === 0) || ['eggs', 'up'].includes(word)) return [];
          const base = { startToken: index, endToken: index, similar: [], baseForm: word, wordFamily: [], verbForms: [] };
          if (!english) return [{ ...base, pronunciation: 'wǒ', meaning: 'I', partOfSpeech: '代名詞',
            usage: '用來說自己。', usageZh: '', examples: [{ sentence: '我想喝水。', translation: '' }, { sentence: '我在家。', translation: '' }] }];
          const verb = word === 'showed' ? { baseForm: 'show up', partOfSpeech: '動詞片語',
            verbForms: ['Show up', 'showed up', 'shown up'] } :
            word === 'ran' ? { baseForm: 'run', partOfSpeech: '動詞', verbForms: ['run', 'ran', 'run'] } : {};
          const wordFamily = word === 'beautiful' ? [
            { word: 'beauty', partOfSpeech: '名詞', example: { sentence: 'I love the beauty of the sea.', translation: '我喜歡大海的美。' } },
            { word: 'beautifully', partOfSpeech: '副詞', example: { sentence: 'She sings beautifully.', translation: '她唱得很動聽。' } },
            { word: 'beautify', partOfSpeech: '動詞', example: { sentence: 'She sings beautifully.', translation: '她唱得很動聽。' } },
          ] : [];
          const examples = [
            { sentence: 'We bought two tea eggs.', translation: '我們買了兩顆茶葉蛋。' },
            { sentence: 'The tea eggs are warm.', translation: '茶葉蛋（點心）還是溫的。' },
            { sentence: 'She shared the tea eggs with her friends.', translation: word === 'beautiful' ? '' : '她把茶葉蛋分給朋友。' },
          ];
          return [{ ...base, endToken: ['tea', 'showed'].includes(word) ? index + 1 : index, pronunciation: '[ti ɛɡz]',
            partOfSpeech: ['Shh', 'hey', 'ai'].includes(word) ? '感嘆詞' : '名詞', ...verb, wordFamily,
            meaning: word === 'tea' ? '茶葉蛋' : '詞義', usage: 'A snack often sold at convenience stores.',
            usageZh: '常見於便利商店的點心。', examples }];
        });
        return { id: question.id, cards, incompleteTokens };
      });
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ questions }) }] } }] });
    },
  }));
  try {
    const db=await mf.getD1Database('DB');
    for(const file of (await readdir('migrations')).filter(x=>x.endsWith('.sql')).sort()) {
      const sql=await readFile(`migrations/${file}`,'utf8');
      const statements = sql.matchAll(/\s*(CREATE TRIGGER[\s\S]+?\bEND\s*;|[^;]+;)/gi);
      for (const [, statement] of statements) await db.prepare(statement).run();
      if(file==='0005_voice_deidentification.sql') {
        for(const [legacyId,code,anonymous] of [['legacy_named','OLDNAM',0],['legacy_anon','OLDANO',1]]) {
          await db.prepare('INSERT INTO assignments(id,code,title,admin_key_hash,anonymous,created_at) VALUES(?,?,?,?,?,?)').bind(legacyId,code,'更新前已發布作業','unused',anonymous,'2026-01-01T00:00:00.000Z').run();
          await db.prepare('INSERT INTO sentences(id,assignment_id,position,text,pinyin) VALUES(?,?,?,?,?)').bind(`${legacyId}_q`,legacyId,0,'Hello','').run();
        }
      }
    }
    const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
    for(const [id,value] of [['t1','teacher-one'],['t2','teacher-two']]) {
      await db.prepare('INSERT INTO teachers(id,email,display_name,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?)').bind(id,`${id}@example.test`,id,'unused','unused',new Date().toISOString()).run();
      await db.prepare('INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,created_at) VALUES(?,?,?,?)').bind(await sha(value),id,'2099-01-01T00:00:00.000Z',new Date().toISOString()).run();
    }
    const tc='teacher_session=teacher-one',other='teacher_session=teacher-two';
    const call=async(path,{method='GET',cookie,body,headers={}}={})=>{
      const res=await mf.dispatchFetch(`https://test.local${path}`,{method,headers:{...(cookie?{cookie}:{}),...(body && !(body instanceof ArrayBuffer)?{'content-type':'application/json'}:{}),...headers},body:body instanceof ArrayBuffer?body:body===undefined?undefined:JSON.stringify(body)});
      const data=res.headers.get('content-type')?.includes('application/json')?await res.json():null;
      return {res,data};
    };
    let r=await call('/api/sessions',{method:'POST',body:{guest:true,code:'OLDNAM',deviceTestPassed:true,name:'舊作業學生'}});
    assert.equal(r.res.status,400);
    r=await call('/api/sessions',{method:'POST',body:{guest:true,code:'OLDNAM',deviceTestPassed:true,name:'舊作業學生',studentId:'OLD001'}});
    assert.equal(r.res.status,201);assert.equal(r.data.assignment.identityMode,'full');
    const legacySession=await db.prepare('SELECT name,student_id,student_account_id FROM sessions WHERE id=?').bind(r.data.sessionId).first();
    assert.deepEqual(legacySession,{name:'舊作業學生',student_id:'OLD001',student_account_id:null});
    r=await call('/api/sessions',{method:'POST',body:{guest:true,code:'OLDANO',deviceTestPassed:true}});
    assert.equal(r.res.status,201);assert.equal(r.data.assignment.identityMode,'anonymous');assert.ok(r.data.anonymousId);
    await db.prepare("UPDATE assignments SET ends_at='2026-01-02T00:00:00.000Z' WHERE id='legacy_named'").run();
    r=await call('/api/sessions',{method:'POST',body:{guest:true,code:'OLDNAM',deviceTestPassed:true,name:'舊作業學生',studentId:'OLD001'}});
    assert.equal(r.res.status,403);
    r=await call('/api/teacher/students',{method:'POST',cookie:tc,body:{username:'student-一',displayName:'學生一',studentNumber:'001',password:'initial-1234'}});assert.equal(r.res.status,201);const studentId=r.data.id;
    r=await call('/api/teacher/students',{cookie:other});assert.equal(r.data.students.length,0);
    r=await call(`/api/teacher/students/${studentId}`,{method:'PATCH',cookie:other,body:{password:'hijack-1234'}});assert.equal(r.res.status,404);
    r=await call('/api/student/login',{method:'POST',body:{username:'student-一',password:'initial-1234'}});assert.equal(r.res.status,200);let sc=r.res.headers.get('set-cookie').split(';')[0];assert.equal(r.data.student.mustChangePassword,true);
    assert.equal((await call('/api/student/submissions',{cookie:sc})).res.status,401);
    r=await call('/api/student/password',{method:'POST',cookie:sc,body:{currentPassword:'initial-1234',password:'changed-1234'}});assert.equal(r.res.status,200);sc=r.res.headers.get('set-cookie').split(';')[0];
    await db.prepare("INSERT INTO students(id,username,display_name,password_hash,password_salt,must_change_password,created_at) SELECT 'second','second','第二位學生',password_hash,password_salt,0,created_at FROM students WHERE id=?").bind(studentId).run();
    r=await call('/api/student/login',{method:'POST',body:{username:'second',password:'changed-1234'}});assert.equal(r.res.status,200);const secondCookie=r.res.headers.get('set-cookie').split(';')[0];
    const ownAvatar = '/api/student/avatar';
    const teacherAvatar = `/api/teacher/students/${studentId}/avatar`;
    const imageHeaders = { 'content-type': 'image/jpeg' };
    // Compact fixture for comparing the JPEG bytes returned from the private endpoints.
    const avatarBytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9);
    const uploadAvatar = (path, cookie, body = avatarBytes.buffer) => call(path, { method: 'PUT', cookie, headers: imageHeaders, body });
    assert.equal((await uploadAvatar(ownAvatar, undefined)).res.status, 401);
    assert.equal((await uploadAvatar(ownAvatar, sc, new ArrayBuffer(200))).res.status, 400);
    assert.equal((await uploadAvatar(teacherAvatar, other)).res.status, 404);
    assert.equal((await uploadAvatar(ownAvatar, sc)).data.avatarUrl, ownAvatar);
    assert.equal((await call('/api/student/me', { cookie: sc })).data.student.avatarUrl, ownAvatar);
    assert.equal((await call(ownAvatar, { cookie: secondCookie })).res.status, 404);
    assert.equal((await call(teacherAvatar, { cookie: tc, method: 'DELETE' })).data.avatarUrl, null);
    assert.equal((await call(ownAvatar, { cookie: sc })).res.status, 404);
    assert.equal((await uploadAvatar(teacherAvatar, tc)).data.avatarUrl, teacherAvatar);
    await db.prepare('INSERT INTO assignments(id,code,title,admin_key_hash,teacher_id,identity_mode,created_at) VALUES(?,?,?,?,?,?,?)').bind('assignment','ABCDEF','Test','unused','t1','name_only',new Date().toISOString()).run();
    for(const [id,position]of[['q1',0],['q2',1]])await db.prepare('INSERT INTO sentences(id,assignment_id,position,text,pinyin,max_attempts) VALUES(?,?,?,?,?,?)').bind(id,'assignment',position,'Hello world','',2).run();
    r=await call('/api/sessions',{method:'POST',body:{code:'ABCDEF',deviceTestPassed:true}});assert.equal(r.res.status,400);
    r=await call('/api/sessions',{method:'POST',body:{code:'ABCDEF',deviceTestPassed:true,name:'訪客姓名'}});assert.equal(r.res.status,201);
    const guestId=r.data.sessionId,guestToken=r.data.sessionToken;
    let guest=await db.prepare('SELECT name,student_id,student_account_id FROM sessions WHERE id=?').bind(guestId).first();
    assert.equal(guest.name,'訪客姓名');assert.equal(guest.student_id,null);assert.equal(guest.student_account_id,null);
    const guestWav=encodeWavMono(new Float32Array(32000),32000);
    r=await call(`/api/sessions/${guestId}/sentences/q1/attempts`,{method:'POST',headers:{'x-session-token':guestToken,'content-type':'audio/wav'},body:guestWav});assert.equal(r.res.status,201);
    assert.equal((await call(`/api/sessions/${guestId}/sentences/q1/accept`,{method:'POST'})).res.status,404);
    await db.prepare("UPDATE assignments SET identity_mode='full' WHERE id='assignment'").run();
    r=await call('/api/sessions',{method:'POST',body:{code:'ABCDEF',deviceTestPassed:true,name:'訪客姓名'}});assert.equal(r.res.status,400);
    r=await call('/api/sessions',{method:'POST',cookie:sc,body:{guest:true,code:'ABCDEF',deviceTestPassed:true,name:'另一訪客',studentId:'G001'}});assert.equal(r.res.status,201);
    guest=await db.prepare('SELECT name,student_id,student_account_id FROM sessions WHERE id=?').bind(r.data.sessionId).first();
    assert.equal(guest.name,'另一訪客');assert.equal(guest.student_id,'G001');assert.equal(guest.student_account_id,null);
    await db.prepare("UPDATE assignments SET identity_mode='anonymous' WHERE id='assignment'").run();
    r=await call('/api/sessions',{method:'POST',cookie:sc,body:{code:'ABCDEF',deviceTestPassed:true}});assert.equal(r.res.status,201);
    const anonymousSession = r.data.sessionId;
    assert.equal((await call(`/api/teacher/session-avatar/${anonymousSession}`, { cookie: tc })).res.status, 404);
    assert.equal((await call('/api/teacher/assignments/assignment', { cookie: tc })).data.sessions.find(row => row.id === anonymousSession).avatarUrl, null);
    guest=await db.prepare('SELECT name,student_id,student_account_id,anonymous_id FROM sessions WHERE id=?').bind(r.data.sessionId).first();
    assert.equal(guest.name,null);assert.equal(guest.student_id,null);assert.equal(guest.student_account_id,null);assert.ok(guest.anonymous_id);
    await db.prepare("UPDATE assignments SET identity_mode='name_only' WHERE id='assignment'").run();
    r=await call('/api/sessions',{method:'POST',cookie:sc,body:{code:'ABCDEF',deviceTestPassed:true}});assert.equal(r.res.status,201);const sid=r.data.sessionId,st=r.data.sessionToken;
    const stageAvatar = `/api/teacher/session-avatar/${sid}`;
    assert.equal((await call('/api/teacher/assignments/assignment', { cookie: tc })).data.sessions.find(row => row.id === sid).avatarUrl, stageAvatar);
    assert.equal((await call(stageAvatar)).res.status, 401);
    assert.equal((await call(stageAvatar, { cookie: other })).res.status, 404);
    const image = (await call(stageAvatar, { cookie: tc })).res;
    assert.equal(image.headers.get('content-type'), 'image/jpeg');
    assert.equal(image.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), avatarBytes);
    const wav=encodeWavMono(new Float32Array(32000),32000);
    r=await call(`/api/sessions/${sid}/sentences/q1/attempts`,{method:'POST',cookie:sc,headers:{'x-session-token':st,'content-type':'audio/wav'},body:encodeWavMono(new Float32Array(32000*181),32000)});assert.equal(r.res.status,400);
    assert.equal((await call(`/api/sessions/${sid}/sentences/q1/attempts`,{method:'POST',cookie:secondCookie,headers:{'x-session-token':st,'content-type':'audio/wav'},body:wav})).res.status,404);
    for(const q of ['q1','q2']) {
      r=await call(`/api/sessions/${sid}/sentences/${q}/attempts`,{method:'POST',cookie:sc,headers:{'x-session-token':st,'content-type':'audio/wav'},body:wav});assert.equal(r.res.status,201,JSON.stringify(r.data));
      r=await call(`/api/sessions/${sid}/sentences/${q}/accept`,{method:'POST',cookie:sc,headers:{'x-session-token':st}});assert.equal(r.res.status,200);
    }
    assert.equal((await call(`/api/sessions/${sid}/complete`,{method:'POST',cookie:sc,headers:{'x-session-token':st}})).res.status,200);
    r=await call('/api/student/submissions',{cookie:sc});assert.equal(r.data.submissions.length,1);
    r=await call(`/api/student/submissions/${sid}`,{cookie:sc});const audioUrl=r.data.answers[0].audioUrl;
    r=await call(audioUrl,{cookie:sc,headers:{range:'bytes=0-43'}});assert.equal(r.res.status,206);assert.equal((await r.res.arrayBuffer()).byteLength,44);
    assert.equal((await call(audioUrl)).res.status,401);
    assert.equal((await call(audioUrl,{cookie:secondCookie})).res.status,404);
    assert.equal((await call(`/api/student/submissions/${sid}`,{cookie:secondCookie})).res.status,404);
    r=await call(`/api/teacher/feedback/${sid}/audio`,{method:'POST',cookie:tc,body:wav,headers:{'content-type':'audio/wav'}});assert.equal(r.res.status,201);const feedbackAudio=r.data.audioId;
    assert.equal((await call(`/api/student/feedback-audio/${feedbackAudio}`,{cookie:sc})).res.status,404);
    const payload={overall:{text:'總評',score:4},questions:{q1:{text:'單題評語',score:3},q2:{score:5}},scoreMode:'average'};
    payload.overall.audioId=feedbackAudio;
    r=await call(`/api/teacher/feedback/${sid}`,{method:'PUT',cookie:tc,body:{version:0,data:payload}});assert.equal(r.res.status,200,JSON.stringify(r.data));
    r=await call(`/api/student/feedback/${sid}`,{cookie:sc});assert.equal(r.data.feedback,null);
    assert.equal((await call(`/api/teacher/feedback/${sid}`,{cookie:other})).res.status,404);
    r=await call(`/api/teacher/feedback/${sid}/publish`,{method:'POST',cookie:tc,body:{version:1}});assert.equal(r.res.status,200);
    assert.equal((await call(`/api/student/feedback-audio/${feedbackAudio}`,{cookie:sc})).res.status,200);
    assert.equal((await call(`/api/student/feedback-audio/${feedbackAudio}`,{cookie:secondCookie})).res.status,404);
    payload.overall.text='未發布草稿';r=await call(`/api/teacher/feedback/${sid}`,{method:'PUT',cookie:tc,body:{version:2,data:payload}});assert.equal(r.res.status,200);
    r=await call(`/api/student/feedback/${sid}`,{cookie:sc});assert.equal(r.data.feedback.overall.text,'總評');
    r=await call(`/api/teacher/submissions/${sid}/trash`,{method:'POST',cookie:tc});assert.equal(r.res.status,200);
    assert.equal((await call('/api/student/submissions',{cookie:sc})).data.submissions.length,0);
    assert.equal((await call(audioUrl,{cookie:sc})).res.status,404);
    assert.equal((await call(`/api/student/feedback/${sid}`,{cookie:sc})).res.status,404);
    assert.equal((await call(`/api/student/feedback-audio/${feedbackAudio}`,{cookie:sc})).res.status,404);
    r=await call(`/api/teacher/submissions/${sid}/restore`,{method:'POST',cookie:tc});assert.equal(r.res.status,200);
    assert.equal((await call('/api/student/submissions',{cookie:sc})).data.submissions.length,1);
    await db.prepare("UPDATE assignments SET identity_mode='anonymous' WHERE id='assignment'").run();
    r=await call('/api/sessions',{method:'POST',cookie:sc,body:{code:'ABCDEF',deviceTestPassed:true}});assert.equal(r.res.status,201);
    assert.equal((await db.prepare('SELECT student_account_id FROM sessions WHERE id=?').bind(r.data.sessionId).first()).student_account_id,null);
    await call(`/api/teacher/submissions/${sid}/trash`,{method:'POST',cookie:tc});
    await db.prepare("UPDATE sessions SET purge_after='2000-01-01' WHERE id=?").bind(sid).run();
    assert.equal((await call(`/api/teacher/submissions/${sid}/restore`,{method:'POST',cookie:tc})).res.status,409);
    const feedbackObject=await db.prepare('SELECT r2_key FROM feedback_audio WHERE id=?').bind(feedbackAudio).first();
    const bucket=await mf.getR2Bucket('AUDIO');
    await purgeSubmissions({DB:db,AUDIO:bucket});
    assert.equal(await db.prepare('SELECT id FROM sessions WHERE id=?').bind(sid).first(),null);
    assert.equal(await bucket.get(feedbackObject.r2_key),null);

    const post = (path, cookie, body, method = 'POST') => call(path, { method, cookie, body });
    const draftInput = { title: '版本測試', language: 'en', identityMode: 'name_only', maxAttempts: 3,
      recordingSeconds: 4, cefr: 'B1', recipientIds: [studentId],
      generateOnPublish: true, creationKey: crypto.randomUUID(),
      sentences: [{ text: 'Stanley bought three tea eggs at FamilyMart. He showed up and ran. Shh, hey, ai, beautiful, frag—' }, { text: 'He was hungry.', recordingSeconds: 1 }] };
    r = await post('/api/assignments', tc, draftInput);
    assert.equal(r.res.status, 201, JSON.stringify(r.data));
    const draft = r.data;
    const path = `/api/teacher/assignments/${draft.id}`;
    assert.equal(draft.publicationState, 'draft');
    assert.equal((await post('/api/assignments', tc, draftInput)).data.id, draft.id);
    assert.equal((await call('/api/teacher/assignments?status=draft', { cookie: tc })).data.assignments[0].id, draft.id);
    assert.equal((await call('/api/assignments/code/' + draft.code)).res.status, 404);
    assert.equal((await call('/api/student/assigned', { cookie: sc })).data.assignments.length, 0);
    assert.equal((await post('/api/learning/context', sc, { code: draft.code, questionId: draft.sentences[0].id })).res.status, 404);
    const waitVocabulary = async assignmentPath => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const status = await call(assignmentPath + '/vocabulary', { cookie: tc });
        assert.equal(status.res.status, 200);
        if (!status.data.generating) return status.data;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail('Vocabulary workflow did not finish');
    };
    assert.equal((await post(path + '/publish', tc)).res.status, 202);
    assert.match((await waitVocabulary(path)).error, /Gemini API Key/);
    assert.equal(generationRequests, 0);
    assert.ok((await call(path, { cookie: tc })).data.assignment.vocabularyError);
    assert.equal((await call('/api/assignments/code/' + draft.code)).res.status, 404);
    const geminiSettings = '/api/teacher/gemini';
    const checkGemini = geminiSettings + '/check';
    assert.deepEqual((await call(geminiSettings, { cookie: tc })).data, {
      configured: false, model: 'gemini-3.6-flash', effort: 'default',
    });
    assert.equal((await post(checkGemini, undefined, { apiKey: geminiKey })).res.status, 401);
    assert.equal((await post(checkGemini, tc, { apiKey: 'TEST_legacy_teacher_key_000001' })).data.ok, true);
    assert.equal((await post(checkGemini, tc, { apiKey: 'AQ.TEST teacher key 000001' })).res.status, 400);
    assert.deepEqual((await post(checkGemini, tc, { apiKey: geminiKey })).data, { ok: true, model: 'gemini-3.6-flash' });
    assert.equal((await call(geminiSettings, { cookie: tc })).data.configured, false);
    const invalid = await post(checkGemini, tc, { apiKey: 'AQ.TEST_invalid_key_000001' });
    assert.equal(invalid.res.status, 422);
    assert.match(JSON.stringify(invalid.data), /Google 無法驗證/);
    assert.doesNotMatch(JSON.stringify(invalid.data), /private Google response|TEST_invalid_key/);
    const unavailable = await post(checkGemini, tc, { apiKey: geminiKey, model: 'gemini-unknown-model' });
    assert.equal(unavailable.res.status, 422);
    assert.match(JSON.stringify(unavailable.data), /無法使用指定模型/);
    assert.deepEqual((await post(geminiSettings, tc, { apiKey: geminiKey }, 'PUT')).data, {
      configured: true, model: 'gemini-3.6-flash', effort: 'default',
    });
    const normalized = await post(geminiSettings, tc, { model: ' models/GEMINI-3.6-FLASH ', effort: ' LOW ' }, 'PUT');
    assert.deepEqual(normalized.data, { configured: true, model: 'gemini-3.6-flash', effort: 'low' });
    assert.equal((await post(checkGemini, tc, {})).data.ok, true);
    assert.equal((await post(checkGemini, other, {})).res.status, 400);
    const splitPath = '/api/teacher/assignments/split';
    const passage = { text: 'First sentence. “Second sentence.”', count: 2, language: 'en', requirements: '保留完整句子' };
    assert.equal((await post(splitPath, undefined, passage)).res.status, 401);
    assert.equal((await call(splitPath, { cookie: tc, method: 'POST', body: passage, headers: { origin: 'https://other.example' } })).res.status, 403);
    assert.match((await post(splitPath, other, passage)).data.error, /Gemini API Key/);
    assert.deepEqual((await post(splitPath, tc, passage)).data, { questions: ['First sentence.', '“Second sentence.”'] });
    assert.match((await post(splitPath, tc, { ...passage, count: 3 })).data.error, /分題位置無效/);
    assert.match((await post(splitPath, tc, { ...passage, count: 5 })).data.error, /字詞少於指定題數/);
    assert.equal((await call('/api/teacher/gemini', { cookie: other })).data.configured, false);
    const sealed = (await db.prepare('SELECT key_ciphertext FROM teacher_gemini WHERE teacher_id=?').bind('t1').first()).key_ciphertext;
    assert.equal(sealed.includes(geminiKey), false);
    assert.equal((await post(path + '/publish', other)).res.status, 404);
    let allowGeneration;
    generationGate = new Promise(resolve => { allowGeneration = resolve; });
    try {
      const publishes = await Promise.all([post(path + '/publish', tc), post(path + '/publish', tc)]);
      assert.ok(publishes.every(reply => reply.res.status === 202 && reply.data.generating));
      assert.equal((await call(path + '/vocabulary', { cookie: tc })).data.generating, true);
      assert.equal((await call(path + '/vocabulary', { cookie: other })).res.status, 404);
    } finally {
      allowGeneration();
      generationGate = null;
    }
    assert.equal((await waitVocabulary(path)).published, true);
    assert.equal((await post(path + '/publish', tc)).data.published, true);
    assert.equal(generationRequests, 1);
    const assignment = (await call(path, { cookie: tc })).data.assignment;
    const [first, second] = assignment.sentences;
    assert.equal((await call('/api/teacher/student-assignments', { cookie: tc })).data.students[0].assignments[0].completedAt, null);
    assert.equal((await call('/api/teacher/student-assignments', { cookie: other })).data.students.length, 0);
    assert.equal((await call('/api/student/assigned', { cookie: sc })).data.assignments[0].id, assignment.id);
    const context = { questionId: first.id, code: assignment.code };
    const upload = await call('/api/teacher/question-audio/' + first.id, { method: 'PUT', cookie: tc, body: wav, headers: { 'content-type': 'audio/wav' } });
    assert.equal(upload.res.status, 200);
    const { cards: allCards, audioUrl: questionAudio } = (await post('/api/learning/context', sc, context)).data;
    assert.deepEqual(allCards.map(card => card.word), ['Stanley', 'bought', 'three', 'tea eggs', 'at', 'FamilyMart',
      'He', 'showed up', 'and', 'ran', 'Shh', 'hey', 'ai', 'beautiful']);
    assert.equal(allCards.find(card => card.word === 'Shh').partOfSpeech, '感嘆詞');
    const phrasalVerb = allCards.find(card => card.word === 'showed up');
    assert.equal(phrasalVerb.baseForm, 'show up');
    assert.equal(phrasalVerb.partOfSpeech, '片語動詞');
    assert.deepEqual(phrasalVerb.verbForms, ['show up', 'showed up', 'shown up']);
    assert.deepEqual(allCards.find(card => card.word === 'ran').verbForms, ['run', 'ran', 'run']);
    const family = allCards.find(card => card.word === 'beautiful').wordFamily;
    assert.deepEqual(family.map(({ word, partOfSpeech }) => [word, partOfSpeech]), [['beauty', '名詞'], ['beautifully', '副詞']]);
    assert.equal(family[1].example, 'She sings beautifully.（她唱得很動聽。）');
    const beautiful = allCards.find(card => card.word === 'beautiful');
    assert.deepEqual(beautiful.reviewFields, ['雙語例句', '詞族']);
    assert.equal(beautiful.examples.length, 2);
    assert.match(beautiful.examples[1], /茶葉蛋（點心）/);
    const cards = allCards.filter(card => card.word === 'tea eggs');
    assert.equal(cards[0].meaning, '茶葉蛋');
    assert.equal(cards[0].word, 'tea eggs');
    assert.equal(cards[0].examples.length, 3);
    assert.match(cards[0].usage, /snack/);
    assert.match(cards[0].usageZh, /便利商店/);
    assert.match(cards[0].examples[0], /（我們買了兩顆茶葉蛋。）$/);
    assert.equal((await call(questionAudio, { headers: { range: 'bytes=100-199' } })).res.status, 206);
    assert.equal((await post('/api/student/vocabulary', sc, { ...context, cardId: cards[0].id })).res.status, 200);
    assert.equal((await call('/api/student/vocabulary', { cookie: secondCookie })).data.cards.length, 0);
    assert.equal((await call('/api/student/vocabulary', { cookie: sc })).data.cards[0].pronunciation, '[ti ɛɡz]');
    assert.equal(generationRequests, 1);
    assert.equal((await post('/api/sessions', sc, { code: assignment.code, deviceTestPassed: true })).res.status, 201);
    const old = (await post('/api/sessions', sc, { code: assignment.code, deviceTestPassed: true })).data;
    assert.equal((await post(path, tc, { revision: assignment.revision, identityMode: 'anonymous' }, 'PATCH')).res.status, 409);
    assert.equal((await post(path, tc, { revision: assignment.revision, sentences: [{ ...second }] }, 'PATCH')).res.status, 400);
    const edit = { revision: assignment.revision, cardId: cards[0].id, pronunciation: cards[0].pronunciation,
      baseForm: 'tea egg', partOfSpeech: '名詞', meaning: '茶葉滷蛋', usage: cards[0].usage, usageZh: cards[0].usageZh,
      examples: cards[0].examples, similar: [] };
    const editPath = '/api/teacher/question-vocabulary/' + first.id;
    assert.equal((await post(editPath, other, edit, 'PUT')).res.status, 404);
    assert.equal((await post(editPath, tc, { ...edit, wordFamily: [
      { word: 'beauty', partOfSpeech: '名詞', example: 'She sings beautifully.（她唱得很動聽。）' },
    ] }, 'PUT')).res.status, 400);
    const updated = await post(editPath, tc, edit, 'PUT');
    assert.equal(updated.res.status, 200, JSON.stringify(updated.data));
    assert.equal((await post('/api/learning/context', sc, context)).data.cards.find(card => card.word === 'tea eggs').meaning, '茶葉滷蛋');
    assert.equal((await post('/api/learning/context', sc, { sessionId: old.sessionId, questionId: first.id })).data.cards.find(card => card.word === 'tea eggs').meaning, '茶葉蛋');
    assert.equal(generationRequests, 1);
    r = await post(path, tc, { revision: updated.data.revision, maxAttempts: 1, recordingSeconds: 2,
      sentences: [{ id: second.id, text: second.text }, { id: first.id, text: 'Stanley bought some fruit.' }, { text: 'New question' }] }, 'PATCH');
    assert.equal(r.res.status, 200, JSON.stringify(r.data));
    assert.equal(generationRequests, 2);
    assert.equal((await post(path, tc, { revision: assignment.revision, title: '過期編輯' }, 'PATCH')).res.status, 409);
    const current = (await post('/api/sessions', sc, { code: assignment.code, deviceTestPassed: true })).data;
    assert.deepEqual(current.assignment.sentences.map(q => q.text), ['He was hungry.', 'Stanley bought some fruit.', 'New question']);
    assert.equal(current.assignment.sentences[0].maxAttempts, 1);
    assert.equal(old.assignment.sentences[0].text, first.text);
    const answerPath = `/api/sessions/${old.sessionId}`;
    assert.equal((await post('/api/student/resume/' + old.sessionId, secondCookie)).res.status, 404);
    const resumed = await post('/api/student/resume/' + old.sessionId, sc);
    assert.equal(resumed.res.status, 200, JSON.stringify(resumed.data));
    assert.deepEqual(resumed.data.assignment.sentences.map(q => q.text), [first.text, second.text]);
    assert.equal((await call(answerPath + '/complete', { method: 'POST', cookie: sc, headers: { 'x-session-token': old.sessionToken } })).res.status, 404);
    const sessionHeaders = { 'x-session-token': resumed.data.sessionToken };
    assert.equal((await call(answerPath + '/complete', { method: 'POST', cookie: sc, headers: sessionHeaders })).res.status, 409);
    const overLimit = await call(`${answerPath}/sentences/${second.id}/attempts`, { method: 'POST', cookie: sc,
      headers: { ...sessionHeaders, 'content-type': 'audio/wav' }, body: encodeWavMono(new Float32Array(64000), 32000) });
    assert.equal(overLimit.res.status, 400);
    for (const q of [second, first]) {
      const qPath = `${answerPath}/sentences/${q.id}`;
      assert.equal((await call(qPath + '/attempts', { method: 'POST', cookie: sc, headers: { ...sessionHeaders, 'content-type': 'audio/wav' }, body: wav })).data.maxAttempts, 3);
      assert.equal((await call(qPath + '/accept', { method: 'POST', cookie: sc, headers: sessionHeaders })).res.status, 200);
    }
    assert.equal((await call(answerPath + '/complete', { method: 'POST', cookie: sc, headers: sessionHeaders })).res.status, 200);
    const history = (await call('/api/student/submissions/' + old.sessionId, { cookie: sc })).data;
    assert.deepEqual(history.answers.map(q => q.text), [first.text, second.text]);
    const oldCards = (await post('/api/learning/context', sc, { sessionId: old.sessionId, questionId: first.id })).data.cards;
    assert.ok(oldCards.some(card => card.phrase === 'tea eggs'));
    assert.ok((await call('/api/student/assigned', { cookie: sc })).data.assignments[0].completed_at);
    const trash = { scope: 'all', assignmentIds: [assignment.id] };
    assert.equal((await post('/api/admin/trash', other, trash)).res.status, 404);
    assert.equal((await post('/api/admin/trash', tc, trash)).res.status, 200);
    assert.equal((await call('/api/assignments/code/' + assignment.code)).res.status, 404);
    assert.equal((await call('/api/admin/trash', { cookie: other })).data.assignments.length, 0);
    assert.equal((await post('/api/admin/trash/restore', other, trash)).res.status, 404);
    assert.equal((await post('/api/admin/trash/restore', tc, trash)).res.status, 200);
    assert.equal((await call('/api/assignments/code/' + assignment.code)).res.status, 200);
    assert.equal((await call('/api/assignments/code/' + assignment.code.toLowerCase())).res.status, 200);
    for (const code of ['https:', 'ABC', 'ABC1234', '']) {
      const invalid = await call('/api/assignments/code/' + code);
      assert.equal(invalid.res.status, 400);
      assert.equal(invalid.data.error, '請輸入 6 位英文字母或數字的課程代碼。');
    }
    const unknown = await call('/api/assignments/code/000000');
    assert.equal(unknown.res.status, 404);
    assert.equal(unknown.data.error, '找不到課程代碼');
    const mandarin = (await post('/api/assignments', tc, { title: '華語語塊', language: 'zh-TW', cefr: 'A2',
      generateOnPublish: true, creationKey: crypto.randomUUID(), sentences: [{ text: '我下班後順路去買晚餐。' }] })).data;
    const mandarinPath = `/api/teacher/assignments/${mandarin.id}`;
    assert.equal((await post(mandarinPath + '/publish', tc)).res.status, 202);
    assert.equal((await waitVocabulary(mandarinPath)).published, true);
    const mandarinCards = (await post('/api/learning/context', sc, { code: mandarin.code, questionId: mandarin.sentences[0].id })).data.cards;
    assert.equal(mandarinCards[0].pronunciation, 'wǒ');
    assert.equal(mandarinCards[0].meaning, 'I');
    assert.equal(mandarinCards[0].examples.length, 2);
    const mandarinContext = { code: mandarin.code, questionId: mandarin.sentences[0].id };
    omitToken = true;
    assert.equal((await post(mandarinPath + '/vocabulary', tc)).res.status, 202);
    assert.match((await waitVocabulary(mandarinPath)).error, /第 1 題漏標 1 個詞（我）/);
    assert.deepEqual((await post('/api/learning/context', sc, mandarinContext)).data.cards, mandarinCards);
    omitToken = false;
    assert.equal((await post(mandarinPath + '/vocabulary', tc)).res.status, 202);
    assert.equal((await waitVocabulary(mandarinPath)).published, true);
    assert.notEqual((await post('/api/learning/context', sc, mandarinContext)).data.cards[0].id, mandarinCards[0].id);

    r=await call(`/api/teacher/students/${studentId}`,{method:'PATCH',cookie:tc,body:{disabled:true}});assert.equal(r.res.status,200);
    assert.equal((await call('/api/student/me',{cookie:sc})).res.status,401);

    const disposable = await post('/api/teacher/students', tc, { username: 'disposable', displayName: '刪除驗證', password: 'initial-1234' });
    const disposablePath = '/api/teacher/students/' + disposable.data.id;
    assert.equal((await post(disposablePath, tc, { confirmUsername: 'DISPOSABLE' }, 'DELETE')).res.status, 400);
    assert.equal((await post(disposablePath, other, { confirmUsername: 'disposable' }, 'DELETE')).res.status, 404);
    assert.deepEqual((await post(disposablePath, tc, { confirmUsername: 'disposable' }, 'DELETE')).data, { ok: true, audioPending: false });

    const teacherAudio = await call('/api/teacher/feedback/' + old.sessionId + '/audio', {
      method: 'POST', cookie: tc, headers: { 'content-type': 'audio/wav' }, body: wav,
    });
    assert.equal(teacherAudio.res.status, 201);
    assert.equal((await post('/api/teacher/submissions/' + old.sessionId + '/trash', tc)).res.status, 200);
    const audioRows = await db.prepare(`SELECT r2_key FROM attempts WHERE session_id=?
      UNION ALL SELECT r2_key FROM feedback_audio WHERE session_id=?`).bind(old.sessionId, old.sessionId).all();
    assert.equal(audioRows.results.length, 3);
    for (const row of audioRows.results) assert.ok(await bucket.head(row.r2_key));
    const questionMedia = await db.prepare('SELECT r2_key FROM question_audio WHERE sentence_id=?').bind(first.id).first();
    const guestMedia = await db.prepare('SELECT r2_key FROM attempts WHERE session_id=?').bind(guestId).first();

    await db.prepare('INSERT INTO teacher_students(teacher_id, student_id) VALUES(?,?)').bind('t2', studentId).run();
    const studentPath = '/api/teacher/students/' + studentId;
    const confirmation = { confirmUsername: 'student-一' };
    assert.equal((await call('/api/teacher/students', { cookie: tc })).data.students.find(student => student.id === studentId).can_delete, 0);
    assert.equal((await post(studentPath, tc, confirmation, 'DELETE')).res.status, 403);
    await db.prepare("UPDATE teachers SET role='super_admin' WHERE id='t1'").run();
    assert.deepEqual((await post(studentPath, tc, confirmation, 'DELETE')).data, { ok: true, audioPending: false });
    assert.equal(await db.prepare('SELECT id FROM students WHERE id=?').bind(studentId).first(), null);
    assert.equal(await db.prepare('SELECT id FROM sessions WHERE student_account_id=?').bind(studentId).first(), null);
    assert.equal(await db.prepare('SELECT student_id FROM student_logins WHERE student_id=?').bind(studentId).first(), null);
    assert.equal(await db.prepare('SELECT student_id FROM student_vocabulary WHERE student_id=?').bind(studentId).first(), null);
    assert.equal(await db.prepare('SELECT student_id FROM student_avatars WHERE student_id=?').bind(studentId).first(), null);
    assert.equal(await db.prepare('SELECT student_id FROM assignment_recipients WHERE student_id=?').bind(studentId).first(), null);
    for (const row of audioRows.results) assert.equal(await bucket.head(row.r2_key), null);
    assert.ok(await bucket.head(questionMedia.r2_key));
    assert.ok(await bucket.head(guestMedia.r2_key));

    const retryKey = 'student-deletion-test/retry.wav';
    await bucket.put(retryKey, wav);
    await db.prepare('INSERT INTO student_audio_deletions(r2_key,student_id) VALUES(?,?)').bind(retryKey, studentId).run();
    await assert.rejects(purgeStudentAudio({ DB: db, AUDIO: { async delete() { throw Error('temporary R2 failure'); } } }), /temporary R2 failure/);
    assert.ok(await db.prepare('SELECT r2_key FROM student_audio_deletions WHERE r2_key=?').bind(retryKey).first());
    assert.equal(await purgeStudentAudio({ DB: db, AUDIO: bucket }), true);
    assert.equal(await bucket.head(retryKey), null);
  } finally {await mf.dispose();}
});
