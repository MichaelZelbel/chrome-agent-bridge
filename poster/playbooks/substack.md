# Substack

Status: **verified 2026-09-28** end to end by the first real post (job 022018d1, "My AI Spent
75 Days on SAP Customer Support") in profile E.

Publication: **`michaelzelbel.substack.com`** (account michael@zelbel.de).

Payload fields used: `headline` (title), `email_preview` (subtitle), `post_text` (body),
`email_subject` (only when it differs from the title; Substack uses the title as the subject by
default). `media_url` and `thumbnail_url` are ignored on Substack (section 3).

## 1. Open

`https://michaelzelbel.substack.com/publish/post?type=newsletter` opens a new draft in the
editor. Signed in: the snapshot shows the editor with `textbox "title"` and
`button "Michael Zelbel"` (the byline). Not signed in: a page with
`button "Sign in"` and no editor. Report `needs_manual` with "profile E is not signed in to
Substack" in that case; do not try to sign in.

## 2. Already posted?

Open `https://<publication>.substack.com/publish/posts` (the dashboard's Posts tab). A post with
the payload's title in the Published list from the last hour means an earlier attempt landed:
open it, read its URL from the address bar, report `posted` with that URL, stop. The Drafts list
may hold a half-finished draft from a dead attempt; reuse it rather than making a second one.

## 3. Controls

Opening the editor URL creates a draft at once: the address becomes
`/publish/post/<id>`. Open it once per job, never twice.

Substack's inputs are React-controlled: a value set by `fill-by-label` shows in the field but
React does not see it (on the sign-in page it answered "Please enter a valid email"). Use real
keystrokes: `pc_browser_type` (bridge `POST /type` with a CSS `selector`) or click, then
`pc_browser_type_text`.

- `textbox "title"` (placeholder "Title"): `headline`. The top of the page also carries a
  file-settings panel with `textbox "Add a title..."` and `textbox "Add a description..."`;
  those are the SEO title and description, not the post title. Use the one named "title".
- `textbox "Add a subtitle…"`: `email_preview`.
- `textbox "Start writing..."`: the body (ProseMirror). **Paste it, never type it.** Typing
  leaves a YouTube link as plain text, because Substack turns a link into an embedded player
  only on paste; typing a long body also outlasts the bridge's HTTP timeout. One
  `pc_browser_eval` dispatches a paste of the whole `post_text` into `.ProseMirror`:
  `new Promise(res=>{const pm=document.querySelector('.ProseMirror');pm.focus();`
  `const dt=new DataTransfer();dt.setData('text/plain',TEXT);`
  `pm.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));`
  `setTimeout(()=>res({children:Array.from(pm.children).map(e=>e.tagName+':'+e.className.slice(0,30)+':'+e.innerText.slice(0,60))}),5000)})`
  with TEXT as a JSON string literal of `post_text` (blank lines between paragraphs are right
  for a paste). Write no raw `
` escape sequences into the eval source by hand: the bridge
  then sees a broken string ("Invalid or unexpected token"); build the text with
  `JSON.stringify` or `String.fromCharCode(10)`. Check the result: a YouTube link on its own
  line must come back as `DIV:youtube-wrap`, the paragraphs as `P`. Verified 2026-09-28 on a
  scratch draft (deleted). Do not type Markdown symbols; `**` would show as characters.
  Substack curls straight quotes; that is expected.
- **No image.** Do not upload `thumbnail_url` or `media_url` into a Substack post. Planino
  freezes the project's video and thumbnail into every payload, but that is the project's
  media, not a request for a picture in the post; Michael wants the post as its text, with the
  YouTube link as the player (2026-09-28). The same goes for the settings panel's Thumbnail.
  (For reference: `button "Insert image"` opens a menu, Image, Gallery, Stock photos, Generate
  image, and `menuitem "Image"` is the file chooser.)
- Top bar: `button "Saved"` (autosave state), `button "Preview"`, `button "Continue"`.

## 4. Dialogues

1. `button "Continue"` (top right) opens `dialog "Publish"`: audience `radio "Everyone"`
   (checked), comments Everyone, `checkbox "Send via email and the Substack app"` (checked),
   `checkbox "Schedule time to email and publish"` (unchecked: leave it, Planino owns the
   timing), Scan for AI text (ignore), `button "Cancel"`, `button "Send to everyone now"`.
2. `button "Send to everyone now"` publishes and emails. The button turns into
   `button "Loading Publishing..."` for a few seconds.
3. The page then goes to `/publish/posts/detail/<id>/share-center`, NOT to the post. It holds
   one link `https://<publication>.substack.com/p/<slug>`: that is the live URL.

## 5. Read the URL back

The `a[href*="/p/"]` link on the share center after step 4.3 (`pc_browser_eval`), or the
Published list in step 2. Open it and check the title, the date and the last paragraph before
reporting that URL.

## 6. Cost baseline

2026-09-28, first run: 51 tool calls, 223 seconds, 1.04 USD, Claude Opus in Claude Code
(typing the body; pasting should cut both).

## Bridge notes

`pc_browser_eval` returns `{}` for a bare array; wrap results in an object
(`({links: [...]})`). The screenshot for the report is the bridge's `GET /screenshot` PNG;
it is too big to pass inline, so send the report through the poster API
(`$PLANINO_POSTER_URL/report`) with it base64-encoded.

## 7. Corrections

- 2026-09-28: profile E signed in to Substack (email code to michael@zelbel.de, read from
  Gmail). Publication subdomain filled in; editor control names replaced by the live snapshot;
  the React-input note added. The Posts dashboard is `/publish/posts` (tabs Published,
  Scheduled, Drafts). An empty test draft made while reading the editor was deleted.
- 2026-09-28, first real post: section 4 verified and rewritten (dialog controls, share-center
  landing page). Insert image opens a menu, not a file chooser. Long body typing outlasts the
  bridge timeout but finishes. Video media is not uploaded; the thumbnail goes on top.
- 2026-09-28, Michael after the first post: the picture on top was not asked for, and the
  YouTube link stayed plain text instead of a player. The body is now pasted (verified to
  embed the video) and no image is uploaded. The first post kept both faults.
