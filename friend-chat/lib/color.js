// Стабильный цвет для каждого участника чата: один и тот же ник всегда
// даёт один и тот же цвет (простой хэш строки → оттенок HSL). Так проще
// с первого взгляда понять, кто написал сообщение, когда пишут несколько
// человек подряд.

// Эту область оттенков отдаём под акцентный зелёный "мои сообщения" —
// чужим сообщениям такой оттенок не присваиваем, чтобы не путать с собой.
const SIGNAL_HUE_RANGE = [140, 175];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function hueForName(name) {
  let hue = hashString(name || "") % 360;
  if (hue >= SIGNAL_HUE_RANGE[0] && hue <= SIGNAL_HUE_RANGE[1]) {
    hue = (hue + 45) % 360;
  }
  return hue;
}

// Яркий оттенок — для подписи имени и цветной полоски у бабла на тёмном фоне.
export function accentColorForName(name) {
  return `hsl(${hueForName(name)}, 68%, 62%)`;
}

// Более тёмный оттенок — для фона круглой аватарки, чтобы белые инициалы
// оставались читаемыми поверх него.
export function avatarColorForName(name) {
  return `hsl(${hueForName(name)}, 55%, 38%)`;
}

export function initialsForName(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return trimmed.slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
