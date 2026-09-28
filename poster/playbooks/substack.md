# Substack

Status: **partly verified 2026-09-28** (sign-in, dashboard, editor controls read from the live
snapshot in profile E). The publish dialogues in section 4 are still unverified until the first
supervised post; the first AI to post through it rewrites them and dates the correction.

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
- `textbox "Start writing..."`: the body (ProseMirror). Click into it and type `post_text`,
  Enter between paragraphs. Do not type Markdown symbols; `**` would show as characters.
- An image (optional): toolbar `button "Insert image"`; `pc_browser_upload_file` with
  `click: {role: "button", name: "Insert image"}` and the picture URL. The settings panel also
  has a Thumbnail "Upload" (cropped to 3:2) for the social card.
- Top bar: `button "Saved"` (autosave state), `button "Preview"`, `button "Continue"`.

## 4. Dialogues

1. `button "Continue"` (top right) opens the publish settings: audience (Everyone), send as
   email (checked), post to web (checked).
2. `button "Send to everyone now"` publishes and emails. A wrong click on `button "Schedule"`
   would not publish at once: never use it, Planino owns the timing.
3. The confirmation shows the live post; the address bar changes to
   `https://<publication>.substack.com/p/<slug>`.

## 5. Read the URL back

The address bar after step 4.3, or `button "Share"` on the confirmation, or the Published list in
step 2. Report that URL.

## 6. Cost baseline

None yet. Record tool calls and minutes of the first successful run here.

## 7. Corrections

- 2026-09-28: profile E signed in to Substack (email code to michael@zelbel.de, read from
  Gmail). Publication subdomain filled in; editor control names replaced by the live snapshot;
  the React-input note added. The Posts dashboard is `/publish/posts` (tabs Published,
  Scheduled, Drafts). An empty test draft made while reading the editor was deleted.
