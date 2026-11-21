import { WorkflowEntrypoint } from 'cloudflare:workers';
import worker, { hash } from './index.mjs';
import { finishVocabulary, generateAssignmentVocabulary } from './learning.mjs';

export class VocabularyWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const job = event.payload;
    try {
      return await step.do('Generate and save vocabulary', {
        retries: { limit: 0, delay: '1 second' },
        timeout: '4 minutes',
      }, () => generateAssignmentVocabulary(this.env, job, hash));
    } catch (error) {
      const problem = /assignment_revision_conflict/.test(String(error))
        ? '生成期間作業已有更新，請重新讀取。'
        : error.message || '語塊卡生成失敗，請重試。';
      await step.do('Record generation failure', async () => {
        await finishVocabulary(this.env, job.assignmentId, job.lease, problem);
        return null;
      });
      return { published: false };
    }
  }
}

export default worker;
