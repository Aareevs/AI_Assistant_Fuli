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
   Use when opening or directing the browser to a website. Always use fully qualified URLs (e.g. https://www.google.com).
   
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
   Use to launch an application on macOS via system command.
   
7. "system_open_url"
   Parameters: { "url": "https://..." }
   Use to open a URL in the default system browser (without autonomous control).
   
8. "speak"
   Parameters: { "text": "Spoken text" }
   Brief message to speak or display to the user.

Rules:
- For web search commands ("Go to Google and search X", "Search X on Google"):
  Step 1: browser_navigate to "https://www.google.com"
  Step 2: browser_type query into "textarea[name='q'], input[name='q']" with pressEnter: true
  Step 3: browser_wait for 2000 ms to display results.
- Keep steps crisp, reliable, and user-friendly.
- Return ONLY JSON. Do not wrap in markdown quotes if possible, or use standard \`\`\`json blocks.
`;

async function planActions(userPrompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GOOGLE_API_KEY is not set in .env");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;

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

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error("Received empty response from Gemini Action Planner");
  }

  // Parse JSON
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  const plan = JSON.parse(cleaned);
  return plan;
}

module.exports = { planActions };
