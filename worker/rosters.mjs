import { assignableStudents } from './assignment-settings.mjs';

export async function rosterRoutes(req, env, url, { teacher, student, response, fail }) {
  const teacherPage = url.pathname === '/api/teacher/student-assignments';
  const recipientsPage = url.pathname === '/api/teacher/assignment-recipients';
  const studentPage = url.pathname === '/api/student/assigned';
  if (req.method !== 'GET' || (!teacherPage && !studentPage && !recipientsPage)) return null;
  if (studentPage) {
    const account = await student(req, env);
    if (!account) return fail('請先登入', 401);
    const { results } = await env.DB.prepare(`SELECT a.id,a.title,a.code,a.starts_at,a.ends_at,a.created_at,t.display_name teacher_name,
      (SELECT MAX(s.completed_at) FROM sessions s WHERE s.assignment_id=a.id AND s.student_account_id=? AND s.deleted_at IS NULL) completed_at
      FROM assignment_recipients r JOIN assignments a ON a.id=r.assignment_id LEFT JOIN teachers t ON t.id=a.teacher_id
      WHERE r.student_id=? AND a.deleted_at IS NULL AND a.publication_state='published' AND a.identity_mode!='anonymous' ORDER BY a.created_at DESC`)
      .bind(account.id, account.id).all();
    return response({ assignments: results });
  }
  const account = await teacher(req, env);
  if (!account) return fail('請先登入', 401);
  const admin = Number(account.role === 'super_admin');
  if (recipientsPage) {
    const assignmentId = url.searchParams.get('assignment') || '';
    let owner = account.id;
    if (assignmentId) {
      const assignment = await env.DB.prepare('SELECT teacher_id FROM assignments WHERE id=? AND deleted_at IS NULL AND (? OR teacher_id=?)')
        .bind(assignmentId, admin, account.id).first();
      if (!assignment) return fail('找不到作業', 404);
      owner = assignment.teacher_id;
    }
    return response({ students: owner ? await assignableStudents(env, owner, assignmentId) : [] });
  }
  const { results } = await env.DB.prepare(`WITH assignment_states AS (
      SELECT a.id,a.title,a.created_at,r.student_id,NULL completed_at FROM assignment_recipients r
        JOIN assignments a ON a.id=r.assignment_id WHERE a.deleted_at IS NULL AND a.publication_state='published' AND a.identity_mode!='anonymous' AND (? OR a.teacher_id=?)
      UNION ALL
      SELECT a.id,a.title,a.created_at,s.student_account_id,s.completed_at FROM sessions s
        JOIN assignments a ON a.id=s.assignment_id
        WHERE s.completed_at IS NOT NULL AND s.student_account_id IS NOT NULL AND s.deleted_at IS NULL
          AND a.deleted_at IS NULL AND a.identity_mode!='anonymous' AND (? OR a.teacher_id=?)
    ), states AS (
      SELECT id,title,created_at,student_id,MAX(completed_at) completed_at FROM assignment_states GROUP BY student_id,id
    ) SELECT st.id student_id,st.display_name,st.disabled_at,states.id assignment_id,states.title,states.created_at,states.completed_at
      FROM students st LEFT JOIN states ON states.student_id=st.id
      WHERE ? OR states.id IS NOT NULL OR EXISTS(SELECT 1 FROM teacher_students ts WHERE ts.student_id=st.id AND ts.teacher_id=?)
      ORDER BY st.display_name COLLATE NOCASE,st.id,states.created_at DESC,states.id DESC`)
    .bind(admin, account.id, admin, account.id, admin, account.id).all();
  const folders = new Map();
  for (const row of results) {
    if (!folders.has(row.student_id)) folders.set(row.student_id, { id: row.student_id, name: row.display_name, disabled: Boolean(row.disabled_at), assignments: [] });
    if (row.assignment_id) folders.get(row.student_id).assignments.push({ id: row.assignment_id, title: row.title, createdAt: row.created_at, completedAt: row.completed_at });
  }
  return response({ students: [...folders.values()] });
}
