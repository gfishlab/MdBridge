use comrak::nodes::AstNode;
use super::PlatformConverter;

pub struct BilibiliConverter;

impl PlatformConverter for BilibiliConverter {
    fn name(&self) -> &str {
        "bilibili"
    }

    fn supports_external_images(&self) -> bool {
        true
    }

    fn convert(&self, _ast: &AstNode) -> String {
        // TODO: Implement Bilibili-specific conversion
        String::new()
    }
}
