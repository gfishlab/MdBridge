use comrak::nodes::{AstNode, NodeValue};
use comrak::{parse_document, Arena, Options};

pub fn parse_markdown<'a>(arena: &'a Arena<AstNode<'a>>, content: &str) -> &'a AstNode<'a> {
    let mut options = Options::default();
    options.extension.table = true;
    options.extension.strikethrough = true;
    options.extension.autolink = true;
    options.extension.tasklist = true;
    options.extension.header_ids = Some("".to_string());
    parse_document(arena, content, &options)
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
}
