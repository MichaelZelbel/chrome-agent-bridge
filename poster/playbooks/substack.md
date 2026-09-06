# Substack

Status: **skeleton, UNVERIFIED.** Written 2026-09-07 from Substack's public editor before the
first supervised run. Every control name below is a guess to be replaced by what the snapshot
actually shows; the first AI to post through it rewrites this file and dates the correction.

Payload fields used: `headline` (title), `email_preview` (subtitle), `post_text` (body),
`thumbnail_url` or `media_url` (an image at the top, optional), `email_subject` (only when it
differs from the title; Substack uses the title as the subject by default).

## 1. Open

`https://<publication>.substack.com/publish/post?type=newsletter` opens a new draft in the
editor of the publication this profile owns. Signed in: the snapshot shows the editor with a
`textbox "Title"` and the publication's name in the top bar. Not signed in: a page with
`button "Sign in"` and no editor. Report `needs_manual` with "profile E is not signed in to
Substack" in that case; do not try to sign in.

The publication's subdomain: read it from `https://substack.com/home` (the profile menu names
the publication) the first time and write it here.

## 2. Already posted?

Open `https://<publication>.substack.com/publish/posts` (the dashboard's Posts tab). A post with
the payload's title in the Published list from the last hour means an earlier attempt landed:
open it, read its URL from the address bar, report `posted` with that URL, stop. The Drafts list
may hold a half-finished draft from a dead attempt; reuse it rather than making a second one.

## 3. Controls

- `textbox "Title"`: `headline`. Fill with `pc_browser_fill_by_label` label "Title".
- `textbox "Add a subtitle…"` (placeholder text): `email_preview`. Fill by label with the
  placeholder, `exact: false`.
- The body is a rich text editor (role `textbox`, no label; ProseMirror). Click into it
  (`pc_browser_click_by_role` role "textbox", the one after the subtitle) and use
  `pc_browser_type` with `post_text`. Paragraph breaks: type Enter between paragraphs. Do not
  paste Markdown symbols; Substack renders plain paragraphs and `**` would show as characters.
- An image at the top (optional): the editor's toolbar `button "Image"` opens a file chooser;
  `pc_browser_upload_file` with `click: {role: "button", name: "Image"}` and the picture URL.

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

(none yet)
