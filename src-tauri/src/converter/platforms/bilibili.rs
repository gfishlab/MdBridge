use super::PlatformConverter;
use crate::converter::html::ast_to_html;
use comrak::nodes::AstNode;

pub struct BilibiliConverter;

impl PlatformConverter for BilibiliConverter {
    fn name(&self) -> &str {
        "bilibili"
    }
    fn supports_external_images(&self) -> bool {
        false
    }

    fn convert<'a>(&self, ast: &'a AstNode<'a>) -> String {
        ast_to_html(ast)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::converter::ast::parse_markdown;
    use comrak::Arena;

    #[test]
    fn test_bilibili_heading() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "# Title");
        let html = BilibiliConverter.convert(doc);
        assert!(html.contains("<h1>"));
    }

    #[test]
    fn test_bilibili_paragraph() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "Hello world");
        let html = BilibiliConverter.convert(doc);
        assert!(html.contains("Hello world"));
    }

    #[test]
    fn test_bilibili_name() {
        assert_eq!(BilibiliConverter.name(), "bilibili");
    }
}
