use super::PlatformConverter;
use crate::converter::ast::walk_nodes;
use comrak::nodes::{AstNode, ListType, NodeValue};
use std::sync::OnceLock;
use syntect::easy::HighlightLines;
use syntect::highlighting::ThemeSet;
use syntect::html::{styled_line_to_highlighted_html, IncludeBackground};
use syntect::parsing::{SyntaxDefinition, SyntaxSet};

pub struct WechatConverter;

const PARAGRAPH_STYLE: &str =
    "margin:14px 0;line-height:1.75;font-size:16px;text-align:left;letter-spacing:0;word-spacing:normal;";

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
            html.push_str(&format!("<p style=\"{}\">", PARAGRAPH_STYLE));
            render_inline_children(node, html);
            html.push_str("</p>");
        }
        NodeValue::CodeBlock(code_block) => {
            render_code_block_macos(&code_block.info, &code_block.literal, html);
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
            html.push_str(&format!("<p style=\"{}\">", PARAGRAPH_STYLE));
            collect_table_as_text(node, html);
            html.push_str("</p>");
        }
        _ => {}
    }
}

/// 渲染 macOS 风格代码块：顶部浅灰标题栏带红/黄/绿三圆点（模仿 Mac 终端
/// 窗口红绿灯），下方为浅灰底等宽代码区。
///
/// 注意：这不是通用代码块 HTML，而是**专门适配微信公众号编辑器粘贴行为**的实现。
/// 微信会在粘贴富文本时清理/改写 `<pre>/<code>`、`white-space` 和连续空格，导致代码
/// 缩进与长行折行异常。其他平台（B站、知乎、掘金、推特等）应在各自 converter 中按
/// 平台能力单独处理，避免把微信公众号的 workaround 抽到共享渲染层而相互干扰。
///
/// 实现细节：
/// 1. 外壳、标题栏和代码区都使用 `<section>`，比 `<pre>/<code>` 更少被微信编辑器改写；
/// 2. 三圆点用 `background-color`（而非简写 `background`），微信对简写解析不稳定；
/// 3. **圆点 span 内必须有文本内容**：微信会吞掉无文本的 inline 元素，所以每个
///    圆点 span 内放一个实心圆字符 `●`（U+25CF），并用 `color` 设成同色让它隐形
///    于背景，同时 `font-size`/`line-height` 让微信把它当作文本节点保留。
/// 4. 代码内容用 syntect 做语法高亮（GitHub 浅色配色），每个 token 包在带
///    `color` 的 inline span 里。识别不了的语言回退到纯文本。
/// 5. 每一行根据原始前导空格计算缩进，并写成 `padding-left`。即使微信强制折行，
///    续行也会保持该代码行的缩进，不会掉回最左侧。
fn render_code_block_macos(info: &str, literal: &str, html: &mut String) {
    // 外层：圆角 + 浅灰底；header 作为其首子元素。
    html.push_str(
        "<section style=\"margin:14px 0;padding:0;border-radius:5px;\
         background-color:#f6f8fa;overflow:hidden;overflow-x:auto;\">",
    );
    // 标题栏 header：浅灰条，内含三个 macOS 红绿灯圆点。
    html.push_str(
        "<section style=\"height:30px;width:100%;\
         background-color:#e8e8e8;\
         border-radius:5px 5px 0 0;padding:10px 0 0 12px;box-sizing:border-box;\">",
    );
    for color in ["#ff5f56", "#ffbd2e", "#27c93f"] {
        html.push_str(&format!(
            "<span style=\"display:inline-block;width:10px;height:10px;\
             line-height:10px;border-radius:50%;background-color:{};color:{};\
             font-size:10px;margin-right:6px;vertical-align:top;\">\u{25CF}</span>",
            color, color
        ));
    }
    html.push_str("</section>");
    // 代码区：等宽字体，padding 给出代码内容留白。每一行另有 section 行容器，
    // 用更靠近编辑器的节点直接控制行高、折行和缩进。
    html.push_str(
        "<section style=\"padding:16px;overflow-x:auto;\
         font-family:Consolas,Monaco,monospace;font-size:14px;line-height:18px;\">",
    );
    // 尝试语法高亮；识别不了的语言回退到纯文本（仅做空白兼容处理）。
    match highlight_code_to_html_lines(info, literal) {
        Some(lines) => render_highlighted_code_lines(&lines, html),
        None => render_plain_code_lines(literal, html),
    }
    html.push_str("</section>");
    html.push_str("</section>");
}

struct HighlightedCodeLine {
    indent_columns: usize,
    html: String,
}

/// syntect 默认语法集不包含 TypeScript/TSX（syntect issue #168），导致
/// ` ```typescript ` / ` ```tsx ` 围栏的代码块完全不上色。这里在编译期把两份
/// 预合并、无 `extends:` 依赖的 ST3 格式 `.sublime-syntax`（源自
/// Microsoft/TypeScript-TmLanguage，由 Keats/zola 整理）embed 进二进制，
/// 叠加到 syntect 自带的默认语法集上。
///
/// 用 `OnceLock` 全局缓存，避免每次渲染代码块都重新解析 ~200KB YAML + 重建
/// SyntaxSet（实测首次构建约几十毫秒，之后零成本）。
const TS_SYNTAX: &str = include_str!("../../../syntaxes/TypeScript.sublime-syntax");
const TSX_SYNTAX: &str = include_str!("../../../syntaxes/TypeScriptReact.sublime-syntax");

fn syntax_set() -> &'static SyntaxSet {
    static SYNTAX_SET: OnceLock<SyntaxSet> = OnceLock::new();
    SYNTAX_SET.get_or_init(|| {
        let mut builder = SyntaxSet::load_defaults_newlines().into_builder();
        for (src, name) in [(TS_SYNTAX, "TypeScript"), (TSX_SYNTAX, "TypeScriptReact")] {
            // parse failure 说明 embed 的语法文件损坏——属于构建期就该发现的 bug，
            // 直接 panic 让 CI 立刻暴露，而不是静默回退到纯文本。
            let def = SyntaxDefinition::load_from_str(src, true, Some(name))
                .unwrap_or_else(|e| panic!("failed to parse {name}.sublime-syntax: {e}"));
            builder.add(def);
        }
        builder.build()
    })
}

/// 用 syntect 把代码逐行高亮成带 inline color 的 HTML 片段（不含 `<pre>` 外壳）。
///
/// `info` 是代码围栏后的语言标记（如 `java`、`python`，可能含 ` ```java title` 这样的
/// 额外信息，取首个 token）。语法识别失败时返回 `None`，由调用方回退到纯文本。
///
/// 配色用 syntect 自带的 `InspiredGitHub` 主题（GitHub 浅色风格），与浅灰代码区背景
/// `#f6f8fa` 协调。
fn highlight_code_to_html_lines(info: &str, code: &str) -> Option<Vec<HighlightedCodeLine>> {
    let lang_token = info.split_whitespace().next()?;
    if lang_token.is_empty() {
        return None;
    }

    let ps = syntax_set();
    let ts = ThemeSet::load_defaults();
    let theme = &ts.themes["InspiredGitHub"];

    let syntax = ps
        .find_syntax_by_token(lang_token)
        .or_else(|| ps.find_syntax_by_extension(lang_token))?;

    let mut highlighter = HighlightLines::new(syntax, theme);
    let lines = code_lines(code);
    let mut out = Vec::with_capacity(lines.len());
    for line in lines {
        let (indent_columns, code_without_indent) = split_code_indent(line);
        // syntect 的 highlight_line 期望行尾带换行符，输出的 regions 本身就包含该 \n，
        // 但最终渲染时我们按行生成 block 容器，所以要把末尾换行从 region 里剥掉。
        let line_with_nl = format!("{}\n", code_without_indent);
        let mut regions = highlighter.highlight_line(&line_with_nl, &ps).ok()?;
        if let Some(last) = regions.last_mut() {
            if let Some(stripped) = last.1.strip_suffix('\n') {
                last.1 = stripped;
            }
        }
        if code_without_indent.is_empty() {
            out.push(HighlightedCodeLine {
                indent_columns,
                html: String::new(),
            });
            continue;
        }
        let line_html =
            styled_line_to_highlighted_html(&regions[..], IncludeBackground::No).ok()?;
        // 微信会吞掉"只含空白的 span"，导致缩进丢失。解包这种 span，让缩进空格成为
        // 行容器的直接文本子节点。
        out.push(HighlightedCodeLine {
            indent_columns,
            html: unwrap_whitespace_only_spans(&line_html),
        });
    }
    Some(out)
}

fn code_lines(code: &str) -> Vec<&str> {
    let code = code.strip_suffix('\n').unwrap_or(code);
    if code.is_empty() {
        vec![""]
    } else {
        code.split('\n').collect()
    }
}

fn split_code_indent(line: &str) -> (usize, &str) {
    for (idx, ch) in line.char_indices() {
        match ch {
            ' ' => {}
            '\t' => {}
            _ => return (indent_columns(&line[..idx]), &line[idx..]),
        }
    }
    (indent_columns(line), "")
}

fn indent_columns(indent: &str) -> usize {
    indent
        .chars()
        .map(|ch| if ch == '\t' { 4 } else { 1 })
        .sum()
}

fn push_code_line_open(indent_columns: usize, html: &mut String) {
    // 微信强制折行时，续行会按当前块的 padding 继续排版。把前导缩进从文本空格
    // 转成行容器 padding，比依赖 NBSP/white-space 更稳定；这也是微信公众号专用策略。
    let indent_em = indent_columns as f32 * 0.62;
    html.push_str(&format!(
        "<section style=\"min-height:18px;line-height:18px;margin:0;padding:0 0 0 {:.2}em;\
         font-family:Consolas,Monaco,monospace;font-size:14px;\
         white-space:nowrap;word-break:keep-all;overflow-wrap:normal;word-wrap:normal;\
         hyphens:none;-webkit-hyphens:none;text-indent:0;box-sizing:border-box;\">\
         <code style=\"display:inline-block;min-width:max-content;\
         font-family:Consolas,Monaco,monospace;font-size:14px;line-height:18px;\
         white-space:nowrap;word-break:keep-all;overflow-wrap:normal;word-wrap:normal;\
         hyphens:none;-webkit-hyphens:none;\">",
        indent_em
    ));
}

fn push_code_line_close(html: &mut String) {
    html.push_str("</code></section>");
}

fn render_highlighted_code_lines(lines: &[HighlightedCodeLine], html: &mut String) {
    for line in lines {
        push_code_line_open(line.indent_columns, html);
        if line.html.is_empty() {
            html.push('\u{00A0}');
        } else {
            materialize_highlighted_line_whitespace(&line.html, html);
        }
        push_code_line_close(html);
    }
}

fn render_plain_code_lines(code: &str, html: &mut String) {
    for line in code_lines(code) {
        let (indent, code_without_indent) = split_code_indent(line);
        push_code_line_open(indent, html);
        if code_without_indent.is_empty() {
            html.push('\u{00A0}');
        } else {
            materialize_plain_line(code_without_indent, html);
        }
        push_code_line_close(html);
    }
}

/// 解包高亮 HTML 里"只含空白字符的 `<span>`"。
///
/// syntect 会把行首缩进空格单独包成 `<span style="color:#323232;">    </span>`。
/// 微信编辑器粘贴时会清理掉这种只含空白的 inline 元素（与空 span 被吞是同类问题），
/// 导致代码缩进完全丢失。本函数去掉这种 span 的标签，只保留里面的空白文本，让它
/// 成为父元素的直接文本子节点——微信对直接文本节点的空白会保留。
///
/// 只处理内容**全部**是空白（空格/Tab/换行）的 span；含任何非空白字符的 span 不动。
fn unwrap_whitespace_only_spans(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(open) = rest.find("<span style=\"") {
        // 先把 span 开标签之前的内容原样输出
        result.push_str(&rest[..open]);
        rest = &rest[open..];
        // 找到开标签的结束 `>`
        let tag_end = match rest.find('>') {
            Some(i) => i + 1,
            None => {
                result.push_str(rest);
                return result;
            }
        };
        let after_open = &rest[tag_end..];
        // 找到最近的 `</span>`
        let close = match after_open.find("</span>") {
            Some(i) => i,
            None => {
                result.push_str(rest);
                return result;
            }
        };
        let span_content = &after_open[..close];
        // 判断 span 内容是否全部是空白
        let is_ws_only = !span_content.is_empty()
            && span_content
                .chars()
                .all(|c| c == ' ' || c == '\t' || c == '\n' || c == '\r');
        if is_ws_only {
            // 解包：直接输出空白内容（去掉 span 标签）
            result.push_str(span_content);
        } else {
            // 保留整个 span（含标签和内容）
            result.push_str(&rest[..tag_end + close + "</span>".len()]);
        }
        rest = &rest[tag_end + close + "</span>".len()..];
    }
    result.push_str(rest);
    result
}

/// 把**已高亮**的单行代码 HTML（含 `<span style="color:...">` 标签）做微信兼容的空白处理。
///
/// 这里输入已经是 HTML（带标签），不能简单逐字符替换——否则会把标签属性里的空格
/// 也换掉，破坏 HTML。
///
/// 用状态机逐字符遍历，跟踪是否在 `<>` 标签内部：
/// - 标签内（`<...>`）：原样输出，不改动空格/换行；
/// - 标签外（文本节点）：
///   - 连续空格（≥2）→ 等量 `U+00A0`（防微信合并，保护缩进）；
///   - 单个空格 → 保留普通空格（单词间，微信不合并单个空格，转 U+00A0 反而变宽）；
///   - Tab → 4×`U+00A0`。
///
/// 注意：连续空格可能跨 span 边界（如 `<span>  </span><span> </span>`），但由于 syntect
/// 通常把同类空白归在同一 token，跨边界连续空格罕见；即便发生，每个 span 内的连续
/// 空格仍会被正确处理，单空格保留，不影响正确性。
///
/// 安全性前提：syntect 已对文本做 HTML 转义（`<`→`&lt;`），文本节点不会出现裸 `<`。
fn materialize_highlighted_line_whitespace(highlighted: &str, html: &mut String) {
    let mut in_tag = false;
    let mut chars = highlighted.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '<' => {
                in_tag = true;
                html.push(ch);
            }
            '>' => {
                in_tag = false;
                html.push(ch);
            }
            _ if in_tag => html.push(ch),
            ' ' => {
                // 文本节点内的连续空格
                let mut run = 1usize;
                while chars.peek() == Some(&' ') {
                    chars.next();
                    run += 1;
                }
                if run >= 2 {
                    for _ in 0..run {
                        html.push('\u{00A0}');
                    }
                } else {
                    html.push(' ');
                }
            }
            '\t' => html.push_str("\u{00A0}\u{00A0}\u{00A0}\u{00A0}"),
            '\n' | '\r' => {}
            _ => html.push(ch),
        }
    }
}

/// 把纯文本代码一行内的空白字符转成微信编辑器能保留的形式（高亮失败时的回退路径）：
/// - **连续空格（≥2）** → 等量 `U+00A0`。微信会把连续普通空格合并成 1 个，导致
///   缩进全乱；U+00A0 不会被合并。
/// - **单个空格** → 保留普通空格。单词间的单个空格不会被微信合并，转成 U+00A0
///   反而会导致字符间距变宽、排版松散。
/// - Tab `\t` → 4 个 `U+00A0`（与常见编辑器 Tab 宽度一致）。
///
/// 其余字符照常 HTML 转义。
fn materialize_plain_line(line: &str, html: &mut String) {
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            ' ' => {
                // 收集连续空格
                let mut run = 1usize;
                while chars.peek() == Some(&' ') {
                    chars.next();
                    run += 1;
                }
                if run >= 2 {
                    for _ in 0..run {
                        html.push('\u{00A0}');
                    }
                } else {
                    html.push(' ');
                }
            }
            '\t' => html.push_str("\u{00A0}\u{00A0}\u{00A0}\u{00A0}"),
            _ => html.push_str(&html_escape(&ch.to_string())),
        }
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
    for (index, item) in (list.start..).zip(node.children()) {
        let marker = if ordered {
            format!("{}. ", index)
        } else {
            "• ".to_string()
        };
        render_list_item(item, &marker, depth, html);
    }
}

/// 渲染单个列表项：首段落带项目符号，嵌套列表按层级递归缩进。
/// 用 text-indent 负值实现悬挂缩进，换行的文字与首行项目符号后对齐。
fn render_list_item<'a>(item: &'a AstNode<'a>, marker: &str, depth: usize, html: &mut String) {
    let margin_left = (depth as f32) * 1.6 + 1.6;
    let para_style = format!(
        "margin:6px 0;line-height:1.75;font-size:16px;text-align:left;letter-spacing:0;\
         word-spacing:normal;margin-left:{:.1}em;text-indent:-1.6em;",
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
    let children = node.children().collect::<Vec<_>>();
    for (index, child) in children.iter().enumerate() {
        render_inline(child, children.get(index + 1).copied(), html);
    }
}

/// 渲染单个内联节点
fn render_inline<'a>(
    node: &'a AstNode<'a>,
    next_sibling: Option<&'a AstNode<'a>>,
    html: &mut String,
) {
    let data = node.data.borrow();
    match &data.value {
        NodeValue::Text(text) => html.push_str(&html_escape(text)),
        NodeValue::SoftBreak => {
            if next_sibling.is_some_and(is_link_node) {
                html.push_str("<br/>");
            } else {
                html.push(' ');
            }
        }
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
            html.push_str(&format!(
                "<a href=\"{}\" style=\"color:#576b95;text-decoration:none;\
                 word-break:break-all;overflow-wrap:anywhere;\">",
                &link.url
            ));
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

fn is_link_node<'a>(node: &'a AstNode<'a>) -> bool {
    matches!(node.data.borrow().value, NodeValue::Link(_))
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
    fn test_wechat_paragraph_disables_justify_spacing() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "Loop Engineering 原文（Addy Osmani）：");
        let html = WechatConverter.convert(doc);
        assert!(
            html.contains("text-align:left"),
            "paragraphs should force left alignment to avoid WeChat editor justify spacing"
        );
        assert!(
            html.contains("letter-spacing:0") && html.contains("word-spacing:normal"),
            "paragraphs should reset spacing that can be inherited in WeChat"
        );
    }

    #[test]
    fn test_wechat_reference_link_after_softbreak_stays_on_next_line() {
        let arena = Arena::new();
        let doc = parse_markdown(
            &arena,
            "Loop Engineering 原文（Addy Osmani）：\nhttps://addyosmani.com/blog/loop-engineering/",
        );
        let html = WechatConverter.convert(doc);
        assert!(
            html.contains("Osmani）：<br/><a href=\"https://addyosmani.com/blog/loop-engineering/\""),
            "reference URL should stay on the next line instead of being merged into the title line: {}",
            html
        );
        assert!(
            html.contains("word-break:break-all") && html.contains("overflow-wrap:anywhere"),
            "long reference links should be allowed to wrap inside WeChat"
        );
    }

    #[test]
    fn test_wechat_code_block() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```rust\nfn main() {}\n```");
        let html = WechatConverter.convert(doc);
        // 代码内容保留；单词间空格被转成 U+00A0（微信兼容），所以分别断言 token 存在
        assert!(html.contains("fn"));
        assert!(html.contains("main"));
    }

    #[test]
    fn test_wechat_code_block_typescript_is_highlighted() {
        // syntect 默认语法集不含 TypeScript，必须靠 syntax_set() 叠加 embed 的
        // .sublime-syntax 才能上色。回归测试：typesciprt/ts/tsx 围栏必须产生
        // 带颜色 span 的真正高亮，而不是回退纯文本。
        let arena = Arena::new();
        for lang in ["typescript", "ts", "tsx", "typescriptreact"] {
            let fenced = format!(
                "```{}\nimport {{ OpenAI }} from \"@langchain/openai\";\n```",
                lang
            );
            let doc = parse_markdown(&arena, &fenced);
            let html = WechatConverter.convert(doc);
            assert!(
                html.contains("<span style=\"font-weight:bold;color:#a71d5d;\">import </span>"),
                "lang `{}` should produce keyword highlight span for `import`, got: {}",
                lang,
                html
            );
        }
    }

    #[test]
    fn test_wechat_code_block_tsx_content_preserved() {
        // TSX 语法较重，验证高亮后内容不丢失、结构完整
        let arena = Arena::new();
        let doc = parse_markdown(
            &arena,
            "```tsx\nconst App = () => <div>Hello</div>;\nexport default App;\n```",
        );
        let html = WechatConverter.convert(doc);
        assert!(html.contains("App"), "TSX content should be preserved");
        assert!(html.contains("export"), "TSX content should be preserved");
        // TSX 关键字应该被上色（带 font-weight:bold 的 span）
        assert!(
            html.contains("color:#a71d5d;\">export"),
            "TSX `export` keyword should be highlighted, got: {}",
            html
        );
    }

    #[test]
    fn test_wechat_code_block_existing_languages_still_highlight() {
        // 确保 TypeScript 的加入没有破坏既有的 JS/Python/Rust 等高亮
        let arena = Arena::new();
        let cases = [
            ("javascript", "const x = 1;"),
            ("python", "def foo():"),
            ("rust", "fn main() {"),
            ("java", "public class A {"),
        ];
        for (lang, code) in cases {
            let fenced = format!("```{}\n{}\n```", lang, code);
            let doc = parse_markdown(&arena, &fenced);
            let html = WechatConverter.convert(doc);
            assert!(
                html.contains("color:#a71d5d;"),
                "lang `{}` should still produce keyword highlight, got: {}",
                lang,
                html
            );
        }
    }

    #[test]
    fn test_wechat_code_block_has_macos_dots() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```rust\nfn main() {}\n```");
        let html = WechatConverter.convert(doc);
        // macOS 红绿灯三圆点：用 background-color（微信对简写 background 解析不稳定）
        assert!(html.contains("background-color:#ff5f56"), "missing red dot");
        assert!(
            html.contains("background-color:#ffbd2e"),
            "missing yellow dot"
        );
        assert!(
            html.contains("background-color:#27c93f"),
            "missing green dot"
        );
        // 圆点必须是圆形
        assert!(html.contains("border-radius:50%"));
        // 关键：微信会吞掉无文本内容的 inline 元素，圆点 span 内必须有实心圆字符 ●
        assert!(
            html.contains('\u{25CF}'),
            "dots must contain U+25CF solid circle char so WeChat keeps them"
        );
    }

    #[test]
    fn test_wechat_code_block_has_title_bar() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```rust\nfn main() {}\n```");
        let html = WechatConverter.convert(doc);
        // 浅灰标题栏（header 作为外层 section 首子元素）
        assert!(
            html.contains("background-color:#e8e8e8"),
            "missing title bar background-color"
        );
    }

    #[test]
    fn test_wechat_code_block_uses_section_container() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```rust\nfn main() {}\n```");
        let html = WechatConverter.convert(doc);
        // 外层 section 带圆角；header 与代码区都在 section 内部
        assert!(html.contains("border-radius:5px"));
    }

    #[test]
    fn test_wechat_code_block_disables_soft_wrap() {
        let arena = Arena::new();
        let doc = parse_markdown(
            &arena,
            "```java\nrecord RequestResult(int index, double elapsedSec, boolean passed) {}\n```",
        );
        let html = WechatConverter.convert(doc);
        assert!(
            html.contains("white-space:nowrap"),
            "each rendered code line should opt out of soft wrapping"
        );
        assert!(
            !html.contains("white-space:pre-wrap"),
            "pre-wrap allows WeChat to break long code lines and distort indentation"
        );
        assert!(
            html.contains("word-break:keep-all")
                && html.contains("overflow-wrap:normal")
                && html.contains("word-wrap:normal")
                && html.contains("hyphens:none"),
            "code block should explicitly disable forced word wrapping"
        );
    }

    #[test]
    fn test_wechat_code_block_uses_tighter_line_height() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```rust\nfn main() {}\n```");
        let html = WechatConverter.convert(doc);
        assert!(
            html.contains("line-height:18px"),
            "code block line-height should be compact enough for WeChat"
        );
        assert!(
            !html.contains("line-height:1.45") && !html.contains("line-height:1.6"),
            "old code block line-height was too loose in WeChat"
        );
    }

    #[test]
    fn test_wechat_code_block_code_content_preserved() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```rust\nfn main() {}\n```");
        let html = WechatConverter.convert(doc);
        // 代码内容仍被正确转义并保留在 <code> 内
        // 单词间空格被转成 U+00A0（微信兼容），所以分别断言 token
        assert!(html.contains("<code"));
        assert!(html.contains("fn"));
        assert!(html.contains("main"));
    }

    #[test]
    fn test_wechat_code_block_indent_uses_line_padding() {
        // 微信会把连续普通空格合并，甚至会让强制折行后的续行掉回最左侧。
        // 修复：前导缩进转为行容器 padding，让续行也跟随同一行的缩进。
        // 用未知语言保证走纯文本路径，避免高亮 span 干扰断言。
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```text\n    int x = 1;\n```");
        let html = WechatConverter.convert(doc);
        assert!(
            html.contains("padding:0 0 0 2.48em"),
            "4 leading spaces should become line padding, got: {}",
            html
        );
        assert!(
            !html.contains("    int"),
            "raw 4-space indent must not appear in code text"
        );
    }

    #[test]
    fn test_wechat_code_block_tab_uses_line_padding() {
        // Tab 缩进同样转成 4 列 padding。
        // 用未知语言保证走纯文本路径，避免高亮 span 干扰断言。
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```text\n\tprint('hi')\n```");
        let html = WechatConverter.convert(doc);
        assert!(
            html.contains("padding:0 0 0 2.48em"),
            "tab must be converted to 4-column line padding"
        );
    }

    #[test]
    fn test_wechat_code_block_single_space_preserved() {
        // 单个空格（单词间，如 `int x`）不会被微信合并，应保留为普通空格。
        // 把单个空格也转成 U+00A0 会导致微信里字符间距变宽、排版松散。
        // 用未知语言走纯文本路径。
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```text\nint x = 1;\n```");
        let html = WechatConverter.convert(doc);
        // `int x` 之间应是普通空格（不是 U+00A0）
        assert!(
            html.contains("int x"),
            "single space between words must stay a normal space, got: {}",
            html
        );
        assert!(
            !html.contains("int\u{00A0}x"),
            "single space must NOT become U+00A0"
        );
    }

    #[test]
    fn test_wechat_code_block_highlight_single_space_preserved() {
        // 高亮路径下，单词间单个空格同样应保留为普通空格。
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```java\npublic class A {}\n```");
        let html = WechatConverter.convert(doc);
        // public 和 class 之间（可能隔着 span 边界）应有普通空格残留。
        // 至少不应把所有空格都转成 U+00A0——断言存在普通空格。
        assert!(
            html.contains(" "),
            "highlighted output should still contain normal spaces (not all U+00A0)"
        );
    }

    #[test]
    fn test_wechat_code_block_highlight_indent_uses_line_padding() {
        // 高亮路径也应把前导缩进转成行容器 padding，避免只含空白的 span 被微信吞掉。
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```java\n    int x;\n```");
        let html = WechatConverter.convert(doc);
        assert!(
            html.contains("padding:0 0 0 2.48em"),
            "highlighted indentation should become line padding, got: {}",
            html
        );
        assert!(
            !html.contains("    int"),
            "raw 4-space indent must not appear in highlighted output"
        );
    }

    #[test]
    fn test_wechat_code_block_newline_uses_line_wrappers() {
        // 微信里 \n / <br> 的行高不可控，多行代码逐行渲染成 block 容器。
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```js\nconst a = 1;\nconst b = 2;\n```");
        let html = WechatConverter.convert(doc);
        let line_count = html
            .matches("min-height:18px;line-height:18px;margin:0")
            .count();
        assert!(
            line_count >= 2,
            "expected at least 2 code line wrappers, got {} in: {}",
            line_count,
            html
        );
        assert!(
            !html.contains("<br>"),
            "code lines should not rely on <br>, which makes WeChat line-height unstable"
        );
    }

    #[test]
    fn test_wechat_code_block_syntax_highlight_colors() {
        // 语法高亮：关键字、字符串、注释应被包进带不同颜色的 inline span。
        // 只检查 <code>...</code> 内部，避免被三圆点的颜色干扰。
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```java\npublic class A {}\n```");
        let html = WechatConverter.convert(doc);
        // 提取 <code> 和 </code> 之间的内容
        let code_inner = html
            .split("<code")
            .nth(1)
            .and_then(|s| s.split("</code>").next())
            .expect("should have a <code> block");
        let color_count = code_inner.matches("color:#").count();
        assert!(
            color_count >= 2,
            "code content should contain multiple colored spans for highlight, got {} in: {}",
            color_count,
            code_inner
        );
    }

    #[test]
    fn test_wechat_code_block_highlight_preserves_whitespace_fix() {
        // 高亮后，缩进仍必须转成行级 padding。
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```python\n    x = 1\n```");
        let html = WechatConverter.convert(doc);
        assert!(
            html.contains("padding:0 0 0 2.48em"),
            "highlighted code must still use line padding for indentation"
        );
        assert!(
            !html.contains("    x"),
            "raw 4-space indent must not appear in highlighted output"
        );
    }

    #[test]
    fn test_wechat_code_block_unknown_language_falls_back() {
        // 无法识别的语言（如乱码 lang）应回退到纯文本 + 间距处理，不崩溃。
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```nosuchlang_xyz\n    plain text\n```");
        let html = WechatConverter.convert(doc);
        assert!(html.contains("plain"));
        assert!(html.contains("padding:0 0 0 2.48em"));
    }

    #[test]
    fn test_wechat_code_block_no_double_br_between_lines() {
        // 高亮多行代码时不应依赖 <br>，避免微信里行间距被放大。
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "```java\npublic class A {\n    int x;\n}\n```");
        let html = WechatConverter.convert(doc);
        let code_inner = html
            .split("<code")
            .nth(1)
            .and_then(|s| s.split("</code>").next())
            .unwrap_or("");
        assert!(
            !code_inner.contains("<br>"),
            "code line breaks should be block wrappers instead of <br>, got: {}",
            code_inner
        );
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
