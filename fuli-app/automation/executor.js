const { planActions } = require('./planner');
const { browserController } = require('./browser');
const { systemController } = require('./system');
const spotify = require('./spotify');
const google = require('./google');
const extras = require('./extras');

// Electron-only helpers, loaded lazily so the executor still runs under plain Node tests
const electron = () => require('electron');
// Fuli only talks back when the command itself was spoken; typed commands stay silent
let speakReplies = false;

// Play a YouTube video (top search result). Without a Google login, open the results page instead.
async function youtubePlay(query, onProgress) {
  if (!google.isConnected()) {
    await browserController.navigate(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
    onProgress({ type: 'card', card: { kind: 'result', title: query, subtitle: 'Opened YouTube search — connect Google to play the top result directly' } });
    return;
  }
  const v = await google.searchVideo(query);
  await browserController.navigate(v.url);
  onProgress({ type: 'card', card: { kind: 'result', title: v.title, subtitle: `${v.channel} · opened on YouTube` } });
  say(`Playing ${v.title}.`);
}
const say = (text) => { if (speakReplies) systemController.speak(text).catch(() => {}); };

class ActionExecutor {
  constructor() {
    this.cancelled = false;
    this.currentTask = null;
  }

  cancel() {
    this.cancelled = true;
  }

  async executeTask(userPrompt, onProgress = () => {}, { spoken = false } = {}) {
    this.cancelled = false;
    speakReplies = !!spoken;

    try {
      // 1. Plan the action sequence
      onProgress({ type: 'status', message: 'Fuli is planning your actions...' });
      const plan = await planActions(userPrompt);

      if (!spoken) {
        // Typed command: drop the spoken-confirmation steps. If that's all there was (e.g. an API-quota
        // notice), show the text on screen instead.
        const said = plan.steps.filter((s) => s.action === 'speak').map((s) => s.text).filter(Boolean);
        plan.steps = plan.steps.filter((s) => s.action !== 'speak');
        if (!plan.steps.length && said.length) {
          onProgress({ type: 'card', card: { kind: 'result', title: said.join(' '), subtitle: 'Fuli' } });
          return { success: true, summary: plan.summary };
        }
      }

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
            await systemController.mediaControl(step.command || step.mediaAction);
            break;

          case 'spotify_play': {
            onProgress({ type: 'status', message: 'Finding it on Spotify…' });
            let found;
            try {
              found = await spotify.resolve(step);
            } catch (err) {
              // Not a song Spotify knows — a plain "play X" probably means a video
              if (err.code === 'NO_MATCH' && step.fallback === 'youtube') {
                onProgress({ type: 'status', message: 'Not a Spotify song — trying YouTube…' });
                await youtubePlay(step.query, onProgress);
                break;
              }
              throw err;
            }
            const first = found.tracks[found.startIndex];
            if (step.autoplay !== false) {
              await spotify.playUri(first && first.uri, found.contextUri);
              say(`Playing ${first && found.kind === 'track' ? `${first.name} by ${first.artist}` : found.title}.`);
            }
            onProgress({ type: 'card', card: { ...found, kind: 'player', mediaKind: found.kind, idle: step.autoplay === false } });
            break;
          }

          case 'google_connect': {
            onProgress({ type: 'status', message: 'Approve Fuli in the Google page that just opened…' });
            const wins = electron().BrowserWindow.getAllWindows();
            wins.forEach((w) => w.hide()); // Fuli floats above everything, so move aside for the login page
            let name;
            try { ({ name } = await google.connect()); } finally { wins.forEach((w) => { w.show(); w.focus(); }); }
            onProgress({ type: 'card', card: { kind: 'result', title: `Connected${name ? ` as ${name}` : ''}`, subtitle: 'Calendar, Gmail and YouTube are ready' } });
            say('Google is connected.');
            break;
          }

          case 'google_disconnect':
            await google.disconnect();
            onProgress({ type: 'card', card: { kind: 'result', title: 'Google disconnected', subtitle: 'Fuli forgot your login' } });
            break;

          case 'calendar_list': {
            const { label, range, events } = await google.listEvents(step.range);
            const items = events.map((e) => ({
              label: range === 'week' ? `${e.day} · ${e.time}` : e.time, text: e.title, meta: e.location, url: e.url
            }));
            onProgress({ type: 'card', card: { kind: 'list', title: label, hint: 'Click to open in Calendar', empty: range === 'next' ? 'Nothing coming up.' : 'Nothing on the calendar. Enjoy the free time.', items } });
            say(events.length ? `You have ${events.length} event${events.length === 1 ? '' : 's'}. First up: ${events[0].title} at ${events[0].time}.` : 'Nothing on your calendar.');
            break;
          }

          case 'calendar_add': {
            const ev = await google.quickAdd(step.text);
            onProgress({ type: 'card', card: { kind: 'result', title: ev.title, subtitle: `Added to your calendar · ${ev.when}` } });
            say(`Added ${ev.title}.`);
            break;
          }

          case 'calendar_delete': {
            const found = await google.findEvents(step.text);
            if (!found.length) throw new Error(`No upcoming event matches "${step.text}"`);
            onProgress({ type: 'card', card: { kind: 'delete', title: found.length === 1 ? 'Delete this event?' : `Which one should I delete? (${found.length} matches)`, items: found } });
            break;
          }

          case 'gmail_unread': {
            const mails = await google.unreadMail(step.from);
            onProgress({ type: 'card', card: { kind: 'list', title: step.from ? `Unread from ${step.from}` : 'Unread email', hint: 'Click to open in Gmail', empty: 'No unread email.', items: mails.map((m) => ({ label: m.from, text: m.subject, ts: m.ts, url: m.url })) } });
            say(mails.length ? `You have ${mails.length} unread email${mails.length === 1 ? '' : 's'}${mails.length ? `. The latest is from ${mails[0].from}: ${mails[0].subject}.` : ''}` : 'No unread email.');
            break;
          }

          case 'gmail_latest': {
            const m = await google.latestMail();
            onProgress({ type: 'card', card: { kind: 'mail', ...m } });
            say(`Your latest email is from ${m.from}: ${m.subject}.`);
            break;
          }

          case 'youtube_play':
            await youtubePlay(step.query, onProgress);
            break;

          case 'youtube_playlists': {
            const items = await google.myPlaylists();
            onProgress({ type: 'card', card: { kind: 'list', title: 'Your YouTube playlists', hint: 'Click to open', empty: 'No playlists on this YouTube account.', items: items.map((p) => ({ label: `${p.count}`, text: p.title, url: p.url })) } });
            break;
          }

          case 'spotify_playlists': {
            const items = await spotify.listPlaylists();
            onProgress({ type: 'card', card: { kind: 'playlists', items } });
            break;
          }

          case 'spotify_connect': {
            onProgress({ type: 'status', message: 'Approve Fuli in the Spotify page that just opened…' });
            const wins = electron().BrowserWindow.getAllWindows();
            wins.forEach((w) => w.hide()); // Fuli floats above everything, so move aside for the login page
            let name;
            try { ({ name } = await spotify.connect()); } finally { wins.forEach((w) => { w.show(); w.focus(); }); }
            onProgress({ type: 'card', card: { kind: 'result', title: `Connected as ${name}`, subtitle: 'Fuli can now find your playlists and show their songs' } });
            say('Spotify is connected.');
            break;
          }

          case 'spotify_disconnect':
            spotify.disconnect();
            onProgress({ type: 'card', card: { kind: 'result', title: 'Spotify disconnected', subtitle: 'Fuli forgot your login' } });
            break;

          case 'spotify_now_playing': {
            const st = await spotify.state();
            if (!st.running || !st.uri) throw new Error('Nothing is playing on Spotify right now');
            const found = await spotify.trackById(st.uri.split(':').pop());
            onProgress({ type: 'card', card: { ...found, kind: 'player', mediaKind: found.kind } });
            break;
          }

          case 'calc': {
            const { result, expression } = extras.calculate(step.expression);
            electron().clipboard.writeText(result);
            onProgress({ type: 'card', card: { kind: 'result', title: result, subtitle: `${expression} · copied to clipboard` } });
            say(`It's ${result}.`);
            break;
          }

          case 'window_snap': {
            const { screen } = electron();
            const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
            const appName = await extras.snapWindow(step.layout, wa);
            onProgress({ type: 'card', card: { kind: 'result', title: `${appName} → ${step.layout.replace(/-/g, ' ')}`, subtitle: 'Window moved' } });
            break;
          }

          case 'system_command': {
            const msg = await extras.runSystemCommand(step.command);
            onProgress({ type: 'card', card: { kind: 'result', title: msg, subtitle: 'System' } });
            break;
          }

          case 'clipboard_show': {
            const items = extras.clipboardHistory(step.query);
            onProgress({ type: 'card', card: { kind: 'list', title: 'Clipboard history', hint: 'Click to copy', empty: 'Nothing copied yet.', items: items.map((c) => ({ text: c.text, ts: c.ts })) } });
            break;
          }

          case 'clipboard_clear':
            extras.clearClipboardHistory();
            onProgress({ type: 'card', card: { kind: 'result', title: 'Clipboard history cleared', subtitle: 'Clipboard' } });
            break;

          case 'snippet_save':
            extras.saveSnippet(step.name, step.text);
            onProgress({ type: 'card', card: { kind: 'result', title: `Saved snippet “${step.name}”`, subtitle: 'Say or type “paste ' + step.name + ' snippet” to use it' } });
            break;

          case 'snippet_paste': {
            const sn = extras.findSnippet(step.name);
            if (!sn) throw new Error(`No snippet called "${step.name}"`);
            electron().BrowserWindow.getAllWindows().forEach((w) => w.hide());
            await extras.pasteIntoFrontmost(sn.text, (t) => electron().clipboard.writeText(t));
            break;
          }

          case 'snippet_list':
            onProgress({ type: 'card', card: { kind: 'list', title: 'Snippets', hint: 'Click to copy', empty: 'No snippets yet. Try “save snippet email: me@example.com”.', items: extras.snippets().map((sn) => ({ label: sn.name, text: sn.text, ts: sn.ts })) } });
            break;

          case 'snippet_delete':
            if (!extras.deleteSnippet(step.name)) throw new Error(`No snippet called "${step.name}"`);
            onProgress({ type: 'card', card: { kind: 'result', title: `Deleted snippet “${step.name}”`, subtitle: 'Snippets' } });
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
            if (speakReplies) await systemController.speak(step.text);
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
