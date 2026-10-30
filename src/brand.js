// Product identity in one place so a rename never misses a spot.
const APP_NAME = 'DIY MC Hosting By M.N.Ikmal';
const SHORT_NAME = 'DIY MC Hosting';
const AUTHOR = 'M.N.Ikmal';
const LOG_PREFIX = `[${SHORT_NAME}]`;

function joinMessageText(version) {
  return `Thanks for using ${SHORT_NAME} and just a reminder this system version ${version} is still under early development ~ ${AUTHOR}`;
}

// Server list MOTDs that MCHost/DIY MC Hosting shipped as defaults. A saved MOTD that
// matches one of these was never customized, so it is safe to upgrade automatically.
const LEGACY_DEFAULT_MOTDS = [
  'Welcome to My Server!',
  'A Minecraft Server hosted with MCHost',
  'A Minecraft Server hosted with DIY MC Hosting',
];
const DEFAULT_MOTD_PATTERN = /^Thanks for using DIY MC Hosting and just a reminder this system version \S+ is still under early development ~ M\.N\.Ikmal$/;

function isDefaultMotd(motd) {
  return !motd || LEGACY_DEFAULT_MOTDS.includes(motd) || DEFAULT_MOTD_PATTERN.test(motd);
}

// Chat component for /tellraw. Every list entry is an object (never a bare string)
// so it parses both as JSON (older versions) and as SNBT (1.21.5+).
function joinMessageComponent(version) {
  return JSON.stringify({
    text: 'Thanks for using ',
    color: 'gray',
    extra: [
      { text: SHORT_NAME, color: 'green', bold: true },
      { text: ' and just a reminder this system version ', color: 'gray' },
      { text: version, color: 'yellow' },
      { text: ' is still under early development ~ ', color: 'gray' },
      { text: AUTHOR, color: 'aqua' },
    ],
  });
}

module.exports = { APP_NAME, SHORT_NAME, AUTHOR, LOG_PREFIX, joinMessageText, joinMessageComponent, isDefaultMotd };
