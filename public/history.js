import { enhanceQuestion } from './learning.js';

export async function showHistory(root,request,esc,showFeedback,practice,resume) {
  root.textContent='讀取作業紀錄…';
  try {
    const data=await request('/api/student/submissions');
    root.innerHTML=data.submissions.map(s=>`<details class="item submission" data-id="${esc(s.id)}"><summary><b>${esc(s.title)}</b> <span class="muted">${esc(s.teacher_name || '')}｜${new Date(s.completed_at || s.started_at).toLocaleString('zh-TW')}｜${s.completed_at?'已提交':'作答未完成'}<span class="review-status">${s.completed_at ? (s.published_at ? "｜已批改" : "｜待批改") : ""}</span></span></summary><div class="history-body"></div></details>`).join('') || '<div class="notice">尚無作業紀錄。匿名作業與建立帳號前的提交不會出現在這裡。</div>';
    root.querySelectorAll('details').forEach(detail=>detail.addEventListener('toggle',async()=>{
      if(!detail.open){detail.querySelectorAll('audio').forEach(a=>a.pause());return;}
      if(detail.dataset.loaded)return;
      const body=detail.querySelector('.history-body'); body.textContent='讀取中…';
      try {
        const result=await request(`/api/student/submissions/${detail.dataset.id}`);
        body.innerHTML='<button type="button" class="secondary history-practice">練習與複習單字</button>'+result.answers.map((a,i)=>`<section class="history-answer"><b>第 ${i+1} 題</b><p class="history-question notranslate" translate="no">${esc(a.text)}</p>${a.audioUrl?`<audio controls preload="none" src="${esc(a.audioUrl)}"></audio>`:'<p>尚無可播放錄音</p>'}<div data-feedback-question="${esc(a.id)}"></div></section>`).join('')+'<div class="overall-feedback"></div>';
        const entry = { sessionId:detail.dataset.id, allowSave:true };
        body.querySelector('.history-practice').onclick = () => practice({ ...result.assignment, title: detail.querySelector('summary b').textContent, sentences:result.answers }, entry);
        if (!result.completedAt) {
          const resumeButton = document.createElement('button');
          resumeButton.type = 'button';
          resumeButton.textContent = '繼續作答';
          resumeButton.onclick = async () => {
            resumeButton.disabled = true;
            try { await resume(detail.dataset.id); }
            catch (error) { alert(error.message); resumeButton.disabled = false; }
          };
          body.prepend(resumeButton);
        }
        body.querySelectorAll('.history-question').forEach((question,i) => enhanceQuestion(question,result.assignment.language,{ ...entry,questionId:result.answers[i].id }));
        if(showFeedback)await showFeedback(detail,request,esc);
        detail.dataset.loaded='true';
      }catch(error){body.textContent=error.message;}
    }));
  }catch(error){root.textContent=error.message;}
}
