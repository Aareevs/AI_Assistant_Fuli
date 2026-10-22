# Fuli Privacy Policy

_Last updated: 22 October 2026_

Fuli is an open-source desktop assistant that runs on your own computer. There is no Fuli server and no Fuli account: **the developer does not receive, store or sell any of your data.**

## What Fuli does with your data

**Everything stays on your device**, except the requests Fuli sends directly from your computer to the services you choose to use (listed below).

| Data | Where it goes |
| :--- | :--- |
| Wake word and voice commands | Transcribed **locally** on your computer. Audio is not uploaded. |
| Clipboard history, snippets | Saved only in `~/.fuli` on your computer. |
| Google and Spotify logins | Stored only on your computer (`~/.fuli/google-token.json`, `~/.fuli/spotify-token.json`). Click **Disconnect** in Fuli to delete them. |
| Commands Fuli can't handle locally | Sent to Google's Gemini API using **your own** API key, only if you have set one. |
| Spoken replies | The text Fuli speaks is sent to Microsoft's text-to-speech service to create the voice. |

## Google user data

If you connect your Google account, Fuli requests these permissions:

- **Calendar** (`calendar.events`): to show your events, add events you ask for, and delete events you confirm.
- **Gmail** (`gmail.readonly`): to show your unread email and your latest email. Fuli can **only read** email; it cannot send, change or delete it.
- **YouTube** (`youtube.readonly`): to search for videos and list your playlists.
- **Name and email** (`openid`, `userinfo.email`, `userinfo.profile`): to show which account is connected.

Fuli accesses this data only when you ask it to, shows the result on your screen, and sends it nowhere except directly between your computer and Google's APIs. It is not shared with, or sold to, anyone, and it is not used for advertising or to train AI models.

Fuli's use of information received from Google APIs follows the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Your control

- Click **Disconnect** on the Google row in Fuli's Connectors panel to remove the login from your computer and revoke access.
- You can also remove Fuli at any time at <https://myaccount.google.com/permissions>.
- Deleting the `~/.fuli` folder removes everything Fuli has saved.

## Contact

Questions or concerns: open an issue at <https://github.com/Aareevs/AI_Assistant_Fuli/issues>.
