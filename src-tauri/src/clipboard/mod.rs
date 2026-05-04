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

    #[test]
    fn test_clipboard_rich_text() {
        let result = copy_rich_text("<p>Hello</p>", "Hello");
        assert!(result.is_ok());
    }
}
