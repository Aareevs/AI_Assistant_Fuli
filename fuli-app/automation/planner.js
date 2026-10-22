const path = require('path');
const spotify = require('./spotify');
const google = require('./google');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
const MODEL_NAME = 'gemini-2.5-flash';

const SYSTEM_INSTRUCTION = `
You are Fuli's Desktop & Screen Action Planner.
Your job is to translate the user's natural language request (such as "Go to Google and search xxx", "Open YouTube and play lofi", "Launch VS Code") into a structured, executable sequence of actions.

Return ONLY a valid JSON object matching this schema:
{
  "summary": "Short 1-sentence description of what Fuli will do",
  "steps": [
    {
      "id": 1,
      "description": "Short human-readable step description for the UI",
      "action": "ACTION_TYPE",
      // specific action parameters
    }
  ]
}

Supported ACTION_TYPEs:
1. "browser_navigate"
   Parameters: { "url": "https://..." }
   Use when opening or directing the browser to a website. Always use fully qualified URLs (e.g. "https://www.google.com"). You MUST include the "url" property with the full URL.
   Example: { "id": 1, "description": "Open Google in browser", "action": "browser_navigate", "url": "https://www.google.com" }
   
2. "browser_type"
   Parameters: { "selector": "CSS_SELECTOR", "text": "STRING", "pressEnter": boolean }
   Use to type text into input fields, search bars, textareas. For Google, selector is usually "textarea[name='q'], input[name='q']". If pressEnter is true, it presses Enter immediately after typing.
   
3. "browser_press"
   Parameters: { "key": "Enter" | "Tab" | "Escape" | "ArrowDown" }
   Use to send a keypress to the browser.
   
4. "browser_click"
   Parameters: { "selector": "CSS_SELECTOR", "text": "OPTIONAL_BUTTON_TEXT" }
   Use to click a link, button, or element.
   
5. "browser_wait"
   Parameters: { "durationMs": number }
   Wait a bit for pages or results to load (e.g., 2000 ms).
   
6. "app_open"
   Parameters: { "appName": "Google Chrome" | "Visual Studio Code" | "Spotify" | "Terminal" | etc. }
   Use to launch an application on macOS.
   
7. "app_quit"
   Parameters: { "appName": "Spotify" | "Google Chrome" | etc. }
   Use to quit an application.

8. "system_volume"
   Parameters: { "percent": number }
   Use to set the macOS system output volume (0 to 100) or mute (0).

9. "system_media"
   Parameters: { "command": "play" | "pause" | "next" | "previous" | "toggle" }
   Use to control playback on Spotify or Apple Music.

10. "system_shell"
    Parameters: { "command": "STRING" }
    Use to execute shell/terminal commands on the Mac (e.g. git, listing files, system info, checking battery).

11. "system_screenshot"
    Parameters: {}
    Use to take a screenshot of the Mac desktop.

12. "system_open_url"
    Parameters: { "url": "https://..." }
    Use to open a URL in the default system browser.
    
13. "speak"
    Parameters: { "text": "Spoken text" }
    Use to speak a response aloud to the user in Fuli's natural female voice.

14. "spotify_play"
    Parameters: { "kind": "track" | "playlist" | "album", "query": "song/playlist/album name", "artist": "optional artist" }
    Use whenever the user wants a specific song, playlist or album played. Fuli shows its own player with Spotify's cover art and track list.

14a. "spotify_playlists" {} shows a list of the user's own Spotify playlists.

14b. "spotify_connect" {} signs the user in to Spotify via browser; "spotify_disconnect" {}.

15. "spotify_now_playing"
    Parameters: {}
    Show Fuli's player for whatever is currently playing.

16. "calc"
    Parameters: { "expression": "2*(3+4)" | "15% of 80" | "10 km to miles" }

17. "window_snap"
    Parameters: { "layout": "left-half" | "right-half" | "top-half" | "bottom-half" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "left-third" | "center-third" | "right-third" | "left-two-thirds" | "right-two-thirds" | "maximize" | "center" }

18. "system_command"
    Parameters: { "command": "lock" | "sleep" | "dark-mode-on" | "dark-mode-off" | "dark-mode-toggle" | "empty-trash" | "caffeinate-on" | "caffeinate-off" | "unmute" | "volume-up" | "volume-down" }

18b. Google (Calendar / Gmail / YouTube): "calendar_list" { range: today|tomorrow|week|next }, "calendar_add" { text }, "calendar_delete" { text }, "gmail_unread" { from }, "gmail_latest", "youtube_play" { query }, "youtube_playlists", "google_connect", "google_disconnect".

19. "clipboard_show" (no params) — show clipboard history. "clipboard_clear" — clear it.

20. "snippet_save" { "name", "text" }, "snippet_paste" { "name" }, "snippet_list" {}, "snippet_delete" { "name" }

Rules:
- For web search commands ("Go to Google and search X", "Search X on Google"):
  Step 1: browser_navigate to "https://www.google.com"
  Step 2: browser_type query into "textarea[name='q'], input[name='q']" with pressEnter: true
  Step 3: browser_wait for 2000 ms to display results.
  Step 4: speak confirmation (e.g. "I've searched for X on Google for you.")
- For device commands:
  "Turn volume up/down to 50" -> system_volume { percent: 50 }, speak { text: "Volume set to 50 percent." }
  "Play music" -> system_media { command: "play" }, speak { text: "Resuming music." }
  "Pause music" -> system_media { command: "pause" }, speak { text: "Music paused." }
  "Open Spotify" -> app_open { appName: "Spotify" }, speak { text: "Opening Spotify." }
  "Close/Quit Slack" -> app_quit { appName: "Slack" }, speak { text: "Closed Slack." }
- Always include a final or intermediate "speak" step so Fuli verbally speaks back to the user!
- Return ONLY JSON. Do not wrap in markdown quotes if possible, or use standard \`\`\`json blocks.
`;

const CANDIDATE_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-2.5-flash'
];


const unquote = (x) => (x || '').replace(/^[\s"'“‘]+|[\s"'”’.]+$/g, '');

// Sites Fuli can search directly ("search shoes on amazon"). Anything not listed falls back to a Google search.
const SEARCH_SITES = {
  amazon: 'https://www.amazon.com/s?k=', flipkart: 'https://www.flipkart.com/search?q=', ebay: 'https://www.ebay.com/sch/i.html?_nkw=',
  maps: 'https://www.google.com/maps/search/', 'google maps': 'https://www.google.com/maps/search/',
  wikipedia: 'https://en.wikipedia.org/w/index.php?search=', github: 'https://github.com/search?q=',
  reddit: 'https://www.reddit.com/search/?q=', imdb: 'https://www.imdb.com/find/?q=',
  'google images': 'https://www.google.com/search?tbm=isch&q=', images: 'https://www.google.com/search?tbm=isch&q=',
  'google news': 'https://news.google.com/search?q=', news: 'https://news.google.com/search?q=',
  twitter: 'https://x.com/search?q=', x: 'https://x.com/search?q=', 'stack overflow': 'https://stackoverflow.com/search?q=',
  stackoverflow: 'https://stackoverflow.com/search?q=', 'google scholar': 'https://scholar.google.com/scholar?q='
};

const plan = (summary, ...steps) => ({ summary, steps: steps.map((st, i) => ({ id: i + 1, ...st })) });

const WINDOW_WORDS = [
  [/^(?:the\s+)?left(?:\s+half|\s+side)?$/, 'left-half'], [/^(?:the\s+)?right(?:\s+half|\s+side)?$/, 'right-half'],
  [/^(?:the\s+)?top(?:\s+half)?$/, 'top-half'], [/^(?:the\s+)?bottom(?:\s+half)?$/, 'bottom-half'],
  [/^(?:the\s+)?top[\s-]left(?:\s+corner|\s+quarter)?$/, 'top-left'], [/^(?:the\s+)?top[\s-]right(?:\s+corner|\s+quarter)?$/, 'top-right'],
  [/^(?:the\s+)?bottom[\s-]left(?:\s+corner|\s+quarter)?$/, 'bottom-left'], [/^(?:the\s+)?bottom[\s-]right(?:\s+corner|\s+quarter)?$/, 'bottom-right'],
  [/^(?:the\s+)?(?:left|first)\s+third$/, 'left-third'], [/^(?:the\s+)?(?:center|middle)\s+third$/, 'center-third'], [/^(?:the\s+)?(?:right|last)\s+third$/, 'right-third'],
  [/^(?:the\s+)?(?:left|first)\s+two\s+thirds$/, 'left-two-thirds'], [/^(?:the\s+)?(?:right|last)\s+two\s+thirds$/, 'right-two-thirds'],
  [/^(?:max(?:imize|imum)?|full(?:\s*screen)?|fill(?:\s+the\s+screen)?)$/, 'maximize'], [/^(?:the\s+)?(?:center|middle)$/, 'center']
];

function windowLayout(where) {
  const hit = WINDOW_WORDS.find(([re]) => re.test(where.trim()));
  return hit ? hit[1] : null;
}

// Feature commands (Spotify, calculator, windows, system, clipboard, snippets) — typed or spoken.
function tryFeaturePath(p, original) {
  if (/^(?:open|launch|play)\s+spotify$/.test(p)) return null; // plain app launch / resume, handled below
  // ── Spotify ──
  if (spotify.isInstalled()) {
    if (/^(?:connect|link|log ?in|sign ?in|log in to|sign in to|connect to)\s+(?:to\s+|with\s+|my\s+)?spotify(?:\s+account)?$/.test(p) || /^spotify (?:login|log in|sign in|connect)$/.test(p)) {
      return plan('Connect Spotify', { description: 'Sign in to Spotify in your browser', action: 'spotify_connect' });
    }
    if (/^(?:disconnect|log ?out of|sign out of|unlink)\s+(?:from\s+)?spotify$/.test(p)) {
      return plan('Disconnect Spotify', { description: 'Disconnect Spotify', action: 'spotify_disconnect' });
    }
    if (/^(?:show\s+(?:me\s+)?)?(?:now playing|what'?s playing|what song is (?:this|playing)|(?:show|open) (?:the )?(?:music )?player)$/.test(p)) {
      return plan('Show what is playing', { description: 'Open Fuli player', action: 'spotify_now_playing' });
    }
    // "... on spotify" / "... spotify" at the end is just noise — drop it so the real request matches
    const bare = p.replace(/\s+(?:on|in|from|with|using|via)?\s*spotify$/, '');
    const sawSpotify = !!bare && bare !== p;
    if (sawSpotify) p = bare;
    // "open/show" only displays the playlist or album; "play/start/shuffle" also starts it
    if (/^(?:(?:open|show|list|view|browse|see|get)\s+)?(?:me\s+)?(?:all\s+)?(?:of\s+)?(?:my\s+)?(?:spotify\s+)?playlists?(?:\s+(?:from|on|in|of)\s+spotify)?$/.test(p) || /^what(?:'s| are| is)\s+(?:in\s+)?my\s+(?:spotify\s+)?playlists?$/.test(p)) {
      return plan('Show your Spotify playlists', { description: 'Load your Spotify playlists', action: 'spotify_playlists' });
    }
    const isOpenVerb = (v) => /^(?:open|show|view|browse)$/.test(v);
    const pl = p.match(/^(open|show|view|browse|play|start|put on|shuffle|listen to)\s+(?:me\s+)?(?:the\s+|my\s+)?(?:playlist\s+(.+?)|(.+?)\s+playlist)(?:\s+on spotify)?$/);
    if (pl) {
      const query = unquote(pl[2] || pl[3]);
      const autoplay = !isOpenVerb(pl[1]);
      const mine = /\bmy\b/.test(p);
      return plan(`${autoplay ? 'Play' : 'Open'} the ${query} playlist`, { description: `${autoplay ? 'Find and play' : 'Open'} "${query}" playlist`, action: 'spotify_play', kind: 'playlist', query, autoplay, mine });
    }
    const al = p.match(/^(play|open|show|view|put on|listen to)\s+(?:the\s+)?album\s+(.+?)(?:\s+by\s+(.+?))?(?:\s+on spotify)?$/);
    if (al) {
      const autoplay = !isOpenVerb(al[1]);
      return plan(`${autoplay ? 'Play' : 'Open'} the album ${al[2]}`, { description: `${autoplay ? 'Find and play' : 'Open'} album "${al[2]}"`, action: 'spotify_play', kind: 'album', query: unquote(al[2]), artist: al[3] && unquote(al[3]), autoplay });
    }
    const tr = p.match(/^(?:play|put on|listen to)\s+(?:the\s+)?(song\s+|track\s+)?(.+?)(?:\s+by\s+(.+?))?$/);
    if (tr && !/\s(?:on|in)\s+youtube$/.test(p) && !/^(?:music|some music|something|it|again|next|previous|the next (?:song|track)|songs?)$/.test(tr[2])) {
      const query = unquote(tr[2]);
      const artist = tr[3] && unquote(tr[3]);
      // "play X" with no hint that it's a song (no "song", "by <artist>" or "on spotify"): if Spotify has no real match, try YouTube
      const explicit = !!tr[1] || !!tr[3] || sawSpotify;
      return plan(`Play ${query}${artist ? ` by ${artist}` : ''}`, { description: `Find and play "${query}"${artist ? ` by ${artist}` : ''}`, action: 'spotify_play', kind: 'track', query, artist, ...(explicit ? {} : { fallback: 'youtube' }) });
    }
    if (/^(?:previous|last|go back(?: a)?)(?:\s+song|\s+track)?$/.test(p)) {
      return plan('Previous track', { description: 'Previous track', action: 'system_media', command: 'previous' });
    }
  }

  // ── Google (Calendar, Gmail, YouTube) ──
  if (/^(?:connect|link|log ?in|sign ?in|log in to|sign in to)\s+(?:to\s+|with\s+|my\s+)?google(?:\s+account)?$/.test(p) || /^google (?:login|log in|sign in|connect)$/.test(p)) {
    return plan('Connect Google', { description: 'Sign in to Google in your browser', action: 'google_connect' });
  }
  if (/^(?:disconnect|log ?out of|sign out of|unlink)\s+(?:from\s+)?google$/.test(p)) {
    return plan('Disconnect Google', { description: 'Disconnect Google', action: 'google_disconnect' });
  }

  const dayWord = (w) => (/tomorrow/.test(w || '') ? 'tomorrow' : /week/.test(w || '') ? 'week' : 'today');
  const calList = p.match(/^(?:what(?:'?s| is| do i have| have i got)|show(?: me)?|list|check|read)\s+(?:on\s+)?(?:my\s+)?(?:calendar|schedule|agenda)(?:\s+(?:for\s+)?(today|tomorrow|tonight|this week))?$/)
    || p.match(/^(?:what(?:'?s| is| do i have| have i got)|show(?: me)?)\s+(?:on\s+)?(?:for\s+)?(today|tomorrow|tonight|this week)$/)
    || p.match(/^(?:my\s+)?(?:calendar|schedule|agenda)(?:\s+(today|tomorrow|tonight|this week))?$/);
  if (calList) return plan('Check your calendar', { description: 'Load your calendar', action: 'calendar_list', range: dayWord(calList[1]) });
  if (/^(?:when(?:'?s| is)|what(?:'?s| is))\s+my\s+next\s+(?:meeting|event|appointment)$|^next (?:meeting|event)$/.test(p)) {
    return plan('Find your next event', { description: 'Find your next event', action: 'calendar_list', range: 'next' });
  }
  const calAdd = original.match(/^(?:add|schedule|put|book|create|set up)\s+(.+?)(?:\s+(?:to|on|in)\s+(?:my\s+)?calendar)?$/i);
  if (calAdd && (/\b(?:to|on|in)\s+(?:my\s+)?calendar$/i.test(original) || /\b(?:at\s+\d|\d\s*(?:am|pm)\b|tomorrow|tonight|today|next\s+\w+|on\s+(?:mon|tue|wed|thu|fri|sat|sun)\w*)/i.test(calAdd[1]))
      && !/^(?:a\s+)?(?:snippet|note|reminder)\b/i.test(calAdd[1])) {
    return plan(`Add to calendar: ${calAdd[1]}`, { description: `Add "${calAdd[1]}" to your calendar`, action: 'calendar_add', text: calAdd[1].trim() });
  }

  const calDel = original.match(/^(?:delete|remove|cancel|clear)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:from|off|on|in)\s+(?:my\s+)?calendar)?$/i);
  if (calDel) {
    const what = calDel[1].trim();
    const hint = /\b(?:from|off|on|in)\s+(?:my\s+)?calendar$/i.test(original) || /\b(?:meeting|event|appointment|call|dinner|lunch|standup)\b/i.test(what)
      || /\b(?:\d\s*(?:am|pm)|tomorrow|tonight|today)\b/i.test(what);
    if ((hint || google.isConnected()) && !/\b(?:snippet|note|clipboard|playlist|file|history|trash|tab|window|app)\b/i.test(what)) {
      return plan(`Delete from calendar: ${what}`, { description: `Find "${what}" on your calendar`, action: 'calendar_delete', text: what });
    }
  }

  const mailLatest = p.match(/^(?:read|open|show)\s+(?:me\s+)?(?:my\s+)?(?:latest|last|newest|most recent)\s+(?:e-?mail|mail)$/);
  if (mailLatest) return plan('Read your latest email', { description: 'Open your latest email', action: 'gmail_latest' });
  const mailUnread = p.match(/^(?:any\s+|check\s+|show\s+|list\s+|read\s+)?(?:me\s+)?(?:my\s+)?(?:new\s+|unread\s+)?(?:e-?mails?|inbox|mail)(?:\s+from\s+(.+))?$/)
    || p.match(/^(?:any\s+)?unread(?:\s+(?:from|by)\s+(.+))?$/);
  if (mailUnread) {
    const from = unquote(mailUnread[1] || '');
    return plan(from ? `Unread email from ${from}` : 'Check unread email', { description: from ? `Find unread email from ${from}` : 'Check unread email', action: 'gmail_unread', from });
  }

  // "search X on <site>" / "search <site> for X" — shows that site's results page
  const siteSearch = p.match(/^(?:search|find|look up|look for)\s+(?:for\s+)?(.+?)\s+(?:on|in|at)\s+(?:the\s+)?([a-z ]+)$/) || (() => {
    const m = p.match(/^(?:search|find)\s+(?:the\s+)?([a-z ]+?)\s+for\s+(.+)$/);
    return m ? [m[0], m[2], m[1]] : null;
  })();
  if (siteSearch && SEARCH_SITES[siteSearch[2].trim()]) {
    const query = unquote(siteSearch[1]);
    const site = siteSearch[2].trim();
    return plan(`Search ${site} for ${query}`, { description: `Search ${site} for "${query}"`, action: 'browser_navigate', url: SEARCH_SITES[site] + encodeURIComponent(query) });
  }

  // "search / find / open ... on YouTube" shows the results page; only "play / watch" opens the top video
  const ytSearch = p.match(/^(?:search|find|look up|look for)\s+(?:for\s+)?(.+?)\s+(?:on|in)\s+youtube$/)
    || p.match(/^(?:search|find)\s+youtube\s+(?:for\s+)?(.+)$/) || p.match(/^youtube\s+search\s+(?:for\s+)?(.+)$/)
    || p.match(/^open\s+(.+?)\s+(?:on|in)\s+youtube$/) || p.match(/^youtube\s+(?!playlists?$)(.+)$/);
  if (ytSearch) {
    const query = unquote(ytSearch[1]);
    return plan(`Search YouTube for ${query}`, { description: `Search YouTube for "${query}"`, action: 'browser_navigate', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` });
  }
  const ytPlay = p.match(/^(?:play|watch)\s+(.+?)\s+(?:on|in)\s+youtube$/) || p.match(/^watch\s+(?!(?:netflix|youtube|prime|hotstar|tv)\b)(.+)$/);
  if (ytPlay) {
    const query = unquote(ytPlay[1]);
    return plan(`Play ${query} on YouTube`, { description: `Find "${query}" on YouTube`, action: 'youtube_play', query });
  }
  if (/^(?:show|open|list)\s+(?:me\s+)?(?:my\s+)?youtube\s+playlists?$|^my\s+youtube\s+playlists?$/.test(p)) {
    return plan('Show your YouTube playlists', { description: 'Load your YouTube playlists', action: 'youtube_playlists' });
  }

  // ── Calculator & conversions ──
  const calcMatch = p.match(/^(?:calculate|calc|compute|convert|what(?:'s| is)|whats|how much is)\s+(.+?)\??$/) || (/^[\d\s.,+\-*/^%()x×÷]+$/.test(p) && /\d\s*[-+*/^%x×÷]\s*\d/.test(p) ? [p, p] : null);
  if (calcMatch && /\d/.test(calcMatch[1])) {
    return plan(`Calculate ${calcMatch[1]}`, { description: `Calculate ${calcMatch[1]}`, action: 'calc', expression: calcMatch[1] });
  }

  // ── Window snapping ──
  const win = p.match(/^(?:snap|move|put|tile|send|make)?\s*(?:the\s+|this\s+|my\s+)?window\s+(?:to\s+)?(?:the\s+)?(.+)$/)
    || p.match(/^(?:snap|move|put|tile)\s+(?:it\s+)?(?:to\s+)?(?:the\s+)?(.+)$/);
  const winVerb = p.match(/^(maximi[sz]e|center|centre)(?:\s+(?:the|this|my))?\s+window$/);
  const layout = winVerb ? (winVerb[1].startsWith('max') ? 'maximize' : 'center') : win ? windowLayout(win[1]) : null;
  if (layout) {
    return plan(`Snap window: ${layout.replace(/-/g, ' ')}`, { description: `Move window to ${layout.replace(/-/g, ' ')}`, action: 'window_snap', layout });
  }

  // ── System ──
  const systemPhrases = [
    [/^lock(?:\s+(?:the\s+)?(?:screen|my mac|my computer|computer|mac))?$/, 'lock'],
    [/^(?:go to sleep|sleep|put (?:my |the )?(?:mac|computer) to sleep)$/, 'sleep'],
    [/^(?:turn on|enable|switch to|use)\s+dark mode$|^dark mode(?: on)?$/, 'dark-mode-on'],
    [/^(?:turn off|disable)\s+dark mode$|^(?:turn on|enable|switch to|use)\s+light mode$|^light mode$/, 'dark-mode-off'],
    [/^toggle\s+(?:dark|light)\s+mode$/, 'dark-mode-toggle'],
    [/^empty(?:\s+the)?\s+(?:trash|bin|recycle bin)$/, 'empty-trash'],
    [/^(?:keep (?:my |the )?(?:mac|computer|screen) awake|caffeinate|don'?t (?:let (?:my )?mac )?sleep|stay awake)$/, 'caffeinate-on'],
    [/^(?:stop keeping (?:it |my mac |the mac )?awake|let (?:my |the )?mac sleep|stop caffeinate|decaffeinate)$/, 'caffeinate-off'],
    [/^unmute$/, 'unmute'],
    [/^(?:volume up|turn (?:it|the volume) up|louder|increase (?:the )?volume)$/, 'volume-up'],
    [/^(?:volume down|turn (?:it|the volume) down|quieter|lower (?:the )?volume|decrease (?:the )?volume)$/, 'volume-down']
  ];
  const sys = systemPhrases.find(([re]) => re.test(p));
  if (sys) return plan(sys[1].replace(/-/g, ' '), { description: `Run: ${sys[1].replace(/-/g, ' ')}`, action: 'system_command', command: sys[1] });

  // ── Clipboard history ──
  if (/^(?:show|open|view)?\s*(?:me\s+)?(?:my\s+)?clipboard(?:\s+history)?$|^what did i (?:just )?copy$/.test(p)) {
    return plan('Show clipboard history', { description: 'Show clipboard history', action: 'clipboard_show' });
  }
  if (/^(?:clear|delete|wipe)\s+(?:my\s+)?clipboard(?:\s+history)?$/.test(p)) {
    return plan('Clear clipboard history', { description: 'Clear clipboard history', action: 'clipboard_clear' });
  }

  // ── Snippets (keep original casing for the text) ──
  const saveSn = original.match(/^(?:save|create|add|make)\s+(?:a\s+)?snippet\s+(?:called\s+|named\s+)?["']?(.+?)["']?\s*(?::|=|\bas\b|\bwith text\b|\bsaying\b|\bthat says\b)\s*([\s\S]+)$/i);
  if (saveSn) {
    return plan(`Save snippet "${saveSn[1]}"`, { description: `Save snippet "${saveSn[1]}"`, action: 'snippet_save', name: saveSn[1].trim(), text: saveSn[2].trim() });
  }
  if (/^(?:show|list|open)\s+(?:my\s+|all\s+)?snippets$/.test(p) || p === 'snippets') {
    return plan('Show snippets', { description: 'Show snippets', action: 'snippet_list' });
  }
  const delSn = p.match(/^(?:delete|remove)\s+(?:the\s+)?(?:snippet\s+(.+)|(.+?)\s+snippet)$/);
  if (delSn) return plan('Delete snippet', { description: `Delete snippet "${delSn[1] || delSn[2]}"`, action: 'snippet_delete', name: (delSn[1] || delSn[2]).trim() });
  const pasteSn = p.match(/^(?:paste|insert|type|use)\s+(?:the\s+|my\s+)?(?:snippet\s+(.+)|(.+?)\s+snippet)$/);
  if (pasteSn) return plan('Paste snippet', { description: `Paste snippet "${pasteSn[1] || pasteSn[2]}"`, action: 'snippet_paste', name: (pasteSn[1] || pasteSn[2]).trim() });

  return null;
}

function tryFastPath(prompt) {
  let p = prompt.trim().toLowerCase();
  // Strip trailing punctuation (. ! ? , ;) from speech transcripts
  p = p.replace(/[.!?,\s]+$/, '').trim();
  // Strip quotes
  p = p.replace(/^["']|["']$/g, '').trim();
  // Strip leading polite words
  p = p.replace(/^(?:please|can you|could you)\s+/, '').trim();

  const featurePlan = tryFeaturePath(p, prompt.trim().replace(/^(?:please|can you|could you)\s+/i, '').replace(/[.!?\s]+$/, ''));
  if (featurePlan) return featurePlan;

  // 1. Open Google / Google search
  if (/^(open\s+)?google$/i.test(p) || /^go to google$/i.test(p) || /^can you open google$/i.test(p)) {
    return {
      summary: "Open Google in your current browser tab",
      steps: [
        { id: 1, description: "Navigate to Google in active tab", action: "browser_navigate", url: "https://www.google.com" },
        { id: 2, description: "Confirm opening Google", action: "speak", text: "Opening Google in your browser." }
      ]
    };
  }

  // 2. Search on Google
  const searchMatch = p.match(/^(?:search|google|search for)\s+(.+?)(?:\s+on google)?$/i);
  if (searchMatch && searchMatch[1]) {
    const query = searchMatch[1];
    return {
      summary: `Search "${query}" on Google`,
      steps: [
        { id: 1, description: `Search Google for "${query}"`, action: "browser_navigate", url: `https://www.google.com/search?q=${encodeURIComponent(query)}` },
        { id: 2, description: "Confirm search", action: "speak", text: `Searching for ${query}.` }
      ]
    };
  }

  // 3. Open YouTube
  if (/^(open\s+)?youtube$/i.test(p) || /^go to youtube$/i.test(p) || /^can you open youtube$/i.test(p)) {
    return {
      summary: "Open YouTube in your current browser tab",
      steps: [
        { id: 1, description: "Navigate to YouTube in active tab", action: "browser_navigate", url: "https://www.youtube.com" },
        { id: 2, description: "Confirm opening YouTube", action: "speak", text: "Opening YouTube in your browser." }
      ]
    };
  }

  // 4. Open ChatGPT and send a prompt / Open ChatGPT
  const chatGptSendMatch = prompt.match(/^open\s+chatgpt\s+and\s+(?:send|type|ask|prompt)\s+(.+)$/i);
  if (chatGptSendMatch && chatGptSendMatch[1]) {
    let textToSend = chatGptSendMatch[1].trim();
    textToSend = textToSend.replace(/^(?:a\s+)?prompt\s*[:\s-]*\s*/i, '').replace(/^["']|["']$/g, '');
    return {
      summary: `Open ChatGPT and send: "${textToSend}"`,
      steps: [
        { id: 1, description: "Navigate to ChatGPT in active tab", action: "browser_navigate", url: "https://chatgpt.com" },
        { id: 2, description: "Wait for ChatGPT interface to load", action: "browser_wait", durationMs: 2500 },
        { id: 3, description: `Send prompt to ChatGPT`, action: "browser_type", text: textToSend, pressEnter: true },
        { id: 4, description: "Confirm prompt sent", action: "speak", text: "Sent your prompt to ChatGPT." }
      ]
    };
  }
  if (/^(open\s+)?chatgpt$/i.test(p) || /^go to chatgpt$/i.test(p) || /^can you open chatgpt$/i.test(p)) {
    return {
      summary: "Open ChatGPT in your current browser tab",
      steps: [
        { id: 1, description: "Navigate to ChatGPT in active tab", action: "browser_navigate", url: "https://chatgpt.com" },
        { id: 2, description: "Confirm opening ChatGPT", action: "speak", text: "Opening ChatGPT." }
      ]
    };
  }

  // 5. Volume control
  const volMatch = p.match(/(?:set\s+)?volume\s+(?:to\s+)?(\d+)/i) || p.match(/turn\s+volume\s+(?:to\s+)?(\d+)/i);
  if (volMatch && volMatch[1]) {
    const pct = parseInt(volMatch[1], 10);
    return {
      summary: `Set volume to ${pct}%`,
      steps: [
        { id: 1, description: `Adjust volume to ${pct}%`, action: "system_volume", percent: pct },
        { id: 2, description: "Confirm volume", action: "speak", text: `Volume set to ${pct} percent.` }
      ]
    };
  }
  if (/^mute$/i.test(p) || /turn volume off/i.test(p)) {
    return {
      summary: "Mute system audio",
      steps: [
        { id: 1, description: "Mute audio", action: "system_volume", percent: 0 },
        { id: 2, description: "Confirm mute", action: "speak", text: "Muted audio." }
      ]
    };
  }

  // 5. Media control
  if (/^(play|resume)(?:\s+music)?$/i.test(p)) {
    return {
      summary: "Resume music playback",
      steps: [
        { id: 1, description: "Play music", action: "system_media", command: "play" },
        { id: 2, description: "Confirm playback", action: "speak", text: "Playing music." }
      ]
    };
  }
  if (/^pause(?:\s+music)?$/i.test(p) || /^stop music$/i.test(p)) {
    return {
      summary: "Pause music playback",
      steps: [
        { id: 1, description: "Pause music", action: "system_media", command: "pause" },
        { id: 2, description: "Confirm pause", action: "speak", text: "Music paused." }
      ]
    };
  }
  if (/^next(?:\s+song|\s+track)?$/i.test(p)) {
    return {
      summary: "Skip to next track",
      steps: [
        { id: 1, description: "Next track", action: "system_media", command: "next" },
        { id: 2, description: "Confirm next track", action: "speak", text: "Playing next track." }
      ]
    };
  }

  // 6. Universal App Open or Website Open
  const openMatch = p.match(/^(?:open|launch)\s+(.+)$/i);
  if (openMatch) {
    const target = openMatch[1].trim();
    const siteMap = {
      google: 'https://www.google.com',
      youtube: 'https://www.youtube.com',
      chatgpt: 'https://chatgpt.com',
      github: 'https://www.github.com',
      reddit: 'https://www.reddit.com',
      twitter: 'https://twitter.com',
      x: 'https://x.com',
      instagram: 'https://www.instagram.com',
      facebook: 'https://www.facebook.com',
      linkedin: 'https://www.linkedin.com',
      netflix: 'https://www.netflix.com',
      amazon: 'https://www.amazon.com'
    };

    if (siteMap[target]) {
      return {
        summary: `Open ${target} in your browser`,
        steps: [
          { id: 1, description: `Navigate to ${target}`, action: "browser_navigate", url: siteMap[target] },
          { id: 2, description: `Confirm opening ${target}`, action: "speak", text: `Opening ${target}.` }
        ]
      };
    }

    // App on macOS (Spotify, Slack, WhatsApp, VS Code, Discord, Notes, Terminal, etc.)
    return {
      summary: `Open ${target}`,
      steps: [
        { id: 1, description: `Launch ${target}`, action: "app_open", appName: target },
        { id: 2, description: "Confirm launch", action: "speak", text: `Opening ${target}.` }
      ]
    };
  }

  // 7. App Quit
  const quitMatch = p.match(/^(?:quit|close|exit)\s+(.+)$/i);
  if (quitMatch) {
    const target = quitMatch[1].trim();
    return {
      summary: `Quit ${target}`,
      steps: [
        { id: 1, description: `Quit ${target}`, action: "app_quit", appName: target },
        { id: 2, description: "Confirm quit", action: "speak", text: `Closed ${target}.` }
      ]
    };
  }

  // 8. Screenshot
  if (p.includes('screenshot') || p.includes('screen shot')) {
    return {
      summary: "Take a screenshot",
      steps: [
        { id: 1, description: "Capture screen", action: "system_screenshot" },
        { id: 2, description: "Confirm screenshot", action: "speak", text: "Screenshot captured." }
      ]
    };
  }

  return null;
}

async function planActions(userPrompt) {
  // 1. Check instant local fast-path (sub-millisecond, zero network risk)
  const fastPlan = tryFastPath(userPrompt);
  if (fastPlan) {
    return fastPlan;
  }

  if (!GEMINI_API_KEY) {
    throw new Error("GOOGLE_API_KEY is not set in .env");
  }

  let lastError = null;

  // 2. Loop through candidate models if high-demand (503) or rate-limit (429) occurs
  for (const modelName of CANDIDATE_MODELS) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: SYSTEM_INSTRUCTION },
            { text: `User command: "${userPrompt}"\nGenerate the action plan JSON now:` }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        // If 503 or 429, try next model
        if (response.status === 503 || response.status === 429) {
          console.warn(`Model ${modelName} returned ${response.status}, trying fallback model...`);
          lastError = new Error(`Gemini API error (${response.status}): ${errorText}`);
          continue;
        }
        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        continue;
      }

      let cleaned = rawText.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
      }

      return JSON.parse(cleaned);

    } catch (err) {
      lastError = err;
      if (err.message && (err.message.includes('503') || err.message.includes('429'))) {
        continue;
      }
    }
  }

  if (lastError) {
    console.warn('API error encountered, generating graceful fallback:', lastError.message);
    return {
      summary: `Process command: "${userPrompt}"`,
      steps: [
        { id: 1, description: "Notice: Gemini API daily free quota is temporarily exhausted", action: "speak", text: "Google Gemini free quota is temporarily exhausted for today. All desktop, app, and browser commands are working normally." }
      ]
    };
  }

  throw new Error("All Gemini models are currently unavailable.");
}

module.exports = { planActions };
