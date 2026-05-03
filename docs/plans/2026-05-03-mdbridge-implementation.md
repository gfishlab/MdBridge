# MDBridge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform (Mac + Windows) desktop Markdown editor that converts MD documents to platform-specific formats for copy-paste publishing to 7 media platforms.

**Architecture:** Tauri 2.x app with Rust backend (comrak AST parser, platform converters, image cache, clipboard) and React 18 frontend (@uiw/react-md-editor). The conversion engine walks the AST and generates platform-adapted HTML output.

**Tech Stack:** Tauri 2.x, Rust, React 18, TypeScript, @uiw/react-md-editor, comrak, arboard, tauri-plugin-updater

---

## Chunk 1: Project Setup

### Task 1: Initialize Tauri Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `index.html`
- Create: `.gitignore`

- [ ] **Step 1: Initialize Tauri 2.x project with React template**

Run from the MDBridge project root directory:

```bash
npm create tauri-app@latest . -- --template react-ts
```

> Note: This scaffolds Tauri into the current directory. If the directory is not empty, the CLI may prompt to confirm. Use `.` as the project name to scaffold in-place.

- [ ] **Step 2: Install frontend dependencies**

```bash
npm install @uiw/react-md-editor react react-dom
npm install -D @types/react @types/react-dom typescript vite @vitejs/plugin-react
```

- [ ] **Step 3: Configure Cargo.toml with Rust dependencies**

```toml
[package]
name = "mdbridge"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-updater = "2"
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
comrak = "0.28"
arboard = "3"
reqwest = { version = "0.12", features = ["rustls-tls"] }
tokio = { version = "1", features = ["full"] }
sha2 = "0.10"
dirs = "5"
image = "0.25"
base64 = "0.22"

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

- [ ] **Step 4: Configure tauri.conf.json**

> Note: The `pubkey` and `endpoints` for the updater plugin are left empty for now. Before publishing, generate a keypair with `tauri signer generate` and configure the update endpoint (GitHub Releases or self-hosted). See [Tauri Updater docs](https://v2.tauri.app/plugin/updater/).

```json
{
  "productName": "MDBridge",
  "version": "0.1.0",
  "identifier": "com.mdbridge.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "title": "MDBridge",
        "width": 1200,
        "height": 800,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "plugins": {
    "updater": {
      "pubkey": "",
      "endpoints": []
    }
  }
}
```

- [ ] **Step 5: Create build.rs**

```rust
// src-tauri/build.rs
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 6: Create .gitignore**

```gitignore
node_modules/
dist/
src-tauri/target/
.idea/
.vscode/
.DS_Store
Thumbs.db
src-tauri/gen/
.env
.env.local
```

- [ ] **Step 7: Add tray icon resource**

Place a `tray-icon.png` (32x32 or 64x64) in `src-tauri/icons/`. This is required for the system tray. Use any PNG icon for now; replace with the final icon later.

Update `tauri.conf.json` to reference it:

```json
"app": {
  "trayIcon": {
    "iconPath": "icons/tray-icon.png",
    "iconAsTemplate": true
  }
}
```

- [ ] **Step 8: Verify project compiles and runs**

```bash
npm run tauri dev
```

Expected: Window opens showing empty React app.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: initialize Tauri 2.x + React 18 project"
```

---

### Task 2: Set Up Project Structure

**Files:**
- Create: `src-tauri/src/converter/mod.rs`
- Create: `src-tauri/src/converter/ast.rs`
- Create: `src-tauri/src/converter/html.rs`
- Create: `src-tauri/src/converter/platforms/mod.rs`
- Create: `src-tauri/src/clipboard/mod.rs`
- Create: `src-tauri/src/image_cache/mod.rs`
- Create: `src-tauri/src/config/mod.rs`
- Create: `src-tauri/src/tray/mod.rs`
- Create: `src-tauri/src/tray/menu.rs`
- Create: `src-tauri/src/updater/mod.rs`
- Create: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Create Rust module files with stub implementations**

Each module file should contain a minimal stub:

```rust
// src-tauri/src/converter/mod.rs
pub mod ast;
pub mod html;
pub mod platforms;

pub fn placeholder() {}
```

```rust
// src-tauri/src/commands/mod.rs
pub fn placeholder() {}
```

```rust
// src-tauri/src/clipboard/mod.rs
pub fn placeholder() {}
```

```rust
// src-tauri/src/image_cache/mod.rs
pub fn placeholder() {}
```

```rust
// src-tauri/src/config/mod.rs
pub fn placeholder() {}
```

```rust
// src-tauri/src/tray/mod.rs
pub mod menu;
pub fn placeholder() {}
```

```rust
// src-tauri/src/updater/mod.rs
pub fn placeholder() {}
```

- [ ] **Step 2: Update lib.rs to declare modules**

```rust
// src-tauri/src/lib.rs
mod commands;
mod clipboard;
mod config;
mod converter;
mod image_cache;
mod tray;
mod updater;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Update main.rs**

```rust
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mdbridge_lib::run();
}
```

- [ ] **Step 4: Create frontend component directories**

```bash
mkdir -p src/components/Editor
mkdir -p src/components/PlatformBar
mkdir -p src/components/Settings
mkdir -p src/components/UpdateDialog
mkdir -p src/components/FileTree
```

- [ ] **Step 5: Verify project still compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: set up project module structure"
```

---

## Chunk 2: Converter Engine

### Task 3: Implement AST Parser

**Files:**
- Create: `src-tauri/src/converter/ast.rs`
- Test: `src-tauri/src/converter/ast.rs` (inline tests)

- [ ] **Step 1: Write tests for AST parsing**

```rust
// src-tauri/src/converter/ast.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_heading() {
        let md = "# Hello World";
        let arena = comrak::Arena::new();
        let doc = parse_markdown(&arena, md);
        // Walk and find heading node
        let mut found = false;
        walk_nodes(doc, |node| {
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
        walk_nodes(doc, |node| {
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
        walk_nodes(doc, |node| {
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
        walk_nodes(doc, |node| {
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
        walk_nodes(doc, |node| {
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib converter::ast::tests
```

Expected: FAIL - functions not defined.

- [ ] **Step 3: Implement AST parsing functions**

```rust
// src-tauri/src/converter/ast.rs
use comrak::nodes::{AstNode, NodeValue};
use comrak::{parse_document, Arena, Options};

pub fn parse_markdown<'a>(arena: &'a Arena<AstNode<'a>>, content: &str) -> &'a AstNode<'a> {
    let options = Options::default();
    parse_document(arena, content, &options)
}

pub fn walk_nodes<F>(node: &AstNode, mut callback: F)
where
    F: FnMut(&AstNode),
{
    callback(node);
    for child in node.children() {
        walk_nodes(child, &mut callback);
    }
}

pub fn extract_image_urls(node: &AstNode) -> Vec<String> {
    let mut urls = Vec::new();
    walk_nodes(node, |n| {
        if let NodeValue::Image(ref image) = n.data.borrow().value {
            urls.push(String::from_utf8_lossy(&image.url).to_string());
        }
    });
    urls
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib converter::ast::tests
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/converter/ast.rs
git commit -m "feat: implement AST parser with comrak"
```

---

### Task 4: Implement PlatformConverter Trait

**Files:**
- Create: `src-tauri/src/converter/platforms/mod.rs`
- Test: `src-tauri/src/converter/platforms/mod.rs` (inline tests)

- [ ] **Step 1: Write test for PlatformConverter trait**

```rust
// src-tauri/src/converter/platforms/mod.rs
#[cfg(test)]
mod tests {
    use super::*;

    struct MockConverter;
    impl PlatformConverter for MockConverter {
        fn name(&self) -> &str { "mock" }
        fn supports_external_images(&self) -> bool { true }
        fn convert(&self, _ast: &AstNode) -> String { "<p>mock</p>".into() }
    }

    #[test]
    fn test_converter_trait() {
        let converter = MockConverter;
        assert_eq!(converter.name(), "mock");
        assert!(converter.supports_external_images());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib converter::platforms::tests
```

Expected: FAIL - trait not defined.

- [ ] **Step 3: Implement PlatformConverter trait**

```rust
// src-tauri/src/converter/platforms/mod.rs
use comrak::nodes::AstNode;

pub mod wechat;
pub mod bilibili;
pub mod csdn;
pub mod douyin;
pub mod twitter;
pub mod zhihu;
pub mod juejin;

pub trait PlatformConverter {
    fn name(&self) -> &str;
    fn supports_external_images(&self) -> bool;
    fn convert(&self, ast: &AstNode) -> String;
}

pub fn get_all_converters() -> Vec<Box<dyn PlatformConverter>> {
    vec![
        Box::new(wechat::WechatConverter),
        Box::new(bilibili::BilibiliConverter),
        Box::new(csdn::CsdnConverter),
        Box::new(douyin::DouyinConverter),
        Box::new(twitter::TwitterConverter),
        Box::new(zhihu::ZhihuConverter),
        Box::new(juejin::JuejinConverter),
    ]
}

pub fn get_converter_by_name(name: &str) -> Option<Box<dyn PlatformConverter>> {
    get_all_converters().into_iter().find(|c| c.name() == name)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib converter::platforms::tests
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/converter/platforms/mod.rs
git commit -m "feat: implement PlatformConverter trait"
```

---

### Task 5: Implement Base HTML Generator

**Files:**
- Create: `src-tauri/src/converter/html.rs`
- Test: `src-tauri/src/converter/html.rs` (inline tests)

- [ ] **Step 1: Write tests for HTML generation**

```rust
// src-tauri/src/converter/html.rs
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib converter::html::tests
```

Expected: FAIL.

- [ ] **Step 3: Implement HTML generator**

```rust
// src-tauri/src/converter/html.rs
use comrak::html::format_document;
use comrak::nodes::AstNode;
use comrak::Options;

pub fn ast_to_html(node: &AstNode) -> String {
    let options = Options::default();
    let mut output = Vec::new();
    format_document(node, &options, &mut output).unwrap();
    String::from_utf8(output).unwrap()
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib converter::html::tests
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/converter/html.rs
git commit -m "feat: implement base HTML generator"
```

---

### Task 6: Implement WeChat Converter

**Files:**
- Create: `src-tauri/src/converter/platforms/wechat.rs`
- Test: `src-tauri/src/converter/platforms/wechat.rs` (inline tests)

- [ ] **Step 1: Write tests for WeChat converter**

```rust
// src-tauri/src/converter/platforms/wechat.rs
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
        // WeChat needs special code block handling
        assert!(html.contains("fn main"));
    }

    #[test]
    fn test_wechat_image_external_link() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "![alt](https://example.com/img.png)");
        let html = WechatConverter.convert(doc);
        // WeChat supports external image links
        assert!(html.contains("https://example.com/img.png"));
    }

    #[test]
    fn test_wechat_table_to_text() {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "| a | b |\n|---|---|\n| 1 | 2 |");
        let html = WechatConverter.convert(doc);
        // WeChat doesn't support tables, should convert to text
        assert!(!html.contains("<table>"));
    }

    #[test]
    fn test_wechat_supports_external_images() {
        assert!(WechatConverter.supports_external_images());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib converter::platforms::wechat
```

Expected: FAIL.

- [ ] **Step 3: Implement WeChat converter**

```rust
// src-tauri/src/converter/platforms/wechat.rs
use comrak::nodes::{AstNode, NodeValue};
use crate::converter::ast::walk_nodes;
use super::PlatformConverter;

pub struct WechatConverter;

impl PlatformConverter for WechatConverter {
    fn name(&self) -> &str {
        "wechat"
    }

    fn supports_external_images(&self) -> bool {
        true
    }

    fn convert(&self, ast: &AstNode) -> String {
        let mut html = String::new();
        walk_nodes(ast, |node| {
            let data = node.data.borrow();
            match &data.value {
                NodeValue::Document => {}
                NodeValue::Heading(heading) => {
                    let level = heading.level;
                    html.push_str(&format!("<h{}>", level));
                    collect_text(node, &mut html);
                    html.push_str(&format!("</h{}>", level));
                }
                NodeValue::Paragraph => {
                    html.push_str("<p>");
                    collect_inline(node, &mut html);
                    html.push_str("</p>");
                }
                NodeValue::CodeBlock(code_block) => {
                    let code = String::from_utf8_lossy(&code_block.literal);
                    html.push_str(&format!(
                        "<pre><code>{}</code></pre>",
                        html_escape(&code)
                    ));
                }
                NodeValue::Image(image) => {
                    let url = String::from_utf8_lossy(&image.url);
                    html.push_str(&format!("<img src=\"{}\" />", url));
                }
                NodeValue::Table(_) => {
                    // WeChat doesn't support tables, convert to text
                    html.push_str("<p>");
                    collect_table_as_text(node, &mut html);
                    html.push_str("</p>");
                }
                _ => {}
            }
        });
        html
    }
}

fn collect_text(node: &AstNode, html: &mut String) {
    for child in node.children() {
        let data = child.data.borrow();
        match &data.value {
            NodeValue::Text(text) => {
                html.push_str(&String::from_utf8_lossy(text));
            }
            _ => collect_text(child, html),
        }
    }
}

fn collect_inline(node: &AstNode, html: &mut String) {
    for child in node.children() {
        let data = child.data.borrow();
        match &data.value {
            NodeValue::Text(text) => {
                html.push_str(&String::from_utf8_lossy(text));
            }
            NodeValue::Strong => {
                html.push_str("<strong>");
                collect_inline(child, html);
                html.push_str("</strong>");
            }
            NodeValue::Emph => {
                html.push_str("<em>");
                collect_inline(child, html);
                html.push_str("</em>");
            }
            NodeValue::Link(link) => {
                let url = String::from_utf8_lossy(&link.url);
                html.push_str(&format!("<a href=\"{}\">", url));
                collect_inline(child, html);
                html.push_str("</a>");
            }
            NodeValue::Image(image) => {
                let url = String::from_utf8_lossy(&image.url);
                html.push_str(&format!("<img src=\"{}\" />", url));
            }
            NodeValue::Code(code) => {
                let code_text = String::from_utf8_lossy(&code.literal);
                html.push_str(&format!("<code>{}</code>", html_escape(&code_text)));
            }
            _ => collect_inline(child, html),
        }
    }
}

fn collect_table_as_text(node: &AstNode, html: &mut String) {
    walk_nodes(node, |n| {
        let data = n.data.borrow();
        if let NodeValue::Text(text) = &data.value {
            html.push_str(&String::from_utf8_lossy(text));
            html.push(' ');
        }
    });
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib converter::platforms::wechat
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/converter/platforms/wechat.rs
git commit -m "feat: implement WeChat platform converter"
```

---

### Task 7: Implement Remaining Platform Converters

**Files:**
- Create: `src-tauri/src/converter/platforms/bilibili.rs`
- Create: `src-tauri/src/converter/platforms/csdn.rs`
- Create: `src-tauri/src/converter/platforms/douyin.rs`
- Create: `src-tauri/src/converter/platforms/twitter.rs`
- Create: `src-tauri/src/converter/platforms/zhihu.rs`
- Create: `src-tauri/src/converter/platforms/juejin.rs`

- [ ] **Step 1: Implement B站专栏 converter**

```rust
// src-tauri/src/converter/platforms/bilibili.rs
use comrak::nodes::AstNode;
use super::PlatformConverter;
use crate::converter::html::ast_to_html;

pub struct BilibiliConverter;

impl PlatformConverter for BilibiliConverter {
    fn name(&self) -> &str { "bilibili" }
    fn supports_external_images(&self) -> bool { false }

    fn convert(&self, ast: &AstNode) -> String {
        // B站 supports most MD elements, images need embedding
        let html = ast_to_html(ast);
        html
    }
}
```

- [ ] **Step 2: Implement CSDN converter**

```rust
// src-tauri/src/converter/platforms/csdn.rs
use comrak::nodes::AstNode;
use super::PlatformConverter;
use crate::converter::html::ast_to_html;

pub struct CsdnConverter;

impl PlatformConverter for CsdnConverter {
    fn name(&self) -> &str { "csdn" }
    fn supports_external_images(&self) -> bool { false }

    fn convert(&self, ast: &AstNode) -> String {
        let html = ast_to_html(ast);
        html
    }
}
```

- [ ] **Step 3: Implement 抖音/小红书 converter**

```rust
// src-tauri/src/converter/platforms/douyin.rs
use comrak::nodes::{AstNode, NodeValue};
use super::PlatformConverter;
use crate::converter::ast::walk_nodes;

pub struct DouyinConverter;

impl PlatformConverter for DouyinConverter {
    fn name(&self) -> &str { "douyin" }
    fn supports_external_images(&self) -> bool { false }

    fn convert(&self, ast: &AstNode) -> String {
        // 抖音/小红书: plain text only, no HTML
        let mut text = String::new();
        walk_nodes(ast, |node| {
            let data = node.data.borrow();
            match &data.value {
                NodeValue::Text(t) => text.push_str(&String::from_utf8_lossy(t)),
                NodeValue::Linebreak => text.push('\n'),
                NodeValue::Softbreak => text.push(' '),
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

fn collect_plain_text(node: &AstNode, text: &mut String) {
    for child in node.children() {
        let data = child.data.borrow();
        match &data.value {
            NodeValue::Text(t) => text.push_str(&String::from_utf8_lossy(t)),
            NodeValue::Softbreak => text.push(' '),
            NodeValue::Linebreak => text.push('\n'),
            _ => collect_plain_text(child, text),
        }
    }
}
```

- [ ] **Step 4: Implement 推特 converter**

```rust
// src-tauri/src/converter/platforms/twitter.rs
use comrak::nodes::{AstNode, NodeValue};
use super::PlatformConverter;
use crate::converter::ast::walk_nodes;

pub struct TwitterConverter;

impl PlatformConverter for TwitterConverter {
    fn name(&self) -> &str { "twitter" }
    fn supports_external_images(&self) -> bool { false }

    fn convert(&self, ast: &AstNode) -> String {
        // Twitter: plain text, no HTML
        let mut text = String::new();
        walk_nodes(ast, |node| {
            let data = node.data.borrow();
            match &data.value {
                NodeValue::Text(t) => text.push_str(&String::from_utf8_lossy(t)),
                NodeValue::Linebreak => text.push('\n'),
                NodeValue::Softbreak => text.push(' '),
                NodeValue::Link(link) => {
                    let url = String::from_utf8_lossy(&link.url);
                    text.push_str(&url);
                }
                _ => {
                    if let NodeValue::Paragraph | NodeValue::Heading(_) = &data.value {
                        for child in node.children() {
                            collect_twitter_text(child, &mut text);
                        }
                        text.push('\n');
                    }
                }
            }
        });
        text.trim().to_string()
    }
}

fn collect_twitter_text(node: &AstNode, text: &mut String) {
    for child in node.children() {
        let data = child.data.borrow();
        match &data.value {
            NodeValue::Text(t) => text.push_str(&String::from_utf8_lossy(t)),
            NodeValue::Softbreak => text.push(' '),
            NodeValue::Link(link) => {
                let url = String::from_utf8_lossy(&link.url);
                text.push_str(&url);
            }
            _ => collect_twitter_text(child, text),
        }
    }
}
```

- [ ] **Step 5: Implement 知乎 converter**

```rust
// src-tauri/src/converter/platforms/zhihu.rs
use comrak::nodes::AstNode;
use super::PlatformConverter;
use crate::converter::html::ast_to_html;

pub struct ZhihuConverter;

impl PlatformConverter for ZhihuConverter {
    fn name(&self) -> &str { "zhihu" }
    fn supports_external_images(&self) -> bool { true }

    fn convert(&self, ast: &AstNode) -> String {
        ast_to_html(ast)
    }
}
```

- [ ] **Step 6: Implement 掘金 converter**

```rust
// src-tauri/src/converter/platforms/juejin.rs
use comrak::nodes::AstNode;
use super::PlatformConverter;
use crate::converter::html::ast_to_html;

pub struct JuejinConverter;

impl PlatformConverter for JuejinConverter {
    fn name(&self) -> &str { "juejin" }
    fn supports_external_images(&self) -> bool { true }

    fn convert(&self, ast: &AstNode) -> String {
        ast_to_html(ast)
    }
}
```

- [ ] **Step 7: Verify all converters compile**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/converter/platforms/
git commit -m "feat: implement all 7 platform converters"
```

---

## Chunk 3: Image Cache & Clipboard

### Task 8: Implement Image Cache

**Files:**
- Create: `src-tauri/src/image_cache/mod.rs`
- Test: `src-tauri/src/image_cache/mod.rs` (inline tests)

- [ ] **Step 1: Write tests for image cache**

```rust
// src-tauri/src/image_cache/mod.rs
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_cache_directory_creation() {
        let cache = ImageCache::new(Some(1024 * 1024)); // 1MB
        assert!(cache.cache_dir().exists());
    }

    #[test]
    fn test_hash_url() {
        let hash = hash_url("https://example.com/img.png");
        assert!(!hash.is_empty());
        assert_eq!(hash.len(), 64); // SHA256 hex
    }

    #[test]
    fn test_cache_hit() {
        let cache = ImageCache::new(Some(1024 * 1024));
        let url = "https://example.com/test.png";
        let data = b"fake image data";

        // First access: miss
        assert!(cache.get(url).is_none());

        // Store
        cache.put(url, data).unwrap();

        // Second access: hit
        let cached = cache.get(url);
        assert!(cached.is_some());
        assert_eq!(cached.unwrap(), data);

        // Cleanup
        cache.clear().unwrap();
    }

    #[test]
    fn test_lru_eviction() {
        // 10 byte cache, two 6-byte items
        let cache = ImageCache::new(Some(10));
        cache.put("a", b"aaaaaa").unwrap();
        cache.put("b", b"bbbbbb").unwrap();
        // "a" should be evicted
        assert!(cache.get("a").is_none());
        assert!(cache.get("b").is_some());
        cache.clear().unwrap();
    }

    #[test]
    fn test_clear_cache() {
        let cache = ImageCache::new(Some(1024 * 1024));
        cache.put("x", b"data").unwrap();
        cache.clear().unwrap();
        assert!(cache.get("x").is_none());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib image_cache::tests
```

Expected: FAIL.

- [ ] **Step 3: Implement ImageCache**

```rust
// src-tauri/src/image_cache/mod.rs
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;

pub struct ImageCache {
    cache_dir: PathBuf,
    max_size: u64,
    index: HashMap<String, CacheEntry>,
}

struct CacheEntry {
    path: PathBuf,
    size: u64,
    last_accessed: SystemTime,
}

impl ImageCache {
    pub fn new(max_size: Option<u64>) -> Self {
        let cache_dir = dirs::cache_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join("mdbridge")
            .join("images");
        fs::create_dir_all(&cache_dir).unwrap();

        let mut cache = ImageCache {
            cache_dir,
            max_size: max_size.unwrap_or(500 * 1024 * 1024), // 500MB default
            index: HashMap::new(),
        };
        cache.load_index();
        cache
    }

    pub fn cache_dir(&self) -> &PathBuf {
        &self.cache_dir
    }

    pub fn get(&self, url: &str) -> Option<Vec<u8>> {
        let key = hash_url(url);
        if let Some(entry) = self.index.get(&key) {
            if let Ok(data) = fs::read(&entry.path) {
                return Some(data);
            }
        }
        None
    }

    pub fn put(&mut self, url: &str, data: &[u8]) -> Result<(), String> {
        let key = hash_url(url);
        let path = self.cache_dir.join(&key);

        // Check if we need to evict
        self.evict_if_needed(data.len() as u64);

        fs::write(&path, data).map_err(|e| e.to_string())?;

        self.index.insert(
            key,
            CacheEntry {
                path,
                size: data.len() as u64,
                last_accessed: SystemTime::now(),
            },
        );
        Ok(())
    }

    pub fn clear(&self) -> Result<(), String> {
        fs::remove_dir_all(&self.cache_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&self.cache_dir).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn evict_if_needed(&mut self, new_size: u64) {
        let current_size: u64 = self.index.values().map(|e| e.size).sum();
        if current_size + new_size <= self.max_size {
            return;
        }

        // Sort by last_accessed (oldest first)
        let mut entries: Vec<_> = self.index.iter().collect();
        entries.sort_by_key(|(_, e)| e.last_accessed);

        let mut freed = 0u64;
        let needed = (current_size + new_size).saturating_sub(self.max_size);
        let mut to_remove = Vec::new();

        for (key, entry) in entries {
            if freed >= needed {
                break;
            }
            freed += entry.size;
            to_remove.push(key.clone());
        }

        for key in to_remove {
            if let Some(entry) = self.index.remove(&key) {
                let _ = fs::remove_file(entry.path);
            }
        }
    }

    fn load_index(&mut self) {
        // Rebuild index from disk on startup
        if let Ok(entries) = fs::read_dir(&self.cache_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let key = path.file_name().unwrap().to_string_lossy().to_string();
                    let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                    let last_accessed = fs::metadata(&path)
                        .and_then(|m| m.modified())
                        .unwrap_or(SystemTime::now());
                    self.index.insert(key, CacheEntry { path, size, last_accessed });
                }
            }
        }
    }
}

pub fn hash_url(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    format!("{:x}", hasher.finalize())
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib image_cache::tests
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/image_cache/mod.rs
git commit -m "feat: implement image disk cache with LRU eviction"
```

---

### Task 9: Implement Clipboard Manager

**Files:**
- Create: `src-tauri/src/clipboard/mod.rs`
- Test: `src-tauri/src/clipboard/mod.rs` (inline tests)

- [ ] **Step 1: Write tests for clipboard**

```rust
// src-tauri/src/clipboard/mod.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clipboard_text() {
        let result = copy_text("Hello World");
        assert!(result.is_ok());
    }

    #[test]
    fn test_clipboard_html() {
        let result = copy_html("<p>Hello</p>");
        assert!(result.is_ok());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib clipboard::tests
```

Expected: FAIL.

- [ ] **Step 3: Implement clipboard manager**

```rust
// src-tauri/src/clipboard/mod.rs
use arboard::Clipboard;

pub fn copy_text(text: &str) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text.to_string()).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn copy_html(html: &str) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_html(html, None).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn copy_rich_text(html: &str, plain_text: &str) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_html(html, Some(plain_text)).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib clipboard::tests
```

Expected: All 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/clipboard/mod.rs
git commit -m "feat: implement clipboard manager with rich text support"
```

---

### Task 10: Implement Config Module

**Files:**
- Create: `src-tauri/src/config/mod.rs`

- [ ] **Step 1: Implement config module**

```rust
// src-tauri/src/config/mod.rs
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub image_cache_size_mb: u64,
    pub default_platform: String,
    pub check_updates_on_startup: bool,
    pub recent_files: Vec<String>,
    pub recent_folders: Vec<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            image_cache_size_mb: 500,
            default_platform: "wechat".into(),
            check_updates_on_startup: true,
            recent_files: Vec::new(),
            recent_folders: Vec::new(),
        }
    }
}

impl AppConfig {
    pub fn load() -> Self {
        let path = config_path();
        if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            let config = AppConfig::default();
            config.save();
            config
        }
    }

    pub fn save(&self) {
        let path = config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).ok();
        }
        fs::write(&path, serde_json::to_string_pretty(self).unwrap()).ok();
    }
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("mdbridge")
        .join("config.json")
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/config/mod.rs
git commit -m "feat: implement config module"
```

---

## Chunk 4: Tauri Commands & Frontend

### Task 11: Implement Tauri Commands

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement Tauri commands**

```rust
// src-tauri/src/commands/mod.rs
use crate::clipboard;
use crate::config::AppConfig;
use crate::converter::ast::{parse_markdown, extract_image_urls};
use crate::converter::html::ast_to_html;
use crate::converter::platforms;
use crate::image_cache::ImageCache;
use comrak::Arena;
use serde::Serialize;
use std::fs;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub image_cache: Mutex<ImageCache>,
}

#[derive(Serialize)]
pub struct PlatformInfo {
    pub name: String,
    pub display_name: String,
    pub supports_external_images: bool,
}

#[tauri::command]
pub fn get_platforms() -> Vec<PlatformInfo> {
    vec![
        PlatformInfo { name: "wechat".into(), display_name: "微信公众号".into(), supports_external_images: true },
        PlatformInfo { name: "bilibili".into(), display_name: "B站专栏".into(), supports_external_images: false },
        PlatformInfo { name: "csdn".into(), display_name: "CSDN".into(), supports_external_images: false },
        PlatformInfo { name: "douyin".into(), display_name: "抖音/小红书".into(), supports_external_images: false },
        PlatformInfo { name: "twitter".into(), display_name: "推特".into(), supports_external_images: false },
        PlatformInfo { name: "zhihu".into(), display_name: "知乎".into(), supports_external_images: true },
        PlatformInfo { name: "juejin".into(), display_name: "掘金".into(), supports_external_images: true },
    ]
}

#[tauri::command]
pub async fn convert_and_copy(
    markdown: String,
    platform: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let arena = Arena::new();
    let doc = parse_markdown(&arena, &markdown);

    let converter = platforms::get_converter_by_name(&platform)
        .ok_or_else(|| format!("Unknown platform: {}", platform))?;

    let html = converter.convert(doc);

    if converter.supports_external_images() {
        clipboard::copy_html(&html)?;
    } else {
        // For platforms that need embedded images, download and embed
        let image_urls = extract_image_urls(doc);
        let mut final_html = html.clone();

        let cache = state.image_cache.lock().unwrap();
        for url in &image_urls {
            if let Some(data) = cache.get(url) {
                let base64 = base64_encode(&data);
                let mime = detect_mime(url);
                let data_url = format!("data:{};base64,{}", mime, base64);
                final_html = final_html.replace(url, &data_url);
            } else {
                // Download image
                match reqwest::get(url).await {
                    Ok(resp) => {
                        if let Ok(bytes) = resp.bytes().await {
                            let _ = cache.put(url, &bytes);
                            let base64 = base64_encode(&bytes);
                            let mime = detect_mime(url);
                            let data_url = format!("data:{};base64,{}", mime, base64);
                            final_html = final_html.replace(url, &data_url);
                        }
                    }
                    Err(_) => {
                        // Keep original URL on failure
                    }
                }
            }
        }
        drop(cache);

        clipboard::copy_html(&final_html)?;
    }

    // Update last used platform
    let mut config = state.config.lock().unwrap();
    config.default_platform = platform;
    config.save();

    Ok("已复制到剪贴板".into())
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_folder(path: String) -> Result<Vec<FileInfo>, String> {
    let mut files = Vec::new();
    read_folder_recursive(&path, &mut files)?;
    Ok(files)
}

#[derive(Serialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileInfo>>,
}

fn read_folder_recursive(path: &str, files: &mut Vec<FileInfo>) -> Result<(), String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let entry_path = entry.path().to_string_lossy().to_string();

        if metadata.is_dir() {
            let mut children = Vec::new();
            read_folder_recursive(&entry_path, &mut children)?;
            files.push(FileInfo {
                name,
                path: entry_path,
                is_dir: true,
                children: Some(children),
            });
        } else if name.ends_with(".md") {
            files.push(FileInfo {
                name,
                path: entry_path,
                is_dir: false,
                children: None,
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn update_config(updates: serde_json::Value, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    if let Some(cache_size) = updates.get("image_cache_size_mb").and_then(|v| v.as_u64()) {
        config.image_cache_size_mb = cache_size;
    }
    if let Some(platform) = updates.get("default_platform").and_then(|v| v.as_str()) {
        config.default_platform = platform.to_string();
    }
    if let Some(check) = updates.get("check_updates_on_startup").and_then(|v| v.as_bool()) {
        config.check_updates_on_startup = check;
    }
    config.save();
    Ok(())
}

#[tauri::command]
pub fn clear_image_cache(state: State<'_, AppState>) -> Result<(), String> {
    let cache = state.image_cache.lock().unwrap();
    cache.clear()
}

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn detect_mime(url: &str) -> &str {
    if url.ends_with(".png") { "image/png" }
    else if url.ends_with(".gif") { "image/gif" }
    else if url.ends_with(".webp") { "image/webp" }
    else { "image/jpeg" }
}
```

- [ ] **Step 2: Update lib.rs to register commands**

```rust
// src-tauri/src/lib.rs
mod commands;
mod clipboard;
mod config;
mod converter;
mod image_cache;
mod tray;
mod updater;

use commands::AppState;
use config::AppConfig;
use image_cache::ImageCache;
use std::sync::Mutex;

pub fn run() {
    let config = AppConfig::load();
    let cache_size = Some(config.image_cache_size_mb * 1024 * 1024);

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            config: Mutex::new(config),
            image_cache: Mutex::new(ImageCache::new(cache_size)),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_platforms,
            commands::convert_and_copy,
            commands::read_file,
            commands::write_file,
            commands::read_folder,
            commands::get_config,
            commands::update_config,
            commands::clear_image_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat: implement Tauri commands for frontend-backend bridge"
```

---

### Task 12: Implement Frontend - Editor Component

**Files:**
- Create: `src/components/Editor/Editor.tsx`
- Create: `src/components/Editor/index.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Install frontend dependencies**

```bash
npm install @uiw/react-md-editor
```

- [ ] **Step 2: Create Editor component**

```tsx
// src/components/Editor/Editor.tsx
import MDEditor from '@uiw/react-md-editor';

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  viewMode: 'edit' | 'preview' | 'split';
}

export function Editor({ value, onChange, viewMode }: EditorProps) {
  const getPreview = () => {
    switch (viewMode) {
      case 'edit': return 'edit';
      case 'preview': return 'preview';
      case 'split': return 'live';
    }
  };

  return (
    <div className="editor-container" data-color-mode="light">
      <MDEditor
        value={value}
        onChange={(val) => onChange(val || '')}
        preview={getPreview()}
        height="100%"
        visibleDragbar={false}
      />
    </div>
  );
}
```

```tsx
// src/components/Editor/index.ts
export { Editor } from './Editor';
```

- [ ] **Step 3: Update App.tsx with basic layout**

```tsx
// src/App.tsx
import { useState } from 'react';
import { Editor } from './components/Editor';
import './App.css';

function App() {
  const [markdown, setMarkdown] = useState('# Hello MdBridge\n\nStart writing...');
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('split');

  return (
    <div className="app">
      <header className="toolbar">
        <span className="app-name">MdBridge</span>
        <div className="toolbar-center">
          {/* File and Publish menus will go here */}
        </div>
        <div className="view-toggle">
          <button
            className={viewMode === 'edit' ? 'active' : ''}
            onClick={() => setViewMode('edit')}
            title="编辑模式"
          >✏️</button>
          <button
            className={viewMode === 'split' ? 'active' : ''}
            onClick={() => setViewMode('split')}
            title="并排模式"
          >↔️</button>
          <button
            className={viewMode === 'preview' ? 'active' : ''}
            onClick={() => setViewMode('preview')}
            title="预览模式"
          >👁</button>
        </div>
      </header>
      <main className="content">
        <Editor value={markdown} onChange={setMarkdown} viewMode={viewMode} />
      </main>
      <footer className="status-bar">
        <span className="status-message"></span>
      </footer>
    </div>
  );
}

export default App;
```

- [ ] **Step 4: Add basic CSS**

```css
/* src/App.css */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid #e0e0e0;
  background: #fafafa;
  -webkit-app-region: drag;
}

.app-name {
  font-weight: 600;
  font-size: 14px;
}

.toolbar-center {
  display: flex;
  gap: 8px;
  -webkit-app-region: no-drag;
}

.view-toggle {
  display: flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.view-toggle button {
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 14px;
}

.view-toggle button:hover {
  background: #e0e0e0;
}

.view-toggle button.active {
  background: #d0d0d0;
  border-color: #b0b0b0;
}

.content {
  flex: 1;
  overflow: hidden;
}

.editor-container {
  height: 100%;
}

.status-bar {
  padding: 4px 16px;
  border-top: 1px solid #e0e0e0;
  background: #fafafa;
  font-size: 12px;
  color: #666;
}
```

- [ ] **Step 5: Verify frontend renders**

```bash
npm run dev
```

Expected: Browser shows editor with toolbar.

- [ ] **Step 6: Commit**

```bash
git add src/components/Editor/ src/App.tsx src/App.css
git commit -m "feat: implement basic editor component with view modes"
```

---

### Task 13: Implement Platform Bar & Publish Menu

**Files:**
- Create: `src/components/PlatformBar/PlatformBar.tsx`
- Create: `src/components/PlatformBar/index.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create PlatformBar component**

```tsx
// src/components/PlatformBar/PlatformBar.tsx
import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Platform {
  name: string;
  display_name: string;
  supports_external_images: boolean;
}

interface PlatformBarProps {
  markdown: string;
  onStatusChange: (message: string) => void;
}

export function PlatformBar({ markdown, onStatusChange }: PlatformBarProps) {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<Platform[]>('get_platforms').then(setPlatforms);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePublish = async (platform: string) => {
    setIsOpen(false);
    try {
      const result = await invoke<string>('convert_and_copy', {
        markdown,
        platform,
      });
      onStatusChange(result);
    } catch (err) {
      onStatusChange(`错误: ${err}`);
    }
  };

  return (
    <div className="platform-bar" ref={menuRef}>
      <button
        className="publish-btn"
        onClick={() => setIsOpen(!isOpen)}
      >
        发布 ▾
      </button>
      {isOpen && (
        <div className="publish-menu">
          {platforms.map((p) => (
            <button
              key={p.name}
              className="platform-item"
              onClick={() => handlePublish(p.name)}
            >
              {p.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

```tsx
// src/components/PlatformBar/index.ts
export { PlatformBar } from './PlatformBar';
```

- [ ] **Step 2: Update App.tsx to include PlatformBar**

```tsx
// src/App.tsx
import { useState } from 'react';
import { Editor } from './components/Editor';
import { PlatformBar } from './components/PlatformBar';
import './App.css';

function App() {
  const [markdown, setMarkdown] = useState('# Hello MdBridge\n\nStart writing...');
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('split');
  const [statusMessage, setStatusMessage] = useState('');

  return (
    <div className="app">
      <header className="toolbar">
        <span className="app-name">MdBridge</span>
        <div className="toolbar-center">
          <PlatformBar markdown={markdown} onStatusChange={setStatusMessage} />
        </div>
        <div className="view-toggle">
          <button
            className={viewMode === 'edit' ? 'active' : ''}
            onClick={() => setViewMode('edit')}
            title="编辑模式"
          >✏️</button>
          <button
            className={viewMode === 'split' ? 'active' : ''}
            onClick={() => setViewMode('split')}
            title="并排模式"
          >↔️</button>
          <button
            className={viewMode === 'preview' ? 'active' : ''}
            onClick={() => setViewMode('preview')}
            title="预览模式"
          >👁</button>
        </div>
      </header>
      <main className="content">
        <Editor value={markdown} onChange={setMarkdown} viewMode={viewMode} />
      </main>
      <footer className="status-bar">
        <span className="status-message">{statusMessage}</span>
      </footer>
    </div>
  );
}

export default App;
```

- [ ] **Step 3: Add PlatformBar CSS**

```css
/* Add to App.css */
.platform-bar {
  position: relative;
}

.publish-btn {
  background: #1890ff;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 6px 16px;
  cursor: pointer;
  font-size: 13px;
}

.publish-btn:hover {
  background: #40a9ff;
}

.publish-menu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  z-index: 100;
  min-width: 120px;
}

.platform-item {
  display: block;
  width: 100%;
  padding: 8px 16px;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
}

.platform-item:hover {
  background: #f0f0f0;
}
```

- [ ] **Step 4: Verify publish menu works**

```bash
npm run dev
```

Expected: Click "发布" shows dropdown with 7 platforms.

- [ ] **Step 5: Commit**

```bash
git add src/components/PlatformBar/ src/App.tsx src/App.css
git commit -m "feat: implement publish menu with platform selection"
```

---

## Chunk 5: System Features

### Task 14: Implement File Management

**Files:**
- Create: `src/components/FileTree/FileTree.tsx`
- Create: `src/components/FileTree/index.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create FileTree component**

```tsx
// src/components/FileTree/FileTree.tsx
import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect } from 'react';

interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileInfo[];
}

interface FileTreeProps {
  folderPath: string;
  onFileSelect: (path: string) => void;
  currentFile: string;
}

export function FileTree({ folderPath, onFileSelect, currentFile }: FileTreeProps) {
  const [files, setFiles] = useState<FileInfo[]>([]);

  useEffect(() => {
    if (folderPath) {
      invoke<FileInfo[]>('read_folder', { path: folderPath }).then(setFiles);
    }
  }, [folderPath]);

  return (
    <div className="file-tree">
      {files.map((file) => (
        <FileNode
          key={file.path}
          file={file}
          onFileSelect={onFileSelect}
          currentFile={currentFile}
          depth={0}
        />
      ))}
    </div>
  );
}

function FileNode({
  file,
  onFileSelect,
  currentFile,
  depth,
}: {
  file: FileInfo;
  onFileSelect: (path: string) => void;
  currentFile: string;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);

  if (file.is_dir) {
    return (
      <div>
        <div
          className="tree-item dir"
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '▼' : '▶'} {file.name}
        </div>
        {expanded &&
          file.children?.map((child) => (
            <FileNode
              key={child.path}
              file={child}
              onFileSelect={onFileSelect}
              currentFile={currentFile}
              depth={depth + 1}
            />
          ))}
      </div>
    );
  }

  return (
    <div
      className={`tree-item file ${file.path === currentFile ? 'active' : ''}`}
      style={{ paddingLeft: depth * 16 + 8 }}
      onClick={() => onFileSelect(file.path)}
    >
      📄 {file.name}
    </div>
  );
}
```

```tsx
// src/components/FileTree/index.ts
export { FileTree } from './FileTree';
```

- [ ] **Step 2: Update App.tsx with file management**

```tsx
// src/App.tsx - key changes
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Editor } from './components/Editor';
import { PlatformBar } from './components/PlatformBar';
import { FileTree } from './components/FileTree';
import './App.css';

function App() {
  const [markdown, setMarkdown] = useState('# Hello MdBridge\n\nStart writing...');
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('split');
  const [statusMessage, setStatusMessage] = useState('');
  const [currentFile, setCurrentFile] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [showFileTree, setShowFileTree] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);

  const handleOpenFile = async () => {
    const selected = await open({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (selected) {
      const content = await invoke<string>('read_file', { path: selected });
      setMarkdown(content);
      setCurrentFile(selected as string);
      setShowFileMenu(false);
    }
  };

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true });
    if (selected) {
      setFolderPath(selected as string);
      setShowFileTree(true);
      setShowFileMenu(false);
    }
  };

  const handleFileSelect = async (path: string) => {
    const content = await invoke<string>('read_file', { path });
    setMarkdown(content);
    setCurrentFile(path);
  };

  const handleSave = async () => {
    if (currentFile) {
      await invoke('write_file', { path: currentFile, content: markdown });
      setStatusMessage('已保存');
    } else {
      const selected = await open({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (selected) {
        await invoke('write_file', { path: selected, content: markdown });
        setCurrentFile(selected as string);
        setStatusMessage('已保存');
      }
    }
    setShowFileMenu(false);
  };

  // ... rest of the component with file menu and file tree sidebar
}

export default App;
```

- [ ] **Step 3: Add FileTree CSS**

```css
/* Add to App.css */
.file-tree {
  width: 240px;
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
  background: #fafafa;
}

.tree-item {
  padding: 4px 8px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-item:hover {
  background: #e8e8e8;
}

.tree-item.active {
  background: #d0e8ff;
}

.tree-item.dir {
  font-weight: 500;
}

.file-menu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  z-index: 100;
  min-width: 140px;
}

.file-menu button {
  display: block;
  width: 100%;
  padding: 8px 16px;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
}

.file-menu button:hover {
  background: #f0f0f0;
}
```

- [ ] **Step 4: Install dialog plugin**

```bash
npm install @tauri-apps/plugin-dialog
```

- [ ] **Step 5: Verify file operations work**

```bash
npm run dev
```

Expected: Can open .md files and folders.

- [ ] **Step 6: Commit**

```bash
git add src/components/FileTree/ src/App.tsx src/App.css package.json
git commit -m "feat: implement file management with folder tree"
```

---

### Task 15: Implement System Tray

**Files:**
- Create: `src-tauri/src/tray/mod.rs`
- Create: `src-tauri/src/tray/menu.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement tray module**

```rust
// src-tauri/src/tray/mod.rs
pub mod menu;

use tauri::{
    AppHandle, Manager,
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
};

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let tray_menu = menu::build_tray_menu(app)?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&tray_menu)
        .on_menu_event(move |app, event| {
            menu::handle_tray_menu_event(app, event);
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
```

```rust
// src-tauri/src/tray/menu.rs
use tauri::{
    AppHandle, Manager,
    menu::{Menu, MenuItem},
    tray::TrayIconId,
};

pub fn build_tray_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "打开主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &quit])?;
    Ok(menu)
}

pub fn handle_tray_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "show" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}
```

- [ ] **Step 2: Update lib.rs to setup tray**

```rust
// src-tauri/src/lib.rs - update run()
pub fn run() {
    let config = AppConfig::load();
    let cache_size = Some(config.image_cache_size_mb * 1024 * 1024);

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            config: Mutex::new(config),
            image_cache: Mutex::new(ImageCache::new(cache_size)),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_platforms,
            commands::convert_and_copy,
            commands::read_file,
            commands::write_file,
            commands::read_folder,
            commands::get_config,
            commands::update_config,
            commands::clear_image_cache,
        ])
        .setup(|app| {
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Hide to tray instead of closing
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Verify tray works**

```bash
npm run tauri dev
```

Expected: App minimizes to tray on close, tray menu works.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/tray/ src-tauri/src/lib.rs
git commit -m "feat: implement system tray with hide-on-close"
```

---

### Task 16: Implement Auto Updater

**Files:**
- Create: `src-tauri/src/updater/mod.rs`
- Create: `src/components/UpdateDialog/UpdateDialog.tsx`
- Create: `src/components/UpdateDialog/index.ts`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement updater module**

```rust
// src-tauri/src/updater/mod.rs
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

pub async fn check_for_updates(app: AppHandle) -> Result<bool, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    match update {
        Some(update) => {
            // Notify frontend about available update
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("update-available", UpdateInfo {
                    version: update.version.clone(),
                    body: update.body.clone().unwrap_or_default(),
                });
            }
            Ok(true)
        }
        None => Ok(false),
    }
}

#[derive(serde::Serialize, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub body: String,
}
```

- [ ] **Step 2: Create UpdateDialog component**

```tsx
// src/components/UpdateDialog/UpdateDialog.tsx
import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface UpdateInfo {
  version: string;
  body: string;
}

export function UpdateDialog() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const unlisten = listen<UpdateInfo>('update-available', (event) => {
      setUpdate(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleUpdate = async () => {
    setDownloading(true);
    // Trigger update download and install
    // This will be handled by tauri-plugin-updater
    try {
      await invoke('install_update');
      setUpdate(null);
    } catch (err) {
      console.error('Update failed:', err);
    }
    setDownloading(false);
  };

  if (!update) return null;

  return (
    <div className="update-overlay">
      <div className="update-dialog">
        <h3>发现新版本 v{update.version}</h3>
        <p>{update.body}</p>
        <div className="update-actions">
          <button onClick={() => setUpdate(null)}>稍后</button>
          <button onClick={handleUpdate} disabled={downloading}>
            {downloading ? '下载中...' : '立即更新'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

```tsx
// src/components/UpdateDialog/index.ts
export { UpdateDialog } from './UpdateDialog';
```

- [ ] **Step 3: Add UpdateDialog to App.tsx**

```tsx
// In App.tsx, add:
import { UpdateDialog } from './components/UpdateDialog';

// Inside the return:
<UpdateDialog />
```

- [ ] **Step 4: Add UpdateDialog CSS**

```css
/* Add to App.css */
.update-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.update-dialog {
  background: white;
  border-radius: 8px;
  padding: 24px;
  max-width: 400px;
  width: 90%;
}

.update-dialog h3 {
  margin-bottom: 12px;
}

.update-dialog p {
  margin-bottom: 16px;
  color: #666;
}

.update-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.update-actions button {
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid #d9d9d9;
  cursor: pointer;
}

.update-actions button:last-child {
  background: #1890ff;
  color: white;
  border-color: #1890ff;
}
```

- [ ] **Step 5: Verify updater compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/updater/ src/components/UpdateDialog/ src/App.tsx src/App.css
git commit -m "feat: implement auto updater with update dialog"
```

---

### Task 17: Implement Settings Page

**Files:**
- Create: `src/components/Settings/Settings.tsx`
- Create: `src/components/Settings/index.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create Settings component**

```tsx
// src/components/Settings/Settings.tsx
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Config {
  image_cache_size_mb: number;
  default_platform: string;
  check_updates_on_startup: boolean;
}

interface SettingsProps {
  onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [cacheClearing, setCacheClearing] = useState(false);

  useEffect(() => {
    invoke<Config>('get_config').then(setConfig);
  }, []);

  const handleSave = async () => {
    if (config) {
      await invoke('update_config', { updates: config });
      onClose();
    }
  };

  const handleClearCache = async () => {
    setCacheClearing(true);
    await invoke('clear_image_cache');
    setCacheClearing(false);
  };

  if (!config) return null;

  return (
    <div className="settings-overlay">
      <div className="settings-dialog">
        <h3>设置</h3>

        <div className="setting-item">
          <label>图片缓存大小 (MB)</label>
          <input
            type="number"
            value={config.image_cache_size_mb}
            onChange={(e) =>
              setConfig({ ...config, image_cache_size_mb: Number(e.target.value) })
            }
          />
        </div>

        <div className="setting-item">
          <label>默认发布平台</label>
          <select
            value={config.default_platform}
            onChange={(e) =>
              setConfig({ ...config, default_platform: e.target.value })
            }
          >
            <option value="wechat">微信公众号</option>
            <option value="bilibili">B站专栏</option>
            <option value="csdn">CSDN</option>
            <option value="douyin">抖音/小红书</option>
            <option value="twitter">推特</option>
            <option value="zhihu">知乎</option>
            <option value="juejin">掘金</option>
          </select>
        </div>

        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={config.check_updates_on_startup}
              onChange={(e) =>
                setConfig({ ...config, check_updates_on_startup: e.target.checked })
              }
            />
            启动时检查更新
          </label>
        </div>

        <div className="setting-item">
          <button onClick={handleClearCache} disabled={cacheClearing}>
            {cacheClearing ? '清理中...' : '清除图片缓存'}
          </button>
        </div>

        <div className="settings-actions">
          <button onClick={onClose}>取消</button>
          <button onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
}
```

```tsx
// src/components/Settings/index.ts
export { Settings } from './Settings';
```

- [ ] **Step 2: Add Settings to App.tsx**

```tsx
// In App.tsx, add state and component:
const [showSettings, setShowSettings] = useState(false);

// In toolbar:
<button onClick={() => setShowSettings(true)}>⚙️</button>

// In render:
{showSettings && <Settings onClose={() => setShowSettings(false)} />}
```

- [ ] **Step 3: Add Settings CSS**

```css
/* Add to App.css */
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.settings-dialog {
  background: white;
  border-radius: 8px;
  padding: 24px;
  max-width: 500px;
  width: 90%;
}

.settings-dialog h3 {
  margin-bottom: 20px;
}

.setting-item {
  margin-bottom: 16px;
}

.setting-item label {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  color: #333;
}

.setting-item input[type="number"],
.setting-item select {
  width: 100%;
  padding: 8px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
}

.setting-item input[type="checkbox"] {
  margin-right: 8px;
}

.setting-item button {
  padding: 8px 16px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  background: white;
  cursor: pointer;
}

.settings-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 20px;
}

.settings-actions button {
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid #d9d9d9;
  cursor: pointer;
}

.settings-actions button:last-child {
  background: #1890ff;
  color: white;
  border-color: #1890ff;
}
```

- [ ] **Step 4: Verify settings work**

```bash
npm run dev
```

Expected: Settings dialog opens, can modify and save config.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/ src/App.tsx src/App.css
git commit -m "feat: implement settings page"
```

---

## Final Task: Integration Test & Polish

### Task 18: End-to-End Verification

- [ ] **Step 1: Build the application**

```bash
npm run tauri build
```

Expected: Build succeeds, produces .dmg (Mac) or .msi (Windows).

- [ ] **Step 2: Test the full workflow**

1. Open the app
2. Write a markdown document with headings, code, images
3. Click "发布" → select "微信公众号"
4. Verify clipboard contains formatted HTML
5. Paste into a test HTML file to verify

- [ ] **Step 3: Test file operations**

1. File → Open File → select a .md file
2. File → Open Folder → select a folder with .md files
3. Click files in tree to switch between them
4. File → Save

- [ ] **Step 4: Test system tray**

1. Close the window → verify it minimizes to tray
2. Right-click tray icon → verify menu appears
3. Click "打开主窗口" → verify window reappears

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: MdBridge MVP complete"
```
