import {
  siX,
  siBluesky,
  siYoutube,
  siGithub,
  siDevdotto,
  siDailydotdev,
  siDiscord,
  siReddit,
  siInstagram,
  siThreads,
  siTiktok,
  siTwitch,
  siFacebook,
  siProducthunt,
  siRumble,
  siSoundcloud,
  siMixcloud,
  siSpotify,
  siBandcamp,
  siWordpress,
  siSubstack,
  siMedium,
  siHashnode,
  siPeerlist,
  siGitlab,
  siStackoverflow,
  siPatreon,
  siKofi,
  siTelegram,
} from 'simple-icons';

// LinkedIn was removed from simple-icons (legal); use the standard mark.
const LINKEDIN_PATH =
  'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z';

// SOW-129: a generic globe (Material "public") for a personal website link, since no brand icon applies.
// Kept verbatim with client-ui/src/social-icons.mjs.
const WEBSITE_PATH =
  'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z';

/** GBTI social links — real URLs from the live site, with simple-icons SVG paths. */
export const SOCIAL_LINKS = [
  { label: 'X', href: 'https://x.com/gbti_network', path: siX.path },
  { label: 'Bluesky', href: 'https://bsky.app/profile/gbti.bsky.social', path: siBluesky.path },
  { label: 'YouTube', href: 'https://www.youtube.com/@gbti_network', path: siYoutube.path },
  { label: 'GitHub', href: 'https://github.com/gbti-network', path: siGithub.path },
  { label: 'Dev.to', href: 'https://dev.to/gbti', path: siDevdotto.path },
  { label: 'Hashnode', href: 'https://gbti.hashnode.dev/', path: siHashnode.path }, // sow-132: the GBTI publication

  { label: 'Daily.dev', href: 'https://daily.dev/squads/gbti_network/', path: siDailydotdev.path },
  { label: 'Discord', href: '/membership/', path: siDiscord.path },
  { label: 'Reddit', href: 'https://www.reddit.com/r/GBTI_network', path: siReddit.path },
  // sow-159: Mastodon retired (2026-07-28, fediverse turn-away). The GBTI footer link is removed.
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/gbti-network/posts', path: LINKEDIN_PATH },
];

export const GITHUB_ICON_PATH = siGithub.path;

/** Map a profile social key (content-schemas.md) to a simple-icons path, for member/profile rows. */
export const ICON_PATHS: Record<string, string> = {
  github: siGithub.path,
  website: WEBSITE_PATH,
  x: siX.path,
  bluesky: siBluesky.path,
  youtube: siYoutube.path,
  devto: siDevdotto.path,
  reddit: siReddit.path,
  // sow-159: Mastodon retired: no icon mapping, so a member's stored mastodon handle no longer renders on
  // profiles or member cards. The value stays inert in profile.md (owner elected to leave, not scrub).
  linkedin: LINKEDIN_PATH,
  discord: siDiscord.path,
  // SOW-129: the comprehensive set.
  instagram: siInstagram.path,
  threads: siThreads.path,
  tiktok: siTiktok.path,
  twitch: siTwitch.path,
  facebook: siFacebook.path,
  dailydev: siDailydotdev.path,
  producthunt: siProducthunt.path,
  rumble: siRumble.path,
  // SOW-131: audio, publishing, dev, and creator platforms.
  soundcloud: siSoundcloud.path,
  mixcloud: siMixcloud.path,
  spotify: siSpotify.path,
  bandcamp: siBandcamp.path,
  wordpress: siWordpress.path,
  substack: siSubstack.path,
  medium: siMedium.path,
  hashnode: siHashnode.path,
  peerlist: siPeerlist.path,
  gitlab: siGitlab.path,
  stackoverflow: siStackoverflow.path,
  patreon: siPatreon.path,
  kofi: siKofi.path,
  telegram: siTelegram.path,
};
