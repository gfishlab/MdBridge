use comrak::nodes::AstNode;
use super::PlatformConverter;

pub struct CsdnConverter;

impl PlatformConverter for CsdnConverter {
    fn name(&self) -> &str {
        "csdn"
    }

    fn supports_external_images(&self) -> bool {
        true
    }

    fn convert<'a>(&self, _ast: &'a AstNode<'a>) -> String {
        // TODO: Implement CSDN-specific conversion
        String::new()
    }
}
