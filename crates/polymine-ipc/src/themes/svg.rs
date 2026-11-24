//! Whether a glyph SVG keeps to itself. An image fetches nothing, but the
//! webview can draw a broken-picture box for an `<image>` that points
//! elsewhere, and a `data:` URL holds a second file that no check reads. So
//! every link and every `url()` must name an `id` in the same file.
//!
//! The markup is read the way an XML parser reads it: tags, quoted attributes,
//! comments, CDATA sections, processing instructions, the five predefined
//! entities, and character references. DOCTYPEs are refused before this runs,
//! so no other entity can exist. CSS escapes are decoded wherever CSS can
//! appear, which is any attribute or text, so a `style` attribute, a `<style>`
//! element, and a presentation attribute such as `fill` are all covered.

use std::borrow::Cow;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Problem {
    /// Markup no XML parser accepts, so no viewer would draw it either.
    Malformed,
    /// A reference to something outside the file, as the player wrote it.
    Outside(String),
    /// Something else that can reach outside the file.
    Refused(&'static str),
}

/// The longest part of a reference an error message quotes.
const SHOWN_CHARS: usize = 40;

pub(super) fn check(svg: &str) -> Result<(), Problem> {
    // Every text node, joined. A `<style>` reads its text children as one,
    // past comments, CDATA, and child elements, so `u<g/>rl(` spells `url(`.
    let mut text = String::new();
    let mut rest = svg;
    while let Some(start) = rest.find('<') {
        text.push_str(&decode_entities(&rest[..start]));
        rest = &rest[start..];
        rest = if let Some(after) = rest.strip_prefix("<!--") {
            split_at(after, "-->")?.1
        } else if let Some(after) = rest.strip_prefix("<![CDATA[") {
            let (data, after) = split_at(after, "]]>")?;
            text.push_str(data);
            after
        } else if let Some(after) = rest.strip_prefix("<?") {
            let (body, after) = split_at(after, "?>")?;
            // The XML declaration is the one instruction allowed;
            // `<?xml-stylesheet?>` would load a file.
            let target = body.split(is_xml_space).next().unwrap_or_default();
            if !target.eq_ignore_ascii_case("xml") {
                return Err(Problem::Refused("a processing instruction"));
            }
            after
        } else if let Some(after) = rest.strip_prefix("</") {
            split_at(after, ">")?.1
        } else {
            check_tag(&rest[1..])?
        };
    }
    text.push_str(&decode_entities(rest));
    check_css(&text)
}

/// The text before `end` and the text after it.
fn split_at<'a>(text: &'a str, end: &str) -> Result<(&'a str, &'a str), Problem> {
    let at = text.find(end).ok_or(Problem::Malformed)?;
    Ok((&text[..at], &text[at + end.len()..]))
}

fn is_xml_space(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r')
}

/// Checks the attributes of the start tag that `tag` begins, just past its
/// `<`, and returns the text after the tag.
fn check_tag(tag: &str) -> Result<&str, Problem> {
    let ends_name = |c: char| is_xml_space(c) || matches!(c, '/' | '>' | '=');
    let name_end = tag.find(ends_name).ok_or(Problem::Malformed)?;
    if !tag[..name_end].starts_with(|c: char| c.is_alphabetic() || c == '_' || c == ':') {
        return Err(Problem::Malformed);
    }
    let mut rest = &tag[name_end..];
    loop {
        rest = rest.trim_start_matches(is_xml_space);
        if let Some(after) = rest.strip_prefix("/>").or_else(|| rest.strip_prefix('>')) {
            return Ok(after);
        }
        let name_end = rest.find(ends_name).ok_or(Problem::Malformed)?;
        let name = &rest[..name_end];
        if name.is_empty() {
            return Err(Problem::Malformed);
        }
        rest = rest[name_end..]
            .trim_start_matches(is_xml_space)
            .strip_prefix('=')
            .ok_or(Problem::Malformed)?
            .trim_start_matches(is_xml_space);
        let quote = rest
            .chars()
            .next()
            .filter(|&c| c == '"' || c == '\'')
            .ok_or(Problem::Malformed)?;
        let value_end = rest[1..].find(quote).ok_or(Problem::Malformed)? + 1;
        check_attribute(name, &decode_entities(&rest[1..value_end]))?;
        rest = &rest[value_end + 1..];
    }
}

fn check_attribute(name: &str, value: &str) -> Result<(), Problem> {
    // A namespace declaration names a namespace and never loads it.
    if name == "xmlns" || name.starts_with("xmlns:") {
        return Ok(());
    }
    if name.eq_ignore_ascii_case("xml:base") {
        return Err(Problem::Refused("xml:base"));
    }
    let local_name = local(name);
    let links = ["href", "src"]
        .iter()
        .any(|l| local_name.eq_ignore_ascii_case(l));
    if links && !is_local(value) {
        return Err(Problem::Outside(format!("{name}=\"{}\"", shown(value))));
    }
    // `<set attributeName="href" to="...">` sets a link no attribute shows.
    if local_name.eq_ignore_ascii_case("attributeName")
        && local(value.trim_matches(is_xml_space)).eq_ignore_ascii_case("href")
    {
        return Err(Problem::Refused("an animated link"));
    }
    check_css(value)
}

/// `name` without its namespace prefix.
fn local(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}

/// Whether a URL names a fragment of this file. A URL parser drops leading
/// spaces and control characters, and a fragment-only URL never leaves the
/// document.
fn is_local(url: &str) -> bool {
    url.trim_start_matches(|c: char| c <= ' ').starts_with('#')
}

/// `value` as an error message quotes it: trimmed, on one line, and short.
fn shown(value: &str) -> String {
    let value = value.trim_matches(|c: char| c <= ' ');
    let mut out: String = value
        .chars()
        .take(SHOWN_CHARS)
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    if value.chars().nth(SHOWN_CHARS).is_some() {
        out.push('…');
    }
    out
}

/// Refuses a `url()` that names anything but a fragment of this file, and the
/// CSS that loads a file without `url()`.
///
/// Comments stay in: one can split a name, as in `u/**/rl(`, but never join
/// one, so a `url(` in the raw text is the only kind CSS reads as a URL.
fn check_css(text: &str) -> Result<(), Problem> {
    let css = decode_css_escapes(text);
    let lower = css.to_ascii_lowercase();
    if lower.contains("@import") {
        return Err(Problem::Refused("@import"));
    }
    if lower.contains("image-set(") {
        return Err(Problem::Refused("image-set()"));
    }
    let mut from = 0;
    while let Some(at) = lower[from..].find("url(") {
        from += at + "url(".len();
        let arg = css[from..].trim_start_matches(|c: char| c.is_ascii_whitespace());
        let target = match arg.chars().next() {
            Some(quote @ ('"' | '\'')) => arg[1..].split(quote).next(),
            _ => arg.split(')').next(),
        }
        .unwrap_or_default();
        if !is_local(target) {
            return Err(Problem::Outside(format!("url({})", shown(target))));
        }
    }
    Ok(())
}

/// `text` with `&lt;`, `&gt;`, `&amp;`, `&quot;`, `&apos;`, and character
/// references decoded. Anything else stays as written: without a DOCTYPE, an
/// XML parser refuses it, so it can't hide a reference.
fn decode_entities(text: &str) -> Cow<'_, str> {
    if !text.contains('&') {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at + 1..];
        match entity(rest) {
            Some((c, len)) => {
                out.push(c);
                rest = &rest[len..];
            }
            None => out.push('&'),
        }
    }
    out.push_str(rest);
    Cow::Owned(out)
}

/// The character the reference at the start of `text`, just past its `&`,
/// stands for, and the length of the reference with its `;`.
fn entity(text: &str) -> Option<(char, usize)> {
    for (name, c) in [
        ("lt;", '<'),
        ("gt;", '>'),
        ("amp;", '&'),
        ("quot;", '"'),
        ("apos;", '\''),
    ] {
        if text.starts_with(name) {
            return Some((c, name.len()));
        }
    }
    let number = text.strip_prefix('#')?;
    let (digits, radix, prefix) = match number.strip_prefix('x') {
        Some(hex) => (hex, 16, 2),
        None => (number, 10, 1),
    };
    // XML allows any number of leading zeros.
    let len = digits
        .find(|c: char| !c.is_digit(radix))
        .unwrap_or(digits.len());
    if len == 0 || !digits[len..].starts_with(';') {
        return None;
    }
    let code = u32::from_str_radix(&digits[..len], radix).ok()?;
    Some((char::from_u32(code)?, prefix + len + 1))
}

/// `text` with CSS escapes decoded: a backslash and one to six hex digits,
/// with one optional space after them, or a backslash and any other
/// character. An escaped line break is dropped, as in a string.
fn decode_css_escapes(text: &str) -> Cow<'_, str> {
    if !text.contains('\\') {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        let mut code = 0u32;
        let mut digits = 0;
        while digits < 6 {
            let Some(digit) = chars.peek().and_then(|c| c.to_digit(16)) else {
                break;
            };
            code = code * 16 + digit;
            digits += 1;
            chars.next();
        }
        if digits == 0 {
            match chars.next() {
                Some('\n' | '\r' | '\x0c') | None => {}
                Some(next) => out.push(next),
            }
            continue;
        }
        out.push(
            char::from_u32(code)
                .filter(|&c| c != '\0')
                .unwrap_or('\u{fffd}'),
        );
        chars.next_if(char::is_ascii_whitespace);
    }
    Cow::Owned(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outside(svg: &str) -> String {
        match check(svg) {
            Err(Problem::Outside(reference)) => reference,
            other => panic!("{svg}: {other:?}"),
        }
    }

    #[test]
    fn refuses_links_outside_the_file() {
        for (svg, reference) in [
            (
                "<svg><image href='http://example.com/a.png'/></svg>",
                "href=\"http://example.com/a.png\"",
            ),
            ("<svg><image href=\"cat.png\"/></svg>", "href=\"cat.png\""),
            (
                "<svg><image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'/></svg>",
                "href=\"data:image/png;base64,iVBORw0KGgoAAAANSU…\"",
            ),
            (
                "<svg><use xlink:href='flag.svg#pole'/></svg>",
                "xlink:href=\"flag.svg#pole\"",
            ),
            (
                "<svg><filter><feImage href='/etc/x'/></filter></svg>",
                "href=\"/etc/x\"",
            ),
            ("<svg><a href=''/></svg>", "href=\"\""),
            ("<svg><a HREF='x.svg'/></svg>", "HREF=\"x.svg\""),
            ("<svg><html:img src='x.png'/></svg>", "src=\"x.png\""),
        ] {
            assert_eq!(outside(svg), reference, "{svg}");
        }
    }

    #[test]
    fn refuses_urls_outside_the_file() {
        for (svg, reference) in [
            (
                "<svg><path style='fill: url(file.svg#x)'/></svg>",
                "url(file.svg#x)",
            ),
            (
                "<svg><style>path { fill: URL( \"other.svg#g\" ) }</style></svg>",
                "url(other.svg#g)",
            ),
            (
                "<svg><style><![CDATA[a{mask:url('m.svg')}]]></style></svg>",
                "url(m.svg)",
            ),
            ("<svg><path fill='url(#a) url(b.svg)'/></svg>", "url(b.svg)"),
            ("<svg><g filter='url(x.svg#f)'/></svg>", "url(x.svg#f)"),
            ("<svg><g clip-path='url(c.svg)'/></svg>", "url(c.svg)"),
            (
                "<svg><path marker-end='url(m.svg#e)'/></svg>",
                "url(m.svg#e)",
            ),
            (
                "<svg><animate attributeName='fill' values='url(#a);url(b.svg)'/></svg>",
                "url(b.svg)",
            ),
        ] {
            assert_eq!(outside(svg), reference, "{svg}");
        }
    }

    #[test]
    fn sees_through_spacing_entities_and_escapes() {
        for svg in [
            "<svg><image\n  href\n=\n'cat.png'/></svg>",
            "<svg><image href=' \t\ncat.png'/></svg>",
            "<svg><image href='&#99;at.png'/></svg>",
            "<svg><image href='&#x0000063;at.png'/></svg>",
            "<svg><image href='&amp;#x23;a'/></svg>",
            "<svg><path style='fill: &#117;rl(x.svg)'/></svg>",
            "<svg><path style='fill: \\75 rl(x.svg)'/></svg>",
            "<svg><path style='fill: u\\rl(x.svg)'/></svg>",
            "<svg><path style='fill: url(\\78.svg)'/></svg>",
            "<svg><style>a{fill:url(x.svg)}</style></svg>",
            "<svg><style>a{content:'/*'}b{fill:url(x.svg)}/* */</style></svg>",
            "<svg><style>a{fill:u<!-- -->rl(x.svg)}</style></svg>",
            "<svg><style>a{fill:u<![CDATA[rl(]]>x.svg)}</style></svg>",
            "<svg><style>a{fill:u&#x72;<![CDATA[l]]>(x.svg)}</style></svg>",
            "<svg><style>a{fill:u<g/>rl(x.svg)}</style></svg>",
            "<svg><g fill=\"url('#a')\" stroke='url(x.svg)'/></svg>",
        ] {
            assert!(matches!(check(svg), Err(Problem::Outside(_))), "{svg}");
        }
    }

    #[test]
    fn refuses_other_ways_out_of_the_file() {
        for (svg, what) in [
            (
                "<?xml-stylesheet href='x.css'?><svg/>",
                "a processing instruction",
            ),
            ("<svg xml:base='http://example.com/'/>", "xml:base"),
            (
                "<svg><a href='#a'><set attributeName='href' to='x.svg'/></a></svg>",
                "an animated link",
            ),
            (
                "<svg><a><animate attributeName='xlink:href' values='x'/></a></svg>",
                "an animated link",
            ),
            ("<svg><style>@import 'x.css';</style></svg>", "@import"),
            (
                "<svg><style>a{fill:image-set('x.png' 1x)}</style></svg>",
                "image-set()",
            ),
        ] {
            assert_eq!(check(svg), Err(Problem::Refused(what)), "{svg}");
        }
    }

    #[test]
    fn allows_references_inside_the_file() {
        for svg in [
            "<svg/>",
            "<?xml version='1.0' encoding='UTF-8'?>\n<svg/>",
            "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'/>",
            "<svg><defs><g id='a'/></defs><use href='#a'/><use xlink:href=' #a'/></svg>",
            "<svg><path fill='url(#grad)' style='filter: url( \"#glow\" )'/></svg>",
            "<svg><style>.a { fill: url(#g) } /* glow */</style></svg>",
            "<svg><path fill='url(&#x23;g)' d='M0 0'/></svg>",
            "<svg><title>a &lt; b &amp;&amp; c > d</title><!-- <image href='x.png'/> --></svg>",
            "<svg><text>&nbsp; &#xZZ; & ;</text></svg>",
            "<svg><animate attributeName='fill' to='url(#a)'/></svg>",
            "<svg><g transform='translate(1 2)' data-x=\"it's > ok\"/></svg>",
        ] {
            assert_eq!(check(svg), Ok(()), "{svg}");
        }
    }

    #[test]
    fn refuses_markup_no_parser_reads() {
        for svg in [
            "<svg><image href=cat.png/></svg>",
            "<svg><image href/></svg>",
            "<svg><image href='cat.png/></svg>",
            "<svg><!-- open",
            "<svg><![CDATA[ open",
            "<svg><? open",
            "<svg><!ELEMENT x></svg>",
            "<svg>a < b</svg>",
            "<svg / >",
        ] {
            assert_eq!(check(svg), Err(Problem::Malformed), "{svg}");
        }
    }

    #[test]
    fn quotes_a_reference_on_one_short_line() {
        assert_eq!(shown(" a\nb "), "a b");
        assert_eq!(shown(&"x".repeat(SHOWN_CHARS)), "x".repeat(SHOWN_CHARS));
        assert_eq!(
            shown(&"x".repeat(SHOWN_CHARS + 1)),
            format!("{}…", "x".repeat(SHOWN_CHARS))
        );
    }
}
