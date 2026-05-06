use comrak::nodes::AstNode;

pub mod bilibili;
pub mod csdn;
pub mod juejin;
pub mod twitter;
pub mod wechat;
pub mod zhihu;

pub trait PlatformConverter {
    fn name(&self) -> &str;
    fn supports_external_images(&self) -> bool;
    fn convert<'a>(&self, ast: &'a AstNode<'a>) -> String;
}

pub fn get_all_converters() -> Vec<Box<dyn PlatformConverter>> {
    vec![
        Box::new(wechat::WechatConverter),
        Box::new(bilibili::BilibiliConverter),
        Box::new(csdn::CsdnConverter),
        Box::new(twitter::TwitterConverter),
        Box::new(zhihu::ZhihuConverter),
        Box::new(juejin::JuejinConverter),
    ]
}

pub fn get_converter_by_name(name: &str) -> Option<Box<dyn PlatformConverter>> {
    get_all_converters().into_iter().find(|c| c.name() == name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::converter::ast::parse_markdown;
    use comrak::Arena;

    #[test]
    fn test_converter_trait() {
        let converter = wechat::WechatConverter;
        assert_eq!(converter.name(), "wechat");
        assert!(converter.supports_external_images());
    }

    #[test]
    fn test_get_converter_by_name() {
        let converter = get_converter_by_name("wechat");
        assert!(converter.is_some());
        assert_eq!(converter.unwrap().name(), "wechat");
    }

    #[test]
    fn test_get_all_converters_count() {
        let converters = get_all_converters();
        assert_eq!(converters.len(), 6);
    }

    #[test]
    fn test_convert_runs_without_panic() {
        let converter = wechat::WechatConverter;
        let arena = Arena::new();
        let doc = parse_markdown(&arena, "# Hello");
        let _html = converter.convert(doc);
    }
}
