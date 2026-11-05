// Test-only real controlled editor. Never bundled into the extension.
import React from 'react';
import ReactDOM from 'react-dom';
import { Editor, EditorState, ContentState, CompositeDecorator, Modifier, SelectionState, convertToRaw } from 'draft-js';

const decorator = new CompositeDecorator([
  { strategy: (block, callback) => { const re = /https:\/\/\S+/g; let m; while ((m = re.exec(block.getText()))) callback(m.index, m.index + m[0].length); }, component: ({ children }) => <span className="link">{children}</span> },
  { strategy: (block, callback, content) => block.findEntityRanges(c => c.getEntity() !== null && content.getEntity(c.getEntity()).getType() === 'MENTION', callback), component: ({ children }) => <span data-mention="friend">{children}</span> },
]);
function initial(text) {
  let content = ContentState.createFromText(text);
  if (text.startsWith('@friend')) {
    content = content.createEntity('MENTION', 'IMMUTABLE', { account: 'fixture-friend' });
    content = Modifier.applyEntity(content, SelectionState.createEmpty(content.getFirstBlock().getKey()).merge({ anchorOffset: 0, focusOffset: 7 }), content.getLastCreatedEntityKey());
  }
  return EditorState.createWithContent(content, decorator);
}
function App({ text, modal }) {
  const [state, setState] = React.useState(() => initial(text));
  const value = state.getCurrentContent().getPlainText();
  window.__model = () => ({ text: value, raw: convertToRaw(state.getCurrentContent()) });
  React.useLayoutEffect(() => { document.querySelector('[contenteditable]').dataset.testid = 'tweetTextarea_0'; });
  const paste = e => {
    window.__pastes++;
    if (!window.__pasteMode) return;
    e.preventDefault(); e.stopPropagation();
    if (window.__pasteMode === 'corrupt') setState(initial('Unexpected host rewrite'));
  };
  return <section role={modal ? 'dialog' : undefined} onPasteCapture={paste}>
    <Editor editorState={state} onChange={setState} />
    <div data-testid="toolBar"><button data-testid={modal ? 'tweetButton' : 'tweetButtonInline'} disabled={value.length > window.__limit} onClick={() => window.__posts.push(value)}>Post</button></div>
  </section>;
}
window.__mount = (text, modal = false) => {
  ReactDOM.unmountComponentAtNode(document.getElementById('app'));
  ReactDOM.render(<App text={text} modal={modal} />, document.getElementById('app'));
};
window.__posts = []; window.__pastes = 0; window.__limit = 10000; window.__pasteMode = '';
window.__mount('Big things are coming to Open Social');
