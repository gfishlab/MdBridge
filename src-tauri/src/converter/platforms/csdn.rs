use comrak::nodes::AstNode;
use super::PlatformConverter;
use crate::converter::html::ast_to_html;

pub struct CsdnConverter;

impl PlatformConverter for CsdnConverter {
    fn name(&self) -> &str { "csdn" }
    fn supports_external_images(&self) -> bool { false }

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
    fn test_csdn_heading() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "# Title");
        let html = CsdnConverter.convert(doc);
        assert!(html.contains("<h1>"));
    }

    #[test]
    fn test_csdn_paragraph() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "Hello world");
        let html = CsdnConverter.convert(doc);
        assert!(html.contains("Hello world"));
    }

    #[test]
    fn test_csdn_name() {
        assert_eq!(CsdnConverter.name(), "csdn");
    }
}
