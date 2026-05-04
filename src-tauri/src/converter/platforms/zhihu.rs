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

    fn convert<'a>(&self, _ast: &'a AstNode<'a>) -> String {
        // TODO: Implement Zhihu-specific conversion
        String::new()
    }
}
