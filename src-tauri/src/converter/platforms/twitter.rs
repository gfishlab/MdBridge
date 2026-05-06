use super::PlatformConverter;
use crate::converter::ast::walk_nodes;
use comrak::nodes::{AstNode, NodeValue};

pub struct TwitterConverter;

impl PlatformConverter for TwitterConverter {
    fn name(&self) -> &str {
        "twitter"
    }
    fn supports_external_images(&self) -> bool {
        false
    }

    fn convert<'a>(&self, ast: &'a AstNode<'a>) -> String {
        let mut text = String::new();
        walk_nodes(ast, &mut |node| {
            let data = node.data.borrow();
            match &data.value {
                NodeValue::Paragraph | NodeValue::Heading(_) => {
                    collect_twitter_text(node, &mut text);
                    text.push('\n');
                }
                _ => {}
            }
        });
        text.trim().to_string()
    }
}

fn collect_twitter_text<'a>(node: &'a AstNode<'a>, text: &mut String) {
    for child in node.children() {
        let data = child.data.borrow();
        match &data.value {
            NodeValue::Text(t) => text.push_str(t),
            NodeValue::SoftBreak => text.push(' '),
            NodeValue::Link(link) => {
                text.push_str(&link.url);
            }
            _ => collect_twitter_text(child, text),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::converter::ast::parse_markdown;
    use comrak::Arena;

    #[test]
    fn test_twitter_plain_text() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "# Title\n\nHello world");
        let text = TwitterConverter.convert(doc);
        assert!(text.contains("Title"));
        assert!(text.contains("Hello world"));
        assert!(!text.contains("<h1>"));
    }

    #[test]
    fn test_twitter_link_to_url() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "[link](https://example.com)");
        let text = TwitterConverter.convert(doc);
        assert!(text.contains("https://example.com"));
        assert!(!text.contains("<a href"));
    }

    #[test]
    fn test_twitter_name() {
        assert_eq!(TwitterConverter.name(), "twitter");
    }
}
