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

    fn convert<'a>(&self, _ast: &'a AstNode<'a>) -> String {
        // TODO: Implement Bilibili-specific conversion
        String::new()
    }
}
