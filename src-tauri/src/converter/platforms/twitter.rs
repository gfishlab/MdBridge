use comrak::nodes::AstNode;
use super::PlatformConverter;

pub struct TwitterConverter;

impl PlatformConverter for TwitterConverter {
    fn name(&self) -> &str {
        "twitter"
    }

    fn supports_external_images(&self) -> bool {
        true
    }

    fn convert<'a>(&self, _ast: &'a AstNode<'a>) -> String {
        // TODO: Implement Twitter-specific conversion
        String::new()
    }
}
