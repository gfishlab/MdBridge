import './Help.css';

interface HelpProps {
  onClose: () => void;
}

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const mod = isMac ? '⌘' : 'Ctrl';

function kbd(keys: string) {
  return keys.split('+').map(k => `<kbd>${k.trim()}</kbd>`).join(' + ');
}

export function Help({ onClose }: HelpProps) {
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-dialog" onClick={e => e.stopPropagation()}>
        <div className="help-header">
          <h3>Markdown 语法 & 快捷键</h3>
          <button className="help-close" onClick={onClose}>✕</button>
        </div>
        <div className="help-body">
          <section>
            <h4>基础语法</h4>
            <table className="help-table">
              <thead>
                <tr><th>效果</th><th>语法</th></tr>
              </thead>
              <tbody>
                <tr><td><strong>加粗</strong></td><td><code>**文字**</code></td></tr>
                <tr><td><em>斜体</em></td><td><code>*文字*</code></td></tr>
                <tr><td>~~删除线~~</td><td><code>~~文字~~</code></td></tr>
                <tr><td>行内代码</td><td><code>`代码`</code></td></tr>
                <tr><td>链接</td><td><code>[文字](URL)</code></td></tr>
                <tr><td>图片</td><td><code>![描述](URL)</code></td></tr>
                <tr><td>分割线</td><td><code>---</code></td></tr>
              </tbody>
            </table>
          </section>

          <section>
            <h4>标题</h4>
            <table className="help-table">
              <thead>
                <tr><th>级别</th><th>语法</th><th>快捷键</th></tr>
              </thead>
              <tbody>
                <tr><td>一级标题</td><td><code># 标题</code></td><td dangerouslySetInnerHTML={{ __html: kbd(`${mod} + 1`) }} /></tr>
                <tr><td>二级标题</td><td><code>## 标题</code></td><td dangerouslySetInnerHTML={{ __html: kbd(`${mod} + 2`) }} /></tr>
                <tr><td>三级标题</td><td><code>### 标题</code></td><td dangerouslySetInnerHTML={{ __html: kbd(`${mod} + 3`) }} /></tr>
                <tr><td>四级标题</td><td><code>#### 标题</code></td><td dangerouslySetInnerHTML={{ __html: kbd(`${mod} + 4`) }} /></tr>
                <tr><td>五级标题</td><td><code>##### 标题</code></td><td dangerouslySetInnerHTML={{ __html: kbd(`${mod} + 5`) }} /></tr>
                <tr><td>六级标题</td><td><code>###### 标题</code></td><td dangerouslySetInnerHTML={{ __html: kbd(`${mod} + 6`) }} /></tr>
              </tbody>
            </table>
          </section>

          <section>
            <h4>列表与引用</h4>
            <table className="help-table">
              <thead>
                <tr><th>类型</th><th>语法</th></tr>
              </thead>
              <tbody>
                <tr><td>无序列表</td><td><code>- 列表项</code></td></tr>
                <tr><td>有序列表</td><td><code>1. 列表项</code></td></tr>
                <tr><td>待办事项</td><td><code>- [ ] 待办 / - [x] 完成</code></td></tr>
                <tr><td>引用</td><td><code>&gt; 引用文字</code></td></tr>
              </tbody>
            </table>
          </section>

          <section>
            <h4>代码块与表格</h4>
            <table className="help-table">
              <thead>
                <tr><th>类型</th><th>语法</th></tr>
              </thead>
              <tbody>
                <tr><td>代码块</td><td><code>```语言↵代码↵```</code></td></tr>
                <tr><td>表格</td><td><code>| 列1 | 列2 |↵|---|---|↵| 值 | 值 |</code></td></tr>
              </tbody>
            </table>
          </section>

          <section>
            <h4>快捷键</h4>
            <table className="help-table">
              <thead>
                <tr><th>功能</th><th>快捷键</th></tr>
              </thead>
              <tbody>
                <tr><td>保存文件</td><td dangerouslySetInnerHTML={{ __html: kbd(`${mod} + S`) }} /></tr>
                <tr><td>加粗</td><td dangerouslySetInnerHTML={{ __html: kbd(`${mod} + B`) }} /></tr>
                <tr><td>斜体</td><td dangerouslySetInnerHTML={{ __html: kbd(`${mod} + I`) }} /></tr>
                <tr><td>行内代码</td><td dangerouslySetInnerHTML={{ __html: kbd(`${mod} + E`) }} /></tr>
                <tr><td>链接</td><td dangerouslySetInnerHTML={{ __html: kbd(`${mod} + K`) }} /></tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
