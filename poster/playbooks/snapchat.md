# Snapchat Spotlight

Status: **upload page verified 2026-09-22, no post made yet.** Sections 1, 3 and 4 name what the
signed-in page actually showed in a dedicated posting profile on 2026-09-22. Sections 2, 5 and 6 are still guesses
from the support pages; the first AI to post through it rewrites them.

Payload fields used: `media_url` (a vertical video, required), `post_text` (the caption).
`headline`, `first_comment`, `hashtags` and the email fields are not carried here.

## 1. Open

`https://my.snapchat.com/`. It forwards to `profile.snapchat.com/snap-posting-web` and then to
the profile's "Post to Snapchat" page. The bare `https://profile.snapchat.com/` front page only
offers the ads and business sign-up, so do not start there. Signed in: the snapshot shows
`button "Post to Snapchat New"` in the side bar and a `button "Drag & Drop or Upload File ..."`.
Not signed in: `heading "Log in to Snapchat"` with `textbox "Username or Email"`. Report
`needs_manual` with "the posting profile is not signed in to Snapchat" in that case; do not try to sign in.

## 2. Already posted?

Spotlight snaps do not show a public link at once; a post goes through review first. The
uploader's own list of recent uploads (the Spotlight tab of the profile manager) shows the last
uploads with their captions. A snap with this payload's caption uploaded in the last hour means
an earlier attempt landed: report `posted` with no URL and `error` "Spotlight shows the video
only after review; an upload with this caption is already in the list", stop.

## 3. Media

`pc_browser_upload_file` with `media_url`, `filename` keeping `.mp4`, and
`selector: "input[type=file]"`. The page has exactly one, accepting
`video/mp4,video/quicktime,video/webm,image/jpeg,image/png` (read 2026-09-22). The page allows
photo or video, 5 seconds to 5 minutes, at least 540x960.

## 4. Controls

Before a file is chosen the page shows three checkboxes and a disabled `button "Post"` and
`button "Schedule for Later"` (2026-09-22). The caption field appears only after upload; name it
here on the first run.

- Tick `checkbox "Post to Spotlight Reach millions of Snapchatters."`.
- Leave `checkbox "Post to Public Story ..."` and `checkbox "Save to a Public Profile Showcase
  your Snaps."` unticked unless the job says otherwise.
- The caption (appears after upload): `post_text`.

## 5. Dialogues

1. `button "Post"` (or "Post to Spotlight") submits. Wait for the progress to finish; a large
   video takes a minute.
2. The confirmation names the upload as pending review.

## 6. Read the URL back

None at once. Report `posted` with no `post_url` and `error` "Spotlight shows the video only
after review" so the row says why the link is empty. When a public URL exists later it looks
like `https://www.snapchat.com/spotlight/<id>` on the public profile; a later job may read it.

## 7. Cost baseline

None yet.

## 8. Corrections

(none yet)
