use comrak::nodes::AstNode;
use comrak::{parse_document, Arena, Options};

/// Parse markdown and return the AST root for testing
pub fn parse_test_md<'a>(arena: &'a Arena<AstNode<'a>>, md: &str) -> &'a AstNode<'a> {
    let options = Options::default();
    parse_document(arena, md, &options)
}

/// Collect all text node values from an AST
pub fn collect_node_values<'a>(node: &'a AstNode<'a>, values: &mut Vec<String>) {
    let data = node.data.borrow();
    match &data.value {
        comrak::nodes::NodeValue::Text(text) => {
            values.push(text.clone());
        }
        _ => {}
    }
    for child in node.children() {
        collect_node_values(child, values);
    }
}
