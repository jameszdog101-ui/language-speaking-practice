import { audioResponse } from './audio.mjs';
import { geminiSettings, generateVocabulary } from './gemini.mjs';

const audioTypes = new Set(['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/aac']);
const maxAudioBytes = 15 * 1024 * 1024;

async function context(req, env, input, h) {
  if (input.sessionId) {
    const session = await h.authorizeSession(req, env, input.sessionId);
    const student = session ? null : await h.student(req, env);
    if (!session && !student) return null;
    return env.DB.prepare(`SELECT ans.question_text text,s.assignment_language language,s.assignment_cefr cefr,s.assignment_vocabulary_version vocabulary_version,ans.sentence_id id
      FROM answers ans JOIN sessions s ON s.id=ans.session_id JOIN assignments a ON a.id=s.assignment_id
      WHERE ans.sentence_id=? AND s.id=? AND (? OR s.student_account_id=?) AND s.deleted_at IS NULL AND a.deleted_at IS NULL`)
      .bind(input.questionId, input.sessionId, Number(Boolean(session)), student?.id || '').first();
  }
  if (input.code) {
    return env.DB.prepare(`SELECT q.id,q.text,a.language,a.cefr,a.vocabulary_version FROM sentences q JOIN assignments a ON a.id=q.assignment_id
      WHERE q.id=? AND a.code=? AND a.deleted_at IS NULL AND a.publication_state='published'`).bind(input.questionId, String(input.code).toUpperCase()).first();
  }
  const teacher = await h.teacher(req, env);
  if (!teacher) return null;
  const row = await env.DB.prepare(`SELECT q.id,q.text,a.language,a.cefr,a.vocabulary_version,a.teacher_id FROM sentences q JOIN assignments a ON a.id=q.assignment_id
    WHERE q.id=? AND a.deleted_at IS NULL`).bind(input.questionId).first();
  return row && h.canEdit(teacher, row) ? row : null;
}

function audioHash(hash, question) { return hash(JSON.stringify([question.language, question.text])); }
export function cardsHash(hash, question) {
  const context = [question.language, question.text, question.cefr];
  if ((question.vocabulary_version ?? 1) > 1) context.unshift(question.vocabulary_version);
  return hash(JSON.stringify(context));
}

export async function cardWrites(env, hash, assignment, output) {
  const statements = [];
  let count = 0;
  for (const q of output) {
    const version = await cardsHash(hash, { ...assignment, text: q.text });
    const records = await Promise.all(q.cards.map(async card => ({
      id: await hash(JSON.stringify([q.id, version, card.start, card.end])),
      start: card.start, end: card.end, content: JSON.stringify(card),
    })));
    for (let offset = 0; offset < records.length; offset += 50) {
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO vocabulary_cards(id,sentence_id,context_hash,start_offset,end_offset,content)
        SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.start'),json_extract(value,'$.end'),json_extract(value,'$.content') FROM json_each(?)`)
        .bind(q.id, version, JSON.stringify(records.slice(offset, offset + 50))));
    }
    count += q.cards.length;
  }
  return { statements, count };
}

export async function claimVocabulary(env, assignment) {
  const token = crypto.randomUUID(), now = new Date().toISOString();
  const result = await env.DB.prepare(`UPDATE assignments SET vocabulary_job_token=?,vocabulary_job_until=?,vocabulary_job_error=NULL
    WHERE id=? AND revision=? AND deleted_at IS NULL AND (vocabulary_job_until IS NULL OR vocabulary_job_until<=?)`)
    .bind(token, new Date(Date.now() + 180000).toISOString(), assignment.id, assignment.revision, now).run();
  return result.meta.changes ? token : null;
}

export async function finishVocabulary(env, assignmentId, token, problem = null) {
  await env.DB.prepare(`UPDATE assignments SET vocabulary_job_token=NULL,vocabulary_job_until=NULL,vocabulary_job_error=?
    WHERE id=? AND vocabulary_job_token=?`).bind(problem, assignmentId, token).run();
}

export async function learningRoutes(req, env, url, h) {
  const { teacher, student, canEdit, fail, response, bodyJson, hash } = h;
  const path = url.pathname;
  if (path === '/api/teacher/gemini') {
    const account = await teacher(req, env);
    return account ? geminiSettings(req, env, account, h) : fail('請先登入', 401);
  }
  const generate = /^\/api\/teacher\/assignments\/([^/]+)\/(publish|vocabulary)$/.exec(path);
  if (generate && req.method === 'POST') {
    const account = await teacher(req, env);
    if (!account) return fail('請先登入', 401);
    const assignment = await env.DB.prepare('SELECT * FROM assignments WHERE id=? AND deleted_at IS NULL').bind(generate[1]).first();
    if (!assignment || account.id !== assignment.teacher_id) return fail('只有發布教師可以使用自己的 Gemini Key 生成', 404);
    if (assignment.publication_state === 'published' && assignment.vocabulary_version >= 2)
      return response({ published: true });
    const lease = await claimVocabulary(env, assignment);
    if (!lease) return response({ generating: true }, 202);
    const publish = async () => { try {
      const { results: questions } = await env.DB.prepare('SELECT id,text FROM sentences WHERE assignment_id=? ORDER BY position').bind(assignment.id).all();
      const output = await generateVocabulary(env, account.id, assignment, questions);
      const cards = await cardWrites(env, hash, { ...assignment, vocabulary_version: 2 }, output);
      await env.DB.batch([
        env.DB.prepare(`UPDATE assignments SET publication_state='published',vocabulary_version=2,
          revision=CASE WHEN vocabulary_job_token=? THEN ? ELSE revision END,
          vocabulary_job_token=NULL,vocabulary_job_until=NULL,vocabulary_job_error=NULL WHERE id=?`)
          .bind(lease, assignment.revision + 1, assignment.id),
        ...cards.statements,
      ]);
      return response({ published: true, count: cards.count });
    } catch (error) {
      const problem = /assignment_revision_conflict/.test(String(error)) ? '生成期間作業已有更新，請重新讀取' : error.message;
      await finishVocabulary(env, assignment.id, lease, problem);
      return fail(problem, 422);
    } };
    const work = publish();
    h.waitUntil?.(work);
    return work;
  }

  const edit = /^\/api\/teacher\/question-vocabulary\/([^/]+)$/.exec(path);
  if (edit && req.method === 'PUT') {
    const account = await teacher(req, env);
    if (!account) return fail('請先登入', 401);
    const assignment = await env.DB.prepare(`SELECT a.* FROM assignments a JOIN sentences q ON q.assignment_id=a.id
      WHERE q.id=? AND a.teacher_id=? AND a.deleted_at IS NULL AND a.publication_state='published' AND a.vocabulary_version>=2`)
      .bind(edit[1], account.id).first();
    if (!assignment) return fail('找不到可編輯的語塊卡', 404);
    const input = await bodyJson(req);
    if (input.revision !== assignment.revision) return fail('作業已更新，請重新載入後修改', 409);
    const text = (value, max) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : '';
    const pronunciation = text(input.pronunciation, 180), meaning = text(input.meaning, 350), usage = text(input.usage, 350);
    const examples = Array.isArray(input.examples) ? [...new Set(input.examples.map(value => text(value, 350)).filter(Boolean))] : [];
    const similar = Array.isArray(input.similar) ? [...new Set(input.similar.map(value => text(value, 350)).filter(Boolean))] : [];
    const required = assignment.language === 'en' ? 3 : 2;
    if (!pronunciation || !meaning || !usage || examples.length !== required || similar.length > 3)
      return fail(`請填寫發音、翻譯、使用情境及 ${required} 個不同的例句。相似詞最多 3 個。`);
    const { results: questions } = await env.DB.prepare('SELECT id,text FROM sentences WHERE assignment_id=? ORDER BY position').bind(assignment.id).all();
    const output = [];
    let found = false;
    for (const q of questions) {
      const context = await cardsHash(hash, { ...assignment, text: q.text });
      const rows = await env.DB.prepare('SELECT id,content FROM vocabulary_cards WHERE sentence_id=? AND context_hash=? ORDER BY start_offset')
        .bind(q.id, context).all();
      const cards = rows.results.map(row => {
        const card = JSON.parse(row.content);
        if (q.id !== edit[1] || row.id !== input.cardId) return card;
        found = true;
        return { ...card, pronunciation, meaning, usage, examples, similar };
      });
      output.push({ ...q, cards });
    }
    if (!found) return fail('找不到可編輯的語塊卡', 404);
    const cards = await cardWrites(env, hash, { ...assignment, vocabulary_version: assignment.vocabulary_version + 1 }, output);
    try {
      await env.DB.batch([
        env.DB.prepare(`UPDATE assignments SET vocabulary_version=?,revision=CASE
          WHEN vocabulary_job_until IS NULL OR vocabulary_job_until<=? THEN ? ELSE revision END WHERE id=?`)
          .bind(assignment.vocabulary_version + 1, new Date().toISOString(), assignment.revision + 1, assignment.id),
        ...cards.statements,
      ]);
    } catch (error) {
      if (/assignment_revision_conflict/.test(String(error))) return fail('作業正在更新，請重新載入後修改', 409);
      throw error;
    }
    return response({ revision: assignment.revision + 1 });
  }

  const upload = /^\/api\/teacher\/question-audio\/([^/]+)$/.exec(path);
  if (upload && req.method === 'PUT') {
    const account = await teacher(req, env);
    if (!account) return fail('請先登入', 401);
    const row = await env.DB.prepare(`SELECT q.id,q.text,a.id assignment_id,a.teacher_id,a.language,a.revision FROM sentences q
      JOIN assignments a ON a.id=q.assignment_id WHERE q.id=? AND a.deleted_at IS NULL`).bind(upload[1]).first();
    if (!row || !canEdit(account, row)) return fail('找不到題目', 404);
    const revision = url.searchParams.get('revision');
    if (revision && Number(revision) !== row.revision) return fail('題目已變更，請重新載入後上傳', 409);
    const mime = (req.headers.get('content-type') || '').split(';')[0];
    if (!audioTypes.has(mime)) return fail('請選擇支援的 MP3、WAV、M4A、AAC、OGG 或 WebM 音檔', 415);
    if (Number(req.headers.get('content-length')) > maxAudioBytes) return fail('音檔最多 15 MB', 413);
    const bytes = await req.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > maxAudioBytes) return fail('音檔大小須介於 1 Byte 與 15 MB', 413);
    const version = await audioHash(hash, row);
    const previous = await env.DB.prepare('SELECT r2_key FROM question_audio WHERE sentence_id=? AND context_hash=?').bind(row.id, version).first();
    const key = `question-audio/${row.assignment_id}/${row.id}/${crypto.randomUUID()}`;
    await env.AUDIO.put(key, bytes, { httpMetadata: { contentType: mime } });
    try {
      const result = await env.DB.prepare(`INSERT INTO question_audio(sentence_id,context_hash,r2_key,mime_type,byte_size)
        SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM assignments WHERE id=? AND revision=? AND deleted_at IS NULL)
        ON CONFLICT(sentence_id,context_hash) DO UPDATE SET r2_key=excluded.r2_key,mime_type=excluded.mime_type,byte_size=excluded.byte_size
        WHERE question_audio.r2_key=?`
      ).bind(row.id, version, key, mime, bytes.byteLength, row.assignment_id, row.revision, previous?.r2_key || null).run();
      if (!result.meta.changes) {
        await env.AUDIO.delete(key);
        return fail('題目或音檔已變更，請重新載入後上傳', 409);
      }
    } catch (error) { await env.AUDIO.delete(key); throw error; }
    if (previous) await env.AUDIO.delete(previous.r2_key).catch(() => {});
    return response({ ok: true });
  }

  const audioGet = path === '/api/learning/audio' && req.method === 'GET';
  if ((path === '/api/learning/context' && req.method === 'POST') || audioGet) {
    const input = audioGet ? Object.fromEntries(url.searchParams) : await bodyJson(req);
    if (typeof input.questionId !== 'string') return fail('找不到題目', 404);
    const question = await context(req, env, input, h);
    if (!question) return fail('找不到題目', 404);
    const audio = await env.DB.prepare('SELECT * FROM question_audio WHERE sentence_id=? AND context_hash=?').bind(question.id, await audioHash(hash, question)).first();
    if (audioGet) return audio ? audioResponse(req, env.AUDIO, audio) : fail('尚未提供題目朗讀音檔', 404);
    const cards = await env.DB.prepare('SELECT id,content FROM vocabulary_cards WHERE sentence_id=? AND context_hash=? ORDER BY start_offset')
      .bind(question.id, await cardsHash(hash, question)).all();
    const query = new URLSearchParams({ questionId: question.id });
    if (input.sessionId) query.set('sessionId', input.sessionId);
    else if (input.code) query.set('code', input.code);
    return response({ cards: cards.results.map(row => ({ id: row.id, ...JSON.parse(row.content) })),
      audioUrl: audio ? `/api/learning/audio?${query}` : null });
  }

  if (path !== '/api/student/vocabulary') return null;
  const account = await student(req, env);
  if (!account) return fail('請先登入學生帳號', 401);
  if (req.method === 'GET') {
    const cards = await env.DB.prepare('SELECT card_id,saved_at,content FROM student_vocabulary WHERE student_id=? ORDER BY saved_at DESC').bind(account.id).all();
    return response({ cards: cards.results.map(row => ({ id: row.card_id, savedAt: row.saved_at, ...JSON.parse(row.content) })) });
  }
  if (req.method === 'DELETE') {
    const cardId = url.searchParams.get('card');
    await env.DB.prepare('DELETE FROM student_vocabulary WHERE student_id=? AND card_id=?').bind(account.id, cardId || '').run();
    return response({ ok: true });
  }
  if (req.method === 'POST') {
    const body = await bodyJson(req);
    if (typeof body.questionId !== 'string' || typeof body.cardId !== 'string') return fail('找不到單字卡', 404);
    const question = await context(req, env, body, h);
    if (!question) return fail('找不到題目', 404);
    const card = await env.DB.prepare('SELECT id,content FROM vocabulary_cards WHERE id=? AND sentence_id=? AND context_hash=?')
      .bind(body.cardId, question.id, await cardsHash(hash, question)).first();
    if (!card) return fail('找不到單字卡，請重新載入', 404);
    await env.DB.prepare(`INSERT INTO student_vocabulary(student_id,card_id,content,saved_at) VALUES(?,?,?,?)
      ON CONFLICT(student_id,card_id) DO UPDATE SET content=excluded.content,saved_at=excluded.saved_at`)
      .bind(account.id, card.id, card.content, new Date().toISOString()).run();
    return response({ ok: true });
  }
  return fail('路徑不存在', 404);
}
