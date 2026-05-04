use comrak::nodes::{AstNode, NodeValue};
use super::PlatformConverter;
use crate::converter::ast::walk_nodes;

pub struct DouyinConverter;

impl PlatformConverter for DouyinConverter {
    fn name(&self) -> &str { "douyin" }
    fn supports_external_images(&self) -> bool { false }

    fn convert<'a>(&self, ast: &'a AstNode<'a>) -> String {
        let mut text = String::new();
        walk_nodes(ast, &mut |node| {
            let data = node.data.borrow();
            match &data.value {
                NodeValue::Heading(_) => {
                    text.push('\n');
                    collect_plain_text(node, &mut text);
                    text.push('\n');
                }
                NodeValue::Paragraph => {
                    collect_plain_text(node, &mut text);
                    text.push('\n');
                }
                _ => {}
            }
        });
        text.trim().to_string()
    }
}

fn collect_plain_text<'a>(node: &'a AstNode<'a>, text: &mut String) {
    for child in node.children() {
        let data = child.data.borrow();
        match &data.value {
            NodeValue::Text(t) => text.push_str(t),
            NodeValue::SoftBreak => text.push(' '),
            NodeValue::LineBreak => text.push('\n'),
            _ => collect_plain_text(child, text),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::converter::ast::parse_markdown;
    use comrak::Arena;

    #[test]
    fn test_douyin_plain_text() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "# Title\n\nHello world");
        let text = DouyinConverter.convert(doc);
        assert!(text.contains("Title"));
        assert!(text.contains("Hello world"));
        assert!(!text.contains("<h1>"));
    }

    #[test]
    fn test_douyin_no_html() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "**bold** and *italic*");
        let text = DouyinConverter.convert(doc);
        assert!(!text.contains("<strong>"));
        assert!(!text.contains("<em>"));
    }

    #[test]
    fn test_douyin_name() {
        assert_eq!(DouyinConverter.name(), "douyin");
    }
}
