use comrak::nodes::AstNode;
use super::PlatformConverter;

pub struct JuejinConverter;

impl PlatformConverter for JuejinConverter {
    fn name(&self) -> &str {
        "juejin"
    }

    fn supports_external_images(&self) -> bool {
        true
    }

    fn convert<'a>(&self, _ast: &'a AstNode<'a>) -> String {
        // TODO: Implement Juejin-specific conversion
        String::new()
    }
}
