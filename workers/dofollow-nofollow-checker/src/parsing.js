export const TYPES = ["nofollow", "sponsored", "ugc"];
const HTML_ENTITIES = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " });
export function decodeHtmlEntities(value) {
  return String(value ?? "").replace(/&(#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/gi, (entity, name) => {
    if (name[0] === "#") {
      const hex = name[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return "�";
      return String.fromCodePoint(codePoint);
    }
    const key = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, key) ? HTML_ENTITIES[key] : entity;
  });
}
export function parseRel(rel) {
  return [...new Set(String(rel || "").toLowerCase().trim().split(/\s+/).filter(Boolean))];
}
export function linkTypes(rel) {
  const tags = parseRel(rel).filter(x => TYPES.includes(x));
  return tags.length ? tags : ["dofollow"];
}
export function normalizeHost(host) { return String(host || "").toLowerCase().replace(/^www\./, "").replace(/\.$/, ""); }
export function targetMatches(hostname, target) {
  const host = normalizeHost(hostname), wanted = normalizeHost(target);
  return !!wanted && (host === wanted || host.endsWith("." + wanted));
}
export function resolveLink(href, finalUrl, baseHref = null) {
  try {
    if (!href || /^(#|javascript:|mailto:|tel:|data:)/i.test(String(href).trim())) return null;
    const base = baseHref ? new URL(baseHref, finalUrl) : new URL(finalUrl);
    const resolved = new URL(href, base);
    return ["http:", "https:"].includes(resolved.protocol) ? resolved.href : null;
  } catch { return null; }
}
export function robotsNoFollow(html) {
  const re = /<meta\b[^>]*\bname\s*=\s*["']?(robots|googlebot)["']?[^>]*>/gi;
  let match;
  while ((match = re.exec(String(html)))) {
    const tag = match[0];
    const content = (tag.match(/\bcontent\s*=\s*(["'])(.*?)\1/i) || [,"",""])[2];
    if (content.toLowerCase().split(/[\s,]+/).some(x => x === "nofollow" || x === "none")) return true;
  }
  return false;
}
