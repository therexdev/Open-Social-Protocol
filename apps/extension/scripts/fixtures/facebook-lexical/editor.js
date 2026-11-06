// Test-only genuine Lexical editor; no editor internals are used by the extension.
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from 'lexical';
import { registerRichText } from '@lexical/rich-text';
import { registerPlainText } from '@lexical/plain-text';
import { LinkNode, AutoLinkNode, $createLinkNode } from '@lexical/link';

let cleanup;
window.__mount = (text, plain = false) => {
  cleanup?.();
  document.querySelector('[role="dialog"]')?.remove();
  const dialog = document.createElement('section'); dialog.setAttribute('role', 'dialog');
  dialog.innerHTML = '<div contenteditable="true" role="textbox" data-lexical-editor="true"></div><aside data-preview>Open Social link preview</aside><footer><button>Post</button></footer>';
  document.body.append(dialog);
  const root = dialog.querySelector('[contenteditable]');
  const editor = createEditor({ namespace: 'FacebookFixture', nodes: [LinkNode, AutoLinkNode], onError: error => { throw error; } });
  window.__pastes = 0;
  root.addEventListener('paste', event => {
    window.__pastes++;
    if (window.__pasteMode === 'refuse' || window.__pasteMode === 'corrupt') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (window.__pasteMode === 'corrupt') editor.update(() => $getRoot().clear().append($createParagraphNode().append($createTextNode('Broken host paste'))), { discrete: true });
    }
    if (window.__blockAfterPaste) dialog.querySelector('button').disabled = true;
  }, true);
  editor.setRootElement(root);
  const unregister = plain ? registerPlainText(editor) : registerRichText(editor);
  editor.update(() => {
    $getRoot().clear();
    for (const line of text.split('\n')) {
      const p = $createParagraphNode();
      const link = line.match(/https:\/\/\S+$/);
      if (link && !plain) {
        p.append($createTextNode(line.slice(0, link.index)), $createLinkNode(link[0]).append($createTextNode(link[0])));
      } else p.append($createTextNode(line));
      $getRoot().append(p);
    }
  }, { discrete: true });
  window.__model = () => editor.getEditorState().read(() => ({
    text: $getRoot().getTextContent(), blocks: $getRoot().getChildren().map(node => node.getTextContent()), json: editor.getEditorState().toJSON(),
  }));
  dialog.querySelector('button').addEventListener('click', () => {
    window.__posts.push(window.__model());
    window.__published = () => {
      const article = document.createElement('article'); article.setAttribute('role', 'article');
      const body = document.createElement('div'); body.textContent = window.__model().text;
      const link = document.createElement('a'); link.href = 'https://www.facebook.com/fixture/posts/12345'; link.textContent = 'Just now';
      article.append(body, link); document.querySelector('[role="feed"]').append(article);
    };
  });
  cleanup = () => { unregister(); editor.setRootElement(null); };
};
window.__posts = [];
window.__mount("Who's ready for a censorship free, user owned, free and open social network. Check Out Open Social: https://opensocial.online/");
