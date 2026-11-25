/* Codeflow web app: paste code (or run inside MakeCode) -> pseudocode + flowcharts. */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const STORE_KEY = 'codeflow.lastCode';

  const EXAMPLE = `namespace SpriteKind {
    export const Coin = SpriteKind.create()
}
controller.A.onEvent(ControllerButtonEvent.Pressed, function () {
    if (mySprite.isHittingTile(CollisionDirection.Bottom)) {
        mySprite.vy = -150
    }
})
sprites.onOverlap(SpriteKind.Player, SpriteKind.Coin, function (sprite, otherSprite) {
    otherSprite.destroy(effects.confetti, 200)
    info.changeScoreBy(1)
    if (info.score() >= 10) {
        game.over(true)
    }
})
sprites.onOverlap(SpriteKind.Player, SpriteKind.Enemy, function (sprite, otherSprite) {
    info.changeLifeBy(-1)
    otherSprite.destroy()
    scene.cameraShake(4, 500)
})
function spawnCoins (count: number) {
    for (let index = 0; index < count; index++) {
        coin = sprites.create(assets.image\`coin\`, SpriteKind.Coin)
        tiles.placeOnRandomTile(coin, assets.tile\`grass\`)
    }
}
let coin: Sprite = null
let bat: Sprite = null
let mySprite: Sprite = null
game.splash("Collect 10 coins!")
scene.setBackgroundColor(9)
tiles.setCurrentTilemap(tilemap\`level1\`)
mySprite = sprites.create(assets.image\`hero\`, SpriteKind.Player)
controller.moveSprite(mySprite, 100, 0)
mySprite.ay = 350
scene.cameraFollowSprite(mySprite)
info.setLife(3)
spawnCoins(5)
game.onUpdateInterval(3000, function () {
    bat = sprites.create(assets.image\`bat\`, SpriteKind.Enemy)
    bat.setPosition(randint(0, 160), 0)
    bat.follow(mySprite, 40)
})
`;

  const EXAMPLE_UNITY = `// ---- File: PlayerController.cs ----
using UnityEngine;

public class PlayerController : MonoBehaviour
{
    public float speed = 5f;
    [SerializeField] private float jumpForce = 7f;
    private Rigidbody2D rb;
    private bool isGrounded;
    public int coins;

    void Start()
    {
        rb = GetComponent<Rigidbody2D>();
    }

    void Update()
    {
        // Move left and right with the arrow keys
        float move = Input.GetAxis("Horizontal");
        rb.velocity = new Vector2(move * speed, rb.velocity.y);

        if (Input.GetKeyDown(KeyCode.Space) && isGrounded)
        {
            rb.AddForce(Vector2.up * jumpForce, ForceMode2D.Impulse);
            isGrounded = false;
        }
    }

    void OnCollisionEnter2D(Collision2D other)
    {
        if (other.gameObject.CompareTag("Ground"))
        {
            isGrounded = true;
        }
        else if (other.gameObject.CompareTag("Enemy"))
        {
            Destroy(gameObject);
        }
    }

    void OnTriggerEnter2D(Collider2D other)
    {
        if (other.CompareTag("Coin"))
        {
            coins++;
            Destroy(other.gameObject);
        }
    }
}

// ---- File: EnemySpawner.cs ----
using System.Collections;
using UnityEngine;

public class EnemySpawner : MonoBehaviour
{
    public GameObject enemyPrefab;
    public Transform[] spawnPoints;
    public float delay = 2f;

    void Start()
    {
        StartCoroutine(SpawnEnemies());
    }

    IEnumerator SpawnEnemies()
    {
        while (true)
        {
            int i = Random.Range(0, spawnPoints.Length);
            Instantiate(enemyPrefab, spawnPoints[i].position, Quaternion.identity);
            yield return new WaitForSeconds(delay);
        }
    }
}
`;

  // ---------------------------------------------------------------------
  // Mermaid set-up (colours come from the CSS variables so dark mode works)
  // ---------------------------------------------------------------------

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function initMermaid() {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      htmlLabels: false,
      flowchart: { htmlLabels: false, curve: 'basis', nodeSpacing: 30, rankSpacing: 36, padding: 10 },
      themeVariables: {
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSize: '14px',
        lineColor: cssVar('--edge'),
        primaryTextColor: cssVar('--node-text'),
        textColor: cssVar('--node-text'),
        edgeLabelBackground: cssVar('--surface'),
        primaryColor: cssVar('--process-fill'),
        primaryBorderColor: cssVar('--process-stroke'),
      },
    });
  }

  function classDefs() {
    const text = cssVar('--node-text');
    return ['terminal', 'process', 'decision', 'io', 'sub']
      .map(k => `  classDef ${k} fill:${cssVar(`--${k}-fill`)},stroke:${cssVar(`--${k}-stroke`)},stroke-width:1.5px,color:${text}`)
      .join('\n');
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  let renderCount = 0;
  let current = null; // last analysis result

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /** Bold the CAPITALISED keywords and colour "strings". */
  function highlight(text) {
    return text.split(/("(?:[^"\\]|\\.)*")/).map((part, i) => {
      if (i % 2) return `<span class="str">${escapeHtml(part)}</span>`;
      return escapeHtml(part).replace(/\b([A-Z]{2,}(?:\s+[A-Z]{2,})*)\b/g, '<span class="kw">$1</span>');
    }).join('');
  }

  function setStatus(msg, isError) {
    const el = $('#status');
    el.hidden = !msg;
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  async function render(source) {
    if (!window.mermaid || (lang === 'makecode' && !window.ts)) {
      setStatus('The helper libraries did not load. Check your internet connection and reload the page.', true);
      return;
    }
    setStatus('');
    let result;
    try {
      if (lang === 'unity') {
        setStatus('Loading the C# reader…');
        const parser = await loadCSharp();
        setStatus('');
        result = window.CodeflowCSharp.analyse(source, parser);
      } else {
        result = window.Codeflow.analyse(source, window.ts);
      }
    } catch (e) {
      setStatus(lang === 'unity' && !csharpReady
        ? 'The C# reader did not load. Check your internet connection and try again.'
        : 'Sorry, Codeflow could not read that code: ' + e.message, true);
      return;
    }
    current = result;

    $('#warnings').innerHTML = result.warnings.map(w => `<div class="warn">${escapeHtml(w)}</div>`).join('');

    const hasSections = result.sections.length > 0;
    $('#empty').hidden = hasSections;
    $('#toc').hidden = !hasSections;
    $('#legend').hidden = !hasSections;
    $('#topActions').hidden = !hasSections && !inEditor;

    // Table of contents, grouped by script when there are several.
    let toc = '', lastGroup = null;
    for (const s of result.sections) {
      if (s.group && s.group !== lastGroup) {
        toc += `<span class="toc-group">${escapeHtml(groupLabel(s.group))}</span>`;
        lastGroup = s.group;
      }
      toc += `<a href="#${s.id}"><span class="dot ${s.kind}"></span>${escapeHtml(shortTitle(s.title))}</a>`;
    }
    $('#toc').innerHTML = toc;

    const container = $('#sections');
    container.innerHTML = '';
    const defs = classDefs();
    lastGroup = null;
    for (const s of result.sections) {
      if (s.group && s.group !== lastGroup) {
        const h = document.createElement('h2');
        h.className = 'group-head';
        h.textContent = s.group;
        container.appendChild(h);
        lastGroup = s.group;
      }
      const hasFlow = !!s.mermaid;
      const meta = [s.method, s.line ? `line ${s.line}` : ''].filter(Boolean).join(' · ');
      const card = document.createElement('article');
      card.className = 'card' + (hasFlow ? '' : ' no-flow');
      card.id = s.id;
      card.innerHTML = `
        <div class="card-head">
          <h2>${escapeHtml(s.title)}${meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ''}</h2>
          <div class="card-tools">
            <button class="btn small tool-pseudo" data-act="copy">Copy pseudocode</button>
            ${hasFlow ? `<button class="btn small tool-flow" data-act="png">Save flowchart (PNG)</button>
            <button class="btn small tool-flow" data-act="svg">SVG</button>` : ''}
          </div>
        </div>
        ${s.parent ? `<div class="parent-note">This code is set up inside <b>${escapeHtml(s.parent)}</b>.</div>` : ''}
        <div class="card-body">
          <ol class="pseudo">${s.lines.map(l => `
            <li class="${l.nodeId ? 'linked' : ''}${l.note ? ' note' : ''}" ${l.nodeId ? `data-node="${l.nodeId}"` : ''}><span class="code">${'<span class="indent"></span>'.repeat(l.depth)}${highlight(l.text)}</span></li>`).join('')}
          </ol>
          ${hasFlow ? `<div class="flow" aria-label="Flowchart for ${escapeHtml(s.title)}"></div>` : ''}
        </div>`;
      container.appendChild(card);
      card.querySelector('[data-act="copy"]').onclick = () => copyText(pseudoText(s), 'Pseudocode copied');
      if (!hasFlow) continue;

      const flowEl = card.querySelector('.flow');
      const src = s.mermaid + '\n' + defs;
      try {
        const { svg } = await window.mermaid.render('cf' + (++renderCount), src);
        flowEl.innerHTML = svg;
        linkHover(card, flowEl);
      } catch (e) {
        flowEl.innerHTML = `<p class="err">Could not draw this flowchart (${escapeHtml(e.message || e)})</p>`;
        console.error(e, src);
      }
      card.querySelector('[data-act="svg"]').onclick = () => downloadSvg(flowEl, s);
      card.querySelector('[data-act="png"]').onclick = () => downloadPng(flowEl, s);
    }

    if (hasSections && !inEditor) {
      $('#inputDetails').open = false;
      $('#summaryHint').textContent = `${result.sections.length} section${result.sections.length === 1 ? '' : 's'} found. Click to edit the code.`;
    }
  }

  /** "Player.cs · class Player : MonoBehaviour" -> "Player.cs" (or "class Player") for the contents bar. */
  function groupLabel(g) {
    const parts = g.split(' · ');
    return parts.length > 1 ? parts[0] : g.replace(/\s*:.*$/, '');
  }

  function shortTitle(t) { return t.length > 42 ? t.slice(0, 40) + '…' : t; }

  /** Find the SVG group mermaid drew for one of our node ids. */
  function nodeEls(flowEl) {
    const map = new Map();
    flowEl.querySelectorAll('g.node').forEach(g => {
      const m = /flowchart-([a-z]\d+n\d+)-/.exec(g.id) || [null, g.getAttribute('data-id')];
      if (m[1]) map.set(m[1], g);
    });
    return map;
  }

  function linkHover(card, flowEl) {
    const nodes = nodeEls(flowEl);
    const lines = card.querySelectorAll('.pseudo li[data-node]');
    const clear = () => {
      card.querySelectorAll('.hl').forEach(e => e.classList.remove('hl'));
    };
    const on = id => {
      clear();
      const g = nodes.get(id);
      if (g) g.classList.add('hl');
      card.querySelectorAll(`.pseudo li[data-node="${id}"]`).forEach(li => li.classList.add('hl'));
    };
    lines.forEach(li => {
      li.addEventListener('mouseenter', () => on(li.dataset.node));
      li.addEventListener('mouseleave', clear);
      li.addEventListener('click', () => {
        on(li.dataset.node);
        const g = nodes.get(li.dataset.node);
        if (g && g.scrollIntoView) g.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      });
    });
    nodes.forEach((g, id) => {
      g.addEventListener('mouseenter', () => on(id));
      g.addEventListener('mouseleave', clear);
    });
  }

  function pseudoText(s) {
    return s.lines.map(l => '    '.repeat(l.depth) + l.text).join('\n');
  }

  // ---------------------------------------------------------------------
  // Copy / download
  // ---------------------------------------------------------------------

  function toast(msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 1600);
  }

  async function copyText(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(msg); } catch (e2) { toast('Could not copy - select the text instead'); }
      ta.remove();
    }
  }

  function fileName(s, ext) {
    return (s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'flowchart') + '.' + ext;
  }

  function svgString(flowEl) {
    const svg = flowEl.querySelector('svg');
    if (!svg) return null;
    const clone = svg.cloneNode(true);
    clone.querySelectorAll('.hl').forEach(e => e.classList.remove('hl'));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const box = svg.viewBox.baseVal;
    clone.setAttribute('width', box.width);
    clone.setAttribute('height', box.height);
    clone.style.maxWidth = '';
    clone.style.backgroundColor = cssVar('--surface');
    return { text: new XMLSerializer().serializeToString(clone), w: box.width, h: box.height };
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function downloadSvg(flowEl, s) {
    const out = svgString(flowEl);
    if (out) download(new Blob([out.text], { type: 'image/svg+xml' }), fileName(s, 'svg'));
  }

  function downloadPng(flowEl, s) {
    const out = svgString(flowEl);
    if (!out) return;
    const scale = 2;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.ceil(out.w * scale);
      c.height = Math.ceil(out.h * scale);
      const g = c.getContext('2d');
      g.fillStyle = cssVar('--surface');
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => b && download(b, fileName(s, 'png')), 'image/png');
    };
    img.onerror = () => toast('Could not make a PNG - try SVG instead');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.text);
  }

  // ---------------------------------------------------------------------
  // Loading a shared project link
  // ---------------------------------------------------------------------

  function shareId(url) {
    const m = /(_[A-Za-z0-9]{8,}|S\d{5}-\d{5}-\d{5}-\d{5})/.exec(url || '');
    return m && m[1];
  }

  async function loadShare() {
    const url = $('#shareUrl').value.trim();
    const id = shareId(url);
    if (!id) { setStatus('That does not look like a MakeCode share link (e.g. https://makecode.com/_abc123XYZ).', true); return; }
    setStatus('Loading project…');
    try {
      const res = await fetch(`https://www.makecode.com/api/${id}/text`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const files = await res.json();
      const code = files['main.ts'];
      if (code == null) throw new Error('no main.ts in project');
      setLang('makecode');
      $('#code').value = code;
      remember(code);
      await render(code);
    } catch (e) {
      setStatus(`Could not load that project (${e.message}). Your network may block it. Copy the JavaScript from MakeCode and paste it instead.`, true);
    }
  }

  // ---------------------------------------------------------------------
  // Running inside the MakeCode editor as an editor extension
  // ---------------------------------------------------------------------

  const extId = window.location.hash.slice(1);
  const inEditor = window.parent !== window && !!extId;
  const pending = {};
  let lastEditorCode = '';

  function sendToEditor(action, body) {
    const id = Math.random().toString(36).slice(2);
    pending[id] = action;
    window.parent.postMessage({ type: 'pxtpkgext', action, extId, response: true, id, body }, '*');
  }

  function requestCode() {
    setStatus('Reading your project…');
    sendToEditor('extusercode');
  }

  function onEditorMessage(ev) {
    if (ev.source !== window.parent) return;
    const msg = ev.data;
    if (!msg || msg.type !== 'pxtpkgext') return;
    if (msg.event === 'extshown') { requestCode(); return; }
    const action = msg.id && pending[msg.id];
    if (!action) return;
    delete pending[msg.id];
    if (action === 'extusercode') {
      if (msg.success === false) {
        setStatus('Codeflow needs permission to read your code. Close this and open it again to allow it.', true);
        return;
      }
      const files = msg.resp || {};
      const code = files['main.ts'];
      if (code == null) { setStatus('Could not find main.ts in this project.', true); return; }
      lastEditorCode = code;
      render(code);
    }
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Unity (C#): the C# reader is big, so it only loads when Unity is picked
  // ---------------------------------------------------------------------

  const TREE_SITTER = 'https://cdn.jsdelivr.net/npm/web-tree-sitter@0.24.7/';
  const CSHARP_WASM = 'https://cdn.jsdelivr.net/npm/tree-sitter-c-sharp@0.23.1/tree-sitter-c_sharp.wasm';
  let csharpPromise = null;
  let csharpReady = false;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error('could not load ' + src));
      document.head.appendChild(el);
    });
  }

  function loadCSharp() {
    if (!csharpPromise) {
      csharpPromise = (async () => {
        if (!window.TreeSitter) await loadScript(TREE_SITTER + 'tree-sitter.js');
        const Parser = window.TreeSitter;
        await Parser.init({ locateFile: f => TREE_SITTER + f });
        const language = await Parser.Language.load(CSHARP_WASM);
        const parser = new Parser();
        parser.setLanguage(language);
        csharpReady = true;
        return parser;
      })();
      csharpPromise.catch(() => { csharpPromise = null; });
    }
    return csharpPromise;
  }

  // ---------------------------------------------------------------------
  // Choosing MakeCode or Unity
  // ---------------------------------------------------------------------

  let lang = 'makecode';
  const LANG_KEY = 'codeflow.lang';
  const storeKey = () => lang === 'unity' ? STORE_KEY + '.unity' : STORE_KEY;

  function setLang(next, opts) {
    lang = next;
    document.body.dataset.lang = next;
    document.querySelectorAll('.seg.lang button').forEach(b => b.classList.toggle('on', b.dataset.lang === next));
    $('#code').placeholder = next === 'unity'
      ? 'using UnityEngine;\n\npublic class Player : MonoBehaviour\n{\n    void Update() { ... }\n}'
      : 'controller.A.onEvent(ControllerButtonEvent.Pressed, function () { ... })';
    try { localStorage.setItem(LANG_KEY, next); } catch (e) { /* storage unavailable */ }
    if (next === 'unity') loadCSharp().catch(() => {}); // start downloading early
    if (opts && opts.restore) {
      let saved = null;
      try { saved = localStorage.getItem(storeKey()); } catch (e) { /* storage unavailable */ }
      $('#code').value = saved || '';
    }
  }

  function looksLikeMakeCode(text) {
    return /\b(controller|sprites|scene|game|info|tiles)\.\w+\s*\(/.test(text) && !/\busing\s+UnityEngine\b/.test(text);
  }

  // ---------------------------------------------------------------------
  // Adding .cs files (button or drag and drop)
  // ---------------------------------------------------------------------

  async function addFiles(fileList) {
    const files = [...fileList].filter(f => /\.(cs|ts|js|txt)$/i.test(f.name));
    if (!files.length) { setStatus('Choose .cs script files from your Unity project (Assets folder).', true); return; }
    const texts = await Promise.all(files.map(f => f.text()));
    if (files.some(f => /\.cs$/i.test(f.name))) setLang('unity');
    const combined = files.length === 1 && lang !== 'unity'
      ? texts[0]
      : files.map((f, i) => `// ---- File: ${f.name} ----\n${texts[i].trim()}\n`).join('\n');
    $('#code').value = combined;
    remember(combined);
    render(combined);
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------

  function remember(code) {
    try { localStorage.setItem(storeKey(), code); } catch (e) { /* storage unavailable */ }
  }

  function start() {
    initMermaid();
    document.body.dataset.view = 'both';

    document.querySelectorAll('.seg.view button').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.seg.view button').forEach(x => x.classList.toggle('on', x === b));
        document.body.dataset.view = b.dataset.view;
      };
    });
    document.querySelectorAll('.seg.lang button').forEach(b => {
      b.onclick = () => { if (b.dataset.lang !== lang) setLang(b.dataset.lang, { restore: true }); };
    });

    const go = () => {
      const c = $('#code').value;
      // Pasted into the wrong mode? Switch for them.
      if (lang === 'makecode' && window.CodeflowCSharp && window.CodeflowCSharp.looksLikeCSharp(c)) {
        setLang('unity');
        toast('This looks like Unity C#, so Codeflow switched to Unity');
      } else if (lang === 'unity' && looksLikeMakeCode(c)) {
        setLang('makecode');
        toast('This looks like MakeCode, so Codeflow switched to MakeCode');
      }
      remember(c);
      render(c);
    };
    const example = () => { $('#code').value = lang === 'unity' ? EXAMPLE_UNITY : EXAMPLE; go(); };
    $('#go').onclick = go;
    $('#example').onclick = example;
    $('#example2').onclick = example;
    $('#clear').onclick = () => { $('#code').value = ''; $('#code').focus(); };
    $('#code').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go(); });
    $('#loadShare').onclick = loadShare;
    $('#shareUrl').addEventListener('keydown', e => { if (e.key === 'Enter') loadShare(); });
    $('#printBtn').onclick = () => window.print();
    $('#copyAll').onclick = () => {
      if (current) copyText(current.sections.map(pseudoText).join('\n\n'), 'All pseudocode copied');
    };
    $('#fileInput').addEventListener('change', e => { if (e.target.files.length) addFiles(e.target.files); e.target.value = ''; });
    const ta = $('#code');
    ta.addEventListener('dragover', e => { e.preventDefault(); ta.classList.add('drop'); });
    ta.addEventListener('dragleave', () => ta.classList.remove('drop'));
    ta.addEventListener('drop', e => {
      e.preventDefault();
      ta.classList.remove('drop');
      if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });

    // Re-colour flowcharts when the system switches light/dark.
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        initMermaid();
        if (current) render(inEditor ? lastEditorCode : $('#code').value);
      });
    }

    if (inEditor) {
      // Inside MakeCode it is always MakeCode.
      setLang('makecode');
      document.body.classList.add('in-editor');
      $('#refreshBtn').hidden = false;
      $('#refreshBtn').onclick = requestCode;
      $('#topActions').hidden = false;
      window.addEventListener('message', onEditorMessage);
      sendToEditor('extinit');
      requestCode();
      return;
    }

    const params = new URLSearchParams(location.search);
    let savedLang = null;
    try { savedLang = localStorage.getItem(LANG_KEY); } catch (e) { /* storage unavailable */ }
    const wanted = params.get('lang') === 'unity' || location.hash === '#unity' ? 'unity'
      : params.get('share') ? 'makecode' : savedLang === 'unity' ? 'unity' : 'makecode';
    setLang(wanted, { restore: true });

    if (params.get('share')) {
      $('#shareUrl').value = params.get('share');
      loadShare();
    } else if ($('#code').value) {
      render($('#code').value);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
