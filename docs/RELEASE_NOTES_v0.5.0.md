# DAXIL v0.5.0 Release Notes

Name your link conversions, send MP3s straight to your music folder, and DAXIL is back on the Mac.

## New

- **Name your conversions.** When you choose **Convert and save** (or click **GIF** in the link box), DAXIL now asks what to call the file before it downloads. Type a name and press Enter. Leave it blank to keep the usual `clip1`, `clip2`… name. You don't need to type the extension; if you do, DAXIL uses the right one anyway.
- **MP3 folder.** MP3s can now go to their own folder, for example your Spotify local files folder. Set it in **Settings → General → MP3 folder**, or click **Change…** right in the name step when MP3 is picked. Leave it empty and MP3s go to the Converted links folder, as before. MP4s and GIFs still save to the Converted links folder automatically. The MP3 folder also appears in **Settings → Storage**.
- **macOS download.** The Mac (Apple Silicon) build is back. 0.3.0 and 0.4.0 shipped without one.

## Changed

- **Converting a link no longer touches your project.** **Convert and save** downloads the link, saves the file and deletes the temporary download. Nothing is added to the media pool or the timeline. To edit a link, pick **Add to media pool**.
- No more "Delete downloaded clips?" prompt after a conversion, since nothing is left to clean up.
- Typing in the link dialog no longer triggers timeline shortcuts. Before, pressing T in the name field could add a text clip behind the dialog.

## Fixed

- **Clearer message for hidden X posts.** X hides posts marked sensitive, posts from private accounts and deleted posts from anyone who isn't signed in. DAXIL downloads without signing in, so these used to fail with "No video could be found in this tweet" even when the post had a video. DAXIL now says why.
- Error messages no longer start with "Error invoking remote method 'download:start': Error:". You see only the reason.
- The release build for macOS no longer fails at random while making the disk image.

## Privacy

No change. Your media never leaves your machine. Network activity is limited to fetching yt-dlp on first use, the links you paste, and the update check, which you can turn off in Settings.

## Upgrade Notes

- Windows installer and Linux AppImage copies of 0.4.0 update from inside the app. Older versions, the ZIP and tarball builds, and macOS need a manual download.
- Settings are kept. The new **MP3 folder** setting starts empty, so MP3s keep going where they went before until you pick a folder.
- Builds remain unsigned; see [INSTALLATION.md](INSTALLATION.md) for first-launch prompts.
