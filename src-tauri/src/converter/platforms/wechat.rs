use comrak::nodes::{AstNode, NodeValue};
use crate::converter::ast::walk_nodes;
use super::PlatformConverter;

pub struct WechatConverter;

impl PlatformConverter for WechatConverter {
    fn name(&self) -> &str {
        "wechat"
    }

    fn supports_external_images(&self) -> bool {
        true
    }

    fn convert<'a>(&self, ast: &'a AstNode<'a>) -> String {
        let mut html = String::new();
        walk_nodes(ast, &mut |node| {
            let data = node.data.borrow();
            match &data.value {
                NodeValue::Document => {}
                NodeValue::Heading(heading) => {
                    let level = heading.level;
                    html.push_str(&format!("<h{}>", level));
                    collect_text(node, &mut html);
                    html.push_str(&format!("</h{}>", level));
                }
                NodeValue::Paragraph => {
                    html.push_str("<p>");
                    collect_inline(node, &mut html);
                    html.push_str("</p>");
                }
                NodeValue::CodeBlock(code_block) => {
                    html.push_str(&format!(
                        "<pre><code>{}</code></pre>",
                        html_escape(&code_block.literal)
                    ));
                }
                NodeValue::Image(image) => {
                    html.push_str(&format!("<img src=\"{}\" />", &image.url));
                }
                NodeValue::Table(_) => {
                    html.push_str("<p>");
                    collect_table_as_text(node, &mut html);
                    html.push_str("</p>");
                }
                _ => {}
            }
        });
        html
    }
}

fn collect_text<'a>(node: &'a AstNode<'a>, html: &mut String) {
    for child in node.children() {
        let data = child.data.borrow();
        match &data.value {
            NodeValue::Text(text) => {
                html.push_str(text);
            }
            _ => collect_text(child, html),
        }
    }
}

fn collect_inline<'a>(node: &'a AstNode<'a>, html: &mut String) {
    for child in node.children() {
        let data = child.data.borrow();
        match &data.value {
            NodeValue::Text(text) => {
                html.push_str(text);
            }
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
                html.push_str(&format!("<a href=\"{}\">", &link.url));
                collect_inline(child, html);
                html.push_str("</a>");
            }
            NodeValue::Image(image) => {
                html.push_str(&format!("<img src=\"{}\" />", &image.url));
            }
            NodeValue::Code(code) => {
                html.push_str(&format!("<code>{}</code>", html_escape(&code.literal)));
            }
            _ => collect_inline(child, html),
        }
    }
}

fn collect_table_as_text<'a>(node: &'a AstNode<'a>, html: &mut String) {
    walk_nodes(node, &mut |n| {
        let data = n.data.borrow();
        if let NodeValue::Text(text) = &data.value {
            html.push_str(text);
            html.push(' ');
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
    fn test_wechat_heading() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "# Title");
        let html = WechatConverter.convert(doc);
        assert!(html.contains("<h1>"));
        assert!(html.contains("Title"));
    }

    #[test]
    fn test_wechat_paragraph() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "Hello world");
        let html = WechatConverter.convert(doc);
        assert!(html.contains("Hello world"));
    }

    #[test]
    fn test_wechat_code_block() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```rust\nfn main() {}\n```");
        let html = WechatConverter.convert(doc);
        assert!(html.contains("fn main"));
    }

    #[test]
    fn test_wechat_image_external_link() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "![alt](https://example.com/img.png)");
        let html = WechatConverter.convert(doc);
        assert!(html.contains("https://example.com/img.png"));
    }

    #[test]
    fn test_wechat_table_to_text() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "| a | b |\n|---|---|\n| 1 | 2 |");
        let html = WechatConverter.convert(doc);
        assert!(!html.contains("<table>"));
    }

    #[test]
    fn test_wechat_supports_external_images() {
        assert!(WechatConverter.supports_external_images());
    }
}
