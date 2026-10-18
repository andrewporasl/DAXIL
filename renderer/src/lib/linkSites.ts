// Popular sites the link box handles through yt-dlp. It's a sample, not a whitelist:
// anything yt-dlp can read works (1,000+ sites).
export const LINK_SITE_GROUPS: Array<{ label: string; sites: string[] }> = [
  { label: 'Video & social', sites: ['YouTube', 'TikTok', 'Instagram', 'X / Twitter', 'Facebook', 'Reddit', 'Twitch clips', 'Vimeo', 'Bluesky', 'Threads', 'Dailymotion', 'Bilibili'] },
  { label: 'Music & audio', sites: ['SoundCloud', 'Bandcamp', 'Mixcloud', 'Audiomack'] }
]

export const LINK_SITE_EXAMPLES = 'YouTube, TikTok, SoundCloud'
