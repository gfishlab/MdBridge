use super::PlatformConverter;
use crate::converter::html::ast_to_html;
use comrak::nodes::AstNode;

pub struct JuejinConverter;

impl PlatformConverter for JuejinConverter {
    fn name(&self) -> &str {
        "juejin"
    }
    fn supports_external_images(&self) -> bool {
        true
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
    fn test_juejin_heading() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "# Title");
        let html = JuejinConverter.convert(doc);
        assert!(html.contains("<h1>"));
    }

    #[test]
    fn test_juejin_paragraph() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "Hello world");
        let html = JuejinConverter.convert(doc);
        assert!(html.contains("Hello world"));
    }

    #[test]
    fn test_juejin_name() {
        assert_eq!(JuejinConverter.name(), "juejin");
    }
}
