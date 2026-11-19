export const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function readLimits(body, assignment = {}) {
  const maxAttempts = Number(body.maxAttempts ?? assignment.max_attempts ?? 2);
  const recordingSeconds = Number(body.recordingSeconds ?? assignment.recording_seconds ?? 180);
  const cefr = body.cefr ?? assignment.cefr ?? 'A2';
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10)
    throw Error('錄製次數需為 1–10 次');
  if (!Number.isInteger(recordingSeconds) || recordingSeconds < 1 || recordingSeconds > 180)
    throw Error('每次錄音的時間上限需為 1–180 秒');
  if (!levels.includes(cefr)) throw Error('請選擇有效的 CEFR 等級');
  return { maxAttempts, recordingSeconds, cefr };
}

export function readQuestions(input, current = []) {
  if (!Array.isArray(input) || !input.length) throw Error('至少需要一個非空白題目');
  const existing = new Set(current.map(q => q.id));
  const questions = input.map(q => {
    const text = String(q?.text ?? '').trim();
    if (!text) throw Error('題目文字不得留白');
    if (q.id && !existing.delete(q.id)) throw Error('題目識別碼錯誤或重複');
    const limits = readLimits(q);
    return {
      id: q.id || null,
      text,
      pinyin: String(q.pinyin ?? ''),
      maxAttempts: q.maxAttempts == null ? null : limits.maxAttempts,
      recordingSeconds: q.recordingSeconds == null ? null : limits.recordingSeconds,
    };
  });
  if (existing.size) throw Error('發布後不可刪除既有題目');
  return questions;
}

export async function assignableStudents(env, ownerId, assignmentId = '') {
  const { results } = await env.DB.prepare(`SELECT st.id,st.display_name name,st.disabled_at
    FROM students st WHERE (
      EXISTS (SELECT 1 FROM teacher_students ts WHERE ts.teacher_id=? AND ts.student_id=st.id)
      OR EXISTS (SELECT 1 FROM sessions s JOIN assignments a ON a.id=s.assignment_id WHERE s.student_account_id=st.id
        AND a.teacher_id=? AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL AND a.deleted_at IS NULL AND a.identity_mode!='anonymous')
      OR EXISTS (SELECT 1 FROM assignment_recipients r JOIN assignments a ON a.id=r.assignment_id
        WHERE r.student_id=st.id AND r.assignment_id=? AND a.teacher_id=? AND a.deleted_at IS NULL)
    ) AND (st.disabled_at IS NULL OR EXISTS (
      SELECT 1 FROM assignment_recipients r WHERE r.student_id=st.id AND r.assignment_id=?
    )) ORDER BY st.display_name COLLATE NOCASE,st.id`).bind(ownerId, ownerId, assignmentId, ownerId, assignmentId).all();
  return results;
}

export async function rosterStatements(env, assignmentId, ownerId, values, identityMode) {
  if (values === undefined && identityMode !== 'anonymous') return [];
  if (values !== undefined && (!Array.isArray(values) || values.length > 1000))
    throw Error('指派名單格式錯誤，每份作業最多指派 1000 人');
  const recipients = [...new Set(values || [])];
  if (recipients.length && identityMode === 'anonymous') throw Error('匿名作業無法指派給個別學生');
  if (recipients.length) {
    const allowed = new Set((await assignableStudents(env, ownerId, assignmentId)).map(row => row.id));
    if (recipients.some(studentId => !allowed.has(studentId))) throw Error('請從作業發布教師的學生個別作業區選擇名單');
  }
  const statements = [env.DB.prepare('DELETE FROM assignment_recipients WHERE assignment_id=?').bind(assignmentId)];
  for (let index = 0; index < recipients.length; index += 90) {
    statements.push(env.DB.prepare(`INSERT INTO assignment_recipients(assignment_id,student_id)
      SELECT ?, value FROM json_each(?)`).bind(assignmentId, JSON.stringify(recipients.slice(index, index + 90))));
  }
  return statements;
}
