# Snapchat Spotlight

Status: **skeleton, UNVERIFIED.** Written 2026-09-07 from Snapchat's support pages before the
first supervised run: the web uploader at profile.snapchat.com takes videos only, to Spotlight
and to My Story, for a Public Profile. Every control name below is a guess to be replaced by
what the snapshot shows; the first AI to post through it rewrites this file.

Payload fields used: `media_url` (a vertical video, required), `post_text` (the caption).
`headline`, `first_comment`, `hashtags` and the email fields are not carried here.

## 1. Open

`https://profile.snapchat.com/` (Snapchat's Profile Manager). Signed in: the snapshot shows the
public profile's name and a `button "Upload"` or a drop area named "Choose video". Not signed in:
a sign-in form with `textbox "Username"`. Report `needs_manual` with "profile E is not signed in
to Snapchat" in that case; do not try to sign in.

## 2. Already posted?

Spotlight snaps do not show a public link at once; a post goes through review first. The
uploader's own list of recent uploads (the Spotlight tab of the profile manager) shows the last
uploads with their captions. A snap with this payload's caption uploaded in the last hour means
an earlier attempt landed: report `posted` with no URL and `error` "Spotlight shows the video
only after review; an upload with this caption is already in the list", stop.

## 3. Media

`pc_browser_upload_file` with `media_url`, `filename` keeping `.mp4`, and
`click: {role: "button", name: "Choose video"}` (the site opens its own file chooser). If the
snapshot shows a plain `input[type=file]` instead, use `selector: "input[type=file]"`.

## 4. Controls

- `textbox "Caption"` or "Add a description": `post_text`.
- Under "Send to", tick `checkbox "Spotlight Snaps"`. Leave "My Story" alone unless the playbook
  is told otherwise.
- The "allow others to remix" and "show on Public Profile" options: leave the defaults.

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
