use comrak::nodes::{AstNode, NodeValue};
use super::PlatformConverter;
use crate::converter::ast::walk_nodes;

pub struct DouyinConverter;

impl PlatformConverter for DouyinConverter {
    fn name(&self) -> &str { "douyin" }
    fn supports_external_images(&self) -> bool { false }

    fn convert<'a>(&self, ast: &'a AstNode<'a>) -> String {
        let mut html = String::new();

        // 收集摘要
        let mut all_text = String::new();
        walk_nodes(ast, &mut |node| {
            let data = node.data.borrow();
            if matches!(&data.value, NodeValue::Heading(_) | NodeValue::Paragraph) {
                collect_plain_text(node, &mut all_text);
                all_text.push(' ');
            }
        });
        let cleaned: String = all_text
            .replace("...", " ")
            .replace("…", " ")
            .split_whitespace()
            .collect();
        let summary: String = cleaned.chars().take(30).collect();
        if !summary.is_empty() {
            html.push_str(&format!("<p><strong>【摘要】{}</strong></p>", summary));
        }

        // 生成抖音兼容 HTML（只使用 <p> <br> <strong> <em>）
        walk_nodes(ast, &mut |node| {
            let data = node.data.borrow();
            match &data.value {
                NodeValue::Heading(_) => {
                    html.push_str("<p><strong>");
                    collect_inline(node, &mut html);
                    html.push_str("</strong></p>");
                }
                NodeValue::Paragraph => {
                    html.push_str("<p>");
                    collect_inline(node, &mut html);
                    html.push_str("</p>");
                }
                NodeValue::CodeBlock(code_block) => {
                    html.push_str("<p>");
                    for line in code_block.literal.lines() {
                        html.push_str(line);
                        html.push_str("<br />");
                    }
                    html.push_str("</p>");
                }
                NodeValue::Image(image) => {
                    html.push_str(&format!("<p><img src=\"{}\" /></p>", &image.url));
                }
                NodeValue::List(_) | NodeValue::DescriptionList => {}
                NodeValue::Item(_) => {
                    html.push_str("<p>• ");
                    collect_inline(node, &mut html);
                    html.push_str("</p>");
                }
                NodeValue::BlockQuote => {
                    html.push_str("<p>「");
                    collect_inline(node, &mut html);
                    html.push_str("」</p>");
                }
                NodeValue::Table(_) => {
                    html.push_str("<p>");
                    collect_table_as_text(node, &mut html);
                    html.push_str("</p>");
                }
                NodeValue::ThematicBreak => {
                    html.push_str("<p>————————</p>");
                }
                _ => {}
            }
        });

        html
    }
}

fn collect_inline<'a>(node: &'a AstNode<'a>, html: &mut String) {
    for child in node.children() {
        let data = child.data.borrow();
        match &data.value {
            NodeValue::Text(text) => {
                html.push_str(text);
            }
            NodeValue::SoftBreak => html.push(' '),
            NodeValue::LineBreak => html.push_str("<br />"),
            NodeValue::Strong => {
                html.push_str("<strong>");
                collect_inline(child, html);
                html.push_str("</strong>");
            }
            NodeValue::Emph => {
                html.push_str("<em>");
                collect_inline(child, html);
                html.push_str("</em>");
            }
            NodeValue::Link(link) => {
                collect_inline(child, html);
                html.push_str(&format!("({})", &link.url));
            }
            NodeValue::Image(_) => {
                // 跳过行内图片，由顶层 walk_nodes 的 Image handler 处理独立图片
            }
            NodeValue::Code(code) => {
                html.push_str(&html_escape(&code.literal));
            }
            _ => collect_inline(child, html),
        }
    }
}

fn collect_plain_text<'a>(node: &'a AstNode<'a>, text: &mut String) {
    for child in node.children() {
        let data = child.data.borrow();
        match &data.value {
            NodeValue::Text(t) => text.push_str(t),
            NodeValue::SoftBreak | NodeValue::LineBreak => text.push(' '),
            _ => collect_plain_text(child, text),
        }
    }
}

fn collect_table_as_text<'a>(node: &'a AstNode<'a>, html: &mut String) {
    let mut first_cell = true;
    walk_nodes(node, &mut |n| {
        let data = n.data.borrow();
        match &data.value {
            NodeValue::TableCell => {
                if !first_cell { html.push_str(" | "); }
                first_cell = false;
                collect_inline(n, html);
            }
            NodeValue::TableRow(_) => {
                first_cell = true;
            }
            _ => {}
        }
    });
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::converter::ast::parse_markdown;
    use comrak::Arena;

    #[test]
    fn test_douyin_summary() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "# Title\n\nHello world, this is a test.");
        let html = DouyinConverter.convert(doc);
        assert!(html.contains("【摘要】"));
    }

    #[test]
    fn test_douyin_no_unsupported_tags() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "# Title\n\n```\ncode\n```\n> quote");
        let html = DouyinConverter.convert(doc);
        assert!(!html.contains("<h1>"));
        assert!(!html.contains("<pre>"));
        assert!(!html.contains("<code>"));
        assert!(!html.contains("<blockquote>"));
    }

    #[test]
    fn test_douyin_table_to_text() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "| a | b |\n|---|---|\n| 1 | 2 |");
        let html = DouyinConverter.convert(doc);
        assert!(!html.contains("<table>"));
    }

    #[test]
    fn test_douyin_name() {
        assert_eq!(DouyinConverter.name(), "douyin");
    }
}
