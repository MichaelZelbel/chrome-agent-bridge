# Snapchat Spotlight

Status: **upload controls verified 2026-10-11; this web route rejected the publication attempt.**
The signed-in uploader and validation below were observed in the dedicated posting profile.
Successful publication confirmation remains unverified.

Michael wants regular organic posts from his existing personal Snapchat account. Do not
create a business or ad account, change billing, start ads, or accept new account terms.
The refusal recorded below is evidence that this web route failed, not evidence that an
ordinary creator must create a business or ad account to post.

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
- Select the intended public profile in Spotlight's profile picker. The current account is
  Michael Zelbel. Verify it is selected; checking Spotlight alone is insufficient. On
  2026-10-11, Post without this selection produced "Select 1 to 5 profiles". Selecting the
  matching combobox option with ArrowDown then Enter resolved that validation. The combobox
  had no accessible label or name; it was the only combobox after Save was unticked. A visible
  Michael Zelbel selection and selected option confirmed it. Clicking the virtual option
  directly timed out.
- Leave `checkbox "Post to Public Story ..."` and `checkbox "Save to a Public Profile Showcase
  your Snaps."` unticked unless the job says otherwise.
  Recheck after attachment: the uploader automatically ticked Save on 2026-10-11.
- The caption field's exact accessible label is `Add a description and #topics`; fill it with
  `post_text`. It was available before attachment on 2026-10-11.

## 5. Dialogues

1. `button "Post"` (or "Post to Spotlight") submits. Wait for the progress to finish; a large
   video takes a minute.
2. The confirmation names the upload as pending review.

The confirmation above has not yet been observed. On 2026-10-11, after the required profile
selection was corrected, Post and Schedule temporarily became disabled and then enabled
again, with no success message or visible error. The profile's Live Spotlights list still
showed 16 September as its newest entry. Those UI observations alone did not establish
whether publication failed or was pending. For a future ambiguous attempt, report
`needs_manual` with the uncertain outcome and do not submit again without verification.

Later read-only inspection established the actual error for that attempt: Snapchat's retained
Apollo mutation store held `PostProfileMediaMutation`, field `postProfileMedia`, loading false,
with `PERMISSION_DENIED: Organization not spend ready`. Its GraphQL extensions identified
`UPSTREAM_CLIENT_ERROR`, upstream `PERMISSION_DENIED`, service `ads-gateway`, request
`b2c224eb-5aa7-4ad6-9942-86305fd193ee`. HTTP 200 alone did not mean publication succeeded.
The retained profileSpotlights result included only 16, 14 and 11 September, with
hasNextPage false; even its SUBMITTED entries were old. This verifies rejection of that
attempt through the profile-manager web route.

That organization's cached fields were ACTIVE, type PROVISIONAL, trustCode T100, adAccount
null; the public profile nevertheless allowed POST_TO_SPOTLIGHT. Action Needed opened only a
tooltip asking for a profile image, hero image and bio. It did not diagnose the readiness
rejection. The precise cause of the readiness refusal was not established. These cached
fields do not establish a requirement for business setup, billing or payment for ordinary
organic posting. Report the exact refusal as a failure of this route and retain the post for
recovery through the existing personal account. Do not redirect recovery into account setup.

Historical setup inspection, 2026-10-11: the Open a Business Account button opened an
"Open a Business Account on Snap" modal. It explicitly creates a business account for ads,
with Confirm Business Name, Confirm Business email address, Add country, Add currency and
Phone number fields, a "Connect this Profile to your new Ad Account" checkbox, and optional
promotional-call/SMS consent. Its Create a Business button accepts the Terms of Service and
Business Services Terms on the business's behalf. Nothing was entered or submitted during
review, and the unfilled modal was subsequently cancelled. The defaults shown were United
States and USD. Michael explicitly rejected this business/ad-account route; these observations
are historical evidence only and are not a recovery procedure or a request for setup approval.

During that inspection, the consumer https://www.snapchat.com/spotlight feed had no
upload/create control, and its
Log In link led to Web chat. Web chat loaded the existing account without new credentials,
but returning to the consumer Spotlight feed still showed Log In and no uploader. No
alternate publisher was verified. The current official web-upload instructions at
https://help.snapchat.com/hc/en-us/articles/7012293789972-How-do-I-submit-a-Snap-to-Spotlight-from-the-web
direct users to profile.snapchat.com, the same profile-manager route used here.

## 6. Read the URL back

None at once. Report `posted` with no `post_url` and `error` "Spotlight shows the video only
after review" so the row says why the link is empty. When a public URL exists later it looks
like `https://www.snapchat.com/spotlight/<id>` on the public profile; a later job may read it.

## 7. Cost baseline

None yet.

## 8. Corrections

- 2026-10-11: Bridge v0.6.0 sets the local disk file through same-host CDP;
  the old 50 MB handoff restriction below no longer applies. The original
  193,115,257-byte video crossed the bridge successfully. Snapchat then spent
  time processing it, during which snapshots and screenshots timed out.
  A separate 41,794,284-byte posting copy also made the page temporarily
  unresponsive after attachment. Without another attachment or restart, the
  page recovered roughly two minutes later: both video previews reported
  244.2 seconds, 1080x1920 and readyState 4, and Post was enabled. A timeout
  immediately after a successful attachment is not proof of a crash or a
  rejected file. Allow processing time and re-read the page before restarting
  Chrome or attaching the file again. These checks did not press Post.
- 2026-10-06: `my.snapchat.com` now lands on `.../profiles/<id>/web-uploader`; the snapshot is
  empty for about ten seconds while it loads, so wait before reading it. Section 1's controls
  were all there. `pc_browser_upload_file` refuses files over 50 MB ("Cannot transfer files
  larger than 50Mb to a browser not co-located with the server"), and a 193 MB video pushed into
  the page in pieces and set on the input with a DataTransfer crashed the tab. Until the bridge
  sets large files from its own disk (CDP `DOM.setFileInputFiles` with the temp path), a video
  over 50 MB cannot go in.
- 2026-10-06 (second run): report a video over 50 MB as `needs_manual`, not `failed`. `failed`
  requeues the job and every attempt hits the same limit; check the size with a HEAD request on
  `media_url` before opening the page.
