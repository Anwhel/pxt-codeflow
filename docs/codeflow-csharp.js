/*
 * Codeflow for Unity: turns Unity C# scripts into plain-English pseudocode
 * and Mermaid flowcharts, in the same shape as the MakeCode converter.
 *
 *   CodeflowCSharp.analyse(sourceText, parser) -> { sections, warnings }
 *
 * `parser` is a web-tree-sitter Parser with the C# language set.
 * Several files can be pasted together, separated by lines like
 *   // ---- File: Player.cs ----
 *
 * The C# syntax tree is first turned into a small list of steps (IR), then
 * buildSection() turns the steps into pseudocode lines and a flowchart.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./codeflow.js'));
  else root.CodeflowCSharp = factory(root.Codeflow);
})(typeof self !== 'undefined' ? self : this, function (Codeflow) {
  'use strict';

  const { Flow, words, titleWords, negate } = Codeflow.util;

  const FILE_MARK = /^[ \t]*\/\/[ \t]*-{2,}[ \t]*File:[ \t]*(.+?)[ \t]*-{2,}[ \t]*$/;

  // ---------------------------------------------------------------------
  // Unity knowledge
  // ---------------------------------------------------------------------

  /** Unity calls these methods itself. order: where they go in the output. */
  const MESSAGES = {
    Awake: { order: 1, kind: 'start', title: () => 'WHEN this object is created' },
    OnEnable: { order: 2, kind: 'start', title: () => 'WHEN this object is switched on' },
    Start: { order: 3, kind: 'start', title: () => 'WHEN this object starts' },
    Update: { order: 4, kind: 'event', title: () => 'EVERY FRAME', repeat: 'runs again next frame' },
    FixedUpdate: { order: 5, kind: 'event', title: () => 'EVERY PHYSICS STEP', repeat: 'runs again next physics step' },
    LateUpdate: { order: 6, kind: 'event', title: () => 'EVERY FRAME, AFTER Update', repeat: 'runs again next frame' },
    OnCollisionEnter: { order: 7, kind: 'event', title: p => `WHEN this object hits something${pn(p)}` },
    OnCollisionEnter2D: { order: 7, kind: 'event', title: p => `WHEN this object hits something${pn(p)}` },
    OnCollisionStay: { order: 7, kind: 'event', title: p => `WHILE this object is touching something${pn(p)}` },
    OnCollisionStay2D: { order: 7, kind: 'event', title: p => `WHILE this object is touching something${pn(p)}` },
    OnCollisionExit: { order: 7, kind: 'event', title: p => `WHEN this object stops touching something${pn(p)}` },
    OnCollisionExit2D: { order: 7, kind: 'event', title: p => `WHEN this object stops touching something${pn(p)}` },
    OnTriggerEnter: { order: 7, kind: 'event', title: p => `WHEN something${pn(p)} enters this object's trigger` },
    OnTriggerEnter2D: { order: 7, kind: 'event', title: p => `WHEN something${pn(p)} enters this object's trigger` },
    OnTriggerStay: { order: 7, kind: 'event', title: p => `WHILE something${pn(p)} is inside this object's trigger` },
    OnTriggerStay2D: { order: 7, kind: 'event', title: p => `WHILE something${pn(p)} is inside this object's trigger` },
    OnTriggerExit: { order: 7, kind: 'event', title: p => `WHEN something${pn(p)} leaves this object's trigger` },
    OnTriggerExit2D: { order: 7, kind: 'event', title: p => `WHEN something${pn(p)} leaves this object's trigger` },
    OnMouseDown: { order: 7, kind: 'event', title: () => 'WHEN this object is clicked' },
    OnMouseUp: { order: 7, kind: 'event', title: () => 'WHEN the mouse button is let go over this object' },
    OnMouseEnter: { order: 7, kind: 'event', title: () => 'WHEN the mouse moves onto this object' },
    OnMouseExit: { order: 7, kind: 'event', title: () => 'WHEN the mouse moves off this object' },
    OnMouseOver: { order: 7, kind: 'event', title: () => 'WHILE the mouse is over this object' },
    OnMouseDrag: { order: 7, kind: 'event', title: () => 'WHILE this object is being dragged' },
    OnBecameVisible: { order: 7, kind: 'event', title: () => 'WHEN this object comes onto the screen' },
    OnBecameInvisible: { order: 7, kind: 'event', title: () => 'WHEN this object goes off the screen' },
    OnGUI: { order: 7, kind: 'event', title: () => 'WHEN the GUI is drawn' },
    OnDisable: { order: 8, kind: 'event', title: () => 'WHEN this object is switched off' },
    OnDestroy: { order: 8, kind: 'event', title: () => 'WHEN this object is destroyed' },
    OnApplicationQuit: { order: 8, kind: 'event', title: () => 'WHEN the game is closing' },
    OnValidate: { order: 8, kind: 'event', title: () => 'WHEN a value is changed in the Inspector' },
  };

  /** Friendly names for properties. */
  const PROPS = {
    position: 'position', localPosition: 'local position', rotation: 'rotation',
    localRotation: 'local rotation', eulerAngles: 'rotation (in degrees)', localEulerAngles: 'local rotation (in degrees)',
    localScale: 'size (scale)', lossyScale: 'size (scale)',
    velocity: 'velocity', linearVelocity: 'velocity', angularVelocity: 'spin speed',
    gravityScale: 'gravity', useGravity: 'gravity setting', isKinematic: 'kinematic setting', mass: 'mass',
    drag: 'drag', linearDamping: 'drag', angularDrag: 'spin drag',
    enabled: 'enabled setting', activeSelf: 'switched-on setting', tag: 'tag', name: 'name', text: 'text',
    isGrounded: 'on-the-ground check', forward: 'forward direction', right: 'right direction', up: 'up direction',
    transform: 'transform', gameObject: 'game object', parent: 'parent', color: 'colour', sprite: 'sprite',
    flipX: 'flip-sideways setting', flipY: 'flip-upside-down setting', fillAmount: 'fill amount',
    buildIndex: 'number in the build', normalized: 'direction (length 1)', magnitude: 'length',
    sqrMagnitude: 'length squared', collider: 'collider', rigidbody: 'rigidbody', clip: 'sound clip',
    isPlaying: 'is-playing check', volume: 'volume', pitch: 'pitch', point: 'hit point', normal: 'surface direction',
    distance: 'distance', interactable: 'clickable setting', value: 'value',
  };

  /** True/false properties read better as a sentence: "rb is on the ground". */
  const BOOL_PROPS = {
    isGrounded: 'is on the ground', isPlaying: 'is playing', activeSelf: 'is switched on',
    activeInHierarchy: 'is switched on', isKinematic: 'is kinematic', flipX: 'is flipped sideways',
    flipY: 'is flipped upside down', isTrigger: 'is a trigger', interactable: 'can be clicked',
  };

  /** Static values: Time.deltaTime, Vector3.up ... */
  const STATIC_PROPS = {
    'Time.deltaTime': 'the time since the last frame',
    'Time.fixedDeltaTime': 'the time for one physics step',
    'Time.time': 'the time since the game started',
    'Time.timeScale': 'the game speed',
    'Time.unscaledDeltaTime': 'the real time since the last frame',
    'Time.frameCount': 'the number of frames so far',
    'Input.mousePosition': 'the mouse position',
    'Input.anyKeyDown': 'any key is pressed',
    'Input.anyKey': 'any key is held down',
    'Input.touchCount': 'the number of fingers touching the screen',
    'Random.value': 'a random number from 0 to 1',
    'Random.insideUnitCircle': 'a random point in a circle of size 1',
    'Random.insideUnitSphere': 'a random point in a ball of size 1',
    'Random.rotation': 'a random rotation',
    'Mathf.PI': 'π', 'Mathf.Infinity': 'infinity', 'Mathf.Deg2Rad': 'degrees-to-radians', 'Mathf.Rad2Deg': 'radians-to-degrees',
    'Quaternion.identity': 'no rotation',
    'Screen.width': 'the screen width', 'Screen.height': 'the screen height',
    'Camera.main': 'the main camera',
    'Color.red': 'red', 'Color.green': 'green', 'Color.blue': 'blue', 'Color.white': 'white',
    'Color.black': 'black', 'Color.yellow': 'yellow', 'Color.clear': 'see-through', 'Color.gray': 'grey', 'Color.grey': 'grey',
    'Color.cyan': 'cyan', 'Color.magenta': 'magenta',
  };
  for (const v of ['Vector2', 'Vector3']) {
    const three = v === 'Vector3';
    Object.assign(STATIC_PROPS, {
      [v + '.zero']: three ? '(0, 0, 0)' : '(0, 0)',
      [v + '.one']: three ? '(1, 1, 1)' : '(1, 1)',
      [v + '.up']: 'up', [v + '.down']: 'down', [v + '.left']: 'left', [v + '.right']: 'right',
      [v + '.forward']: 'forward', [v + '.back']: 'back',
    });
  }

  const MOUSE = { 0: 'left', 1: 'right', 2: 'middle' };
  const mouse = b => MOUSE[b] ? `${MOUSE[b]} mouse button` : `mouse button ${b}`;

  /*
   * Call phrasebook. Keys are "Type.Method" for static calls, or ".Method"
   * for calls on an object (or on this object, when written with no object).
   * Templates get (args, owner, typeArgs, rawArgs).
   *   s -> statement text   e -> expression text   io -> input/output
   *   shape -> flowchart shape for the statement
   */
  const CALLS = {
    // --- creating and destroying ---
    '.Destroy': { s: a => `DESTROY ${a[0]}` + (a[1] ? ` after ${a[1]} seconds` : '') },
    'Object.Destroy': { s: a => `DESTROY ${a[0]}` + (a[1] ? ` after ${a[1]} seconds` : '') },
    'GameObject.Destroy': { s: a => `DESTROY ${a[0]}` + (a[1] ? ` after ${a[1]} seconds` : '') },
    '.Instantiate': {
      e: a => `a new copy of ${a[0]}` + (a[1] ? ` at ${a[1]}` : '') + (a[2] ? ` with ${a[2]}` : ''),
      s: a => `CREATE a copy of ${a[0]}` + (a[1] ? ` at ${a[1]}` : '') + (a[2] ? ` with ${a[2]}` : ''),
    },
    '.GetComponent': { e: (a, o, g) => `${poss(o)} ${g[0] || unq(a[0])} component` },
    '.GetComponentInChildren': { e: (a, o, g) => `the ${g[0] || unq(a[0])} component inside ${o}` },
    '.GetComponentInParent': { e: (a, o, g) => `the ${g[0] || unq(a[0])} component on ${o}'s parent` },
    '.TryGetComponent': { e: (a, o, g) => `${o} has a ${g[0] || 'matching'} component` },
    '.AddComponent': { s: (a, o, g) => `ADD a ${g[0] || unq(a[0])} component to ${o}`, e: (a, o, g) => `a new ${g[0]} component on ${o}` },
    '.SetActive': {
      s: (a, o) => a[0] === 'true' ? `SWITCH ON ${o} (set active)` : a[0] === 'false' ? `SWITCH OFF ${o} (set inactive)` : `SET ${o} switched on TO ${a[0]}`,
    },
    '.CompareTag': { e: (a, o) => `${o} has the ${a[0]} tag` },
    'GameObject.Find': { e: a => `the object named ${a[0]}` },
    'GameObject.FindWithTag': { e: a => `the object tagged ${a[0]}` },
    'GameObject.FindGameObjectWithTag': { e: a => `the object tagged ${a[0]}` },
    'GameObject.FindGameObjectsWithTag': { e: a => `every object tagged ${a[0]}` },
    '.FindObjectOfType': { e: (a, o, g) => `the ${g[0]} in the scene` },
    '.FindFirstObjectByType': { e: (a, o, g) => `the ${g[0]} in the scene` },
    '.FindObjectsOfType': { e: (a, o, g) => `every ${g[0]} in the scene` },
    // --- moving ---
    '.Translate': { s: (a, o) => `MOVE ${o} by ${vec(a)}` },
    '.Rotate': { s: (a, o) => `ROTATE ${o} by ${vec(a)}` },
    '.RotateAround': { s: (a, o) => `ROTATE ${o} around ${a[0]} by ${a[2]} degrees` },
    '.LookAt': { s: (a, o) => `TURN ${o} to face ${a[0]}` },
    '.SetParent': { s: (a, o) => `MAKE ${a[0]} the parent of ${o}` },
    '.MovePosition': { s: (a, o) => `MOVE ${o} to ${a[0]}` },
    '.MoveRotation': { s: (a, o) => `TURN ${o} to ${a[0]}` },
    '.AddForce': { s: (a, o) => `PUSH ${o} with a force of ${vec(a.filter(x => !/^(Force|Impulse|Acceleration|Velocity ?Change)$/.test(x)))}` + (a.some(x => x === 'Impulse') ? ' (all at once)' : '') },
    '.AddRelativeForce': { s: (a, o) => `PUSH ${o} (relative to its direction) with a force of ${vec(a.filter(x => !/^(Force|Impulse)$/.test(x)))}` },
    '.AddTorque': { s: (a, o) => `SPIN ${o} with a turning force of ${vec(a.filter(x => !/^(Force|Impulse)$/.test(x)))}` },
    '.Sleep': { s: (a, o) => `STOP ${o}'s physics for now` },
    // --- input ---
    'Input.GetKeyDown': { io: true, e: a => `the ${a[0]} key is pressed` },
    'Input.GetKey': { io: true, e: a => `the ${a[0]} key is held down` },
    'Input.GetKeyUp': { io: true, e: a => `the ${a[0]} key is let go` },
    'Input.GetAxis': { io: true, e: a => `the ${a[0]} input (-1 to 1)` },
    'Input.GetAxisRaw': { io: true, e: a => `the ${a[0]} input (-1, 0 or 1)` },
    'Input.GetButtonDown': { io: true, e: a => `the ${a[0]} button is pressed` },
    'Input.GetButton': { io: true, e: a => `the ${a[0]} button is held down` },
    'Input.GetButtonUp': { io: true, e: a => `the ${a[0]} button is let go` },
    'Input.GetMouseButtonDown': { io: true, e: a => `the ${mouse(a[0])} is pressed` },
    'Input.GetMouseButton': { io: true, e: a => `the ${mouse(a[0])} is held down` },
    'Input.GetMouseButtonUp': { io: true, e: a => `the ${mouse(a[0])} is let go` },
    // --- output ---
    'Debug.Log': { io: true, s: a => `PRINT ${a[0]} to the console` },
    'Debug.LogWarning': { io: true, s: a => `PRINT the warning ${a[0]} to the console` },
    'Debug.LogError': { io: true, s: a => `PRINT the error ${a[0]} to the console` },
    '.print': { io: true, s: a => `PRINT ${a[0]} to the console` },
    // --- coroutines and timing ---
    '.StartCoroutine': { shape: 'sub', s: (a, o, g, r) => `START the coroutine ${routine(r[0], a[0])}` },
    '.StopCoroutine': { s: (a, o, g, r) => `STOP the coroutine ${routine(r[0], a[0])}` },
    '.StopAllCoroutines': { s: () => `STOP all coroutines` },
    '.Invoke': { shape: 'sub', s: a => `RUN ${unq(a[0])} after ${a[1]} seconds` },
    '.InvokeRepeating': { shape: 'sub', s: a => `RUN ${unq(a[0])} after ${a[1]} seconds, then every ${a[2]} seconds` },
    '.CancelInvoke': { s: a => a[0] ? `STOP running ${unq(a[0])}` : `STOP all scheduled runs` },
    // --- sound and animation ---
    '.Play': { s: (a, o) => `PLAY ${o}` + (a[0] ? ` ${a[0]}` : '') },
    '.PlayOneShot': { s: (a, o) => `PLAY the sound ${a[0]} once` + (o !== 'this object' ? ` on ${o}` : '') },
    '.Stop': { s: (a, o) => `STOP ${o}` },
    '.Pause': { s: (a, o) => `PAUSE ${o}` },
    '.SetTrigger': { s: (a, o) => `SET OFF the ${a[0]} trigger on ${o}` },
    '.ResetTrigger': { s: (a, o) => `RESET the ${a[0]} trigger on ${o}` },
    '.SetBool': { s: (a, o) => `SET ${poss(o)} ${a[0]} setting TO ${a[1]}` },
    '.SetFloat': { s: (a, o) => `SET ${poss(o)} ${a[0]} number TO ${a[1]}` },
    '.SetInteger': { s: (a, o) => `SET ${poss(o)} ${a[0]} number TO ${a[1]}` },
    '.GetBool': { e: (a, o) => `${poss(o)} ${a[0]} setting` },
    '.GetFloat': { e: (a, o) => `${poss(o)} ${a[0]} number` },
    '.GetInteger': { e: (a, o) => `${poss(o)} ${a[0]} number` },
    // --- scenes and the game ---
    'SceneManager.LoadScene': { s: a => `LOAD the scene ${a[0]}` },
    'SceneManager.GetActiveScene': { e: () => `the current scene` },
    'Application.Quit': { s: () => `QUIT the game` },
    // --- physics queries ---
    'Physics.Raycast': { e: a => `a ray from ${a[0]} going ${a[1]} hits something` + (a[3] ? ` within ${a[3]}` : '') },
    'Physics2D.Raycast': { e: a => `what a ray from ${a[0]} going ${a[1]} hits` + (a[2] ? ` within ${a[2]}` : '') },
    'Physics2D.OverlapCircle': { e: a => `something within ${a[1]} of ${a[0]}` + (a[2] ? ` (on ${a[2]})` : '') },
    'Physics.CheckSphere': { e: a => `something is within ${a[1]} of ${a[0]}` },
    'Physics2D.OverlapBox': { e: a => `something in a box at ${a[0]}` },
    // --- maths ---
    'Random.Range': {
      e: (a, o, g, r) => wholeRange(r)
        ? `a random whole number from ${a[0]} up to (not including) ${a[1]}`
        : `a random number from ${a[0]} to ${a[1]}`,
    },
    'Mathf.Abs': { e: a => `the absolute value of ${a[0]}` },
    'Mathf.Round': { e: a => `${a[0]} rounded` },
    'Mathf.RoundToInt': { e: a => `${a[0]} rounded to a whole number` },
    'Mathf.Floor': { e: a => `${a[0]} rounded down` },
    'Mathf.FloorToInt': { e: a => `${a[0]} rounded down to a whole number` },
    'Mathf.Ceil': { e: a => `${a[0]} rounded up` },
    'Mathf.CeilToInt': { e: a => `${a[0]} rounded up to a whole number` },
    'Mathf.Sqrt': { e: a => `the square root of ${a[0]}` },
    'Mathf.Pow': { e: a => `${a[0]} to the power of ${a[1]}` },
    'Mathf.Min': { e: a => `the smaller of ${a.join(' and ')}` },
    'Mathf.Max': { e: a => `the larger of ${a.join(' and ')}` },
    'Mathf.Clamp': { e: a => `${a[0]} kept between ${a[1]} and ${a[2]}` },
    'Mathf.Clamp01': { e: a => `${a[0]} kept between 0 and 1` },
    'Mathf.Lerp': { e: a => `the number ${a[2]} of the way from ${a[0]} to ${a[1]}` },
    'Mathf.MoveTowards': { e: a => `${a[0]} moved up to ${a[2]} towards ${a[1]}` },
    'Mathf.Sign': { e: a => `the sign of ${a[0]} (-1 or 1)` },
    'Mathf.Approximately': { e: a => `${a[0]} is almost equal to ${a[1]}` },
    'Vector2.Distance': { e: a => `the distance between ${a[0]} and ${a[1]}` },
    'Vector3.Distance': { e: a => `the distance between ${a[0]} and ${a[1]}` },
    'Vector2.MoveTowards': { e: a => `${a[0]} moved up to ${a[2]} towards ${a[1]}` },
    'Vector3.MoveTowards': { e: a => `${a[0]} moved up to ${a[2]} towards ${a[1]}` },
    'Vector2.Lerp': { e: a => `the point ${a[2]} of the way from ${a[0]} to ${a[1]}` },
    'Vector3.Lerp': { e: a => `the point ${a[2]} of the way from ${a[0]} to ${a[1]}` },
    'Quaternion.Euler': { e: a => `the rotation ${vec(a)}` },
    'Quaternion.LookRotation': { e: a => `the rotation facing ${a[0]}` },
    'Quaternion.Slerp': { e: a => `the rotation ${a[2]} of the way from ${a[0]} to ${a[1]}` },
    'Quaternion.Lerp': { e: a => `the rotation ${a[2]} of the way from ${a[0]} to ${a[1]}` },
    // --- lists and text ---
    '.Add': { s: (a, o) => `ADD ${a[0]} to ${o}` },
    '.Remove': { s: (a, o) => `REMOVE ${a[0]} from ${o}` },
    '.RemoveAt': { s: (a, o) => `REMOVE item ${a[0]} from ${o}` },
    '.Insert': { s: (a, o) => `INSERT ${a[1]} into ${o} at position ${a[0]}` },
    '.Clear': { s: (a, o) => `EMPTY ${o}` },
    '.Contains': { e: (a, o) => `${o} contains ${a[0]}` },
    '.IndexOf': { e: (a, o) => `the position of ${a[0]} in ${o}` },
    '.ToString': { e: (a, o) => `${o} as text` + (a[0] ? ` (format ${a[0]})` : '') },
    'string.Format': { e: a => `the text ${a[0]} filled in with ${a.slice(1).join(', ')}` },
    'PlayerPrefs.SetInt': { s: a => `SAVE ${a[1]} as ${a[0]}` },
    'PlayerPrefs.SetFloat': { s: a => `SAVE ${a[1]} as ${a[0]}` },
    'PlayerPrefs.SetString': { s: a => `SAVE ${a[1]} as ${a[0]}` },
    'PlayerPrefs.GetInt': { e: a => `the saved number ${a[0]}` + (a[1] ? ` (or ${a[1]} if not saved)` : '') },
    'PlayerPrefs.GetFloat': { e: a => `the saved number ${a[0]}` + (a[1] ? ` (or ${a[1]} if not saved)` : '') },
    'PlayerPrefs.GetString': { e: a => `the saved text ${a[0]}` + (a[1] ? ` (or ${a[1]} if not saved)` : '') },
    'PlayerPrefs.Save': { s: () => `SAVE everything to the device` },
  };

  /** Plain names for C# types, used when a variable has no starting value. */
  const TYPES = {
    int: 'a whole number', float: 'a number', double: 'a number', long: 'a whole number',
    bool: 'true or false', string: 'text', char: 'a letter',
    GameObject: 'a game object', Transform: 'a transform', Vector2: 'a 2D point', Vector3: 'a 3D point',
    Quaternion: 'a rotation', Color: 'a colour', AudioClip: 'a sound', AudioSource: 'a sound player',
    Rigidbody2D: 'a Rigidbody2D', Rigidbody: 'a Rigidbody', Animator: 'an Animator', Text: 'a UI text',
    TextMeshProUGUI: 'a UI text', TMP_Text: 'a UI text', Image: 'a UI image', Slider: 'a UI slider',
    Camera: 'a camera', LayerMask: 'a layer', Sprite: 'a sprite', SpriteRenderer: 'a sprite renderer',
  };

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------

  function pn(name) { return name ? ` (${name})` : ''; }
  function unq(s) { return String(s || '').replace(/^"(.*)"$/, '$1'); }
  function poss(o) { return o === 'this object' ? "this object's" : `${o}'s`; }
  /** "rb's velocity", but "the y of rb's velocity" when the owner is already a phrase. */
  function propOf(o, p) { return o === 'this object' || !/\s/.test(o) ? `${poss(o)} ${p}` : `the ${p} of ${o}`; }
  function vec(a) { return a.length > 1 ? `(${a.join(', ')})` : (a[0] || ''); }
  function isIntLit(n) {
    if (!n) return false;
    if (n.type === 'argument') n = n.namedChildren[0];
    if (n && n.type === 'prefix_unary_expression') n = n.namedChildren[0];
    return !!n && n.type === 'integer_literal';
  }
  /** Random.Range(int, int) never returns the maximum: say so. */
  function wholeRange(r) {
    const txt = r.map(x => x ? x.text : '');
    if (txt.some(t => /\d\.\d|\d[fF]\b|\.\d/.test(t))) return false;
    const countLike = t => /\.(Length|Count)$/.test(t.trim());
    return (isIntLit(r[0]) && isIntLit(r[1])) || (isIntLit(r[0]) && countLike(txt[1])) || (countLike(txt[0]) && isIntLit(r[1]));
  }

  function routine(raw, rendered) {
    if (raw && raw.type === 'argument') raw = raw.namedChildren[0];
    if (raw && raw.type === 'invocation_expression') {
      const fn = raw.childForFieldName('function');
      const args = argNodes(raw);
      return fn.text + (args.length ? ` WITH ${args.map(x => x.text).join(', ')}` : '');
    }
    return unq(rendered);
  }
  function lineOf(node) { return node.startPosition.row + 1; }
  function field(n, name) { return n.childForFieldName(name); }
  function named(n) { return n ? n.namedChildren.filter(c => c.type !== 'comment') : []; }
  function argNodes(call) {
    const list = field(call, 'arguments');
    return list ? list.namedChildren.filter(c => c.type === 'argument') : [];
  }
  /** The starting value of `name = value` (tree nodes can't be compared with ===). */
  function initOf(d) {
    let seen = false;
    for (const c of d.children) {
      if (!c.isNamed && c.type === '=') seen = true;
      else if (seen && c.isNamed && c.type !== 'comment') return c;
    }
    return null;
  }

  function opText(n) {
    const op = field(n, 'operator');
    if (op) return op.text;
    for (const c of n.children) if (!c.isNamed) return c.type;
    return '';
  }

  // ---------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------

  function splitFiles(source) {
    const files = [];
    let cur = { name: null, lines: [] };
    for (const line of source.split(/\r?\n/)) {
      const m = FILE_MARK.exec(line);
      if (m) {
        if (cur.lines.join('').trim()) files.push(cur);
        cur = { name: m[1], lines: [] };
      } else {
        cur.lines.push(line);
      }
    }
    if (cur.lines.join('').trim()) files.push(cur);
    return files.map(f => ({ name: f.name, text: f.lines.join('\n') }));
  }

  function analyse(source, parser) {
    if (!parser) throw new Error('The C# reader is not loaded');
    const ctx = { sections: [], warnings: [], count: 0 };
    const files = splitFiles(source);
    for (const file of files) {
      const tree = parser.parse(file.text);
      const rootNode = tree.rootNode;
      if (rootNode.hasError) {
        const bad = firstError(rootNode);
        ctx.warnings.push(`${file.name ? file.name + ', l' : 'L'}ine ${bad ? lineOf(bad) : '?'}: Codeflow could not read part of this code (is something missing, like a ; or a } ?). The results may be incomplete.`);
      }
      const classes = [];
      (function find(n) {
        for (const c of n.namedChildren) {
          if (c.type === 'class_declaration' || c.type === 'struct_declaration') classes.push(c);
          if (/namespace_declaration|declaration_list|class_declaration|struct_declaration/.test(c.type)) find(c);
        }
      })(rootNode);
      if (!classes.length && file.text.trim()) {
        ctx.warnings.push(`${file.name || 'This code'} has no class in it. Paste the whole script, starting at "using UnityEngine;".`);
      }
      for (const cls of classes) analyseClass(ctx, cls, file);
    }
    if (!ctx.sections.length && !ctx.warnings.length) {
      ctx.warnings.push('No code found. Paste a C# script from your Unity project.');
    }
    return { sections: ctx.sections, warnings: ctx.warnings };
  }

  function firstError(n) {
    if (n.type === 'ERROR' || n.isMissing) return n;
    for (const c of n.children) {
      if (c.hasError || c.type === 'ERROR' || c.isMissing) {
        const f = firstError(c);
        if (f) return f;
      }
    }
    return null;
  }

  function analyseClass(ctx, cls, file) {
    const name = field(cls, 'name').text;
    const bases = cls.namedChildren.find(c => c.type === 'base_list');
    const group = (file.name ? file.name + ' · ' : '') + `class ${name}` + (bases ? ' ' + bases.text.replace(/\s+/g, ' ') : '');
    const body = field(cls, 'body');
    const members = body ? body.namedChildren : [];

    // Every name declared in the class, so we know which words are variables.
    const vars = new Set();
    const methods = new Set();
    (function visit(n) {
      if (n.type === 'variable_declarator' || n.type === 'parameter' || n.type === 'property_declaration' ||
          n.type === 'catch_declaration') {
        const id = field(n, 'name') || n.namedChildren.find(c => c.type === 'identifier');
        if (id) vars.add(id.text);
      } else if (n.type === 'foreach_statement') {
        const left = field(n, 'left');
        if (left) vars.add(left.text);
      } else if (n.type === 'implicit_parameter') {
        vars.add(n.text);
      } else if (n.type === 'method_declaration' || n.type === 'local_function_statement') {
        methods.add(field(n, 'name').text);
      }
      for (const c of n.namedChildren) visit(c);
    })(cls);
    const cctx = { ctx, vars, methods, className: name };

    // Variables (fields and simple properties)
    const varLines = [];
    for (const m of members) {
      if (m.type === 'field_declaration') {
        varLines.push(...fieldLines(cctx, m));
      } else if (m.type === 'property_declaration' && !hasAccessorBodies(m)) {
        varLines.push(...fieldLines(cctx, m));
      }
    }

    const defs = [];
    let seq = 0;
    for (const m of members) {
      seq++;
      if (m.type === 'method_declaration') {
        const mname = field(m, 'name').text;
        const params = paramNames(m);
        const ret = field(m, 'returns') || field(m, 'type');
        const msg = MESSAGES[mname];
        const isCoroutine = ret && /^IEnumerator\b/.test(ret.text);
        let title, kind, order, repeat;
        if (msg && !isCoroutine) {
          title = msg.title(params[0]); kind = msg.kind; order = msg.order; repeat = msg.repeat;
        } else if (msg && isCoroutine && mname === 'Start') {
          title = 'WHEN this object starts (as a coroutine)'; kind = 'start'; order = 3;
        } else {
          title = `${isCoroutine ? 'COROUTINE' : 'FUNCTION'} ${mname}` + (params.length ? `(${params.join(', ')})` : '');
          kind = 'function'; order = 9;
        }
        defs.push({ order, seq, kind, title, repeat, node: m, method: mname, line: lineOf(m) });
      } else if (m.type === 'property_declaration' && hasAccessorBodies(m)) {
        const pname = field(m, 'name').text;
        const acc = field(m, 'accessors');
        const value = field(m, 'value');
        if (acc) {
          for (const a of acc.namedChildren) {
            const which = a.children.find(c => !c.isNamed && (c.type === 'get' || c.type === 'set'));
            const word = which ? which.type : (field(a, 'name') ? field(a, 'name').text : 'get');
            defs.push({ order: 9, seq, kind: 'function', title: word === 'set' ? `WHEN ${pname} is changed` : `WHEN ${pname} is read`, node: a, method: `${pname} ${word}`, line: lineOf(a) });
          }
        } else if (value) {
          defs.push({ order: 9, seq, kind: 'function', title: `WHEN ${pname} is read`, node: m, method: pname, line: lineOf(m) });
        }
      } else if (m.type === 'constructor_declaration') {
        defs.push({ order: 0, seq, kind: 'start', title: `WHEN a new ${name} is made`, node: m, method: name, line: lineOf(m) });
      }
    }
    defs.sort((a, b) => a.order - b.order || a.seq - b.seq);

    if (varLines.length) {
      buildSection(ctx, { kind: 'vars', title: 'VARIABLES', lines: varLines, group, method: 'fields', line: lineOf(members[0] || cls) });
    }
    for (const d of defs) {
      const bodyNode = field(d.node, 'body') || d.node.namedChildren.find(c => c.type === 'block' || c.type === 'arrow_expression_clause');
      const steps = bodyNode ? stepsOf(cctx, bodyNode) : [];
      if (!bodyNode && d.node.type === 'property_declaration') {
        const v = field(d.node, 'value');
        if (v) steps.push({ t: 'return', text: `RETURN ${expr(cctx, v)}` });
      }
      buildSection(ctx, { kind: d.kind, title: d.title, body: steps, repeat: d.repeat, group, method: d.method, line: d.line });
    }
    if (!varLines.length && !defs.length) {
      ctx.warnings.push(`class ${name} has no variables or methods to show.`);
    }
  }

  function hasAccessorBodies(p) {
    if (field(p, 'value') && p.children.some(c => c.type === 'arrow_expression_clause')) return true;
    if (p.namedChildren.some(c => c.type === 'arrow_expression_clause')) return true;
    const acc = field(p, 'accessors');
    return !!acc && acc.namedChildren.some(a => a.namedChildren.some(c => c.type === 'block' || c.type === 'arrow_expression_clause'));
  }

  function paramNames(m) {
    const list = field(m, 'parameters');
    return list ? list.namedChildren.filter(c => c.type === 'parameter').map(p => field(p, 'name').text) : [];
  }

  function fieldLines(cctx, m) {
    const mods = m.namedChildren.filter(c => c.type === 'modifier').map(c => c.text);
    const attrs = m.namedChildren.filter(c => c.type === 'attribute_list').map(c => c.text).join(' ');
    const inInspector = mods.includes('public') || /\bSerializeField\b/.test(attrs);
    const notes = [];
    if (mods.includes('const')) notes.push('never changes');
    else if (mods.includes('static')) notes.push('shared by every copy');
    if (inInspector && !mods.includes('const') && !mods.includes('static')) notes.push('can be changed in the Inspector');
    const header = /Header\s*\(\s*"([^"]*)"/.exec(attrs);
    const out = [];
    if (header) out.push({ depth: 1, text: 'NOTE: ' + header[1], note: true });
    const tail = notes.length ? ` (${notes.join(', ')})` : '';

    if (m.type === 'property_declaration') {
      const type = field(m, 'type');
      const value = field(m, 'value');
      const n = field(m, 'name').text;
      out.push({ depth: 1, text: value ? `SET ${n} TO ${expr(cctx, value)}${tail}` : `CREATE ${n}, ${typeName(type)}${tail}` });
      return out;
    }
    const decl = m.namedChildren.find(c => c.type === 'variable_declaration');
    if (!decl) return out;
    const type = field(decl, 'type');
    for (const d of decl.namedChildren.filter(c => c.type === 'variable_declarator')) {
      const n = field(d, 'name').text;
      const init = initOf(d);
      out.push({ depth: 1, text: init ? `SET ${n} TO ${expr(cctx, init)}${tail}` : `CREATE ${n}, ${typeName(type)}${tail}` });
    }
    return out;
  }

  function typeName(t) {
    if (!t) return 'a value';
    const s = t.text.replace(/\s+/g, '');
    if (TYPES[s]) return TYPES[s];
    let m;
    if ((m = /^(\w+)\[\]$/.exec(s))) return `a list of ${plural(m[1])}`;
    if ((m = /^List<(\w+)>$/.exec(s))) return `a list of ${plural(m[1])}`;
    return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`;
  }
  function plural(t) {
    const base = { int: 'whole numbers', float: 'numbers', string: 'texts', bool: 'true/false values', GameObject: 'game objects', Transform: 'transforms' };
    return base[t] || t + 's';
  }

  // ---------------------------------------------------------------------
  // C# statements -> steps
  // ---------------------------------------------------------------------

  function stepsOf(cctx, node) {
    if (!node) return [];
    if (node.type === 'block') {
      const out = [];
      for (const c of node.namedChildren) {
        if (c.type === 'comment') out.push(commentStep(c));
        else out.push(...stepsOf(cctx, c));
      }
      return out.filter(Boolean);
    }
    if (node.type === 'arrow_expression_clause') {
      const e = node.namedChildren[0];
      return e ? [exprStep(cctx, e)] : [];
    }
    return [stmtStep(cctx, node)].filter(Boolean);
  }

  function commentStep(c) {
    const t = c.text.replace(/^\/\/\s?/, '').replace(/^\/\*+\s?|\s*\*+\/$/g, '').replace(/^\s*\*\s?/gm, '').trim();
    if (!t || FILE_MARK.test(c.text)) return null;
    return { t: 'note', text: t };
  }

  function stmtStep(cctx, n) {
    switch (n.type) {
      case 'block': return { t: 'group', body: stepsOf(cctx, n) };
      case 'empty_statement': return null;
      case 'expression_statement': return exprStep(cctx, named(n)[0]);
      case 'local_declaration_statement': {
        const decl = n.namedChildren.find(c => c.type === 'variable_declaration');
        const steps = [];
        for (const d of decl ? decl.namedChildren.filter(c => c.type === 'variable_declarator') : []) {
          const name = field(d, 'name').text;
          const init = initOf(d);
          if (!init) { steps.push({ t: 'simple', text: `CREATE ${name}, ${typeName(field(decl, 'type'))}` }); continue; }
          const io = { io: false };
          const v = expr(cctx, init, io);
          steps.push({ t: 'simple', text: `SET ${name} TO ${v}`, shape: io.io ? 'io' : undefined });
        }
        return steps.length === 1 ? steps[0] : { t: 'group', body: steps };
      }
      case 'if_statement': {
        const alt = field(n, 'alternative');
        let els = null;
        if (alt) els = alt.type === 'if_statement' ? [Object.assign(stmtStep(cctx, alt), { elseIf: true })] : stepsOf(cctx, alt);
        return { t: 'if', cond: cond(cctx, field(n, 'condition')), then: stepsOf(cctx, field(n, 'consequence')), else: els };
      }
      case 'while_statement': {
        const c = field(n, 'condition');
        if (c && c.type === 'boolean_literal' && c.text === 'true') return { t: 'forever', body: stepsOf(cctx, field(n, 'body')) };
        return { t: 'while', cond: cond(cctx, c), body: stepsOf(cctx, field(n, 'body')) };
      }
      case 'do_statement':
        return { t: 'do', cond: cond(cctx, field(n, 'condition')), body: stepsOf(cctx, field(n, 'body')) };
      case 'for_statement': return forStep(cctx, n);
      case 'foreach_statement':
        return { t: 'foreach', v: field(n, 'left').text, list: expr(cctx, field(n, 'right')), body: stepsOf(cctx, field(n, 'body')) };
      case 'switch_statement': {
        const subject = expr(cctx, field(n, 'value'));
        const cases = [];
        let labels = [];
        let isDefault = false;
        for (const sec of field(n, 'body').namedChildren.filter(c => c.type === 'switch_section')) {
          const stmts = [];
          for (const c of sec.namedChildren) {
            if (/pattern|label/.test(c.type) && !/statement/.test(c.type)) labels.push(expr(cctx, c.namedChildren[0] || c));
            else if (c.type === 'comment') stmts.push(commentStep(c));
            else stmts.push(...stepsOf(cctx, c));
          }
          if (sec.children.some(c => !c.isNamed && c.type === 'default')) isDefault = true;
          if (stmts.filter(Boolean).length) {
            cases.push({ labels, isDefault, body: stmts.filter(Boolean) });
            labels = []; isDefault = false;
          }
        }
        return { t: 'switch', subject, cases };
      }
      case 'return_statement': {
        const v = named(n)[0];
        return { t: 'return', text: v ? `RETURN ${expr(cctx, v)}` : 'STOP here (return)' };
      }
      case 'break_statement': return { t: 'break' };
      case 'continue_statement': return { t: 'continue' };
      case 'yield_statement': return yieldStep(cctx, n);
      case 'throw_statement': {
        const v = named(n)[0];
        return { t: 'return', text: `STOP WITH ERROR${v ? ' ' + expr(cctx, v) : ''}` };
      }
      case 'try_statement': {
        const body = [{ t: 'note', text: 'TRY:' }].concat(stepsOf(cctx, field(n, 'body')));
        const fin = n.namedChildren.find(c => c.type === 'finally_clause');
        if (fin) body.push({ t: 'note', text: 'FINALLY:' }, ...stepsOf(cctx, fin.namedChildren.find(c => c.type === 'block')));
        return { t: 'group', body };
      }
      case 'using_statement':
      case 'lock_statement':
      case 'checked_statement':
      case 'unsafe_statement':
      case 'fixed_statement':
        return { t: 'group', body: stepsOf(cctx, field(n, 'body') || n.namedChildren.find(c => c.type === 'block')) };
      case 'local_function_statement':
        return { t: 'note', text: `(defines a function called ${field(n, 'name').text})` };
      case 'labeled_statement':
        return { t: 'group', body: n.namedChildren.slice(1).flatMap(c => stepsOf(cctx, c)) };
      case 'comment': return commentStep(n);
      default:
        return { t: 'simple', text: n.text.replace(/\s+/g, ' ').slice(0, 90) };
    }
  }

  /** Conditions read better without the outer brackets. */
  function cond(cctx, n, io) {
    while (n && n.type === 'parenthesized_expression') n = named(n)[0];
    return expr(cctx, n, io);
  }

  function forStep(cctx, n) {
    const inits = n.children.filter((c, i) => n.fieldNameForChild(i) === 'initializer');
    const updates = n.children.filter((c, i) => n.fieldNameForChild(i) === 'update');
    const condN = field(n, 'condition');
    const body = stepsOf(cctx, field(n, 'body'));
    // for (int i = A; i < B; i++)
    const decl = inits.length === 1 && inits[0].type === 'variable_declaration' ? inits[0] : null;
    const ds = decl ? decl.namedChildren.filter(c => c.type === 'variable_declarator') : [];
    if (ds.length === 1 && condN && condN.type === 'binary_expression' && updates.length === 1) {
      const v = field(ds[0], 'name').text;
      const init = initOf(ds[0]);
      const op = opText(condN);
      const left = field(condN, 'left');
      const u = updates[0];
      let step = null;
      if ((u.type === 'postfix_unary_expression' || u.type === 'prefix_unary_expression') && /\+\+/.test(u.text) && named(u)[0] && named(u)[0].text === v) step = '1';
      else if (u.type === 'assignment_expression' && opText(u) === '+=' && field(u, 'left').text === v) step = expr(cctx, field(u, 'right'));
      if (init && left && left.text === v && (op === '<' || op === '<=') && step) {
        const from = expr(cctx, init);
        const to = expr(cctx, field(condN, 'right'));
        const bodyNode = field(n, 'body');
        if (from === '0' && op === '<' && step === '1' && !usesName(bodyNode, v)) return { t: 'repeat', times: to, body };
        return { t: 'count', v, from, to, inclusive: op === '<=', step, body };
      }
    }
    const initText = inits.map(i => i.type === 'variable_declaration'
      ? i.namedChildren.filter(c => c.type === 'variable_declarator').map(d => {
        const init = initOf(d);
        return `SET ${field(d, 'name').text} TO ${expr(cctx, init)}`;
      }).join(', ')
      : exprStep(cctx, i).text).join(', ');
    const stepText = updates.map(u => exprStep(cctx, u).text).join(', ');
    return { t: 'loop', init: initText || null, cond: condN ? cond(cctx, condN) : null, step: stepText || null, body };
  }

  function usesName(node, name) {
    if (!node) return false;
    if (node.type === 'identifier' && node.text === name) return true;
    return node.namedChildren.some(c => usesName(c, name));
  }

  function yieldStep(cctx, n) {
    if (n.children.some(c => !c.isNamed && c.type === 'break')) return { t: 'return', text: 'STOP the coroutine (yield break)' };
    let v = named(n)[0];
    if (!v || v.type === 'null_literal') return { t: 'simple', text: 'WAIT until the next frame' };
    if (v.type === 'object_creation_expression') {
      const type = field(v, 'type').text;
      const a = argNodes(v).map(x => expr(cctx, x));
      if (type === 'WaitForSeconds' || type === 'WaitForSecondsRealtime') return { t: 'simple', text: `WAIT ${a[0]} seconds` };
      if (type === 'WaitForFixedUpdate') return { t: 'simple', text: 'WAIT for the next physics step' };
      if (type === 'WaitForEndOfFrame') return { t: 'simple', text: 'WAIT until the end of this frame' };
      if (type === 'WaitUntil') return { t: 'simple', text: `WAIT until ${lambdaBody(cctx, argNodes(v)[0])}` };
      if (type === 'WaitWhile') return { t: 'simple', text: `WAIT while ${lambdaBody(cctx, argNodes(v)[0])}` };
    }
    if (v.type === 'invocation_expression' && /StartCoroutine$/.test(field(v, 'function').text)) {
      return { t: 'simple', text: `RUN the coroutine ${routine(argNodes(v)[0], '')} and WAIT for it to finish`, shape: 'sub' };
    }
    return { t: 'simple', text: `WAIT for ${expr(cctx, v)}` };
  }

  function lambdaBody(cctx, arg) {
    let n = arg && arg.type === 'argument' ? arg.namedChildren[0] : arg;
    if (n && n.type === 'lambda_expression') {
      const b = field(n, 'body');
      if (b && b.type !== 'block') return expr(cctx, b);
    }
    return expr(cctx, n);
  }

  function exprStep(cctx, e) {
    if (!e) return null;
    const io = { io: false };
    while (e.type === 'parenthesized_expression') e = named(e)[0];
    if (e.type === 'assignment_expression') {
      const left = field(e, 'left'), right = field(e, 'right');
      const op = opText(e);
      const target = expr(cctx, left);
      const v = expr(cctx, right, io);
      // Setting UI text is output
      const leftName = left.type === 'member_access_expression' ? field(left, 'name').text : '';
      const shape = io.io || leftName === 'text' ? 'io' : undefined;
      switch (op) {
        case '=': return { t: 'simple', text: `SET ${target} TO ${v}`, shape };
        case '+=': return { t: 'simple', text: `CHANGE ${target} BY ${v}`, shape };
        case '-=': return { t: 'simple', text: `CHANGE ${target} BY ${negate(v)}`, shape };
        case '*=': return { t: 'simple', text: `MULTIPLY ${target} BY ${v}`, shape };
        case '/=': return { t: 'simple', text: `DIVIDE ${target} BY ${v}`, shape };
        case '??=': return { t: 'simple', text: `IF ${target} is nothing, SET it TO ${v}`, shape };
        default: return { t: 'simple', text: `${target} ${op} ${v}`, shape };
      }
    }
    if ((e.type === 'postfix_unary_expression' || e.type === 'prefix_unary_expression') && /\+\+|--/.test(opText(e) + e.text)) {
      const operand = named(e)[0];
      const up = /\+\+/.test(e.text);
      return { t: 'simple', text: `CHANGE ${expr(cctx, operand)} BY ${up ? '1' : '-1'}` };
    }
    if (e.type === 'invocation_expression') {
      const r = callText(cctx, e, 's', io);
      return { t: 'simple', text: r.text, shape: r.shape || (io.io ? 'io' : undefined) };
    }
    if (e.type === 'await_expression') return exprStep(cctx, named(e)[0]);
    return { t: 'simple', text: expr(cctx, e, io), shape: io.io ? 'io' : undefined };
  }

  // ---------------------------------------------------------------------
  // Calls
  // ---------------------------------------------------------------------

  /** Split an invocation into { method, typeArgs, recv (node or null), key parts }. */
  function callParts(call) {
    let fn = field(call, 'function');
    let recv = null, nameNode = fn;
    if (fn.type === 'member_access_expression') { recv = field(fn, 'expression'); nameNode = field(fn, 'name'); }
    else if (fn.type === 'conditional_access_expression') {
      recv = field(fn, 'condition');
      const mb = fn.namedChildren.find(c => c.type === 'member_binding_expression');
      nameNode = mb ? field(mb, 'name') || mb.namedChildren[0] : fn;
    }
    let method = nameNode.text, typeArgs = [];
    if (nameNode.type === 'generic_name') {
      method = nameNode.namedChildren[0].text;
      const tl = nameNode.namedChildren.find(c => c.type === 'type_argument_list');
      typeArgs = tl ? tl.namedChildren.map(t => t.text) : [];
    }
    return { fn, recv, method, typeArgs };
  }

  function callText(cctx, call, kind, io) {
    const { recv, method, typeArgs } = callParts(call);
    const raw = argNodes(call);
    const args = () => raw.map(a => expr(cctx, a, io));
    const recvIsValue = recv ? isValue(cctx, recv) : false;
    const staticKey = recv && !recvIsValue ? recv.text.replace(/\s+/g, '').replace(/^UnityEngine\./, '') + '.' + method : null;

    let entry = staticKey && CALLS[staticKey];
    let owner = null;
    if (!entry && (!recv || recvIsValue)) {
      entry = CALLS['.' + method];
      owner = recv ? ownerText(cctx, recv, io) : 'this object';
      // Our own method that shares a name with a Unity one: treat it as ours.
      if (!recv && cctx.methods.has(method)) entry = null;
    }
    if (entry) {
      let fn = entry[kind];
      if (!fn && kind === 's' && entry.e) fn = (...p) => 'DO ' + entry.e(...p);
      if (!fn && kind === 'e' && entry.s) fn = (...p) => entry.s(...p).replace(/^[A-Z]+(?:\s[A-Z]+)*\s/, m => m.toLowerCase());
      if (fn) {
        if (entry.io && io) io.io = true;
        return { text: fn(args(), owner, typeArgs, raw), shape: kind === 's' ? entry.shape : undefined };
      }
    }

    const a = args();
    // A method in this script: CALL it
    if (!recv && cctx.methods.has(method)) {
      return kind === 's'
        ? { text: `CALL ${method}` + (a.length ? ` WITH ${a.join(', ')}` : ''), shape: 'sub' }
        : { text: `the result of ${method}` + (a.length ? ` WITH ${a.join(', ')}` : '') };
    }
    // A method on another object: TELL it to do something
    if (recv && recvIsValue) {
      const o = ownerText(cctx, recv, io);
      return kind === 's'
        ? { text: `TELL ${o} to ${words(method)}` + (a.length ? ` WITH ${a.join(', ')}` : '') }
        : { text: `${words(method)} of ${o}` + (a.length ? ` (${a.join(', ')})` : '') };
    }
    // Anything else (static or inherited)
    const w = words(method).split(' ');
    if (kind === 's') {
      w[0] = w[0].toUpperCase();
      return { text: w.join(' ') + (a.length ? `: ${a.join(', ')}` : '') };
    }
    return { text: w.join(' ') + (a.length ? ` (${a.join(', ')})` : '') };
  }

  // ---------------------------------------------------------------------
  // Expressions
  // ---------------------------------------------------------------------

  /** Is this a value (a variable, this object...) rather than a type like Input or KeyCode? */
  function isValue(cctx, n) {
    if (!n) return false;
    switch (n.type) {
      case 'identifier':
        if (cctx.vars.has(n.text)) return true;
        return /^[a-z_]/.test(n.text);
      case 'this_expression': case 'this': case 'base_expression': return true;
      case 'member_access_expression': return isValue(cctx, field(n, 'expression'));
      case 'predefined_type': case 'generic_name': case 'qualified_name': return false;
      default: return true;
    }
  }

  /** "this object" for transform/gameObject/this; otherwise the rendered expression. */
  function ownerText(cctx, n, io) {
    if (n.type === 'this_expression' || n.type === 'this') return 'this object';
    if (n.type === 'identifier' && (n.text === 'transform' || n.text === 'gameObject') && !cctx.vars.has(n.text)) return 'this object';
    if (n.type === 'member_access_expression') {
      const name = field(n, 'name').text;
      if (name === 'transform' || name === 'gameObject') return ownerText(cctx, field(n, 'expression'), io);
    }
    return expr(cctx, n, io);
  }

  const BIN = {
    '==': '=', '!=': '≠', '<': '<', '>': '>', '<=': '≤', '>=': '≥',
    '&&': 'AND', '||': 'OR', '+': '+', '-': '-', '*': '×', '/': '÷',
  };

  function expr(cctx, n, io) {
    if (!n) return '';
    switch (n.type) {
      case 'argument': {
        const inner = named(n);
        return expr(cctx, inner[inner.length - 1], io);
      }
      case 'integer_literal': return n.text.replace(/[uUlL]+$/, '');
      case 'real_literal': return n.text.replace(/[fFdDmM]$/, '');
      case 'boolean_literal': return n.text;
      case 'null_literal': return 'nothing';
      case 'character_literal': return n.text;
      case 'string_literal': return '"' + n.namedChildren.map(c => c.text).join('') + '"';
      case 'verbatim_string_literal': return '"' + n.text.replace(/^@"/, '').replace(/"$/, '') + '"';
      case 'raw_string_literal': return '"' + n.text.replace(/^"+|"+$/g, '').trim() + '"';
      case 'interpolated_string_expression': {
        const parts = [];
        for (const c of n.namedChildren) {
          if (c.type === 'string_content') parts.push(`"${c.text}"`);
          else if (c.type === 'interpolation') {
            const inner = c.namedChildren.find(x => x.type !== 'interpolation_brace' && x.type !== 'interpolation_format_clause' && x.type !== 'interpolation_alignment_clause');
            parts.push(expr(cctx, inner, io));
          }
        }
        return parts.join(' + ') || '""';
      }
      case 'identifier':
        if (!cctx.vars.has(n.text)) {
          if (n.text === 'gameObject') return 'this object';
          if (n.text === 'transform') return "this object's transform";
        }
        return n.text;
      case 'this_expression': case 'this': return 'this object';
      case 'predefined_type': case 'generic_name': return n.text;
      case 'qualified_name': return dottedText(cctx, n.text, io);
      case 'declaration_expression': {
        // Inside brackets the parser reads "a * b" as a C pointer declaration.
        // Unity scripts don't use pointers, so it is really a multiplication.
        const type = field(n, 'type'), name = field(n, 'name');
        if (type && type.type === 'pointer_type') {
          const inner = field(type, 'type') || type.namedChildren[0];
          return `${expr(cctx, inner, io)} × ${name ? name.text : ''}`;
        }
        return name ? name.text : n.text;
      }
      case 'parenthesized_expression': return '(' + expr(cctx, named(n)[0], io) + ')';
      case 'member_access_expression': return memberText(cctx, n, io);
      case 'conditional_access_expression': {
        const o = field(n, 'condition');
        const mb = n.namedChildren.find(c => c.type === 'member_binding_expression');
        if (mb) {
          const nm = (field(mb, 'name') || mb.namedChildren[0]).text;
          return propOf(ownerText(cctx, o, io), PROPS[nm] || words(nm));
        }
        return n.text;
      }
      case 'invocation_expression': return callText(cctx, n, 'e', io).text;
      case 'object_creation_expression': {
        const type = field(n, 'type').text.replace(/\s+/g, '');
        const a = argNodes(n).map(x => expr(cctx, x, io));
        if (/^Vector[234]$/.test(type)) return `(${a.join(', ')})`;
        if (type === 'Color' || type === 'Color32') return `the colour (${a.join(', ')})`;
        if (type === 'WaitForSeconds') return `a wait of ${a[0]} seconds`;
        let m;
        if ((m = /^List<(\w+)>$/.exec(type))) return a.length ? `a new list of ${plural(m[1])}` : `an empty list of ${plural(m[1])}`;
        return `a new ${type}` + (a.length ? ` (${a.join(', ')})` : '');
      }
      case 'implicit_object_creation_expression': return 'a new object';
      case 'array_creation_expression': case 'implicit_array_creation_expression': {
        const init = n.namedChildren.find(c => c.type === 'initializer_expression');
        if (init) return expr(cctx, init, io);
        return `a new list (${n.text.replace(/\s+/g, ' ')})`;
      }
      case 'initializer_expression': case 'collection_expression': {
        const items = named(n);
        return items.length ? 'the list [' + items.map(x => expr(cctx, x, io)).join(', ') + ']' : 'an empty list';
      }
      case 'binary_expression': {
        const op = opText(n);
        const l = field(n, 'left'), r = field(n, 'right');
        const L = expr(cctx, l, io), R = expr(cctx, r, io);
        if ((op === '==' || op === '!=') && (r.type === 'null_literal' || l.type === 'null_literal')) {
          const subject = r.type === 'null_literal' ? L : R;
          return op === '==' ? `${subject} is nothing` : `${subject} exists`;
        }
        if (op === '%') return `the remainder of ${L} ÷ ${R}`;
        if (op === '??') return `${L} (or ${R} if that is nothing)`;
        return `${L} ${BIN[op] || op} ${R}`;
      }
      case 'prefix_unary_expression': {
        const v = expr(cctx, named(n)[0], io);
        const op = opText(n);
        if (op === '!') return `NOT ${v}`;
        if (op === '-') return '-' + v;
        if (op === '++') return `(${v} + 1)`;
        if (op === '--') return `(${v} - 1)`;
        return op + v;
      }
      case 'postfix_unary_expression': return expr(cctx, named(n)[0], io);
      case 'conditional_expression':
        return `(${expr(cctx, field(n, 'consequence'), io)} IF ${expr(cctx, field(n, 'condition'), io)}, OTHERWISE ${expr(cctx, field(n, 'alternative'), io)})`;
      case 'cast_expression': {
        const t = field(n, 'type').text;
        const v = expr(cctx, field(n, 'value'), io);
        if (t === 'int' || t === 'long') return `${v} as a whole number`;
        if (t === 'float' || t === 'double') return v;
        if (t === 'string') return `${v} as text`;
        return `${v} as ${a_(t)}`;
      }
      case 'as_expression': return `${expr(cctx, field(n, 'left'), io)} as ${a_(field(n, 'right').text)}`;
      case 'is_pattern_expression': {
        const p = field(n, 'pattern');
        const e = expr(cctx, field(n, 'expression'), io);
        if (p && p.type === 'constant_pattern' && p.namedChildren[0] && p.namedChildren[0].type === 'null_literal') return `${e} is nothing`;
        if (p && p.type === 'unary_pattern' && /null/.test(p.text)) return `${e} exists`;
        return `${e} is ${a_(p ? p.text : '?')}`;
      }
      case 'is_expression': return `${expr(cctx, named(n)[0], io)} is ${a_(named(n)[1].text)}`;
      case 'element_access_expression': {
        const sub = field(n, 'subscript');
        const idx = sub ? sub.namedChildren.map(x => expr(cctx, x, io)).join(', ') : '?';
        return `item ${idx} of ${expr(cctx, field(n, 'expression'), io)}`;
      }
      case 'lambda_expression': case 'anonymous_method_expression': return 'a function';
      case 'assignment_expression': return `(${exprStep(cctx, n).text})`;
      case 'typeof_expression': return `the type ${named(n)[0].text}`;
      case 'default_expression': return 'the default value';
      case 'await_expression': return expr(cctx, named(n)[0], io);
      case 'constant_pattern': return expr(cctx, named(n)[0], io);
      case 'declaration_pattern': return n.text;
      default: return n.text.replace(/\s+/g, ' ');
    }
  }

  /** Is this node the left side of an assignment? ("SET rb is kinematic TO" reads badly.) */
  function isAssignTarget(n) {
    const p = n.parent;
    return !!p && p.type === 'assignment_expression' && field(p, 'left') && field(p, 'left').id === n.id;
  }

  /** Render "a.b.c" written as a type name (the parser's view in some places). */
  function dottedText(cctx, text, io) {
    const full = text.replace(/\s+/g, '').replace(/^UnityEngine\./, '');
    const parts = full.split('.');
    const rootIsValue = cctx.vars.has(parts[0]) || /^[a-z_]/.test(parts[0]);
    if (!rootIsValue) {
      if (STATIC_PROPS[full]) return STATIC_PROPS[full];
      const last = parts[parts.length - 1];
      return /^[A-Z]/.test(last) ? titleWords(last) : `${words(parts[parts.length - 2] || '')} ${words(last)}`.trim();
    }
    let o = (parts[0] === 'transform' || parts[0] === 'gameObject') && !cctx.vars.has(parts[0]) ? 'this object' : parts[0];
    for (const p of parts.slice(1)) {
      if (p === 'transform' || p === 'gameObject') continue;
      o = propOf(o, PROPS[p] || (/^[xyzw]$/.test(p) ? p : words(p)));
    }
    return o;
  }

  function a_(t) { return /^[aeiou]/i.test(t) ? `an ${t}` : `a ${t}`; }

  function memberText(cctx, n, io) {
    const obj = field(n, 'expression');
    const nameNode = field(n, 'name');
    const name = nameNode.text;
    const full = n.text.replace(/\s+/g, '').replace(/^UnityEngine\./, '');
    if (STATIC_PROPS[full] && !isValue(cctx, obj)) return STATIC_PROPS[full];
    if (isValue(cctx, obj)) {
      const o = ownerText(cctx, obj, io);
      if (name === 'Count') return `the number of items in ${o}`;
      if (name === 'Length') return `the length of ${o}`;
      if (name === 'gameObject' && o !== 'this object') return `${o}'s game object`;
      if (name === 'transform' && o === 'this object') return "this object's transform";
      if (BOOL_PROPS[name] && !isAssignTarget(n)) return `${o} ${BOOL_PROPS[name]}`;
      return propOf(o, /^[xyzw]$/.test(name) ? name : PROPS[name] || words(name));
    }
    // A type, enum or namespace: KeyCode.Space -> "Space", Screen.dpi -> "screen dpi"
    if (/^[A-Z]/.test(name)) return titleWords(name);
    return `${words(obj.text.split('.').pop())} ${words(name)}`;
  }

  // ---------------------------------------------------------------------
  // Steps -> pseudocode lines + flowchart (shared shape with the MakeCode side)
  // ---------------------------------------------------------------------

  function buildSection(ctx, def) {
    const id = 'u' + (++ctx.count);
    const sec = { id, kind: def.kind, title: def.title, line: def.line, group: def.group, method: def.method };
    if (def.lines) {
      // Variables: pseudocode only.
      sec.lines = [{ depth: 0, text: def.title + ':', nodeId: null }].concat(def.lines);
      sec.mermaid = null;
      ctx.sections.push(sec);
      return sec;
    }
    const flow = new Flow(id);
    const lines = [];
    const startId = flow.node(def.title, 'terminal');
    lines.push({ depth: 0, text: def.title + ':', nodeId: startId });
    const b = { flow, lines, loops: [] };
    const pending = block(b, def.body, [{ id: startId }], 1);
    if (!def.body.length) lines.push({ depth: 1, text: '(nothing happens yet)', nodeId: null });
    if (pending.length || flow.returns.length || !flow.edges.length) {
      const endId = flow.node(def.repeat ? `END (${def.repeat})` : 'END', 'terminal');
      flow.link(pending, endId);
      flow.link(flow.returns, endId);
    }
    sec.lines = lines;
    sec.mermaid = flow.toMermaid();
    ctx.sections.push(sec);
    return sec;
  }

  function block(b, steps, pending, depth) {
    for (const s of steps) if (s) pending = step(b, s, pending, depth);
    return pending;
  }

  function simple(b, pending, depth, text, shape) {
    const id = b.flow.node(text, shape || 'process');
    b.flow.link(pending, id);
    b.lines.push({ depth, text, nodeId: id });
    return [{ id }];
  }

  function step(b, s, pending, depth) {
    const flow = b.flow;
    switch (s.t) {
      case 'group': return block(b, s.body, pending, depth);
      case 'note':
        b.lines.push({ depth, text: /^(TRY|FINALLY):$/.test(s.text) ? s.text : 'NOTE: ' + s.text, nodeId: null, note: true });
        return pending;
      case 'simple': return simple(b, pending, depth, s.text, s.shape);
      case 'if': return ifStep(b, s, pending, depth, false);
      case 'while':
      case 'forever': {
        const forever = s.t === 'forever';
        const c = flow.node(forever ? 'Keep going forever' : s.cond + '?', forever ? 'process' : 'decision');
        flow.link(pending, c);
        b.lines.push({ depth, text: forever ? 'REPEAT FOREVER:' : `WHILE ${s.cond}:`, nodeId: c });
        const loop = { breaks: [], cont: c };
        b.loops.push(loop);
        const out = block(b, s.body, [{ id: c, label: forever ? undefined : 'Yes' }], depth + 1);
        b.loops.pop();
        flow.link(out, c);
        return (forever ? [] : [{ id: c, label: 'No' }]).concat(loop.breaks);
      }
      case 'do': {
        b.lines.push({ depth, text: 'DO:', nodeId: null });
        const j = flow.node('Start of loop', 'process');
        flow.link(pending, j);
        const loop = { breaks: [], cont: null };
        b.loops.push(loop);
        const out = block(b, s.body, [{ id: j }], depth + 1);
        b.loops.pop();
        const c = flow.node(s.cond + '?', 'decision');
        loop.cont = c;
        flow.link(out, c);
        flow.edges.push({ from: c, to: j, label: 'Yes' });
        b.lines.push({ depth, text: `REPEAT WHILE ${s.cond}`, nodeId: c });
        return [{ id: c, label: 'No' }].concat(loop.breaks);
      }
      case 'repeat': {
        const c = flow.node(`Repeated ${s.times} times yet?`, 'decision');
        flow.link(pending, c);
        b.lines.push({ depth, text: `REPEAT ${s.times} TIMES:`, nodeId: c });
        const loop = { breaks: [], cont: c };
        b.loops.push(loop);
        const out = block(b, s.body, [{ id: c, label: 'No' }], depth + 1);
        b.loops.pop();
        flow.link(out, c);
        return [{ id: c, label: 'Yes' }].concat(loop.breaks);
      }
      case 'count':
      case 'loop': {
        let initText, condText, stepText, header;
        if (s.t === 'count') {
          initText = `SET ${s.v} TO ${s.from}`;
          condText = `${s.v} ${s.inclusive ? '≤' : '<'} ${s.to}?`;
          stepText = `CHANGE ${s.v} BY ${s.step}`;
          header = s.inclusive ? `FOR ${s.v} FROM ${s.from} TO ${s.to}` : `FOR ${s.v} FROM ${s.from} UP TO (not including) ${s.to}`;
          header += s.step !== '1' ? ` COUNTING BY ${s.step}:` : ':';
        } else {
          initText = s.init; stepText = s.step;
          condText = s.cond ? s.cond + '?' : 'Keep going forever';
          header = 'LOOP' + (s.init ? ` (start: ${s.init})` : '') + (s.cond ? ` WHILE ${s.cond}` : '') + (s.step ? ` (each time: ${s.step})` : '') + ':';
        }
        const hasCond = s.t === 'count' || !!s.cond;
        if (initText) {
          const i = flow.node(initText, 'process');
          flow.link(pending, i);
          pending = [{ id: i }];
        }
        const c = flow.node(condText, hasCond ? 'decision' : 'process');
        flow.link(pending, c);
        b.lines.push({ depth, text: header, nodeId: c });
        const inc = stepText ? flow.node(stepText, 'process') : null;
        const loop = { breaks: [], cont: inc || c };
        b.loops.push(loop);
        const out = block(b, s.body, [{ id: c, label: hasCond ? 'Yes' : undefined }], depth + 1);
        b.loops.pop();
        if (inc) { flow.link(out, inc); flow.edges.push({ from: inc, to: c }); } else flow.link(out, c);
        return (hasCond ? [{ id: c, label: 'No' }] : []).concat(loop.breaks);
      }
      case 'foreach': {
        const c = flow.node(`Any items left in ${s.list}?`, 'decision');
        flow.link(pending, c);
        b.lines.push({ depth, text: `FOR EACH ${s.v} IN ${s.list}:`, nodeId: c });
        const set = flow.node(`SET ${s.v} TO the next item`, 'process');
        flow.edges.push({ from: c, to: set, label: 'Yes' });
        const loop = { breaks: [], cont: c };
        b.loops.push(loop);
        const out = block(b, s.body, [{ id: set }], depth + 1);
        b.loops.pop();
        flow.link(out, c);
        return [{ id: c, label: 'No' }].concat(loop.breaks);
      }
      case 'switch': {
        b.lines.push({ depth, text: `CHECK ${s.subject}:`, nodeId: null });
        const loop = { breaks: [], cont: b.loops.length ? b.loops[b.loops.length - 1].cont : null, isSwitch: true };
        b.loops.push(loop);
        let ends = [];
        for (const cs of s.cases) {
          // "default" (even when it shares code with other cases) catches everything left.
          if (cs.isDefault) {
            b.lines.push({ depth: depth + 1, text: 'OTHERWISE:', nodeId: null });
            if (!cs.body.some(x => x && x.t !== 'break')) b.lines.push({ depth: depth + 2, text: '(do nothing)', nodeId: null, note: true });
            ends = ends.concat(block(b, cs.body, pending, depth + 2));
            pending = [];
            continue;
          }
          const c = flow.node(`${s.subject} = ${cs.labels.join(' or ')}?`, 'decision');
          flow.link(pending, c);
          b.lines.push({ depth: depth + 1, text: `CASE ${cs.labels.join(' OR ')}:`, nodeId: c });
          ends = ends.concat(block(b, cs.body, [{ id: c, label: 'Yes' }], depth + 2));
          pending = [{ id: c, label: 'No' }];
        }
        b.loops.pop();
        return pending.concat(ends, loop.breaks);
      }
      case 'return': {
        const id = flow.node(s.text, 'process');
        flow.link(pending, id);
        b.lines.push({ depth, text: s.text, nodeId: id });
        flow.returns.push({ id });
        return [];
      }
      case 'break': {
        const loop = b.loops[b.loops.length - 1];
        if (loop && loop.isSwitch) { loop.breaks.push(...pending); return []; }
        const id = flow.node('STOP the loop', 'process');
        flow.link(pending, id);
        b.lines.push({ depth, text: 'STOP the loop (break)', nodeId: id });
        if (loop) loop.breaks.push({ id });
        return [];
      }
      case 'continue': {
        const loop = [...b.loops].reverse().find(l => !l.isSwitch);
        const id = flow.node('SKIP to the next time round the loop', 'process');
        flow.link(pending, id);
        b.lines.push({ depth, text: 'SKIP to the next time round the loop (continue)', nodeId: id });
        if (loop && loop.cont) flow.edges.push({ from: id, to: loop.cont });
        return [];
      }
      default:
        return simple(b, pending, depth, String(s.text || ''), s.shape);
    }
  }

  function ifStep(b, s, pending, depth, isElseIf) {
    const flow = b.flow;
    const c = flow.node(s.cond + '?', 'decision');
    flow.link(pending, c);
    b.lines.push({ depth, text: `${isElseIf ? 'ELSE IF' : 'IF'} ${s.cond}:`, nodeId: c });
    const yes = block(b, s.then, [{ id: c, label: 'Yes' }], depth + 1);
    let no = [{ id: c, label: 'No' }];
    if (s.else) {
      if (s.else.length === 1 && s.else[0] && s.else[0].t === 'if' && s.else[0].elseIf) {
        no = ifStep(b, s.else[0], no, depth, true);
      } else {
        b.lines.push({ depth, text: 'ELSE:', nodeId: null });
        no = block(b, s.else, no, depth + 1);
      }
    }
    return yes.concat(no);
  }

  /** Does this text look like C# rather than MakeCode JavaScript? */
  function looksLikeCSharp(text) {
    return /\busing\s+UnityEngine\b|:\s*MonoBehaviour\b|\b(public|private|protected)\s+(void|class|float|int|bool|string)\b|\bvoid\s+(Start|Update|Awake)\s*\(/.test(text);
  }

  return { analyse, looksLikeCSharp, FILE_MARK };
});
