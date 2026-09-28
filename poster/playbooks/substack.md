# Substack

Status: **verified 2026-09-28** end to end by the first real post (job 022018d1, "My AI Spent
75 Days on SAP Customer Support") in profile E.

Publication: **`michaelzelbel.substack.com`** (account michael@zelbel.de).

Payload fields used: `headline` (title), `email_preview` (subtitle), `post_text` (body),
`thumbnail_url` or `media_url` (an image at the top, optional), `email_subject` (only when it
differs from the title; Substack uses the title as the subject by default).

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
- `textbox "Start writing..."`: the body (ProseMirror). Click into it and type `post_text` in
  ONE `pc_browser_type_text` call with a single `\n` between paragraphs (each `\n` is an Enter,
  so the payload's blank lines must be collapsed or they become empty paragraphs). Do not type
  Markdown symbols; `**` would show as characters. A long body (~3,000 characters) outlasts the
  bridge's HTTP timeout: the call reports "Could not reach the Chrome Agent Bridge" while the
  laptop keeps typing. Do not retype; wait, then count `.ProseMirror p` until it stops growing
  and compare the text with the payload. Substack curls straight quotes; that is expected.
- An image (optional): put the cursor at the top first (`pc_browser_press "Control+Home"`),
  click toolbar `button "Insert image"`, which opens a MENU (Image, Gallery, Stock photos,
  Generate image), then `pc_browser_upload_file` with `click: {role: "menuitem", name: "Image"}`
  and the picture URL. A video `media_url` is not uploaded: the post body carries the YouTube
  link, and `thumbnail_url` is the picture on top. The settings panel also has a Thumbnail
  "Upload" (cropped to 3:2) for the social card; Substack fills the social card from the first
  image on its own.
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

2026-09-28, first run: about 30 tool calls and 5 minutes, Claude Opus in Claude Code.

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
