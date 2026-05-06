use arboard::Clipboard;

pub fn copy_rich_text(html: &str, plain_text: &str) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| format!("剪贴板初始化失败: {}", e))?;
    clipboard
        .set_html(html, Some(plain_text))
        .map_err(|e| format!("写入 HTML 失败: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clipboard_rich_text() {
        let result = copy_rich_text("<p>Hello</p>", "Hello");
        assert!(result.is_ok());
    }
}
