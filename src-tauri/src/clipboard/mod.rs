use arboard::Clipboard;

pub fn copy_text(text: &str) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| format!("剪贴板初始化失败: {}", e))?;
    clipboard.set_text(text).map_err(|e| format!("写入文本失败: {}", e))?;
    Ok(())
}

pub fn copy_html(html: &str) -> Result<(), String> {
    copy_rich_text(html, html)
}

pub fn copy_rich_text(html: &str, plain_text: &str) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| format!("剪贴板初始化失败: {}", e))?;
    // 先清空，确保旧数据（图片、表情等）不残留
    clipboard.clear().map_err(|e| format!("清空剪贴板失败: {}", e))?;
    clipboard.set_html(html, Some(plain_text)).map_err(|e| format!("写入 HTML 失败: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clipboard_text() {
        let result = copy_text("Hello World");
        assert!(result.is_ok());
    }

    #[test]
    fn test_clipboard_rich_text() {
        let result = copy_rich_text("<p>Hello</p>", "Hello");
        assert!(result.is_ok());
    }
}
