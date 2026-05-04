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

    fn convert(&self, _ast: &AstNode) -> String {
        // TODO: Implement Juejin-specific conversion
        String::new()
    }
}
