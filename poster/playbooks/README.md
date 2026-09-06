# Playbooks

One file per platform, the written procedure an AI follows to post there through a logged-in
Chrome and the Chrome Agent Bridge. A playbook is not a script: the AI reads the page through
the accessibility snapshot after every action and adapts when the page differs, then corrects
the playbook so the next run does not have to rediscover it.

## Sections every playbook has

1. **Open**: the URL of the composer, and how to tell the profile is signed in (what the
   snapshot shows when it is, and when it is not).
2. **Already posted?**: where to look for the same post live from the last hour, and how to
   read its URL, so a job whose earlier attempt died after the publish click is not posted twice.
3. **Controls**: each field by its accessible name as `pc_browser_snapshot` shows it (role and
   name), and which payload field goes into it. Note fields that need `pc_browser_type` rather
   than `pc_browser_fill_by_label` (rich text editors).
4. **Media**: how the file gets in, with the exact `pc_browser_upload_file` call that worked
   (label, selector, or the control to click).
5. **Dialogues**: the publish flow, one dialogue per line, in order, with the exact button
   names, and the places where a wrong click publishes early.
6. **Read the URL back**: where the live URL appears and how to read it (address bar, a link in
   the confirmation, the profile page).
7. **Cost baseline**: tool calls and minutes of the last successful run, so a run twice as long
   is noticed.
8. **Corrections**: dated lines, newest last, in the form
   `2026-09-12: the Publish button is now named "Send now"; step 5 updated.`

## Reading pages cheaply

Use `pc_browser_snapshot` (the accessibility tree) to see what is on a page. Do not use
`pc_browser_read` (full page text) unless the snapshot cannot answer the question, and take one
`pc_browser_screenshot` at the end, for the report. The tree is small; the page text is not, and
everything read stays in the conversation.

## Writing a new one

Post once by hand through the bridge from an AI session, with the person watching, and write
down what happened. Keep the payload's field names (`headline`, `post_text`, `email_subject`,
`email_preview`, `first_comment`, `media_url`, `thumbnail_url`) so the mapping is unambiguous.
