const { planActions } = require('./planner');
const { browserController } = require('./browser');
const { systemController } = require('./system');

class ActionExecutor {
  constructor() {
    this.cancelled = false;
    this.currentTask = null;
  }

  cancel() {
    this.cancelled = true;
  }

  async executeTask(userPrompt, onProgress = () => {}) {
    this.cancelled = false;

    try {
      // 1. Plan the action sequence
      onProgress({ type: 'status', message: 'Fuli is planning your actions...' });
      const plan = await planActions(userPrompt);

      if (this.cancelled) {
        onProgress({ type: 'cancelled', message: 'Task cancelled by user.' });
        return { success: false, cancelled: true };
      }

      onProgress({
        type: 'plan_ready',
        summary: plan.summary,
        steps: plan.steps
      });

      // 2. Execute each step
      for (const step of plan.steps) {
        if (this.cancelled) {
          onProgress({ type: 'cancelled', message: 'Task cancelled by user.' });
          return { success: false, cancelled: true };
        }

        onProgress({
          type: 'step_start',
          stepId: step.id,
          description: step.description,
          action: step.action
        });

        // Execute step based on action type
        switch (step.action) {
          case 'browser_navigate': {
            let targetUrl = step.url || step.target || step.link || step.targetUrl || step.website || step.address;
            if (!targetUrl && step.description) {
              const m = step.description.match(/https?:\/\/[^\s]+/);
              if (m) targetUrl = m[0];
              else if (/google/i.test(step.description)) targetUrl = 'https://www.google.com';
              else if (/chatgpt/i.test(step.description)) targetUrl = 'https://chatgpt.com';
              else if (/youtube/i.test(step.description)) targetUrl = 'https://www.youtube.com';
              else if (/github/i.test(step.description)) targetUrl = 'https://www.github.com';
            }
            if (targetUrl && targetUrl.includes('chat.openai.com')) {
              targetUrl = 'https://chatgpt.com';
            }
            await browserController.navigate(targetUrl || 'https://www.google.com');
            // Allow dynamic web apps (ChatGPT, YouTube, etc.) to paint their UI before next action
            if (targetUrl && (targetUrl.includes('chatgpt.com') || targetUrl.includes('claude.ai'))) {
              await browserController.wait(2000);
            }
            break;
          }

          case 'browser_type':
            await browserController.type(step.selector, step.text, step.pressEnter);
            break;

          case 'browser_press':
            await browserController.press(step.key);
            break;

          case 'browser_click':
            await browserController.click(step.selector);
            break;

          case 'browser_wait':
            await browserController.wait(step.durationMs || 2000);
            break;

          case 'app_open':
            await systemController.openApp(step.appName);
            break;

          case 'app_quit':
            await systemController.quitApp(step.appName);
            break;

          case 'system_volume':
            await systemController.setVolume(step.percent);
            break;

          case 'system_media':
            await systemController.mediaControl(step.action || step.command);
            break;

          case 'system_shell':
            await systemController.runTerminalCommand(step.command);
            break;

          case 'system_screenshot':
            await systemController.takeScreenshot();
            break;

          case 'system_file':
            await systemController.openPath(step.path);
            break;

          case 'system_open_url':
            await systemController.openUrl(step.url);
            break;

          case 'speak':
            await systemController.speak(step.text);
            break;

          default:
            console.warn(`Unknown action type: ${step.action}`);
        }

        onProgress({
          type: 'step_done',
          stepId: step.id,
          description: step.description
        });
      }

      onProgress({
        type: 'complete',
        message: `Finished: ${plan.summary}`
      });

      return { success: true, summary: plan.summary };

    } catch (err) {
      onProgress({
        type: 'error',
        message: err.message || 'Execution failed'
      });
      throw err;
    }
  }
}

const actionExecutor = new ActionExecutor();
module.exports = { actionExecutor, ActionExecutor };
