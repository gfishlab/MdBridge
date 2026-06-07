use comrak::nodes::{AstNode, NodeValue};
use comrak::{parse_document, Arena, Options};

pub fn parse_markdown<'a>(arena: &'a Arena<AstNode<'a>>, content: &str) -> &'a AstNode<'a> {
    let mut options = Options::default();
    options.extension.table = true;
    options.extension.strikethrough = true;
    options.extension.autolink = true;
    options.extension.tasklist = true;
    options.extension.header_ids = Some("".to_string());
    let processed = preprocess_cjk_emphasis(content);
    parse_document(arena, &processed, &options)
}

/// 判断字符是否为 CJK / 全角标点。
/// CommonMark 的 flanking 规则在此类标点紧邻强调定界符(* _)时会判定失败，
/// 导致中文加粗/斜体语法不生效（见 commonmark-spec#650）。
fn is_cjk_punct(c: char) -> bool {
    matches!(c,
        '\u{3000}'..='\u{303F}'   // CJK 符号和标点： 。、〈〉《》「」『』【】…—
        | '\u{FF01}'..='\u{FF0F}' // 全角 ！＂＃＄％＆＇（）＊＋，－．／
        | '\u{FF1A}'..='\u{FF20}' // 全角 ：；＜＝＞？＠
        | '\u{FF3B}'..='\u{FF40}' // 全角 ［＼］＾＿｀
        | '\u{FF5B}'..='\u{FF65}' // 全角 ｛｜｝～｟｠､｡
        | '\u{2018}' | '\u{2019}' | '\u{201C}' | '\u{201D}' // 弯引号 ‘’“”
        | '\u{2014}' | '\u{2026}' // — …
    )
}

fn is_emphasis_delim(c: char) -> bool {
    c == '*' || c == '_'
}

fn is_any_punct(c: char) -> bool {
    c.is_ascii_punctuation() || is_cjk_punct(c)
}

/// 在 CJK 标点与强调定界符(* _)相邻处插入零宽空格(U+200B)，
/// 使 CommonMark 能正确识别中文环境下的加粗/斜体。
/// 零宽空格不可见，且会跳过代码围栏(``` / ~~~)与行内代码(`)以免污染代码。
fn preprocess_cjk_emphasis(content: &str) -> String {
    const ZWSP: char = '\u{200B}';
    let mut out = String::with_capacity(content.len() + 32);
    let mut in_fence = false;

    for line in content.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            out.push_str(line);
            continue;
        }
        if in_fence {
            out.push_str(line);
            continue;
        }

        let chars: Vec<char> = line.chars().collect();
        let n = chars.len();
        let mut i = 0;
        let mut in_inline_code = false;
        while i < n {
            let c = chars[i];
            if c == '`' {
                // 反引号切换行内代码状态，代码内不处理
                in_inline_code = !in_inline_code;
                out.push(c);
                i += 1;
                continue;
            }
            if !in_inline_code && is_emphasis_delim(c) {
                // 收集连续的同类定界符（** *** 等）
                let start = i;
                let delim = c;
                while i < n && chars[i] == delim {
                    i += 1;
                }
                let before = if start > 0 { Some(chars[start - 1]) } else { None };
                let after = if i < n { Some(chars[i]) } else { None };

                // 仅当定界符“外侧”是普通字符（非空白、非标点）时才需要补救：
                // 这正是 CommonMark flanking 判定失败的条件，避免无谓地到处插入零宽空格。
                let outside_is_normal = |c: char| !c.is_whitespace() && !is_any_punct(c);

                let need_before = before.map(is_cjk_punct).unwrap_or(false)
                    && after.map(outside_is_normal).unwrap_or(false);
                let need_after = after.map(is_cjk_punct).unwrap_or(false)
                    && before.map(outside_is_normal).unwrap_or(false);

                if need_before {
                    out.push(ZWSP);
                }
                for ch in &chars[start..i] {
                    out.push(*ch);
                }
                if need_after {
                    out.push(ZWSP);
                }
                continue;
            }
            out.push(c);
            i += 1;
        }
    }
    out
}

pub fn walk_nodes<'a, F>(node: &'a AstNode<'a>, callback: &mut F)
where
    F: FnMut(&'a AstNode<'a>),
{
    callback(node);
    for child in node.children() {
        walk_nodes(child, callback);
    }
}

pub fn extract_image_urls<'a>(node: &'a AstNode<'a>) -> Vec<String> {
    let mut urls = Vec::new();
    walk_nodes(node, &mut |n| {
        if let NodeValue::Image(ref image) = n.data.borrow().value {
            urls.push(image.url.clone());
        }
    });
    urls
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_heading() {
        let md = "# Hello World";
        let arena = comrak::Arena::new();
        let doc = parse_markdown(&arena, md);
        let mut found = false;
        walk_nodes(doc, &mut |node| {
            if let comrak::nodes::NodeValue::Heading(_) = node.data.borrow().value {
                found = true;
            }
        });
        assert!(found, "Should find heading node");
    }

    #[test]
    fn test_parse_paragraph() {
        let md = "Hello world";
        let arena = comrak::Arena::new();
        let doc = parse_markdown(&arena, md);
        let mut found = false;
        walk_nodes(doc, &mut |node| {
            if let comrak::nodes::NodeValue::Paragraph = node.data.borrow().value {
                found = true;
            }
        });
        assert!(found, "Should find paragraph node");
    }

    #[test]
    fn test_parse_code_block() {
        let md = "```rust\nfn main() {}\n```";
        let arena = comrak::Arena::new();
        let doc = parse_markdown(&arena, md);
        let mut found = false;
        walk_nodes(doc, &mut |node| {
            if let comrak::nodes::NodeValue::CodeBlock(_) = node.data.borrow().value {
                found = true;
            }
        });
        assert!(found, "Should find code block node");
    }

    #[test]
    fn test_parse_image() {
        let md = "![alt](https://example.com/img.png)";
        let arena = comrak::Arena::new();
        let doc = parse_markdown(&arena, md);
        let mut found = false;
        walk_nodes(doc, &mut |node| {
            if let comrak::nodes::NodeValue::Image(_) = node.data.borrow().value {
                found = true;
            }
        });
        assert!(found, "Should find image node");
    }

    #[test]
    fn test_parse_table() {
        let md = "| a | b |\n|---|---|\n| 1 | 2 |";
        let arena = comrak::Arena::new();
        let doc = parse_markdown(&arena, md);
        let mut found = false;
        walk_nodes(doc, &mut |node| {
            if let comrak::nodes::NodeValue::Table(_) = node.data.borrow().value {
                found = true;
            }
        });
        assert!(found, "Should find table node");
    }

    #[test]
    fn test_extract_image_urls() {
        let md = "![img1](https://a.com/1.png)\nSome text\n![img2](https://b.com/2.png)";
        let arena = comrak::Arena::new();
        let doc = parse_markdown(&arena, md);
        let urls = extract_image_urls(doc);
        assert_eq!(urls.len(), 2);
        assert_eq!(urls[0], "https://a.com/1.png");
        assert_eq!(urls[1], "https://b.com/2.png");
    }

    fn html_of(md: &str) -> String {
        use crate::converter::html::ast_to_html;
        let arena = comrak::Arena::new();
        ast_to_html(parse_markdown(&arena, md))
    }

    #[test]
    fn test_cjk_bold_with_fullwidth_paren() {
        // 结尾 ** 前是全角 ）、后是中文 —— 原本 CommonMark 无法识别为加粗
        let html = html_of("还出现了**门限签名（TSS）**技术。");
        assert!(html.contains("<strong>"), "应识别为加粗: {}", html);
        assert!(!html.contains("**"), "不应残留字面 **: {}", html);
    }

    #[test]
    fn test_cjk_bold_leading_fullwidth_paren() {
        // 起始 ** 后紧跟全角标点
        let html = html_of("前缀**（重点）**后缀");
        assert!(html.contains("<strong>"));
        assert!(!html.contains("**"));
    }

    #[test]
    fn test_normal_bold_still_works() {
        let html = html_of("这是**加粗**文字");
        assert!(html.contains("<strong>加粗"));
    }

    #[test]
    fn test_ascii_bold_unaffected() {
        let html = html_of("a **bold** b");
        assert!(html.contains("<strong>bold</strong>"));
    }

    #[test]
    fn test_cjk_emphasis_skips_inline_code() {
        // 行内代码里的 ** 不应被处理（也不该被插入零宽空格破坏）
        let html = html_of("代码 `a**b（c）**d` 结束");
        assert!(html.contains("<code>"));
        assert!(html.contains("a**b"), "行内代码内容应原样保留: {}", html);
    }

    #[test]
    fn test_cjk_emphasis_skips_fenced_code() {
        let md = "```\n中文（注释）**不加粗**结束\n```";
        let html = html_of(md);
        assert!(html.contains("**不加粗**"), "围栏代码应原样保留: {}", html);
    }

    #[test]
    fn test_no_zwsp_when_no_cjk_punct() {
        // 普通中文无全角标点相邻时不插入零宽空格
        let out = preprocess_cjk_emphasis("这是**加粗**文字");
        assert!(!out.contains('\u{200B}'));
    }
}
