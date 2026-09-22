const path = require('path');
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
   Parameters: { "action": "play" | "pause" | "next" | "previous" | "toggle" }
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

Rules:
- For web search commands ("Go to Google and search X", "Search X on Google"):
  Step 1: browser_navigate to "https://www.google.com"
  Step 2: browser_type query into "textarea[name='q'], input[name='q']" with pressEnter: true
  Step 3: browser_wait for 2000 ms to display results.
  Step 4: speak confirmation (e.g. "I've searched for X on Google for you.")
- For device commands:
  "Turn volume up/down to 50" -> system_volume { percent: 50 }, speak { text: "Volume set to 50 percent." }
  "Play music" -> system_media { action: "play" }, speak { text: "Resuming music." }
  "Pause music" -> system_media { action: "pause" }, speak { text: "Music paused." }
  "Open Spotify" -> app_open { appName: "Spotify" }, speak { text: "Opening Spotify." }
  "Close/Quit Slack" -> app_quit { appName: "Slack" }, speak { text: "Closed Slack." }
- Always include a final or intermediate "speak" step so Fuli verbally speaks back to the user!
- Return ONLY JSON. Do not wrap in markdown quotes if possible, or use standard \`\`\`json blocks.
`;

const CANDIDATE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

function tryFastPath(prompt) {
  const p = prompt.trim().toLowerCase();

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

  // 4. Volume control
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
        { id: 1, description: "Play music", action: "system_media", action: "play" },
        { id: 2, description: "Confirm playback", action: "speak", text: "Playing music." }
      ]
    };
  }
  if (/^pause(?:\s+music)?$/i.test(p) || /^stop music$/i.test(p)) {
    return {
      summary: "Pause music playback",
      steps: [
        { id: 1, description: "Pause music", action: "system_media", action: "pause" },
        { id: 2, description: "Confirm pause", action: "speak", text: "Music paused." }
      ]
    };
  }
  if (/^next(?:\s+song|\s+track)?$/i.test(p)) {
    return {
      summary: "Skip to next track",
      steps: [
        { id: 1, description: "Next track", action: "system_media", action: "next" },
        { id: 2, description: "Confirm next track", action: "speak", text: "Playing next track." }
      ]
    };
  }

  // 6. App Open
  const appOpenMatch = p.match(/^(?:open|launch)\s+(spotify|slack|discord|whatsapp|code|visual studio code|terminal|messages|notes|calculator|settings)$/i);
  if (appOpenMatch) {
    const app = appOpenMatch[1];
    return {
      summary: `Open ${app}`,
      steps: [
        { id: 1, description: `Launch ${app}`, action: "app_open", appName: app },
        { id: 2, description: "Confirm launch", action: "speak", text: `Opening ${app}.` }
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
      throw err;
    }
  }

  throw lastError || new Error("All Gemini models are currently unavailable.");
}

module.exports = { planActions };
