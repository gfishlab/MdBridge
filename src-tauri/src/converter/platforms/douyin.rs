use comrak::nodes::AstNode;
use super::PlatformConverter;

pub struct DouyinConverter;

impl PlatformConverter for DouyinConverter {
    fn name(&self) -> &str {
        "douyin"
    }

    fn supports_external_images(&self) -> bool {
        false
    }

    fn convert(&self, _ast: &AstNode) -> String {
        // TODO: Implement Douyin/Xiaohongshu-specific conversion
        String::new()
    }
}
