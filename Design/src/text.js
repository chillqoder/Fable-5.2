// Copy that is "out of tune" is shown as code noise. As the dial locks onto a
// station, characters resolve one by one in a fixed pseudo-random order.

const GLYPHS = '{}[]<>/\\=+*#~_;:01';

const hash = (i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function prepare(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n, off = 0;
  while ((n = walker.nextNode())) {
    if (!n.nodeValue.trim() || n.parentElement.closest('form')) continue;
    nodes.push({ n, src: n.nodeValue, off });
    off += n.nodeValue.length;
  }
  return nodes;
}

export function render(nodes, lock) {
  for (const { n, src, off } of nodes) {
    if (lock >= 1) {
      if (n.nodeValue !== src) n.nodeValue = src;
      continue;
    }
    let s = '';
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      s += c === ' ' || lock > 0.1 + 0.88 * hash(off + i) ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    n.nodeValue = s;
  }
}
