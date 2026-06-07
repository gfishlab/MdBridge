use super::PlatformConverter;
use crate::converter::ast::walk_nodes;
use comrak::nodes::{AstNode, ListType, NodeValue};

pub struct WechatConverter;

impl PlatformConverter for WechatConverter {
    fn name(&self) -> &str {
        "wechat"
    }

    fn supports_external_images(&self) -> bool {
        true
    }

    fn convert<'a>(&self, ast: &'a AstNode<'a>) -> String {
        // 仅遍历文档的直接子节点（块级元素），每个块自行渲染其子节点。
        // 不能用 walk_nodes 递归全部节点，否则段落内的图片等内联元素会被
        // 渲染两次（段落渲染一次 + 遍历到该节点时再渲染一次）。
        let mut html = String::new();
        render_block_children(ast, &mut html);
        html
    }
}

/// 渲染一个节点的所有直接子块级节点
fn render_block_children<'a>(node: &'a AstNode<'a>, html: &mut String) {
    for child in node.children() {
        render_block(child, html);
    }
}

/// 渲染单个块级节点。微信公众号编辑器粘贴时会清除非行内样式，
/// 因此所有可见样式都通过 inline style 提供。
fn render_block<'a>(node: &'a AstNode<'a>, html: &mut String) {
    let data = node.data.borrow();
    match &data.value {
        NodeValue::Document => render_block_children(node, html),
        NodeValue::Heading(heading) => {
            let style = match heading.level {
                1 => "font-size:22px;font-weight:bold;margin:24px 0 16px;line-height:1.4;",
                2 => "font-size:20px;font-weight:bold;margin:22px 0 14px;line-height:1.4;",
                3 => "font-size:18px;font-weight:bold;margin:18px 0 12px;line-height:1.4;",
                _ => "font-size:16px;font-weight:bold;margin:16px 0 10px;line-height:1.4;",
            };
            html.push_str(&format!("<h{} style=\"{}\">", heading.level, style));
            render_inline_children(node, html);
            html.push_str(&format!("</h{}>", heading.level));
        }
        NodeValue::Paragraph => {
            html.push_str("<p style=\"margin:14px 0;line-height:1.75;font-size:16px;\">");
            render_inline_children(node, html);
            html.push_str("</p>");
        }
        NodeValue::CodeBlock(code_block) => {
            html.push_str(
                "<pre style=\"background:#f6f8fa;padding:16px;border-radius:6px;overflow-x:auto;margin:14px 0;\">\
                 <code style=\"font-family:Consolas,Monaco,monospace;font-size:14px;line-height:1.6;\">",
            );
            html.push_str(&html_escape(&code_block.literal));
            html.push_str("</code></pre>");
        }
        NodeValue::List(list) => {
            render_list(node, list, 0, html);
        }
        NodeValue::BlockQuote => {
            html.push_str(
                "<blockquote style=\"margin:14px 0;padding:8px 16px;border-left:4px solid #dcdfe6;\
                 color:#666;background:#f9f9f9;\">",
            );
            render_block_children(node, html);
            html.push_str("</blockquote>");
        }
        NodeValue::ThematicBreak => {
            html.push_str(
                "<hr style=\"border:none;border-top:1px solid #dcdfe6;margin:24px 0;\" />",
            );
        }
        // 独立图片（极少数不被包裹进段落的情况）
        NodeValue::Image(image) => {
            html.push_str(&format!(
                "<img src=\"{}\" style=\"max-width:100%;\" />",
                &image.url
            ));
        }
        // 微信公众号对表格支持差，转为纯文本段落
        NodeValue::Table(_) => {
            html.push_str("<p style=\"margin:14px 0;line-height:1.75;font-size:16px;\">");
            collect_table_as_text(node, html);
            html.push_str("</p>");
        }
        _ => {}
    }
}

/// 微信公众号编辑器对 <ul>/<li> 处理不稳定：以加粗词开头的列表项粘贴后会被
/// 强制折行（项目符号/加粗词单独占一行，描述被挤到下一行），很难看。
/// 因此这里改用「带手动项目符号的段落」模拟列表 —— 段落在微信里渲染稳定，
/// 加粗词能与后续文字保持在同一行。
fn render_list<'a>(
    node: &'a AstNode<'a>,
    list: &comrak::nodes::NodeList,
    depth: usize,
    html: &mut String,
) {
    let ordered = matches!(list.list_type, ListType::Ordered);
    let mut index = list.start;
    for item in node.children() {
        let marker = if ordered {
            format!("{}. ", index)
        } else {
            "• ".to_string()
        };
        render_list_item(item, &marker, depth, html);
        index += 1;
    }
}

/// 渲染单个列表项：首段落带项目符号，嵌套列表按层级递归缩进。
/// 用 text-indent 负值实现悬挂缩进，换行的文字与首行项目符号后对齐。
fn render_list_item<'a>(item: &'a AstNode<'a>, marker: &str, depth: usize, html: &mut String) {
    let margin_left = (depth as f32) * 1.6 + 1.6;
    let para_style = format!(
        "margin:6px 0;line-height:1.75;font-size:16px;margin-left:{:.1}em;text-indent:-1.6em;",
        margin_left
    );

    let mut marker_emitted = false;
    for child in item.children() {
        let is_paragraph = matches!(child.data.borrow().value, NodeValue::Paragraph);
        let sublist = matches!(child.data.borrow().value, NodeValue::List(_));

        if is_paragraph && !marker_emitted {
            html.push_str(&format!("<p style=\"{}\">{}", para_style, marker));
            render_inline_children(child, html);
            html.push_str("</p>");
            marker_emitted = true;
        } else if sublist {
            if let NodeValue::List(ref inner) = child.data.borrow().value {
                render_list(child, inner, depth + 1, html);
            }
        } else {
            render_block(child, html);
        }
    }

    // 空列表项也输出一个带符号的段落，保持结构完整
    if !marker_emitted {
        html.push_str(&format!("<p style=\"{}\">{}</p>", para_style, marker));
    }
}

/// 渲染节点的所有直接内联子节点
fn render_inline_children<'a>(node: &'a AstNode<'a>, html: &mut String) {
    for child in node.children() {
        render_inline(child, html);
    }
}

/// 渲染单个内联节点
fn render_inline<'a>(node: &'a AstNode<'a>, html: &mut String) {
    let data = node.data.borrow();
    match &data.value {
        NodeValue::Text(text) => html.push_str(&html_escape(text)),
        NodeValue::SoftBreak => html.push(' '),
        NodeValue::LineBreak => html.push_str("<br/>"),
        NodeValue::Strong => {
            html.push_str("<strong>");
            render_inline_children(node, html);
            html.push_str("</strong>");
        }
        NodeValue::Emph => {
            html.push_str("<em>");
            render_inline_children(node, html);
            html.push_str("</em>");
        }
        NodeValue::Strikethrough => {
            html.push_str("<del>");
            render_inline_children(node, html);
            html.push_str("</del>");
        }
        NodeValue::Link(link) => {
            html.push_str(&format!("<a href=\"{}\">", &link.url));
            render_inline_children(node, html);
            html.push_str("</a>");
        }
        NodeValue::Image(image) => {
            html.push_str(&format!(
                "<img src=\"{}\" style=\"max-width:100%;\" />",
                &image.url
            ));
        }
        NodeValue::Code(code) => {
            html.push_str(&format!(
                "<code style=\"background:#f6f8fa;padding:2px 4px;border-radius:3px;\
                 font-family:Consolas,Monaco,monospace;font-size:14px;\">{}</code>",
                html_escape(&code.literal)
            ));
        }
        _ => render_inline_children(node, html),
    }
}

fn collect_table_as_text<'a>(node: &'a AstNode<'a>, html: &mut String) {
    walk_nodes(node, &mut |n| {
        let data = n.data.borrow();
        if let NodeValue::Text(text) = &data.value {
            html.push_str(&html_escape(text));
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
        assert!(html.contains("<h1"));
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
    fn test_wechat_image_not_duplicated() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "![alt](https://example.com/img.png)");
        let html = WechatConverter.convert(doc);
        // 图片只能出现一次，修复重复渲染 bug
        assert_eq!(html.matches("https://example.com/img.png").count(), 1);
    }

    #[test]
    fn test_wechat_inline_image_not_duplicated() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "前面 ![alt](https://example.com/x.png) 后面");
        let html = WechatConverter.convert(doc);
        assert_eq!(html.matches("https://example.com/x.png").count(), 1);
    }

    #[test]
    fn test_wechat_unordered_list() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "- item 1\n- item 2");
        let html = WechatConverter.convert(doc);
        // 改用段落 + 手动项目符号，规避微信对 <li> 的折行怪癖
        assert!(html.contains("•"));
        assert!(html.contains("item 1"));
        assert!(html.contains("item 2"));
        assert!(!html.contains("<li"));
    }

    #[test]
    fn test_wechat_ordered_list() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "1. first\n2. second");
        let html = WechatConverter.convert(doc);
        assert!(html.contains("1. "));
        assert!(html.contains("2. "));
        assert!(html.contains("first"));
        assert!(!html.contains("<ol"));
    }

    #[test]
    fn test_wechat_list_bold_prefix_inline() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "- **AES**：一种算法");
        let html = WechatConverter.convert(doc);
        // 加粗词与后续描述必须在同一个段落内，不被拆成多行（不使用 <li>）
        assert!(html.contains("<strong>AES</strong>"));
        assert!(html.contains("一种算法"));
        assert!(!html.contains("<li"));
        // 加粗与描述之间不得出现可见的换行/块级标签
        assert!(!html.contains("</strong></p>"));
    }

    #[test]
    fn test_wechat_blockquote() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "> quoted text");
        let html = WechatConverter.convert(doc);
        assert!(html.contains("<blockquote"));
        assert!(html.contains("quoted text"));
    }

    #[test]
    fn test_wechat_thematic_break() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "a\n\n---\n\nb");
        let html = WechatConverter.convert(doc);
        assert!(html.contains("<hr"));
    }

    #[test]
    fn test_wechat_heading_has_inline_style() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "# 标题");
        let html = WechatConverter.convert(doc);
        // 微信会清除非行内样式，标题必须带 inline style 才能正确渲染
        assert!(html.contains("font-size"));
        assert!(html.contains("font-weight:bold"));
    }

    #[test]
    fn test_wechat_table_to_text() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "| a | b |\n|---|---|\n| 1 | 2 |");
        let html = WechatConverter.convert(doc);
        assert!(!html.contains("<table>"));
    }

    #[test]
    fn test_wechat_bold_and_emph() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "**bold** and *italic*");
        let html = WechatConverter.convert(doc);
        assert!(html.contains("<strong>bold</strong>"));
        assert!(html.contains("<em>italic</em>"));
    }

    #[test]
    fn test_wechat_supports_external_images() {
        assert!(WechatConverter.supports_external_images());
    }
}
