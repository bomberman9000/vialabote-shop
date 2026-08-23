/** @type {import('next').NextConfig} */
const nextConfig = {
  // Все <Image src> в приложении — локальные пути (/uploads/media/... от
  // LocalMediaStorage, /images/... статические ассеты). Внешние хосты и SVG
  // через next/image не используются нигде — remotePatterns/dangerouslyAllowSVG
  // были избыточно разрешающими (wildcard "**" превращал image optimizer в
  // открытый прокси для произвольных внешних URL, если бы такой путь когда-
  // нибудь появился). Убраны, а не оставлены "на будущее".
};

module.exports = nextConfig;
