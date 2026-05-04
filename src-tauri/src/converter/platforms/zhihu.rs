use comrak::nodes::AstNode;
use super::PlatformConverter;

pub struct ZhihuConverter;

impl PlatformConverter for ZhihuConverter {
    fn name(&self) -> &str {
        "zhihu"
    }

    fn supports_external_images(&self) -> bool {
        true
    }

    fn convert(&self, _ast: &AstNode) -> String {
        // TODO: Implement Zhihu-specific conversion
        String::new()
    }
}
