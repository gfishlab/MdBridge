use comrak::html::format_document;
use comrak::nodes::AstNode;
use comrak::Options;

pub fn ast_to_html<'a>(node: &'a AstNode<'a>) -> String {
    let options = Options::default();
    let mut output = Vec::new();
    format_document(node, &options, &mut output).unwrap();
    String::from_utf8(output).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::converter::ast::parse_markdown;
    use comrak::Arena;

    #[test]
    fn test_heading_to_html() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "# Hello");
        let html = ast_to_html(doc);
        assert!(html.contains("<h1>"));
        assert!(html.contains("Hello"));
    }

    #[test]
    fn test_paragraph_to_html() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "Hello world");
        let html = ast_to_html(doc);
        assert!(html.contains("<p>"));
        assert!(html.contains("Hello world"));
    }

    #[test]
    fn test_code_block_to_html() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```rust\nfn main() {}\n```");
        let html = ast_to_html(doc);
        assert!(html.contains("<pre>"));
        assert!(html.contains("<code"));
    }

    #[test]
    fn test_bold_to_html() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "**bold**");
        let html = ast_to_html(doc);
        assert!(html.contains("<strong>"));
    }

    #[test]
    fn test_link_to_html() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "[link](https://example.com)");
        let html = ast_to_html(doc);
        assert!(html.contains("<a href"));
        assert!(html.contains("https://example.com"));
    }

    #[test]
    fn test_image_to_html() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "![alt](https://example.com/img.png)");
        let html = ast_to_html(doc);
        assert!(html.contains("<img"));
        assert!(html.contains("https://example.com/img.png"));
    }

    #[test]
    fn test_table_to_html() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "| a | b |\n|---|---|\n| 1 | 2 |");
        let html = ast_to_html(doc);
        assert!(html.contains("<table>"));
    }

    #[test]
    fn test_unordered_list_to_html() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "- item 1\n- item 2");
        let html = ast_to_html(doc);
        assert!(html.contains("<ul>"));
        assert!(html.contains("<li>"));
    }
}
