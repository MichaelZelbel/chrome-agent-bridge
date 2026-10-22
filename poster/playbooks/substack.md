# Substack

Status: **verified 2026-09-28** end to end by the first real post (job 022018d1, "My AI Spent
75 Days on SAP Customer Support") in a dedicated posting profile.

Publication: `<publication>` below is the subdomain of the claim's
`publish_destination.account_id` (`https://yourname.substack.com` gives `yourname`). One
person can have several publications (Michael: `michaelzelbel` in English,
`michaelzelbeldeutsch` in German), so the claim wins over `$SUBSTACK_PUBLICATION` from
poster.env, which is only the fallback when the claim carries no destination.

UI language follows the publication. On a German one the controls are: `textbox "title"`
(placeholder "Titel"), `textbox "Einen Untertitel hinzufügen …"`, body `textbox "Hier tippen …"`,
`button "Bild einfügen"` → `menuitem "Bild"`, `button "Weiter"`, `dialog "Veröffentlichen"`,
`button "Jetzt an alle senden"`. Same structure, same steps.

Payload fields used: `headline` (title), `email_preview` (subtitle), `post_text` (body),
`email_subject` (only when it differs from the title; Substack uses the title as the subject by
default), `media_url` and `thumbnail_url` exactly as given (section 3).

## 1. Open

`https://<publication>.substack.com/publish/post?type=newsletter` opens a new draft in the
editor. Signed in: the snapshot shows the editor with `textbox "title"` and
a button named after the writer (the byline). Not signed in: a page with
`button "Sign in"` and no editor. Report `needs_manual` with "the posting profile is not signed in to
Substack" in that case; do not try to sign in.

## 2. Already posted?

Open `https://<publication>.substack.com/publish/posts` (the dashboard's Posts tab). A post with
the payload's title in the Published list from the last hour means an earlier attempt landed:
open it, read its URL from the address bar, report `posted` with that URL, stop. The Drafts list
may hold a half-finished draft from a dead attempt; reuse it rather than making a second one.
Without clicking through tabs, from any signed-in page of the publication: `pc_browser_eval`
of `fetch("/api/v1/post_management/drafts?offset=0&limit=10&order_by=draft_updated_at&order_direction=desc")`
(both order parameters are required) lists drafts as `posts[]` with `id` and `draft_title`.

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
  **`post_text` with Markdown links or `> ` quote lines:** a plain-text paste leaves the
  brackets and `>` as characters. Put the same text on the paste as `text/html` as well
  (`dt.setData('text/html', HTML)` beside the `text/plain`): each blank-line paragraph a `<p>`,
  `[label](url)` an `<a href>`, a `> ` paragraph a `<blockquote><p>`. Same words, only the
  Markdown made real. Verified 2026-10-22 (job 4d12d29b): links and quote came back right.
  When the body already holds an image, put the caret in the last (empty) `P` before the paste
  so the text lands below the picture.
- **Media: exactly what the payload holds, nothing added, nothing dropped.** The payload is
  what the post's card in Planino shows (since 2026-09-28 Planino leaves out a thumbnail the
  card does not show). `media_url` set: put that file at the top of the post, a picture with
  `button "Insert image"` (it opens a MENU; `menuitem "Image"` is the file chooser; verified
  2026-10-22: click `.ProseMirror`, click `Insert image`, then `POST /upload-file
  {url: media_url, click: {role: "menuitem", name: "Image"}, filename}`; the body then holds
  `DIV:captioned-image-container` and an empty `P`. Do the image BEFORE pasting the text), a video
  with `button "Insert video"` (UNVERIFIED: first run to do it corrects this line).
  `media_url` empty: no picture, no video. `thumbnail_url` set: the settings panel's Thumbnail
  "Upload" (the social card), never into the body. Never decide on taste that a file does not
  belong; if the upload fails, report `needs_manual`, do not post without it.
- Top bar: `button "Saved"` (autosave state), `button "Preview"`, `button "Continue"`.

## 4. Dialogues

1. `button "Continue"` (top right) opens `dialog "Publish"`: audience `radio "Everyone"`
   (checked), comments Everyone, `checkbox "Send via email and the Substack app"` (checked),
   `checkbox "Schedule time to email and publish"` (unchecked: leave it, Planino owns the
   timing), Scan for AI text (ignore), `button "Cancel"`, `button "Send to everyone now"`.
2. `button "Send to everyone now"` publishes and emails. The button turns into
   `button "Loading Publishing..."` for a few seconds.
3. The page then goes to `/publish/posts/detail/<id>/share-center`, NOT to the post. It shows
   "Published at <time>" and a "View post" control, but since 2026-10-14 no `/p/` link.

## 5. Read the URL back

The public archive: `GET https://<publication>.substack.com/api/v1/archive?sort=new&limit=2`
(plain HTTP, no browser needed). The entry whose `id` equals the draft id from
`/publish/post/<id>` carries `canonical_url`, the live URL. Older pages may still show an
`a[href*="/p/"]` link on the share center; use it if present. The archive can lag a minute or
more after publishing (2026-10-22: still missing after 30 seconds). Then ask Substack from the
signed-in editor page: `pc_browser_eval` of `fetch("/api/v1/drafts/<id>").then(r=>r.json())`
gives `slug`, `is_published` and `post_date`; the URL is
`https://<publication>.substack.com/p/<slug>`. Open the URL and check the title
(the SECOND `h1`; the first is the publication name), the date and the last paragraph before
reporting it.

## 6. Cost baseline

2026-09-28, first run: 51 tool calls, 223 seconds, 1.04 USD, Claude Opus in Claude Code
(typing the body; pasting should cut both).
2026-10-14, job f7cf93c9: about 15 bridge and API calls, about 5 minutes, Claude Opus in
Claude Code over the bridge's HTTP API (body pasted).

## Bridge notes

`pc_browser_eval` returns `{}` for a bare array; wrap results in an object
(`({links: [...]})`). The screenshot for the report is the bridge's `GET /screenshot` PNG;
it is too big to pass inline, so send the report through the poster API
(`$PLANINO_POSTER_URL/report`) with it base64-encoded.

## 7. Corrections

- 2026-09-28: the posting profile signed in to Substack (Substack emails a code; entering
  it on the sign-in page works). Publication subdomain filled in; editor control names replaced by the live snapshot;
  the React-input note added. The Posts dashboard is `/publish/posts` (tabs Published,
  Scheduled, Drafts). An empty test draft made while reading the editor was deleted.
- 2026-09-28, first real post: section 4 verified and rewritten (dialog controls, share-center
  landing page). Insert image opens a menu, not a file chooser. Long body typing outlasts the
  bridge timeout but finishes. Video media is not uploaded; the thumbnail goes on top.
- 2026-09-28, the person after the first post: the picture on top was not asked for, and the
  YouTube link stayed plain text instead of a player. The body is now pasted (verified to
  embed the video) and no image is uploaded. The first post kept both faults.
- 2026-09-28, the person: "stick to what I put into Planino". The line "no image on Substack" was
  itself a taste decision and is gone. The rule is now the payload, exactly; Planino's side was
  fixed so the payload no longer carries a thumbnail the post's card hides.
- 2026-10-14, job f7cf93c9 ("My AI Can Make Phone Calls Now. I Won't Use It."): the share
  center no longer holds the `/p/` link; the live URL now comes from the public archive API
  (section 5). The live page has two `h1`s, publication name first. The claim now carries
  `publish_destination.account_id` (`https://michaelzelbel.substack.com`); the dashboard
  address and the byline confirm it before publishing. Paste, video embed and the Publish
  dialog matched the playbook exactly.
- 2026-10-22, job 4d12d29b ("Sorry, little guy. This hole is closed."): first image post.
  Image upload through the Insert image menu verified (section 3). The body carried Markdown
  links and a `> ` quote line, so it is now pasted as HTML too. The public archive lagged after
  publishing; the drafts API gives the slug (section 5). About 22 calls, 5 minutes.
- 2026-10-22, job 8528d1cb ("Tut mir leid, Kleiner. Das Loch ist zu."): first post to the
  German publication `michaelzelbeldeutsch`. The publication now comes from the claim's
  destination; the German control names are listed at the top. Drafts API parameters added
  (section 2). Image, HTML paste and drafts-API URL readback all matched. 13 calls, under 2 minutes.
