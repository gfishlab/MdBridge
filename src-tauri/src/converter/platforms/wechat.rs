use comrak::nodes::AstNode;
use super::PlatformConverter;

pub struct WechatConverter;

impl PlatformConverter for WechatConverter {
    fn name(&self) -> &str {
        "wechat"
    }

    fn supports_external_images(&self) -> bool {
        false
    }

    fn convert(&self, _ast: &AstNode) -> String {
        // TODO: Implement WeChat-specific conversion
        String::new()
    }
}
