// The strict XML parser of the Launchpad check kit (from z-korp/agent-card's round-1 checks): enough to
// tell whether a document an entry printed (an SVG, an XML feed) is well-formed and to read its elements
// and text. No DOCTYPE (so no entity expansion), no namespaces beyond names with a prefix. It parses
// text only, never runs anything. Node built-ins only.

const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const ENTITY = /^&(amp|lt|gt|quot|apos|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});/;

/** Whether a code point is an XML Char: tab, newline, carriage return, and no other control, surrogate, U+FFFE or U+FFFF. */
const xmlChar = (cp) => cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
// A character no XML document may contain, as is: the controls, a lone surrogate, U+FFFE, U+FFFF.
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Decodes the five XML entities and character references (only to characters XML allows). */
export function decode(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});/g, (_, e) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    if (!xmlChar(cp)) throw new Error(`character reference &${e}; is not a character XML allows`);
    return String.fromCodePoint(cp);
  });
}

/** Throws if raw text or an attribute value holds a bare `<` or an `&` that starts no entity. */
function checkRaw(s, where) {
  if (s.includes("<")) throw new Error(`unescaped < in ${where}`);
  for (let i = s.indexOf("&"); i !== -1; i = s.indexOf("&", i + 1)) {
    if (!ENTITY.test(s.slice(i, i + 12))) throw new Error(`unescaped & in ${where}`);
  }
}

/**
 * Parses a document into its root element, `{ name, attrs, children }`, where children are
 * elements or decoded text strings. Throws, with the offset, on anything that is not well-formed.
 */
export function parseXml(src) {
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const bad = NOT_XML.exec(src);
  if (bad) throw new Error(`U+${bad[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")} is not a character XML allows (at offset ${bad.index})`);
  const fail = (msg) => {
    throw new Error(`${msg} (at offset ${i})`);
  };
  const skip = (open, close, what) => {
    const end = src.indexOf(close, i + open.length);
    if (end < 0) fail(`unterminated ${what}`);
    i = end + close.length;
  };
  // Whitespace, comments and processing instructions before and after the root.
  const misc = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith("<?", i)) skip("<?", "?>", "processing instruction");
      else if (src.startsWith("<!--", i)) skip("<!--", "-->", "comment");
      else return;
    }
  };

  const element = (depth) => {
    if (depth > 64) fail("elements nested more than 64 deep");
    if (src[i] !== "<") fail("expected an element");
    i++;
    const m = NAME.exec(src.slice(i, i + 200));
    if (!m) fail("expected a tag name");
    const name = m[0];
    i += name.length;
    // No prototype: an attribute named __proto__ is stored like any other.
    const attrs = Object.create(null);
    for (;;) {
      const start = i;
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith("/>", i)) {
        i += 2;
        return { name, attrs, children: [] };
      }
      if (src[i] === ">") {
        i++;
        break;
      }
      if (i === start) fail(`expected whitespace, > or /> in <${name}>`);
      const a = NAME.exec(src.slice(i, i + 200));
      if (!a) fail(`bad attribute name in <${name}>`);
      i += a[0].length;
      const eq = /^\s*=\s*/.exec(src.slice(i, i + 50));
      if (!eq) fail(`attribute ${a[0]} of <${name}> has no value`);
      i += eq[0].length;
      const q = src[i];
      if (q !== '"' && q !== "'") fail(`attribute ${a[0]} of <${name}> is not quoted`);
      const end = src.indexOf(q, i + 1);
      if (end < 0) fail(`unterminated value of attribute ${a[0]}`);
      const raw = src.slice(i + 1, end);
      checkRaw(raw, `attribute ${a[0]} of <${name}>`);
      if (Object.hasOwn(attrs, a[0])) fail(`duplicate attribute ${a[0]} in <${name}>`);
      attrs[a[0]] = decode(raw);
      i = end + 1;
    }
    const children = [];
    for (;;) {
      if (i >= src.length) fail(`<${name}> is never closed`);
      if (src.startsWith("</", i)) {
        i += 2;
        const c = NAME.exec(src.slice(i, i + 200));
        if (!c || c[0] !== name) fail(`</${c ? c[0] : ""}> closes <${name}>`);
        i += c[0].length;
        while (i < src.length && /\s/.test(src[i])) i++;
        if (src[i] !== ">") fail(`bad closing tag </${name}>`);
        i++;
        return { name, attrs, children };
      }
      if (src.startsWith("<!--", i)) skip("<!--", "-->", "comment");
      else if (src.startsWith("<![CDATA[", i)) {
        const end = src.indexOf("]]>", i);
        if (end < 0) fail("unterminated CDATA section");
        children.push(src.slice(i + 9, end));
        i = end + 3;
      } else if (src.startsWith("<?", i)) skip("<?", "?>", "processing instruction");
      else if (src.startsWith("<!", i)) fail("a declaration inside an element");
      else if (src[i] === "<") children.push(element(depth + 1));
      else {
        const next = src.indexOf("<", i);
        const end = next < 0 ? src.length : next;
        const raw = src.slice(i, end);
        checkRaw(raw, `the text of <${name}>`);
        if (raw.includes("]]>")) fail(`]]> in the text of <${name}> (outside a CDATA section)`);
        children.push(decode(raw));
        i = end;
      }
    }
  };

  misc();
  if (src.startsWith("<!DOCTYPE", i) || src.startsWith("<!doctype", i)) fail("a DOCTYPE is not allowed");
  const root = element(0);
  misc();
  if (i !== src.length) fail("content after the root element");
  return root;
}

/** Every element of a tree, in document order. */
export function* walk(el) {
  yield el;
  for (const c of el.children) if (typeof c !== "string") yield* walk(c);
}

/** The text inside an element, its descendants' included. */
export const textOf = (el) => el.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");

/** An element's name without its prefix (`svg:text` is `text`). */
export const localName = (name) => name.slice(name.indexOf(":") + 1);
